/**
 * verify-new-dsh.mjs — point melon's @deepseek-ai/* typecheck at the DSH repo's
 * built lib output so the migration can be verified before the new rc lands on
 * npm. IDEMPOTENT and reversible: it records the original symlink targets and
 * can restore them.
 *
 * The DSH checkout path comes from $DSH_DIR (default: the sibling
 * `deepseek-harness` checkout next to this repo). The target DSH packages must
 * already be built (`pnpm run build:lib:host` in the DSH repo).
 *
 * Usage:
 *   DSH_DIR=/path/to/deepseek-harness node scripts/verify-new-dsh.mjs link
 *   DSH_DIR=/path/to/deepseek-harness node scripts/verify-new-dsh.mjs restore
 */
import { readdirSync, readlinkSync, symlinkSync, unlinkSync, existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const DSH = process.env.DSH_DIR ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../deepseek-harness");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const STATE = path.join(ROOT, "scripts", ".verify-state.json");

if (!process.env.DSH_DIR) {
  console.warn(`[verify-new-dsh] DSH_DIR not set; defaulting to ${DSH}`);
}
if (!existsSync(DSH)) {
  console.error(`[verify-new-dsh] DSH checkout not found at ${DSH}; set DSH_DIR`);
  process.exit(1);
}

// DSH package dir (relative to DSH/) that holds the built lib for @deepseek-ai/<name>.
const DSH_PKGS = {
  cordis: "vendor/cordis",
  schemastery: "vendor/schemastery",
  "dsh-tools": "packages/core/tools",
  "dsh-attachment": "packages/attachment/attachment",
  "dsh-llm": "packages/llm/llm",
  "dsh-session": "packages/core/session",
  "dsh-subprocess": "packages/subprocess/subprocess",
  "dsh-host-webserver": "packages/host/webserver",
  "dsh-client-ui-settings": "packages/client/ui-settings",
  "dsh-client-ui-slots": "packages/client/ui-slots",
  "dsh-client-ui-theme": "packages/client/ui-theme",
  "dsh-client-locale": "packages/client/locale",
  "dsh-client-ui-renderer": "packages/client/ui-renderer",
  "dsh-api-remotes": "packages/api/remotes",
  "dsh-invariants": "packages/runtime-diagnostics/invariants",
};

// melon package -> the dsh names it should resolve for typecheck.
const PACKAGES = {
  "ast-edit-tool": ["cordis", "schemastery", "dsh-tools"],
  "browser-tool": ["cordis", "schemastery", "dsh-tools", "dsh-attachment", "dsh-llm", "dsh-session"],
  "plugin-dashboard": ["cordis", "dsh-host-webserver", "dsh-subprocess", "dsh-client-ui-settings", "dsh-client-ui-slots", "dsh-client-ui-theme", "dsh-client-locale", "dsh-client-ui-renderer", "dsh-api-remotes"],
  "skin-material-you": ["cordis", "dsh-client-ui-theme"],
};

function nodeModulesDir(pkg) {
  return path.join(ROOT, "packages", pkg, "node_modules", "@deepseek-ai");
}

function loadState() {
  try { return JSON.parse(readFileSync(STATE, "utf8")); }
  catch { return {}; }
}

function saveState(state) {
  writeFileSync(STATE, JSON.stringify(state, null, 2));
}

const command = process.argv[2];

if (command === "link") {
  const state = loadState();
  for (const [pkg, names] of Object.entries(PACKAGES)) {
    const dir = nodeModulesDir(pkg);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    for (const name of names) {
      const linkPath = path.join(dir, name);
      const target = path.resolve(DSH, DSH_PKGS[name]);
      if (!existsSync(target)) {
        console.warn(`skip ${name}: no built lib at ${target}`);
        continue;
      }
      if (existsSync(linkPath)) {
        let orig = null;
        try { orig = readlinkSync(linkPath); } catch { /* not a symlink */ }
        state[linkPath] ??= { orig };
        unlinkSync(linkPath);
      } else {
        state[linkPath] ??= { orig: null };
      }
      symlinkSync(target, linkPath, "dir");
      console.log(`link ${pkg}/@deepseek-ai/${name} -> ${target}`);
    }
  }
  saveState(state);
  console.log("linked. run 'restore' to revert.");
} else if (command === "restore") {
  const state = loadState();
  for (const [linkPath, record] of Object.entries(state)) {
    if (existsSync(linkPath)) unlinkSync(linkPath);
    if (record.orig) symlinkSync(record.orig, linkPath, "dir");
    else console.log(`remove ${linkPath} (was absent)`);
  }
  if (existsSync(STATE)) unlinkSync(STATE);
  console.log("restored.");
} else {
  console.log("usage: node scripts/verify-new-dsh.mjs <link|restore>");
}
