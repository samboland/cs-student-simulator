import * as vscode from "vscode";
import { PdfEditorProvider } from "./pdfEditorProvider";
import { initDebugLog, debugLog } from "./debugLog";

export function activate(context: vscode.ExtensionContext): void {
  initDebugLog(context);
  debugLog("extension activated");
  context.subscriptions.push(PdfEditorProvider.register(context));
}

export function deactivate(): void {}
