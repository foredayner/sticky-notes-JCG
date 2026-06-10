/**
 * DrawingCanvas.mjs  (v7)
 *
 * 핵심 변경:
 * 1. Ctrl+Z — capture:true + stopImmediatePropagation으로 Foundry보다 먼저 차단
 * 2/3. 마우스 이벤트를 document에서 capture — 노트 바깥도 좌표 추적,
 *      커밋 시 노트 범위 clip으로 바깥 그림은 자동 제거
 *      overlayCanvas는 노트 크기 유지 (비율 문제 없음)
 */

import { TOOLS } from "./DrawingToolbar.mjs";

const CURSOR_PREVIEW_TOOLS = new Set([TOOLS.PEN, TOOLS.SPRAY, TOOLS.ERASER, TOOLS.BLUR]);

export class DrawingCanvas {
  constructor(widget, width, height) {
    this.widget = widget;
    this.W = Math.round(width);
    this.H = Math.round(height);

    this.baseCanvas    = this._makeCanvas("sn-canvas-base");
    this.drawCanvas    = this._makeCanvas("sn-canvas-draw");
    this.overlayCanvas = this._makeCanvas("sn-canvas-overlay");
    this.baseCtx       = this.baseCanvas.getContext("2d");
    this.drawCtx       = this.drawCanvas.getContext("2d");
    this.overlayCtx    = this.overlayCanvas.getContext("2d");

    this.tool  = TOOLS.PEN;
    this.color = "#e05555";
    this.opts  = {
      size:4, opacity:1.0, smoothing:true,
      sprayDensity:30, sprayRadius:20,
      shapeType:"rect", shapeFill:false, shapeFillColor:"#ffffff",
      blurRadius:6, textSize:16, textFont:"sans-serif",
    };

    this._undoStack   = [];
    this.history      = [];
    this._MAX_UNDO    = 30;
    this._initialSnap = null;
    this._active      = false;

    this._isDown       = false;
    this._lastX = 0;   this._lastY = 0;
    this._startX = 0;  this._startY = 0;
    this._strokePoints = [];
    this._lassoPath    = [];
    this._sprayTimer   = null;

    // 영역
    this._selection      = null;
    this._selectionType  = null;
    this._selectionActive = false;
    this._clipboard      = null;
    this._clipboardPos   = null;

    // 이동
    this._moveSnap = null;
    this._moveOffX = 0; this._moveOffY = 0;

    this._textInput = null;

    // 노트 범위 (무한캔버스 비활성 — 노트와 canvas 1:1)
    this._noteOffsetX = 0;
    this._noteOffsetY = 0;
    this._noteW       = this.W;
    this._noteH       = this.H;
    this._cssOffsetX  = 0;
    this._cssOffsetY  = 0;

    this.onHistoryChange = null;
    this.onColorUsed     = null;
    this.onLayerUndo     = null;
  }

  _makeCanvas(cls) {
    const c = document.createElement("canvas");
    c.className = cls; c.width = this.W; c.height = this.H;
    return c;
  }

  mount(container) {
    container.appendChild(this.baseCanvas);
    container.appendChild(this.drawCanvas);
    container.appendChild(this.overlayCanvas);
    this._bindEvents();
  }

  activate()   { this._active = true; }
  deactivate() { this._active = false; }

  /* ══ TOOL / OPT ══ */
  setTool(toolId, opts) {
    this.tool = toolId;
    if (opts) Object.assign(this.opts, opts);
    if (!CURSOR_PREVIEW_TOOLS.has(toolId)) this._clearCursorPreview();
    this._removeTextInput();
    // 1: tool null이면 overlayCanvas 이벤트 비활성화
    if (!toolId) {
      this.overlayCanvas.style.pointerEvents = "none";
      this.overlayCanvas.style.cursor = "default";
    } else {
      this.overlayCanvas.style.pointerEvents = "all";
      this.overlayCanvas.style.cursor = CURSOR_PREVIEW_TOOLS.has(toolId) ? "none"
        : this._cursorForTool(toolId);
    }
    if (this._selectionActive) this._drawSelectionOverlay();
  }
  setColor(c) { this.color = c; }
  setOpt(key, val) { this.opts[key] = val; }

  _cursorForTool(t) {
    if (t === TOOLS.FILL)    return "cell";
    if (t === TOOLS.MOVE)    return "move";
    if (t === TOOLS.TEXTBOX) return "text";
    return "crosshair";
  }

