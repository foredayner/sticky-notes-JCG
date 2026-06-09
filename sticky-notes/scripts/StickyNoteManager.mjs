/**
 * StickyNoteManager.mjs  (v4)
 *
 * 변경:
 * - 플레이어 메모 생성 지원 (소켓 GM 중계)
 * - 씬 컨트롤 독립 버튼 (좌측 바 상단)
 */

import { StickyNoteStore } from "./StickyNoteStore.mjs";
import { StickyNoteWidget } from "./StickyNoteWidget.mjs";

const MODULE_ID   = "sticky-notes";
const SOCKET_NAME = `module.${MODULE_ID}`;

export class StickyNoteManager {

  static _container   = null;
  static _widgets     = new Map();
  static _drawing     = false;
  static _preview     = null;
  static _tickerBound = false;

  /* ══ INIT ══ */
  static init() {
    game.socket.on(SOCKET_NAME, (msg) => this._onSocket(msg));
  }

  /* ══ SETUP ══ */
  static setupLayer() {
    document.getElementById("sticky-notes-container")?.remove();

    const container = document.createElement("div");
    container.id = "sticky-notes-container";
    container.style.cssText = `
      position:fixed;top:0;left:0;width:0;height:0;
      overflow:visible;pointer-events:none;z-index:70;`;
    document.body.appendChild(container);
    this._container = container;

    if (!this._tickerBound) {
      canvas.app.ticker.add(() => this._updateAllPositions());
      this._tickerBound = true;
    }

    this._widgets.forEach(w => w.destroy());
    this._widgets.clear();
    this.renderAll();
  }

  /* ══ CANVAS → SCREEN ══ */
  static _getCanvasRect() {
    const el = document.getElementById("board")
            ?? document.querySelector("canvas")
            ?? canvas.app?.canvas
            ?? canvas.app?.view;
    return el?.getBoundingClientRect?.() ?? { left:0, top:0, width:0, height:0 };
  }

  /** 현재 canvasScale (worldTransform.a) */
  static get scale() {
    return canvas?.stage?.transform?.worldTransform?.a ?? 1;
  }

  static canvasToScreen(cx, cy) {
    const rect = this._getCanvasRect();
    const wt   = canvas.stage.transform.worldTransform;
    return {
      x: cx * wt.a + cy * wt.c + wt.tx + rect.left,
      y: cx * wt.b + cy * wt.d + wt.ty + rect.top,
    };
  }

  static _clientToCanvas(cx, cy) {
    const rect = this._getCanvasRect();
    const wt   = canvas.stage.transform.worldTransform;
    return {
      x: (cx - rect.left - wt.tx) / wt.a,
      y: (cy - rect.top  - wt.ty) / wt.d,
    };
  }

  /** widget의 el 위치/크기를 canvas 좌표 기준으로 업데이트 */
  static applyScreenPos(widget) {
    if (!widget?.el || !canvas?.stage) return;
    const pos = this.canvasToScreen(widget.data.x, widget.data.y);
    const sc  = this.scale;
    widget.el.style.left   = pos.x + "px";
    widget.el.style.top    = pos.y + "px";
    widget.el.style.width  = (widget.data.width  * sc) + "px";
    widget.el.style.height = (widget.data.height * sc) + "px";
  }

  /* ══ WIDGET MANAGEMENT ══ */
  static renderAll() {
    const notes = StickyNoteStore.forCurrentScene();
    for (const n of notes) this.addWidget(n);
  }

  static addWidget(data) {
    if (this._widgets.has(data.id)) return;
    if (!this._container) {
      this.setupLayer();
    }
    const widget = new StickyNoteWidget(data);
    widget.render(this._container);
    this._widgets.set(data.id, widget);
    this.applyScreenPos(widget);
  }

  static removeWidget(id) {
    const w = this._widgets.get(id);
    if (w) { w.destroy(); this._widgets.delete(id); }
  }

  static patchWidget(data) {
    const w = this._widgets.get(data.id);
    if (w) w.patch(data);
  }

  static _updateAllPositions() {
    this._widgets.forEach(w => this.applyScreenPos(w));
  }

  /* ══ MOUSE BINDING ══ */
  static _bindMouseDown() {
    if (this._mouseBound) return;
    this._mouseBound = true;

    const board = document.getElementById("board")
               ?? canvas.app?.view
               ?? canvas.app?.canvas;
    if (board) {
      board.addEventListener("mousedown", (e) => {
        const ctrl = ui.controls;
        const toolName  = ctrl?.tool?.name ?? ctrl?.activeTool ?? "";
        const groupName = ctrl?.control    ?? "";
        if (e.button === 0 && this._isStickyNoteTool()) this.onCanvasMouseDown(e);
      }, { capture: true });
    } else {
    }
    // document fallback 제거 — 중복 호출 원인
  }

