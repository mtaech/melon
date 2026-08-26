/** Minimal semver parsing/comparison and git-tag version extraction. */
export interface SemVer {
    major: number;
    minor: number;
    patch: number;
    /** Prerelease identifiers as written per semver spec 2.0.0; null = release version. */
    prerelease: string | null;
}
export declare function parseSemver(input: string): SemVer | null;
/** Numeric comparison with prerelease precedence: release > any prerelease. */
export declare function compareSemver(a: SemVer, b: SemVer): -1 | 0 | 1;
export declare function formatSemver(v: SemVer): string;
/** Parse a git tag like `v1.2.3` / `1.2.3-rc.1`; non-semver tags return null. */
export declare function extractTagVersion(tag: string): SemVer | null;
