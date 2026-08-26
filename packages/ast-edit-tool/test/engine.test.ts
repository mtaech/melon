import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { computeRewrite, resolveOps } from "../src/engine.js";
import { resolveAstGrepBinary } from "../src/binary.js";

const binary = resolveAstGrepBinary();
if (!binary) throw new Error("ast-grep binary not found; install @ast-grep/cli first");

const noSignal = new AbortController().signal;

async function fixture(files: Record<string, string>): Promise<string> {
	const dir = await mkdtemp(path.join(os.tmpdir(), "ast-edit-test-"));
	for (const [name, content] of Object.entries(files)) {
		await writeFile(path.join(dir, name), content);
	}
	return dir;
}

async function cleanup(dir: string): Promise<void> {
	await rm(dir, { recursive: true, force: true });
}

describe("computeRewrite", () => {
	test("rewrites JS with metavariable substitution", async () => {
		const dir = await fixture({ "a.js": "const r = foo(1, 2);\n" });
		try {
			const file = path.join(dir, "a.js");
			const result = await computeRewrite(binary, [{ pat: "foo($$$ARGS)", out: "bar($$$ARGS)" }], [file], new Map([[file, "const r = foo(1, 2);\n"]]), noSignal);
			expect(result.totalReplacements).toBe(1);
			expect(result.filesTouched).toEqual([file]);
			expect(result.finalContents.get(file)).toBe("const r = bar(1, 2);\n");
			expect(result.matches[0]!.before).toBe("foo(1, 2)");
			expect(result.matches[0]!.after).toBe("bar(1, 2)");
			// preview must not touch the real file
			expect(await readFile(file, "utf8")).toBe("const r = foo(1, 2);\n");
		} finally {
			await cleanup(dir);
		}
	});

	test("infers Python and rewrites it", async () => {
		const dir = await fixture({ "s.py": 'def greet(name):\n    return "hi " + name\n' });
		try {
			const file = path.join(dir, "s.py");
			const content = await readFile(file, "utf8");
			const result = await computeRewrite(binary, [{ pat: 'return "hi " + $X', out: 'return "hello " + $X' }], [file], new Map([[file, content]]), noSignal);
			expect(result.totalReplacements).toBe(1);
			expect(result.finalContents.get(file)).toBe('def greet(name):\n    return "hello " + name\n');
		} finally {
			await cleanup(dir);
		}
	});

	test("empty out deletes the matched node", async () => {
		const dir = await fixture({ "d.js": "const a = 1;\nconst b = 2;\n" });
		try {
			const file = path.join(dir, "d.js");
			const content = await readFile(file, "utf8");
			const result = await computeRewrite(binary, [{ pat: "const a = $V;", out: "" }], [file], new Map([[file, content]]), noSignal);
			expect(result.totalReplacements).toBe(1);
			expect(result.finalContents.get(file)).toBe("\nconst b = 2;\n");
			expect(result.matches[0]!.after).toBe("");
		} finally {
			await cleanup(dir);
		}
	});

	test("identity rewrite counts as no change", async () => {
		const dir = await fixture({ "i.js": "foo(1);\n" });
		try {
			const file = path.join(dir, "i.js");
			const content = await readFile(file, "utf8");
			const result = await computeRewrite(binary, [{ pat: "foo($A)", out: "foo($A)" }], [file], new Map([[file, content]]), noSignal);
			expect(result.totalReplacements).toBe(0);
			expect(result.filesTouched).toEqual([]);
		} finally {
			await cleanup(dir);
		}
	});

	test("multi-op rewrites apply cumulatively in pattern-string order", async () => {
		const dir = await fixture({ "c.js": "foo(9);\n" });
		try {
			const file = path.join(dir, "c.js");
			const content = await readFile(file, "utf8");
			// resolveOps sorts by pattern string: "foo(" < "fooBar(" → foo→fooBar first
			const ops = resolveOps([{ pat: "fooBar($X)", out: "baz($X)" }, { pat: "foo($A)", out: "fooBar($A)" }]);
			const result = await computeRewrite(binary, ops, [file], new Map([[file, content]]), noSignal);
			expect(result.totalReplacements).toBe(2);
			expect(result.finalContents.get(file)).toBe("baz(9);\n");
		} finally {
			await cleanup(dir);
		}
	});

	test("overlapping matches within one op are a hard error", async () => {
		const dir = await fixture({ "y.js": "const s = a + b + c;\n" });
		try {
			const file = path.join(dir, "y.js");
			const content = await readFile(file, "utf8");
			await expect(
				computeRewrite(binary, [{ pat: "$A + $B", out: "$B + $A" }], [file], new Map([[file, content]]), noSignal),
			).rejects.toThrow(/Overlapping replacements detected/);
		} finally {
			await cleanup(dir);
		}
	});

	test("abort signal fails fast", async () => {
		const dir = await fixture({ "z.js": "foo(1);\n" });
		try {
			const file = path.join(dir, "z.js");
			const content = await readFile(file, "utf8");
			const controller = new AbortController();
			controller.abort();
			await expect(computeRewrite(binary, [{ pat: "foo($A)", out: "bar($A)" }], [file], new Map([[file, content]]), controller.signal)).rejects.toThrow(/aborted/);
		} finally {
			await cleanup(dir);
		}
	});
});

describe("resolveOps", () => {
	test("throws on empty ops", () => {
		expect(() => resolveOps([])).toThrow(/at least one rewrite rule/);
	});
	test("throws on duplicate patterns", () => {
		expect(() => resolveOps([{ pat: "x", out: "y" }, { pat: "x", out: "z" }])).toThrow(/duplicate rewrite pattern/);
	});
	test("throws on empty pattern", () => {
		expect(() => resolveOps([{ pat: "", out: "y" }])).toThrow(/non-empty pat/);
	});
	test("sorts ops by pattern string", () => {
		expect(resolveOps([{ pat: "zzz($A)", out: "" }, { pat: "aaa($B)", out: "" }]).map((o) => o.pat)).toEqual(["aaa($B)", "zzz($A)"]);
	});
});