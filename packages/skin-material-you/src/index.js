/**
 * Host half of the Material You skin.
 *
 * The browser half registers the HCT palette, typography, sidebar refinement
 * and the sidebar info enrichment entirely client-side (./client.js). This host
 * half exposes two read-only resources under `/dsh-skin-material-you`:
 *
 *   1. `GET /dsh-skin-material-you/fonts/<file>` — the bundled Maple Mono woff2.
 *      Why a route and not a relative url()? The client injects its CSS as an
 *      inline <style> tag in the page, so a relative url('../fonts/...')
 *      resolves against the page origin (http://127.0.0.1:<port>/fonts/...) and
 *      404s. The /plugins prefix route served by dsh-client-modules only answers
 *      pre-composed bundle artifacts (client.js/.map), never arbitrary package
 *      files. So the font is exposed here and fonts.css references it absolutely.
 *
 *   2. `GET /dsh-skin-material-you/api/workspaces` — per-workspace metadata
 *      (title / path / visible session count / timestamps) read from the Host
 *      workspace store. The browser sidebar renders only the workspace label,
 *      so the client enrichment fetches this to annotate each row. The read is
 *      best-effort: a missing or unreadable store yields an empty list rather
 *      than an error, and the sidebar simply shows no annotation.
 *
 * @param ctx - the mounted host Cordis context.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

export const name = "dsh-skin-material-you";
export const inject = ["webServer"];

const PREFIX = "/dsh-skin-material-you";
const FONT_ROUTE = `${PREFIX}/fonts/`;
const WORKSPACES_ROUTE = `${PREFIX}/api/workspaces`;
const FONTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fonts");

const MIME_BY_EXT = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

/** Host workspace store: `$DSH_HOME/storages/workspace.json` (DSH_HOME defaults to ~/.dsh). */
function workspaceStorePath() {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), ".dsh");
  return join(home, "storages", "workspace.json");
}

/**
 * Read per-workspace metadata from the Host workspace store.
 * @returns rows in Host order; `[]` when the store is absent or unreadable.
 */
function readWorkspaceInfo() {
  let raw;
  try {
    raw = JSON.parse(readFileSync(workspaceStorePath(), "utf8"));
  } catch {
    return [];
  }
  const table = raw?.tables?.workspaces;
  if (table === null || typeof table !== "object") return [];
  const order = Array.isArray(raw?.global?.workspaceIds) ? raw.global.workspaceIds : Object.keys(table);
  const archived = new Set(Array.isArray(raw?.global?.archivedSessionIds) ? raw.global.archivedSessionIds : []);
  const rows = [];
  for (const id of order) {
    const record = table[id];
    if (record === null || typeof record !== "object") continue;
    const sessions = Array.isArray(record.sessionIds) ? record.sessionIds.filter((sid) => !archived.has(sid)) : [];
    rows.push({
      id,
      title: typeof record.title === "string" ? record.title : "",
      path: typeof record.path === "string" ? record.path : "",
      sessions: sessions.length,
      createdAt: typeof record.createdAt === "string" ? record.createdAt : null,
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
    });
  }
  return rows;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function sendText(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function serveFont(req, res, pathname) {
  const match = /^\/dsh-skin-material-you\/fonts\/([A-Za-z0-9._-]+)$/.exec(pathname);
  if (match === null) {
    sendText(res, 404, "not found");
    return;
  }
  let data;
  try {
    data = readFileSync(join(FONTS_DIR, match[1]));
  } catch {
    sendText(res, 404, "not found");
    return;
  }
  res.writeHead(200, {
    "content-type": MIME_BY_EXT[extname(match[1])] ?? "application/octet-stream",
    "content-length": data.byteLength,
    "cache-control": "public, max-age=31536000, immutable",
  });
  res.end(req.method === "HEAD" ? undefined : data);
}

function serveAsset(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "method not allowed");
    return;
  }
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  if (pathname === WORKSPACES_ROUTE) {
    const workspaces = readWorkspaceInfo();
    sendJson(res, 200, { workspaces });
    return;
  }
  if (pathname.startsWith(FONT_ROUTE)) {
    serveFont(req, res, pathname);
    return;
  }
  sendText(res, 404, "not found");
}

export function apply(ctx) {
  const disposer = ctx.webServer.register({ kind: "prefix", path: PREFIX, handler: serveAsset });
  return () => disposer();
}
