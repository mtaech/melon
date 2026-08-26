import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { apply } from "../src/index.js";

interface CapturedTool {
	name: string;
	parameters: unknown;
	output: { render(args: unknown, value: unknown): Array<{ type: string; text?: string }>; presentationMeta?(args: unknown, value: unknown): unknown };
	execute(args: unknown, exec: unknown): Promise<unknown>;
}

function harness() {
	let captured: CapturedTool | undefined;
	const tools = {
		register: (def: CapturedTool) => {
			captured = def;
			return () => undefined;
		},
	};
	const ctx = { get: (name: string) => (name === "tools" ? tools : undefined) } as never;
	const disposer = apply(ctx, {});
	return {
		get tool(): CapturedTool {
			if (!captured) throw new Error("tool was not registered");
			return captured;
		},
		disposer,
	};
}

async function sessionExec(dir: string, sessionId = "s1") {
	return {
		signal: new AbortController().signal,
		agent: { session: { id: sessionId, header: { cwd: dir } } },
	} as never;
}

async function fixture(content: string): Promise<{ dir: string; file: string }> {
	const dir = await mkdtemp(path.join(os.tmpdir(), "ast-edit-plugin-"));
	const file = path.join(dir, "a.js");
	await writeFile(file, content);
	return { dir, file };
}

const OPS = [{ pat: "foo($A)", out: "bar($A)" }];

describe("ast_edit plugin", () => {
	test("preview stages without touching files; apply writes them", async () => {
		const { dir, file } = await fixture("const r = foo(1);\n");
		const { tool } = harness();
		const exec = await sessionExec(dir);
		try {
			const preview = (await tool.execute({ ops: OPS, paths: [file], action: "preview" }, exec)) as {
				action: string;
				applied: boolean;
				stagedId?: string;
				totalReplacements: number;
				changes?: Array<{ file: string; line: number; before: string; after: string }>;
			};
			expect(preview.action).toBe("preview");
			expect(preview.applied).toBe(false);
			expect(preview.stagedId).toBeTruthy();
			expect(preview.totalReplacements).toBe(1);
			expect(preview.changes?.[0]?.before).toBe("foo(1)");
			expect(preview.changes?.[0]?.after).toBe("bar(1)");
			expect(await readFile(file, "utf8")).toBe("const r = foo(1);\n");

			const applied = (await tool.execute({ stagedId: preview.stagedId, action: "apply" }, exec)) as { applied: boolean; totalReplacements: number };
			expect(applied.applied).toBe(true);
			expect(applied.totalReplacements).toBe(1);
			expect(await readFile(file, "utf8")).toBe("const r = bar(1);\n");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("reject discards the staged rewrite", async () => {
		const { dir, file } = await fixture("const r = foo(1);\n");
		const { tool } = harness();
		const exec = await sessionExec(dir);
		try {
			const preview = (await tool.execute({ ops: OPS, paths: [file] }, exec)) as { stagedId: string };
			const rejected = (await tool.execute({ stagedId: preview.stagedId, action: "reject" }, exec)) as { message: string };
			expect(rejected.message).toContain("Discarded");
			expect(await readFile(file, "utf8")).toBe("const r = foo(1);\n");

			await expect(tool.execute({ stagedId: preview.stagedId, action: "apply" }, exec)).rejects.toThrow(/unknown or expired/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("stale preview is rejected at apply time", async () => {
		const { dir, file } = await fixture("const r = foo(1);\n");
		const { tool } = harness();
		const exec = await sessionExec(dir);
		try {
			const preview = (await tool.execute({ ops: OPS, paths: [file] }, exec)) as { stagedId: string };
			// content change that alters the replacement count must fail
			await writeFile(file, "const r = foo(1);\nfoo(2);\n");
			await expect(tool.execute({ stagedId: preview.stagedId, action: "apply" }, exec)).rejects.toThrow(/stale/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("apply follows the live file when counts did not change", async () => {
		const { dir, file } = await fixture("const r = foo(1);\n");
		const { tool } = harness();
		const exec = await sessionExec(dir);
		try {
			const preview = (await tool.execute({ ops: OPS, paths: [file] }, exec)) as { stagedId: string };
			await writeFile(file, "const r = foo(1);\nconst untouched = 2;\n");
			const applied = (await tool.execute({ stagedId: preview.stagedId, action: "apply" }, exec)) as { applied: boolean };
			expect(applied.applied).toBe(true);
			expect(await readFile(file, "utf8")).toBe("const r = bar(1);\nconst untouched = 2;\n");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("apply without stagedId fails", async () => {
		const { dir, file } = await fixture("const r = foo(1);\n");
		const { tool } = harness();
		const exec = await sessionExec(dir);
		try {
			await expect(tool.execute({ ops: OPS, paths: [file], action: "apply" }, exec)).rejects.toThrow(/stagedId is required/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("duplicate patterns fail validation", async () => {
		const { dir, file } = await fixture("const r = foo(1);\n");
		const { tool } = harness();
		const exec = await sessionExec(dir);
		try {
			await expect(tool.execute({ ops: [{ pat: "a", out: "b" }, { pat: "a", out: "c" }], paths: [file] }, exec)).rejects.toThrow(/duplicate rewrite pattern/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("sessions cannot apply each other's staged rewrites", async () => {
		const { dir, file } = await fixture("const r = foo(1);\n");
		const { tool } = harness();
		const execA = await sessionExec(dir, "s1");
		const execB = await sessionExec(dir, "s2");
		try {
			const preview = (await tool.execute({ ops: OPS, paths: [file] }, execA)) as { stagedId: string };
			await expect(tool.execute({ stagedId: preview.stagedId, action: "apply" }, execB)).rejects.toThrow(/unknown or expired/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("render produces per-change diff lines", async () => {
		const { dir, file } = await fixture("const r = foo(1);\n");
		const { tool } = harness();
		const exec = await sessionExec(dir);
		try {
			const preview = (await tool.execute({ ops: OPS, paths: [file] }, exec)) as Parameters<CapturedTool["output"]["render"]>[1];
			const blocks = tool.output.render({}, preview);
			const text = blocks.map((b) => b.text ?? "").join("\n");
			expect(text).toContain("foo(1)");
			expect(text).toContain("bar(1)");
			expect(text).toContain("Staged as a proposal");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("plugin registration returns a disposer and gates on enabled=false", () => {
		const { disposer } = harness();
		expect(typeof disposer).toBe("function");

		let captured: CapturedTool | undefined;
		const ctx = { get: () => ({ register: (d: CapturedTool) => void (captured = d) }) } as never;
		apply(ctx, { enabled: false });
		expect(captured).toBeUndefined();
	});
});