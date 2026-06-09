/**
 * DrawingOverlay.mjs  (v8)
 *
 * 적용된 기능:
 * 1. Ctrl+Z → DrawingCanvas._active 플래그로 제한
 * 2. 텍스트 중복 방지
 * 3. 레이어 패널 크기 2배
 * 4. 레이어 드래그 순서 변경
 * 5. 레이어 우클릭 컨텍스트 메뉴 (복사/삭제/병합)
 * 6. 텍스트 레이어 — textData 보관, 편집 진입, 이미지 변환 다이얼로그
 * 7. 영역·이동 재설계 → DrawingCanvas에서 처리
 * 8. 텍스트 도구로 기존 텍스트 레이어 클릭 시 편집 진입
 * 9. 노트 리사이즈 → LayerManager.resize()
 */

import { DrawingToolbar } from "./DrawingToolbar.mjs";
import { DrawingCanvas }  from "./DrawingCanvas.mjs";
import { LayerManager }   from "./LayerManager.mjs";
import { ColorPicker }    from "./ColorPicker.mjs";
import { ImageImporter }  from "./ImageImporter.mjs";
import { TOOLS }          from "./DrawingToolbar.mjs";

export class DrawingOverlay {

  static _instance = null;

  static open(widget) {
    if (this._instance) this._instance._close(false);
    const inst = new DrawingOverlay(widget);
    this._instance = inst;
    inst._mount();
  }

  constructor(widget) {
    this.widget      = widget;
    this.el          = null;
    this.toolbar     = null;
    this.drawCanvas  = null;
    this.layerMgr    = null;
    this.colorPicker = null;

    this._zoom     = 1.0;
    this._MIN_ZOOM = 0.2;
    this._MAX_ZOOM = 8.0;

    // 2: 텍스트 편집 중복 방지
    this._textEditing   = false;
    this._pendingTextEl = null;
    this._editingLayerIdx = -1;

    this._textOpts = {
      font:"sans-serif", size:16, bold:false, italic:false, underline:false,
      spacing:0, lineHeight:160, align:"left",
    };

    // 4: 레이어 드래그
    this._layerDragIdx  = -1;
    this._layerDragOver = -1;

    // 컨텍스트 메뉴
    this._ctxMenu = null;
  }

  /* ══════════════════════════════════════════
     MOUNT
  ═════════════════════════════════════════════ */
  _mount() {
    const el = document.createElement("div");
    el.id = "sn-drawing-overlay";
    el.innerHTML = this._buildHTML();
    document.body.appendChild(el);
    this.el = el;

    this._positionMemo();
    this._initLayerManager();
    this._mountDrawCanvas();
    this._mountToolbar();
    this._attachEvents();
    this._refreshLayerUI();
    this._refreshHistoryUI();

    // 1: Ctrl+Z를 그리기 모드 안에서만
    this.drawCanvas?.activate();

    this._keyHandler = e => { if (e.key === "Escape") this._close(false); };
    document.addEventListener("keydown", this._keyHandler);
    this._watchFilePicker();

    requestAnimationFrame(() => el.classList.add("visible"));
  }

  _buildHTML() {
    return `
    <div class="sno-backdrop"></div>
    <div class="sno-memo-wrap">
      <div class="sno-memo-inner">
        <div class="sno-layers-mount"></div>
        <div class="sno-overlay-canvas-mount"></div>
        <div class="sno-text-input-mount"></div>
      </div>
    </div>
    <div class="sno-toolbar-mount"></div>
    <div class="sno-color-picker-panel" style="display:none"></div>

    <!-- 텍스트 옵션바 -->
    <div class="sno-text-optbar" style="display:none">
      <select class="sno-txt-font">
        <option value="sans-serif">Sans</option>
        <option value="serif">Serif</option>
        <option value="monospace">Mono</option>
        <option value="'Noto Sans KR',sans-serif">한글</option>
      </select>
      <input type="number" class="sno-txt-size" value="16" min="6" max="120" style="width:50px">px
      <button class="sno-txt-btn sno-txt-bold"      title="굵게"><b>B</b></button>
      <button class="sno-txt-btn sno-txt-italic"    title="기울임"><i>I</i></button>
      <button class="sno-txt-btn sno-txt-underline" title="밑줄"><u>U</u></button>
      <div class="sno-txt-divider"></div>
      <label class="sno-txt-label">자간<input type="number" class="sno-txt-spacing"    value="0"   min="-10" max="30"  style="width:40px">px</label>
      <label class="sno-txt-label">행간<input type="number" class="sno-txt-lineheight" value="160" min="80"  max="300" style="width:44px">%</label>
      <div class="sno-txt-align-group">
        <button class="sno-txt-btn sno-txt-align active" data-align="left">≡</button>
        <button class="sno-txt-btn sno-txt-align"        data-align="center">≡</button>
        <button class="sno-txt-btn sno-txt-align"        data-align="right">≡</button>
      </div>
      <div class="sno-txt-divider"></div>
      <button class="sno-txt-commit-btn">적용</button>
      <button class="sno-txt-cancel-btn">취소</button>
    </div>

    <!-- 우측 패널 (3: 크기 2배) -->
    <div class="sno-right-panel sno-right-panel-lg">
      <div class="sno-section-header">레이어</div>
      <div class="sno-layer-list sno-layer-list-lg"></div>
      <div class="sno-layer-actions">
        <button class="sno-lp-btn sno-add-layer-btn">＋ 레이어</button>
        <button class="sno-lp-btn sno-add-image-btn">＋ 이미지</button>
      </div>
      <div class="sno-opacity-row">
        <span>불투명</span>
        <input type="range" class="sno-opacity-slider" min="0" max="100" value="100">
        <span class="sno-opacity-val">100%</span>
      </div>
      <div class="sno-section-header sno-history-header">
        실행목록 <span class="sno-hint">(Ctrl+Z)</span>
      </div>
      <div class="sno-history-list"></div>
    </div>

    <!-- 하단 바 -->
    <div class="sno-bottom-bar">
      <div class="sno-optbar-mount"></div>
      <div class="sno-zoom-controls">
        <button class="sno-zoom-btn" data-zoom="out">−</button>
        <input type="range" class="sno-zoom-slider" min="20" max="500" value="100" step="5">
        <button class="sno-zoom-btn" data-zoom="in">＋</button>
        <span class="sno-zoom-label">100%</span>
      </div>
      <div class="sno-action-btns">
        <button class="sno-btn-cancel">취소</button>
        <button class="sno-btn-done primary">✔ 완료</button>
      </div>
    </div>

    <!-- 레이어 컨텍스트 메뉴 (5번) -->
    <div class="sno-ctx-menu" style="display:none">
      <button class="sno-ctx-item" data-action="duplicate">📋 복사</button>
      <button class="sno-ctx-item" data-action="merge">⬇ 아래와 병합</button>
      <div class="sno-ctx-divider"></div>
      <button class="sno-ctx-item danger" data-action="remove">🗑 삭제</button>
    </div>`;
  }

  /* ══════════════════════════════════════════
     MEMO POSITION
  ═════════════════════════════════════════════ */
  _positionMemo() {
    const d = this.widget.data;

    // widget.el 전체가 아닌 실제 메모 본문(.snw-body) 위치를 기준으로 사용
    // DrawingOverlay의 sno-memo-inner는 레이어만 있고 상단바가 없으므로
    // snw-body의 정확한 화면 위치/크기를 읽어야 함
    const bodyEl  = this.widget.el?.querySelector(".snw-body");
    const widgetEl = this.widget.el;

    if (bodyEl) {
      const rect = bodyEl.getBoundingClientRect();
      this._memoScreenX = rect.left;
      this._memoScreenY = rect.top;
      this._memoBaseW   = rect.width;
      this._memoBaseH   = rect.height;
    } else if (widgetEl) {
      const rect = widgetEl.getBoundingClientRect();
      this._memoScreenX = rect.left;
      this._memoScreenY = rect.top;
      this._memoBaseW   = rect.width;
      this._memoBaseH   = rect.height;
    } else {
      const sc = this._canvasScale();
      const pos = this._canvasToScreen(d.x, d.y);
      this._memoScreenX = pos.x;
      this._memoScreenY = pos.y;
      this._memoBaseW   = Math.max(100, d.width  * sc);
      this._memoBaseH   = Math.max(60,  d.height * sc);
    }
    this._applyMemoTransform();
  }

  _applyMemoTransform() {
    if (!this.el) return;
    const inner = this.el.querySelector(".sno-memo-inner");
    if (!inner) return;
    // _memoBaseW/H는 이미 화면 픽셀 크기, zoom만 추가 적용
    const sw = Math.round(this._memoBaseW * this._zoom);
    const sh = Math.round(this._memoBaseH * this._zoom);
    inner.style.cssText = `
      position:fixed;left:${this._memoScreenX}px;top:${this._memoScreenY}px;
      width:${sw}px;height:${sh}px;
      box-shadow:0 0 0 2px #4a90d9,0 8px 32px rgba(0,0,0,0.5);
      border-radius:6px;overflow:visible;z-index:10002;`;
  }

  /* ══════════════════════════════════════════
     DPR 헬퍼
  ═════════════════════════════════════════════ */
  get _dpr() { return Math.max(1, Math.round(window.devicePixelRatio ?? 1)); }

