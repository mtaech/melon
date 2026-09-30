/**
 * dom-check.mjs — generate a self-contained browser page that drives the built
 * skin bundle against a sidebar that mimics what ui-workspace renders.
 *
 *   node scripts/dom-check.mjs [out.html]      # default: ./.dom-check.html
 *
 * Why a browser page instead of a node test: the enrichment is pure DOM work
 * whose correctness depends on CSS-module class names and on flex layout
 * (the session count rides the title, the activity time right-aligns). So the
 * page reuses the REAL row stylesheet, extracted from the built ui-workspace
 * client bundle at $DSH_DIR (default: the sibling `deepseek-harness` checkout),
 * and the real design tokens from apps/web/dist. Open the generated file with
 * the browser tool; scripts/dom-check.page.js prints the PASS/FAIL lines.
 *
 * Nothing here ships: `scripts/` is not in the package's `files` list.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, "..");
const DSH = process.env.DSH_DIR ?? path.resolve(PKG, "../../../deepseek-harness");
const BUNDLE = path.join(PKG, "lib", "client.js");
const WORKSPACE_CLIENT = path.join(DSH, "packages/client/ui-workspace/lib/client.js");
const WEB_ASSETS = path.join(DSH, "apps/web/dist/assets");
const OUT = path.resolve(process.argv[2] ?? path.join(PKG, ".dom-check.html"));

/** Class names whose local name the sidebar selectors match on. */
const CLASS_NAMES = [
  "treeBody", "wide", "groupSection", "projectRow", "projectText", "title", "rowActions", "iconButton",
  "slot", "folder", "folderActive", "chevron", "sessionRow", "time", "selected", "sectionHeader",
];

if (!existsSync(BUNDLE)) {
  console.error(`[dom-check] ${BUNDLE} is missing — run \`node build.mjs\` first.`);
  process.exit(1);
}
if (!existsSync(WORKSPACE_CLIENT)) {
  console.error(`[dom-check] ${WORKSPACE_CLIENT} is missing — build the DSH ui-workspace client (or set DSH_DIR).`);
  process.exit(1);
}

/** Every `const css$n = "..."` literal in the built client bundle is that package's CSS. */
function extractCss(source, file) {
  const chunks = [];
  const pattern = /(?:const|let|var)\s+[A-Za-z0-9_$]*css[A-Za-z0-9_$]*\s*=\s*("(?:[^"\\]|\\.)*")/g;
  for (const match of source.matchAll(pattern)) {
    // The literal is a JavaScript string; evaluate it rather than re-implementing escapes.
    chunks.push(new Function(`return ${match[1]}`)());
  }
  if (chunks.length === 0) {
    console.error(`[dom-check] no CSS string literals found in ${file}; the bundle layout changed.`);
    process.exit(1);
  }
  return chunks.join("\n");
}

/** Design tokens from the built web shell: first definition per custom property. */
function extractTokens(assetsDir) {
  if (!existsSync(assetsDir)) return "";
  const file = readdirSync(assetsDir).filter((name) => name.endsWith(".css")).sort()[0];
  if (file === undefined) return "";
  const source = readFileSync(path.join(assetsDir, file), "utf8");
  const seen = new Map();
  for (const match of source.matchAll(/(--dsw-[a-z0-9-]+)\s*:\s*([^;}]+)/g)) {
    if (!seen.has(match[1])) seen.set(match[1], match[2].trim());
  }
  return [...seen].map(([name, value]) => `${name}:${value}`).join(";");
}

/** `projectRow` → the hashed class name the built stylesheet styles. */
function classMap(css) {
  const map = {};
  for (const local of CLASS_NAMES) {
    const match = new RegExp(`\\.(([A-Za-z0-9_$-]+)_${local})\\b`).exec(css);
    map[local] = match === null ? local : match[1];
  }
  return map;
}

const workspaceCss = extractCss(readFileSync(WORKSPACE_CLIENT, "utf8"), WORKSPACE_CLIENT);
const tokens = extractTokens(WEB_ASSETS);
const bundle = readFileSync(BUNDLE, "utf8");
const page = readFileSync(path.join(HERE, "dom-check.page.js"), "utf8");
const classes = classMap(workspaceCss);

const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>dsh-skin-material-you · sidebar DOM check</title>
<style>
/* real design tokens (light) + real workspace-browser stylesheet */
:root{${tokens}}
${workspaceCss}
/* harness chrome only */
body{margin:0;display:flex;gap:16px;padding:16px;font:14px/1.5 system-ui,sans-serif;background:#eceff4}
#sidebar{width:264px;flex:none;padding:8px 6px;border-radius:12px;background:var(--dsw-specific-sidebar-fill,#fff);border:1px solid #d5d8e0}
#report{flex:1;min-width:0}
#result{font-weight:700;font-size:16px}
.ok{color:#0a7d33}
.bad{color:#b3261e}
#report ol{padding-left:24px}
#report li{margin:2px 0;font-family:ui-monospace,monospace;font-size:12px}
#report .hint{color:#5b6070;font-size:12px;margin:8px 0}
</style>
</head>
<body>
<aside id="sidebar"></aside>
<section id="report">
  <div id="result">running…</div>
  <p class="hint">真实 DSH 工作区行样式 + 真实 token；颜色由 bundle 注册的 material-you-light token 绘制。</p>
</section>
<script>window.__ModuleLoader__ = { load: (mod) => { window.__skin = mod; } };</script>
<script>${bundle}</script>
<script>window.__HARNESS__ = { classes: ${JSON.stringify(classes)} };</script>
<script>${page}</script>
</body>
</html>
`;

writeFileSync(OUT, html, "utf8");
console.log(`[dom-check] wrote ${OUT} (${html.length} bytes)`);
console.log(`[dom-check] classes: ${JSON.stringify(classes)}`);
