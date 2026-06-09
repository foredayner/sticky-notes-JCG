/**
 * sticky-notes / main.mjs  (v5 — debug)
 */

import { StickyNoteStore }   from "./StickyNoteStore.mjs";
import { StickyNoteManager } from "./StickyNoteManager.mjs";

const MODULE_ID = "sticky-notes";

/* ══ INIT ══ */
Hooks.once("init", () => {

  game.settings.register(MODULE_ID, "stickyNotesData", {
    name: "Sticky Notes Data", scope: "world",
    config: false, type: Array, default: [],
  });

  game.settings.register(MODULE_ID, "allowPlayerCreate", {
    name: "플레이어 메모 생성 허용",
    hint: "활성화 시 플레이어도 스티커 메모를 생성/편집할 수 있습니다.",
    scope: "world", config: true, type: Boolean, default: true,
  });

  StickyNoteManager.init();
});

/* ══ READY ══ */
Hooks.once("ready", () => {
});

/* ══ 씬 컨트롤 — 독립 그룹 ══ */
Hooks.on("getSceneControlButtons", (controls) => {

  const canUse = game.user.isGM ||
    (game.settings.get(MODULE_ID, "allowPlayerCreate") ?? true);

  const toolDef = {
    name    : "sticky-note-draw",
    title   : "스티커 메모 그리기",
    icon    : "fas fa-sticky-note",
    visible : canUse,
    toggle  : false,
    order   : 0,
  };

  const clearAllDef = {
    name    : "sticky-note-clear",
    title   : "전체 삭제",
    icon    : "fas fa-trash",
    visible : game.user.isGM,
    toggle  : false,
    order   : 1,
    onClick : () => {
      foundry.applications.api.DialogV2.confirm({
        window : { title: "스티커 메모 전체 삭제" },
        content: "<p>모든 스티커 메모를 삭제하시겠습니까?</p>",
      }).then(async ok => {
        if (!ok) return;
        const all = StickyNoteStore.all;
        for (const n of all) {
          StickyNoteManager.removeWidget(n.id);
          StickyNoteManager.syncToClients("remove", { id: n.id });
        }
        await StickyNoteStore.save([]);
      });
    },
  };

  // V14
  if (controls && !Array.isArray(controls) && typeof controls === "object") {
    controls["stickynotes"] = {
      name      : "stickynotes",
      title     : "스티커 메모",
      icon      : "fas fa-sticky-note",
      visible   : canUse,
      layer     : "notesLayer",
      activeTool: "sticky-note-draw",
      tools     : {
        "sticky-note-draw"  : { ...toolDef,      order: 0 },
        "sticky-note-clear" : { ...clearAllDef,  order: 1 },
      },
    };
    return;
  }

  // V13 이하
  if (Array.isArray(controls)) {
    const existing = controls.find(c => c.name === "stickynotes");
    if (!existing) {
      controls.push({
        name      : "stickynotes",
        title     : "스티커 메모",
        icon      : "fas fa-sticky-note",
        layer     : "notesLayer",
        visible   : canUse,
        activeTool: "sticky-note-draw",
        tools     : [toolDef, clearAllDef],
      });
    }
  }
});

/* ══ canvasReady ══ */
Hooks.on("canvasReady", () => {
  StickyNoteManager.setupLayer();
  StickyNoteManager._bindMouseDown();
});

Hooks.on("canvasInit", () => {
  StickyNoteManager._bindMouseDown();
});
