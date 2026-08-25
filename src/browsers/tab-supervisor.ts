/**
 * Tab supervisor: global tab registry, worker lifecycle, run/close
 * coordination. Ported from oh-my-pi `tab-supervisor.ts` with the cmux
 * backend and session-tool bridging removed; Bun workers → node:worker_threads.
 */
import { Worker } from "node:worker_threads";
import type { Page, Target } from "puppeteer-core";
import { ToolAbortError, ToolError, throwIfAborted } from "./../errors.js";
import { logger, uid, withTimeout } from "./../util.js";
import { getPuppeteerDir } from "./launch.js";
import { pickElectronTarget, shouldPreserveConnectedBrowserFocus, targetIdForPage } from "./attach.js";
import {
	type BrowserHandle,
	type BrowserKindTag,
	holdBrowser,
	type PuppeteerBrowserHandle,
	releaseBrowser,
} from "./registry.js";
import type {
	ReadyInfo,
	RunErrorPayload,
	RunResultOk,
	SessionSnapshot,
	Transport,
	WorkerInbound,
	WorkerInitPayload,
	WorkerOutbound,
} from "./types.js";
import { expandPath } from "./../path.js";

export type DialogPolicy = "accept" | "dismiss";

export interface PendingRun {
	resolve(result: RunResultOk): void;
	reject(error: unknown): void;
	signal?: AbortSignal;
	toolCalls: Map<string, AbortController>;
	/** Fires when `releaseTab` closes the tab out from under an in-flight run. */
	closeAc?: AbortController;
}

interface TabSessionBase {
	name: string;
	browser: PuppeteerBrowserHandle;
	targetId: string;
	state: "alive" | "dead";
	info: ReadyInfo;
	pending: Map<string, PendingRun>;
	dialogPolicy?: DialogPolicy;
	kindTag: BrowserKindTag;
	/** Session id of the caller that CREATED the tab (session-scoped reap). */
	ownerSessionId?: string;
}

export interface WorkerTabSession extends TabSessionBase {
	backend: "worker";
	worker: WorkerHandle;
	activateForScreenshot: boolean;
}

export type TabSession = WorkerTabSession;

export interface AcquireTabOptions {
	url?: string;
	waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2";
	viewport?: { width: number; height: number; deviceScaleFactor?: number };
	target?: string;
	signal?: AbortSignal;
	timeoutMs: number;
	/** performance.now() timestamp at which the caller's budget started. */
	deadlineStartMs?: number;
	dialogs?: DialogPolicy;
	ownerSessionId?: string;
}

export interface AcquireTabResult {
	tab: TabSession;
	created: boolean;
}

export interface RunInTabOptions {
	code: string;
	timeoutMs: number;
	signal?: AbortSignal;
	cwd: string;
	screenshotDir?: string;
	excludeWebP?: boolean;
}

export interface ReleaseTabOptions {
	kill?: boolean;
	timeoutMs?: number;
}

/** Browser-config surface consumed by the supervisor (see config.ts). */
export interface SupervisorConfig {
	screenshotDir?: string;
	excludeWebP: boolean;
}

interface WorkerHandle {
	send(msg: WorkerInbound): void;
	onMessage(handler: (msg: WorkerOutbound) => void): () => void;
	onError(handler: (error: Error) => void): () => void;
	terminate(): Promise<void>;
	readonly mode: "worker" | "inline";
}

const tabs = new Map<string, TabSession>();
/** Headless targets a worker created before dying during init. */
const workerPageTargets = new WeakMap<WorkerHandle, string>();
/** Per-name acquisition chain: serializes concurrent async acquireTab calls. */
const acquireChains = new Map<string, Promise<void>>();
const GRACE_MS = 750;
const SETUP_BUDGET_FLOOR_MS = 2_000;
const SETUP_BUDGET_CAP_MS = 10_000;
const READY_BUDGET_FLOOR_MS = 500;
const killedTabs = new Map<string, string>();
const DEFAULT_TAB_CLOSE_TIMEOUT_MS = 5_000;
class RecoverableWorkerError extends ToolError {}
const REPORTED_INIT_FAILURE = Symbol("reported-init-failure");
type ReportedInitFailure = Error & { [REPORTED_INIT_FAILURE]?: true };

