import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { planUpgrade, applyUpgrade, planUninstall, applyUninstall, dshCommandPrefix, type RegistryLike, type CommandRunner } from "../src/upgrade.js";
import type { ProfileSummary } from "../src/profile.js";
import type { GitLatest, NpmLatest } from "../src/registry.js";

function fakeRegistry(opts: { npm?: Partial<NpmLatest>; git?: Partial<GitLatest>; dates?: Record<string, string> }): RegistryLike {
	return {
		async latestNpm() {
			return { kind: "npm", latest: null, error: null, ...opts.npm };
		},
		async latestGit() {
			return { kind: "git", latestTag: null, latestTagCommit: null, headSha: null, latestDate: null, error: null, ...opts.git };
		},
		async npmVersionDates() {
			return opts.dates ?? null;
		},
		async commitDate() {
			return "2026-01-02T00:00:00.000Z";
		},
	};
}

function profile(dependencies: Record<string, string>, dir = "/tmp/fake"): ProfileSummary {
	return { name: "t", dir, bundles: Object.keys(dependencies), dependencies, packageJson: {} };
}

describe("planUpgrade — npm", () => {
	test("flags a newer registry version", async () => {
		const plan = await planUpgrade(profile({ "dsh-x": "^0.14.0" }), "dsh-x", fakeRegistry({ npm: { latest: "0.15.1" } }), { version: "0.14.0" }, null);
		expect(plan.wouldChange).toBe(true);
		expect(plan.newSpecifier).toBe("^0.15.1");
		expect(plan.targetLabel).toBe("0.15.1");
		expect(plan.source).toBe("npm");
	});

	test("npm plan carries installed + latest publish dates from the manifest", async () => {
		const plan = await planUpgrade(profile({ "dsh-x": "^0.14.0" }), "dsh-x", fakeRegistry({ npm: { latest: "0.15.1" }, dates: { "0.14.0": "2026-01-01T00:00:00.000Z", "0.15.1": "2026-03-15T00:00:00.000Z" } }), { version: "0.14.0" }, null);
		expect(plan.currentVersionDate).toBe("2026-01-01T00:00:00.000Z");
		expect(plan.latestVersionDate).toBe("2026-03-15T00:00:00.000Z");
	});

	test("git plan carries installed commit + latest tag dates", async () => {
		const plan = await planUpgrade(profile({ "dsh-browser-tool": "github:mtaech/dsh-browser-tool" }), "dsh-browser-tool", fakeRegistry({
			git: { latestTag: "v0.2.0", latestTagCommit: "a".repeat(40), headSha: "a".repeat(40), latestDate: "2026-05-01T00:00:00.000Z" },
		}), { version: "0.1.0" }, "1".repeat(40));
		expect(plan.currentVersionDate).toBe("2026-01-02T00:00:00.000Z"); // from commitDate fake
		expect(plan.latestVersionDate).toBe("2026-05-01T00:00:00.000Z");
	});

	test("up-to-date when installed equals latest", async () => {
		const plan = await planUpgrade(profile({ "dsh-x": "^0.14.0" }), "dsh-x", fakeRegistry({ npm: { latest: "0.14.0" } }), { version: "0.14.0" }, null);
		expect(plan.wouldChange).toBe(false);
		expect(plan.newSpecifier).toBe("^0.14.0");
	});

	test("preserves tilde range style", async () => {
		const plan = await planUpgrade(profile({ "dsh-x": "~1.0.0" }), "dsh-x", fakeRegistry({ npm: { latest: "1.1.0" } }), { version: "1.0.0" }, null);
		expect(plan.newSpecifier).toBe("~1.1.0");
	});

	test("reports registry errors", async () => {
		const plan = await planUpgrade(profile({ "dsh-x": "^1.0.0" }), "dsh-x", fakeRegistry({ npm: { error: "404" } }), { version: "1.0.0" }, null);
		expect(plan.error).toContain("404");
	});
});

describe("planUpgrade — git", () => {
	const base = { "dsh-browser-tool": "github:mtaech/dsh-browser-tool" };
	const installedCommit = "e5f13a7555681b0598b7a9a9ec397dfdd9142063";

	test("targets the highest semver tag when one exists", async () => {
		const plan = await planUpgrade(profile(base), "dsh-browser-tool", fakeRegistry({
			git: { latestTag: "v0.2.0", latestTagCommit: "aaaa1111bbbb2222cccc3333dddd4444eeee5555", headSha: "aaaa1111bbbb2222cccc3333dddd4444eeee5555" },
		}), { version: "0.1.0" }, installedCommit);
		expect(plan.newSpecifier).toBe("github:mtaech/dsh-browser-tool#v0.2.0");
		expect(plan.targetLabel).toBe("v0.2.0");
		expect(plan.wouldChange).toBe(true);
	});

	test("up-to-date when installed commit equals latest tag commit", async () => {
		const c = "aaaa1111bbbb2222cccc3333dddd4444eeee5555";
		const plan = await planUpgrade(profile(base), "dsh-browser-tool", fakeRegistry({
			git: { latestTag: "v0.1.0", latestTagCommit: c, headSha: c },
		}), { version: "0.1.0" }, c);
		expect(plan.wouldChange).toBe(false);
		expect(plan.targetLabel).toBe("v0.1.0");
	});

	test("pins HEAD when the repo has no tags", async () => {
		const head = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
		const plan = await planUpgrade(profile(base), "dsh-browser-tool", fakeRegistry({
			git: { latestTag: null, latestTagCommit: null, headSha: head },
		}), { version: "0.1.0" }, installedCommit);
		expect(plan.newSpecifier).toBe(`github:mtaech/dsh-browser-tool#${head}`);
		expect(plan.targetLabel).toContain("HEAD");
	});

	test("reports git errors", async () => {
		const plan = await planUpgrade(profile(base), "dsh-browser-tool", fakeRegistry({ git: { error: "could not read Username" } }), { version: "0.1.0" }, installedCommit);
		expect(plan.error).toContain("could not read");
	});
});

