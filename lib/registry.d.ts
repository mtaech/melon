/**
 * Version discovery via HTTP APIs, executed in the dsh node runtime (global
 * fetch — no subprocesses): npm registry dist-tags for registry packages,
 * GitHub REST API for git-installed ones. Results cached in memory with TTL.
 */
import { formatSemver } from "./semver.js";
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
export interface RegistryOptions {
    /** Injectable for tests; defaults to the node runtime's global fetch. */
    fetchFn?: typeof fetch;
    /** npm registry base; defaults to npm_config_registry or the public registry. */
    registryUrl?: string;
    /** Optional GitHub token (Authorization header) for higher rate limits. */
    githubToken?: string;
}
export declare class Registry {
    private npmCache;
    private gitCache;
    private readonly fetchFn;
    private readonly registryUrl;
    private githubToken;
    constructor(options?: RegistryOptions);
    /** Set the GitHub token after construction (e.g. fetched from `gh auth token` at boot). */
    setGithubToken(token: string | undefined): void;
    /** Drop all cached lookups (UI refresh / force). */
    clearCache(): void;
    latestNpm(name: string): Promise<NpmLatest>;
    latestGit(user: string, repo: string): Promise<GitLatest>;
    private fetchGit;
}
/** Human label for the best available git target. */
export declare function describeGitTarget(info: GitLatest): string;
export { formatSemver };