function markReportedInitFailure(error: Error): Error {
	(error as ReportedInitFailure)[REPORTED_INIT_FAILURE] = true;
	return error;
}
function isReportedInitFailure(error: unknown): boolean {
	return error instanceof Error && (error as ReportedInitFailure)[REPORTED_INIT_FAILURE] === true;
}

async function waitForTabCleanup<T>(tab: TabSession, timeoutMs: number, pendingResource: string, promise: Promise<T>): Promise<T> {
	const message = `Timed out after ${timeoutMs}ms closing ${tab.kindTag} browser tab ${JSON.stringify(tab.name)}; pending resource: ${pendingResource}`;
	try {
		return await withTimeout(promise, timeoutMs, message);
	} catch (error) {
		if (error instanceof Error && error.message === message) throw new ToolError(message);
		throw error;
	}
}

export function getTab(name: string): TabSession | undefined {
	return tabs.get(name);
}

export function acquireTab(name: string, browser: BrowserHandle, opts: AcquireTabOptions): Promise<AcquireTabResult> {
	holdBrowser(browser);
	const prior = acquireChains.get(name) ?? Promise.resolve();
	const acquisition = prior.then(() => acquireTabImpl(name, browser, opts));
	const result = acquisition.then(
		async value => {
			await releaseBrowser(browser, { kill: false });
			return value;
		},
		async error => {
			await releaseBrowser(browser, { kill: false }).catch(() => undefined);
			throw error;
		},
	);
	const tail = result.then(
		() => undefined,
		() => undefined,
	);
	acquireChains.set(name, tail);
	void tail.then(() => {
		if (acquireChains.get(name) === tail) acquireChains.delete(name);
	});
	return result;
}

async function acquireTabImpl(name: string, browser: PuppeteerBrowserHandle, opts: AcquireTabOptions): Promise<AcquireTabResult> {
	const startedAt = opts.deadlineStartMs ?? performance.now();
	if (opts.signal?.aborted) throw new ToolAbortError("Browser tab open aborted");
	killedTabs.delete(name);
	let tempHold = false;
	const existing = tabs.get(name);
	if (existing) {
		if (existing.browser === browser && existing.state === "alive") {
			if (opts.dialogs !== undefined && opts.dialogs !== existing.dialogPolicy) {
				holdBrowser(browser);
				tempHold = true;
				await releaseTab(name, { kill: false });
			} else {
				const reuseSteps: string[] = [];
				if (opts.viewport) {
					const dsf = opts.viewport.deviceScaleFactor;
					reuseSteps.push(
						`await page.setViewport({ width: ${opts.viewport.width}, height: ${opts.viewport.height}, deviceScaleFactor: ${dsf === undefined ? "undefined" : String(dsf)} });`,
					);
				}
				if (opts.url) {
					reuseSteps.push(`await tab.goto(${JSON.stringify(opts.url)}, { waitUntil: ${JSON.stringify(opts.waitUntil ?? "load")} });`);
				}
				if (reuseSteps.length) {
					await runInTabWithSnapshot(name, { code: reuseSteps.join("\n"), timeoutMs: opts.timeoutMs, signal: opts.signal }, { cwd: process.cwd(), excludeWebP: false });
				}
				return { tab: tabs.get(name)!, created: false };
			}
		} else {
			if (existing.browser === browser) {
				holdBrowser(browser);
				tempHold = true;
			}
			await releaseTab(name, { kill: false });
		}
	}

	let initPayload: WorkerInitPayload;
	let worker: WorkerHandle;
	try {
		initPayload = await buildInitPayload(browser, opts);
		worker = await spawnTabWorker();
	} catch (error) {
		if (tempHold || browser.refCount === 0) await releaseBrowser(browser, { kill: false });
		throw error;
	}

	const initBudgetMs = opts.timeoutMs + GRACE_MS;
	let info: ReadyInfo;
	try {
		info = await initializeTabWorker(worker, initPayload, initBudgetMs, startedAt);
	} catch (error) {
		await worker.terminate().catch(() => undefined);
		closeAbandonedWorkerPage(browser, worker);
		if (worker.mode === "inline" || isReportedInitFailure(error)) {
			if (tempHold || browser.refCount === 0) await releaseBrowser(browser, { kill: false });
			throw error;
		}
		if (initBudgetExhausted(initBudgetMs, startedAt)) {
			if (tempHold || browser.refCount === 0) await releaseBrowser(browser, { kill: false });
			throw error;
		}
		logger.warn("Tab worker init failed; retrying with inline tab worker (no sync-loop guard)", {
			error: error instanceof Error ? error.message : String(error),
		});
		worker = await spawnInlineWorker();
		try {
			info = await initializeTabWorker(worker, initPayload, initBudgetMs, startedAt);
		} catch (inlineError) {
			await worker.terminate().catch(() => undefined);
			closeAbandonedWorkerPage(browser, worker);
			if (tempHold || browser.refCount === 0) await releaseBrowser(browser, { kill: false });
			const finalError = new ToolError(
				`Failed to start browser tab worker (inline fallback also failed): ${inlineError instanceof Error ? inlineError.message : String(inlineError)}`,
			);
			(finalError as { cause?: unknown }).cause = error;
			throw finalError;
		}
	}

	if (opts.signal?.aborted) {
		await worker.terminate().catch(() => undefined);
		closeAbandonedWorkerPage(browser, worker);
		if (tempHold || browser.refCount === 0) await releaseBrowser(browser, { kill: false }).catch(() => undefined);
		throw new ToolAbortError("Browser tab open aborted");
	}

	holdBrowser(browser);
	if (tempHold) await releaseBrowser(browser, { kill: false });
	const tab: WorkerTabSession = {
		name,
		browser,
		targetId: info.targetId,
		backend: "worker",
		worker,
		state: "alive",
		info,
		pending: new Map(),
		dialogPolicy: opts.dialogs,
		kindTag: browser.kind.kind,
		activateForScreenshot: initPayload.mode === "headless" || initPayload.activateForScreenshot !== false,
		ownerSessionId: opts.ownerSessionId,
	};
	worker.onMessage(msg => handleTabMessage(tab, msg));
	tabs.set(name, tab);
	return { tab, created: true };
}

