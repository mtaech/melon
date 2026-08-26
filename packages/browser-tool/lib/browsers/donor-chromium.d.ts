/** A Chromium found in someone else's `@puppeteer/browsers` cache. */
export interface DonorChromium {
    /** Absolute path of the donor binary. */
    executablePath: string;
    /** `<platform>-<buildId>` directory name the donor filed it under. */
    dirName: string;
    /** Build id parsed out of {@link dirName}. */
    buildId: string;
    /** Absolute path of the `<platform>-<buildId>` directory to copy. */
    sourceDir: string;
    /** Cache root the donor belongs to, for logging. */
    cacheRoot: string;
}
/**
 * Candidate donor cache roots, highest priority first.
 *
 * `DSH_BROWSER_DONOR_CACHE` lets a caller point at an arbitrary cache (also the
 * seam the tests use); the rest are the caches we know ship this layout.
 */
export declare function donorCacheRoots(env?: NodeJS.ProcessEnv): string[];
/**
 * Find a reusable Chromium in another tool's cache.
 * @param platform - `@puppeteer/browsers` platform tag (e.g. `linux64`).
 * @param wantedBuildId - preferred build; an exact match wins, otherwise the
 * newest available build is returned so we still avoid a download.
 * @param roots - donor cache roots to search, highest priority first.
 */
export declare function findDonorChromium(platform: string, wantedBuildId: string | undefined, roots?: string[]): DonorChromium | undefined;
/**
 * Copy a donor build into our own cache so later runs resolve it locally and
 * stay independent of the donor (oh-my-pi may prune its cache at any time).
 *
 * The copy is filed under the donor's real build id rather than the build we
 * were about to download, keeping the cache honest about what is inside it.
 * A partially written copy is removed so the next call retries cleanly.
 *
 * @returns the copied binary's path, or the donor's own path when the copy fails.
 */
export declare function adoptDonorChromium(donor: DonorChromium, ourCacheRoot: string): string;