  /* ══════════════════════════════════════════
     LAYER MANAGER
     canvas 크기 = data.width × data.height × DPR
     (canvasScale/줌과 무관 — 저장/로드 시 항상 동일 크기)
  ═════════════════════════════════════════════ */
  _initLayerManager() {
    const d   = this.widget.data;
    const dpr = this._dpr;
    // 논리 크기 × DPR = 실제 canvas 픽셀
    const w = Math.max(10, Math.round(d.width  * dpr));
    const h = Math.max(10, Math.round(d.height * dpr));

    this.layerMgr = new LayerManager(w, h, d.bgColor);
    this.layerMgr.onUpdate = () => {
      this._refreshLayerUI();
      this._compositeToDOM();
    };

    // 기존 drawing 레이어 로드
    // 저장은 항상 data.width×data.height 기준 PNG
    // → canvas는 w×h (= data.width×DPR × data.height×DPR)이므로
    //   drawImage로 그대로 그리면 1:1 대응
    const drawLayers = d.layers.filter(l => l.type === "drawing");
    if (drawLayers.length) {
      const src = drawLayers[0].src;
      const img = new Image();
      img.onload = () => {
        this.layerMgr.layers[1].canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        this._compositeToDOM();
        // 기존 그림 로드 완료 후 초기 스냅 저장 (Ctrl+Z 기준점)
        this.drawCanvas?.saveInitialSnap();
      };
      img.src = src;
    } else {
      this._compositeToDOM();
      // 기존 그림 없음 — 빈 상태가 초기 스냅
      this.drawCanvas?.saveInitialSnap();
    }
  }

  _compositeToDOM() {
    const mount = this.el?.querySelector(".sno-layers-mount");
    if (!mount || !this.layerMgr) return;
    mount.innerHTML = "";
    mount.style.cssText = "position:absolute;inset:0;z-index:1;pointer-events:none;";

    const sw = Math.round(this._memoBaseW * this._zoom);
    const sh = Math.round(this._memoBaseH * this._zoom);

    for (let i = 0; i < this.layerMgr.layers.length; i++) {
      const layer = this.layerMgr.layers[i];
      const wrapper = document.createElement("div");
      wrapper.dataset.layerIdx = i;
      wrapper.style.cssText = `position:absolute;inset:0;opacity:${layer.opacity??1};display:${layer.visible?"block":"none"};`;
      const c = document.createElement("canvas");
      c.width  = layer.canvas.width;
      c.height = layer.canvas.height;
      c.style.cssText = `position:absolute;top:0;left:0;width:${sw}px;height:${sh}px;`;
      c.getContext("2d").drawImage(layer.canvas, 0, 0);
      wrapper.appendChild(c);
      mount.appendChild(wrapper);
    }
  }

  /* ══════════════════════════════════════════
     DRAW CANVAS
     overlayCanvas = 노트와 동일한 canvas 픽셀(nW×nH)
     CSS 크기를 PAD 포함 확장 → 바깥 영역 이벤트 수신
     _pos에서 CSS오프셋 보정으로 노트 밖 좌표도 정확히 계산
  ═════════════════════════════════════════════ */

  _mountDrawCanvas() {
    if (!this.layerMgr) return;
    const activeCanvas = this.layerMgr.activeCanvas;
    if (!activeCanvas) return;

    const nW = activeCanvas.width;
    const nH = activeCanvas.height;
    const sw = Math.round(this._memoBaseW * this._zoom);
    const sh = Math.round(this._memoBaseH * this._zoom);

    const overlayMount = this.el.querySelector(".sno-overlay-canvas-mount");
    overlayMount.style.cssText = "position:absolute;inset:0;z-index:4;pointer-events:none;";

    this.drawCanvas = new DrawingCanvas(this._makeProxy(), nW, nH);
    this.drawCanvas.baseCanvas = activeCanvas;
    this.drawCanvas.baseCtx    = activeCanvas.getContext("2d");
    this.drawCanvas._noteOffsetX = 0;
    this.drawCanvas._noteOffsetY = 0;
    this.drawCanvas._noteW       = nW;
    this.drawCanvas._noteH       = nH;
    this.drawCanvas._cssOffsetX  = 0;
    this.drawCanvas._cssOffsetY  = 0;

    // drawCanvas, overlayCanvas 모두 노트와 동일 크기
    this.drawCanvas.drawCanvas.style.cssText = `
      position:absolute;top:0;left:0;
      width:${sw}px;height:${sh}px;pointer-events:none;`;
    this.drawCanvas.overlayCanvas.style.cssText = `
      position:absolute;top:0;left:0;
      width:${sw}px;height:${sh}px;cursor:crosshair;pointer-events:all;`;

    overlayMount.appendChild(this.drawCanvas.drawCanvas);
    overlayMount.appendChild(this.drawCanvas.overlayCanvas);
    this.drawCanvas._bindEvents();
    // saveInitialSnap은 _initLayerManager에서 그림 로드 완료 후 호출됨
    // (기존 그림 없으면 즉시, 있으면 img.onload 후)

    this.drawCanvas.onHistoryChange = () => {
      this._refreshHistoryUI();
      this._compositeToDOM();
    };
    this.drawCanvas.onColorUsed = (hex) => {
      if (this.colorPicker) { this.colorPicker._saveRecentColor(hex); this.colorPicker._renderRecent(); }
    };
  }

  /* ══ 핸들 기반 크기조절
     - 노트 크기 변경 없음 — 레이어 이미지만 스케일
     - 영역 있으면 영역 bounding box 기준
     - 실시간 미리보기 (CSS transform)
     - 적용: 실제 canvas 픽셀 스케일링
  ══ */
  _startResizeHandles() {
    this._removeResizeHandles();
    if (!this.layerMgr || !this.drawCanvas) return;

    // 영역이 있으면 영역 bounding box, 없으면 전체 레이어 크기
    const dc  = this.drawCanvas;
    const sel = dc._selectionActive && dc._selection ? dc._selection : null;

    // canvas 픽셀 기준 rect
    const cRect = sel
      ? { x: sel.x, y: sel.y, w: sel.w, h: sel.h }
      : { x: 0, y: 0, w: this.layerMgr.W, h: this.layerMgr.H };

    // CSS 픽셀 기준 (overlayCanvas 위 위치)
    const sc = this._memoBaseW * this._zoom / this.layerMgr.W; // CSS px per canvas px
    this._resizeCRect   = { ...cRect };         // canvas 좌표 기준 원본
    this._resizeCRectCur = { ...cRect };        // 드래그 중 변화값
    this._resizeOrigCanvases = this.layerMgr.layers.map(l => {
      const bak = document.createElement("canvas");
      bak.width = l.canvas.width; bak.height = l.canvas.height;
      bak.getContext("2d").drawImage(l.canvas, 0, 0);
      return bak;
    });
    this._resizeScale = sc;

    // overlay — sno-memo-inner 기준 absolute
    const inner = this.el.querySelector(".sno-memo-inner");
    if (!inner) return;

    const toCSS = (cx, cy) => ({ // canvas→CSS(inner기준)
      x: cx * sc,
      y: cy * sc,
    });

    const overlay = document.createElement("div");
    overlay.className = "sno-resize-overlay";
    overlay.style.cssText = "position:absolute;inset:0;z-index:20;pointer-events:none;overflow:visible;";
    inner.appendChild(overlay);
    this._resizeOverlay = overlay;

    // 테두리 박스 (canvas rect → CSS)
    const box = document.createElement("div");
    box.className = "sno-resize-box";
    const updateBox = () => {
      const r = this._resizeCRectCur;
      const p = toCSS(r.x, r.y);
      box.style.cssText = `
        position:absolute;
        left:${Math.round(r.x * this._resizeScale)}px;
        top:${Math.round(r.y * this._resizeScale)}px;
        width:${Math.round(r.w * this._resizeScale)}px;
        height:${Math.round(r.h * this._resizeScale)}px;
        outline:2px dashed #4a90d9;pointer-events:none;`;
    };
    updateBox();
    overlay.appendChild(box);
    this._resizeBox = box;
    this._updateResizeBox = updateBox;

    // 크기 레이블
    const sizeLabel = document.createElement("div");
    sizeLabel.style.cssText = `
      position:absolute;bottom:-24px;left:50%;transform:translateX(-50%);
      background:rgba(0,0,0,0.75);color:#fff;font-size:10px;
      padding:2px 6px;border-radius:3px;white-space:nowrap;pointer-events:none;z-index:2;`;
    sizeLabel.textContent = `${Math.round(cRect.w)} × ${Math.round(cRect.h)}`;
    box.appendChild(sizeLabel);
    this._resizeSizeLabel = sizeLabel;

    // 8개 핸들 (overlay 기준 absolute)
    const positions = [
      { id:"nw", bx:0,   by:0   },
      { id:"n",  bx:0.5, by:0   },
      { id:"ne", bx:1,   by:0   },
      { id:"e",  bx:1,   by:0.5 },
      { id:"se", bx:1,   by:1   },
      { id:"s",  bx:0.5, by:1   },
      { id:"sw", bx:0,   by:1   },
      { id:"w",  bx:0,   by:0.5 },
    ];
    const cursors = { nw:"nw-resize",n:"n-resize",ne:"ne-resize",e:"e-resize",se:"se-resize",s:"s-resize",sw:"sw-resize",w:"w-resize" };

    const updateHandlePos = (h, pos) => {
      const r  = this._resizeCRectCur;
      const sc2 = this._resizeScale;
      const hx = Math.round((r.x + r.w * pos.bx) * sc2);
      const hy = Math.round((r.y + r.h * pos.by) * sc2);
      h.style.left = (hx - 5) + "px";
      h.style.top  = (hy - 5) + "px";
    };

    positions.forEach(pos => {
      const h = document.createElement("div");
      h.style.cssText = `
        position:absolute;width:10px;height:10px;
        background:#4a90d9;border:2px solid #fff;border-radius:2px;
        cursor:${cursors[pos.id]};pointer-events:all;z-index:21;`;
      updateHandlePos(h, pos);
      h.addEventListener("mousedown", e => {
        e.preventDefault(); e.stopPropagation();
        this._doResizeDrag(e, pos, updateHandlePos, positions, sizeLabel);
      });
      overlay.appendChild(h);
      pos._el = h;
    });
    this._resizeHandlePositions = positions;
  }

