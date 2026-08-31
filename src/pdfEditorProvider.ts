import * as vscode from "vscode";
import { PdfDocument } from "./pdfDocument";
import { getViewerHtml } from "./viewerHtml";
import { debugLog } from "./debugLog";

/**
 * Node Buffers (what workspace.fs.readFile really returns) do not survive
 * webview message serialization intact — copy into a standalone ArrayBuffer.
 */
function toPlainArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

type WebviewMessage =
  | { type: "ready" }
  | { type: "edited" }
  | { type: "requestWorkbenchSave" }
  | { type: "saveResult"; requestId: number; bytes?: Uint8Array; error?: string }
  | { type: "log"; level: "info" | "warn" | "error"; message: string };

export class PdfEditorProvider implements vscode.CustomEditorProvider<PdfDocument> {
  static readonly viewType = "csStudentSimulator.pdf";

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      PdfEditorProvider.viewType,
      new PdfEditorProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    );
  }

  private readonly webviews = new Map<PdfDocument, vscode.WebviewPanel>();
  private readonly pendingSaves = new Map<
    number,
    { resolve: (bytes: Uint8Array) => void; reject: (err: Error) => void }
  >();
  private nextRequestId = 1;
  private readonly output = vscode.window.createOutputChannel("CS Student Simulator");

  constructor(private readonly context: vscode.ExtensionContext) {}

  private readonly changeEmitter =
    new vscode.EventEmitter<vscode.CustomDocumentContentChangeEvent<PdfDocument>>();
  readonly onDidChangeCustomDocument = this.changeEmitter.event;

  async openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext
  ): Promise<PdfDocument> {
    return PdfDocument.create(uri, openContext.backupId);
  }

  async resolveCustomEditor(document: PdfDocument, panel: vscode.WebviewPanel): Promise<void> {
    this.webviews.set(document, panel);
    panel.onDidDispose(() => this.webviews.delete(document));

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };
    panel.webview.html = await getViewerHtml(this.context, panel.webview);

    panel.webview.onDidReceiveMessage((msg: WebviewMessage) => {
      debugLog(`recv from webview: ${msg.type}`);
      switch (msg.type) {
        case "ready":
          debugLog(`posting init, ${document.initialBytes.byteLength} bytes`);
          void panel.webview
            .postMessage({ type: "init", bytes: toPlainArrayBuffer(document.initialBytes) })
            .then((delivered) => debugLog(`init delivered: ${delivered}`));
          break;
        case "edited":
          this.changeEmitter.fire({ document });
          break;
        case "requestWorkbenchSave":
          void vscode.commands.executeCommand("workbench.action.files.save");
          break;
        case "saveResult": {
          const pending = this.pendingSaves.get(msg.requestId);
          if (!pending) break;
          this.pendingSaves.delete(msg.requestId);
          if (msg.error !== undefined || !msg.bytes) {
            pending.reject(new Error(msg.error ?? "webview returned no bytes"));
          } else {
            pending.resolve(new Uint8Array(msg.bytes));
          }
          break;
        }
        case "log":
          this.output.appendLine(`[webview:${msg.level}] ${msg.message}`);
          debugLog(`[webview:${msg.level}] ${msg.message}`);
          break;
      }
    });
  }

  /** Asks the webview to run PDFViewerApplication.pdfDocument.saveDocument(). */
  private requestBytes(document: PdfDocument, token: vscode.CancellationToken): Promise<Uint8Array> {
    const panel = this.webviews.get(document);
    if (!panel) {
      return Promise.reject(new Error("No editor open for this PDF"));
    }
    const requestId = this.nextRequestId++;
    return new Promise<Uint8Array>((resolve, reject) => {
      this.pendingSaves.set(requestId, { resolve, reject });
      token.onCancellationRequested(() => {
        this.pendingSaves.delete(requestId);
        reject(new Error("cancelled"));
      });
      void panel.webview.postMessage({ type: "requestSave", requestId });
    });
  }

  async saveCustomDocument(document: PdfDocument, token: vscode.CancellationToken): Promise<void> {
    const bytes = await this.requestBytes(document, token);
    await vscode.workspace.fs.writeFile(document.uri, bytes);
    document.initialBytes = bytes;
  }

  async saveCustomDocumentAs(
    document: PdfDocument,
    destination: vscode.Uri,
    token: vscode.CancellationToken
  ): Promise<void> {
    const bytes = await this.requestBytes(document, token);
    await vscode.workspace.fs.writeFile(destination, bytes);
  }

  async revertCustomDocument(document: PdfDocument): Promise<void> {
    const bytes = await vscode.workspace.fs.readFile(document.uri);
    document.initialBytes = bytes;
    const panel = this.webviews.get(document);
    if (panel) {
      await panel.webview.postMessage({ type: "init", bytes: toPlainArrayBuffer(bytes) });
    }
  }

  async backupCustomDocument(
    document: PdfDocument,
    backupContext: vscode.CustomDocumentBackupContext,
    token: vscode.CancellationToken
  ): Promise<vscode.CustomDocumentBackup> {
    const bytes = await this.requestBytes(document, token);
    await vscode.workspace.fs.writeFile(backupContext.destination, bytes);
    return {
      id: backupContext.destination.toString(),
      delete: async () => {
        try {
          await vscode.workspace.fs.delete(backupContext.destination);
        } catch {
          // already gone
        }
      },
    };
  }
}
