/**
 * dsh-plugin-dashboard host half: a cordis plugin that serves the plugin
 * version inventory + upgrade/uninstall API on the host webserver, using
 * dsh-native capabilities only — ctx.subprocess for command execution and
 * the node runtime's global fetch for registry lookups. The dsh process runs
 * with the profile directory as its cwd, so all reads target that directory's
 * package.json / node_modules / pnpm-lock.yaml.
 */
import { readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-host-webserver";
import type { SubprocessRuntime } from "@deepseek-ai/dsh-subprocess";
import { Registry } from "./registry.js";
import { readProfileDir, readInstalled, readLockCommit, isCorePackage, sourceOf, type ProfileSummary, type PluginSource } from "./profile.js";
import { planUpgrade, applyUpgrade, planUninstall, applyUninstall, type UpgradePlan, type UninstallPlan, type CommandRunner } from "./upgrade.js";

export const name = "dsh-plugin-dashboard";
export const inject = ["webServer", "subprocess"];

export interface PluginEntry {
	name: string;
	mounted: boolean;
	isCore: boolean;
	source: PluginSource;
	specifier: string;
	installedVersion: string | null;
	installedCommit: string | null;
	description?: string;
	latest: { label: string; targetCommit: string | null; error: string | null } | null;
	status: "update-available" | "up-to-date" | "not-installed" | "ahead" | "unknown" | "n-a";
	upgradeable: boolean;
}

export interface HostOptions {
	/** Injectable for tests; defaults to a fresh Registry over the node fetch. */
	registry?: Registry;
	/** Override the profile directory (default: process.cwd(), the dsh profile dir). */
	profileDir?: string;
}

const ROUTE_PREFIX = "/plugins/dsh-plugin-dashboard/api";

function json(res: ServerResponse, code: number, body: unknown): void {
	const payload = JSON.stringify(body);
	res.writeHead(code, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload) });
	res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let data = "";
		req.on("data", (d: Buffer) => {
			data += d.toString("utf8");
			if (data.length > 1_000_000) reject(new Error("body too large"));
		});
		req.on("end", () => resolve(data));
		req.on("error", reject);
	});
}

async function mapLimited<T>(items: readonly string[], limit: number, fn: (name: string) => Promise<T>): Promise<T[]> {
	const out: T[] = new Array(items.length);
	let cursor = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			for (;;) {
				const idx = cursor++;
				if (idx >= items.length) return;
				out[idx] = await fn(items[idx]!);
			}
		}),
	);
	return out;
}

/** Resolve the profile directory: explicit option > env > cwd (dsh runs there) > default web profile. */
function resolveProfileDir(explicit?: string): string {
	if (explicit?.trim()) return explicit.trim();
	const fromEnv = process.env.DSH_PLUGIN_DASHBOARD_PROFILE_DIR?.trim();
	if (fromEnv) return fromEnv;
	const cwd = process.cwd();
	const candidates = [cwd, path.join(os.homedir(), ".dsh", "profiles", "web")];
	for (const dir of candidates) {
		try {
			const raw = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { dsh?: unknown };
			if (raw && typeof raw === "object" && "dsh" in raw) return dir;
		} catch {
			// not a profile dir; try the next candidate
		}
	}
	return cwd;
}

/** Adapter over ctx.subprocess: run one batch command, collect bounded output. */
export function subprocessRunner(sub: SubprocessRuntime): CommandRunner {
	return async (argv, opts) => {
		const aborter = new AbortController();
		const timer = setTimeout(() => aborter.abort(), opts.timeoutMs);
		try {
			const handle = sub.spawn({
				argv,
				cwd: opts.cwd,
				stdio: {
					stdin: "ignore",
					stdout: { maxBytes: 512_000 },
					stderr: { maxBytes: 256_000 },
				},
				graceMs: 10_000,
				signal: aborter.signal,
			});
			const outcome = await handle.done;
			const out = handle.collected.stdout?.readFrom(0).text ?? "";
			const err = handle.collected.stderr?.readFrom(0).text ?? "";
			return { code: outcome.exitCode ?? -1, output: out || err ? `${out}\n${err}`.trim() : "" };
		} catch (error) {
			return { code: -1, output: error instanceof Error ? error.message : String(error) };
		} finally {
			clearTimeout(timer);
		}
	};
}

