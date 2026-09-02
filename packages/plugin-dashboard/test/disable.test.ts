import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, readFile, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	appendDisableBlock, applyDisable, applyEnable, hasDisableBlock, planDisable, planEnable, pluginRows, removeDisableBlock,
	PATCH_FILENAME, type LoaderLike, type PluginRow,
} from "../src/disable.js";

function loaderOf(rows: Array<{ id?: string; name?: string; disabled?: boolean }>): LoaderLike {
	return {
		entries: () => rows.map((row) => ({ options: row, disabled: row.disabled === true })),
	};
}

const ROW: PluginRow = { id: "plugin-dashboard", name: "dsh-plugin-dashboard", disabled: false };

describe("pluginRows", () => {
	test("attributes rows by options.name and keeps file ids", () => {
		const loader = loaderOf([
			{ id: "plugin-dashboard", name: "dsh-plugin-dashboard" },
			{ id: "other", name: "dsh-browser-tool" },
			{ name: "dsh-plugin-dashboard" }, // id-less row: not targetable by a patch
			{ id: "group", name: "cordis:group" },
		]);
		expect(pluginRows(loader, "dsh-plugin-dashboard")).toEqual([
			{ id: "plugin-dashboard", name: "dsh-plugin-dashboard", disabled: false },
		]);
	});

	test("evaluates disabled from entry.disabled and options.disabled", () => {
		const loader = {
			entries: () => [
				{ options: { id: "a", name: "p", disabled: true }, disabled: false },
				{ options: { id: "b", name: "p" }, disabled: true },
				{ options: { id: "c", name: "p" }, disabled: false },
			],
		};
		const rows = pluginRows(loader, "p");
		expect(rows.map((r) => r.disabled)).toEqual([true, true, false]);
	});

	test("returns [] when the loader is unavailable", () => {
		expect(pluginRows(undefined, "p")).toEqual([]);
	});
});

describe("planDisable", () => {
	test("plans only the rows that are not yet disabled", () => {
		const plan = planDisable("dsh-plugin-dashboard", [ROW, { ...ROW, id: "ui", disabled: true }], "live");
		expect(plan.wouldChange).toBe(true);
		expect(plan.effect).toBe("live");
		expect(plan.rows.map((r) => ({ id: r.id, wouldDisable: r.wouldDisable }))).toEqual([
			{ id: "plugin-dashboard", wouldDisable: true },
			{ id: "ui", wouldDisable: false },
		]);
	});

	test("errors when the plugin has no attributable rows", () => {
		const plan = planDisable("ghost", [], "startup");
		expect(plan.error).toContain("未找到");
		expect(plan.wouldChange).toBe(false);
		expect(plan.effect).toBe("restart");
	});

	test("reports already-fully-disabled plugins", () => {
		const plan = planDisable("p", [{ ...ROW, disabled: true }], "live");
		expect(plan.wouldChange).toBe(false);
		expect(plan.error).toContain("已全部禁用");
	});
});

describe("managed block file I/O", () => {
	test("append preserves existing content and writes a marker-delimited block", () => {
		const original = "# user layer\n- id: existing\n  config:\n    x: 1\n";
		const next = appendDisableBlock(original, "dsh-plugin-dashboard", [{ id: "plugin-dashboard", name: "dsh-plugin-dashboard" }]);
		expect(next.startsWith(original)).toBe(true);
		expect(next).toContain("# >>> dsh-plugin-dashboard managed: disabled plugin dsh-plugin-dashboard");
		expect(next).toContain("- id: plugin-dashboard\n  name: dsh-plugin-dashboard\n  disabled: true");
		expect(next).toContain("# <<< dsh-plugin-dashboard managed");
	});

	test("quotes ids/names with YAML-special characters", () => {
		const next = appendDisableBlock("", "@scope/pkg", [{ id: "@scope/ui", name: "@scope/pkg" }]);
		expect(next).toContain('- id: "@scope/ui"');
		expect(next).toContain('  name: "@scope/pkg"');
	});

	test("append refuses empty row lists", () => {
		expect(() => appendDisableBlock("# x\n", "p", [])).toThrow("no rows to disable");
	});

	test("remove drops only the matching plugin's block", () => {
		const withA = appendDisableBlock("# keep\n", "plugin-a", [{ id: "a", name: "plugin-a" }]);
		const both = appendDisableBlock(withA, "plugin-b", [{ id: "b", name: "plugin-b" }]);
		const next = removeDisableBlock(both, "plugin-a");
		expect(next).toContain("plugin-b");
		expect(next).toContain("- id: b");
		expect(next).not.toContain("plugin-a");
		expect(next).not.toContain("managed: disabled plugin plugin-a");
	});

	test("remove round-trips back to the original content", () => {
		const original = "- id: keep\n  config: {}\n";
		const withBlock = appendDisableBlock(original, "p", [ROW]);
		expect(removeDisableBlock(withBlock, "p")).toBe(original);
	});

	test("hasDisableBlock / removeDisableBlock reject missing state", () => {
		expect(hasDisableBlock("# none\n", "p")).toBe(false);
		expect(() => removeDisableBlock("# none\n", "p")).toThrow("未找到");
	});

	test("remove throws on a block without its end marker", () => {
		const broken = "# >>> dsh-plugin-dashboard managed: disabled plugin p\n- id: x\n  disabled: true\n";
		expect(() => removeDisableBlock(broken, "p")).toThrow("缺少结束标记");
	});
});

