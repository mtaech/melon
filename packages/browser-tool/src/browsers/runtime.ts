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
	onDisplay(payload: { type: "image"; data: string; mimeType: string; width: number; height: number } | { type: "json"; data: unknown } | { type: "status"; event: Record<string, unknown> }): void;
}

export interface RunScope {
	page: unknown;
	browser: unknown;
	tab: unknown;
	assert(cond: unknown, text?: string): void;
	wait(msOrPredicate: number | (() => unknown), opts?: { timeout?: number; interval?: number }): Promise<unknown>;
	sleep(ms: number): Promise<void>;
}

import { injectFinalExpression } from "./final-expr.js";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;

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
] as const;

/** Execute `code` as an async function body with the browser surface in scope. */
export async function runJsCode(
	code: string,
	scope: RunScope & Record<string, unknown>,
	opts: { name: string; hooks: RuntimeHooks },
): Promise<unknown> {
	const { name, hooks } = opts;
	let finalExpressionValue: unknown;
	const wrapped = injectFinalExpression(code);
	const effectiveScope: Record<string, unknown> = {
		...scope,
		__setFinalExpr: (value: unknown) => {
			finalExpressionValue = value;
			return value;
		},
	};
	const keys = [...Object.keys(effectiveScope), ...UNSUPPORTED_HELPERS];
	const fn = new AsyncFunction(
		...keys,
		`"use strict";
// browser run cell: ${name}
return (async () => {
${wrapped.source}
})();`,
	);
	const values = keys.map(key => {
		if (key in effectiveScope) return effectiveScope[key];
		return unsupportedHelper(key);
	});
	const result = await fn(...values);
	if (wrapped.returned) return await finalExpressionValue;
	return result;
}

function unsupportedHelper(name: string): () => never {
	return () => {
		throw new Error(
			`'${name}' is not available in dsh-browser-tool run cells. ` +
				`Only page, browser, tab, display, print, assert, wait, sleep and console are provided.`,
		);
	};
}

/** Build a `display` function that routes to the runtime hooks. */
export function createDisplay(hooks: RuntimeHooks): (value: unknown) => void {
	return (value: unknown): void => {
		if (value !== null && typeof value === "object" && "type" in (value as object) && (value as { type?: unknown }).type === "image") {
			const img = value as { data: string; mimeType: string; width: number; height: number };
			hooks.onDisplay({ type: "image", data: img.data, mimeType: img.mimeType, width: img.width, height: img.height });
			return;
		}
		if (value !== null && typeof value === "object") {
			hooks.onDisplay({ type: "json", data: value });
			return;
		}
		if (value === undefined) return;
		hooks.onText(String(value) + "\n");
	};
}

/** Build `print` (alias of console.log-style streaming) plus a bound console. */
export function createPrint(hooks: RuntimeHooks): (value: unknown) => void {
	return (value: unknown): void => {
		hooks.onText(String(value) + "\n");
	};
}

/** A console object whose log/info/warn/error stream into the run output. */
export function createConsole(hooks: RuntimeHooks): Console {
	const emit = (level: string, ...args: unknown[]): void => {
		hooks.onText(args.map(formatConsoleArg).join(" ") + "\n");
		void level;
	};
	const stubConsole: Partial<Console> = {
		log: (...args: unknown[]) => emit("log", ...args),
		info: (...args: unknown[]) => emit("info", ...args),
		warn: (...args: unknown[]) => emit("warn", ...args),
		error: (...args: unknown[]) => emit("error", ...args),
		debug: (...args: unknown[]) => emit("debug", ...args),
	};
	return stubConsole as Console;
}

function formatConsoleArg(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}