import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveAstGrepBinary } from "../src/binary.js";

describe("resolveAstGrepBinary", () => {
	test("an explicit path wins over discovery", () => {
		expect(resolveAstGrepBinary("/opt/custom/ast-grep")).toBe("/opt/custom/ast-grep");
		expect(resolveAstGrepBinary("  /opt/custom/ast-grep  ")).toBe("/opt/custom/ast-grep");
	});

	test("blank overrides fall through to discovery", () => {
		expect(resolveAstGrepBinary("   ")).toBe(resolveAstGrepBinary());
	});

	test("discovers a runnable binary in this workspace", () => {
		const found = resolveAstGrepBinary();
		expect(found).not.toBeNull();
	});

	// The postinstall-blocked install leaves `@ast-grep/cli/ast-grep` as a JS
	// shim that prints a warning to stderr on every call, which the engine
	// would surface as a per-pattern warning. Resolution must prefer the
	// platform package's real executable when both are present.
	test("prefers the native executable over a JS shim", async () => {
		const found = resolveAstGrepBinary();
		expect(found).not.toBeNull();
		const head = Buffer.alloc(4);
		const fd = await Bun.file(found!).arrayBuffer();
		new Uint8Array(head.buffer).set(new Uint8Array(fd.slice(0, 4)));
		const isElf = head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46;
		const isPe = head[0] === 0x4d && head[1] === 0x5a;
		const machO = head.readUInt32BE(0);
		const isMachO = machO === 0xfeedface || machO === 0xfeedfacf || machO === 0xcefaedfe || machO === 0xcffaedfe || machO === 0xcafebabe;
		expect(isElf || isPe || isMachO).toBe(true);
	});

	test("the resolved binary runs and reports a version", async () => {
		const binary = resolveAstGrepBinary();
		const proc = Bun.spawn([binary!, "--version"], { stdout: "pipe", stderr: "pipe" });
		const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
		expect(await proc.exited).toBe(0);
		expect(stdout).toContain("ast-grep");
		// A shim would warn here; a native binary stays silent.
		expect(stderr.trim()).toBe("");
	});

	test("an override pointing at a missing file is returned verbatim", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "astbin-"));
		try {
			const ghost = path.join(dir, "nope");
			expect(resolveAstGrepBinary(ghost)).toBe(ghost);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("an override pointing at a shell script is honoured (user's choice)", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "astbin-"));
		try {
			const script = path.join(dir, "ast-grep");
			await writeFile(script, "#!/bin/sh\nexec true\n");
			await chmod(script, 0o755);
			expect(resolveAstGrepBinary(script)).toBe(script);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
