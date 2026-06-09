/**
 * ColorPicker.mjs  (v2)
 * - 색(Hue) 슬라이더
 * - 채도(Saturation) 슬라이더
 * - 명도(Value/Brightness) 슬라이더
 * - SV 그라디언트 영역 (채도×명도 동시 조작)
 * - 투명도(Alpha) 슬라이더
 * - H/S/V/A 숫자 입력
 * - 최근 색상 6개
 */

const RECENT_KEY = "sn_recentColors";

export class ColorPicker {
  constructor(container, initColor = "#e05555", onChange = null) {
    this.container = container;
    this.onChange  = onChange;
    this.el        = null;

    this._h = 0; this._s = 1; this._v = 1; this._alpha = 1;
    this._recentColors = this._loadRecent();
    this._fromHex(initColor);
  }

  render() {
    const el = document.createElement("div");
    el.className = "sncp-wrap";
    el.innerHTML = `
      <div class="sncp-sv-area">
        <canvas class="sncp-sv-canvas" width="200" height="150"></canvas>
        <div class="sncp-sv-cursor"></div>
      </div>

      <div class="sncp-controls">
        <div class="sncp-preview-wrap">
          <div class="sncp-preview-checker"></div>
          <div class="sncp-preview"></div>
        </div>
        <div class="sncp-sliders">
          <!-- 색상(Hue) -->
          <div class="sncp-slider-row">
            <span class="sncp-slider-lbl">색</span>
            <div class="sncp-hue-track">
              <canvas class="sncp-hue-canvas" width="152" height="12"></canvas>
              <div class="sncp-hue-thumb"></div>
            </div>
          </div>
          <!-- 채도(Saturation) -->
          <div class="sncp-slider-row">
            <span class="sncp-slider-lbl">채도</span>
            <div class="sncp-sat-track">
              <canvas class="sncp-sat-canvas" width="152" height="12"></canvas>
              <div class="sncp-sat-thumb"></div>
            </div>
          </div>
          <!-- 명도(Value) -->
          <div class="sncp-slider-row">
            <span class="sncp-slider-lbl">명도</span>
            <div class="sncp-val-track">
              <canvas class="sncp-val-canvas" width="152" height="12"></canvas>
              <div class="sncp-val-thumb"></div>
            </div>
          </div>
          <!-- 투명도(Alpha) -->
          <div class="sncp-slider-row">
            <span class="sncp-slider-lbl">투명</span>
            <div class="sncp-alpha-track">
              <canvas class="sncp-alpha-canvas" width="152" height="12"></canvas>
              <div class="sncp-alpha-thumb"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- H/S/V/A 수치 입력 -->
      <div class="sncp-inputs">
        <label>H<input class="sncp-h-in" type="number" min="0" max="360"></label>
        <label>S<input class="sncp-s-in" type="number" min="0" max="100"></label>
        <label>V<input class="sncp-v-in" type="number" min="0" max="100"></label>
        <label>A<input class="sncp-a-in" type="number" min="0" max="100"></label>
      </div>

      <div class="sncp-recent-row">
        <span class="sncp-recent-label">최근</span>
        <div class="sncp-recent-swatches"></div>
      </div>
    `;
    this.el = el;
    this.container.appendChild(el);

    this._svCanvas   = el.querySelector(".sncp-sv-canvas");
    this._svCursor   = el.querySelector(".sncp-sv-cursor");
    this._hueCanvas  = el.querySelector(".sncp-hue-canvas");
    this._hueThumb   = el.querySelector(".sncp-hue-thumb");
    this._satCanvas  = el.querySelector(".sncp-sat-canvas");
    this._satThumb   = el.querySelector(".sncp-sat-thumb");
    this._valCanvas  = el.querySelector(".sncp-val-canvas");
    this._valThumb   = el.querySelector(".sncp-val-thumb");
    this._alphaCanvas = el.querySelector(".sncp-alpha-canvas");
    this._alphaThumb  = el.querySelector(".sncp-alpha-thumb");
    this._preview     = el.querySelector(".sncp-preview");

    this._drawAll();
    this._updateUI();
    this._renderRecent();
    this._bindEvents();
  }

  /* ══ DRAW ══ */
  _drawAll() {
    this._drawSVArea();
    this._drawHueBar();
    this._drawSatBar();
    this._drawValBar();
    this._drawAlphaBar();
  }

