// Smoke: load lib/client.js the way the dsh web shell does (window.__ModuleLoader__),
// then drive apply() against a fake ThemeRuntime and assert the rename is complete.
import { readFileSync } from "node:fs";

const BUNDLE = "lib/client.js";
const source = readFileSync(BUNDLE, "utf8");

let loaded = null;
const styleTags = [];
globalThis.window = { __ModuleLoader__: { load: (m) => { loaded = m; } } };
globalThis.document = {
	querySelector: () => null,
	createElement: () => {
		const tag = { dataset: {}, textContent: "", remove: () => { styleTags.pop(); } };
		return tag;
	},
	head: { appendChild: (t) => styleTags.push(t) },
};

let failures = 0;
function check(label, ok, detail = "") {
	console.log(`  ${ok ? "PASS" : "FAIL"} ${label}${ok || !detail ? "" : ` — ${detail}`}`);
	if (!ok) failures++;
}

(0, eval)(source);

check("ModuleLoader.load called", loaded !== null);
check("loader id renamed", loaded.id === "dsh-skin-material-you", loaded?.id);

const exports = loaded.factory((name) => {
	throw new Error(`factory required an unexpected module: ${name}`);
});
check("factory returns module.exports", exports && typeof exports.apply === "function", JSON.stringify(Object.keys(exports ?? {})));
check("exports.name renamed", exports.name === "dsh-skin-material-you", exports.name);
check("declares theme inject", Array.isArray(exports.inject) && exports.inject.includes("theme"), JSON.stringify(exports.inject));

const registered = [];
const disposed = [];
let overrideSource = null;
let overrideCount = 0;
const ctx = {
	theme: {
		overrideTokens: (src, tokens) => {
			overrideSource = src;
			overrideCount = Object.keys(tokens).length;
			return () => disposed.push("override");
		},
		register: (theme) => {
			registered.push(`${theme.id}/${theme.colorScheme}/${Object.keys(theme.tokens).length}`);
			return () => disposed.push(theme.id);
		},
	},
	effect: (fn) => { fn()(); },
};
exports.apply(ctx);

check("overrideTokens source renamed", overrideSource === "dsh-skin-material-you", String(overrideSource));
check("token map non-empty", overrideCount > 0, String(overrideCount));
check("registers light + dark themes", registered.length === 2 && registered.every((r) => r.endsWith(`/${overrideCount}`)), registered.join(", "));
check("injected a style tag", styleTags.length === 0, `${styleTags.length} left mounted`);
check("disposes every registration", disposed.length === 3, disposed.join(", "));
check("no stale @deepseek-ai scope refs", !source.includes("@deepseek-ai/dsh-skin-material-you"));
check("font url is an absolute /plugins-independent path", source.includes("/dsh-skin-material-you/fonts/MapleMono-NF-CN-Regular.woff2"));

// ---- Host half: the font route must actually serve the bundled font ----
const host = await import("../lib/index.js");
check("host exports name", host.name === "dsh-skin-material-you", host.name);
check("host declares webServer inject", Array.isArray(host.inject) && host.inject.includes("webServer"), JSON.stringify(host.inject));

let capturedRoute = null;
let unregistered = false;
const hostCtx = {
  webServer: {
    register: (route) => {
      capturedRoute = route;
      return () => { unregistered = true; };
    },
  },
};
const disposer = host.apply(hostCtx);
check("host registers a prefix route", capturedRoute?.kind === "prefix" && capturedRoute.path === "/dsh-skin-material-you", JSON.stringify({ kind: capturedRoute?.kind, path: capturedRoute?.path }));

function fakeRes() {
  const state = { status: 0, headers: {}, body: null };
  return {
    _state: state,
    writeHead: (code, headers) => { state.status = code; state.headers = headers ?? {}; },
    end: (body) => { state.body = body; },
  };
}
function fakeReq(method, url) {
  return { method, url };
}

// 1) serve the real font with the right content type + body
const okRes = fakeRes();
capturedRoute.handler(fakeReq("GET", "/dsh-skin-material-you/fonts/MapleMono-NF-CN-Regular.woff2"), okRes);
check("font route returns 200", okRes._state.status === 200, String(okRes._state.status));
check("font route content-type is woff2", okRes._state.headers["content-type"] === "font/woff2", okRes._state.headers["content-type"]);
check("font route body is a non-empty buffer", okRes._state.body instanceof Buffer && okRes._state.body.length > 1000, `${okRes._state.body?.length} bytes`);

// 2) traversal / unknown files 404, and non-GET is rejected
const badReq = fakeRes();
capturedRoute.handler(fakeReq("GET", "/dsh-skin-material-you/fonts/../package.json"), badReq);
check("font route 404s out-of-dir files", badReq._state.status === 404, String(badReq._state.status));
const missRes = fakeRes();
capturedRoute.handler(fakeReq("GET", "/dsh-skin-material-you/fonts/nope.woff2"), missRes);
check("font route 404s missing files", missRes._state.status === 404, String(missRes._state.status));
const postRes = fakeRes();
capturedRoute.handler(fakeReq("POST", "/dsh-skin-material-you/fonts/MapleMono-NF-CN-Regular.woff2"), postRes);
check("font route rejects POST", postRes._state.status === 405, String(postRes._state.status));

disposer();
check("disposer unregisters the route", unregistered === true, String(unregistered));

console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