  _doResizeDrag(e, pos, updateHandlePos, allPositions, sizeLabel) {
    const sc   = this._resizeScale;
    const orig = { ...this._resizeCRectCur };
    const sx = e.clientX, sy = e.clientY;

    const onMove = ev => {
      const dx = (ev.clientX - sx) / sc;  // CSS px → canvas px
      const dy = (ev.clientY - sy) / sc;
      let { x, y, w, h } = orig;

      if (pos.id.includes("e"))  { w = Math.max(10, orig.w + dx); }
      if (pos.id.includes("s"))  { h = Math.max(10, orig.h + dy); }
      if (pos.id.includes("w"))  { const nw = Math.max(10, orig.w - dx); x = orig.x + orig.w - nw; w = nw; }
      if (pos.id.includes("n"))  { const nh = Math.max(10, orig.h - dy); y = orig.y + orig.h - nh; h = nh; }

      this._resizeCRectCur = { x, y, w, h };
      this._updateResizeBox?.();
      // 핸들 위치 갱신
      allPositions.forEach(p => p._el && updateHandlePos(p._el, p));
      if (sizeLabel) sizeLabel.textContent = `${Math.round(w)} × ${Math.round(h)}`;

      // 5: 실시간 레이어 이미지 스케일링 (canvas 픽셀 직접 변경)
      this._applyResizePreview();
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup",   onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
  }

  _applyResizePreview() {
    if (!this._resizeCRect || !this._resizeCRectCur || !this.layerMgr) return;
    const orig = this._resizeCRect;
    const cur  = this._resizeCRectCur;

    // 현재 활성 레이어만 스케일
    const activeIdx = this.layerMgr._activeIdx;
    const layer     = this.layerMgr.layers[activeIdx];
    const bakCanvas = this._resizeOrigCanvases?.[activeIdx];
    if (!layer || !bakCanvas) return;

    const canvas = layer.canvas;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bakCanvas, 0, 0);  // 원본 복원
    if (orig.x !== cur.x || orig.y !== cur.y || orig.w !== cur.w || orig.h !== cur.h) {
      ctx.clearRect(orig.x, orig.y, orig.w, orig.h);
      ctx.drawImage(bakCanvas, orig.x, orig.y, orig.w, orig.h, cur.x, cur.y, cur.w, cur.h);
    }
    this.layerMgr.onUpdate?.();
  }

  _commitResizeHandles() {
    if (!this._resizeCRectCur || !this.layerMgr) return;
    // 미리보기가 이미 canvas에 적용됨 — undo 스택만 추가
    const dc = this.drawCanvas;
    if (dc) {
      dc._commitStrokeUndo("크기조절");
      dc.overlayCtx.clearRect(0, 0, dc.W, dc.H);
      if (dc._selectionActive) dc._drawSelectionOverlay();
    }
    this.layerMgr.onUpdate?.();
    this._removeResizeHandles();
  }

  _cancelResizeHandles() {
    // 원본 canvas 복원
    if (this._resizeOrigCanvases && this.layerMgr) {
      this.layerMgr.layers.forEach((l, i) => {
        if (this._resizeOrigCanvases[i]) l.canvas = this._resizeOrigCanvases[i];
      });
      this.layerMgr.onUpdate?.();
    }
    if (this.drawCanvas) {
      this.drawCanvas.overlayCtx.clearRect(0, 0, this.drawCanvas.W, this.drawCanvas.H);
      if (this.drawCanvas._selectionActive) this.drawCanvas._drawSelectionOverlay();
    }
    this._removeResizeHandles();
  }

  _removeResizeHandles() {
    this._resizeOverlay?.remove();
    this._resizeOverlay        = null;
    this._resizeBox            = null;
    this._resizeSizeLabel      = null;
    this._resizeCRect          = null;
    this._resizeCRectCur       = null;
    this._resizeScale          = null;
    this._resizeOrigCanvases   = null;
    this._resizeHandlePositions = null;
    this._updateResizeBox      = null;
  }

  /** 캔버스 크기 변경 후 drawCanvas 재마운트 */
  _remountDrawCanvas() {
    if (this.drawCanvas) {
      this.drawCanvas.destroy();
      this.drawCanvas = null;
    }
    this._mountDrawCanvas();
    this.drawCanvas?.activate();
  }

  _makeProxy() {
    return {
      _editMode: true,
      get drawCanvas() { return null; },
      onTextClick: (x, y, e) => this.onTextClick(x, y, e),
      _addDrawingLayerFromCanvas: (canvasEl, x, y) => {
        this.drawCanvas?.baseCtx.drawImage(canvasEl, x, y);
      }
    };
  }

  _switchActiveLayer(idx) {
    const layer = this.layerMgr.layers[idx];
    if (layer?.type === "text") {
      this._enterTextLayerEdit(idx);
      return;
    }
    // 4: 현재 레이어의 히스토리 저장
    if (this.drawCanvas && this.layerMgr._activeIdx !== idx) {
      const prevIdx = this.layerMgr._activeIdx;
      this._layerHistories = this._layerHistories ?? {};
      this._layerHistories[prevIdx] = {
        history   : [...(this.drawCanvas.history    ?? [])],
        undoStack : [...(this.drawCanvas._undoStack ?? [])],
      };
    }

    this.layerMgr.setActive(idx);
    const canvas = this.layerMgr.activeCanvas;
    if (!canvas || !this.drawCanvas) return;
    this.drawCanvas.baseCanvas = canvas;
    this.drawCanvas.baseCtx    = canvas.getContext("2d");
    this.drawCanvas.saveInitialSnap();

    // 4: 전환된 레이어의 히스토리 복원
    const saved = this._layerHistories?.[idx];
    if (saved) {
      this.drawCanvas.history    = [...saved.history];
      this.drawCanvas._undoStack = [...saved.undoStack];
    } else {
      this.drawCanvas.history    = [];
      this.drawCanvas._undoStack = [];
    }

    this._refreshHistoryUI();
    this._updateOpacitySlider(idx);
    this._refreshLayerUI();
  }

  _updateOpacitySlider(idx) {
    const layer = this.layerMgr.layers[idx];
    if (!layer) return;
    const opacity = Math.round((layer.opacity ?? 1) * 100);
    const slider = this.el.querySelector(".sno-opacity-slider");
    const val    = this.el.querySelector(".sno-opacity-val");
    if (slider) slider.value = opacity;
    if (val)    val.textContent = opacity + "%";
  }

  /* ══════════════════════════════════════════
     TOOLBAR
  ═════════════════════════════════════════════ */
  _mountToolbar() {
    this.toolbar = new DrawingToolbar(this);
    this.toolbar.render(this.el.querySelector(".sno-toolbar-mount"));
    this.el.querySelector(".sno-optbar-mount").appendChild(this.toolbar.optBar);
    if (this.drawCanvas) {
      this.drawCanvas.setTool(this.toolbar.activeTool, this.toolbar.opts);
      this.drawCanvas.setColor(this.toolbar.opts.color);
    }
    this._showColorPickerPanel();
    // 배경 탭 초기 선택색 설정
    this.toolbar._bgColorSelected = this.widget.data.bgColor ?? "#FFF9A0";
  }

