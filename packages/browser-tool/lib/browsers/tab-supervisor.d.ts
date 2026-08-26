import { type BrowserHandle, type BrowserKindTag, type PuppeteerBrowserHandle } from "./registry.js";
import type { ReadyInfo, RunErrorPayload, RunResultOk, WorkerInbound, WorkerInitPayload, WorkerOutbound } from "./types.js";
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
    viewport?: {
        width: number;
        height: number;
        deviceScaleFactor?: number;
    };
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
export declare function getTab(name: string): TabSession | undefined;
export declare function acquireTab(name: string, browser: BrowserHandle, opts: AcquireTabOptions): Promise<AcquireTabResult>;
export declare function runInTab(name: string, opts: RunInTabOptions): Promise<RunResultOk>;
export declare function releaseTab(name: string, opts?: ReleaseTabOptions): Promise<boolean>;
export declare function releaseAllTabs(opts?: ReleaseTabOptions): Promise<number>;
export declare function dropHeadlessTabs(): Promise<void>;
/** Release every tab created by the given owner session id. */
export declare function releaseTabsForOwner(ownerId: string, opts?: ReleaseTabOptions): Promise<number>;
/** Test-only accessor for the module-global tabs map. */
export declare function getTabsMapForTest(): ReadonlyMap<string, TabSession>;
export declare function expandBrowserScreenshotDir(raw: string | undefined): string | undefined;
export declare function initializeTabWorkerForTest(worker: WorkerHandle, payload: WorkerInitPayload, timeoutMs: number, deadlineStart?: number): Promise<ReadyInfo>;
export declare function toErrorPayloadForTest(error: unknown): RunErrorPayload;
export {};
