import type { Browser, CDPSession, Page, default as Puppeteer } from "puppeteer-core";
export declare const DEFAULT_VIEWPORT: {
    width: number;
    height: number;
    deviceScaleFactor: number;
};
/** Per-CDP-message timeout applied to every puppeteer launch/connect (catches genuinely stuck CDP sockets). */
export declare const BROWSER_PROTOCOL_TIMEOUT_MS = 60000;
export declare function loadPuppeteer(): Promise<typeof Puppeteer>;
export declare function loadPuppeteerInWorker(): Promise<typeof Puppeteer>;
declare function isChromiumExecutable(p: string): Promise<boolean>;
declare function systemChromiumCandidates(platform?: NodeJS.Platform, home?: string): string[];
/** Chrome for Testing cache directory under the package cache dir. */
export declare function getPuppeteerDir(): string;
/**
 * Resolve the Chromium executable puppeteer will launch: env override first,
 * then a detected system Chromium (non-macOS), then a Chrome for Testing
 * install under the package cache dir (downloaded on first use).
 */
export declare function ensureChromiumExecutable(): Promise<string | undefined>;
/** Options shared by headless Chromium consumers. */
export interface LaunchHeadlessOptions {
    headless: boolean;
    viewport?: {
        width: number;
        height: number;
        deviceScaleFactor?: number;
    };
    args?: readonly string[];
    ignoreDefaultArgs?: readonly string[];
}
export interface LaunchHeadlessResult {
    browser: Browser;
    /** Package-owned temporary Chromium profile dir to remove after the tree exits. */
    userDataDir?: string;
}
/** Base Chromium argv shared by launches: sandbox/stealth flags, window size, proxy env. */
export declare function buildHeadlessLaunchArgs(viewport: {
    width: number;
    height: number;
}): string[];
export declare function launchHeadlessBrowser(opts: LaunchHeadlessOptions): Promise<LaunchHeadlessResult>;
/** Remove an owned Chromium profile dir, tolerating transient EBUSY/EPERM locks. */
export declare function removeUserDataDir(dir: string): Promise<void>;
export declare function applyViewport(page: Page, viewport?: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
}): Promise<void>;
export interface UserAgentOverride {
    userAgent: string;
    platform: string;
    acceptLanguage: string;
    userAgentMetadata: {
        brands: Array<{
            brand: string;
            version: string;
        }>;
        fullVersion: string;
        fullVersionList: Array<{
            brand: string;
            version: string;
        }>;
        platform: string;
        platformVersion: string;
        architecture: string;
        bitness: string;
        model: string;
        mobile: boolean;
    };
}
/** Build the browser-page stealth bootstrap source (ported verbatim from oh-my-pi). */
export declare function buildStealthInjectionScript(): string;
/** Apply stealth patches + UA override to a headless page. Idempotent within a tab. */
export declare function applyStealthPatches(browser: Browser, page: Page, state: {
    browserSession: CDPSession | null;
    override: UserAgentOverride | null;
}): Promise<void>;
export { systemChromiumCandidates, isChromiumExecutable };