  /** 2: 배경 색 선택 버튼 → 오른쪽에 ColorPicker 팝업 */
  _openBgColorPicker(anchorEl, onChangeCb) {
    if (this._bgPickerPopup) {
      this._bgPickerPopup.remove();
      this._bgPickerPopup = null;
      return;
    }
    const popup = document.createElement("div");
    popup.className = "sno-color-picker-panel sno-bg-picker-popup";
    popup.style.display = "";
    document.body.appendChild(popup);
    this._bgPickerPopup = popup;

    const initColor = this.toolbar._bgColorSelected ?? this.widget.data.bgColor ?? "#FFF9A0";
    this._bgColorPicker = new ColorPicker(popup, initColor, ({ hex }) => {
      this.toolbar._bgColorSelected = hex;
      onChangeCb?.(hex);  // 마지막 슬롯 실시간 업데이트
    });
    this._bgColorPicker.render();

    const rect = anchorEl?.getBoundingClientRect?.() ??
                 this.el.querySelector(".sno-toolbar-mount")?.getBoundingClientRect() ??
                 { right: 70, top: 100 };
    popup.style.left = (rect.right + 8) + "px";
    popup.style.top  = rect.top + "px";

    const onOutside = e => {
      if (!popup.contains(e.target) && !e.target.closest(".sn-bg-pick-btn")) {
        popup.remove();
        this._bgPickerPopup = null;
        document.removeEventListener("mousedown", onOutside, true);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", onOutside, true), 50);
  }

  /* ══ 회전 축점 ══ */
  _initRotatePivot() {
    this._removeRotatePivot();
    const inner = this.el?.querySelector(".sno-memo-inner");
    if (!inner || !this.layerMgr) return;

    const sw = Math.round(this._memoBaseW * this._zoom);
    const sh = Math.round(this._memoBaseH * this._zoom);

    // 초기 축점: 중앙 (CSS 픽셀, sno-memo-inner 기준)
    this._pivotCSSX = sw / 2;
    this._pivotCSSY = sh / 2;

    const dot = document.createElement("div");
    dot.className = "sno-rotate-pivot";
    dot.style.cssText = `
      position:absolute;
      left:${this._pivotCSSX - 8}px;top:${this._pivotCSSY - 8}px;
      width:16px;height:16px;border-radius:50%;
      background:rgba(74,144,217,0.9);border:2px solid #fff;
      box-shadow:0 0 4px rgba(0,0,0,0.5);
      cursor:move;pointer-events:all;z-index:25;`;

    // 축점 + 가로세로 십자선
    dot.innerHTML = `<div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:#fff;transform:translateX(-50%)"></div>
      <div style="position:absolute;top:50%;left:0;right:0;height:1px;background:#fff;transform:translateY(-50%)"></div>`;

    inner.appendChild(dot);
    this._rotatePivotDot = dot;

    // 드래그로 축점 이동
    dot.addEventListener("mousedown", e => {
      e.preventDefault(); e.stopPropagation();
      const sx = e.clientX, sy = e.clientY;
      const ox = this._pivotCSSX, oy = this._pivotCSSY;
      const onMove = ev => {
        this._pivotCSSX = Math.max(0, Math.min(sw, ox + ev.clientX - sx));
        this._pivotCSSY = Math.max(0, Math.min(sh, oy + ev.clientY - sy));
        dot.style.left = (this._pivotCSSX - 8) + "px";
        dot.style.top  = (this._pivotCSSY - 8) + "px";
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup",   onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup",   onUp);
    });
  }

  _removeRotatePivot() {
    this._rotatePivotDot?.remove();
    this._rotatePivotDot = null;
    this._pivotCSSX = null;
    this._pivotCSSY = null;
  }

  /** CSS 축점 → canvas 픽셀 축점 */
  _getPivotCanvas() {
    if (!this.layerMgr) return { px: 0.5, py: 0.5 }; // 비율 0~1
    const sw = Math.round(this._memoBaseW * this._zoom);
    const sh = Math.round(this._memoBaseH * this._zoom);
    const cx = this._pivotCSSX ?? sw / 2;
    const cy = this._pivotCSSY ?? sh / 2;
    // CSS비율 → canvas 픽셀
    return {
      px: (cx / sw) * this.layerMgr.W,
      py: (cy / sh) * this.layerMgr.H,
    };
  }

  _closeColorPicker() {
    const panel = this.el?.querySelector(".sno-color-picker-panel");
    if (panel) panel.style.display = "none";
  }

  _toggleEditPanel(btnEl) {
    // 이미 열려있으면 닫기
    if (this._editPanelOpen) {
      this._editPanelPopup?.remove();
      this._editPanelPopup = null;
      this._editPanelOpen  = false;
      this._removeRotatePivot();
      return;
    }
    this._closeColorPicker();
    this._editPanelOpen = true;

    // 편집 패널을 팝업으로 툴바 옆에 표시
    const popup = document.createElement("div");
    popup.className = "sno-color-picker-panel sno-edit-panel-popup";
    popup.style.display = "";
    document.body.appendChild(popup);
    this._editPanelPopup = popup;

    // 위치: 툴바 오른쪽
    const rect = btnEl?.getBoundingClientRect?.() ??
                 this.el?.querySelector(".sno-toolbar-mount")?.getBoundingClientRect() ??
                 { right: 70, top: 300 };
    popup.style.left = (rect.right + 8) + "px";
    popup.style.top  = rect.top + "px";

    // 팝업 HTML 직접 생성
    popup.innerHTML = this.toolbar?._buildEditHTML?.() ?? `
    <div class="sn-toolbar-header" style="padding:8px 12px;font-size:12px;font-weight:600;color:#ccc;border-bottom:1px solid #444;">편집</div>
    <div class="sn-edit-section">
      <div class="sn-edit-group-label">회전</div>
      <div class="sn-edit-btn-row">
        <button class="sn-edit-btn" data-action="rotate-ccw">↺ 90°</button>
        <button class="sn-edit-btn" data-action="rotate-cw">↻ 90°</button>
      </div>
      <div class="sn-edit-angle-row">
        <input type="range" class="sn-edit-angle-slider" min="-180" max="180" value="0">
        <span class="sn-edit-angle-val">0°</span>
      </div>
      <button class="sn-edit-apply-btn" data-action="rotate-custom">회전 적용</button>
      <div class="sn-edit-group-label">대칭</div>
      <div class="sn-edit-btn-row">
        <button class="sn-edit-btn" data-action="flip-h">↔ 좌우</button>
        <button class="sn-edit-btn" data-action="flip-v">↕ 상하</button>
      </div>
      <div class="sn-edit-group-label">크기 조절</div>
      <div class="sn-edit-size-info"></div>
      <button class="sn-edit-btn" data-action="resize-start" style="width:100%;margin-bottom:3px">⤡ 핸들로 조절</button>
      <button class="sn-edit-apply-btn sn-resize-apply" data-action="resize-apply" style="display:none">✔ 적용</button>
      <button class="sn-edit-btn sn-resize-cancel" data-action="resize-cancel" style="display:none">✕ 취소</button>
    </div>`;

    // ═══════════════════════════════════════
    // 편집 패널 이벤트
    // 모든 변환은 프리뷰 only.
    // 적용(apply-all)을 눌러야 실제 저장.
    // 취소(cancel-all)/다른도구 → 스냅샷 복원.
    // ═══════════════════════════════════════

    // 편집 시작 시 현재 레이어 스냅샷 저장
    this._editSnapCanvas = null;
    this._editPendingTransformFn = null;  // 현재 프리뷰 변환 함수
    this._editFlipH = false;
    this._editFlipV = false;
    this._editRotateDeg = 0;
    this._editRotateCCW = 0;  // 90° 단위 회전 누적 (ccw)
    this._editRotateCW  = 0;

    // ── 스냅 저장 ──────────────────────────────
    // _editSnapCanvas : 노트 크기(W×H) 원본
    // _editBigCanvas  : 3배 오버사이즈 (변환 작업용)
    //   오버사이즈 중앙(PAD~PAD+W, PAD~PAD+H)에 노트 이미지 배치
    //   변환 시 중앙 기준으로 이동/회전 → 노트 밖으로 나간 부분 보존
    //   적용 시 중앙 영역만 잘라 노트 canvas에 저장
    // ──────────────────────────────────────────

    const saveSnap = () => {
      if (!this.layerMgr) return;
      const nc = this.layerMgr.activeCanvas;
      const W  = nc.width, H = nc.height;
      const PAD = Math.max(W, H);  // 각 방향 1배씩 여유

      // 노트 크기 스냅
      const bak = document.createElement("canvas");
      bak.width = W; bak.height = H;
      bak.getContext("2d").drawImage(nc, 0, 0);
      this._editSnapCanvas = bak;

      // 오버사이즈 canvas (3W × 3H), 중앙에 노트 배치
      const big = document.createElement("canvas");
      big.width  = W + PAD * 2;
      big.height = H + PAD * 2;
      big.getContext("2d").drawImage(nc, PAD, PAD);
      this._editBigCanvas = big;
      this._editPAD = PAD;
    };
    saveSnap();

    // 5: 기본 축 = 영역 중앙 or 레이어 중앙 (오버사이즈 canvas 기준 좌표)
    const getCenter = () => {
      const lm  = this.layerMgr;
      const dc  = this.drawCanvas;
      const PAD = this._editPAD ?? 0;
      const sel = dc?._selectionActive && dc?._selection ? dc._selection : null;
      if (sel) return {
        cx: PAD + sel.x + sel.w / 2,
        cy: PAD + sel.y + sel.h / 2,
      };
      return { cx: PAD + lm.W / 2, cy: PAD + lm.H / 2 };
    };

    // 프리뷰 적용
    // 1. 오버사이즈 canvas에서 변환 수행
    // 2. 노트 canvas에 중앙 영역(노트 크기) 잘라서 반영
    const applyPreview = (transformFn) => {
      const lm  = this.layerMgr;
      const dc  = this.drawCanvas;
      if (!lm || !dc || !this._editBigCanvas) return;
      const PAD = this._editPAD;
      const W   = lm.W, H = lm.H;
      const BW  = this._editBigCanvas.width;
      const BH  = this._editBigCanvas.height;

      // 오버사이즈 canvas에서 변환
      const xfm = document.createElement("canvas");
      xfm.width = BW; xfm.height = BH;
      const xctx = xfm.getContext("2d");
      xctx.save();
      transformFn(xctx, BW, BH);
      xctx.drawImage(this._editBigCanvas, 0, 0);
      xctx.restore();

      // 노트 canvas에 반영
      const nc  = lm.activeCanvas;
      const ctx = nc.getContext("2d");
      const sel = dc._selectionActive && dc._selection ? dc._selection : null;

      ctx.clearRect(0, 0, W, H);
      if (sel) {
        // 영역 밖: 스냅 원본 유지
        ctx.drawImage(this._editSnapCanvas, 0, 0);
        // 영역 안: 오버사이즈 변환 결과의 중앙 영역에서 sel 부분만 복사
        ctx.save();
        ctx.beginPath(); ctx.rect(sel.x, sel.y, sel.w, sel.h); ctx.clip();
        ctx.clearRect(sel.x, sel.y, sel.w, sel.h);
        ctx.drawImage(xfm, PAD + sel.x, PAD + sel.y, sel.w, sel.h,
                           sel.x, sel.y, sel.w, sel.h);
        ctx.restore();
      } else {
        // 전체: 오버사이즈의 중앙 노트 영역만 잘라서 반영
        ctx.drawImage(xfm, PAD, PAD, W, H, 0, 0, W, H);
      }
      lm.onUpdate?.();
    };

    // 현재 누적 변환 빌드 및 프리뷰
    const buildAndPreview = () => {
      const { cx, cy } = getCenter();
      const flipH = this._editFlipH;
      const flipV = this._editFlipV;
      const deg   = this._editRotateDeg + (this._editRotateCCW * -90) + (this._editRotateCW * 90);
      const rad   = deg * Math.PI / 180;
      applyPreview((c, bw, bh) => {
        c.translate(cx, cy);
        if (flipH) c.scale(-1, 1);
        if (flipV) c.scale(1, -1);
        c.rotate(rad);
        c.translate(-cx, -cy);
      });
    };

    // 슬라이더 실시간 회전
    const angleSlider = popup.querySelector(".sn-edit-angle-slider");
    const angleVal    = popup.querySelector(".sn-edit-angle-val");
    angleSlider?.addEventListener("input", e => {
      this._editRotateDeg = parseFloat(e.target.value);
      if (angleVal) angleVal.textContent = e.target.value + "°";
      buildAndPreview();
    });

    // 버튼 이벤트
    popup.querySelectorAll("[data-action]").forEach(btn => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        switch (action) {
          case "rotate-ccw":
            this._editRotateCCW++;
            buildAndPreview();
            break;
          case "rotate-cw":
            this._editRotateCW++;
            buildAndPreview();
            break;
          case "flip-h":
            this._editFlipH = !this._editFlipH;
            buildAndPreview();
            break;
          case "flip-v":
            this._editFlipV = !this._editFlipV;
            buildAndPreview();
            break;
          case "resize-start":
            this._startResizeHandles();
            popup.querySelector(".sn-resize-start-btn").style.display = "none";
            break;
          case "apply-all":
            if (this._resizeCRectCur) this._commitResizeHandles();
            this.drawCanvas?._commitStrokeUndo("편집");
            saveSnap();  // 재편집 기준점 갱신 (_editBigCanvas도 재생성)
            this._editFlipH = false; this._editFlipV = false;
            this._editRotateDeg = 0; this._editRotateCCW = 0; this._editRotateCW = 0;
            if (angleSlider) angleSlider.value = "0";
            if (angleVal) angleVal.textContent = "0°";
            popup.querySelector(".sn-resize-start-btn").style.display = "";
            break;
          case "cancel-all":
            if (this._resizeCRectCur) this._cancelResizeHandles();
            if (this._editSnapCanvas && this.layerMgr) {
              const nc = this.layerMgr.activeCanvas;
              nc.getContext("2d").clearRect(0, 0, nc.width, nc.height);
              nc.getContext("2d").drawImage(this._editSnapCanvas, 0, 0);
              this.layerMgr.onUpdate?.();
            }
            this._editFlipH = false; this._editFlipV = false;
            this._editRotateDeg = 0; this._editRotateCCW = 0; this._editRotateCW = 0;
            if (angleSlider) angleSlider.value = "0";
            if (angleVal) angleVal.textContent = "0°";
            popup.querySelector(".sn-resize-start-btn").style.display = "";
            break;
        }
      });
    });

