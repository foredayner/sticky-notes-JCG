/**
 * ImageImporter.mjs
 *
 * 로컬 파일(드래그 드롭 / 클립보드 / File 객체)을
 * base64 data URL로 변환 + 자동 압축/리사이즈.
 *
 * 처리 흐름:
 *   File → createImageBitmap → Canvas 리사이즈 → toDataURL(webp/jpeg, quality)
 *
 * 용량 기준 (자동):
 *   원본 < 200KB  → 그대로 사용
 *   원본 < 1MB    → 최대 1200px, quality 0.85
 *   원본 < 5MB    → 최대 1600px, quality 0.80
 *   원본 >= 5MB   → 최대 2000px, quality 0.75
 */

export class ImageImporter {

  /** File 객체 → { src: dataURL, w: number, h: number } | null */
  static async fromFile(file) {
    if (!file || !file.type.startsWith("image/")) return null;

    try {
      const { maxPx, quality } = this._compressionParams(file.size);
      const bitmap = await createImageBitmap(file);

      const { w, h } = this._fitSize(bitmap.width, bitmap.height, maxPx);

      const canvas  = document.createElement("canvas");
      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();

      // webp 지원 여부 확인 후 포맷 결정
      const fmt = this._supportsWebP() ? "image/webp" : "image/jpeg";
      const src = canvas.toDataURL(fmt, quality);

      // 압축 결과 로그 (개발용)
      const origKB  = Math.round(file.size / 1024);
      const compKB  = Math.round(src.length * 0.75 / 1024); // base64 → bytes 근사
      console.log(`[ImageImporter] ${file.name} ${origKB}KB → ${compKB}KB (${w}×${h})`);

      return { src, w, h };
    } catch (err) {
      console.error("[ImageImporter] 변환 실패:", err);
      ui.notifications?.warn(`이미지 불러오기 실패: ${file.name}`);
      return null;
    }
  }

  /** URL/경로 이미지의 자연 크기를 측정 */
  static measureImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload  = () => resolve({ w: img.naturalWidth,  h: img.naturalHeight });
      img.onerror = () => resolve({ w: 0, h: 0 });
      img.src = src;
    });
  }

  /* ── 내부 유틸 ── */

  static _compressionParams(bytes) {
    if (bytes < 200_000)   return { maxPx: Infinity, quality: 0.92 };
    if (bytes < 1_000_000) return { maxPx: 1200,     quality: 0.85 };
    if (bytes < 5_000_000) return { maxPx: 1600,     quality: 0.80 };
    return                        { maxPx: 2000,      quality: 0.75 };
  }

  static _fitSize(nw, nh, maxPx) {
    if (maxPx === Infinity || (nw <= maxPx && nh <= maxPx)) {
      return { w: nw, h: nh };
    }
    const ratio = Math.min(maxPx / nw, maxPx / nh);
    return {
      w: Math.round(nw * ratio),
      h: Math.round(nh * ratio),
    };
  }

  static _supportsWebP() {
    if (this.__webpCache !== undefined) return this.__webpCache;
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    this.__webpCache = c.toDataURL("image/webp").startsWith("data:image/webp");
    return this.__webpCache;
  }
}
