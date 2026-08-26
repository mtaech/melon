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
check("font url still relative to fonts/", source.includes("../fonts/MapleMono-NF-CN-Regular.woff2"));

console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
