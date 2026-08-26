import { BROWSER_PROTOCOL_TIMEOUT_MS, DEFAULT_VIEWPORT, launchHeadlessBrowser, loadPuppeteer, removeUserDataDir } from "./launch.js";
import { ToolError, throwIfAborted } from "./../errors.js";
import { logger } from "./../util.js";
import { findFreeCdpPort, waitForCdp } from "./attach.js";
import { resolveRelayKind } from "./../relay/kind.js";
/** Upper bound on `browser.close()` for headless Chromium (force-kill past it). */
const HEADLESS_CLOSE_TIMEOUT_MS = 5_000;
/** How long a relay open waits for the extension handshake (503 → 200). */
const RELAY_EXTENSION_WAIT_MS = 35_000;
const browsers = new Map();
/** In-flight opens by browser key, so concurrent acquisitions share one launch. */
const pendingOpens = new Map();
function browserKey(kind) {
    switch (kind.kind) {
        case "headless":
            return `headless:${kind.headless ? "1" : "0"}`;
        case "spawned":
            return `spawned:${kind.path}`;
        case "connected":
            return `connected:${kind.cdpUrl}`;
        case "relay":
            return `relay:${kind.cdpUrl}`;
    }
}
export async function acquireBrowser(kind, opts) {
    const key = browserKey(kind);
    const existing = browsers.get(key);
    if (existing && existing.refCount === 0 && pendingOpens.has(key)) {
        // An open is in flight for an idle instance — wait for it (handled below).
    }
    if (existing) {
        existing.refCount++;
        return existing;
    }
    if (pendingOpens.has(key)) {
        const handle = await pendingOpens.get(key);
        // Registration happens on first creation; reuse still bumps the count.
        handle.refCount++;
        return handle;
    }
    const promise = openBrowser(kind, opts);
    pendingOpens.set(key, promise);
    try {
        const handle = await promise;
        handle.refCount++;
        return handle;
    }
    finally {
        pendingOpens.delete(key);
    }
}
async function openBrowser(kind, opts) {
    switch (kind.kind) {
        case "headless":
            return openHeadless(kind, opts);
        case "spawned":
            return openSpawned(kind, opts);
        case "connected":
            return openConnected(kind, opts);
        case "relay":
            return openRelay(kind, opts);
    }
}
async function openHeadless(kind, opts) {
    throwIfAborted(opts.signal);
    const { browser, userDataDir } = await launchHeadlessBrowser({
        headless: kind.headless,
        viewport: opts.viewport,
        args: kind.headless ? ["--disable-gpu"] : undefined,
    });
    return {
        key: browserKey(kind),
        kind,
        browser,
        userDataDir,
        refCount: 0,
        stealth: { browserSession: null, override: null },
    };
}
async function openSpawned(kind, opts) {
    throwIfAborted(opts.signal);
    // Spawn the app detached with a fresh CDP port, then wait for the endpoint.
    const port = await findFreeCdpPort();
    const cdpUrl = `http://127.0.0.1:${port}`;
    const { spawn } = await import("node:child_process");
    const spawner = spawn(kind.path, [`--remote-debugging-port=${port}`, ...(opts.appArgs ?? [])], {
        detached: process.platform !== "win32",
        stdio: "ignore",
        cwd: opts.cwd,
    });
    spawner.unref();
    await waitForCdp(cdpUrl, 15_000, opts.signal);
    const puppeteer = await loadPuppeteer();
    const browser = await puppeteer.connect({
        browserURL: cdpUrl,
        defaultViewport: opts.viewport
            ? { width: opts.viewport.width, height: opts.viewport.height, deviceScaleFactor: opts.viewport.deviceScaleFactor ?? DEFAULT_VIEWPORT.deviceScaleFactor }
            : null,
        protocolTimeout: BROWSER_PROTOCOL_TIMEOUT_MS,
    });
    return {
        key: browserKey(kind),
        kind,
        browser,
        cdpUrl,
        pid: spawner.pid,
        refCount: 0,
        stealth: { browserSession: null, override: null },
    };
}
async function openConnected(kind, opts) {
    throwIfAborted(opts.signal);
    const puppeteer = await loadPuppeteer();
    const browser = await puppeteer.connect({
        browserURL: kind.cdpUrl,
        defaultViewport: null,
        protocolTimeout: BROWSER_PROTOCOL_TIMEOUT_MS,
    });
    return {
        key: browserKey(kind),
        kind,
        browser,
        cdpUrl: kind.cdpUrl,
        refCount: 0,
        stealth: { browserSession: null, override: null },
    };
}
async function openRelay(kind, opts) {
    throwIfAborted(opts.signal);
    const { ensureRelayDaemon, isLoopbackRelayUrl } = await import("./../relay/daemon.js");
    if (isLoopbackRelayUrl(kind.cdpUrl)) {
        const ok = await ensureRelayDaemon({ cdpUrl: kind.cdpUrl, signal: opts.signal });
        if (!ok)
            throw new ToolError("Browser relay could not be started (is the omp-style browser relay installed?)");
    }
    // Wait for the extension handshake (503 → 200) — a reaped extension
    // service worker is revived by its keepalive alarm.
    await waitForRelayReady(kind.cdpUrl, RELAY_EXTENSION_WAIT_MS, opts.signal);
    const puppeteer = await loadPuppeteer();
    const browser = await puppeteer.connect({
        browserURL: kind.cdpUrl,
        defaultViewport: null,
        protocolTimeout: BROWSER_PROTOCOL_TIMEOUT_MS,
    });
    return {
        key: browserKey(kind),
        kind,
        browser,
        cdpUrl: kind.cdpUrl,
        refCount: 0,
        stealth: { browserSession: null, override: null },
    };
}
async function waitForRelayReady(cdpUrl, timeoutMs, signal) {
    const { probeCdpStatus } = await import("./attach.js");
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        throwIfAborted(signal);
        const status = await probeCdpStatus(`${cdpUrl}/json/version`, { timeoutMs: 1_500, signal });
        if (status !== null && status >= 200 && status < 300)
            return;
        if (Date.now() >= deadline) {
            throw new ToolError("Browser relay extension did not connect within 35s. Install the OMP Browser Relay extension and check the relay is running.");
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
}
/** Increment the reference count when a consumer starts using the handle. */
export function holdBrowser(handle) {
    handle.refCount++;
}
/** Decrement; at zero, teardown the underlying browser (close or kill). */
export async function releaseBrowser(handle, opts) {
    if (--handle.refCount > 0)
        return;
    await disposeBrowser(handle, opts);
}
async function disposeBrowser(handle, opts) {
    const resource = opts.resource ?? "browser";
    try {
        if (opts.kill && handle.kind.kind === "spawned" && handle.pid) {
            const { terminateProcessTree } = await import("./process.js");
            await terminateProcessTree(handle.pid, 2000);
            if (handle.userDataDir)
                await removeUserDataDir(handle.userDataDir);
            return;
        }
        if (handle.kind.kind === "spawned" || handle.kind.kind === "headless") {
            // Owned browsers close (with a cap for wedged Chromium).
            await Promise.race([
                handle.browser.close().catch(() => undefined),
                new Promise(resolve => setTimeout(resolve, HEADLESS_CLOSE_TIMEOUT_MS)),
            ]);
            if (handle.userDataDir)
                await removeUserDataDir(handle.userDataDir);
            return;
        }
        // Connected / relay browsers are user-driven: disconnect, never close.
        if (handle.browser.connected)
            handle.browser.disconnect();
    }
    catch (error) {
        logger.warn("Failed to dispose browser", {
            resource,
            kind: handle.kind.kind,
            error: error instanceof Error ? error.message : String(error),
        });
    }
    finally {
        browsers.delete(handle.key);
    }
}
/** Test-only accessor for the module-global browsers map. */
export function getBrowsersMapForTest() {
    return browsers;
}
export { resolveRelayKind as resolveRelayKindForTest };
