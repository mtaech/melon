/** Sleep for `ms` milliseconds (setTimeout promise). */
export declare function sleep(ms: number): Promise<void>;
/**
 * Resolve `promise` within `ms`, rejecting with `message` on timeout. An
 * aborted `signal` rejects immediately with the abort reason.
 */
export declare function withTimeout<T>(promise: Promise<T>, ms: number, message: string, signal?: AbortSignal): Promise<T>;
/**
 * Await `pr` (or a thunk returning it) unless `signal` aborts first, in which
 * case reject with an abort error. Port of pi-utils `untilAborted`.
 */
export declare function untilAborted<T>(signal: AbortSignal | undefined | null, pr: Promise<T> | (() => Promise<T>)): Promise<T>;
/** Monotonic unique id: `<millis>-<counter>`. Not a real Snowflake; unique per process. */
export declare const uid: {
    next(): string;
};
/** Parse a 0/1 (or true/false) env-style flag; a blank value counts as disabled. */
export declare function parseFlag(raw: string | undefined, fallback: boolean): boolean;
/** Leveled logger to stderr; levels parsed from DSH_BROWSER_LOG (debug|info|warn|error). */
export declare const logger: {
    level: "debug" | "info" | "warn" | "error";
    debug(msg: string, meta?: Record<string, unknown>): void;
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
};
/** JSON.stringify that never throws (cycles/BigInt → String(value)). */
export declare function safeJsonStringify(value: unknown): string;
/** Deep-copy a value across a run boundary: structured-cloneable as-is, else JSON round-trip, else String. */
export declare function cloneSafe(value: unknown): unknown;
/** Recursively remove `target`, retrying on transient EBUSY/EPERM/ENOTEMPTY. */
export declare function removeWithRetries(target: string, attempts?: number, delayMs?: number): Promise<void>;
/** Resolve an executable on PATH, or null (port of pi-utils `$which`). */
export declare function which(name: string): string | null;
/** Package-owned cache dir: `$DSH_HOME/browser-tool` when DSH_HOME is set, else `~/.dsh-browser-tool`. */
export declare function cacheDir(): string;
/** Chromium executable overrides, mirroring puppeteer's own env contract plus our alias. */
export declare function puppeteerExecutablePathFromEnv(): string | undefined;
