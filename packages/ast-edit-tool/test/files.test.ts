import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collectFiles } from "../src/files.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";

async function fixture(): Promise<string> {
	const dir = await mkdtemp(path.join(os.tmpdir(), "ast-edit-files-"));
	await writeFile(path.join(dir, "a.js"), "a();\n");
	await writeFile(path.join(dir, "b.py"), "b()\n");
	await writeFile(path.join(dir, ".hidden.c"), "c\n");
	for (const sub of ["sub", "node_modules", ".git"]) {
		await mkdir(path.join(dir, sub), { recursive: true });
	}
	await writeFile(path.join(dir, "sub", "d.ts"), "d\n");
	await writeFile(path.join(dir, "node_modules", "e.js"), "e\n");
	await writeFile(path.join(dir, ".git", "f.js"), "f\n");
	await writeFile(path.join(dir, ".gitignore"), "b.py\n");
	return dir;
}

describe("collectFiles", () => {
	test("walks directories recursively, includes hidden, skips node_modules and .git, respects .gitignore", async () => {
		const dir = await fixture();
		try {
			const { files } = await collectFiles([dir], { cwd: dir, maxFiles: 1000 });
			const rels = files.map((f) => path.relative(dir, f)).sort();
			expect(rels).toEqual([".gitignore", ".hidden.c", "a.js", path.join("sub", "d.ts")]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("node_modules is searched when a path names it", async () => {
		const dir = await fixture();
		try {
			const { files } = await collectFiles([path.join(dir, "node_modules")], { cwd: dir, maxFiles: 1000 });
			const rels = files.map((f) => path.relative(dir, f)).sort();
			expect(rels).toEqual([path.join("node_modules", "e.js")]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("glob entries resolve", async () => {
		const dir = await fixture();
		try {
			const { files } = await collectFiles(["**/*.js"], { cwd: dir, maxFiles: 1000 });
			const rels = files.map((f) => path.relative(dir, f)).sort();
			expect(rels).toEqual(["a.js"]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("maxFiles cap sets limitReached", async () => {
		const dir = await fixture();
		try {
			const { files, limitReached, searchedCount } = await collectFiles([dir], { cwd: dir, maxFiles: 1 });
			expect(files.length).toBe(1);
			expect(limitReached).toBe(true);
			expect(searchedCount).toBeGreaterThan(1);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});