  /* ══ EVENTS ══ */
  _bindEvents() {
    const oc = this.overlayCanvas;
    oc.addEventListener("mousedown", e => this._onDown(e));

    this._docMoveHandler = e => this._onDocMove(e);
    this._docUpHandler   = e => this._onDocUp(e);
    document.addEventListener("mousemove", this._docMoveHandler, { capture: false, passive: true });
    document.addEventListener("mouseup",   this._docUpHandler,   { capture: false });

    oc.addEventListener("mousemove",  e => { if (!this._isDown) this._drawCursorPreview(this._pos(e)); });
    oc.addEventListener("mouseleave", e => { if (!this._isDown) this._clearCursorPreview(); });
    oc.addEventListener("mouseenter", e => this._onEnter(e));

    // capture:true로 Foundry보다 먼저 키 이벤트 수신
    this._keyHandler = e => this._onKey(e);
    this._keyCapture = true;
    document.addEventListener("keydown", this._keyHandler, true);
  }

  /* overlayCanvas 좌표 계산 */
  _pos(e) {
    const rect = this.overlayCanvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (this.W / rect.width),
      y: (e.clientY - rect.top)  * (this.H / rect.height),
    };
  }

  /* document mousemove → overlayCanvas 기준 좌표로 변환 */
  _docPos(e) {
    const rect = this.overlayCanvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (this.W / rect.width),
      y: (e.clientY - rect.top)  * (this.H / rect.height),
    };
  }

  /* ══ CURSOR PREVIEW ══ */
  _drawCursorPreview(p) {
    if (!CURSOR_PREVIEW_TOOLS.has(this.tool)) return;
    const ctx = this.overlayCtx;
    ctx.clearRect(0, 0, this.W, this.H);
    if (this._selectionActive) this._drawSelectionOverlay();

    const r        = this.tool === TOOLS.SPRAY ? this.opts.sprayRadius : this.opts.size / 2;
    const isEraser = this.tool === TOOLS.ERASER;
    const isBlur   = this.tool === TOOLS.BLUR;

    ctx.save();
    if (isEraser || isBlur) {
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, r), 0, Math.PI*2);
      ctx.strokeStyle = isEraser ? "rgba(180,180,180,0.9)" : "rgba(100,160,255,0.8)";
      ctx.lineWidth = 1.5; ctx.setLineDash(isBlur ? [3,2] : []); ctx.stroke();
    } else if (this.tool === TOOLS.SPRAY) {
      // 스프레이: 반경 원 + 중심점 (실제 opacity 반영)
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, r), 0, Math.PI*2);
      ctx.strokeStyle = "rgba(200,200,200,0.7)"; ctx.lineWidth = 1;
      ctx.setLineDash([4,3]); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI*2);
      ctx.fillStyle = this.color; ctx.globalAlpha = this.opts.opacity; ctx.fill();
    } else {
      // 펜: 실제 그려지는 크기와 opacity를 그대로 미리보기
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, r), 0, Math.PI*2);
      ctx.fillStyle   = this.color;
      ctx.globalAlpha = this.opts.opacity;  // 실제와 동일
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = r > 4 ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.2)";
      ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.restore();
  }

  _clearCursorPreview() {
    this.overlayCtx.clearRect(0, 0, this.W, this.H);
    if (this._selectionActive) this._drawSelectionOverlay();
  }

  /* ══ MOUSE DOWN (overlayCanvas) ══ */
  _onDown(e) {
    if (e.button !== 0) return;
    if (!this.tool) return;  // 도구 없으면 이벤트 통과

    // TEXTBOX는 onTextClick으로 처리
    if (this.tool === TOOLS.TEXTBOX) {
      const p = this._pos(e);
      this.widget?.onTextClick?.(p.x, p.y, e);
      return;
    }

    this._isDown = true;
    const p = this._pos(e);
    this._startX = p.x; this._startY = p.y;
    this._lastX  = p.x; this._lastY  = p.y;
    this._strokePoints = [p];
    this._strokeLabel  = this._labelForTool(this.tool);

    if (this._selectionActive) {
      // 5: 이동 도구로 영역 밖을 클릭했을 때만 영역 해제
      // 다른 도구(펜 등)는 영역을 유지하고 clip으로만 제한
      if (this.tool === TOOLS.MOVE && !this._isInsideSelection(p)) {
        this._clearSelectionState();
      }
    }

    switch (this.tool) {
      case TOOLS.PEN:    this._beginStroke(p); break;
      case TOOLS.ERASER: this._beginErase(p);  break;
      case TOOLS.SPRAY:
        this._sprayAt(p);
        this._sprayTimer = setInterval(() => {
          if (this._isDown) this._sprayAt({ x: this._lastX, y: this._lastY });
        }, 30);
        break;
      case TOOLS.ERASER: this._eraseAt(p); break;
      case TOOLS.BLUR:   this._blurAt(p);  break;
      case TOOLS.FILL:
        this._floodFill(p, this.color);
        this._commitStrokeUndo();
        break;
      case TOOLS.TEXTBOX:
        if (this.widget?.onTextClick) this.widget.onTextClick(p.x, p.y, e);
        else this._placeTextInput(p);
        break;
      case TOOLS.LASSO:
        // 3: 기존 영역 해제 후 새 영역 시작
        this._clearSelectionState();
        this._lassoPath = [p];
        break;
      case TOOLS.RECT_SEL:
        // 3: 기존 영역 해제
        this._clearSelectionState();
        break;
      case TOOLS.MOVE:  this._startMove(p); break;
    }
  }

  /* ══ MOUSE MOVE (document — 바깥 추적) ══ */
  _onDocMove(e) {
    if (!this._isDown) return;
    const p = this._docPos(e);
    this._strokePoints.push(p);

    // 커서 미리보기 (드로잉 중에도 표시)
    if (CURSOR_PREVIEW_TOOLS.has(this.tool)) {
      this._drawCursorPreview(p);
    }

    switch (this.tool) {
      case TOOLS.PEN:      this._continueStroke(p); break;
      case TOOLS.ERASER:   this._continueErase(p);  break;
      case TOOLS.BLUR:     this._blurAt(p);   break;
      case TOOLS.SPRAY:    this._lastX = p.x; this._lastY = p.y; break;
      case TOOLS.LINE:     this._previewLine(p);  break;
      case TOOLS.SHAPE:    this._previewShape(p); break;
      case TOOLS.RECT_SEL: this._previewRectSel(p); break;
      case TOOLS.LASSO:    this._lassoPath.push(p); this._drawLassoPreview(); break;
      case TOOLS.MOVE:     this._continueMove(p); break;
    }
    this._lastX = p.x; this._lastY = p.y;
  }

  /* ══ MOUSE UP (document) ══ */
  _onDocUp(e) {
    if (!this._isDown) return;
    this._isDown = false;
    clearInterval(this._sprayTimer);
    const p = this._docPos(e);
    this._clearCursorPreview();

    switch (this.tool) {
      case TOOLS.PEN:    this._commitStroke(); break;
      case TOOLS.ERASER: this._commitErase();  break;
      case TOOLS.SPRAY:
      case TOOLS.ERASER:
      case TOOLS.BLUR:   this._commitStrokeUndo(); break;
      case TOOLS.LINE:   this._commitLine(p); break;
      case TOOLS.SHAPE:  this._commitShape(p); break;
      case TOOLS.RECT_SEL: this._finalizeRectSel(p); break;
      case TOOLS.LASSO:  this._finalizeLasso(); break;
      case TOOLS.MOVE:   this._commitMove(); break;
    }
  }

  _onEnter(e) {
    if ((e.buttons & 1) && !this._isDown) {
      this._isDown = true;
      const p = this._pos(e);
      this._lastX = p.x; this._lastY = p.y;
      if (this.tool === TOOLS.PEN) { this._strokePoints = [p]; this._beginStroke(p); }
      if (this.tool === TOOLS.SPRAY) {
        this._sprayTimer = setInterval(() => {
          if (this._isDown) this._sprayAt({ x: this._lastX, y: this._lastY });
        }, 30);
      }
    }
  }

  /* ══ KEYBOARD — capture:true ══ */
  _onKey(e) {
    if (!this._active) {
      return;
    }
    if (this._textInput) return;
    // 2: contentEditable 텍스트 입력 중 — 클립보드/선택 통과
    if (e.target.isContentEditable) return;
    if (["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName)) return;

    if (e.ctrlKey && e.key === "z") {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      this._undo();
      return;
    }
    if (e.ctrlKey && e.key === "a") {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      this._selectAll();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && this._selection) {
      e.preventDefault();
      e.stopPropagation();
      this._deleteSelection();
      return;
    }
    if (e.ctrlKey && e.key === "c") { e.preventDefault(); e.stopPropagation(); this._copySelection(); }
    if (e.ctrlKey && e.key === "v") { e.preventDefault(); e.stopPropagation(); this._pasteSelection(); }
  }

  /* ══ Ctrl+A ══ */
  _selectAll() {
    this._selection       = { x: 0, y: 0, w: this.W, h: this.H };
    this._selectionType   = "rect";
    this._selectionActive = true;
    this._clearOverlay();
    this._drawSelectionOverlay();
  }

  /* ══ 노트 범위 clip ══ */
  _noteClip(ctx) {
    ctx.beginPath();
    ctx.rect(0, 0, this._noteW, this._noteH);
    ctx.clip();
  }

  _nb(p) {
    return { x: p.x - this._noteOffsetX, y: p.y - this._noteOffsetY };
  }

  /* ══ PEN ══ */
  _beginStroke(p) {
    this.drawCtx.beginPath();
    this.drawCtx.moveTo(p.x, p.y);
  }

  _continueStroke(p) {
    const ctx = this.drawCtx;
    const pts = this._strokePoints;
    ctx.clearRect(0, 0, this.W, this.H);
    // drawCanvas에는 opacity 1로 그림 — commit 시 baseCtx.globalAlpha로 한번만 적용
    ctx.globalAlpha = 1;
    ctx.strokeStyle = this.color;
    ctx.lineWidth   = this.opts.size;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (this.opts.smoothing && pts.length > 2) {
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i+1].x)/2, my = (pts[i].y + pts[i+1].y)/2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      ctx.lineTo(pts[pts.length-1].x, pts[pts.length-1].y); ctx.stroke();
    } else {
      ctx.beginPath();
      pts.forEach((pt,i) => i===0 ? ctx.moveTo(pt.x,pt.y) : ctx.lineTo(pt.x,pt.y));
      ctx.stroke();
    }
  }

  _commitStroke() {
    this.baseCtx.save();
    this._noteClip(this.baseCtx);
    if (this._selectionActive && this._selection) this._applySelectionClip(this.baseCtx);
    // 여기서만 opacity 적용 (이중 적용 방지)
    this.baseCtx.globalAlpha = this.opts.opacity;
    this.baseCtx.drawImage(this.drawCanvas, 0, 0);
    this.baseCtx.restore();
    this.drawCtx.clearRect(0, 0, this.W, this.H);
    this._strokePoints = [];
    this._commitStrokeUndo();
  }

  /* ══ SPRAY ══ */
  _sprayAt(p) {
    const ctx = this.baseCtx;
    ctx.save();
    this._noteClip(ctx);
    if (this._selectionActive && this._selection) this._applySelectionClip(ctx);
    ctx.fillStyle = this.color;
    ctx.globalAlpha = this.opts.opacity;  // 0.15 곱셈 제거
    for (let i = 0; i < this.opts.sprayDensity; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r     = Math.random() * this.opts.sprayRadius;
      ctx.beginPath(); ctx.arc(p.x+Math.cos(angle)*r, p.y+Math.sin(angle)*r, 1, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ══ ERASER — 펜과 동일한 스트로크 방식, destination-out으로 지우기 ══ */
  _beginErase(p) {
    this.drawCtx.beginPath();
    this.drawCtx.moveTo(p.x, p.y);
  }

  _continueErase(p) {
    const ctx = this.drawCtx;
    const pts = this._strokePoints;
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "#000000";
    ctx.lineWidth   = this.opts.size;
    ctx.lineCap     = "round";
    ctx.lineJoin    = "round";
    ctx.globalAlpha = 1;
    if (this.opts.smoothing && pts.length > 2) {
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i+1].x)/2, my = (pts[i].y + pts[i+1].y)/2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      ctx.lineTo(pts[pts.length-1].x, pts[pts.length-1].y); ctx.stroke();
    } else {
      ctx.beginPath();
      pts.forEach((pt,i) => i===0 ? ctx.moveTo(pt.x,pt.y) : ctx.lineTo(pt.x,pt.y));
      ctx.stroke();
    }
    ctx.restore();
  }

  _commitErase() {
    // drawCanvas의 스트로크를 baseCanvas에 destination-out으로 합성 → 지우기
    this.baseCtx.save();
    this._noteClip(this.baseCtx);
    if (this._selectionActive && this._selection) this._applySelectionClip(this.baseCtx);
    this.baseCtx.globalCompositeOperation = "destination-out";
    this.baseCtx.drawImage(this.drawCanvas, 0, 0);
    this.baseCtx.restore();
    this.drawCtx.clearRect(0, 0, this.W, this.H);
    this._strokePoints = [];
    this._commitStrokeUndo();
  }

  /* ══ BLUR ══ */
  _blurAt(p) {
    const ctx = this.baseCtx;
    const r=this.opts.size/2, br=this.opts.blurRadius;
    const x=Math.max(0,Math.round(p.x-r-br)), y=Math.max(0,Math.round(p.y-r-br));
    const w=Math.min(this.W-x,Math.round((r+br)*2)), h=Math.min(this.H-y,Math.round((r+br)*2));
    if (w<=0||h<=0) return;
    const tmp=document.createElement("canvas"); tmp.width=w; tmp.height=h;
    const tctx=tmp.getContext("2d");
    tctx.filter=`blur(${br}px)`;
    tctx.drawImage(this.baseCanvas,x,y,w,h,0,0,w,h);
    tctx.filter="none";
    ctx.save(); this._noteClip(ctx);
    ctx.beginPath(); ctx.arc(p.x,p.y,r,0,Math.PI*2); ctx.clip();
    ctx.drawImage(tmp,x,y); ctx.restore();
  }

  /* ══ LINE ══ */
  _previewLine(p) {
    const ctx=this.drawCtx;
    ctx.clearRect(0,0,this.W,this.H);
    ctx.globalAlpha=this.opts.opacity; ctx.strokeStyle=this.color;
    ctx.lineWidth=this.opts.size; ctx.lineCap="round";
    ctx.beginPath(); ctx.moveTo(this._startX,this._startY); ctx.lineTo(p.x,p.y); ctx.stroke();
    ctx.globalAlpha=1;
  }
  _commitLine(p) {
    const ctx=this.baseCtx;
    ctx.save(); this._noteClip(ctx);
    if (this._selectionActive && this._selection) this._applySelectionClip(ctx);
    ctx.globalAlpha=this.opts.opacity; ctx.strokeStyle=this.color;
    ctx.lineWidth=this.opts.size; ctx.lineCap="round";
    ctx.beginPath(); ctx.moveTo(this._startX,this._startY); ctx.lineTo(p.x,p.y); ctx.stroke();
    ctx.restore();
    this.drawCtx.clearRect(0,0,this.W,this.H);
    this._commitStrokeUndo();
  }

  /* ══ SHAPES ══ */
  _previewShape(p) {
    const ctx=this.drawCtx;
    ctx.clearRect(0,0,this.W,this.H);
    ctx.globalAlpha=this.opts.opacity; ctx.strokeStyle=this.color; ctx.lineWidth=this.opts.size;
    if (this.opts.shapeFill) ctx.fillStyle=this.opts.shapeFillColor;
    this._drawShape(ctx,this._startX,this._startY,p.x,p.y); ctx.globalAlpha=1;
  }
  _commitShape(p) {
    const ctx=this.baseCtx;
    ctx.save(); this._noteClip(ctx);
    if (this._selectionActive && this._selection) this._applySelectionClip(ctx);
    ctx.globalAlpha=this.opts.opacity; ctx.strokeStyle=this.color; ctx.lineWidth=this.opts.size;
    if (this.opts.shapeFill) ctx.fillStyle=this.opts.shapeFillColor;
    this._drawShape(ctx,this._startX,this._startY,p.x,p.y);
    ctx.restore();
    this.drawCtx.clearRect(0,0,this.W,this.H);
    this._commitStrokeUndo();
  }
  _drawShape(ctx,x1,y1,x2,y2) {
    const w=x2-x1,h=y2-y1;
    ctx.beginPath();
    switch(this.opts.shapeType){
      case "rect":     ctx.rect(x1,y1,w,h); break;
      case "ellipse":  ctx.ellipse(x1+w/2,y1+h/2,Math.abs(w/2),Math.abs(h/2),0,0,Math.PI*2); break;
      case "triangle": ctx.moveTo(x1+w/2,y1); ctx.lineTo(x2,y2); ctx.lineTo(x1,y2); ctx.closePath(); break;
      case "arrow":    this._drawArrow(ctx,x1,y1,x2,y2); return;
    }
    if (this.opts.shapeFill) ctx.fill();
    ctx.stroke();
  }
  _drawArrow(ctx,x1,y1,x2,y2) {
    const headLen=Math.max(10,this.opts.size*4), angle=Math.atan2(y2-y1,x2-x1);
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2);
    ctx.moveTo(x2,y2); ctx.lineTo(x2-headLen*Math.cos(angle-Math.PI/6),y2-headLen*Math.sin(angle-Math.PI/6));
    ctx.moveTo(x2,y2); ctx.lineTo(x2-headLen*Math.cos(angle+Math.PI/6),y2-headLen*Math.sin(angle+Math.PI/6));
    ctx.stroke();
  }

  /* ══ FILL ══ */
  _floodFill(p, fillColor) {
    const ctx=this.baseCtx;
    const nW=this._noteW, nH=this._noteH;
    const data=ctx.getImageData(0,0,nW,nH);
    const px=Math.round(p.x), py=Math.round(p.y);
    if (px<0||px>=nW||py<0||py>=nH) return;
    const d=data.data, idx=(py*nW+px)*4;
    const [tR,tG,tB,tA]=[d[idx],d[idx+1],d[idx+2],d[idx+3]];
    const [fR,fG,fB]=this._hexToRgb(fillColor);
    if (tR===fR&&tG===fG&&tB===fB&&tA===255) return;
    const match=i=>Math.abs(d[i]-tR)<32&&Math.abs(d[i+1]-tG)<32&&Math.abs(d[i+2]-tB)<32&&Math.abs(d[i+3]-tA)<32;
    const stack=[px+py*nW], vis=new Uint8Array(nW*nH);
    while(stack.length){
      const pos=stack.pop(); if(vis[pos]) continue; vis[pos]=1;
      const i=pos*4; if(!match(i)) continue;
      d[i]=fR; d[i+1]=fG; d[i+2]=fB; d[i+3]=255;
      const x=pos%nW, y=Math.floor(pos/nW);
      if(x>0) stack.push(pos-1); if(x<nW-1) stack.push(pos+1);
      if(y>0) stack.push(pos-nW); if(y<nH-1) stack.push(pos+nW);
    }
    ctx.putImageData(data,0,0);
  }

  /* ══ TEXTBOX ══ */
  _placeTextInput(p) {
    this._removeTextInput();
    const input=document.createElement("textarea");
    input.className="sn-canvas-textinput";
    input.style.cssText=`position:absolute;left:${p.x}px;top:${p.y}px;
      min-width:80px;min-height:24px;font-size:${this.opts.textSize}px;
      font-family:${this.opts.textFont};color:${this.color};
      background:rgba(255,255,255,0.7);border:1.5px dashed #4a90d9;
      outline:none;padding:2px 4px;resize:both;z-index:200;`;
    this.overlayCanvas.parentElement.appendChild(input);
    input.focus();
    this._textInput=input;
    input.addEventListener("blur",()=>this._commitTextInput());
    input.addEventListener("keydown",e=>{if(e.key==="Escape"){input.remove();this._textInput=null;}e.stopPropagation();});
  }
  _commitTextInput() {
    const input=this._textInput;
    if(!input) return;
    const text=input.value.trim(), x=parseFloat(input.style.left), y=parseFloat(input.style.top);
    if(text){
      const ctx=this.baseCtx;
      ctx.font=`${this.opts.textSize}px ${this.opts.textFont}`;
      ctx.fillStyle=this.color; ctx.globalAlpha=this.opts.opacity;
      text.split("\n").forEach((line,i)=>ctx.fillText(line,x,y+this.opts.textSize*(i+1)));
      ctx.globalAlpha=1;
      this._commitStrokeUndo("텍스트");  // onHistoryChange가 여기서 호출됨
    }
    input.remove(); this._textInput=null;
  }
  _removeTextInput() { if(this._textInput){this._textInput.remove();this._textInput=null;} }

  /* ══ SELECTION ══ */
  _isInsideSelection(p) {
    if (!this._selection) return false;
    const sel=this._selection;
    if (sel.path) return this._pointInPolygon(p, sel.path);
    return p.x>=sel.x&&p.x<=sel.x+sel.w&&p.y>=sel.y&&p.y<=sel.y+sel.h;
  }
  _pointInPolygon(p, path) {
    let inside=false;
    for(let i=0,j=path.length-1;i<path.length;j=i++){
      const xi=path[i].x,yi=path[i].y,xj=path[j].x,yj=path[j].y;
      if(((yi>p.y)!==(yj>p.y))&&(p.x<(xj-xi)*(p.y-yi)/(yj-yi)+xi)) inside=!inside;
    }
    return inside;
  }
  _clearSelectionState() {
    this._selection=null; this._selectionType=null; this._selectionActive=false; this._clearOverlay();
  }
  _drawSelectionOverlay() {
    const ctx=this.overlayCtx, sel=this._selection;
    if (!sel) return;
    ctx.save(); ctx.strokeStyle="#1a73e8"; ctx.lineWidth=1.5; ctx.setLineDash([5,3]);
    if (sel.path){ctx.beginPath();sel.path.forEach((pt,i)=>i===0?ctx.moveTo(pt.x,pt.y):ctx.lineTo(pt.x,pt.y));ctx.closePath();}
    else{ctx.strokeRect(sel.x,sel.y,sel.w,sel.h);}
    ctx.stroke(); ctx.fillStyle="rgba(26,115,232,0.06)";
    if(sel.path){ctx.fill();}else{ctx.fillRect(sel.x,sel.y,sel.w,sel.h);}
    ctx.restore();
  }
  _applySelectionClip(ctx) {
    const sel=this._selection; if(!sel) return;
    ctx.beginPath();
    if(sel.path){sel.path.forEach((pt,i)=>i===0?ctx.moveTo(pt.x,pt.y):ctx.lineTo(pt.x,pt.y));ctx.closePath();}
    else{ctx.rect(sel.x,sel.y,sel.w,sel.h);}
    ctx.clip();
  }

  _previewRectSel(p) {
    this._clearOverlay();
    const ctx=this.overlayCtx;
    const x=Math.min(this._startX,p.x),y=Math.min(this._startY,p.y);
    const w=Math.abs(p.x-this._startX),h=Math.abs(p.y-this._startY);
    ctx.save(); ctx.setLineDash([5,3]); ctx.strokeStyle="#1a73e8"; ctx.lineWidth=1.5;
    ctx.strokeRect(x,y,w,h); ctx.fillStyle="rgba(26,115,232,0.08)"; ctx.fillRect(x,y,w,h);
    ctx.restore();
  }
  _finalizeRectSel(p) {
    this._selection={x:Math.round(Math.min(this._startX,p.x)),y:Math.round(Math.min(this._startY,p.y)),
                    w:Math.round(Math.abs(p.x-this._startX)),h:Math.round(Math.abs(p.y-this._startY))};
    this._selectionType="rect"; this._selectionActive=true; this._drawSelectionOverlay();
  }
  _drawLassoPreview() {
    this._clearOverlay();
    const ctx=this.overlayCtx,pts=this._lassoPath;
    if(pts.length<2) return;
    ctx.save(); ctx.setLineDash([4,3]); ctx.strokeStyle="#1a73e8"; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y); pts.forEach(pt=>ctx.lineTo(pt.x,pt.y));
    ctx.stroke(); ctx.restore();
  }
  _finalizeLasso() {
    const pts=this._lassoPath;
    if(pts.length<3){this._clearSelectionState();return;}
    const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
    this._selection={x:Math.round(Math.min(...xs)),y:Math.round(Math.min(...ys)),
      w:Math.round(Math.max(...xs)-Math.min(...xs)),h:Math.round(Math.max(...ys)-Math.min(...ys)),path:pts};
    this._selectionType="lasso"; this._selectionActive=true;
    this._clearOverlay();
    const ctx=this.overlayCtx;
    ctx.save(); ctx.setLineDash([4,3]); ctx.strokeStyle="#1a73e8"; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y); pts.forEach(pt=>ctx.lineTo(pt.x,pt.y));
    ctx.closePath(); ctx.stroke(); ctx.fillStyle="rgba(26,115,232,0.08)"; ctx.fill();
    ctx.restore();
  }

  /* ══ MOVE — clip 없이 이동, 노트 밖도 유지 ══ */
  _startMove(p) {
    if (!this._selectionActive || !this._selection) {
      this._moveSnap = this.baseCtx.getImageData(0, 0, this.W, this.H);
      this._selection = { x:0, y:0, w:this.W, h:this.H };
      this._selectionActive = true;
    } else {
      this._moveSnap = this.baseCtx.getImageData(0, 0, this.W, this.H);
    }
    this._moveOffX = 0; this._moveOffY = 0;
  }

  _continueMove(p) {
    const dx = Math.round(p.x - this._startX);
    const dy = Math.round(p.y - this._startY);
    this._moveOffX = dx; this._moveOffY = dy;
    const sel = this._selection;

    // 원본 복원
    this.baseCtx.putImageData(this._moveSnap, 0, 0);

    // 원본 위치 지우기
    this.baseCtx.save();
    this.baseCtx.globalCompositeOperation = "destination-out";
    if (sel.path) {
      this.baseCtx.beginPath();
      sel.path.forEach((pt,i) => i===0 ? this.baseCtx.moveTo(pt.x,pt.y) : this.baseCtx.lineTo(pt.x,pt.y));
      this.baseCtx.closePath(); this.baseCtx.fill();
    } else {
      this.baseCtx.fillStyle = "#000";
      this.baseCtx.fillRect(sel.x, sel.y, sel.w, sel.h);
    }
    this.baseCtx.restore();

    // 이동된 위치에 그리기
    const tmp = document.createElement("canvas");
    tmp.width = this.W; tmp.height = this.H;
    tmp.getContext("2d").putImageData(this._moveSnap, 0, 0);
    this.baseCtx.save();
    if (sel.path) {
      this.baseCtx.beginPath();
      sel.path.forEach((pt,i) => i===0 ? this.baseCtx.moveTo(pt.x+dx,pt.y+dy) : this.baseCtx.lineTo(pt.x+dx,pt.y+dy));
      this.baseCtx.closePath(); this.baseCtx.clip();
      this.baseCtx.drawImage(tmp, dx, dy);
    } else {
      this.baseCtx.drawImage(tmp, sel.x, sel.y, sel.w, sel.h, sel.x+dx, sel.y+dy, sel.w, sel.h);
    }
    this.baseCtx.restore();

    // 선택 영역 표시 (드래그 중 onHistoryChange 호출 안 함 — 잔상 방지)
    this._clearOverlay();
    const moved = sel.path
      ? { ...sel, path: sel.path.map(pt => ({ x:pt.x+dx, y:pt.y+dy })) }
      : { x:sel.x+dx, y:sel.y+dy, w:sel.w, h:sel.h };
    const ctx = this.overlayCtx;
    ctx.save(); ctx.strokeStyle = "#1a73e8"; ctx.lineWidth = 1.5; ctx.setLineDash([5,3]);
    if (moved.path) {
      ctx.beginPath(); moved.path.forEach((pt,i) => i===0 ? ctx.moveTo(pt.x,pt.y) : ctx.lineTo(pt.x,pt.y));
      ctx.closePath(); ctx.stroke();
    } else { ctx.strokeRect(moved.x, moved.y, moved.w, moved.h); }
    ctx.restore();
    // onHistoryChange 호출 안 함 (commitMove에서만 호출)
  }

  _commitMove() {
    if (!this._moveSnap) return;
    const dx = this._moveOffX, dy = this._moveOffY, sel = this._selection;
    if (sel.path) { this._selection = { ...sel, path: sel.path.map(pt => ({ x:pt.x+dx, y:pt.y+dy })) }; }
    else { this._selection = { x:sel.x+dx, y:sel.y+dy, w:sel.w, h:sel.h }; }
    this._moveSnap = null; this._moveOffX = 0; this._moveOffY = 0;
    this._drawSelectionOverlay();
    this._commitStrokeUndo("이동");
  }

  /* ══ 복사/붙여넣기/삭제 ══ */
  _deleteSelection() {
    if(!this._selection) return;
    const{x,y,w,h}=this._selection;
    this.baseCtx.save(); this.baseCtx.globalCompositeOperation="destination-out";
    this.baseCtx.fillStyle="#000"; this.baseCtx.fillRect(x,y,w,h);
    this.baseCtx.restore();
    this._clearSelectionState(); this._commitStrokeUndo("삭제");
  }
  _copySelection() {
    if(!this._selection) return;
    const{x,y,w,h}=this._selection; if(w<=0||h<=0) return;
    this._clipboard=this.baseCtx.getImageData(Math.max(0,x),Math.max(0,y),Math.min(w,this.W-x),Math.min(h,this.H-y));
    this._clipboardPos={x,y,w,h};
  }
  _pasteSelection() {
    if(!this._clipboard) return;
    const tmp=document.createElement("canvas");
    const pos=this._clipboardPos??{x:0,y:0,w:this._clipboard.width,h:this._clipboard.height};
    tmp.width=pos.w; tmp.height=pos.h;
    tmp.getContext("2d").putImageData(this._clipboard,0,0);
    this.widget._addDrawingLayerFromCanvas?.(tmp,pos.x+20,pos.y+20);
  }

  /* ══ UNDO ══ */
  _labelForTool(t) {
    return {"pen":"펜","spray":"스프레이","eraser":"지우개","line":"직선","shape":"도형",
            "textbox":"텍스트","fill":"채우기","blur":"블러","lasso":"올가미",
            "rect_sel":"영역선택","move":"이동"}[t]??"작업";
  }
  _commitStrokeUndo(label) {
    const snap=this.baseCtx.getImageData(0,0,this.W,this.H);
    const lbl=label??this._strokeLabel??this._labelForTool(this.tool);
    if(this._undoStack.length>=this._MAX_UNDO){this._undoStack.shift();this.history.shift();}
    this._undoStack.push({snap,label:lbl}); this.history.push(lbl);
    const colorTools=new Set([TOOLS.PEN,TOOLS.SPRAY,TOOLS.LINE,TOOLS.SHAPE,TOOLS.FILL,TOOLS.TEXTBOX]);
    if(colorTools.has(this.tool)||label==="텍스트"||label==="이미지") this.onColorUsed?.(this.color);
    this.onHistoryChange?.();
  }
  _undo() {
    if (!this._undoStack.length) return;
    const top = this._undoStack[this._undoStack.length - 1];

    // 레이어 구조 undo — snap 없음, 외부 핸들러 위임
    if (top?._layerOp) {
      this._undoStack.pop(); this.history.pop();
      this.onLayerUndo?.();
      this.onHistoryChange?.();
      return;
    }

    this._undoStack.pop(); this.history.pop();
    const prev = this._undoStack.length
      ? this._undoStack[this._undoStack.length - 1]
      : null;

    if (prev && !prev._layerOp && prev.snap) {
      this.baseCtx.putImageData(prev.snap, 0, 0);
    } else if (!this._undoStack.length) {
      if (this._initialSnap) this.baseCtx.putImageData(this._initialSnap, 0, 0);
      else this.baseCtx.clearRect(0, 0, this.W, this.H);
    }
    this.onHistoryChange?.();
  }
  saveInitialSnap() { this._initialSnap=this.baseCtx.getImageData(0,0,this.W,this.H); }

  /* ══ HELPERS ══ */
  _drawNoteBorder() { /* 제거됨 */ }
  _clearOverlay()   { this.overlayCtx.clearRect(0,0,this.W,this.H); }
  _hexToRgb(hex){return[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];}

  flatten() {
    const tmp=document.createElement("canvas"); tmp.width=this.W; tmp.height=this.H;
    const ctx=tmp.getContext("2d");
    ctx.drawImage(this.baseCanvas,0,0); ctx.drawImage(this.drawCanvas,0,0);
    return tmp.toDataURL("image/png");
  }

  destroy() {
    document.removeEventListener("keydown", this._keyHandler, true);
    document.removeEventListener("mousemove", this._docMoveHandler, { capture: false, passive: true });
    document.removeEventListener("mouseup",   this._docUpHandler,   { capture: false });
    clearInterval(this._sprayTimer);
    this._removeTextInput();
    this.baseCanvas.remove(); this.drawCanvas.remove(); this.overlayCanvas.remove();
  }
}