export async function runInTab(name: string, opts: RunInTabOptions): Promise<RunResultOk> {
	return await runInTabWithSnapshot(
		name,
		{ code: opts.code, timeoutMs: opts.timeoutMs, signal: opts.signal },
		{ cwd: opts.cwd, browserScreenshotDir: opts.screenshotDir, excludeWebP: opts.excludeWebP },
	);
}

async function runInTabWithSnapshot(
	name: string,
	opts: { code: string; timeoutMs: number; signal?: AbortSignal },
	snapshot: SessionSnapshot,
): Promise<RunResultOk> {
	const tab = tabs.get(name);
	if (!tab || tab.state === "dead") {
		const killed = killedTabs.get(name);
		throw new ToolError(
			killed
				? `Tab ${JSON.stringify(name)} was killed: ${killed}. Reopen it.`
				: `Tab ${JSON.stringify(name)} is not alive. Open it first with action:"open".`,
		);
	}
	if (tab.pending.size > 0) throw new ToolError(`Tab ${JSON.stringify(name)} is busy`);
	const id = uid.next();
	const { promise, resolve, reject } = Promise.withResolvers<RunResultOk>();
	const closeAc = new AbortController();
	const pending: PendingRun = { resolve, reject, signal: opts.signal, toolCalls: new Map(), closeAc };
	tab.pending.set(id, pending);
	const abort = (): void => {
		tab.worker.send({ type: "abort", id });
		for (const ctrl of pending.toolCalls.values()) ctrl.abort(opts.signal?.reason);
	};
	if (opts.signal?.aborted) abort();
	else opts.signal?.addEventListener("abort", abort, { once: true });
	try {
		tab.worker.send({ type: "run", id, name, code: opts.code, timeoutMs: opts.timeoutMs, session: snapshot });
		try {
			return await raceWithTimeout(promise, opts.timeoutMs + GRACE_MS, "Browser code execution hung past grace; tab killed", async reason => await forceKillTab(name, reason));
		} catch (error) {
			const runTimedOut = error instanceof ToolError && error.message.startsWith("Browser code execution timed out after ");
			if (runTimedOut || error instanceof RecoverableWorkerError) {
				try {
					if (tab.worker.mode === "inline") {
						await forceKillTab(name, runTimedOut ? "Browser code execution timed out; tab killed" : "Browser request interception cleanup failed; tab killed");
					} else {
						await recycleTimedOutWorkerTab(tab, opts.timeoutMs + GRACE_MS);
					}
				} catch (recycleError) {
					logger.warn("Failed to recycle browser tab worker; killing tab", {
						error: recycleError instanceof Error ? recycleError.message : String(recycleError),
					});
					await forceKillTab(name, "Browser tab worker recovery failed; tab killed");
				}
			}
			throw error;
		}
	} finally {
		opts.signal?.removeEventListener("abort", abort);
		tab.pending.delete(id);
	}
}

