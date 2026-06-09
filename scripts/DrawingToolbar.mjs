/**
 * DrawingToolbar.mjs  (v5)
 *
 * 변경:
 * 1. 색상 섹션 툴바에서 제거 — 도구 클릭 시 그 버튼 오른쪽에 ColorPicker 팝업
 * 2. 배경 탭 — LayerManager 배경 레이어 색 변경
 */

export const TOOLS = {
  PEN:"pen", SPRAY:"spray", ERASER:"eraser",
  LINE:"line", SHAPE:"shape", TEXTBOX:"textbox",
  FILL:"fill", BLUR:"blur", LASSO:"lasso", RECT_SEL:"rect_sel", MOVE:"move",
};

// 색상 피커를 쓰는 도구
const COLOR_TOOLS = new Set([
  TOOLS.PEN, TOOLS.SPRAY, TOOLS.LINE, TOOLS.SHAPE,
  TOOLS.TEXTBOX, TOOLS.FILL,
]);

const TOOL_DEFS = [
  { id:TOOLS.PEN,      icon:"✒",  label:"펜"      },
  { id:TOOLS.SPRAY,    icon:"💨",  label:"스프레이" },
  { id:TOOLS.ERASER,   icon:"⬜",  label:"지우개"  },
  { id:TOOLS.LINE,     icon:"╱",  label:"직선"    },
  { id:TOOLS.SHAPE,    icon:"◻",  label:"도형"    },
  { id:TOOLS.TEXTBOX,  icon:"T",   label:"텍스트"  },
  { id:TOOLS.FILL,     icon:"🪣",  label:"채우기"  },
  { id:TOOLS.BLUR,     icon:"◉",  label:"블러"    },
  { id:TOOLS.LASSO,    icon:"⊙",  label:"올가미"  },
  { id:TOOLS.RECT_SEL, icon:"⬚",  label:"영역"    },
  { id:TOOLS.MOVE,     icon:"✥",  label:"이동"    },
  { id:"edit",         icon:"⚙",  label:"편집",  isEdit:true },
];

export class DrawingToolbar {
  constructor(owner) {
    this.owner      = owner;
    this.el         = null;
    this.optBar     = null;
    this.activeTool = TOOLS.PEN;

    this.opts = {
      color:"#e05555", opacity:1.0, smoothing:true,
      size:4,
      sprayDensity:30, sprayRadius:20,
      shapeType:"rect", shapeFill:false, shapeFillColor:"#ffffff",
      blurRadius:6, textFont:"sans-serif", textSize:16,
      bristleCount:12,
    };

    this._activeTab = "tools";
  }

  /* ══ RENDER ══ */
  render(container) {
    const wrap = document.createElement("div");
    wrap.className = "sn-toolbar-wrap";

    // 탭 (도구 + 배경만, 편집탭 제거)
    const tabs = document.createElement("div");
    tabs.className = "sn-toolbar-tabs";
    tabs.innerHTML = `
      <button class="sn-tab-btn active" data-tab="tools">도구</button>
      <button class="sn-tab-btn"        data-tab="bg">배경</button>`;

    const toolPanel = document.createElement("div");
    toolPanel.className = "sn-toolbar sn-tab-panel";
    toolPanel.dataset.panel = "tools";
    toolPanel.innerHTML = this._buildToolsHTML();

    const bgPanel = document.createElement("div");
    bgPanel.className = "sn-toolbar sn-tab-panel";
    bgPanel.dataset.panel = "bg";
    bgPanel.style.display = "none";
    bgPanel.innerHTML = this._buildBgHTML();

    wrap.appendChild(tabs);
    wrap.appendChild(toolPanel);
    wrap.appendChild(bgPanel);

    this.optBar = document.createElement("div");
    this.optBar.className = "sn-optbar";

    this.el        = toolPanel;
    this._bgPanel  = bgPanel;
    this._tabPanel = { tools: toolPanel, bg: bgPanel };
    container.appendChild(wrap);

    this._attachEvents(wrap);
    this.selectTool(this.activeTool);
    return wrap;
  }

