import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

// Temporary file-based debug logging so init/save handshakes can be inspected
// outside the dev host. Appends to .debug.log at the extension root.
let logPath: string | undefined;

export function initDebugLog(context: vscode.ExtensionContext): void {
  logPath = path.join(context.extensionUri.fsPath, ".debug.log");
}

export function debugLog(message: string): void {
  if (!logPath) return;
  try {
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // logging must never break the editor
  }
}
