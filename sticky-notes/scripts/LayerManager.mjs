/**
 * LayerManager.mjs  (v3)
 *
 * 레이어 타입:
 *   "background" — 배경, 단색 fill, 항상 최하단
 *   "image"      — 일반 드로잉/이미지 레이어
 *   "text"       — 텍스트 레이어 (텍스트 데이터 보관 + canvas 렌더)
 *
 * 레이어 객체:
 *   {
 *     id, label, visible, opacity, type,
 *     canvas,                    // 항상 존재 (렌더 결과)
 *     isBackground,
 *     // type==="text" 일 때만:
 *     textData: {
 *       text, x, y, font, size, bold, italic, underline,
 *       spacing, lineHeight, align, color
 *     }
 *   }
 */

export class LayerManager {

  constructor(width, height, bgColor = "#FFF9A0") {
    this.W = width;
    this.H = height;
    this._layers    = [];
    this._activeIdx = 1;
    this.onUpdate   = null;

    // [0] 배경
    const bg = this._makeLayer("배경", "background");
    const bgCtx = bg.canvas.getContext("2d");
    bgCtx.fillStyle = bgColor;
    bgCtx.fillRect(0, 0, width, height);
    this._layers.push(bg);

    // [1] 레이어 1 — 투명 image 레이어
    this._layers.push(this._makeLayer("레이어 1", "image"));
  }

  /* ══ 팩토리 ══ */
  _makeLayer(label, type = "image") {
    const canvas = document.createElement("canvas");
    canvas.width  = this.W;
    canvas.height = this.H;
    canvas.getContext("2d").clearRect(0, 0, this.W, this.H);
    return {
      id          : Math.random().toString(36).slice(2, 8),
      label,
      type,                        // "background" | "image" | "text"
      visible     : true,
      opacity     : 1,
      isBackground: type === "background",
      canvas,
      textData    : null,          // type==="text"일 때만 사용
    };
  }

  /* ══ 접근자 ══ */
  get layers()       { return this._layers; }
  get activeLayer()  { return this._layers[this._activeIdx]; }
  get activeCanvas() { return this.activeLayer?.canvas; }

  /* ══ 레이어 추가 ══ */
  addLayer(type = "image", label = null) {
    const count = this._layers.filter(l => !l.isBackground).length + 1;
    const lbl   = label ?? (type === "text" ? "텍스트" : `레이어 ${count}`);
    const layer = this._makeLayer(lbl, type);
    const insertIdx = Math.max(1, this._activeIdx + 1);
    this._layers.splice(insertIdx, 0, layer);
    this._activeIdx = insertIdx;
    this.onUpdate?.();
    return layer;
  }

  addTextLayer(textData) {
    const layer    = this.addLayer("text", "텍스트");
    layer.textData = { ...textData };
    this._renderTextLayer(layer);
    return layer;
  }

  /* ══ 텍스트 레이어 렌더 ══ */
  _renderTextLayer(layer) {
    if (layer.type !== "text" || !layer.textData) return;
    const td  = layer.textData;
    const ctx = layer.canvas.getContext("2d");
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.save();
    ctx.font        = `${td.italic?"italic ":""}${td.bold?"bold ":""}${td.size}px ${td.font}`;
    ctx.fillStyle   = td.color ?? "#333";
    ctx.globalAlpha = td.opacity ?? 1;
    ctx.textAlign   = td.align ?? "left";
    const lh = td.size * ((td.lineHeight ?? 160) / 100);
    (td.text ?? "").split("\n").forEach((line, i) => {
      const ty = td.y + td.size + i * lh;
      ctx.fillText(line, td.x, ty);
      if (td.underline) {
        const w  = ctx.measureText(line).width;
        const ux = td.align === "center" ? td.x - w/2 : td.align === "right" ? td.x - w : td.x;
        ctx.fillRect(ux, ty + 2, w, 1);
      }
    });
    ctx.restore();
    this.onUpdate?.();
  }

  updateTextLayer(idx, textData) {
    const layer = this._layers[idx];
    if (!layer || layer.type !== "text") return;
    layer.textData = { ...layer.textData, ...textData };
    layer.label    = (layer.textData.text ?? "텍스트").slice(0, 12) || "텍스트";
    this._renderTextLayer(layer);
  }

  /** 텍스트 레이어를 이미지 레이어로 변환 (래스터화) */
  rasterizeTextLayer(idx) {
    const layer = this._layers[idx];
    if (!layer || layer.type !== "text") return;
    layer.type     = "image";
    layer.textData = null;
    layer.label    = layer.label + " (이미지)";
    this.onUpdate?.();
  }

  /* ══ 레이어 조작 ══ */
  setActive(idx) {
    if (idx >= 0 && idx < this._layers.length) {
      this._activeIdx = idx;
      this.onUpdate?.();
    }
  }

  toggleVisible(idx) {
    if (this._layers[idx]) {
      this._layers[idx].visible = !this._layers[idx].visible;
      this.onUpdate?.();
    }
  }

