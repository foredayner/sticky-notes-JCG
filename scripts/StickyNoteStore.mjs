/**
 * sticky-notes / StickyNoteStore.mjs
 * 
 * 씬과 무관하게 월드 전체에 스티커 메모 데이터를 영속 보관.
 * 저장소: game.settings (world scope) → JSON 직렬화 배열.
 *
 * 각 메모 데이터 구조:
 * {
 *   id        : string   (crypto.randomUUID)
 *   x         : number   (캔버스 픽셀 기준)
 *   y         : number
 *   width     : number
 *   height    : number
 *   bgColor   : string   (CSS hex, default "#FFF9A0")
 *   textColor : string   (CSS hex, default "#3a3000")
 *   fontSize  : number   (px, default 13)
 *   text      : string   (메모 텍스트)
 *   layers    : Array<ImageLayerData>
 *   sceneId   : null     (null = 모든 씬에 표시, 또는 특정 sceneId 문자열)
 *   createdAt : number   (Date.now())
 * }
 *
 * ImageLayerData:
 * {
 *   id      : string
 *   src     : string   (Foundry 상대 경로 또는 data URL)
 *   x       : number   (레이어 내부 offset px)
 *   y       : number
 *   width   : number
 *   height  : number
 *   opacity : number   (0–1)
 * }
 */

const SETTING_KEY = "stickyNotesData";
const MODULE_ID   = "sticky-notes-jcg";

export class StickyNoteStore {

  static get all() {
    return game.settings.get(MODULE_ID, SETTING_KEY) ?? [];
  }

  static async save(notes) {
    await game.settings.set(MODULE_ID, SETTING_KEY, notes);
  }

  static async add(noteData) {
    const notes = this.all;
    notes.push(noteData);
    await this.save(notes);
    return noteData;
  }

  static async update(id, patch) {
    const notes = this.all;
    const idx = notes.findIndex(n => n.id === id);
    if (idx === -1) return null;
    notes[idx] = { ...notes[idx], ...patch };
    await this.save(notes);
    return notes[idx];
  }

  static async remove(id) {
    const notes = this.all.filter(n => n.id !== id);
    await this.save(notes);
  }

  static getById(id) {
    return this.all.find(n => n.id === id) ?? null;
  }

  /** 현재 캔버스에 표시해야 할 메모 목록 (sceneId 필터) */
  static forCurrentScene() {
    // sceneId === null → 모든 씬에 표시
    // sceneId === canvas.scene.id → 해당 씬에만 표시
    const sceneId = canvas?.scene?.id ?? null;
    return this.all.filter(n => n.sceneId === null || n.sceneId === sceneId);
  }

  /** 새 메모 기본값 생성 */
  static makeDefault({ x, y, width, height }) {
    return {
      id       : foundry.utils.randomID(16),
      x, y, width, height,
      bgColor   : "#FFF9A0",
      textColor : "#3a3000",
      fontSize  : 13,
      text      : "",
      layers    : [],
      sceneId   : null,
      createdAt : Date.now(),
    };
  }
}
