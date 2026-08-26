import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chmodSync } from "node:fs";
import { apply, type PluginEntry } from "../src/host.js";
import type { RegistryLike } from "../src/upgrade.js";
import type { GitLatest, NpmLatest } from "../src/registry.js";

function fakeRegistry(): RegistryLike {
	return {
		async latestNpm(name: string): Promise<NpmLatest> {
			if (name === "fx-npm") return { kind: "npm", latest: "1.1.0", error: null };
			return { kind: "npm", latest: null, error: "not found" };
		},
		async latestGit(): Promise<GitLatest> {
			return { kind: "git", latestTag: "v0.2.0", latestTagCommit: "aaaa1111bbbb2222cccc3333dddd4444eeee5555", headSha: "aaaa1111bbbb2222cccc3333dddd4444eeee5555", latestDate: null, error: null };
		},
		async npmVersionDates() {
			return null;
		},
		async commitDate() {
			return null;
		},
	} as RegistryLike;
}

/** Fake ctx.subprocess: batch-collect spawn that resolves immediately. */
function fakeSubprocess(opts: { code?: number; output?: string } = {}) {
	return {
		spawn: () => ({
			done: Promise.resolve({ exitCode: opts.code ?? 0, signal: null }),
			collected: {
				stdout: { readFrom: () => ({ text: opts.output ?? "", nextOffset: 0, lossy: false }) },
				stderr: { readFrom: () => ({ text: "", nextOffset: 0, lossy: false }) },
			},
		}),
	};
}

/** Minimal IncomingMessage stand-in covering what the host handler touches. */
function fakeReq(method: string, url: string, body?: unknown): unknown {
	const payload = body === undefined ? "" : JSON.stringify(body);
	return {
		method,
		url,
		on(event: string, cb: (d: Buffer) => void): void {
			if (event === "data" && payload) cb(Buffer.from(payload));
			if (event === "end") setImmediate(() => cb(Buffer.alloc(0)));
			if (event === "error") void cb;
		},
	};
}

/** Collect a fake ServerResponse. */
function fakeRes(): { promise: Promise<{ status: number; body: unknown }>; res: unknown } {
	let resolve!: (v: { status: number; body: unknown }) => void;
	const promise = new Promise<{ status: number; body: unknown }>((r) => (resolve = r));
	let status = 200;
	let body = "";
	const res = {
		writeHead(code: number, _headers: Record<string, string>): void {
			status = code;
		},
		end(payload: string): void {
			body = payload;
			setImmediate(() => resolve({ status, body: body ? JSON.parse(body) : null }));
		},
	};
	return { promise, res };
}

async function fixtureProfile(): Promise<string> {
	const root = await mkdtemp(path.join(os.tmpdir(), "dash-host-"));
	const dir = path.join(root, "fx");
	await mkdir(path.join(dir, "node_modules", "fx-npm"), { recursive: true });
	await mkdir(path.join(dir, "node_modules", "fx-git"), { recursive: true });
	await writeFile(path.join(dir, "package.json"), JSON.stringify({
		name: "fx",
		dependencies: { "fx-npm": "^1.0.0", "fx-git": "github:example/fx-git" },
		dsh: { profile: { bundles: ["fx-npm", "fx-git"] } },
	}, null, 2) + "\n");
	await writeFile(path.join(dir, "node_modules", "fx-npm", "package.json"), JSON.stringify({ version: "1.0.0", description: "fixture npm pkg" }));
	await writeFile(path.join(dir, "node_modules", "fx-git", "package.json"), JSON.stringify({ version: "0.1.0" }));
	await writeFile(path.join(dir, "pnpm-lock.yaml"), `lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      fx-npm:
        specifier: ^1.0.0
        version: 1.0.0
      fx-git:
        specifier: github:example/fx-git
        version: https://codeload.github.com/example/fx-git/tar.gz/1111111111111111111111111111111111111111

packages: {}
`);
	return root;
}

interface Mounted {
	disposer: () => void;
	route: { kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> };
}

function mount(profileRoot: string, registry: RegistryLike, subprocess = fakeSubprocess()): Mounted {
	let registered: Mounted["route"] | undefined;
	let disposer: (() => void) | undefined;
	const ctx = {
		webServer: {
			register: (route: Mounted["route"]) => {
				registered = route;
				return () => undefined;
			},
		},
		subprocess,
	} as never;
	disposer = apply(ctx, { registry: registry as never, profileDir: path.join(profileRoot, "fx") } as never) as () => void;
	if (!registered || typeof disposer !== "function") throw new Error("route or disposer missing");
	return { disposer, route: registered };
}

