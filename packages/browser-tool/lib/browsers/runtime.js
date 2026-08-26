/**
 * Minimal `run`-cell JavaScript runtime for the browser tool.
 *
 * Ported from oh-my-pi's shared `JsRuntime` (eval/js/shared/runtime) reduced to
 * the browser-relevant surface: an async function body executed with `page`,
 * `browser`, `tab`, `display`, `print`, `assert`, `wait`, `sleep`, and
 * `console`. Oh-my-pi-specific helpers (read/write/tree/env/tool/agent/
 * parallel/pipeline/phase) are deliberately not provided; calling them yields a
 * clear ToolError instead of a ReferenceError.
 */
import { injectFinalExpression } from "./final-expr.js";
const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
/** Names that user code may reference but that are not implemented in the DSH port. */
const UNSUPPORTED_HELPERS = [
    "read",
    "write",
    "env",
    "tree",
    "tool",
    "agent",
    "parallel",
    "pipeline",
    "phase",
    "log",
    "budget",
];
/** Execute `code` as an async function body with the browser surface in scope. */
export async function runJsCode(code, scope, opts) {
    const { name, hooks } = opts;
    let finalExpressionValue;
    const wrapped = injectFinalExpression(code);
    const effectiveScope = {
        ...scope,
        __setFinalExpr: (value) => {
            finalExpressionValue = value;
            return value;
        },
    };
    const keys = [...Object.keys(effectiveScope), ...UNSUPPORTED_HELPERS];
    const fn = new AsyncFunction(...keys, `"use strict";
// browser run cell: ${name}
return (async () => {
${wrapped.source}
})();`);
    const values = keys.map(key => {
        if (key in effectiveScope)
            return effectiveScope[key];
        return unsupportedHelper(key);
    });
    const result = await fn(...values);
    if (wrapped.returned)
        return await finalExpressionValue;
    return result;
}
function unsupportedHelper(name) {
    return () => {
        throw new Error(`'${name}' is not available in dsh-browser-tool run cells. ` +
            `Only page, browser, tab, display, print, assert, wait, sleep and console are provided.`);
    };
}
/** Build a `display` function that routes to the runtime hooks. */
export function createDisplay(hooks) {
    return (value) => {
        if (value !== null && typeof value === "object" && "type" in value && value.type === "image") {
            const img = value;
            hooks.onDisplay({ type: "image", data: img.data, mimeType: img.mimeType, width: img.width, height: img.height });
            return;
        }
        if (value !== null && typeof value === "object") {
            hooks.onDisplay({ type: "json", data: value });
            return;
        }
        if (value === undefined)
            return;
        hooks.onText(String(value) + "\n");
    };
}
/** Build `print` (alias of console.log-style streaming) plus a bound console. */
export function createPrint(hooks) {
    return (value) => {
        hooks.onText(String(value) + "\n");
    };
}
/** A console object whose log/info/warn/error stream into the run output. */
export function createConsole(hooks) {
    const emit = (level, ...args) => {
        hooks.onText(args.map(formatConsoleArg).join(" ") + "\n");
        void level;
    };
    const stubConsole = {
        log: (...args) => emit("log", ...args),
        info: (...args) => emit("info", ...args),
        warn: (...args) => emit("warn", ...args),
        error: (...args) => emit("error", ...args),
        debug: (...args) => emit("debug", ...args),
    };
    return stubConsole;
}
function formatConsoleArg(value) {
    if (typeof value === "string")
        return value;
    try {
        return JSON.stringify(value) ?? String(value);
    }
    catch {
        return String(value);
    }
}
