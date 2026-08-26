/**
 * Small cross-platform utilities ported from oh-my-pi's pi-utils, stripped of
 * Bun/native dependencies. Everything here is plain Node.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ToolAbortError } from "./errors.js";
/** Sleep for `ms` milliseconds (setTimeout promise). */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * Resolve `promise` within `ms`, rejecting with `message` on timeout. An
 * aborted `signal` rejects immediately with the abort reason.
 */
export function withTimeout(promise, ms, message, signal) {
    if (signal?.aborted) {
        const reason = signal.reason instanceof Error ? signal.reason : new Error("Aborted");
        return Promise.reject(reason);
    }
    const { promise: wrapped, resolve, reject } = Promise.withResolvers();
    let settled = false;
    const timeoutId = setTimeout(() => {
        if (settled)
            return;
        settled = true;
        if (signal)
            signal.removeEventListener("abort", onAbort);
        reject(new Error(message));
    }, ms);
    const onAbort = () => {
        if (settled)
            return;
        settled = true;
        clearTimeout(timeoutId);
        const reason = signal?.reason instanceof Error ? signal.reason : new ToolAbortError("Aborted");
        reject(reason);
    };
    if (signal)
        signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(value => {
        if (settled)
            return;
        settled = true;
        clearTimeout(timeoutId);
        if (signal)
            signal.removeEventListener("abort", onAbort);
        resolve(value);
    }, error => {
        if (settled)
            return;
        settled = true;
        clearTimeout(timeoutId);
        if (signal)
            signal.removeEventListener("abort", onAbort);
        reject(error);
    });
    return wrapped;
}
/**
 * Await `pr` (or a thunk returning it) unless `signal` aborts first, in which
 * case reject with an abort error. Port of pi-utils `untilAborted`.
 */
export function untilAborted(signal, pr) {
    if (!signal)
        return typeof pr === "function" ? pr() : pr;
    if (signal.aborted)
        return Promise.reject(new ToolAbortError(undefined, { cause: signal.reason }));
    const { promise, resolve, reject } = Promise.withResolvers();
    const onAbort = () => reject(new ToolAbortError(undefined, { cause: signal.reason }));
    signal.addEventListener("abort", onAbort, { once: true });
    void (async () => {
        try {
            resolve(await (typeof pr === "function" ? pr() : pr));
        }
        catch (err) {
            reject(err);
        }
        finally {
            signal.removeEventListener("abort", onAbort);
        }
    })();
    return promise;
}
let snowflakeCounter = 0;
let snowflakeLastMs = 0;
/** Monotonic unique id: `<millis>-<counter>`. Not a real Snowflake; unique per process. */
export const uid = {
    next() {
        const now = Date.now();
        snowflakeCounter = now === snowflakeLastMs ? snowflakeCounter + 1 : 0;
        snowflakeLastMs = now;
        return `${now}-${snowflakeCounter}`;
    },
};
/** Parse a 0/1 (or true/false) env-style flag; a blank value counts as disabled. */
export function parseFlag(raw, fallback) {
    if (raw === undefined)
        return fallback;
    const v = raw.trim().toLowerCase();
    if (v === "")
        return fallback;
    return v === "1" || v === "true";
}
/** Leveled logger to stderr; levels parsed from DSH_BROWSER_LOG (debug|info|warn|error). */
export const logger = {
    level: (process.env.DSH_BROWSER_LOG ?? "info").toLowerCase(),
    debug(msg, meta) {
        if (this.level !== "debug")
            return;
        console.error(`[browser-tool:debug] ${msg}`, meta ?? "");
    },
    info(msg, meta) {
        if (this.level === "error" || this.level === "warn")
            return;
        console.error(`[browser-tool:info] ${msg}`, meta ?? "");
    },
    warn(msg, meta) {
        if (this.level === "error")
            return;
        console.error(`[browser-tool:warn] ${msg}`, meta ?? "");
    },
    error(msg, meta) {
        console.error(`[browser-tool:error] ${msg}`, meta ?? "");
    },
};
/** JSON.stringify that never throws (cycles/BigInt → String(value)). */
export function safeJsonStringify(value) {
    try {
        return JSON.stringify(value, null, 2);
    }
    catch {
        return String(value);
    }
}
/** Deep-copy a value across a run boundary: structured-cloneable as-is, else JSON round-trip, else String. */
export function cloneSafe(value) {
    if (value === undefined)
        return undefined;
    try {
        structuredClone(value);
        return value;
    }
    catch {
        // fall through
    }
    try {
        return JSON.parse(JSON.stringify(value));
    }
    catch {
        // fall through
    }
    return String(value);
}
/** Recursively remove `target`, retrying on transient EBUSY/EPERM/ENOTEMPTY. */
export async function removeWithRetries(target, attempts = 8, delayMs = 150) {
    for (let attempt = 1;; attempt++) {
        try {
            await fs.promises.rm(target, { recursive: true, force: true });
            return;
        }
        catch (error) {
            const code = error.code;
            const transient = code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY";
            if (!transient || attempt >= attempts) {
                // EBUSY/EPERM/ENOTEMPTY after retries: leave the dir for a later pass rather than throw.
                if (transient) {
                    logger.warn("Directory cleanup left in place after retries", { target, code });
                    return;
                }
                throw error;
            }
            await sleep(delayMs);
        }
    }
}
/** Resolve an executable on PATH, or null (port of pi-utils `$which`). */
export function which(name) {
    const pathVar = process.env.PATH ?? "";
    const isWin = process.platform === "win32";
    const exts = isWin ? [".exe", ".cmd", ".bat", ""] : [""];
    for (const dir of pathVar.split(path.delimiter)) {
        if (!dir)
            continue;
        for (const ext of exts) {
            const candidate = path.join(dir, name + ext);
            try {
                const stat = fs.statSync(candidate);
                if (stat.isFile() && (isWin || (stat.mode & 0o111) !== 0))
                    return candidate;
            }
            catch {
                // not here
            }
        }
    }
    return null;
}
/** Package-owned cache dir: `$DSH_HOME/browser-tool` when DSH_HOME is set, else `~/.dsh-browser-tool`. */
export function cacheDir() {
    const dshHome = process.env.DSH_HOME;
    return dshHome && dshHome.length > 0 ? path.join(dshHome, "browser-tool") : path.join(os.homedir(), ".dsh-browser-tool");
}
/** Chromium executable overrides, mirroring puppeteer's own env contract plus our alias. */
export function puppeteerExecutablePathFromEnv() {
    return process.env.PUPPETEER_EXECUTABLE_PATH ?? process.env.DSH_BROWSER_EXECUTABLE;
}