export async function releaseTab(name: string, opts: ReleaseTabOptions = {}): Promise<boolean> {
	const tab = tabs.get(name);
	if (!tab) {
		logger.debug("releaseTab: unknown tab", { name });
		return false;
	}
	const wasAlive = tab.state === "alive";
	tab.state = "dead";
	const closeError = new ToolError(`Tab ${JSON.stringify(name)} was closed`);
	for (const [id, pending] of tab.pending) {
		try {
			tab.worker.send({ type: "abort", id, expectedCleanup: true });
		} catch {
			// worker already gone
		}
		for (const ctrl of pending.toolCalls.values()) ctrl.abort(closeError);
		pending.closeAc?.abort(closeError);
		pending.reject(closeError);
	}
	tab.pending.clear();
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TAB_CLOSE_TIMEOUT_MS;
	let cleanupError: unknown;
	let forced = false;
	if (wasAlive) {
		try {
			tab.worker.send({ type: "close" });
			await waitForClosed(tab);
		} catch {
			forced = true;
		}
	}
	await tab.worker.terminate().catch(() => undefined);
	if (forced && tab.kindTag === "headless") {
		try {
			await waitForTabCleanup(tab, timeoutMs, `orphan CDP target ${JSON.stringify(tab.targetId)} (Page.close)`, closeOrphanTarget(tab));
		} catch (error) {
			cleanupError = error;
		}
	}
	try {
		await releaseBrowser(tab.browser, { kill: opts.kill ?? false, timeoutMs, resource: `tab ${JSON.stringify(name)}` });
	} catch (error) {
		cleanupError ??= error;
	} finally {
		tabs.delete(name);
	}
	if (cleanupError) throw cleanupError;
	return true;
}

export async function releaseAllTabs(opts: ReleaseTabOptions = {}): Promise<number> {
	const names = [...tabs.keys()];
	let count = 0;
	for (const name of names) {
		if (await releaseTab(name, opts)) count++;
	}
	return count;
}

export async function dropHeadlessTabs(): Promise<void> {
	const names = [...tabs.values()].filter(tab => tab.kindTag === "headless").map(tab => tab.name);
	for (const name of names) await releaseTab(name);
}

/** Release every tab created by the given owner session id. */
export async function releaseTabsForOwner(ownerId: string, opts: ReleaseTabOptions = {}): Promise<number> {
	if (!ownerId) return 0;
	const names = [...tabs.values()].filter(tab => tab.ownerSessionId === ownerId).map(tab => tab.name);
	let count = 0;
	for (const name of names) {
		if (await releaseTab(name, opts)) count++;
	}
	return count;
}

/** Test-only accessor for the module-global tabs map. */
export function getTabsMapForTest(): ReadonlyMap<string, TabSession> {
	return tabs;
}