  _buildToolsHTML() {
    return `
    <div class="sn-toolbar-header">도구</div>
    <div class="sn-tool-buttons">
      ${TOOL_DEFS.map(t => `
        <div class="sn-tool-row" data-tool="${t.id}">
          <button class="sn-tool-btn" data-tool="${t.id}" title="${t.label}">
            <span class="sn-tool-icon">${t.icon}</span>
            <span class="sn-tool-label">${t.label}</span>
          </button>
          ${COLOR_TOOLS.has(t.id)
            ? `<div class="sn-tool-color-dot" data-tool="${t.id}" title="색상 선택"></div>`
            : ``}
        </div>`).join("")}
    </div>`;
  }

  _buildEditHTML() {
    return `
    <div class="sn-toolbar-header">편집</div>
    <div class="sn-edit-section">

      <!-- 회전 -->
      <div class="sn-edit-group-label">회전</div>
      <div class="sn-edit-btn-row">
        <button class="sn-edit-btn" data-action="rotate-ccw">↺ 90°</button>
        <button class="sn-edit-btn" data-action="rotate-cw">↻ 90°</button>
      </div>
      <div class="sn-edit-angle-row">
        <input type="range" class="sn-edit-angle-slider" min="-180" max="180" value="0" step="1">
        <span class="sn-edit-angle-val">0°</span>
      </div>

      <!-- 대칭 -->
      <div class="sn-edit-group-label">대칭</div>
      <div class="sn-edit-btn-row">
        <button class="sn-edit-btn" data-action="flip-h">↔ 좌우</button>
        <button class="sn-edit-btn" data-action="flip-v">↕ 상하</button>
      </div>

      <!-- 크기조절 -->
      <div class="sn-edit-group-label">크기 조절</div>
      <div class="sn-edit-size-info"></div>
      <button class="sn-edit-btn sn-resize-start-btn" data-action="resize-start" style="width:100%">⤡ 핸들로 조절</button>

      <!-- 공통 적용/취소 -->
      <div class="sn-edit-divider"></div>
      <div class="sn-edit-btn-row">
        <button class="sn-edit-btn sn-edit-cancel-all" data-action="cancel-all">✕ 취소</button>
        <button class="sn-edit-apply-btn sn-edit-apply-all" data-action="apply-all">✔ 적용</button>
      </div>
    </div>`;
  }

  _buildBgHTML() {
    // 단색 프리셋 8개 + 완전 투명 1개 + 사용자 정의 슬롯 1개(마지막)
    const presets = [
      { color:"#FFF9A0", alpha:1.0 },  // 기본 노란색
      { color:"#FFFFFF", alpha:1.0 },  // 흰색
      { color:"#FFD6D6", alpha:1.0 },  // 연분홍
      { color:"#D6F0FF", alpha:1.0 },  // 연하늘
      { color:"#D6FFD6", alpha:1.0 },  // 연초록
      { color:"#F0D6FF", alpha:1.0 },  // 연보라
      { color:"#1a1a2e", alpha:1.0 },  // 다크네이비
      { color:"#2b2b2b", alpha:1.0 },  // 다크그레이
      { color:"#000000", alpha:0.0, transparent:true },  // 완전 투명
      { color:"#FFF9A0", alpha:1.0, custom:true },  // 사용자 정의 (마지막 슬롯)
    ];
    const swatches = presets.map(({color, alpha, custom, transparent: isTransparent}, i) => {
      const r = parseInt(color.slice(1,3),16);
      const g = parseInt(color.slice(3,5),16);
      const b = parseInt(color.slice(5,7),16);
      const dataColor = isTransparent ? "transparent" : color;
      return `<div class="sn-bg-swatch sn-bg-swatch-checker ${custom?"sn-bg-swatch-custom":""}"
        data-color="${dataColor}" data-alpha="${alpha}" data-idx="${i}"
        title="${custom ? "사용자 정의" : isTransparent ? "투명" : color}">
        <div class="sn-bg-swatch-color" style="background:${isTransparent ? "transparent" : `rgba(${r},${g},${b},${alpha})`}"></div>
        ${custom ? `<span class="sn-bg-swatch-custom-label">✎</span>` : ""}
      </div>`;
    }).join("");

    return `
    <div class="sn-toolbar-header">배경</div>
    <div class="sn-bg-section">
      <div class="sn-bg-swatches">${swatches}</div>
      <div class="sn-bg-current-row">
        <div class="sn-bg-current-preview-wrap">
          <div class="sn-bg-current-checker"></div>
          <div class="sn-bg-current-preview" style="background:#FFF9A0"></div>
        </div>
        <span class="sn-bg-current-label">선택된 색</span>
      </div>
      <div class="sn-bg-btn-row">
        <button class="sn-bg-pick-btn">색 선택</button>
        <button class="sn-bg-apply-btn">적용</button>
      </div>
    </div>`;
  }

