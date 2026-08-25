/**
 * Version discovery via HTTP APIs, executed in the dsh node runtime (global
 * fetch — no subprocesses): npm registry dist-tags for registry packages,
 * GitHub REST API for git-installed ones. Results cached in memory with TTL.
 */
import { compareSemver, extractTagVersion, formatSemver } from "./semver.js";

export interface NpmLatest {
	kind: "npm";
	latest: string | null;
	error: string | null;
}

export interface GitLatest {
	kind: "git";
	/** Highest semver tag (e.g. `v1.2.3`), or null when the repo has none. */
	latestTag: string | null;
	/** Commit of the latest semver tag; fallback to HEAD when no tags exist. */
	latestTagCommit: string | null;
	/** HEAD commit sha. */
	headSha: string | null;
	error: string | null;
}

const NPM_TTL_MS = 120_000;
const GIT_TTL_MS = 60_000;

export interface RegistryOptions {
	/** Injectable for tests; defaults to the node runtime's global fetch. */
	fetchFn?: typeof fetch;
	/** npm registry base; defaults to npm_config_registry or the public registry. */
	registryUrl?: string;
	/** Optional GitHub token (Authorization header) for higher rate limits. */
	githubToken?: string;
}

interface CacheEntry<T> {
	at: number;
	value: T;
}

export class Registry {
	private npmCache = new Map<string, CacheEntry<NpmLatest>>();
	private gitCache = new Map<string, CacheEntry<GitLatest>>();
	private readonly fetchFn: typeof fetch;
	private readonly registryUrl: string;
	private githubToken: string | undefined;

	constructor(options: RegistryOptions = {}) {
		this.fetchFn = options.fetchFn ?? globalThis.fetch;
		this.registryUrl = (options.registryUrl ?? process.env.npm_config_registry ?? "https://registry.npmjs.org").replace(/\/$/, "");
		this.githubToken = options.githubToken ?? process.env.GITHUB_TOKEN;
	}

	/** Set the GitHub token after construction (e.g. fetched from `gh auth token` at boot). */
	setGithubToken(token: string | undefined): void {
		this.githubToken = token ?? this.githubToken;
	}

	/** Drop all cached lookups (UI refresh / force). */
	clearCache(): void {
		this.npmCache.clear();
		this.gitCache.clear();
	}

	async latestNpm(name: string): Promise<NpmLatest> {
		const cached = this.npmCache.get(name);
		if (cached && Date.now() - cached.at < NPM_TTL_MS) return cached.value;

		let value: NpmLatest;
		try {
			// /<pkg>/latest resolves dist-tags.latest; scoped names need the slash encoded
			const url = `${this.registryUrl}/${name.replace("/", "%2F")}/latest`; // keep @, encode only the scope slash
			const res = await this.fetchFn(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
			if (!res.ok) {
				value = { kind: "npm", latest: null, error: `${name}: registry ${res.status} ${res.statusText}` };
			} else {
				const data = (await res.json()) as { version?: unknown };
				value = typeof data.version === "string" && /^\d+\.\d+\.\d+/.test(data.version)
					? { kind: "npm", latest: data.version, error: null }
					: { kind: "npm", latest: null, error: `${name}: no version on the registry` };
			}
		} catch (error) {
			value = { kind: "npm", latest: null, error: error instanceof Error ? error.message : String(error) };
		}
		this.npmCache.set(name, { at: Date.now(), value });
		return value;
	}

	async latestGit(user: string, repo: string): Promise<GitLatest> {
		const key = `${user}/${repo}`;
		const cached = this.gitCache.get(key);
		if (cached && Date.now() - cached.at < GIT_TTL_MS) return cached.value;

		const value = await this.fetchGit(user, repo);
		this.gitCache.set(key, { at: Date.now(), value });
		return value;
	}

	private async fetchGit(user: string, repo: string): Promise<GitLatest> {
		const headers: Record<string, string> = {
			accept: "application/vnd.github+json",
			"user-agent": "dsh-plugin-dashboard",
		};
		if (this.githubToken) headers.authorization = `Bearer ${this.githubToken}`;

		try {
			const [tagsRes, headRes] = await Promise.all([
				this.fetchFn(`https://api.github.com/repos/${user}/${repo}/tags`, { headers, signal: AbortSignal.timeout(20_000) }),
				this.fetchFn(`https://api.github.com/repos/${user}/${repo}/commits/HEAD`, { headers, signal: AbortSignal.timeout(20_000) }),
			]);
			const error = !tagsRes.ok ? `github ${tagsRes.status} ${tagsRes.statusText}${tagsRes.status === 404 ? " (private repo? set GITHUB_TOKEN or gh auth)" : " (rate limit?)"}` : null;
			const headSha = headRes.ok ? (((await headRes.json()) as { sha?: unknown }).sha as string | null | undefined) ?? null : null;

			let latestTag: string | null = null;
			let latestTagCommit: string | null = null;
			let best: { major: number; minor: number; patch: number; prerelease: string | null } | null = null;
			if (tagsRes.ok) {
				const rows = (await tagsRes.json()) as Array<{ name?: unknown; commit?: { sha?: unknown } }>;
				for (const row of rows) {
					if (typeof row.name !== "string") continue;
					const version = extractTagVersion(row.name);
					if (!version) continue;
					if (!best || compareSemver(version, best) > 0) {
						best = version;
						latestTag = row.name;
						latestTagCommit = typeof row.commit?.sha === "string" ? row.commit.sha : null;
					}
				}
			}

			return { kind: "git", latestTag, latestTagCommit, headSha, error };
		} catch (error) {
			return { kind: "git", latestTag: null, latestTagCommit: null, headSha: null, error: error instanceof Error ? error.message : String(error) };
		}
	}
}

/** Human label for the best available git target. */
export function describeGitTarget(info: GitLatest): string {
	if (info.error) return "unreachable";
	if (info.latestTag) return info.latestTag;
	if (info.headSha) return `HEAD ${info.headSha.slice(0, 7)}`;
	return "no refs";
}

export { formatSemver };