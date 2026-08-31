import * as vscode from "vscode";

/**
 * Loads the vendored (pre-patched) PDF.js viewer.html and fills in the
 * webview-specific placeholders inserted by scripts/vendor-pdfjs.mjs.
 */
export async function getViewerHtml(
  context: vscode.ExtensionContext,
  webview: vscode.Webview
): Promise<string> {
  const htmlUri = vscode.Uri.joinPath(context.extensionUri, "media", "pdfjs", "web", "viewer.html");
  const raw = Buffer.from(await vscode.workspace.fs.readFile(htmlUri)).toString("utf8");

  const webRoot = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "media", "pdfjs", "web")
  );
  const glueUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "media", "glue", "vscode-glue.mjs")
  );

  const csp = [
    `default-src 'none'`,
    `script-src ${webview.cspSource}`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `img-src ${webview.cspSource} blob: data:`,
    `font-src ${webview.cspSource}`,
    `worker-src ${webview.cspSource} blob:`,
    `connect-src ${webview.cspSource} blob: data:`,
  ].join("; ");

  return raw
    .replace("%CSP%", csp)
    .replace("%BASE%", `${webRoot.toString()}/`)
    .replace("%GLUE%", glueUri.toString());
}