  /* ══ EVENTS ══ */
  _attachEvents(wrap) {
    // 탭 전환 — 1: 배경 탭 시 도구 색상 피커 숨김
    wrap.querySelectorAll(".sn-tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        wrap.querySelectorAll(".sn-tab-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        Object.entries(this._tabPanel).forEach(([k, p]) =>
          p.style.display = k === btn.dataset.tab ? "" : "none");
        const colorPanel = document.querySelector(".sno-color-picker-panel");
        if (colorPanel) {
          colorPanel.style.display = btn.dataset.tab === "bg" ? "none" : "";
        }
      });
    });

    // 편집 탭 이벤트
    const editPanel = wrap.querySelector('[data-panel="edit"]');
    if (editPanel) {
      // 회전 슬라이더
      const angleSlider = editPanel.querySelector(".sn-edit-angle-slider");
      const angleVal    = editPanel.querySelector(".sn-edit-angle-val");
      angleSlider?.addEventListener("input", e => {
        angleVal.textContent = e.target.value + "°";
      });

      // 버튼들
      editPanel.querySelectorAll("[data-action]").forEach(btn => {
        btn.addEventListener("click", () => {
          const action = btn.dataset.action;
          const lm     = this.owner.layerMgr;
          const dc     = this.owner.drawCanvas;
          if (!lm || !dc) return;

          const canvas = lm.activeCanvas;
          const W = canvas.width, H = canvas.height;
          const ctx = canvas.getContext("2d");

          const applyTransform = (transform) => {
            const tmp = document.createElement("canvas");
            tmp.width = W; tmp.height = H;
            const tctx = tmp.getContext("2d");
            tctx.drawImage(canvas, 0, 0);
            ctx.clearRect(0, 0, W, H);
            ctx.save();
            transform(ctx, W, H);
            ctx.drawImage(tmp, 0, 0);
            ctx.restore();
            dc.saveInitialSnap();
            dc._commitStrokeUndo(action);
            lm.onUpdate?.();
          };

          switch (action) {
            case "rotate-ccw":
              applyTransform((c, w, h) => { c.translate(w/2, h/2); c.rotate(-Math.PI/2); c.translate(-w/2, -h/2); });
              break;
            case "rotate-cw":
              applyTransform((c, w, h) => { c.translate(w/2, h/2); c.rotate(Math.PI/2); c.translate(-w/2, -h/2); });
              break;
            case "rotate-custom": {
              const deg = parseFloat(angleSlider?.value ?? 0);
              const rad = deg * Math.PI / 180;
              applyTransform((c, w, h) => { c.translate(w/2, h/2); c.rotate(rad); c.translate(-w/2, -h/2); });
              break;
            }
            case "flip-h":
              applyTransform((c, w) => { c.translate(w, 0); c.scale(-1, 1); });
              break;
            case "flip-v":
              applyTransform((c, w, h) => { c.translate(0, h); c.scale(1, -1); });
              break;
            case "resize-start":
              this.owner._startResizeHandles?.();
              editPanel.querySelector(".sn-resize-apply").style.display  = "";
              editPanel.querySelector(".sn-resize-cancel").style.display = "";
              btn.style.display = "none";
              break;
            case "resize-apply":
              this.owner._commitResizeHandles?.();
              editPanel.querySelector(".sn-resize-apply").style.display  = "none";
              editPanel.querySelector(".sn-resize-cancel").style.display = "none";
              editPanel.querySelector('[data-action="resize-start"]').style.display = "";
              break;
            case "resize-cancel":
              this.owner._cancelResizeHandles?.();
              editPanel.querySelector(".sn-resize-apply").style.display  = "none";
              editPanel.querySelector(".sn-resize-cancel").style.display = "none";
              editPanel.querySelector('[data-action="resize-start"]').style.display = "";
              break;
          }
        });
      });

      // 편집 탭 클릭 시 현재 크기 반영
      const setInitialSize = () => {
        const canvas = this.owner.layerMgr?.activeCanvas;
        if (!canvas) return;
        const info = editPanel.querySelector(".sn-edit-size-info");
        if (info) info.textContent = `현재: ${canvas.width} × ${canvas.height} px`;
      };
      wrap.querySelector('[data-tab="edit"]')?.addEventListener("click", setInitialSize);
    }

    // 도구 선택
    wrap.querySelectorAll(".sn-tool-btn").forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        const toolId = btn.dataset.tool;

        // 편집 버튼 — 색상 피커 대신 편집 패널 팝업
        if (toolId === "edit") {
          this.owner._toggleEditPanel?.(btn);
          // 3: 편집 진입 시 기존 도구 선택 해제
          wrap.querySelectorAll(".sn-tool-btn").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          return;
        }

        this.selectTool(toolId);
        // 4: 다른 도구 선택 시 축점 제거
        this.owner._removeRotatePivot?.();
        // 색상 도구면 피커 열기, 아니면 피커 닫기
        if (COLOR_TOOLS.has(toolId)) {
          this.owner._openColorPickerAt?.(btn);
        } else {
          this.owner._closeColorPicker?.();
        }
      });
    });

    // 색상 점(dot) 클릭 → 피커 열기
    wrap.querySelectorAll(".sn-tool-color-dot").forEach(dot => {
      dot.addEventListener("click", e => {
        e.stopPropagation();
        const toolBtn = wrap.querySelector(`.sn-tool-btn[data-tool="${dot.dataset.tool}"]`);
        this.selectTool(dot.dataset.tool);
        this._openColorPickerAt(toolBtn ?? dot);
      });
    });

    wrap.querySelectorAll(".sn-bg-swatch").forEach(el => {
      el.addEventListener("click", () => {
        wrap.querySelectorAll(".sn-bg-swatch").forEach(s => s.classList.remove("selected"));
        el.classList.add("selected");
        const color = el.dataset.color;
        const alpha = parseFloat(el.dataset.alpha ?? "1");
        const r = parseInt(color.slice(1,3),16);
        const g = parseInt(color.slice(3,5),16);
        const b = parseInt(color.slice(5,7),16);
        this._bgColorSelected = color;
        this._bgAlphaSelected = alpha;
        const preview = wrap.querySelector(".sn-bg-current-preview");
        if (preview) preview.style.background = `rgba(${r},${g},${b},${alpha})`;
        this.owner._bgColorPicker?.setColor(color);
      });
    });

    // 색 선택 버튼 — 마지막 슬롯 자동 선택 후 ColorPicker 열기
    wrap.querySelector(".sn-bg-pick-btn")?.addEventListener("click", e => {
      e.stopPropagation();
      // 마지막 슬롯 자동 선택
      const swatches = wrap.querySelectorAll(".sn-bg-swatch");
      const lastSwatch = swatches[swatches.length - 1];
      if (lastSwatch) {
        swatches.forEach(s => s.classList.remove("selected"));
        lastSwatch.classList.add("selected");
        const color = lastSwatch.dataset.color;
        const alpha = parseFloat(lastSwatch.dataset.alpha ?? "1");
        const r = parseInt(color.slice(1,3),16);
        const g = parseInt(color.slice(3,5),16);
        const b = parseInt(color.slice(5,7),16);
        this._bgColorSelected = color;
        this._bgAlphaSelected = alpha;
        const preview = wrap.querySelector(".sn-bg-current-preview");
        if (preview) preview.style.background = `rgba(${r},${g},${b},${alpha})`;
      }
      // 피커 열기 — ColorPicker onChange가 마지막 슬롯 색을 업데이트
      this.owner._openBgColorPicker?.(e.currentTarget, (hex) => {
        // 마지막 슬롯 색 실시간 업데이트
        if (lastSwatch) {
          const r2 = parseInt(hex.slice(1,3),16);
          const g2 = parseInt(hex.slice(3,5),16);
          const b2 = parseInt(hex.slice(5,7),16);
          lastSwatch.dataset.color = hex;
          lastSwatch.querySelector(".sn-bg-swatch-color").style.background = `rgb(${r2},${g2},${b2})`;
          this._bgColorSelected = hex;
          const preview = wrap.querySelector(".sn-bg-current-preview");
          if (preview) preview.style.background = `rgb(${r2},${g2},${b2})`;
        }
      });
    });

    // 2: 적용 버튼
    wrap.querySelector(".sn-bg-apply-btn")?.addEventListener("click", () => {
      const color = this._bgColorSelected ?? this.owner.widget?.data?.bgColor ?? "#FFF9A0";
      this.owner.layerMgr?.setBgColor(color);
      this.owner._applyMemoTransform?.();
      if (this.owner.widget) {
        this.owner.widget.data.bgColor = color;
        const isTransparent = color === "transparent" || color === "rgba(0,0,0,0)";
        this.owner.widget.el.style.backgroundColor = isTransparent ? "transparent" : color;
      }
    });
  }

  _openColorPickerAt(btn) {
    this.owner._openColorPickerAt?.(btn);
  }

  selectTool(toolId) {
    this.activeTool = toolId;
    this.el?.querySelectorAll(".sn-tool-btn").forEach(b =>
      b.classList.toggle("active", b.dataset.tool === toolId));
    this.el?.querySelectorAll(".sn-tool-color-dot").forEach(d =>
      d.classList.toggle("active-tool", d.dataset.tool === toolId));
    this._renderOptBar(toolId);
    this.owner.drawCanvas?.setTool(toolId, this.opts);
    // 다른 도구 선택 시 크기조절 취소
    if (this.owner._resizeOverlay) this.owner._cancelResizeHandles?.();
    // 편집 프리뷰 취소 (스냅으로 복원)
    if (this.owner._editSnapCanvas && this.owner.layerMgr) {
      const canvas = this.owner.layerMgr.activeCanvas;
      if (canvas) {
        canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
        canvas.getContext("2d").drawImage(this.owner._editSnapCanvas, 0, 0);
        this.owner.layerMgr.onUpdate?.();
      }
      this.owner._editSnapCanvas = null;
      this.owner._editBigCanvas  = null;
    }
  }

  /* 색상 변경 시 dot 업데이트 */
  updateColorDot(toolId, color) {
    const dot = this.el?.querySelector(`.sn-tool-color-dot[data-tool="${toolId}"]`);
    if (dot) dot.style.background = color;
  }

  /* ══ 옵션바 ══ */
  _renderOptBar(toolId) {
    const bar = this.optBar;
    if (!bar) return;
    bar.innerHTML = "";
    const add  = html => bar.insertAdjacentHTML("beforeend", html);
    const bind = (sel, evt, fn) => bar.querySelector(sel)?.addEventListener(evt, fn);

    const sizeTools = [TOOLS.PEN,TOOLS.ERASER,TOOLS.BLUR,TOOLS.LINE,TOOLS.SHAPE];
    if (sizeTools.includes(toolId)) {
      add(`<label class="sn-opt-label">굵기
        <input type="range" class="sn-opt-size" min="1" max="60" value="${this.opts.size}">
        <span class="sn-opt-val">${this.opts.size}px</span></label>`);
      bind(".sn-opt-size","input",e=>{
        this.opts.size=+e.target.value;
        bar.querySelector(".sn-opt-val").textContent=e.target.value+"px";
        this.owner.drawCanvas?.setOpt("size",+e.target.value);
      });
    }
    if (toolId===TOOLS.PEN) {
      add(`<label class="sn-opt-label sn-opt-check">
        <input type="checkbox" class="sn-opt-smooth" ${this.opts.smoothing?"checked":""}>매끄럽게</label>`);
      bind(".sn-opt-smooth","change",e=>{this.opts.smoothing=e.target.checked;this.owner.drawCanvas?.setOpt("smoothing",e.target.checked);});
    }
    if (toolId===TOOLS.SPRAY) {
      add(`<label class="sn-opt-label">밀도
        <input type="range" class="sn-opt-density" min="5" max="80" value="${this.opts.sprayDensity}">
        <span class="sn-opt-densval">${this.opts.sprayDensity}</span></label>
        <label class="sn-opt-label">반경
        <input type="range" class="sn-opt-sradius" min="5" max="60" value="${this.opts.sprayRadius}">
        <span class="sn-opt-sradval">${this.opts.sprayRadius}px</span></label>`);
      bind(".sn-opt-density","input",e=>{this.opts.sprayDensity=+e.target.value;bar.querySelector(".sn-opt-densval").textContent=e.target.value;this.owner.drawCanvas?.setOpt("sprayDensity",+e.target.value);});
      bind(".sn-opt-sradius","input",e=>{this.opts.sprayRadius=+e.target.value;bar.querySelector(".sn-opt-sradval").textContent=e.target.value+"px";this.owner.drawCanvas?.setOpt("sprayRadius",+e.target.value);});
    }
    if (toolId===TOOLS.SHAPE) {
      add(`<div class="sn-opt-shape-row">
        ${["rect","ellipse","triangle","arrow"].map(s=>
          `<button class="sn-shape-btn ${this.opts.shapeType===s?"active":""}" data-shape="${s}">
            ${s==="rect"?"◻":s==="ellipse"?"◯":s==="triangle"?"△":"→"}</button>`).join("")}
        </div>
        <label class="sn-opt-label sn-opt-check"><input type="checkbox" class="sn-opt-shapefill" ${this.opts.shapeFill?"checked":""}> 채우기</label>
        <label class="sn-opt-label" id="sn-fill-color-wrap" style="${this.opts.shapeFill?"":"display:none"}">
          채우기색<input type="color" class="sn-opt-fillcolor" value="${this.opts.shapeFillColor}"></label>`);
      bar.querySelectorAll(".sn-shape-btn").forEach(b=>b.addEventListener("click",()=>{
        bar.querySelectorAll(".sn-shape-btn").forEach(x=>x.classList.remove("active"));
        b.classList.add("active");this.opts.shapeType=b.dataset.shape;
        this.owner.drawCanvas?.setOpt("shapeType",b.dataset.shape);
      }));
      bind(".sn-opt-shapefill","change",e=>{
        this.opts.shapeFill=e.target.checked;
        bar.querySelector("#sn-fill-color-wrap").style.display=e.target.checked?"":"none";
        this.owner.drawCanvas?.setOpt("shapeFill",e.target.checked);
      });
      bind(".sn-opt-fillcolor","input",e=>{this.opts.shapeFillColor=e.target.value;this.owner.drawCanvas?.setOpt("shapeFillColor",e.target.value);});
    }
    if (toolId===TOOLS.TEXTBOX) {
      add(`<label class="sn-opt-label">크기<input type="number" class="sn-opt-tsize" min="8" max="72" value="${this.opts.textSize}" style="width:52px">px</label>
        <label class="sn-opt-label">폰트
        <select class="sn-opt-tfont">
          <option value="sans-serif" ${this.opts.textFont==="sans-serif"?"selected":""}>Sans</option>
          <option value="serif"      ${this.opts.textFont==="serif"?"selected":""}>Serif</option>
          <option value="monospace"  ${this.opts.textFont==="monospace"?"selected":""}>Mono</option>
        </select></label>`);
      bind(".sn-opt-tsize","change",e=>{this.opts.textSize=+e.target.value;this.owner.drawCanvas?.setOpt("textSize",+e.target.value);});
      bind(".sn-opt-tfont","change",e=>{this.opts.textFont=e.target.value;this.owner.drawCanvas?.setOpt("textFont",e.target.value);});
    }
    if (toolId===TOOLS.BLUR) {
      add(`<label class="sn-opt-label">크기
        <input type="range" class="sn-opt-blur-size" min="4" max="100" value="${this.opts.size}">
        <span class="sn-opt-blursizeval">${this.opts.size}px</span></label>
        <label class="sn-opt-label">강도
        <input type="range" class="sn-opt-blur" min="0.5" max="40" step="0.5" value="${this.opts.blurRadius}">
        <span class="sn-opt-blurval">${this.opts.blurRadius}</span></label>`);
      bind(".sn-opt-blur-size","input",e=>{this.opts.size=+e.target.value;bar.querySelector(".sn-opt-blursizeval").textContent=e.target.value+"px";this.owner.drawCanvas?.setOpt("size",+e.target.value);});
      bind(".sn-opt-blur","input",e=>{this.opts.blurRadius=+e.target.value;bar.querySelector(".sn-opt-blurval").textContent=e.target.value;this.owner.drawCanvas?.setOpt("blurRadius",+e.target.value);});
    }
    if ([TOOLS.LASSO,TOOLS.RECT_SEL].includes(toolId)) {
      add(`<span class="sn-opt-hint">Del 삭제 &nbsp;|&nbsp; Ctrl+C 복사 &nbsp;|&nbsp; Ctrl+V 붙여넣기</span>`);
    }
  }
}