  /** 복사 (5번) */
  duplicateLayer(idx) {
    const src = this._layers[idx];
    if (!src) return;
    const copy = this._makeLayer(src.label + " 복사", src.type);
    copy.opacity  = src.opacity;
    copy.textData = src.textData ? { ...src.textData } : null;
    // canvas 픽셀 복사
    copy.canvas.getContext("2d").drawImage(src.canvas, 0, 0);
    const insertIdx = idx + 1;
    this._layers.splice(insertIdx, 0, copy);
    if (this._activeIdx >= insertIdx) this._activeIdx++;
    this.onUpdate?.();
    return copy;
  }

  /** 삭제 (5번) */
  removeLayer(idx) {
    if (this._layers[idx]?.isBackground) return; // 배경 보호
    if (this._layers.length <= 2) return;         // 배경+레이어1 최소 유지
    this._layers.splice(idx, 1);
    this._activeIdx = Math.max(1, Math.min(this._activeIdx, this._layers.length - 1));
    this.onUpdate?.();
  }

  /** 아래 레이어와 병합 (5번) */
  mergeDown(idx) {
    if (idx <= 1) return; // 배경과 병합 불가
    const upper = this._layers[idx];
    const lower = this._layers[idx - 1];
    if (!upper || !lower || lower.isBackground) return;
    // lower canvas에 upper를 합성
    const ctx = lower.canvas.getContext("2d");
    ctx.save();
    ctx.globalAlpha = upper.opacity ?? 1;
    ctx.drawImage(upper.canvas, 0, 0);
    ctx.restore();
    // lower가 text였으면 image로 변환
    lower.type     = "image";
    lower.textData = null;
    this._layers.splice(idx, 1);
    if (this._activeIdx >= idx) this._activeIdx = Math.max(1, this._activeIdx - 1);
    this.onUpdate?.();
  }

  /** 순서 변경 — from 위치를 to 위치로 (4번) */
  reorderLayer(fromIdx, toIdx) {
    if (fromIdx === toIdx) return;
    if (this._layers[fromIdx]?.isBackground) return; // 배경 고정
    if (toIdx === 0) return;                          // 배경 자리는 불가
    const layer = this._layers.splice(fromIdx, 1)[0];
    this._layers.splice(toIdx, 0, layer);
    // activeIdx 추적
    if (this._activeIdx === fromIdx) {
      this._activeIdx = toIdx;
    } else if (fromIdx < this._activeIdx && toIdx >= this._activeIdx) {
      this._activeIdx--;
    } else if (fromIdx > this._activeIdx && toIdx <= this._activeIdx) {
      this._activeIdx++;
    }
    this.onUpdate?.();
  }

  /** 배경색 변경 */
  setBgColor(color) {
    const bg = this._layers[0];
    if (!bg?.isBackground) return;
    const ctx = bg.canvas.getContext("2d");
    ctx.clearRect(0, 0, this.W, this.H);
    // 투명이 아닐 때만 fill
    if (color && color !== "transparent" && color !== "rgba(0,0,0,0)") {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, this.W, this.H);
    }
    // 투명이면 clearRect만으로 완전 투명 유지
    this.onUpdate?.();
  }

  /** 모든 보이는 레이어 합성 → data URL */
  flatten() {
    const out = document.createElement("canvas");
    out.width = this.W; out.height = this.H;
    const ctx = out.getContext("2d");
    for (const layer of this._layers) {
      if (!layer.visible) continue;
      ctx.save();
      ctx.globalAlpha = layer.opacity ?? 1;
      ctx.drawImage(layer.canvas, 0, 0);
      ctx.restore();
    }
    return out.toDataURL("image/png");
  }

  /** 기존 드로잉 데이터 → 레이어1에 로드 */
  async loadDrawingData(src) {
    return new Promise(res => {
      const img = new Image();
      img.onload = () => {
        this._layers[1].canvas.getContext("2d").drawImage(img, 0, 0, this.W, this.H);
        res();
      };
      img.onerror = res;
      img.src = src;
    });
  }

  /** 캔버스 크기 확장 (9번) — 기존 픽셀 (0,0) 기준 유지 */
  resize(newW, newH) {
    for (const layer of this._layers) {
      const oldCanvas = layer.canvas;
      const newCanvas = document.createElement("canvas");
      newCanvas.width  = newW;
      newCanvas.height = newH;
      const ctx = newCanvas.getContext("2d");
      if (layer.isBackground) {
        // 배경: 새 크기를 현재 배경색으로 채우고 기존 위에 덮기
        const oldCtx = oldCanvas.getContext("2d");
        const px     = oldCtx.getImageData(0, 0, 1, 1).data;
        ctx.fillStyle = `rgb(${px[0]},${px[1]},${px[2]})`;
        ctx.fillRect(0, 0, newW, newH);
      }
      ctx.drawImage(oldCanvas, 0, 0); // 기존 픽셀 유지
      layer.canvas = newCanvas;
    }
    this.W = newW;
    this.H = newH;
    this.onUpdate?.();
  }
}