  /* ══ DRAWING TOOL ══ */

  static _isStickyNoteTool() {
    const ctrl = ui.controls;
    if (!ctrl) return false;
    const toolName  = ctrl.tool?.name ?? ctrl.activeTool ?? "";
    const groupName = ctrl.control    ?? "";
    const result = toolName === "sticky-note-draw" || (typeof groupName === "string" && groupName === "stickynotes");
    return result;
  }

  static onCanvasMouseDown(e) {
    if (this._drawing) return;  // 중복 호출 방지
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    this._drawing = true;
    const startClient = { x: e.clientX, y: e.clientY };
    const startCanvas = this._clientToCanvas(e.clientX, e.clientY);

    const preview = document.createElement("div");
    preview.id = "sticky-notes-draw-preview";
    preview.style.cssText = `
      position:fixed;border:2px dashed #4a90d9;background:rgba(74,144,217,0.08);
      pointer-events:none;z-index:10000;
      left:${e.clientX}px;top:${e.clientY}px;width:0;height:0;`;
    document.body.appendChild(preview);
    this._preview = preview;

    const onMove = (ev) => {
      preview.style.left   = Math.min(ev.clientX, startClient.x) + "px";
      preview.style.top    = Math.min(ev.clientY, startClient.y) + "px";
      preview.style.width  = Math.abs(ev.clientX - startClient.x) + "px";
      preview.style.height = Math.abs(ev.clientY - startClient.y) + "px";
    };

    const onUp = async (ev) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup",   onUp);
      preview.remove();
      this._preview = null;
      this._drawing = false;

      const endCanvas = this._clientToCanvas(ev.clientX, ev.clientY);
      const x = Math.min(startCanvas.x, endCanvas.x);
      const y = Math.min(startCanvas.y, endCanvas.y);
      const w = Math.abs(endCanvas.x - startCanvas.x);
      const h = Math.abs(endCanvas.y - startCanvas.y);

      if (w < 30 || h < 20) return;

      const data = StickyNoteStore.makeDefault({ x, y, width: w, height: h });

      if (game.user.isGM) {
        await StickyNoteStore.add(data);
        this.addWidget(data);
        this.syncToClients("add", data);
      } else {
        this.syncToClients("request_add", data);
        this.addWidget(data);
      }
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
  }

  /* ══ SOCKET ══ */
  static syncToClients(action, payload) {
    game.socket.emit(SOCKET_NAME, { action, payload });
  }

  static async _onSocket({ action, payload }) {
    switch (action) {
      // 일반 동기화
      case "add":
        if (!this._widgets.has(payload.id)) this.addWidget(payload);
        break;
      case "update":
        this.patchWidget(payload);
        break;
      case "remove":
        this.removeWidget(payload.id);
        break;

      // 플레이어 → GM 중계 요청
      case "request_add":
        if (game.user.isGM) {
          await StickyNoteStore.add(payload);
          // GM 자신도 위젯 추가 (socket.emit은 자신에게 전달 안 됨)
          if (!this._widgets.has(payload.id)) this.addWidget(payload);
          // 나머지 클라이언트에 브로드캐스트
          this.syncToClients("add", payload);
        }
        break;

      case "request_update":
        if (game.user.isGM) {
          await StickyNoteStore.update(payload.id, payload.patch);
          // GM 자신에게도 적용
          this.patchWidget({ id: payload.id, ...payload.patch });
          this.syncToClients("update", { id: payload.id, ...payload.patch });
        }
        break;

      case "request_remove":
        if (game.user.isGM) {
          await StickyNoteStore.remove(payload.id);
          // GM 자신에게도 적용
          this.removeWidget(payload.id);
          this.syncToClients("remove", payload);
        }
        break;

      case "confirm_add":
        // 플레이어: GM이 저장 완료 확인 (이미 낙관적 UI로 표시됨)
        break;
    }
  }

  /**
   * 플레이어도 사용 가능한 update/remove 헬퍼
   * GM이면 직접 처리, 아니면 소켓으로 중계
   */
  static async requestUpdate(id, patch) {
    if (game.user.isGM) {
      await StickyNoteStore.update(id, patch);
      this.syncToClients("update", { id, ...patch });
    } else {
      this.syncToClients("request_update", { id, patch });
    }
  }

  static async requestRemove(id) {
    if (game.user.isGM) {
      await StickyNoteStore.remove(id);
      this.removeWidget(id);
      this.syncToClients("remove", { id });
    } else {
      this.removeWidget(id);  // 낙관적
      this.syncToClients("request_remove", { id });
    }
  }
}