    // 현재 크기 표시
    const info = popup.querySelector(".sn-edit-size-info");
    if (info && this.layerMgr) info.textContent = `${this.layerMgr.W} × ${this.layerMgr.H} px`;

    // 편집 패널은 상시 유지
  }

  _showColorPickerPanel() {
    const panel = this.el.querySelector(".sno-color-picker-panel");
    if (!panel || this.colorPicker) return;
    panel.style.display = "";
    this.colorPicker = new ColorPicker(panel, this.toolbar?.opts.color ?? "#e05555", ({hex, alpha}) => {
      if (!this.toolbar) return;
      this.toolbar.opts.color   = hex;
      this.toolbar.opts.opacity = alpha;
      this.drawCanvas?.setColor(hex);
      this.drawCanvas?.setOpt("opacity", alpha);
      this.toolbar.updateColorDot(this.toolbar.activeTool, hex);
    });
    this.colorPicker.render();
    this._positionColorPanel();
  }

  _positionColorPanel() {
    const panel   = this.el.querySelector(".sno-color-picker-panel");
    const tbMount = this.el.querySelector(".sno-toolbar-mount");
    if (!panel || !tbMount) return;
    const tbRect = tbMount.getBoundingClientRect();
    panel.style.left = (tbRect.right + 8) + "px";
    panel.style.top  = tbRect.top + "px";
  }

  /* ══════════════════════════════════════════
     LAYER UI (3: 크기 2배, 4: 드래그, 5: 우클릭)
  ═════════════════════════════════════════════ */
  _refreshLayerUI() {
    const list = this.el?.querySelector(".sno-layer-list");
    if (!list || !this.layerMgr) return;
    const layers = this.layerMgr.layers;
    const activeIdx = this.layerMgr._activeIdx;

    list.innerHTML = [...layers].reverse().map((l, ri) => {
      const i = layers.length - 1 - ri;
      const opPct = Math.round((l.opacity ?? 1) * 100);
      const typeIcon = l.isBackground ? "🎨" : l.type === "text" ? "T" : "🖌";
      return `
      <div class="sno-layer-item ${i===activeIdx?"selected":""}" data-idx="${i}" draggable="true">
        <button class="sno-layer-eye ${l.visible?"":"off"}" data-idx="${i}">${l.visible?"👁":"🙈"}</button>
        <span class="sno-layer-icon">${typeIcon}</span>
        <span class="sno-layer-name">${l.label}</span>
        <span class="sno-layer-opacity-badge">${opPct}%</span>
      </div>`;
    }).join("");

    list.querySelectorAll(".sno-layer-item").forEach(el => {
      // 클릭 → 레이어 전환
      el.addEventListener("click", e => {
        if (e.target.closest(".sno-layer-eye")) return;
        this._switchActiveLayer(+el.dataset.idx);
      });

      // 눈 버튼
      el.querySelector(".sno-layer-eye")?.addEventListener("click", e => {
        e.stopPropagation();
        this.layerMgr.toggleVisible(+el.dataset.idx);
      });

      // 4: 드래그 순서 변경
      el.addEventListener("dragstart", e => {
        this._layerDragIdx = +el.dataset.idx;
        el.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
      });
      el.addEventListener("dragend",   () => { el.classList.remove("dragging"); this._clearLayerDragOver(); });
      el.addEventListener("dragover",  e => { e.preventDefault(); this._layerDragOver = +el.dataset.idx; this._highlightDragOver(+el.dataset.idx); });
      el.addEventListener("drop",      e => {
        e.preventDefault();
        const from = this._layerDragIdx;
        const to   = +el.dataset.idx;
        if (from !== -1 && from !== to) this.layerMgr.reorderLayer(from, to);
        this._layerDragIdx = -1; this._clearLayerDragOver();
      });

      // 5: 우클릭 컨텍스트 메뉴
      el.addEventListener("contextmenu", e => {
        e.preventDefault(); e.stopPropagation();
        this._showCtxMenu(e.clientX, e.clientY, +el.dataset.idx);
      });
    });
  }

  _highlightDragOver(idx) {
    this.el.querySelectorAll(".sno-layer-item").forEach(el => {
      el.classList.toggle("drag-over", +el.dataset.idx === idx);
    });
  }
  _clearLayerDragOver() {
    this.el?.querySelectorAll(".sno-layer-item").forEach(el => el.classList.remove("drag-over"));
  }

  /* ══ 5: 컨텍스트 메뉴 ══ */
  _showCtxMenu(x, y, layerIdx) {
    const menu = this.el.querySelector(".sno-ctx-menu");
    menu.style.display = "";
    menu.style.left = x + "px";
    menu.style.top  = y + "px";
    menu.dataset.layerIdx = layerIdx;
    // 병합 비활성화 조건
    const mergeBtn = menu.querySelector("[data-action='merge']");
    mergeBtn.disabled = layerIdx <= 1 || this.layerMgr.layers[layerIdx - 1]?.isBackground;
    this._ctxMenu = menu;
  }

  _hideCtxMenu() {
    if (this._ctxMenu) { this._ctxMenu.style.display = "none"; this._ctxMenu = null; }
  }

  /* ══════════════════════════════════════════
     HISTORY UI
  ═════════════════════════════════════════════ */
  _refreshHistoryUI() {
    const list = this.el?.querySelector(".sno-history-list");
    if (!list || !this.drawCanvas) return;
    const h = this.drawCanvas.history;
    list.innerHTML = !h.length
      ? `<div class="sno-history-empty">작업 없음</div>`
      : [...h].reverse().map((label, i) => `
          <div class="sno-history-item ${i===0?"current":""}">
            <span class="sno-history-icon">${this._iconFor(label)}</span>
            <span>${label}</span>
          </div>`).join("");
  }
  _iconFor(l) {
    return {"펜":"✒","스프레이":"💨","지우개":"⬜","직선":"╱","도형":"◻",
            "텍스트":"T","채우기":"🪣","블러":"◉","이미지":"🖼",
            "올가미":"⊙","영역선택":"⬚","이동":"✥","삭제":"🗑"}[l]??"◆";
  }

  /* ══════════════════════════════════════════
     TEXT (2, 6, 8번)
  ═════════════════════════════════════════════ */
  onTextClick(x, y, evt) {
    // 2: 이미 편집 중이면 무시
    if (this._textEditing) return;

    // 8: 기존 텍스트 레이어 클릭 감지
    const hitLayerIdx = this._hitTestTextLayer(x, y);
    if (hitLayerIdx !== -1) {
      this._enterTextLayerEdit(hitLayerIdx);
      return;
    }

    // 6: 현재 레이어가 텍스트 레이어인데 그리기 도구 사용 → 변환 다이얼로그
    const activeLayer = this.layerMgr.activeLayer;
    if (activeLayer?.type === "text" && this.toolbar?.activeTool !== TOOLS.TEXTBOX) {
      this._askRasterize();
      return;
    }

    // 새 텍스트 레이어 생성
    this._startNewTextInput(x, y);
  }

  _hitTestTextLayer(cx, cy) {
    const layers = this.layerMgr.layers;
    // 역순으로 (위 레이어 우선)
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (l.type !== "text" || !l.visible || !l.textData) continue;
      const td = l.textData;
      const lh = td.size * ((td.lineHeight ?? 160) / 100);
      const lines = (td.text ?? "").split("\n");
      const h = td.size + (lines.length - 1) * lh + 4;
      const w = Math.max(...lines.map(ln => ln.length * td.size * 0.6)) + 10;
      // 간단한 bounding box 히트 테스트
      const ax = td.align === "center" ? td.x - w/2 : td.align === "right" ? td.x - w : td.x;
      if (cx >= ax && cx <= ax + w && cy >= td.y && cy <= td.y + h) return i;
    }
    return -1;
  }

  _enterTextLayerEdit(idx) {
    // 2: 중복 방지
    if (this._textEditing) return;
    const layer = this.layerMgr.layers[idx];
    if (!layer || layer.type !== "text") return;

    this.layerMgr.setActive(idx);
    this._editingLayerIdx = idx;
    this._textEditing     = true;

    const td = layer.textData;
    // 텍스트 옵션 복원
    this._textOpts = {
      font:td.font, size:td.size, bold:td.bold, italic:td.italic,
      underline:td.underline, spacing:td.spacing, lineHeight:td.lineHeight, align:td.align,
    };
    this._showTextBar();

    // 텍스트 입력 div 표시 (기존 위치에)
    const mount = this.el.querySelector(".sno-text-input-mount");
    mount.style.cssText = "position:absolute;inset:0;z-index:10;pointer-events:none;";
    mount.querySelector(".sno-text-layer-input")?.remove();
    const sw = Math.round(this._memoBaseW * this._zoom);
    const sh = Math.round(this._memoBaseH * this._zoom);
    const dispX = Math.round(td.x * (sw / this.layerMgr.W));
    const dispY = Math.round(td.y * (sh / this.layerMgr.H));
    const color = td.color ?? this.toolbar?.opts.color ?? "#333";
    const ta = document.createElement("div");
    ta.className       = "sno-text-layer-input";
    ta.contentEditable = "true";
    ta.innerText       = td.text ?? "";
    ta.style.cssText   = `
      position:absolute;left:${dispX}px;top:${dispY}px;
      min-width:60px;min-height:${td.size*1.6}px;
      font-family:${td.font};font-size:${td.size}px;
      font-weight:${td.bold?"bold":"normal"};font-style:${td.italic?"italic":"normal"};
      text-decoration:${td.underline?"underline":"none"};
      letter-spacing:${td.spacing}px;line-height:${td.lineHeight}%;
      text-align:${td.align};color:${color};
      outline:1.5px dashed #4a90d9;padding:3px 5px;
      white-space:pre-wrap;word-break:break-word;cursor:text;pointer-events:all;`;
    mount.appendChild(ta);
    ta.focus();
    this._pendingTextEl = ta;
    this._refreshLayerUI();
  }

  _startNewTextInput(x, y) {
    if (this._textEditing) return;

    // 새 텍스트 레이어 추가
    this.layerMgr.addLayer("text", "텍스트");
    const newIdx = this.layerMgr._activeIdx;
    this._editingLayerIdx = newIdx;
    this._textEditing     = true;

    this._showTextBar();
    const mount = this.el.querySelector(".sno-text-input-mount");
    mount.style.cssText = "position:absolute;inset:0;z-index:10;pointer-events:none;";
    mount.querySelector(".sno-text-layer-input")?.remove();

    const o = this._textOpts;
    const sw = Math.round(this._memoBaseW * this._zoom);
    const sh = Math.round(this._memoBaseH * this._zoom);
    const dispX = Math.round(x * (sw / this.layerMgr.W));
    const dispY = Math.round(y * (sh / this.layerMgr.H));
    const color = this.toolbar?.opts.color ?? "#333";

    const ta = document.createElement("div");
    ta.className       = "sno-text-layer-input";
    ta.contentEditable = "true";
    ta.style.cssText   = `
      position:absolute;left:${dispX}px;top:${dispY}px;
      min-width:60px;min-height:${o.size*1.6}px;
      font-family:${o.font};font-size:${o.size}px;
      font-weight:${o.bold?"bold":"normal"};font-style:${o.italic?"italic":"normal"};
      text-decoration:${o.underline?"underline":"none"};
      letter-spacing:${o.spacing}px;line-height:${o.lineHeight}%;
      text-align:${o.align};color:${color};
      outline:1.5px dashed #4a90d9;padding:3px 5px;
      white-space:pre-wrap;word-break:break-word;cursor:text;pointer-events:all;`;
    mount.appendChild(ta);
    ta.focus();
    this._pendingTextEl = ta;
    this._refreshLayerUI();
  }

  _showTextBar() {
    const bar = this.el.querySelector(".sno-text-optbar");
    bar.style.display = "flex";
    const o = this._textOpts;
    bar.querySelector(".sno-txt-font").value = o.font;
    bar.querySelector(".sno-txt-size").value = o.size;
    bar.querySelector(".sno-txt-spacing").value    = o.spacing;
    bar.querySelector(".sno-txt-lineheight").value = o.lineHeight;
    bar.querySelector(".sno-txt-bold").classList.toggle("active",      o.bold);
    bar.querySelector(".sno-txt-italic").classList.toggle("active",    o.italic);
    bar.querySelector(".sno-txt-underline").classList.toggle("active", o.underline);
    bar.querySelectorAll(".sno-txt-align").forEach(b => b.classList.toggle("active", b.dataset.align === o.align));
  }

  _hideTextBar() {
    this.el.querySelector(".sno-text-optbar").style.display = "none";
    this._textEditing     = false;
    this._editingLayerIdx = -1;
    this._pendingTextEl   = null;
  }

  _commitTextLayer() {
    const ta  = this._pendingTextEl;
    const idx = this._editingLayerIdx;
    if (!ta) return;
    const text = ta.innerText?.trim() ?? "";
    const sw   = Math.round(this._memoBaseW * this._zoom);
    const sh   = Math.round(this._memoBaseH * this._zoom);
    const x    = parseFloat(ta.style.left)  * (this.layerMgr.W / sw);
    const y    = parseFloat(ta.style.top)   * (this.layerMgr.H / sh);

    const textData = {
      text, x, y, ...this._textOpts,
      color: this.toolbar?.opts.color ?? "#333",
      opacity: this.toolbar?.opts.opacity ?? 1,
    };

    if (text && idx >= 0) {
      this.layerMgr.updateTextLayer(idx, textData);
    } else if (!text && idx >= 0) {
      // 빈 텍스트면 레이어 삭제
      this.layerMgr.removeLayer(idx);
    }

    ta.remove();
    this._hideTextBar();
    this._compositeToDOM();
    this._refreshLayerUI();
  }

  _cancelTextLayer() {
    const ta  = this._pendingTextEl;
    const idx = this._editingLayerIdx;
    ta?.remove();
    // 새로 만든 빈 텍스트 레이어 제거
    if (idx >= 0 && this.layerMgr.layers[idx]?.type === "text" &&
        !this.layerMgr.layers[idx]?.textData?.text) {
      this.layerMgr.removeLayer(idx);
    }
    this._hideTextBar();
    this._compositeToDOM();
    this._refreshLayerUI();
  }

  _applyTextStyle() {
    const ta = this._pendingTextEl;
    if (!ta) return;
    const o = this._textOpts;
    ta.style.fontFamily    = o.font;
    ta.style.fontSize      = o.size + "px";
    ta.style.fontWeight    = o.bold    ? "bold"      : "normal";
    ta.style.fontStyle     = o.italic  ? "italic"    : "normal";
    ta.style.textDecoration = o.underline ? "underline" : "none";
    ta.style.letterSpacing = o.spacing + "px";
    ta.style.lineHeight    = o.lineHeight + "%";
    ta.style.textAlign     = o.align;
  }

  /* ══ 6: 텍스트→이미지 변환 다이얼로그 ══ */
  async _askRasterize() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "텍스트 레이어" },
      content: `<p>이 레이어는 텍스트 레이어입니다.<br>이미지 레이어로 변환해야 그리기가 가능합니다.<br><br>변환하시겠습니까?</p>`,
    });
    if (!ok) return;
    this.layerMgr.rasterizeTextLayer(this.layerMgr._activeIdx);
    this._refreshLayerUI();
    ui.notifications?.info("이미지 레이어로 변환되었습니다.");
  }

  /* ══════════════════════════════════════════
     EVENTS
  ═════════════════════════════════════════════ */
  _attachEvents() {
    const el = this.el;
    el.querySelector(".sno-btn-done").addEventListener("click",   () => this._close(true));
    el.querySelector(".sno-btn-cancel").addEventListener("click", () => this._close(false));

    // 줌
    el.querySelector(".sno-zoom-controls").addEventListener("click", e => {
      const btn = e.target.closest(".sno-zoom-btn");
      if (btn) this._setZoom(btn.dataset.zoom==="in" ? this._zoom*1.2 : this._zoom/1.2);
    });
    el.querySelector(".sno-zoom-slider").addEventListener("input", e => this._setZoom(+e.target.value/100));
    el.addEventListener("wheel", e => {
      if (e.target.closest(".sno-right-panel")||e.target.closest(".sno-text-optbar")||e.target.closest(".sno-color-picker-panel")) return;
      e.preventDefault();
      this._setZoom(this._zoom*(e.deltaY>0?0.9:1.1));
    }, { passive:false });

    // 우클릭 드래그 — 메모 이동
    el.addEventListener("mousedown", e => { if (e.button===2) { e.preventDefault(); this._startPan(e); } });
    el.addEventListener("contextmenu", e => {
      // 레이어 아이템이면 허용(위에서 처리), 아니면 차단
      if (!e.target.closest(".sno-layer-item")) e.preventDefault();
    });

    // 레이어 추가
    el.querySelector(".sno-add-layer-btn").addEventListener("click", () => {
      this.layerMgr.addLayer("image");
      this._switchActiveLayer(this.layerMgr._activeIdx);
      this._compositeToDOM();
    });
    el.querySelector(".sno-add-image-btn").addEventListener("click", () => this._addImageToCanvas());

    // 불투명도
    el.querySelector(".sno-opacity-slider").addEventListener("input", e => {
      const opacity = +e.target.value/100;
      el.querySelector(".sno-opacity-val").textContent = e.target.value+"%";
      const layer = this.layerMgr?.activeLayer;
      if (layer) {
        layer.opacity = opacity;
        const wrapper = el.querySelector(`.sno-layers-mount [data-layer-idx="${this.layerMgr._activeIdx}"]`);
        if (wrapper) wrapper.style.opacity = opacity;
      }
    });

    // 메모 좌클릭 드래그
    el.querySelector(".sno-memo-inner").addEventListener("mousedown", e => {
      if (e.target.closest(".sno-overlay-canvas-mount")) return;
      if (e.target.closest(".sno-text-input-mount")) return;
      if (e.button===0) this._startMemoDrag(e);
    });

    // 컨텍스트 메뉴 액션
    el.querySelector(".sno-ctx-menu").addEventListener("click", e => {
      const btn = e.target.closest(".sno-ctx-item");
      if (!btn) return;
      const idx = +this._ctxMenu.dataset.layerIdx;
      switch(btn.dataset.action) {
        case "duplicate": this.layerMgr.duplicateLayer(idx); break;
        case "merge":     this.layerMgr.mergeDown(idx); break;
        case "remove":    this.layerMgr.removeLayer(idx); break;
      }
      this._hideCtxMenu();
    });

    // 바깥 클릭 → 컨텍스트 메뉴 닫기
    document.addEventListener("mousedown", this._outsideClickHandler = e => {
      if (this._ctxMenu && !this._ctxMenu.contains(e.target)) this._hideCtxMenu();
    }, true);

    // 텍스트 옵션바
    this._attachTextBarEvents();

    // 드롭
    el.querySelector(".sno-memo-inner").addEventListener("dragover", e => {
      if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); e.stopPropagation(); }
    });
    el.querySelector(".sno-memo-inner").addEventListener("drop", async e => {
      e.preventDefault(); e.stopPropagation();
      const files = [...e.dataTransfer.files].filter(f=>f.type.startsWith("image/"));
      for (const file of files) {
        const r = await ImageImporter.fromFile(file);
        if (r) this._drawImageOnCanvas(r);
      }
    });
  }

  _attachTextBarEvents() {
    const bar = this.el.querySelector(".sno-text-optbar");
    bar.querySelector(".sno-txt-font").addEventListener("change", e => { this._textOpts.font=e.target.value; this._applyTextStyle(); });
    bar.querySelector(".sno-txt-size").addEventListener("change", e => { this._textOpts.size=+e.target.value; this._applyTextStyle(); });
    ["bold","italic","underline"].forEach(p => {
      bar.querySelector(`.sno-txt-${p}`).addEventListener("click", () => {
        this._textOpts[p]=!this._textOpts[p];
        bar.querySelector(`.sno-txt-${p}`).classList.toggle("active",this._textOpts[p]);
        this._applyTextStyle();
      });
    });
    bar.querySelector(".sno-txt-spacing").addEventListener("change",    e => { this._textOpts.spacing=+e.target.value;    this._applyTextStyle(); });
    bar.querySelector(".sno-txt-lineheight").addEventListener("change", e => { this._textOpts.lineHeight=+e.target.value; this._applyTextStyle(); });
    bar.querySelectorAll(".sno-txt-align").forEach(btn => {
      btn.addEventListener("click", () => {
        this._textOpts.align=btn.dataset.align;
        bar.querySelectorAll(".sno-txt-align").forEach(b=>b.classList.remove("active"));
        btn.classList.add("active"); this._applyTextStyle();
      });
    });
    bar.querySelector(".sno-txt-commit-btn").addEventListener("click", () => this._commitTextLayer());
    bar.querySelector(".sno-txt-cancel-btn").addEventListener("click", () => this._cancelTextLayer());
  }

  /* ══ ZOOM / PAN ══ */
  _setZoom(z) {
    this._zoom = Math.max(this._MIN_ZOOM, Math.min(this._MAX_ZOOM, z));
    this._applyMemoTransform();
    this._compositeToDOM();
    this._resizeOverlayMount(); // 무한 캔버스 크기 갱신
    const pct = Math.round(this._zoom*100);
    this.el.querySelector(".sno-zoom-slider").value = pct;
    this.el.querySelector(".sno-zoom-label").textContent = pct+"%";
    this._positionColorPanel();
  }

  /** 줌 변경 시 overlayMount + drawCanvas CSS 크기 갱신 */
  _resizeOverlayMount() {
    if (!this.drawCanvas) return;
    const sw = Math.round(this._memoBaseW * this._zoom);
    const sh = Math.round(this._memoBaseH * this._zoom);
    this.drawCanvas.drawCanvas.style.width    = `${sw}px`;
    this.drawCanvas.drawCanvas.style.height   = `${sh}px`;
    this.drawCanvas.overlayCanvas.style.width  = `${sw}px`;
    this.drawCanvas.overlayCanvas.style.height = `${sh}px`;
  }

  _startPan(e) {
    const sx=e.clientX, sy=e.clientY, ox=this._memoScreenX, oy=this._memoScreenY;
    const onMove=ev=>{this._memoScreenX=ox+(ev.clientX-sx);this._memoScreenY=oy+(ev.clientY-sy);this._applyMemoTransform();};
    const onUp=()=>{document.removeEventListener("mousemove",onMove);document.removeEventListener("mouseup",onUp);};
    document.addEventListener("mousemove",onMove);document.addEventListener("mouseup",onUp);
  }

  _startMemoDrag(e) {
    e.preventDefault();
    const sx=e.clientX, sy=e.clientY, ox=this._memoScreenX, oy=this._memoScreenY;
    const onMove=ev=>{this._memoScreenX=ox+(ev.clientX-sx);this._memoScreenY=oy+(ev.clientY-sy);this._applyMemoTransform();};
    const onUp=()=>{document.removeEventListener("mousemove",onMove);document.removeEventListener("mouseup",onUp);};
    document.addEventListener("mousemove",onMove);document.addEventListener("mouseup",onUp);
  }

  /* ══ IMAGE — 드래그&드롭 다이얼로그 ══ */
  _addImageToCanvas() {
    // 이미 열려있으면 닫기
    if (this._imgDialog) {
      this._imgDialog.remove();
      this._imgDialog = null;
      return;
    }

    const dialog = document.createElement("div");
    dialog.className = "sno-img-dialog";
    dialog.innerHTML = `
      <div class="sno-img-dialog-header">
        <span>이미지 추가</span>
        <button class="sno-img-dialog-close">✕</button>
      </div>
      <div class="sno-img-dropzone" id="sno-img-dropzone">
        <div class="sno-img-dropzone-hint">
          <span style="font-size:32px">🖼</span><br>
          이미지를 여기에 드래그하세요
        </div>
      </div>
      <div class="sno-img-preview-wrap" style="display:none">
        <div class="sno-img-preview-container">
          <img class="sno-img-preview-img" draggable="false">
          <div class="sno-img-resize-handle"></div>
        </div>
        <div class="sno-img-size-info"></div>
      </div>
      <div class="sno-img-dialog-actions" style="display:none">
        <button class="sno-img-cancel-btn">취소</button>
        <button class="sno-img-apply-btn primary">적용</button>
      </div>
    `;
    document.body.appendChild(dialog);
    this._imgDialog = dialog;

    // 위치 — 그리기 오버레이 중앙
    const overlayRect = this.el?.getBoundingClientRect?.() ?? { left: 200, top: 200, width: 800, height: 600 };
    dialog.style.left = (overlayRect.left + (overlayRect.width - 340) / 2) + "px";
    dialog.style.top  = (overlayRect.top  + (overlayRect.height - 400) / 2) + "px";

    let _pendingSrc = null, _naturalW = 0, _naturalH = 0;
    let _dispW = 0, _dispH = 0;

    const dropzone   = dialog.querySelector("#sno-img-dropzone");
    const previewWrap = dialog.querySelector(".sno-img-preview-wrap");
    const previewImg  = dialog.querySelector(".sno-img-preview-img");
    const sizeInfo    = dialog.querySelector(".sno-img-size-info");
    const actions     = dialog.querySelector(".sno-img-dialog-actions");
    const resizeHandle = dialog.querySelector(".sno-img-resize-handle");

    const showPreview = (src, nw, nh) => {
      _pendingSrc = src; _naturalW = nw; _naturalH = nh;
      // 최대 240×240으로 초기 표시
      const ratio = Math.min(240/nw, 240/nh, 1);
      _dispW = Math.round(nw * ratio);
      _dispH = Math.round(nh * ratio);
      previewImg.src = src;
      previewImg.style.width  = _dispW + "px";
      previewImg.style.height = _dispH + "px";
      sizeInfo.textContent = `${_dispW} × ${_dispH} px`;
      dropzone.style.display    = "none";
      previewWrap.style.display = "";
      actions.style.display     = "";
    };

    // 드래그&드롭
    dropzone.addEventListener("dragover",  e => { e.preventDefault(); dropzone.classList.add("hover"); });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("hover"));
    dropzone.addEventListener("drop", async e => {
      e.preventDefault(); dropzone.classList.remove("hover");
      const file = [...e.dataTransfer.files].find(f => f.type.startsWith("image/"));
      if (!file) return;
      const r = await ImageImporter.fromFile(file);
      if (r) showPreview(r.src, r.w, r.h);
    });

    // 리사이즈 핸들 드래그
    let _rsStartX = 0, _rsStartY = 0, _rsStartW = 0, _rsStartH = 0;
    resizeHandle.addEventListener("mousedown", e => {
      e.preventDefault(); e.stopPropagation();
      _rsStartX = e.clientX; _rsStartY = e.clientY;
      _rsStartW = _dispW;    _rsStartH = _dispH;
      const onMove = ev => {
        const dx = ev.clientX - _rsStartX;
        const dy = ev.clientY - _rsStartY;
        const aspect = _naturalW / _naturalH;
        // 비율 유지 (가로 기준)
        _dispW = Math.max(40, _rsStartW + dx);
        _dispH = Math.round(_dispW / aspect);
        previewImg.style.width  = _dispW + "px";
        previewImg.style.height = _dispH + "px";
        sizeInfo.textContent = `${_dispW} × ${_dispH} px`;
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup",   onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup",   onUp);
    });

    // 닫기
    const closeDialog = () => {
      dialog.remove();
      this._imgDialog = null;
    };
    dialog.querySelector(".sno-img-dialog-close").addEventListener("click", closeDialog);
    dialog.querySelector(".sno-img-cancel-btn")?.addEventListener("click", closeDialog);

    // 적용
    dialog.querySelector(".sno-img-apply-btn")?.addEventListener("click", () => {
      if (!_pendingSrc) return;
      // dispW/H는 화면 CSS 픽셀 → LayerManager canvas 픽셀로 변환
      const scaleRatio = this.layerMgr.W / (this._memoBaseW * this._zoom);
      const cW = Math.round(_dispW * scaleRatio);
      const cH = Math.round(_dispH * scaleRatio);
      const cx = Math.round((this.layerMgr.W - cW) / 2);
      const cy = Math.round((this.layerMgr.H - cH) / 2);
      this._drawImageOnCanvas({ src: _pendingSrc, w: _naturalW, h: _naturalH, destW: cW, destH: cH, destX: cx, destY: cy });
      closeDialog();
    });

    // 다이얼로그 드래그 이동
    const header = dialog.querySelector(".sno-img-dialog-header");
    header.style.cursor = "grab";
    header.addEventListener("mousedown", e => {
      if (e.target.closest(".sno-img-dialog-close")) return;
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY;
      const ox = parseInt(dialog.style.left), oy = parseInt(dialog.style.top);
      const onMove = ev => {
        dialog.style.left = (ox + ev.clientX - sx) + "px";
        dialog.style.top  = (oy + ev.clientY - sy) + "px";
      };
      const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup",   onUp);
    });
  }

  _drawImageOnCanvas({ src, w, h, destW, destH, destX, destY }) {
    if (!this.drawCanvas) return;
    const cw = this.layerMgr.W, ch = this.layerMgr.H;
    const dw = destW ?? Math.round(Math.min((cw*0.8)/w, (ch*0.8)/h, 1) * w);
    const dh = destH ?? Math.round(Math.min((cw*0.8)/w, (ch*0.8)/h, 1) * h);
    const dx = destX ?? Math.round((cw-dw)/2);
    const dy = destY ?? Math.round((ch-dh)/2);
    const img = new Image();
    img.onload = () => {
      this.drawCanvas.baseCtx.drawImage(img, dx, dy, dw, dh);
      this.drawCanvas._commitStrokeUndo("이미지");
      this._compositeToDOM();
    };
    img.src = src;
  }

  _watchFilePicker() {
    // FilePicker 미사용 — 드래그&드롭 다이얼로그로 대체됨
    this._fpObserver = null;
  }

  /* ══ CLOSE ══ */
  async _close(commit) {
    // 즉시 비활성화 — Ctrl+Z 등 키 이벤트 차단 해제
    if (this.drawCanvas) this.drawCanvas.deactivate();

    if (commit && this.layerMgr) {
      const dataUrl = this.layerMgr.flatten();
      await this.widget.commitDrawingLayer(dataUrl, this.layerMgr.W, this.layerMgr.H);
    }
    this._fpObserver?.disconnect();
    document.removeEventListener("mousedown", this._outsideClickHandler, true);
    if (this._bgPickerPopup)  { this._bgPickerPopup.remove();  this._bgPickerPopup  = null; }
    if (this._imgDialog)      { this._imgDialog.remove();      this._imgDialog      = null; }
    if (this._editPanelPopup) { this._editPanelPopup.remove(); this._editPanelPopup = null; }
    this._removeRotatePivot();
    this._removeResizeHandles();
    if (this.drawCanvas) { this.drawCanvas.destroy(); this.drawCanvas = null; }
    document.removeEventListener("keydown", this._keyHandler);
    this.el.classList.remove("visible");
    setTimeout(() => { this.el?.remove(); this.el = null; }, 220);
    DrawingOverlay._instance = null;
  }

  /* ══ HELPERS ══ */
  _canvasScale()       { return canvas?.stage?.transform?.worldTransform?.a??1; }
  _canvasToScreen(cx,cy) {
    if(!canvas?.stage) return{x:cx,y:cy};
    const wt=canvas.stage.transform.worldTransform;
    const domEl=document.getElementById("board")??document.querySelector("canvas");
    const rect=domEl?.getBoundingClientRect?.()??{left:0,top:0};
    return{x:cx*wt.a+cy*wt.c+wt.tx+rect.left,y:cx*wt.b+cy*wt.d+wt.ty+rect.top};
  }
}
