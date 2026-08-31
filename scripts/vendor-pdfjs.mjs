// Downloads the prebuilt PDF.js generic viewer and patches it for use inside a
// VS Code webview. Output goes to media/pdfjs/ (gitignored — rerun after clone).
import { execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile, rm, copyFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import process from "node:process";

const PDFJS_VERSION = "6.3.289";
const URL = `https://github.com/mozilla/pdf.js/releases/download/v${PDFJS_VERSION}/pdfjs-${PDFJS_VERSION}-dist.zip`;

const root = path.resolve(import.meta.dirname, "..");
const dest = path.join(root, "media", "pdfjs");
const zipPath = path.join(root, "media", `pdfjs-${PDFJS_VERSION}-dist.zip`);

async function download() {
  console.log(`downloading ${URL}`);
  const res = await fetch(URL, { redirect: "follow" });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  await mkdir(path.dirname(zipPath), { recursive: true });
  await pipeline(res.body, createWriteStream(zipPath));
}

function extract() {
  console.log(`extracting to ${dest}`);
  if (process.platform === "win32") {
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${dest}" -Force`,
    ]);
  } else {
    execFileSync("unzip", ["-oq", zipPath, "-d", dest]);
  }
}

async function patchViewerHtml() {
  const file = path.join(dest, "web", "viewer.html");
  let html = await readFile(file, "utf8");

  // Placeholders substituted at runtime by src/viewerHtml.ts. The <base> tag
  // makes every relative asset reference (css, mjs, cmaps, fonts, locale,
  // images) resolve to a webview resource URI.
  html = html.replace(
    /<head>/,
    `<head>\n<meta http-equiv="Content-Security-Policy" content="%CSP%">\n<base href="%BASE%">`
  );

  // Load our glue module after the viewer bootstraps.
  html = html.replace(
    /<\/body>/,
    `<script src="%GLUE%" type="module"></script>\n</body>`
  );

  await writeFile(file, html);
  console.log("patched web/viewer.html");
}

async function patchViewerJs() {
  const file = path.join(dest, "web", "viewer.mjs");
  let js = await readFile(file, "utf8");

  // Don't auto-load the demo document; the extension feeds bytes via postMessage.
  const before = js;
  js = js.replaceAll("compressed.tracemonkey-pldi-09.pdf", "");
  if (js === before) {
    console.warn("warning: defaultUrl patch did not match anything — check PDF.js version");
  }

  await writeFile(file, js);
  console.log("patched web/viewer.mjs (defaultUrl)");
}

async function copyLicense() {
  const licDir = path.join(root, "third-party-licenses");
  await mkdir(licDir, { recursive: true });
  try {
    await copyFile(path.join(dest, "LICENSE"), path.join(licDir, "pdfjs-LICENSE"));
  } catch {
    console.warn("warning: LICENSE not found in dist zip");
  }
}

await rm(dest, { recursive: true, force: true });
await download();
extract();
await patchViewerHtml();
await patchViewerJs();
await copyLicense();
await rm(zipPath, { force: true });
console.log(`done: PDF.js ${PDFJS_VERSION} vendored into media/pdfjs/`);
