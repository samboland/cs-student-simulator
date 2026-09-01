// Inkscape-style left toolbox with a small tool state machine.
//
// Tool model: pen, highlighter, text, and image are picked-up utensils that
// only create. Moving, resizing, rubber band selection, and the context menu
// belong to select (see select-tool.mjs), which rides on STAMP mode because a
// STAMP-mode click on the empty layer never creates an editor. Double clicking
// a text box with select enters text editing; committing drops back to select.

import { initSelectTool } from "./select-tool.mjs";

// Values from AnnotationEditorType / AnnotationEditorParamsType in pdf.mjs.
// The viewer bundle does not export them to page scope.
const MODE = {
  NONE: 0,
  FREETEXT: 3,
  HIGHLIGHT: 9,
  STAMP: 13,
  INK: 15,
};
const PARAMS_CREATE = 2;

const ICONS = {
  // Arrow cursor.
  select:
    '<path d="M7 3 L7 18 L11 14.5 L13.5 20.5 L16 19.5 L13.5 13.5 L18.5 13.5 Z" fill="currentColor"/>',
  // Pencil at 45 degrees.
  pen:
    '<path d="M4 20 L5 16 L16 5 L19 8 L8 19 Z M14.5 6.5 L17.5 9.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  // Chisel-tip marker with trail.
  highlighter:
    '<path d="M9 15 L15 9 L18 12 L12 18 L8.5 18.5 Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M4 21 L20 21" stroke="currentColor" stroke-width="2.4" opacity="0.45"/>',
  // Serif capital T.
  text:
    '<path d="M5 5 L19 5 L19 8 M5 5 L5 8 M12 5 L12 19 M9.5 19 L14.5 19" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  // Framed landscape.
  image:
    '<rect x="4" y="5" width="16" height="14" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="10" r="1.5" fill="currentColor"/><path d="M4 16 L9 12.5 L13 15.5 L16.5 13 L20 15.5" fill="none" stroke="currentColor" stroke-width="1.6"/>',
};

const TOOLS = [
  { id: "select", key: "s", mode: MODE.STAMP, label: "Select" },
  { id: "pen", key: "p", mode: MODE.INK, label: "Pen" },
  { id: "highlighter", key: "h", mode: MODE.HIGHLIGHT, label: "Highlighter" },
  { id: "text", key: "t", mode: MODE.FREETEXT, label: "Text" },
  { id: "image", key: "i", mode: MODE.STAMP, label: "Image", create: true },
];

function isEditingTarget(el) {
  return !!el?.closest?.('input, textarea, select, [contenteditable="true"]');
}

export function initToolbox(app, trace) {
  const eventBus = app.eventBus;
  let uiManager = null;
  let active = null;
  let currentMode = MODE.NONE;
  // Set while select's double click put a text box into edit mode; the toolbox
  // shows text without an actual mode switch.
  let transientText = false;
  const buttons = new Map();

  eventBus.on("annotationeditoruimanager", ({ uiManager: m }) => {
    uiManager = m;
    // setSelected calls updateToolbar with the clicked editor's own mode,
    // which would switch tools on a single click. With select active,
    // selection must never change the tool.
    const updateToolbar = m.updateToolbar.bind(m);
    m.updateToolbar = (options) => {
      if (active?.id === "select" || transientText) return;
      updateToolbar(options);
    };
    trace("uiManager captured; updateToolbar guarded");
  });

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("./toolbox.css", import.meta.url).href;
  document.head.append(link);

  const bar = document.createElement("div");
  bar.id = "csToolbox";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-orientation", "vertical");
  for (const tool of TOOLS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "csToolButton";
    btn.title = `${tool.label} (${tool.key.toUpperCase()})`;
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">${ICONS[tool.id]}</svg>`;
    btn.addEventListener("click", () => activate(tool));
    buttons.set(tool.id, btn);
    bar.append(btn);
  }
  document.body.append(bar);

  function markActive(tool) {
    active = tool;
    document.body.dataset.csTool = tool?.id ?? "";
    for (const [id, btn] of buttons) {
      btn.classList.toggle("active", id === tool?.id);
    }
  }

  function dispatchCreate() {
    // Same dispatch as the stock "Add image" params button.
    eventBus.dispatch("switchannotationeditorparams", {
      source: null,
      type: PARAMS_CREATE,
    });
  }

  function activate(tool) {
    transientText = false;
    markActive(tool);
    if (tool.create) {
      // updateMode is async; CREATE dispatched before the mode lands is lost.
      if (currentMode === tool.mode) {
        dispatchCreate();
      } else {
        const once = ({ mode }) => {
          eventBus.off("annotationeditormodechanged", once);
          if (mode === tool.mode && active === tool) dispatchCreate();
        };
        eventBus.on("annotationeditormodechanged", once);
      }
    }
    eventBus.dispatch("switchannotationeditormode", { source: null, mode: tool.mode });
    trace(`tool: ${tool.id} (mode ${tool.mode})`);
  }

  // A mode change we did not initiate (Escape, revert, stock UI leftovers)
  // must not leave a stale highlight.
  eventBus.on("annotationeditormodechanged", ({ mode }) => {
    currentMode = mode;
    if (active?.mode === mode) return;
    markActive(TOOLS.find((t) => t.mode === mode) ?? null);
  });

  window.addEventListener(
    "keydown",
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditingTarget(e.target)) return;
      const tool = TOOLS.find((t) => t.key === e.key.toLowerCase());
      if (!tool) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      activate(tool);
    },
    true
  );

  // STAMP mode creates editors from pasted or dropped images. With select
  // active only annotation payloads may pass (copy and paste of objects).
  window.addEventListener(
    "paste",
    (e) => {
      if (active?.id !== "select") return;
      if (isEditingTarget(e.target)) return;
      if (e.clipboardData?.types.includes("application/pdfjs")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true
  );
  for (const type of ["drop", "dragover"]) {
    window.addEventListener(
      type,
      (e) => {
        if (active?.id !== "select") return;
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      true
    );
  }

  // Double click with select switches to the object's own tool. A text box
  // enters editing (the editor binds dblclick in any mode) and shows the text
  // tool without a mode switch, dropping back to select when focus leaves.
  document.addEventListener(
    "dblclick",
    (e) => {
      if (active?.id !== "select") return;
      if (!(e.target instanceof Element)) return;
      const el = e.target.closest('[id^="pdfjs_internal_editor_"]');
      if (!el) return;
      const mode = uiManager?.getEditor(el.id)?.mode;
      if (mode === MODE.FREETEXT) {
        transientText = true;
        markActive(TOOLS.find((t) => t.id === "text"));
      } else if (mode === MODE.INK) {
        activate(TOOLS.find((t) => t.id === "pen"));
      } else if (mode === MODE.HIGHLIGHT) {
        activate(TOOLS.find((t) => t.id === "highlighter"));
      }
    },
    true
  );
  const leaveTransientText = () => {
    if (!transientText) return;
    transientText = false;
    markActive(TOOLS.find((t) => t.id === "select"));
  };
  document.addEventListener("focusin", (e) => {
    if (!transientText) return;
    if (e.target instanceof Element && e.target.closest(".freeTextEditor")) return;
    leaveTransientText();
  });
  window.addEventListener("keyup", (e) => {
    if (e.key === "Escape") leaveTransientText();
  });

  initSelectTool({
    isActive: () => active?.id === "select" && !transientText,
    getUiManager: () => uiManager,
    trace,
  });

  return {
    activateDefault() {
      activate(TOOLS[0]);
    },
  };
}
