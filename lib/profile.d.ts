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
export declare function profilesRoot(): string;
/** Directories under the profiles root that contain a package.json. */
export declare function listProfiles(): Promise<string[]>;
/** Load one profile's package.json. `name` is a single path segment only. */
export declare function loadProfile(name: string): Promise<ProfileSummary>;
/** Read a profile directly from its directory (the dsh process cwd case). */
export declare function readProfileDir(dir: string, name?: string): Promise<ProfileSummary>;
/** Host/core packages (bundled with dsh itself). */
export declare function isCorePackage(name: string): boolean;
/** Parse `github:user/repo` (with optional `#ref`) or a `git+https://github.com/user/repo[.git]` URL. */
export declare function parseGithubSpec(spec: string): GithubSpec | null;
export declare function sourceOf(specifier: string): PluginSource;
/** Installed package.json metadata from the profile's node_modules. */
export declare function readInstalled(profileDir: string, name: string): Promise<InstalledInfo | null>;
/** Extract the resolved commit of a github-installed package from pnpm-lock.yaml.
 *
 * The importer section lists each direct dependency with its resolved `version`
 * — for git-hosted packages that is a codeload tarball URL carrying the 40-hex
 * commit. Parsed with a small indentation state machine (no YAML dependency).
 */
export declare function readLockCommit(lockText: string, name: string): string | null;
