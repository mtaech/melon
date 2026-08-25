import type { Browser, Page } from "puppeteer-core";
/** Allocate an unused TCP port on 127.0.0.1 by binding to port 0 and reading back the kernel-assigned port. */
export declare function findFreeCdpPort(): Promise<number>;
/**
 * Loopback HTTP/1.1 GET that never routes through a proxy, resolving to the
 * response status code (or null when the endpoint is unreachable, aborted,
 * malformed, or slow past `timeoutMs`). Raw TCP sidesteps HTTP(S)_PROXY.
 */
export declare function probeCdpStatus(url: string, opts: {
    timeoutMs: number;
    signal?: AbortSignal;
}): Promise<number | null>;
/** Poll `${cdpUrl}/json/version` until it responds with 200, with abort + timeout support. */
export declare function waitForCdp(cdpUrl: string, timeoutMs: number, signal?: AbortSignal): Promise<void>;
/** Find a running browser launched by us (or `kill: true` candidates) whose process carries `--remote-debugging-port=` or `--remote-debugging-pipe` args. */
export interface ReusableCdp {
    pid: number;
    cdpUrl?: string;
    args: string[];
}
export declare function findReusableCdp(executablePath: string, selfPid?: number): ReusableCdp | null;
/**
 * Pick the CDP page target to attach: skip service-workers / DevTools /
 * extension pages, then prefer the visible (active) page, else the first
 * ordinary page.
 */
export declare function pickElectronTarget(browser: Browser, opts: {
    target?: string;
    signal?: AbortSignal;
}): Promise<Page>;
/** Whether a CDP-connected (non-owned) browser should be left at rest between runs. */
export declare function shouldPreserveConnectedBrowserFocus(_browser: Browser): boolean;
/**
 * Tear down every running process matching `executablePath` (single-instance
 * apps may keep an orphan around). Returns the number of processes killed.
 */
export declare function killExistingByPath(executablePath: string, signal?: AbortSignal): Promise<number>;
/** Best-effort extraction of a target's CDP target id (puppeteer internal field). */
export declare function targetIdForPage(page: Page): Promise<string>;
