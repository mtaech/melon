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
export interface RuntimeHooks {
    /** Stream-text chunk (console.log/print/display of primitives). */
    onText(text: string): void;
    /** Explicit `display()` payload. */
    onDisplay(payload: {
        type: "image";
        data: string;
        mimeType: string;
        width: number;
        height: number;
    } | {
        type: "json";
        data: unknown;
    } | {
        type: "status";
        event: Record<string, unknown>;
    }): void;
}
export interface RunScope {
    page: unknown;
    browser: unknown;
    tab: unknown;
    assert(cond: unknown, text?: string): void;
    wait(msOrPredicate: number | (() => unknown), opts?: {
        timeout?: number;
        interval?: number;
    }): Promise<unknown>;
    sleep(ms: number): Promise<void>;
}
/** Execute `code` as an async function body with the browser surface in scope. */
export declare function runJsCode(code: string, scope: RunScope & Record<string, unknown>, opts: {
    name: string;
    hooks: RuntimeHooks;
}): Promise<unknown>;
/** Build a `display` function that routes to the runtime hooks. */
export declare function createDisplay(hooks: RuntimeHooks): (value: unknown) => void;
/** Build `print` (alias of console.log-style streaming) plus a bound console. */
export declare function createPrint(hooks: RuntimeHooks): (value: unknown) => void;
/** A console object whose log/info/warn/error stream into the run output. */
export declare function createConsole(hooks: RuntimeHooks): Console;
