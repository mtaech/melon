/**
 * Shared error types for the dsh browser tool. Mirrors oh-my-pi's tool-errors:
 * a user-facing `ToolError` (shown to the model), a distinct `ToolAbortError`
 * (cancellation — not a failure), and the `throwIfAborted` guard.
 */

/** An error that should be surfaced to the model as-is (no internal details). */
export class ToolError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "ToolError";
	}
}

/** Cancellation (agent abort / tool timeout) — reported without a stack. */
export class ToolAbortError extends Error {
	constructor(message = "Aborted", options?: { cause?: unknown }) {
		super(message, options);
		this.name = "ToolAbortError";
	}
}

/** True when the error is a cancellation rather than a real failure. */
export function isToolAbortError(error: unknown): boolean {
	return error instanceof ToolAbortError;
}

/** Throw {@link ToolAbortError} when the signal is already aborted. */
export function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		const reason = signal.reason;
		throw reason instanceof ToolAbortError ? reason : new ToolAbortError(undefined, { cause: reason });
	}
}

/** Promise that never settles (used as a never type). */
export function never(): Promise<never> {
	return new Promise<never>(() => {});
}