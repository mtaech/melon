/**
 * Smoke test: build lib/ first (npm run build), then drive the built plugin
 * through the full preview → apply → verify → reject flow against real files
 * with the real ast-grep binary. Exits non-zero on any assertion failure.
 */
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { apply } = await import(path.resolve(process.cwd(), "lib/index.js"));

let failures = 0;
function check(name, condition, detail = "") {
	if (condition) {
		console.log(`  PASS ${name}`);
	} else {
		failures += 1;
		console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
	}
}

const dir = await mkdtemp(path.join(os.tmpdir(), "ast-edit-smoke-"));
const file = path.join(dir, "a.js");
await writeFile(file, "const r = foo(1);\nconst s = foo(2);\n");

let tool;
{
	let captured;
	const tools = { register: (def) => { captured = def; return () => undefined; } };
	const ctx = { get: (name) => (name === "tools" ? tools : undefined) };
	const disposer = apply(ctx, {});
	check("plugin exports name/inject/Config/apply namespace", typeof apply === "function");
	check("apply returns a disposer", typeof disposer === "function");
	tool = captured;
	check("ast_edit tool registered", !!tool && tool.name === "ast_edit");
}
if (!tool) {
	console.error("no tool registered; aborting");
	process.exit(1);
}

const exec = {
	signal: new AbortController().signal,
	agent: { session: { id: "smoke", header: { cwd: dir } } },
};

console.log("preview…");
const preview = await tool.execute({ ops: [{ pat: "foo($A)", out: "bar($A)" }], paths: [file] }, exec);
check("preview reports 2 replacements", preview.totalReplacements === 2, JSON.stringify(preview));
check("preview did not write files", (await readFile(file, "utf8")) === "const r = foo(1);\nconst s = foo(2);\n");
check("preview staged an id", typeof preview.stagedId === "string" && preview.stagedId.length > 0);
const blocks = tool.output.render({}, preview);
const rendered = blocks.map((b) => b.text ?? "").join("\n");
check("preview render shows proposed diff", rendered.includes("bar(1)") && rendered.includes("Staged as a proposal"));

console.log("apply…");
const applied = await tool.execute({ stagedId: preview.stagedId, action: "apply" }, exec);
check("apply reported 2 replacements", applied.applied === true && applied.totalReplacements === 2, JSON.stringify(applied));
const contentAfter = await readFile(file, "utf8");
check("file rewritten in place", contentAfter === "const r = bar(1);\nconst s = bar(2);\n", contentAfter);

console.log("stale detection…");
await writeFile(file, "const r = foo(1);\nconst extra = 3;\n");
let staleRejected = false;
try {
	const p2 = await tool.execute({ ops: [{ pat: "foo($A)", out: "bar($A)" }], paths: [file] }, exec);
	await writeFile(file, "foo(1);\nfoo(9);\n");
	await tool.execute({ stagedId: p2.stagedId, action: "apply" }, exec);
} catch (error) {
	staleRejected = String(error).includes("stale");
}
check("stale apply rejected", staleRejected);

console.log("reject…");
await writeFile(file, "foo(7);\n");
const p3 = await tool.execute({ ops: [{ pat: "foo($A)", out: "bar($A)" }], paths: [file] }, exec);
const rejected = await tool.execute({ stagedId: p3.stagedId, action: "reject" }, exec);
check("reject left files unchanged", (await readFile(file, "utf8")) === "foo(7);\n" && String(rejected.message).includes("Discarded"));

await rm(dir, { recursive: true, force: true });
console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);