describe("host plugin", () => {
	test("registers the route prefix and returns a disposer", async () => {
		const root = await fixtureProfile();
		try {
			const { route, disposer } = mount(root, fakeRegistry());
			expect(route.kind).toBe("prefix");
			expect(route.path).toBe("/plugins/dsh-plugin-dashboard/api");
			expect(typeof disposer).toBe("function");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("list returns version inventory classified by source", async () => {
		const root = await fixtureProfile();
		try {
			const { route } = mount(root, fakeRegistry());
			const { promise, res } = fakeRes();
			await route.handler(fakeReq("GET", "/plugins/dsh-plugin-dashboard/api/list"), res);
			const { status, body } = await promise;
			expect(status).toBe(200);
			const plugins = (body as { plugins: PluginEntry[] }).plugins;
			const npm = plugins.find((p) => p.name === "fx-npm")!;
			const git = plugins.find((p) => p.name === "fx-git")!;
			expect(npm.source).toBe("npm");
			expect(npm.installedVersion).toBe("1.0.0");
			expect(npm.latest?.label).toBe("1.1.0");
			expect(npm.status).toBe("update-available");
			expect(npm.upgradeable).toBe(true);
			expect(git.source).toBe("git");
			expect(git.installedCommit).toBe("1111111111111111111111111111111111111111");
			expect(git.latest?.label).toBe("v0.2.0");
			expect(git.status).toBe("update-available");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("upgrade plan (dry) computes the new specifier", async () => {
		const root = await fixtureProfile();
		try {
			const { route } = mount(root, fakeRegistry());
			const { promise, res } = fakeRes();
			await route.handler(fakeReq("POST", "/plugins/dsh-plugin-dashboard/api/upgrade", { name: "fx-npm" }), res);
			const { status, body } = await promise;
			expect(status).toBe(200);
			const plan = (body as { plan: { newSpecifier: string; targetLabel: string; wouldChange: boolean } }).plan;
			expect(plan.newSpecifier).toBe("^1.1.0");
			expect(plan.targetLabel).toBe("1.1.0");
			expect(plan.wouldChange).toBe(true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("upgrade apply patches package.json, backs up, runs pnpm via subprocess", async () => {
		const root = await fixtureProfile();
		const spawned: string[][] = [];
		const sub = {
			spawn: (spec: { argv: string[] }) => {
				spawned.push([...spec.argv]);
				return {
					done: Promise.resolve({ exitCode: 0, signal: null }),
					collected: {
						stdout: { readFrom: () => ({ text: "Done", nextOffset: 0, lossy: false }) },
						stderr: { readFrom: () => ({ text: "", nextOffset: 0, lossy: false }) },
					},
				};
			},
		};
		try {
			const { route } = mount(root, fakeRegistry(), sub);
			const profileDir = path.join(root, "fx");

			const okRes = fakeRes();
			await route.handler(fakeReq("POST", "/plugins/dsh-plugin-dashboard/api/upgrade", { name: "fx-npm", apply: true }), okRes.res);
			const ok = await okRes.promise;
			expect(ok.status).toBe(200);
			expect((ok.body as { applied: boolean }).applied).toBe(true);
			expect(spawned).toEqual([["pnpm", "install"]]);
			const patched = JSON.parse(await readFile(path.join(profileDir, "package.json"), "utf8")) as { dependencies: Record<string, string> };
			expect(patched.dependencies["fx-npm"]).toBe("^1.1.0");
			const backups = await readdir(profileDir);
			expect(backups.some((f) => f.includes(".dshbak-"))).toBe(true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("unknown package rejected with 400", async () => {
		const root = await fixtureProfile();
		try {
			const { route } = mount(root, fakeRegistry());
			const { promise, res } = fakeRes();
			await route.handler(fakeReq("POST", "/plugins/dsh-plugin-dashboard/api/upgrade", { name: "ghost" }), res);
			const { status } = await promise;
			expect(status).toBe(400);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("unknown routes return 404", async () => {
		const root = await fixtureProfile();
		try {
			const { route } = mount(root, fakeRegistry());
			const { promise, res } = fakeRes();
			await route.handler(fakeReq("GET", "/plugins/dsh-plugin-dashboard/api/nope"), res);
			const { status } = await promise;
			expect(status).toBe(404);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
describe("host plugin — uninstall", () => {
	test("uninstall plan (dry) reports scope without touching files", async () => {
		const root = await fixtureProfile();
		try {
			const { route } = mount(root, fakeRegistry());
			const { promise, res } = fakeRes();
			await route.handler(fakeReq("POST", "/plugins/dsh-plugin-dashboard/api/uninstall", { name: "fx-npm" }), res);
			const { status, body } = await promise;
			expect(status).toBe(200);
			const plan = (body as { plan: { inDependencies: boolean; inBundles: boolean; wouldRemove: boolean } }).plan;
			expect(plan.inDependencies).toBe(true);
			expect(plan.inBundles).toBe(true);
			expect(plan.wouldRemove).toBe(true);
			// dry run must not touch the profile files
			const pkg = JSON.parse(await readFile(path.join(root, "fx", "package.json"), "utf8")) as { dependencies: Record<string, string> };
			expect(pkg.dependencies["fx-npm"]).toBe("^1.0.0");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("uninstall apply drops bundle entry and backs up", async () => {
		const root = await fixtureProfile();
		try {
			const { route } = mount(root, fakeRegistry());
			const { promise, res } = fakeRes();
			await route.handler(fakeReq("POST", "/plugins/dsh-plugin-dashboard/api/uninstall", { name: "fx-npm", apply: true }), res);
			const { status, body } = await promise;
			expect(status).toBe(200);
			expect((body as { applied: boolean }).applied).toBe(true);

			const pkg = JSON.parse(await readFile(path.join(root, "fx", "package.json"), "utf8")) as {
				dsh: { profile: { bundles: string[] } };
			};
			expect(pkg.dsh.profile.bundles).not.toContain("fx-npm");
			expect(pkg.dsh.profile.bundles).toContain("fx-git");
			const files = await readdir(path.join(root, "fx"));
			expect(files.some((f) => f.includes(".dshbak-"))).toBe(true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("entries carry source URLs (github repo / npm page)", async () => {
		const root = await fixtureProfile();
		try {
			const { route } = mount(root, fakeRegistry());
			const { promise, res } = fakeRes();
			await route.handler(fakeReq("GET", "/plugins/dsh-plugin-dashboard/api/list"), res);
			const { body } = await promise;
			const plugins = (body as { plugins: Array<{ name: string; url: string | null }> }).plugins;
			const npm = plugins.find((p) => p.name === "fx-npm")!;
			const git = plugins.find((p) => p.name === "fx-git")!;
			expect(npm.url).toBe("https://www.npmjs.com/package/fx-npm");
			expect(git.url).toBe("https://github.com/example/fx-git");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("core packages are excluded from the inventory", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "dash-core-"));
		const dir = path.join(root, "fx");
		await mkdir(dir, { recursive: true });
		await writeFile(path.join(dir, "package.json"), JSON.stringify({
			name: "fx",
			dependencies: { "fx-npm": "^1.0.0", "@deepseek-ai/dsh-base": "^1.0.0" },
			dsh: { profile: { bundles: ["fx-npm", "@deepseek-ai/dsh-base"] } },
		}, null, 2) + "\n");
		try {
			const { route } = mount(root, fakeRegistry());
			const { promise, res } = fakeRes();
			await route.handler(fakeReq("GET", "/plugins/dsh-plugin-dashboard/api/list"), res);
			const { status, body } = await promise;
			expect(status).toBe(200);
			const names = (body as { plugins: Array<{ name: string; isCore: boolean }> }).plugins.map((p) => p.name);
			expect(names).toEqual(["fx-npm"]);
			expect(names).not.toContain("@deepseek-ai/dsh-base");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("core packages are refused", async () => {
		// profile containing a real core package in deps + bundles
		const root = await mkdtemp(path.join(os.tmpdir(), "dash-core-"));
		const dir = path.join(root, "fx");
		await mkdir(dir, { recursive: true });
		await writeFile(path.join(dir, "package.json"), JSON.stringify({
			name: "fx",
			dependencies: { "@deepseek-ai/dsh-base": "^1.0.0" },
			dsh: { profile: { bundles: ["@deepseek-ai/dsh-base"] } },
		}, null, 2) + "\n");
		try {
			const { route } = mount(root, fakeRegistry());
			const { promise, res } = fakeRes();
			await route.handler(fakeReq("POST", "/plugins/dsh-plugin-dashboard/api/uninstall", { name: "@deepseek-ai/dsh-base" }), res);
			const { status, body } = await promise;
			expect(status).toBe(200);
			expect((body as { plan: { error: string } }).plan.error).toContain("core dsh package");
			expect((body as { plan: { wouldRemove: boolean } }).plan.wouldRemove).toBe(false);
			// never followed through: pnpm was not invoked (no shim on PATH)
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("unknown package uninstall rejected", async () => {
		const root = await fixtureProfile();
		try {
			const { route } = mount(root, fakeRegistry());
			const { promise, res } = fakeRes();
			await route.handler(fakeReq("POST", "/plugins/dsh-plugin-dashboard/api/uninstall", { name: "ghost" }), res);
			// plan.error path returns 200 with error, mirroring upgrade
			const { status, body } = await promise;
			expect(status).toBe(200);
			expect((body as { plan: { error: string } }).plan.error).toContain("not part of this profile");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

// re-exported for the uninstall cases
import { readdir } from "node:fs/promises";
