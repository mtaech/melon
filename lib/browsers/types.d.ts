/**
 * Wire protocol between the tab supervisor and its tab workers.
 * Ported from oh-my-pi `tab-protocol.ts`; `Bun.Transferable` and the pi-ai
 * content types are replaced with local plain-JSON types (image payloads ride
 * as base64 strings through Node worker_threads' structured clone).
 */
/** A text content entry produced inside a `run` cell. */
export interface TextContent {
    type: "text";
    text: string;
}
/** An image content entry produced inside a `run` cell (base64 data). */
export interface ImageContent {
    type: "image";
    data: string;
    mimeType: string;
    width: number;
    height: number;
    /** Absolute path where the full-resolution capture was saved (may be unset). */
    dest?: string;
}
export interface ObservationEntry {
    id: number;
    role: string;
    name?: string;
    value?: string | number;
    description?: string;
    keyshortcuts?: string;
    states: string[];
}
export interface Observation {
    url: string;
    title?: string;
    viewport: {
        width: number;
        height: number;
        deviceScaleFactor?: number;
    };
    scroll: {
        x: number;
        y: number;
        width: number;
        height: number;
        scrollWidth: number;
        scrollHeight: number;
    };
    elements: ObservationEntry[];
}
export interface ScreenshotResult {
    dest: string;
    mimeType: string;
    bytes: number;
    width: number;
    height: number;
}
export interface SessionSnapshot {
    cwd: string;
    browserScreenshotDir?: string;
    /** Force non-WebP screenshot encoding (see DSH_BROWSER_NO_WEBP). Unset honors the env var. */
    excludeWebP?: boolean;
}
export type WorkerInitPayload = {
    mode: "headless";
    browserWSEndpoint: string;
    safeDir: string;
    viewport?: {
        width: number;
        height: number;
        deviceScaleFactor?: number;
    };
    dialogs?: "accept" | "dismiss";
    url?: string;
    waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2";
    timeoutMs: number;
} | {
    mode: "attach";
    browserWSEndpoint: string;
    safeDir: string;
    targetId: string;
    dialogs?: "accept" | "dismiss";
    url?: string;
    waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2";
    timeoutMs: number;
    /** Post-timeout recycle: before adopting the page, dismiss open dialogs and stop a pending navigation. */
    recover?: boolean;
    /** Whether the worker may raise this tab before capturing a screenshot; cleared for browsers we did not launch. */
    activateForScreenshot?: boolean;
};
export type ToolReply = {
    ok: true;
    value: unknown;
} | {
    ok: false;
    error: RunErrorPayload;
};
export type WorkerInbound = {
    type: "init";
    payload: WorkerInitPayload;
} | {
    type: "run";
    id: string;
    name: string;
    code: string;
    timeoutMs: number;
    session: SessionSnapshot;
} | {
    type: "abort";
    id: string;
    expectedCleanup?: boolean;
} | {
    type: "tool-reply";
    id: string;
    reply: ToolReply;
} | {
    type: "close";
};
export interface ReadyInfo {
    url: string;
    title?: string;
    viewport: {
        width: number;
        height: number;
        deviceScaleFactor?: number;
    };
    targetId: string;
}
export interface RunResultOk {
    displays: Array<TextContent | ImageContent>;
    returnValue: unknown;
    screenshots: ScreenshotResult[];
}
export interface RunErrorPayload {
    name: string;
    message: string;
    stack?: string;
    isToolError: boolean;
    isAbort: boolean;
    /** The worker could not restore tab-scoped browser state and must be recycled. */
    recoverTab?: boolean;
}
export type WorkerOutbound = 
/** Puppeteer loaded, browser connected (before page acquisition). */
{
    type: "setup";
}
/** Headless page created (before slow post-creation CDP work) so the supervisor can close exactly this target. */
 | {
    type: "page-created";
    targetId: string;
} | {
    type: "ready";
    info: ReadyInfo;
} | {
    type: "init-failed";
    error: RunErrorPayload;
} | {
    type: "result";
    id: string;
    ok: true;
    payload: RunResultOk;
} | {
    type: "result";
    id: string;
    ok: false;
    error: RunErrorPayload;
} | {
    type: "tool-call";
    id: string;
    runId: string;
    name: string;
    args: unknown;
} | {
    type: "log";
    level: "debug" | "warn" | "error";
    msg: string;
    meta?: Record<string, unknown>;
} | {
    type: "closed";
};
export interface Transport {
    send(msg: WorkerOutbound | WorkerInbound): void;
    onMessage(handler: (msg: WorkerOutbound | WorkerInbound) => void): () => void;
    close(): void;
}
