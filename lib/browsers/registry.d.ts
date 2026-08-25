import type { Browser, CDPSession } from "puppeteer-core";
import type { UserAgentOverride } from "./launch.js";
import { resolveRelayKind, type RelayKind } from "./../relay/kind.js";
export type BrowserKind = HeadlessKind | SpawnedKind | ConnectedKind | RelayKind;
export interface HeadlessKind {
    kind: "headless";
    headless: boolean;
}
export interface SpawnedKind {
    kind: "spawned";
    path: string;
}
export interface ConnectedKind {
    kind: "connected";
    cdpUrl: string;
}
export type BrowserKindTag = BrowserKind["kind"];
interface BrowserHandleCommon {
    key: string;
    kind: BrowserKind;
    refCount: number;
}
export interface PuppeteerBrowserHandle extends BrowserHandleCommon {
    kind: Exclude<BrowserKind, RelayKind> | RelayKind;
    browser: Browser;
    cdpUrl?: string;
    pid?: number;
    /** Owned temporary Chromium profile dir removed on dispose (process-local headless launches). */
    userDataDir?: string;
    spawner?: {
        pid: number;
    };
    stealth: {
        browserSession: CDPSession | null;
        override: UserAgentOverride | null;
    };
}
export type BrowserHandle = PuppeteerBrowserHandle;
export interface ReleaseBrowserOptions {
    kill: boolean;
    timeoutMs?: number;
    resource?: string;
}
export interface AcquireBrowserOptions {
    cwd: string;
    viewport?: {
        width: number;
        height: number;
        deviceScaleFactor?: number;
    };
    appArgs?: string[];
    signal?: AbortSignal;
    /** Browser tool config surface resolved by the caller. */
    config: ResolvedBrowserConfig;
}
/** The browser-relevant configuration our tool owns (see config.ts). */
export interface ResolvedBrowserConfig {
    headless: boolean;
    relayEnabled: boolean;
    relayUrl: string;
    cdpUrl?: string;
    screenshotDir?: string;
    excludeWebP?: boolean;
    installChrome?: boolean;
}
export declare function acquireBrowser(kind: BrowserKind, opts: AcquireBrowserOptions): Promise<BrowserHandle>;
/** Increment the reference count when a consumer starts using the handle. */
export declare function holdBrowser(handle: BrowserHandle): void;
/** Decrement; at zero, teardown the underlying browser (close or kill). */
export declare function releaseBrowser(handle: BrowserHandle, opts: ReleaseBrowserOptions): Promise<void>;
/** Test-only accessor for the module-global browsers map. */
export declare function getBrowsersMapForTest(): ReadonlyMap<string, BrowserHandle>;
export { resolveRelayKind as resolveRelayKindForTest };
