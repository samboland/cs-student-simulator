# CS Student Simulator

VS Code extension for annotating PDFs without leaving the IDE. The name is a joke; there is no simulator. GPLv3.

A custom editor (`csStudentSimulator.pdf`) hosts the stock PDF.js viewer in a webview with its annotation editor enabled. Ctrl+S writes the annotations back into the original PDF as an incremental update via `saveDocument()`. No merge, no regeneration; other viewers can read and keep editing them.

Deliberately out of scope for now: LibreOffice content editing (planned later), page operations, marketplace polish. Do not drift into these or into "shipping v1" framing.

Next planned phase: replace the stock viewer chrome with an Inkscape-style layout (left toolbox, contextual options bar, objects panel, single-key tool switching) using Xournal++'s pen/highlighter tool flow. Both are GPLv2-or-later, so porting their assets and logic directly is allowed.

## Build

```
npm install
npm run vendor    # downloads PDF.js prebuilt viewer into media/pdfjs/ (gitignored) and patches it
npm run compile   # tsc --noEmit + esbuild -> dist/extension.js
```

F5 launches the extension development host. Open test-fixtures/sample.pdf there.

## Architecture map

- `scripts/vendor-pdfjs.mjs`: pins the PDF.js version, strips the stock CSP meta (its `base-uri 'none'` breaks the webview), injects `%CSP%` / `%BASE%` / `%GLUE%` / `%OVERRIDES%` placeholders, blanks the demo defaultUrl.
- `src/viewerHtml.ts`: fills those placeholders at runtime with `asWebviewUri` values.
- `src/pdfEditorProvider.ts`: CustomEditorProvider save lifecycle. Bytes go to the webview as a plain ArrayBuffer; Node Buffers do not survive webview serialization.
- `media/glue/vscode-glue.mjs`: webview side. Feeds bytes to `PDFViewerApplication.open`, runs `saveDocument()` on request, posts `edited` on the `editingstateschanged` event (PDF.js 6 name; older builds called it `annotationeditorstateschanged`), serves the worker as a same-origin blob URL to avoid the fake-worker fallback.
- `media/glue/vscode-overrides.css`: neutralizes VS Code's injected body padding (it shifts the whole viewer off-frame) and centers the toolbar.
- `media/glue/toolbox.mjs` + `toolbox.css`: left toolbox and tool state machine. Tool model: pen/highlighter/text/image only create (pen and highlighter get pointer-events: none on editors); select owns move, marquee, context menu. Select rides on STAMP mode because a STAMP click on the empty layer never creates. Single-click selection must not change tools: uiManager.updateToolbar is monkey-patched to a no-op while select is active, since setSelected dispatches a mode switch to the clicked editor's type. Double click switches to the object's own tool (text transiently, without a mode switch).
- `media/glue/select-tool.mjs`: rubber band selection and context menu on top of the uiManager (captured from the "annotationeditoruimanager" eventBus event). Copy/cut/paste call uiManager methods with a fake ClipboardEvent holding a module-level DataTransfer.

## Working efficiently here

- Verify, don't assume. The annotation UI once "worked" while every save silently dropped; the file on disk is the truth. After a save test, check that test-fixtures/sample.pdf grew and contains annotation objects.
- `.debug.log` at the repo root records the extension/webview handshake. Read it before theorizing. Glue and CSS changes need no rebuild, only a dev-host window reload; only src/ changes need `npm run compile`.
- The dev host reload must be done by a human. Batch your fixes so each reload tests several at once.
- You can screenshot the dev host yourself (foreground the "Extension Development Host" window via Win32, then capture). Prefer logged numbers over eyeballing screenshots for layout questions.
- PDF.js pins matter. On version bumps, re-check the vendor patches still match and the eventBus names still exist.

## Writing style, non-negotiable

Applies to all prose in this repo: docs, comments, commit messages, README, and
chat replies.

- No em dashes. Ever. Use a period, comma, colon, or parentheses.
- No AI prose patterns: no "not just X, but Y", no rule-of-three flourishes, no "seamless", "robust", "comprehensive", "delve", "leverage", no negative parallelism, no promotional adjectives, no summary sentences that restate what was just said.
- Comments only state constraints the code cannot show. No narration, no justification of changes.
- Plain sentences. If a line reads like marketing or a model wrote it, rewrite it.
- Chat replies: keep them short. Say what changed, whether it works, what to do
  next. Common words over fancy ones. No preamble, no recap of what was just
  said, no listing every file touched. One or two lines beats a section.
