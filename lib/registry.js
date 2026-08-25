/**
 * Version discovery via HTTP APIs, executed in the dsh node runtime (global
 * fetch — no subprocesses): npm registry dist-tags for registry packages,
 * GitHub REST API for git-installed ones. Results cached in memory with TTL.
 */
import { compareSemver, extractTagVersion, formatSemver } from "./semver.js";
const NPM_TTL_MS = 120_000;
const GIT_TTL_MS = 60_000;
export class Registry {
    npmCache = new Map();
    gitCache = new Map();
    fetchFn;
    registryUrl;
    githubToken;
    constructor(options = {}) {
        this.fetchFn = options.fetchFn ?? globalThis.fetch;
        this.registryUrl = (options.registryUrl ?? process.env.npm_config_registry ?? "https://registry.npmjs.org").replace(/\/$/, "");
        this.githubToken = options.githubToken ?? process.env.GITHUB_TOKEN;
    }
    /** Drop all cached lookups (UI refresh / force). */
    clearCache() {
        this.npmCache.clear();
        this.gitCache.clear();
    }
    async latestNpm(name) {
        const cached = this.npmCache.get(name);
        if (cached && Date.now() - cached.at < NPM_TTL_MS)
            return cached.value;
        let value;
        try {
            // /<pkg>/latest resolves dist-tags.latest; scoped names need the slash encoded
            const url = `${this.registryUrl}/${name.replace("/", "%2F")}/latest`; // keep @, encode only the scope slash
            const res = await this.fetchFn(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
            if (!res.ok) {
                value = { kind: "npm", latest: null, error: `${name}: registry ${res.status} ${res.statusText}` };
            }
            else {
                const data = (await res.json());
                value = typeof data.version === "string" && /^\d+\.\d+\.\d+/.test(data.version)
                    ? { kind: "npm", latest: data.version, error: null }
                    : { kind: "npm", latest: null, error: `${name}: no version on the registry` };
            }
        }
        catch (error) {
            value = { kind: "npm", latest: null, error: error instanceof Error ? error.message : String(error) };
        }
        this.npmCache.set(name, { at: Date.now(), value });
        return value;
    }
    async latestGit(user, repo) {
        const key = `${user}/${repo}`;
        const cached = this.gitCache.get(key);
        if (cached && Date.now() - cached.at < GIT_TTL_MS)
            return cached.value;
        const value = await this.fetchGit(user, repo);
        this.gitCache.set(key, { at: Date.now(), value });
        return value;
    }
    async fetchGit(user, repo) {
        const headers = {
            accept: "application/vnd.github+json",
            "user-agent": "dsh-plugin-dashboard",
        };
        if (this.githubToken)
            headers.authorization = `Bearer ${this.githubToken}`;
        try {
            const [tagsRes, headRes] = await Promise.all([
                this.fetchFn(`https://api.github.com/repos/${user}/${repo}/tags`, { headers, signal: AbortSignal.timeout(20_000) }),
                this.fetchFn(`https://api.github.com/repos/${user}/${repo}/commits/HEAD`, { headers, signal: AbortSignal.timeout(20_000) }),
            ]);
            const error = !tagsRes.ok ? `github ${tagsRes.status} ${tagsRes.statusText} (rate limit?)` : null;
            const headSha = headRes.ok ? (await headRes.json()).sha ?? null : null;
            let latestTag = null;
            let latestTagCommit = null;
            let best = null;
            if (tagsRes.ok) {
                const rows = (await tagsRes.json());
                for (const row of rows) {
                    if (typeof row.name !== "string")
                        continue;
                    const version = extractTagVersion(row.name);
                    if (!version)
                        continue;
                    if (!best || compareSemver(version, best) > 0) {
                        best = version;
                        latestTag = row.name;
                        latestTagCommit = typeof row.commit?.sha === "string" ? row.commit.sha : null;
                    }
                }
            }
            return { kind: "git", latestTag, latestTagCommit, headSha, error };
        }
        catch (error) {
            return { kind: "git", latestTag: null, latestTagCommit: null, headSha: null, error: error instanceof Error ? error.message : String(error) };
        }
    }
}
/** Human label for the best available git target. */
export function describeGitTarget(info) {
    if (info.error)
        return "unreachable";
    if (info.latestTag)
        return info.latestTag;
    if (info.headSha)
        return `HEAD ${info.headSha.slice(0, 7)}`;
    return "no refs";
}
export { formatSemver };
