// Select tool behaviors PDF.js does not provide: rubber band selection and a
// context menu. Click select, drag move, and resize come from the editors
// themselves, which stay interactive while STAMP mode hosts the select tool.

const EDITOR_SELECTOR = '[id^="pdfjs_internal_editor_"]';
const DRAG_THRESHOLD = 4;

// uiManager copy/cut/paste take a ClipboardEvent but only touch these members,
// so a held DataTransfer stands in for the system clipboard.
const fakeClipboardEvent = (dt) => ({ preventDefault() {}, clipboardData: dt });

function intersects(a, b) {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

export function initSelectTool({ isActive, getUiManager, trace }) {
  let clipboard = null;

  // ---- rubber band ----------------------------------------------------------

  let band = null;

  function endBand() {
    band?.box?.remove();
    band?.ac.abort();
    band = null;
  }

  function applyBand(rect, additive) {
    const ui = getUiManager();
    if (!ui) return;
    const hits = [];
    for (const el of document.querySelectorAll(EDITOR_SELECTOR)) {
      if (intersects(el.getBoundingClientRect(), rect)) hits.push(el);
    }
    if (!additive) ui.unselectAll();
    let selected = 0;
    for (const el of hits) {
      if (el.classList.contains("selectedEditor")) continue;
      const editor = ui.getEditor(el.id);
      if (editor) {
        ui.toggleSelected(editor);
        selected++;
      }
    }
    trace(`marquee: ${selected} selected (${hits.length} hit)`);
  }

  // Press-drag: the editor's own pointerdown only installs drag listeners
  // when the editor is already selected, forcing click-then-drag. Selecting
  // here in the capture phase makes a single press start the drag. Modifier
  // clicks keep the stock toggle semantics.
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (!isActive() || e.button !== 0) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (!(e.target instanceof Element)) return;
      const el = e.target.closest(EDITOR_SELECTOR);
      if (!el) return;
      const ui = getUiManager();
      const editor = ui?.getEditor(el.id);
      if (!editor) return;
      // Free highlighter strokes move like ink. Text-anchored highlights stay
      // glued to their text (their serialization is caret-based).
      if (!editor._isDraggable && editor._drawOutlines?.isFree) {
        editor._isDraggable = true;
      }
      if (!el.classList.contains("selectedEditor")) ui.setSelected(editor);
    },
    true
  );

  window.addEventListener(
    "pointerdown",
    (e) => {
      if (!isActive() || e.button !== 0) return;
      if (!(e.target instanceof Element) || !e.target.classList.contains("annotationEditorLayer")) {
        return;
      }
      // The layer's own pointerdown/pointerup pair must not run; unselect on
      // plain click is handled here instead.
      e.preventDefault();
      e.stopImmediatePropagation();
      hideMenu();
      const ac = new AbortController();
      band = { x: e.clientX, y: e.clientY, box: null, ac };
      const opts = { capture: true, signal: ac.signal };
      window.addEventListener(
        "pointermove",
        (ev) => {
          const rect = normRect(band.x, band.y, ev.clientX, ev.clientY);
          if (!band.box) {
            if (rect.width < DRAG_THRESHOLD && rect.height < DRAG_THRESHOLD) return;
            band.box = document.createElement("div");
            band.box.className = "csMarquee";
            document.body.append(band.box);
          }
          Object.assign(band.box.style, {
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
          });
        },
        opts
      );
      window.addEventListener(
        "pointerup",
        (ev) => {
          if (band.box) {
            applyBand(normRect(band.x, band.y, ev.clientX, ev.clientY), ev.shiftKey);
          } else if (!ev.shiftKey) {
            getUiManager()?.unselectAll();
          }
          endBand();
        },
        opts
      );
      window.addEventListener("blur", endBand, { signal: ac.signal });
    },
    true
  );

  function normRect(x1, y1, x2, y2) {
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    return {
      left,
      top,
      right: Math.max(x1, x2),
      bottom: Math.max(y1, y2),
      width: Math.abs(x1 - x2),
      height: Math.abs(y1 - y2),
    };
  }

  // ---- context menu ---------------------------------------------------------

  const ITEMS = [
    {
      id: "cut",
      label: "Cut",
      keys: "Ctrl+X",
      enabled: (ui) => ui.hasSelection,
      run(ui) {
        clipboard = new DataTransfer();
        ui.cut(fakeClipboardEvent(clipboard));
      },
    },
    {
      id: "copy",
      label: "Copy",
      keys: "Ctrl+C",
      enabled: (ui) => ui.hasSelection,
      run(ui) {
        clipboard = new DataTransfer();
        ui.copy(fakeClipboardEvent(clipboard));
      },
    },
    {
      id: "paste",
      label: "Paste",
      keys: "Ctrl+V",
      enabled: () => !!clipboard?.getData("application/pdfjs"),
      run(ui) {
        ui.paste(fakeClipboardEvent(clipboard));
      },
    },
    {
      id: "duplicate",
      label: "Duplicate",
      keys: "Ctrl+D",
      enabled: (ui) => ui.hasSelection,
      run(ui) {
        const dt = new DataTransfer();
        ui.copy(fakeClipboardEvent(dt));
        ui.paste(fakeClipboardEvent(dt));
      },
    },
    {
      id: "delete",
      label: "Delete",
      keys: "Del",
      enabled: (ui) => ui.hasSelection,
      run(ui) {
        ui.delete();
      },
    },
    { separator: true },
    {
      id: "selectAll",
      label: "Select All",
      keys: "Ctrl+A",
      enabled: () => true,
      run(ui) {
        ui.selectAll();
      },
    },
  ];

  let menu = null;

  function hideMenu() {
    menu?.remove();
    menu = null;
  }

  function showMenu(x, y) {
    hideMenu();
    const ui = getUiManager();
    if (!ui) return;
    menu = document.createElement("div");
    menu.id = "csContextMenu";
    for (const item of ITEMS) {
      if (item.separator) {
        menu.append(Object.assign(document.createElement("div"), { className: "csMenuSep" }));
        continue;
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "csMenuItem";
      btn.disabled = !item.enabled(ui);
      btn.innerHTML = `<span>${item.label}</span><span class="csMenuKeys">${item.keys}</span>`;
      btn.addEventListener("click", () => {
        hideMenu();
        item.run(ui);
        trace(`context menu: ${item.id}`);
      });
      menu.append(btn);
    }
    document.body.append(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(x, window.innerWidth - r.width - 4)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - r.height - 4)}px`;
  }

  window.addEventListener(
    "contextmenu",
    (e) => {
      if (!isActive()) return;
      if (!(e.target instanceof Element)) return;
      const editorEl = e.target.closest(EDITOR_SELECTOR);
      if (!editorEl && !e.target.closest(".annotationEditorLayer")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const ui = getUiManager();
      if (editorEl && ui && !editorEl.classList.contains("selectedEditor")) {
        const editor = ui.getEditor(editorEl.id);
        if (editor) ui.setSelected(editor);
      }
      showMenu(e.clientX, e.clientY);
    },
    true
  );

  window.addEventListener(
    "pointerdown",
    (e) => {
      if (menu && !(e.target instanceof Element && menu.contains(e.target))) hideMenu();
    },
    true
  );
  window.addEventListener("wheel", hideMenu, { capture: true, passive: true });
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") hideMenu();
    },
    true
  );
}
