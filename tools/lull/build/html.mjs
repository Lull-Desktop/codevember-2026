// Turns the original sketch page into a Lull scene document.
//
// We keep the page's existing CSS/DOM (loaders, canvases, overlays) so the
// sketch's own assumptions still hold, but:
//   - remove every script, including inline fallback scripts;
//   - load the bundled ./scene.js (or the Vite entry in preview);
//   - hide editor UI and add a first-frame background.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export function renderSceneHtml({ projectDir, scene, mode = "package" }) {
  const sourcePath = join(projectDir, scene.source.html);
  let html = readFileSync(sourcePath, "utf8");

  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<base\b[^>]*>/gi, "");

  if (/(?:src|href)\s*=\s*["']\//i.test(html)) {
    throw new Error(`${scene.source.html} 使用了站点根绝对路径，内容包必须用相对路径`);
  }
  if (/\son[a-z]+\s*=\s*["']/i.test(html)) {
    throw new Error(`${scene.source.html} 含内联事件处理器，Lull CSP 会拒绝`);
  }

  if (/<title\b[^>]*>[\s\S]*?<\/title>/i.test(html)) {
    html = html.replace(
      /<title\b[^>]*>[\s\S]*?<\/title>/i,
      `<title>${escapeHtml(scene.name)}</title>`,
    );
  } else {
    html = html.replace(
      /<\/head>/i,
      `  <title>${escapeHtml(scene.name)}</title>\n</head>`,
    );
  }

  const background = scene.theme?.background ?? "#111111";
  const baseHide = [
    ".lil-gui",
    ".stats",
    "#stats",
    ".pages",
    ".balls",
    ".hud",
    "#bodies",
    'body > div[style*="z-index:10000"]',
    'body > div[style*="z-index: 10000"]',
  ];
  const hide = [...new Set([...baseHide, ...(scene.hide ?? [])])].join(
    ",\n      ",
  );
  const style = `
    <style id="lull-scene-style">
      html, body {
        margin: 0;
        height: 100%;
        overflow: hidden;
        background: ${background};
      }
      canvas { display: block; }
      #lull-preview-badge { pointer-events: none; }
      ${hide ? `${hide} { display: none !important; }` : ""}
    </style>
  `;
  if (mode === "preview") {
    html = html.replace(/<head>/i, `<head>\n    <base href="/" />`);
  }
  // Avoid a stray /favicon.ico 404 in both preview and the package.
  html = html.replace(
    /<\/head>/i,
    `  <link rel="icon" href="data:," />\n${style}</head>`,
  );

  const script =
    mode === "preview"
      ? `<script type="module" src="/lull/entry.ts"></script>`
      : `<script type="module" src="./scene.js"></script>`;

  if (/<\/body>/i.test(html)) {
    html = html.replace(/<\/body>/i, `    ${script}\n  </body>`);
  } else {
    html += `\n${script}\n`;
  }

  return html;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}