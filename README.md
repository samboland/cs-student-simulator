# CS Student Simulator

Annotate PDFs without leaving VS Code. Opens `.pdf` files in a full PDF.js
viewer with the native annotation editor enabled — highlight, ink, free text,
stamp images, signatures — and saves your annotations **directly into the PDF
file** as standard PDF annotation objects (an incremental update appended to
the file, not a regenerated document). Other PDF viewers can read and keep
editing them.

## Usage

Open any `.pdf`. Annotate with the toolbar tools. Save with `Ctrl+S` like any
other file. Dirty-state, revert, save-as, and hot exit all work the way they do
for text files.

## Building from source

The PDF.js viewer is vendored at build time and not committed:

```
npm install
npm run vendor     # downloads + patches the PDF.js prebuilt viewer into media/pdfjs/
npm run compile
```

Then `F5` in VS Code to launch the extension development host, and open
`test-fixtures/sample.pdf`.

## Roadmap

- Acrobat-style content editing (via a headless LibreOffice round-trip)
- Page operations (merge, split, rotate, reorder)

## License and credits

GPL-3.0-only. See [LICENSE](LICENSE).

- Viewer-in-webview approach modeled on
  [tomoki1207/vscode-pdfviewer](https://github.com/tomoki1207/vscode-pdfviewer) (MIT).
- Rendering and annotation editing by [PDF.js](https://mozilla.github.io/pdf.js/)
  (Apache-2.0, notice in `third-party-licenses/`), downloaded by
  `scripts/vendor-pdfjs.mjs` at build time.
