import type { ProfileSummary, PluginSource } from "./profile.js";
import type { GitLatest, NpmLatest } from "./registry.js";
export interface UpgradePlan {
    name: string;
    source: PluginSource;
    installedVersion: string | null;
    installedCommit: string | null;
    currentSpecifier: string;
    targetLabel: string;
    targetCommit: string | null;
    newSpecifier: string;
    command: string;
    wouldChange: boolean;
    /** Published-at (npm) / committer date (git) of the installed version; null when unknowable. */
    currentVersionDate: string | null;
    /** Published-at (npm) / committer date (git) of the latest version; null when unknowable. */
    latestVersionDate: string | null;
    error?: string;
}
export declare function shellQuote(s: string): string;
export interface RegistryLike {
    latestNpm(name: string): Promise<NpmLatest>;
    latestGit(user: string, repo: string): Promise<GitLatest>;
    /** version → published-at map from the npm manifest `time` object. */
    npmVersionDates(name: string): Promise<Record<string, string> | null>;
    /** committer date of one commit. */
    commitDate(user: string, repo: string, sha: string): Promise<string | null>;
}
/** One command invocation; `code !== 0` signals failure (empty output allowed). */
export interface CommandRunner {
    (argv: readonly string[], opts: {
        cwd: string;
        timeoutMs: number;
    }): Promise<{
        code: number;
        output: string;
    }>;
}
export declare function planUpgrade(profile: ProfileSummary, name: string, registry: RegistryLike, installed: {
    version: string | null;
} | null, installedCommit: string | null): Promise<UpgradePlan>;
/** Apply the upgrade: backup → patch package.json → run pnpm install (restore on failure). */
export declare function applyUpgrade(profileDir: string, plan: UpgradePlan, runner: CommandRunner): Promise<{
    backupPath: string;
    output: string;
}>;
export interface UninstallPlan {
    name: string;
    isCore: boolean;
    inDependencies: boolean;
    inBundles: boolean;
    /** True when the package can actually be removed. */
    wouldRemove: boolean;
    error?: string;
}
/** Plan the removal of a package from the profile (deps and/or bundles). */
export declare function planUninstall(profile: ProfileSummary, name: string): UninstallPlan;
/**
 * Apply the uninstall: pnpm remove for a dependency, then drop the entry from
 * `dsh.profile.bundles`. Backs up package.json first and restores it on
 * failure. The pnpm step rewrites package.json itself, so the bundles edit
 * happens afterwards to avoid being clobbered.
 */
export declare function applyUninstall(profileDir: string, plan: UninstallPlan, runner: CommandRunner): Promise<{
    backupPath: string;
    output: string;
}>;