async function buildInitPayload(browser: PuppeteerBrowserHandle, opts: AcquireTabOptions): Promise<WorkerInitPayload> {
	const safeDir = getPuppeteerDir();
	const browserWSEndpoint = browser.browser.wsEndpoint();
	if (!browserWSEndpoint) throw new ToolError("Browser websocket endpoint is unavailable");
	if (browser.kind.kind === "headless") {
		return {
			mode: "headless",
			browserWSEndpoint,
			safeDir,
			viewport: opts.viewport,
			dialogs: opts.dialogs,
			url: opts.url,
			waitUntil: opts.waitUntil,
			timeoutMs: opts.timeoutMs,
		};
	}
	const userDriven = browser.kind.kind === "connected" || browser.kind.kind === "relay";
	const activateForScreenshot = !userDriven || !shouldPreserveConnectedBrowserFocus(browser.browser);
	const page = await pickElectronTarget(browser.browser, {
		target: opts.target,
		signal: opts.signal,
	});
	const targetId = await targetIdForPage(page);
	return {
		mode: "attach",
		browserWSEndpoint,
		safeDir,
		targetId,
		dialogs: opts.dialogs,
		url: opts.url,
		waitUntil: opts.waitUntil,
		timeoutMs: opts.timeoutMs,
		activateForScreenshot,
	};
}

function handleTabMessage(tab: WorkerTabSession, msg: WorkerOutbound): void {
	if (msg.type === "result") {
		const pending = tab.pending.get(msg.id);
		if (!pending) return;
		tab.pending.delete(msg.id);
		if (msg.ok) {
			pending.resolve(msg.payload);
			return;
		}
		pending.reject(errorFromPayload(msg.error));
		return;
	}
	if (msg.type === "ready") {
		tab.info = msg.info;
		return;
	}
	if (msg.type === "tool-call") {
		void dispatchToolCall(tab, msg);
		return;
	}
	if (msg.type === "log") logWorkerMessage(msg);
}

async function dispatchToolCall(tab: WorkerTabSession, msg: Extract<WorkerOutbound, { type: "tool-call" }>): Promise<void> {
	// The dsh-browser-tool port does not bridge user run code to session tools.
	safeSend(tab, {
		type: "tool-reply",
		id: msg.id,
		reply: {
			ok: false,
			error: {
				name: "ToolError",
				message: "tool() is not supported in dsh-browser-tool run cells",
				isToolError: true,
				isAbort: false,
			},
		},
	});
}

function safeSend(tab: WorkerTabSession, msg: WorkerInbound): void {
	if (tab.state !== "alive") return;
	try {
		tab.worker.send(msg);
	} catch (err) {
		logger.debug("tab worker send failed", { error: err instanceof Error ? err.message : String(err) });
	}
}

function toErrorPayload(error: unknown): RunErrorPayload {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			stack: error.stack,
			isAbort: error.name === "AbortError" || error.name === "ToolAbortError",
			isToolError: error instanceof ToolError || error.name === "ToolError",
		};
	}
	return { name: "Error", message: String(error), isAbort: false, isToolError: false };
}

async function recycleTimedOutWorkerTab(tab: WorkerTabSession, timeoutMs: number): Promise<void> {
	const startedAt = performance.now();
	const oldWorker = tab.worker;
	await oldWorker.terminate().catch(() => undefined);
	const browserWSEndpoint = tab.browser.browser.wsEndpoint();
	if (!browserWSEndpoint) throw new ToolError("Browser websocket endpoint is unavailable");
	const payload: WorkerInitPayload = {
		mode: "attach",
		browserWSEndpoint,
		safeDir: getPuppeteerDir(),
		targetId: tab.targetId,
		dialogs: tab.dialogPolicy,
		recover: true,
		timeoutMs,
		activateForScreenshot: tab.activateForScreenshot,
	};
	let worker = await spawnTabWorker();
	try {
		const info = await initializeTabWorker(worker, payload, timeoutMs, startedAt);
		tab.worker = worker;
		tab.info = info;
		tab.state = "alive";
		worker.onMessage(msg => handleTabMessage(tab, msg));
	} catch (error) {
		await worker.terminate().catch(() => undefined);
		if (initBudgetExhausted(timeoutMs, startedAt)) throw error;
		worker = await spawnInlineWorker();
		try {
			const info = await initializeTabWorker(worker, payload, timeoutMs, startedAt);
			tab.worker = worker;
			tab.info = info;
			tab.state = "alive";
			worker.onMessage(msg => handleTabMessage(tab, msg));
		} catch (inlineError) {
			await worker.terminate().catch(() => undefined);
			const finalError = new ToolError(
				`Failed to recycle timed-out browser tab worker (inline fallback also failed): ${inlineError instanceof Error ? inlineError.message : String(inlineError)}`,
			);
			Object.defineProperty(finalError, "cause", { value: error, configurable: true });
			throw finalError;
		}
	}
}

