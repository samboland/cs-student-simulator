import * as vscode from "vscode";

export class PdfDocument implements vscode.CustomDocument {
  private constructor(
    public readonly uri: vscode.Uri,
    /** Bytes the document was opened with (disk content, or backup on hot-exit restore). */
    public initialBytes: Uint8Array
  ) {}

  static async create(uri: vscode.Uri, backupId: string | undefined): Promise<PdfDocument> {
    const readUri = backupId ? vscode.Uri.parse(backupId) : uri;
    const bytes =
      uri.scheme === "untitled"
        ? new Uint8Array()
        : await vscode.workspace.fs.readFile(readUri);
    return new PdfDocument(uri, bytes);
  }

  private readonly onDidDisposeEmitter = new vscode.EventEmitter<void>();
  readonly onDidDispose = this.onDidDisposeEmitter.event;

  dispose(): void {
    this.onDidDisposeEmitter.fire();
    this.onDidDisposeEmitter.dispose();
  }
}
