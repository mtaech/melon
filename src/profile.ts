/**
 * DSH profile discovery + reading: package.json (bundles/dependencies),
 * installed package metadata, and the pnpm lockfile's resolved git commits.
 */
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ProfileSummary {
	name: string;
	dir: string;
	bundles: string[];
	dependencies: Record<string, string>;
	packageJson: Record<string, unknown>;
}

export interface InstalledInfo {
	version: string | null;
	description?: string;
}

export type PluginSource = "npm" | "git" | "local" | "unknown";

export interface GithubSpec {
	user: string;
	repo: string;
	ref: string | null;
}

export function profilesRoot(): string {
	return process.env.DSH_PROFILES_ROOT?.trim() || path.join(os.homedir(), ".dsh", "profiles");
}

/** Directories under the profiles root that contain a package.json. */
export async function listProfiles(): Promise<string[]> {
	const root = profilesRoot();
	if (!existsSync(root)) return [];
	const entries = await fs.readdir(root, { withFileTypes: true });
	const names: string[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (!existsSync(path.join(root, entry.name, "package.json"))) continue;
		names.push(entry.name);
	}
	return names.sort();
}

/** Load one profile's package.json. `name` is a single path segment only. */
export async function loadProfile(name: string): Promise<ProfileSummary> {
	if (!name || name.includes("/") || name.includes("\\") || name === "." || name === "..") {
		throw new Error(`invalid profile name ${JSON.stringify(name)}`);
	}
	return readProfileDir(path.join(profilesRoot(), name), name);
}

/** Read a profile directly from its directory (the dsh process cwd case). */
export async function readProfileDir(dir: string, name?: string): Promise<ProfileSummary> {
	const pkgPath = path.join(dir, "package.json");
	if (!existsSync(pkgPath)) {
		throw new Error(`profile ${JSON.stringify(name)} has no package.json (${dir})`);
	}
	let raw: string;
	try {
		raw = await fs.readFile(pkgPath, "utf8");
	} catch (error) {
		throw new Error(`cannot read ${pkgPath}: ${error instanceof Error ? error.message : String(error)}`);
	}
	let data: Record<string, unknown>;
	try {
		data = JSON.parse(raw) as Record<string, unknown>;
	} catch (error) {
		throw new Error(`profile ${JSON.stringify(name)} package.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	const dependencies = (data.dependencies ?? {}) as Record<string, string>;
	const dsh = (data.dsh ?? {}) as { profile?: { bundles?: string[] } };
	return {
		name: name ?? path.basename(dir),
		dir,
		bundles: Array.isArray(dsh.profile?.bundles) ? (dsh.profile.bundles as string[]) : [],
		dependencies,
		packageJson: data,
	};
}

/** Host/core packages (bundled with dsh itself). */
export function isCorePackage(name: string): boolean {
	return /^@deepseek-ai\//.test(name) || /^@deepseek-harness-tui\//.test(name);
}

/** Parse `github:user/repo` or `github:user/repo#ref`; other forms return null. */
export function parseGithubSpec(spec: string): GithubSpec | null {
	const m = /^github:([^/\s]+)\/([^#\s]+)(?:#(.+))?$/.exec(spec.trim());
	if (!m) return null;
	return { user: m[1]!, repo: m[2]!.replace(/\.git$/, ""), ref: m[3] ?? null };
}

export function sourceOf(specifier: string): PluginSource {
	const s = specifier.trim();
	if (!s) return "unknown";
	if (s.startsWith("github:") || s.startsWith("git+") || s.startsWith("git:")) return "git";
	if (s.startsWith("file:") || s.startsWith("link:") || s.startsWith("workspace:")) return "local";
	return "npm";
}

/** Installed package.json metadata from the profile's node_modules. */
export async function readInstalled(profileDir: string, name: string): Promise<InstalledInfo | null> {
	const pkgPath = path.join(profileDir, "node_modules", ...name.split("/"), "package.json");
	try {
		const data = JSON.parse(await fs.readFile(pkgPath, "utf8")) as { version?: string; description?: string };
		return { version: data.version ?? null, description: data.description };
	} catch {
		return null;
	}
}

/** Extract the resolved commit of a github-installed package from pnpm-lock.yaml.
 *
 * The importer section lists each direct dependency with its resolved `version`
 * — for git-hosted packages that is a codeload tarball URL carrying the 40-hex
 * commit. Parsed with a small indentation state machine (no YAML dependency).
 */
export function readLockCommit(lockText: string, name: string): string | null {
	const lines = lockText.split("\n");
	const importerIdx = lines.findIndex((l) => l.trim() === "importers:");
	if (importerIdx < 0) return null;

	let depsLevel = -1; // indentation of the current dependencies: block
	let depName: string | null = null;
	let depVersion: string | null = null;
	const record = (n: string | null, v: string | null): string | null => {
		if (n === name && v) {
			const sha = /tar\.gz\/([0-9a-f]{40})/.exec(v)?.[1];
			if (sha) return sha;
		}
		return null;
	};

	for (let i = importerIdx + 1; i < lines.length; i++) {
		const line = lines[i]!;
		if (line === "" ) continue;
		// top-level section (col 0), e.g. `packages:` — importer block is done
		if (!line.startsWith(" ") && !line.startsWith("\t")) break;
		const indent = line.match(/^ */)?.[0].length ?? 0;

		if (indent === 2) {
			// another importer (workspace) — keep scanning, record current dep
			const hit = record(depName, depVersion);
			if (hit) return hit;
			depName = null;
			depVersion = null;
			depsLevel = -1;
			continue;
		}
		const depsKind = /^ {4}(dependencies|optionalDependencies|devDependencies):$/.exec(line);
		if (depsKind) {
			depsLevel = 4;
			continue;
		}
		if (depsLevel === 4) {
			const dep = /^ {6}(\S+):$/.exec(line);
			if (dep) {
				const hit = record(depName, depVersion);
				if (hit) return hit;
				depName = dep[1]!;
				depVersion = null;
				continue;
			}
			const kv = /^ {8}(\w+): (.+)$/.exec(line);
			if (kv && kv[1] === "version") {
				depVersion = kv[2]!;
				const hit = record(depName, depVersion);
				if (hit) return hit;
			}
		}
	}
	return record(depName, depVersion);
}