async function forceKillTab(name: string, reason: string): Promise<void> {
	const tab = tabs.get(name);
	if (!tab) return;
	killedTabs.set(name, reason);
	tab.state = "dead";
	const error = new ToolError(reason);
	for (const pending of tab.pending.values()) pending.reject(error);
	tab.pending.clear();
	await tab.worker.terminate().catch(() => undefined);
	if (tab.kindTag === "headless") await closeOrphanTarget(tab);
	await releaseBrowser(tab.browser, { kill: false });
	tabs.delete(name);
}

async function closeTargetById(browser: PuppeteerBrowserHandle, targetId: string): Promise<void> {
	const session = await browser.browser
		.target()
		.createCDPSession()
		.catch(() => null);
	if (!session) return;
	try {
		await session.send("Target.closeTarget", { targetId }).catch(() => undefined);
	} finally {
		await session.detach().catch(() => undefined);
	}
}

async function closeOrphanTarget(tab: WorkerTabSession): Promise<void> {
	await closeTargetById(tab.browser, tab.targetId);
}

function closeAbandonedWorkerPage(browser: PuppeteerBrowserHandle, worker: WorkerHandle): void {
	const targetId = workerPageTargets.get(worker);
	workerPageTargets.delete(worker);
	if (!targetId) return;
	holdBrowser(browser);
	void closeTargetById(browser, targetId)
		.catch(() => undefined)
		.finally(() => void releaseBrowser(browser, { kill: false }).catch(() => undefined));
}

async function waitForClosed(tab: WorkerTabSession): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	const unsubscribe = tab.worker.onMessage(msg => {
		if (msg.type === "closed") resolve();
	});
	try {
		await raceWithTimeout(promise, GRACE_MS, "Timed out closing browser tab worker");
	} finally {
		unsubscribe();
	}
}

async function targetIdForTarget(target: Target): Promise<string> {
	const raw = target as unknown as { _targetId?: unknown };
	if (typeof raw._targetId === "string") return raw._targetId;
	const session = await target.createCDPSession();
	try {
		const info = (await session.send("Target.getTargetInfo")) as { targetInfo?: { targetId?: string } };
		if (info.targetInfo?.targetId) return info.targetInfo.targetId;
		throw new ToolError("Target id unavailable from CDP target info");
	} finally {
		await session.detach().catch(() => undefined);
	}
}

function errorFromPayload(payload: RunErrorPayload): Error {
	const error = payload.recoverTab
		? new RecoverableWorkerError(payload.message)
		: payload.isAbort
			? new ToolAbortError()
			: payload.isToolError
				? new ToolError(payload.message)
				: new Error(payload.message);
	error.name = payload.name;
	if (payload.stack) error.stack = payload.stack;
	return error;
}

function logWorkerMessage(msg: Extract<WorkerOutbound, { type: "log" }>): void {
	if (msg.level === "debug") logger.debug(msg.msg, msg.meta);
	else if (msg.level === "warn") logger.warn(msg.msg, msg.meta);
	else logger.error(msg.msg, msg.meta);
}

