/**
 * sticky-notes / StickyNoteWidget.mjs  (v3)
 *
 * 구조:
 *  - 기본 상태: 메모 표시. 본문 클릭 → 텍스트 입력창 팝업 (엔터=확정, Esc=취소)
 *  - 상단바 버튼: [텍스트설정⚙] [그리기도구✏] [✕]
 *  - 텍스트설정: 드롭다운 (배경색/글씨색/글자크기)
 *  - 그리기도구: DrawingOverlay 전체화면 모드 진입
 */

import { StickyNoteStore }   from "./StickyNoteStore.mjs";
import { StickyNoteManager } from "./StickyNoteManager.mjs";
import { DrawingOverlay }    from "./DrawingOverlay.mjs";
import { ImageImporter }     from "./ImageImporter.mjs";

const MODULE_ID = "sticky-notes-jcg";

export class StickyNoteWidget {

  constructor(data) {
    this.data = data;
    this.el   = null;
    this._textSettingsOpen = false;
    this._outsideClick     = null;
  }

  /* ══════════════════════════════════════════
     RENDER
  ═════════════════════════════════════════════ */
  render(container) {
    if (this.el) this.el.remove();
    const el = document.createElement("div");
    el.className  = "sticky-note-widget";
    el.dataset.id = this.data.id;
    el.style.backgroundColor = (this.data.bgColor === 'transparent' || this.data.bgColor === 'rgba(0,0,0,0)') ? 'transparent' : (this.data.bgColor || '#FFF9A0');
    el.innerHTML = this._buildHTML();
    this.el = el;
    container.appendChild(el);
    this._attachEvents();
    return el;
  }

  _buildHTML() {
    const d = this.data;
    return `
    <!-- 상단바 -->
    <div class="snw-topbar">
      <span class="snw-title">📝 메모</span>
      <div class="snw-topbar-buttons">
        <button class="snw-btn snw-btn-textsettings" title="텍스트 설정">⚙</button>
        <button class="snw-btn snw-btn-draw"         title="그리기 도구">✏</button>
        <button class="snw-btn snw-btn-close"        title="삭제">✕</button>
      </div>
    </div>

    <!-- 텍스트 설정 드롭다운 -->
    <div class="snw-text-settings-panel">
      <label class="snw-ts-color-label">배경색
        <div class="snw-ts-bg-preview-wrap">
          <div class="snw-ts-bg-checker"></div>
          <div class="snw-ts-bg-preview" style="background:${d.bgColor ?? '#FFF9A0'}"></div>
        </div>
        <button class="snw-ts-bg-pick-btn" title="색 선택">🎨</button>
      </label>
      <label>글씨색<input type="color" class="snw-text-color" value="${d.textColor}"></label>
      <label>크기<input type="number" class="snw-font-size" value="${d.fontSize}" min="8" max="72" style="width:46px"></label>
      <div class="snw-ts-row">
        <button class="snw-ts-btn primary snw-ts-apply">적용</button>
        <button class="snw-ts-btn snw-ts-cancel">취소</button>
      </div>
    </div>

    <!-- 메모 본문 -->
    <div class="snw-body">
      <!-- 저장된 이미지/드로잉 레이어들 -->
      ${d.layers.map(l => this._imgLayerHTML(l)).join("")}

      <!-- 텍스트 표시 레이어 (읽기 전용) -->
      <div class="snw-text-display"
           style="font-size:${d.fontSize}px;color:${d.textColor};"
      >${this._esc(d.text)}</div>

      <!-- 클릭 유도 힌트 (텍스트 없을 때만) -->
      ${!d.text ? `<div class="snw-empty-hint">클릭해서 메모 입력</div>` : ""}

      <!-- 리사이즈 핸들 -->
      <div class="snw-resize-handle"></div>
    </div>`;
  }

  _imgLayerHTML(layer) {
    // drawing 레이어는 항상 snw-body 전체를 채움 (좌표계 독립)
    if (layer.type === "drawing") {
      return `<div class="snw-image-layer" data-layer-id="${layer.id}"
        style="left:0;top:0;width:100%;height:100%;opacity:${layer.opacity};">
        <img src="${layer.src}" draggable="false"
             style="width:100%;height:100%;object-fit:fill;">
      </div>`;
    }
    return `<div class="snw-image-layer" data-layer-id="${layer.id}"
      style="left:${layer.x}px;top:${layer.y}px;
             width:${layer.width}px;height:${layer.height}px;
             opacity:${layer.opacity};">
      <img src="${layer.src}" draggable="false"
           style="width:100%;height:100%;object-fit:contain;">
    </div>`;
  }

