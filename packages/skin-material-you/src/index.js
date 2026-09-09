/**
 * Host half of the Material You skin.
 *
 * The browser half registers the HCT palette, typography and sidebar
 * refinement entirely client-side (./client.js). This host half has one job:
 * serve the bundled Maple Mono font so the client can actually load it.
 *
 * Why a route and not a relative url()? The client injects its CSS as an inline
 * <style> tag in the page, so a relative url('../fonts/...') resolves against
 * the page origin (http://127.0.0.1:<port>/fonts/...) and 404s. The /plugins
 * prefix route served by dsh-client-modules only answers pre-composed bundle
 * artifacts (client.js/.map), never arbitrary package files. So the font is
 * exposed here under its own prefix, and fonts.css references it absolutely:
 *   url('/dsh-skin-material-you/fonts/MapleMono-NF-CN-Regular.woff2')
 *
 * @param ctx - the mounted host Cordis context.
 */
import { readFileSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

export const name = "dsh-skin-material-you";
export const inject = ["webServer"];

const PREFIX = "/dsh-skin-material-you";
const FONTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fonts");

const MIME_BY_EXT = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

function serveFont(req, res) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const match = /^\/dsh-skin-material-you\/fonts\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "content-type": "text/plain" });
    res.end("method not allowed");
    return;
  }
  if (match === null) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  const file = join(FONTS_DIR, match[1]);
  let data;
  try {
    data = readFileSync(file);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  const contentType = MIME_BY_EXT[extname(file)] ?? "application/octet-stream";
  res.writeHead(200, {
    "content-type": contentType,
    "content-length": data.byteLength,
    "cache-control": "public, max-age=31536000, immutable",
  });
  res.end(req.method === "HEAD" ? undefined : data);
}

export function apply(ctx) {
  const disposer = ctx.webServer.register({ kind: "prefix", path: PREFIX, handler: serveFont });
  return () => disposer();
}