describe("planUpgrade — local and unknown", () => {
	test("local deps are not upgradeable", async () => {
		const plan = await planUpgrade(profile({ "local-x": "file:../x" }), "local-x", fakeRegistry({}), null, null);
		expect(plan.error).toContain("not upgradeable");
		expect(plan.source).toBe("local");
	});

	test("undiscovered dependency errors", async () => {
		const plan = await planUpgrade(profile({ "a": "^1.0.0" }), "ghost", fakeRegistry({}), null, null);
		expect(plan.error).toContain("not a dependency");
	});
});

describe("applyUpgrade / applyUninstall", () => {
	async function fixtureProfile(deps: Record<string, string>, bundles: string[] = Object.keys(deps)): Promise<string> {
		const dir = await mkdtemp(path.join(os.tmpdir(), "dashboard-apply-"));
		await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "t", dependencies: deps, dsh: { profile: { bundles } } }, null, 2) + "\n");
		return dir;
	}

	test("upgrade runs pnpm install, patches deps, backs up", async () => {
		const dir = await fixtureProfile({ "dsh-x": "^0.14.0" });
		try {
			const calls: string[][] = [];
			const runner: CommandRunner = async (argv) => { calls.push([...argv]); return { code: 0, output: "Done in 1s" }; };
			const plan = await planUpgrade(profile({ "dsh-x": "^0.14.0" }, dir), "dsh-x", fakeRegistry({ npm: { latest: "0.15.1" } }), { version: "0.14.0" }, null);
			const result = await applyUpgrade(dir, plan, runner);

			expect(calls).toEqual([[...dshCommandPrefix(), "plugin", "--profile", "t", "add", "dsh-x@^0.15.1"]]);
			expect(plan.command).toBe("dsh plugin --profile t add dsh-x@0.15.1");
			const patched = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")) as { dependencies: Record<string, string> };
			expect(patched.dependencies["dsh-x"]).toBe("^0.15.1");
			expect(result.output).toBe("Done in 1s");
			expect(result.backupPath).toContain(".dshbak-");
			const backup = JSON.parse(await readFile(result.backupPath, "utf8")) as { dependencies: Record<string, string> };
			expect(backup.dependencies["dsh-x"]).toBe("^0.14.0");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("upgrade restores package.json when pnpm fails", async () => {
		const dir = await fixtureProfile({ "dsh-x": "1.0.0" });
		try {
			const runner: CommandRunner = async () => ({ code: 1, output: "ERR! network" });
			const plan = await planUpgrade(profile({ "dsh-x": "1.0.0" }, dir), "dsh-x", fakeRegistry({ npm: { latest: "2.0.0" } }), { version: "1.0.0" }, null);
			await expect(applyUpgrade(dir, plan, runner)).rejects.toThrow(/dsh plugin add exited 1/);
			const restored = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")) as { dependencies: Record<string, string> };
			expect(restored.dependencies["dsh-x"]).toBe("1.0.0");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("uninstall runs pnpm remove and drops the bundle entry", async () => {
		const dir = await fixtureProfile({ "fx": "^1.0.0", "keep": "^1.0.0" }, ["fx", "keep"]);
		try {
			const calls: string[][] = [];
			const runner: CommandRunner = async (argv) => { calls.push([...argv]); return { code: 0, output: "" }; };
			const plan = planUninstall(profile({ "fx": "^1.0.0", "keep": "^1.0.0" }, dir), "fx");
			expect(plan.wouldRemove).toBe(true);
			expect(plan.profileName).toBe("t");
			await applyUninstall(dir, plan, runner);
			expect(calls).toEqual([[...dshCommandPrefix(), "plugin", "--profile", "t", "remove", "fx"]]);
			const pkg = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")) as { dsh: { profile: { bundles: string[] } } };
			expect(pkg.dsh.profile.bundles).toEqual(["keep"]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("core and unknown uninstall plans are refused", () => {
		const p = profile({ "a": "^1.0.0" });
		expect(planUninstall(p, "ghost").error).toContain("not part of this profile");
		expect(planUninstall(profile({ "@deepseek-ai/x": "^1.0.0" }), "@deepseek-ai/x").error).toContain("core");
	});
});

describe("plan command form", () => {
	test("plan commands use the native dsh plugin form (no cd, no quoting)", async () => {
		const dir = "/home/huang/.dsh/profiles/web";
		const plan = await planUpgrade(profile({ "dsh-better-sidebar": "^0.14.0" }, dir), "dsh-better-sidebar", fakeRegistry({ npm: { latest: "0.16.1" } }), { version: "0.14.0" }, null);
		expect(plan.command).toBe("dsh plugin --profile t add dsh-better-sidebar@0.16.1");
		expect(plan.command).not.toContain('cd');
		expect(plan.command).not.toContain('"');
	});
});
