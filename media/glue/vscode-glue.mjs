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
  throw new Error("unsupported byte payload from extension host");
}

const app = window.PDFViewerApplication;

window.addEventListener("message", async (event) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case "init": {
        await app.initializedPromise;
        // PDF.js consumes (detaches) the buffer it is given — copy first so a
        // re-init (revert) or retry never hands over a detached buffer.
        await app.open({ data: toUint8(msg.bytes).slice() });
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
  app.eventBus.on("annotationeditorstateschanged", ({ details }) => {
    if (details?.hasSomethingToUndo) {
      post({ type: "edited" });
    }
  });
  post({ type: "ready" });
})().catch((err) => {
  post({ type: "log", level: "error", message: `glue init failed: ${err?.message ?? err}` });
});
