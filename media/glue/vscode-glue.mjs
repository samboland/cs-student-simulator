// Bridge between the stock PDF.js viewer and the VS Code custom editor host.
// Loaded as a module after viewer.mjs (injected by scripts/vendor-pdfjs.mjs).

const vscode = acquireVsCodeApi();
const post = (msg) => vscode.postMessage(msg);

function toUint8(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (bytes?.buffer instanceof ArrayBuffer) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset ?? 0, bytes.byteLength);
  }
  // Serialized Node Buffer ({type:"Buffer", data:[...]}) or plain number array.
  if (Array.isArray(bytes)) return new Uint8Array(bytes);
  if (Array.isArray(bytes?.data)) return new Uint8Array(bytes.data);
  throw new Error(
    `unsupported byte payload from extension host (${bytes?.constructor?.name ?? typeof bytes})`
  );
}

const trace = (message) => post({ type: "log", level: "info", message });

// PDF.js warns "Setting up fake worker." when the web worker can't be spawned
// and parsing falls back to the main thread — surface that in the debug log.
const realWarn = console.warn.bind(console);
console.warn = (...args) => {
  const text = args.map(String).join(" ");
  if (/worker/i.test(text)) {
    post({ type: "log", level: "warn", message: text });
  }
  realWarn(...args);
};

const app = window.PDFViewerApplication;

// The webview document origin differs from the resource origin, so PDF.js
// can't spawn its worker from the resource URL and silently falls back to
// main-thread parsing ("Setting up fake worker"). Re-serve the worker script
// as a same-origin blob URL instead.
async function useBlobWorker() {
  const res = await fetch("../build/pdf.worker.mjs");
  if (!res.ok) throw new Error(`worker fetch failed: ${res.status}`);
  const source = await res.text();
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  window.PDFViewerApplicationOptions.set("workerSrc", url);
  trace("workerSrc set to same-origin blob URL");
}
trace(`glue loaded; app=${typeof app}, initializedPromise=${typeof app?.initializedPromise}`);

window.addEventListener("message", async (event) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case "init": {
        trace(`init received; bytes ctor=${msg.bytes?.constructor?.name}, len=${msg.bytes?.byteLength ?? msg.bytes?.length}`);
        await app.initializedPromise;
        await useBlobWorker().catch((err) =>
          post({ type: "log", level: "warn", message: `blob worker setup failed: ${err.message}` })
        );
        trace("app initialized, calling open()");
        // PDF.js consumes (detaches) the buffer it is given — copy first so a
        // re-init (revert) or retry never hands over a detached buffer.
        await app.open({ data: toUint8(msg.bytes).slice() });
        trace(`open() resolved; pages=${app.pagesCount}`);
        const toolbar = document.getElementById("toolbarViewer");
        trace(
          `layout: innerWidth=${window.innerWidth} bodyWidth=${document.body.offsetWidth} ` +
            `bodyPadding=${getComputedStyle(document.body).padding} ` +
            `toolbarWidth=${toolbar?.offsetWidth} toolbarLeft=${toolbar?.getBoundingClientRect().left}`
        );
        break;
      }
      case "requestSave": {
        try {
          const data = await app.pdfDocument.saveDocument();
          post({ type: "saveResult", requestId: msg.requestId, bytes: data });
        } catch (err) {
          post({
            type: "saveResult",
            requestId: msg.requestId,
            error: String(err?.message ?? err),
          });
        }
        break;
      }
    }
  } catch (err) {
    post({ type: "log", level: "error", message: String(err?.message ?? err) });
  }
});

// VS Code owns save: keep the viewer's own Ctrl/Cmd+S (download) out of the way.
window.addEventListener(
  "keydown",
  (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      e.stopImmediatePropagation();
      post({ type: "requestWorkbenchSave" });
    }
  },
  true
);

(async () => {
  await app.initializedPromise;
  trace("initializedPromise resolved, wiring eventBus + posting ready");
  const onStatesChanged = ({ details }) => {
    if (details?.hasSomethingToUndo) {
      post({ type: "edited" });
    }
  };
  // "editingstateschanged" since PDF.js 6; older builds used the longer name.
  app.eventBus.on("editingstateschanged", onStatesChanged);
  app.eventBus.on("annotationeditorstateschanged", onStatesChanged);
  post({ type: "ready" });
})().catch((err) => {
  post({ type: "log", level: "error", message: `glue init failed: ${err?.message ?? err}` });
});