  /* ══════════════════════════════════════════
     EVENTS
  ═════════════════════════════════════════════ */
  _attachEvents() {
    const el = this.el;

    // 상단바 드래그
    el.querySelector(".snw-topbar").addEventListener("mousedown", e => {
      if (e.target.closest(".snw-btn")) return;
      this._startDrag(e);
    });

    // 리사이즈
    el.querySelector(".snw-resize-handle").addEventListener("mousedown", e => {
      e.stopPropagation();
      this._startResize(e);
    });

    // 버튼들
    el.querySelector(".snw-btn-textsettings").addEventListener("click", e => {
      e.stopPropagation();
      this._toggleTextSettings();
    });
    el.querySelector(".snw-btn-draw").addEventListener("click", () => {
      this._openDrawingOverlay();
    });
    el.querySelector(".snw-btn-close").addEventListener("click", () => {
      this._confirmDelete();
    });

    // 배경색 ColorPicker 팝업
    el.querySelector(".snw-ts-bg-pick-btn")?.addEventListener("click", e => {
      e.stopPropagation();
      this._openBgColorPicker(e.currentTarget);
    });

    // 텍스트 설정 적용/취소
    el.querySelector(".snw-ts-apply").addEventListener("click",  () => this._applyTextSettings());
    el.querySelector(".snw-ts-cancel").addEventListener("click", () => this._closeTextSettings());

    // 본문 클릭 → 텍스트 입력
    el.querySelector(".snw-body").addEventListener("click", e => {
      if (e.target.closest(".snw-resize-handle")) return;
      if (e.target.closest(".snw-image-layer")) return;
      this._openTextInput();
    });

    // 바깥 클릭 → 설정 닫기
    this._outsideClick = (e) => {
      if (!el.contains(e.target)) this._closeTextSettings();
    };
    document.addEventListener("click", this._outsideClick, true);

    // 드래그드롭 이미지
    this._activateDropZone();
    this._activateClipboardPaste();
  }

  /* ══════════════════════════════════════════
     DRAG / RESIZE
  ═════════════════════════════════════════════ */
  _startDrag(e) {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const ox = this.data.x, oy = this.data.y;
    const onMove = ev => {
      const sc = StickyNoteManager.scale;
      this.data.x = ox + (ev.clientX - sx) / sc;
      this.data.y = oy + (ev.clientY - sy) / sc;
      StickyNoteManager.applyScreenPos(this);
    };
    const onUp = async () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup",   onUp);
      await StickyNoteManager.requestUpdate(this.data.id, { x: this.data.x, y: this.data.y });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
  }

  _startResize(e) {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const ow = this.data.width, oh = this.data.height;
    const onMove = ev => {
      const sc = StickyNoteManager.scale;
      this.data.width  = Math.max(120, ow + (ev.clientX - sx) / sc);
      this.data.height = Math.max(80,  oh + (ev.clientY - sy) / sc);
      StickyNoteManager.applyScreenPos(this);
    };
    const onUp = async () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup",   onUp);
      await StickyNoteManager.requestUpdate(this.data.id, { width: this.data.width, height: this.data.height });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
  }