  _drawSVArea() {
    const ctx = this._svCanvas.getContext("2d");
    const w = this._svCanvas.width, h = this._svCanvas.height;
    const hueHex = this._hsvToHex(this._h, 1, 1);
    const gradH = ctx.createLinearGradient(0, 0, w, 0);
    gradH.addColorStop(0, "#fff");
    gradH.addColorStop(1, hueHex);
    ctx.fillStyle = gradH;
    ctx.fillRect(0, 0, w, h);
    const gradV = ctx.createLinearGradient(0, 0, 0, h);
    gradV.addColorStop(0, "rgba(0,0,0,0)");
    gradV.addColorStop(1, "#000");
    ctx.fillStyle = gradV;
    ctx.fillRect(0, 0, w, h);
  }

  _drawHueBar() {
    const ctx = this._hueCanvas.getContext("2d");
    const w = this._hueCanvas.width, h = this._hueCanvas.height;
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    for (let i = 0; i <= 6; i++) grad.addColorStop(i/6, `hsl(${i*60},100%,50%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  _drawSatBar() {
    const ctx = this._satCanvas.getContext("2d");
    const w = this._satCanvas.width, h = this._satCanvas.height;
    const { r:r0, g:g0, b:b0 } = this._hsvToRgb(this._h, 0, this._v);
    const { r:r1, g:g1, b:b1 } = this._hsvToRgb(this._h, 1, this._v);
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, `rgb(${r0},${g0},${b0})`);
    grad.addColorStop(1, `rgb(${r1},${g1},${b1})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  _drawValBar() {
    const ctx = this._valCanvas.getContext("2d");
    const w = this._valCanvas.width, h = this._valCanvas.height;
    const { r, g, b } = this._hsvToRgb(this._h, this._s, 1);
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, "#000");
    grad.addColorStop(1, `rgb(${r},${g},${b})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  _drawAlphaBar() {
    const ctx = this._alphaCanvas.getContext("2d");
    const w = this._alphaCanvas.width, h = this._alphaCanvas.height;
    const size = 6;
    for (let x = 0; x < w; x += size)
      for (let y = 0; y < h; y += size) {
        ctx.fillStyle = ((Math.floor(x/size)+Math.floor(y/size))%2) ? "#ccc" : "#fff";
        ctx.fillRect(x, y, size, size);
      }
    const {r,g,b} = this._hsvToRgb(this._h, this._s, this._v);
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},1)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  /* ══ UI UPDATE ══ */
  _updateUI() {
    const {r,g,b} = this._hsvToRgb(this._h, this._s, this._v);

    // 미리보기
    this._preview.style.background = `rgba(${r},${g},${b},${this._alpha})`;

    // SV 커서
    const sw = this._svCanvas.width, sh = this._svCanvas.height;
    this._svCursor.style.left = (this._s * sw) + "px";
    this._svCursor.style.top  = ((1 - this._v) * sh) + "px";

    // 슬라이더 thumb
    this._hueThumb.style.left   = (this._h / 360) * this._hueCanvas.width + "px";
    this._satThumb.style.left   = this._s * this._satCanvas.width + "px";
    this._valThumb.style.left   = this._v * this._valCanvas.width + "px";
    this._alphaThumb.style.left = this._alpha * this._alphaCanvas.width + "px";

    // 수치 입력
    this.el.querySelector(".sncp-h-in").value = Math.round(this._h);
    this.el.querySelector(".sncp-s-in").value = Math.round(this._s * 100);
    this.el.querySelector(".sncp-v-in").value = Math.round(this._v * 100);
    this.el.querySelector(".sncp-a-in").value = Math.round(this._alpha * 100);

    this._drawSVArea();
    this._drawSatBar();
    this._drawValBar();
    this._drawAlphaBar();
    this._emit();
  }

  _emit() {
    const {r,g,b} = this._hsvToRgb(this._h, this._s, this._v);
    const hex = this._rgbToHex(r,g,b);
    this.onChange?.({ hex, alpha: this._alpha, rgba: `rgba(${r},${g},${b},${this._alpha})` });
  }

  /* ══ EVENTS ══ */
  _bindEvents() {
    // SV 영역
    this._makeDragger(this._svCanvas, (rx, ry) => {
      this._s = Math.max(0, Math.min(1, rx));
      this._v = Math.max(0, Math.min(1, 1 - ry));
      this._updateUI();
    });
    // Hue
    this._makeDragger(this._hueCanvas, (rx) => {
      this._h = Math.max(0, Math.min(360, rx * 360));
      this._drawSVArea(); this._drawSatBar(); this._drawValBar(); this._drawAlphaBar();
      this._updateUI();
    });
    // Saturation
    this._makeDragger(this._satCanvas, (rx) => {
      this._s = Math.max(0, Math.min(1, rx));
      this._updateUI();
    });
    // Value
    this._makeDragger(this._valCanvas, (rx) => {
      this._v = Math.max(0, Math.min(1, rx));
      this._updateUI();
    });
    // Alpha
    this._makeDragger(this._alphaCanvas, (rx) => {
      this._alpha = Math.max(0, Math.min(1, rx));
      this._drawAlphaBar();
      this._updateUI();
    });

    // 수치 입력
    this.el.querySelector(".sncp-h-in").addEventListener("change", e => {
      this._h = Math.max(0, Math.min(360, +e.target.value));
      this._drawSVArea(); this._drawSatBar(); this._drawValBar(); this._drawAlphaBar();
      this._updateUI(); this._saveRecent(); this._renderRecent();
    });
    this.el.querySelector(".sncp-s-in").addEventListener("change", e => {
      this._s = Math.max(0, Math.min(100, +e.target.value)) / 100;
      this._updateUI(); this._saveRecent(); this._renderRecent();
    });
    this.el.querySelector(".sncp-v-in").addEventListener("change", e => {
      this._v = Math.max(0, Math.min(100, +e.target.value)) / 100;
      this._updateUI(); this._saveRecent(); this._renderRecent();
    });
    this.el.querySelector(".sncp-a-in").addEventListener("change", e => {
      this._alpha = Math.max(0, Math.min(100, +e.target.value)) / 100;
      this._drawAlphaBar(); this._updateUI();
    });
  }

  _makeDragger(el, onMove) {
    const getRelative = e => {
      const rect = el.getBoundingClientRect();
      return {
        rx: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
        ry: Math.max(0, Math.min(1, (e.clientY - rect.top)  / rect.height)),
      };
    };
    const move = e => { const {rx,ry} = getRelative(e); onMove(rx, ry); };
    el.addEventListener("mousedown", e => {
      e.preventDefault();
      move(e);
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup",   up);
        this._saveRecent(); this._renderRecent();
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup",   up);
    });
  }

  /* ══ RECENT ══ */
  _loadRecent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); }
    catch { return []; }
  }

  _saveRecentColor(hex) {
    this._recentColors = [hex, ...this._recentColors.filter(c => c !== hex)].slice(0, 6);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(this._recentColors)); } catch {}
  }

  _saveRecent() {
    const {r,g,b} = this._hsvToRgb(this._h, this._s, this._v);
    this._saveRecentColor(this._rgbToHex(r,g,b));
  }

  _renderRecent() {
    const wrap = this.el?.querySelector(".sncp-recent-swatches");
    if (!wrap) return;
    wrap.innerHTML = this._recentColors.map(c =>
      `<div class="sncp-swatch" style="background:${c}" data-color="${c}"></div>`
    ).join("");
    wrap.querySelectorAll(".sncp-swatch").forEach(el => {
      el.addEventListener("click", () => {
        this._fromHex(el.dataset.color);
        this._drawAll(); this._updateUI();
      });
    });
  }

  /* ══ COLOR MATH ══ */
  _fromHex(hex) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    const {h,s,v} = this._rgbToHsv(r,g,b);
    this._h=h; this._s=s; this._v=v;
  }

  _hsvToRgb(h,s,v) {
    const c=v*s, x=c*(1-Math.abs((h/60)%2-1)), m=v-c;
    let r=0,g=0,b=0;
    if(h<60){r=c;g=x;}else if(h<120){r=x;g=c;}
    else if(h<180){g=c;b=x;}else if(h<240){g=x;b=c;}
    else if(h<300){r=x;b=c;}else{r=c;b=x;}
    return{r:Math.round((r+m)*255),g:Math.round((g+m)*255),b:Math.round((b+m)*255)};
  }

  _hsvToHex(h,s,v) {
    const {r,g,b}=this._hsvToRgb(h,s,v);
    return this._rgbToHex(r,g,b);
  }

  _rgbToHex(r,g,b) {
    return "#"+[r,g,b].map(x=>x.toString(16).padStart(2,"0")).join("");
  }

  _rgbToHsv(r,g,b) {
    r/=255;g/=255;b/=255;
    const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
    let h=0;
    if(d){
      if(max===r) h=((g-b)/d)%6;
      else if(max===g) h=(b-r)/d+2;
      else h=(r-g)/d+4;
      h=Math.round(h*60); if(h<0) h+=360;
    }
    return{h,s:max?d/max:0,v:max};
  }

  getColor() {
    const {r,g,b}=this._hsvToRgb(this._h,this._s,this._v);
    return{hex:this._rgbToHex(r,g,b),alpha:this._alpha,rgba:`rgba(${r},${g},${b},${this._alpha})`};
  }

  setColor(hex) {
    this._fromHex(hex);
    this._drawAll(); this._updateUI();
  }
}
