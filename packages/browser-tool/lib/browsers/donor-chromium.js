/**
 * Reuse a Chromium already downloaded by another `@puppeteer/browsers` consumer
 * (oh-my-pi's cache, puppeteer's own default cache, or a caller-supplied dir)
 * instead of downloading our own copy.
 *
 * Every donor considered here uses the layout `@puppeteer/browsers` creates —
 * `<cache>/chrome/<platform>-<buildId>/<chrome-dir>/<binary>` — so a matching
 * build can be copied across verbatim. Caches with a different shape (for
 * example Playwright's `chromium-<revision>`) are deliberately out of scope:
 * their revisions do not map onto Chrome for Testing build ids.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "./../util.js";
/**
 * Candidate donor cache roots, highest priority first.
 *
 * `DSH_BROWSER_DONOR_CACHE` lets a caller point at an arbitrary cache (also the
 * seam the tests use); the rest are the caches we know ship this layout.
 */
export function donorCacheRoots(env = process.env) {
    const home = os.homedir();
    const roots = [
        env.DSH_BROWSER_DONOR_CACHE,
        // oh-my-pi keeps its Chrome for Testing installs here.
        path.join(home, ".omp", "puppeteer"),
        // puppeteer's own default cache (`~/.cache/puppeteer`), plus its env override.
        env.PUPPETEER_CACHE_DIR,
        path.join(home, ".cache", "puppeteer"),
    ];
    const seen = new Set();
    const out = [];
    for (const root of roots) {
        if (!root || root.length === 0 || seen.has(root))
            continue;
        seen.add(root);
        out.push(root);
    }
    return out;
}
/** Parse `<platform>-<buildId>`; the build id is everything after the first `-`. */
function parseBuildDir(dirName, platform) {
    const prefix = `${platform}-`;
    if (!dirName.startsWith(prefix))
        return undefined;
    const buildId = dirName.slice(prefix.length);
    return buildId.length > 0 ? buildId : undefined;
}
/** Compare two Chrome build ids (`150.0.7871.24`) numerically, segment by segment. */
function compareBuildIds(a, b) {
    const pa = a.split(".").map(n => Number.parseInt(n, 10) || 0);
    const pb = b.split(".").map(n => Number.parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d !== 0)
            return d;
    }
    return 0;
}
/** Locate the launchable binary inside a `<platform>-<buildId>` directory. */
function findBinary(buildDir) {
    // `chrome-linux64/chrome`, `chrome-win64/chrome.exe`,
    // `chrome-mac-x64/Google Chrome for Testing.app/...` — enumerate rather than
    // hardcode, so a platform we did not anticipate still resolves.
    const names = process.platform === "win32"
        ? ["chrome.exe"]
        : process.platform === "darwin"
            ? [path.join("Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing")]
            : ["chrome"];
    let entries;
    try {
        entries = fs.readdirSync(buildDir, { withFileTypes: true });
    }
    catch {
        return undefined;
    }
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        for (const name of names) {
            const candidate = path.join(buildDir, entry.name, name);
            try {
                if (fs.statSync(candidate).isFile())
                    return candidate;
            }
            catch {
                // keep looking
            }
        }
    }
    return undefined;
}
/**
 * Find a reusable Chromium in another tool's cache.
 * @param platform - `@puppeteer/browsers` platform tag (e.g. `linux64`).
 * @param wantedBuildId - preferred build; an exact match wins, otherwise the
 * newest available build is returned so we still avoid a download.
 * @param roots - donor cache roots to search, highest priority first.
 */
export function findDonorChromium(platform, wantedBuildId, roots = donorCacheRoots()) {
    let newest;
    for (const cacheRoot of roots) {
        const chromeRoot = path.join(cacheRoot, "chrome");
        let dirs;
        try {
            dirs = fs.readdirSync(chromeRoot);
        }
        catch {
            continue;
        }
        for (const dirName of dirs) {
            const buildId = parseBuildDir(dirName, platform);
            if (buildId === undefined)
                continue;
            const sourceDir = path.join(chromeRoot, dirName);
            const executablePath = findBinary(sourceDir);
            if (executablePath === undefined)
                continue;
            const found = { executablePath, dirName, buildId, sourceDir, cacheRoot };
            // An exact build match is as good as downloading; take it immediately.
            if (wantedBuildId !== undefined && buildId === wantedBuildId)
                return found;
            if (newest === undefined || compareBuildIds(buildId, newest.buildId) > 0)
                newest = found;
        }
    }
    return newest;
}
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
export function adoptDonorChromium(donor, ourCacheRoot) {
    const destDir = path.join(ourCacheRoot, "chrome", donor.dirName);
    const relative = path.relative(donor.sourceDir, donor.executablePath);
    const destExecutable = path.join(destDir, relative);
    if (fs.existsSync(destExecutable))
        return destExecutable;
    const tempDir = `${destDir}.partial-${process.pid}`;
    // Cleanup must never throw: it runs on the failure path, where throwing
    // would replace the real error with an unrelated one (e.g. ENOTDIR when the
    // cache root is not a directory at all).
    const discardTemp = () => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        catch {
            // nothing further to do
        }
    };
    try {
        discardTemp();
        fs.mkdirSync(path.dirname(destDir), { recursive: true });
        // `cpSync` preserves the executable bit, which the binary needs to launch.
        fs.cpSync(donor.sourceDir, tempDir, { recursive: true, preserveTimestamps: true });
        fs.renameSync(tempDir, destDir);
        logger.warn("Reused an existing Chromium instead of downloading", {
            buildId: donor.buildId,
            from: donor.cacheRoot,
            to: destDir,
        });
        return destExecutable;
    }
    catch (error) {
        discardTemp();
        logger.debug("Could not copy the donor Chromium; launching it in place", {
            from: donor.executablePath,
            error: error.message,
        });
        // Launching the donor directly still avoids the download.
        return donor.executablePath;
    }
}