async function buildInventory(profile: ProfileSummary, registry: Registry): Promise<PluginEntry[]> {
	const lockText = await fs.readFile(path.join(profile.dir, "pnpm-lock.yaml"), "utf8").catch(() => "");
	const names = new Set<string>([...Object.keys(profile.dependencies), ...profile.bundles]);
	const sorted = [...names].sort();

	return mapLimited(sorted, 8, async (name) => {
		const specifier = profile.dependencies[name] ?? "";
		const installed = await readInstalled(profile.dir, name);
		const installedCommit = specifier ? readLockCommit(lockText, name) : null;
		const source = specifier ? sourceOf(specifier) : "unknown";
		const entry: PluginEntry = {
			name,
			mounted: profile.bundles.includes(name),
			isCore: isCorePackage(name),
			source,
			specifier,
			installedVersion: installed?.version ?? null,
			installedCommit,
			description: installed?.description,
			latest: null,
			status: "unknown",
			upgradeable: false,
		};
		if (!specifier || source === "local" || source === "unknown") {
			entry.latest = { label: "-", targetCommit: null, error: null };
			return entry;
		}
		const plan = await planUpgrade(profile, name, registry, installed, installedCommit);
		if (plan.error) {
			entry.latest = { label: "-", targetCommit: null, error: plan.error };
			return entry;
		}
		entry.latest = { label: plan.targetLabel, targetCommit: plan.targetCommit, error: null };
		if (!installed) {
			entry.status = "not-installed";
		} else if (source === "git") {
			entry.status = installedCommit === null || plan.targetCommit === null ? "unknown" : plan.targetCommit === installedCommit ? "up-to-date" : "update-available";
		} else if (plan.wouldChange) {
			entry.status = "update-available";
		} else {
			entry.status = entry.installedVersion === plan.targetLabel ? "up-to-date" : "ahead";
		}
		entry.upgradeable = entry.status === "update-available" || entry.status === "not-installed";
		return entry;
	});
}

export function apply(ctx: Context, options: HostOptions = {}): () => void {
	const registry = options.registry ?? new Registry();
	const profileDir = resolveProfileDir(options.profileDir);
	const runner = subprocessRunner(ctx.subprocess);

	const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
		try {
			const url = new URL(req.url ?? "/", "http://localhost");
			const pathname = url.pathname;

			if (req.method === "GET" && pathname === `${ROUTE_PREFIX}/health`) {
				json(res, 200, { dshRunning: await isDshRunning(runner), profileDir });
				return;
			}
			if (req.method === "GET" && pathname === `${ROUTE_PREFIX}/list`) {
				if (url.searchParams.get("force") === "1") registry.clearCache();
				const profile = await readProfileDir(profileDir);
				const plugins = await buildInventory(profile, registry);
				json(res, 200, { profile: profile.name, dshRunning: await isDshRunning(runner), plugins });
				return;
			}
			if (req.method === "POST" && pathname === `${ROUTE_PREFIX}/upgrade`) {
				const body = JSON.parse((await readBody(req)) || "{}") as { name?: string; apply?: boolean };
				if (!body.name) {
					json(res, 400, { error: "name is required" });
					return;
				}
				const profile = await readProfileDir(profileDir);
				if (!profile.dependencies[body.name]) {
					json(res, 400, { error: `${body.name} is not a dependency of this profile` });
					return;
				}
				const installed = await readInstalled(profile.dir, body.name);
				const lockText = await fs.readFile(path.join(profile.dir, "pnpm-lock.yaml"), "utf8").catch(() => "");
				const installedCommit = readLockCommit(lockText, body.name);
				const plan = (await planUpgrade(profile, body.name, registry, installed, installedCommit)) as UpgradePlan;

				if (!body.apply) {
					json(res, 200, { plan });
					return;
				}
				if (plan.error || !plan.wouldChange) {
					json(res, 200, { plan, applied: false, log: [] });
					return;
				}
				const applied = await applyUpgrade(profile.dir, plan, runner);
				json(res, 200, { plan, applied: true, backupPath: applied.backupPath, log: splitLog(applied.output) });
				return;
			}
			if (req.method === "POST" && pathname === `${ROUTE_PREFIX}/uninstall`) {
				const body = JSON.parse((await readBody(req)) || "{}") as { name?: string; apply?: boolean };
				if (!body.name) {
					json(res, 400, { error: "name is required" });
					return;
				}
				const profile = await readProfileDir(profileDir);
				const plan = planUninstall(profile, body.name) as UninstallPlan;
				if (plan.error) {
					json(res, 200, { plan, applied: false, log: [] });
					return;
				}
				if (!body.apply) {
					json(res, 200, { plan });
					return;
				}
				const applied = await applyUninstall(profile.dir, plan, runner);
				json(res, 200, { plan, applied: true, backupPath: applied.backupPath, log: splitLog(applied.output) });
				return;
			}
			json(res, 404, { error: "not found" });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			json(res, 500, { error: message });
		}
	};

	const disposer = ctx.webServer.register({ kind: "prefix", path: ROUTE_PREFIX, handler });
	return () => {
		disposer();
	};
}

function splitLog(output: string): string[] {
	return output.split("\n").map((l) => l.replace(/\r$/, "")).filter(Boolean).slice(-200);
}

/** Best-effort check whether a dsh process is running, via ctx.subprocess. */
async function isDshRunning(runner: CommandRunner): Promise<boolean> {
	const { code, output } = await runner(["pgrep", "-f", "dsh (web|tui|headless|serve)"], { cwd: process.cwd(), timeoutMs: 3000 });
	return code === 0 && output.trim().length > 0;
}