/**
 * Browser-handle registry keyed by browser kind. Ported from oh-my-pi
 * `registry.ts` with the cmux backend and the shared-daemon broker removed
 * (all headless launches are process-local here).
 */
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { BROWSER_PROTOCOL_TIMEOUT_MS, DEFAULT_VIEWPORT, launchHeadlessBrowser, loadPuppeteer, removeUserDataDir } from "./launch.js";
import { ToolAbortError, ToolError, throwIfAborted } from "./../errors.js";
import { logger } from "./../util.js";
import type { Browser, CDPSession } from "puppeteer-core";
import { findFreeCdpPort, waitForCdp, killExistingByPath } from "./attach.js";
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

/** Upper bound on `browser.close()` for headless Chromium (force-kill past it). */
const HEADLESS_CLOSE_TIMEOUT_MS = 5_000;
/** How long a relay open waits for the extension handshake (503 → 200). */
const RELAY_EXTENSION_WAIT_MS = 35_000;

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
	spawner?: { pid: number };
	stealth: { browserSession: CDPSession | null; override: UserAgentOverride | null };
}

export type BrowserHandle = PuppeteerBrowserHandle;

export interface ReleaseBrowserOptions {
	kill: boolean;
	timeoutMs?: number;
	resource?: string;
}

const browsers = new Map<string, BrowserHandle>();
/** In-flight opens by browser key, so concurrent acquisitions share one launch. */
const pendingOpens = new Map<string, Promise<BrowserHandle>>();

function browserKey(kind: BrowserKind): string {
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

export interface AcquireBrowserOptions {
	cwd: string;
	viewport?: { width: number; height: number; deviceScaleFactor?: number };
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

export async function acquireBrowser(kind: BrowserKind, opts: AcquireBrowserOptions): Promise<BrowserHandle> {
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
		const handle = await pendingOpens.get(key)!;
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
	} finally {
		pendingOpens.delete(key);
	}
}

async function openBrowser(kind: BrowserKind, opts: AcquireBrowserOptions): Promise<BrowserHandle> {
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

async function openHeadless(kind: HeadlessKind, opts: AcquireBrowserOptions): Promise<BrowserHandle> {
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

async function openSpawned(kind: SpawnedKind, opts: AcquireBrowserOptions): Promise<BrowserHandle> {
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

async function openConnected(kind: ConnectedKind, opts: AcquireBrowserOptions): Promise<BrowserHandle> {
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

async function openRelay(kind: RelayKind, opts: AcquireBrowserOptions): Promise<BrowserHandle> {
	throwIfAborted(opts.signal);
	const { ensureRelayDaemon, isLoopbackRelayUrl } = await import("./../relay/daemon.js");
	if (isLoopbackRelayUrl(kind.cdpUrl)) {
		const ok = await ensureRelayDaemon({ cdpUrl: kind.cdpUrl, signal: opts.signal });
		if (!ok) throw new ToolError("Browser relay could not be started (is the omp-style browser relay installed?)");
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

async function waitForRelayReady(cdpUrl: string, timeoutMs: number, signal?: AbortSignal): Promise<void> {
	const { probeCdpStatus } = await import("./attach.js");
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		throwIfAborted(signal);
		const status = await probeCdpStatus(`${cdpUrl}/json/version`, { timeoutMs: 1_500, signal });
		if (status !== null && status >= 200 && status < 300) return;
		if (Date.now() >= deadline) {
			throw new ToolError(
				"Browser relay extension did not connect within 35s. Install the OMP Browser Relay extension and check the relay is running.",
			);
		}
		await new Promise(resolve => setTimeout(resolve, 500));
	}
}

/** Increment the reference count when a consumer starts using the handle. */
export function holdBrowser(handle: BrowserHandle): void {
	handle.refCount++;
}

/** Decrement; at zero, teardown the underlying browser (close or kill). */
export async function releaseBrowser(handle: BrowserHandle, opts: ReleaseBrowserOptions): Promise<void> {
	if (--handle.refCount > 0) return;
	await disposeBrowser(handle, opts);
}

async function disposeBrowser(handle: BrowserHandle, opts: ReleaseBrowserOptions): Promise<void> {
	const resource = opts.resource ?? "browser";
	try {
		if (opts.kill && handle.kind.kind === "spawned" && handle.pid) {
			const { terminateProcessTree } = await import("./process.js");
			await terminateProcessTree(handle.pid, 2000);
			if (handle.userDataDir) await removeUserDataDir(handle.userDataDir);
			return;
		}
		if (handle.kind.kind === "spawned" || handle.kind.kind === "headless") {
			// Owned browsers close (with a cap for wedged Chromium).
			await Promise.race([
				handle.browser.close().catch(() => undefined),
				new Promise(resolve => setTimeout(resolve, HEADLESS_CLOSE_TIMEOUT_MS)),
			]);
			if (handle.userDataDir) await removeUserDataDir(handle.userDataDir);
			return;
		}
		// Connected / relay browsers are user-driven: disconnect, never close.
		if (handle.browser.connected) handle.browser.disconnect();
	} catch (error) {
		logger.warn("Failed to dispose browser", {
			resource,
			kind: handle.kind.kind,
			error: error instanceof Error ? error.message : String(error),
		});
	} finally {
		browsers.delete(handle.key);
	}
}

/** Test-only accessor for the module-global browsers map. */
export function getBrowsersMapForTest(): ReadonlyMap<string, BrowserHandle> {
	return browsers;
}

export { resolveRelayKind as resolveRelayKindForTest };