  /* ══════════════════════════════════════════
     TEXT INPUT (클릭 → 팝업 입력창)
  ═════════════════════════════════════════════ */
  _openTextInput() {
    if (this.el.querySelector(".snw-text-input-overlay")) return; // 이미 열려있음

    const overlay = document.createElement("div");
    overlay.className = "snw-text-input-overlay";

    const textarea = document.createElement("textarea");
    textarea.className   = "snw-text-textarea";
    textarea.value       = this.data.text;
    textarea.placeholder = "메모를 입력하세요…";
    textarea.style.cssText = `
      font-size:${this.data.fontSize}px;
      color:${this.data.textColor};
    `;

    const hint = document.createElement("div");
    hint.className   = "snw-text-input-hint";
    hint.textContent = "Enter 확정 · Shift+Enter 줄바꿈 · Esc 취소";

    overlay.appendChild(textarea);
    overlay.appendChild(hint);
    this.el.querySelector(".snw-body").appendChild(overlay);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    const commit = async () => {
      const text = textarea.value;
      overlay.remove();
      if (text === this.data.text) return;
      this.data.text = text;
      this._refreshTextDisplay();
      await StickyNoteManager.requestUpdate(this.data.id, { text });
    };

    textarea.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
      if (e.key === "Escape") { overlay.remove(); }
    });

    // 오버레이 바깥 클릭 → 확정
    setTimeout(() => {
      const onOutside = (e) => {
        if (!overlay.contains(e.target)) {
          document.removeEventListener("mousedown", onOutside, true);
          commit();
        }
      };
      document.addEventListener("mousedown", onOutside, true);
    }, 50);
  }

  _refreshTextDisplay() {
    const display = this.el.querySelector(".snw-text-display");
    if (display) display.innerHTML = this._esc(this.data.text);
    // 빈 힌트 처리
    const hint = this.el.querySelector(".snw-empty-hint");
    if (hint) hint.style.display = this.data.text ? "none" : "";
  }

  /* ══════════════════════════════════════════
     TEXT SETTINGS
  ═════════════════════════════════════════════ */
  _toggleTextSettings() {
    this._textSettingsOpen ? this._closeTextSettings() : this._openTextSettings();
  }
  _openTextSettings() {
    this._textSettingsOpen = true;
    this.el.querySelector(".snw-text-settings-panel").classList.add("visible");
  }
  _closeTextSettings() {
    this._textSettingsOpen = false;
    this.el?.querySelector(".snw-text-settings-panel")?.classList.remove("visible");
  }

  _openBgColorPicker(anchorEl) {
    // 이미 열려있으면 닫기
    if (this._bgPickerPopup) {
      this._bgPickerPopup.remove();
      this._bgPickerPopup = null;
      return;
    }

    const { ColorPicker } = globalThis.__stickyNotesModules ?? {};
    // ColorPicker를 동적으로 import
    import("./ColorPicker.mjs").then(({ ColorPicker }) => {
      const popup = document.createElement("div");
      popup.className = "sno-color-picker-panel";
      popup.style.cssText = "position:fixed;z-index:20010;display:block;";
      document.body.appendChild(popup);
      this._bgPickerPopup = popup;

      this._selectedBgColor = this.data.bgColor ?? "#FFF9A0";

      const picker = new ColorPicker(popup, this._selectedBgColor, ({ hex, alpha, rgba }) => {
        this._selectedBgColor = alpha < 1 ? `rgba(${Math.round(parseInt(hex.slice(1,3),16))},${Math.round(parseInt(hex.slice(3,5),16))},${Math.round(parseInt(hex.slice(5,7),16))},${alpha})` : hex;
        // 미리보기 업데이트
        const preview = this.el?.querySelector(".snw-ts-bg-preview");
        if (preview) preview.style.background = this._selectedBgColor;
      });
      picker.render();

      // 위치
      const rect = anchorEl.getBoundingClientRect();
      popup.style.left = (rect.right + 8) + "px";
      popup.style.top  = rect.top + "px";

      // 바깥 클릭 닫기
      const onOutside = e => {
        if (!popup.contains(e.target) && !anchorEl.contains(e.target)) {
          popup.remove(); this._bgPickerPopup = null;
          document.removeEventListener("mousedown", onOutside, true);
        }
      };
      setTimeout(() => document.addEventListener("mousedown", onOutside, true), 50);
    });
  }

  async _applyTextSettings() {
    const bg = this._selectedBgColor ?? this.data.bgColor ?? "#FFF9A0";
    const tc = this.el.querySelector(".snw-text-color").value;
    const fs = parseInt(this.el.querySelector(".snw-font-size").value, 10);

    this.data.bgColor   = bg;
    this.data.textColor = tc;
    this.data.fontSize  = fs;

    const isTransparent = bg === "transparent" || bg === "rgba(0,0,0,0)";
    this.el.style.backgroundColor = isTransparent ? "transparent" : bg;
    const display = this.el.querySelector(".snw-text-display");
    if (display) { display.style.color = tc; display.style.fontSize = fs + "px"; }

    await StickyNoteManager.requestUpdate(this.data.id, { bgColor: bg, textColor: tc, fontSize: fs });
    this._closeTextSettings();
  }

  /* ══════════════════════════════════════════
     DRAWING OVERLAY (전체화면 그리기 모드)
  ═════════════════════════════════════════════ */
  _openDrawingOverlay() {
    DrawingOverlay.open(this);
  }

  /** DrawingOverlay 완료 후 호출.
   *  dataUrl은 LayerManager 픽셀 크기(data.width×DPR × data.height×DPR).
   *  저장은 항상 data.width × data.height 기준 PNG로 정규화.
   */
  async commitDrawingLayer(dataUrl, w, h) {
    const targetW = Math.round(this.data.width);
    const targetH = Math.round(this.data.height);

    // DPR 역변환: LayerManager 픽셀(w×h) → 논리 크기(targetW×targetH)
    const normalizedUrl = await new Promise(res => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width  = targetW;
        c.height = targetH;
        c.getContext("2d").drawImage(img, 0, 0, targetW, targetH);
        res(c.toDataURL("image/png"));
      };
      img.onerror = () => res(dataUrl);
      img.src = dataUrl;
    });

    // 기존 drawing 레이어 교체 (단일 유지)
    this.data.layers = this.data.layers.filter(l => l.type !== "drawing");
    this.data.layers.push({
      id     : foundry.utils.randomID(8),
      type   : "drawing",
      src    : normalizedUrl,
      x:0, y:0,
      width  : targetW,
      height : targetH,
      opacity: 1,
    });
    this._rerenderImageLayers();
    await StickyNoteManager.requestUpdate(this.data.id, { layers: this.data.layers });
  }

  /* ══════════════════════════════════════════
     IMAGE LAYERS (드래그드롭 / 클립보드)
  ═════════════════════════════════════════════ */
  async _addImageLayerFromSrc(src, naturalW = 0, naturalH = 0) {
    const bodyW = this.el.querySelector(".snw-body").offsetWidth  || this.data.width;
    const bodyH = this.el.querySelector(".snw-body").offsetHeight || this.data.height - 39;
    let w = naturalW || bodyW * 0.8;
    let h = naturalH || bodyH * 0.8;
    const maxW = bodyW * 0.85, maxH = bodyH * 0.85;
    if (w > maxW || h > maxH) {
      const ratio = Math.min(maxW / w, maxH / h);
      w *= ratio; h *= ratio;
    }
    const layer = {
      id: foundry.utils.randomID(8), type: "image", src,
      x: Math.round((bodyW - w) / 2), y: Math.round((bodyH - h) / 2),
      width: Math.round(w), height: Math.round(h), opacity: 1,
    };
    this.data.layers.push(layer);
    this._rerenderImageLayers();
    await StickyNoteManager.requestUpdate(this.data.id, { layers: this.data.layers });
    this._showToast(`이미지 추가 (${Math.round(w)}×${Math.round(h)})`);
  }

  _rerenderImageLayers() {
    this.el.querySelectorAll(".snw-image-layer").forEach(e => e.remove());
    const resize = this.el.querySelector(".snw-resize-handle");
    this.data.layers.forEach(l => {
      const tmp = document.createElement("template");
      tmp.innerHTML = this._imgLayerHTML(l).trim();
      resize.before(tmp.content.firstChild);
    });
  }

  _activateDropZone() {
    const body = this.el.querySelector(".snw-body");
    this._onDragOver = e => {
      if (![...e.dataTransfer.types].includes("Files")) return;
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      body.classList.add("drop-hover");
    };
    this._onDragLeave = e => {
      if (!body.contains(e.relatedTarget)) body.classList.remove("drop-hover");
    };
    this._onDrop = async e => {
      e.preventDefault(); e.stopPropagation();
      body.classList.remove("drop-hover");
      const files = [...e.dataTransfer.files].filter(f => f.type.startsWith("image/"));
      for (const file of files) {
        const r = await ImageImporter.fromFile(file);
        if (r) await this._addImageLayerFromSrc(r.src, r.w, r.h);
      }
    };
    body.addEventListener("dragover",  this._onDragOver);
    body.addEventListener("dragleave", this._onDragLeave);
    body.addEventListener("drop",      this._onDrop);
  }

  _activateClipboardPaste() {
    this._onPaste = async e => {
      const items = [...(e.clipboardData?.items ?? [])];
      const img   = items.find(i => i.type.startsWith("image/"));
      if (!img) return;
      e.preventDefault(); e.stopPropagation();
      const file = img.getAsFile();
      if (!file) return;
      const r = await ImageImporter.fromFile(file);
      if (r) await this._addImageLayerFromSrc(r.src, r.w, r.h);
    };
    document.addEventListener("paste", this._onPaste, true);
  }

  /* ══════════════════════════════════════════
     PATCH (소켓 수신)
  ═════════════════════════════════════════════ */
  patch(data) {
    Object.assign(this.data, data);
    this.el.style.backgroundColor = (this.data.bgColor === 'transparent' || this.data.bgColor === 'rgba(0,0,0,0)') ? 'transparent' : (this.data.bgColor || '#FFF9A0');
    const display = this.el.querySelector(".snw-text-display");
    if (display) {
      display.innerHTML       = this._esc(this.data.text);
      display.style.color     = this.data.textColor;
      display.style.fontSize  = this.data.fontSize + "px";
    }
    this._rerenderImageLayers();
  }

  /* ══════════════════════════════════════════
     DELETE
  ═════════════════════════════════════════════ */
  async _confirmDelete() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "스티커 메모" },
      content: "<p>이 메모를 삭제하시겠습니까?</p>",
    });
    if (!ok) return;
    await StickyNoteManager.requestRemove(this.data.id);
    this.destroy();
  }

  destroy() {
    document.removeEventListener("click", this._outsideClick, true);
    document.removeEventListener("paste", this._onPaste, true);
    this.el?.remove();
    this.el = null;
  }

  /* ══════════════════════════════════════════
     UTILS
  ═════════════════════════════════════════════ */
  _showToast(msg) {
    const t = document.createElement("div");
    t.className = "snw-drop-toast";
    t.textContent = msg;
    this.el.appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }

  _esc(str) {
    return String(str ?? "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/\n/g,"<br>");
  }
}