describe("planEnable", () => {
	async function fixtureWithBlock(): Promise<{ dir: string; content: string }> {
		const dir = await mkdtemp(path.join(os.tmpdir(), "dash-enable-"));
		const content = appendDisableBlock("# user\n", "dsh-plugin-dashboard", [ROW]);
		await writeFile(path.join(dir, PATCH_FILENAME), content);
		return { dir, content };
	}

	test("finds the managed block and reports restore rows", async () => {
		const { dir } = await fixtureWithBlock();
		try {
			const plan = await planEnable(dir, "dsh-plugin-dashboard", [{ ...ROW, disabled: true }], "live");
			expect(plan.found).toBe(true);
			expect(plan.wouldChange).toBe(true);
			expect(plan.effect).toBe("live");
			expect(plan.rows).toEqual([{ id: "plugin-dashboard", name: "dsh-plugin-dashboard" }]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("errors when no dashboard-managed block exists", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "dash-enable-"));
		try {
			await writeFile(path.join(dir, PATCH_FILENAME), "# user\n");
			const plan = await planEnable(dir, "p", [], "startup");
			expect(plan.found).toBe(false);
			expect(plan.wouldChange).toBe(false);
			expect(plan.error).toContain("未找到");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("applyDisable / applyEnable", () => {
	async function fixtureDir(): Promise<string> {
		const dir = await mkdtemp(path.join(os.tmpdir(), "dash-apply-disable-"));
		await writeFile(path.join(dir, PATCH_FILENAME), "# user layer\n- id: keep\n  config: {}\n");
		return dir;
	}

	test("disable backs up, appends the block, and logs", async () => {
		const dir = await fixtureDir();
		try {
			const plan = planDisable("dsh-plugin-dashboard", [ROW], "live");
			const result = await applyDisable(dir, plan);
			expect(result.log.join(" ")).toContain("plugin-dashboard");
			const content = await readFile(path.join(dir, PATCH_FILENAME), "utf8");
			expect(hasDisableBlock(content, "dsh-plugin-dashboard")).toBe(true);
			const files = await readdir(dir);
			expect(files.some((f) => f.includes(".dshbak-"))).toBe(true);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("enable removes the managed block and restores the file", async () => {
		const dir = await fixtureDir();
		try {
			const block = appendDisableBlock(await readFile(path.join(dir, PATCH_FILENAME), "utf8"), "dsh-plugin-dashboard", [ROW]);
			await writeFile(path.join(dir, PATCH_FILENAME), block);
			const plan = await planEnable(dir, "dsh-plugin-dashboard", [{ ...ROW, disabled: true }], "startup");
			const result = await applyEnable(dir, plan);
			expect(result.log.join(" ")).toContain("移除");
			const content = await readFile(path.join(dir, PATCH_FILENAME), "utf8");
			expect(hasDisableBlock(content, "dsh-plugin-dashboard")).toBe(false);
			expect(content).toContain("- id: keep");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("applyDisable throws on a no-op plan", async () => {
		const dir = await fixtureDir();
		try {
			const plan = planDisable("p", [{ ...ROW, disabled: true }], "live");
			await expect(applyDisable(dir, plan)).rejects.toThrow("已全部禁用");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});