async function raceWithTimeout<T>(promise: Promise<T>, timeoutMs: number, reason: string, onTimeout?: (reason: string) => Promise<void>): Promise<T> {
	const { promise: timeoutPromise, reject } = Promise.withResolvers<never>();
	const timer = setTimeout(() => reject(new ToolError(reason)), timeoutMs);
	try {
		return await Promise.race([promise, timeoutPromise]);
	} catch (error) {
		if (error instanceof ToolError && error.message === reason) await onTimeout?.(reason);
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

async function spawnTabWorker(): Promise<WorkerHandle> {
	try {
		const worker = new Worker(new URL("./tab-worker-entry.js", import.meta.url));
		return wrapNodeWorker(worker);
	} catch (err) {
		logger.warn("Worker spawn failed; using inline tab worker (no sync-loop guard)", {
			error: err instanceof Error ? err.message : String(err),
		});
		return spawnInlineWorker();
	}
}

function wrapNodeWorker(worker: Worker): WorkerHandle {
	return {
		mode: "worker",
		send(msg) {
			worker.postMessage(msg);
		},
		onMessage(handler) {
			const wrap = (data: unknown): void => handler(data as WorkerOutbound);
			worker.on("message", wrap);
			return () => worker.off("message", wrap);
		},
		onError(handler) {
			const onError = (error: Error): void => handler(error);
			worker.on("error", onError);
			return () => worker.off("error", onError);
		},
		async terminate() {
			await worker.terminate();
		},
	};
}

/** Inline fallback: run the worker core on this thread (cannot interrupt sync loops). */
async function spawnInlineWorker(): Promise<WorkerHandle> {
	const hostListeners = new Set<(message: WorkerOutbound) => void>();
	const workerListeners = new Set<(message: WorkerInbound) => void>();
	const workerTransport: Transport = {
		send: msg =>
			queueMicrotask(() => {
				for (const listener of hostListeners) listener(msg as WorkerOutbound);
			}),
		onMessage: handler => {
			const typed = handler as (message: WorkerInbound) => void;
			workerListeners.add(typed);
			return () => workerListeners.delete(typed);
		},
		close: () => {},
	};
	const { WorkerCore } = await import("./tab-worker.js");
	new WorkerCore(workerTransport, false);
	return {
		mode: "inline",
		send: msg =>
			queueMicrotask(() => {
				for (const listener of workerListeners) listener(msg);
			}),
		onMessage: handler => {
			hostListeners.add(handler);
			return () => hostListeners.delete(handler);
		},
		onError: () => () => {},
		async terminate() {},
	};
}

async function initializeTabWorker(
	worker: WorkerHandle,
	payload: WorkerInitPayload,
	timeoutMs: number,
	deadlineStart: number = performance.now(),
): Promise<ReadyInfo> {
	const remainingMs = timeoutMs - Math.round(performance.now() - deadlineStart);
	const setupBudgetMs = Math.max(SETUP_BUDGET_FLOOR_MS, Math.min(SETUP_BUDGET_CAP_MS, Math.floor(remainingMs / 3)));
	const setup = Promise.withResolvers<void>();
	const ready = Promise.withResolvers<ReadyInfo>();
	let setupDone = false;
	const failStartup = (error: Error): void => {
		(setupDone ? ready : setup).reject(error);
	};
	const unlisten = worker.onMessage(msg => {
		if (msg.type === "page-created") {
			workerPageTargets.set(worker, msg.targetId);
		} else if (msg.type === "setup") {
			setupDone = true;
			setup.resolve();
		} else if (msg.type === "ready") ready.resolve(msg.info);
		else if (msg.type === "init-failed") failStartup(markReportedInitFailure(errorFromPayload(msg.error)));
		else if (msg.type === "log") logWorkerMessage(msg);
	});
	const unlistenError = worker.onError(error => {
		failStartup(new ToolError(`Tab worker failed during startup: ${error.message}`));
	});
	try {
		worker.send({ type: "init", payload });
		await raceWithTimeout(setup.promise, setupBudgetMs, "Timed out waiting for tab worker setup");
		const readyBudgetMs = Math.max(READY_BUDGET_FLOOR_MS, timeoutMs - Math.round(performance.now() - deadlineStart));
		return await raceWithTimeout(ready.promise, readyBudgetMs, "Timed out initializing browser tab worker");
	} finally {
		unlisten();
		unlistenError();
	}
}

function initBudgetExhausted(budgetMs: number, deadlineStart: number): boolean {
	return budgetMs - Math.round(performance.now() - deadlineStart) <= 0;
}

export function expandBrowserScreenshotDir(raw: string | undefined): string | undefined {
	return raw ? expandPath(raw) : undefined;
}

export function initializeTabWorkerForTest(
	worker: WorkerHandle,
	payload: WorkerInitPayload,
	timeoutMs: number,
	deadlineStart: number = performance.now(),
): Promise<ReadyInfo> {
	return initializeTabWorker(worker, payload, timeoutMs, deadlineStart);
}

export function toErrorPayloadForTest(error: unknown): RunErrorPayload {
	return toErrorPayload(error);
}