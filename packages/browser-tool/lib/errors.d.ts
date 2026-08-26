/**
 * Shared error types for the dsh browser tool. Mirrors oh-my-pi's tool-errors:
 * a user-facing `ToolError` (shown to the model), a distinct `ToolAbortError`
 * (cancellation — not a failure), and the `throwIfAborted` guard.
 */
/** An error that should be surfaced to the model as-is (no internal details). */
export declare class ToolError extends Error {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
/** Cancellation (agent abort / tool timeout) — reported without a stack. */
export declare class ToolAbortError extends Error {
    constructor(message?: string, options?: {
        cause?: unknown;
    });
}
/** True when the error is a cancellation rather than a real failure. */
export declare function isToolAbortError(error: unknown): boolean;
/** Throw {@link ToolAbortError} when the signal is already aborted. */
export declare function throwIfAborted(signal?: AbortSignal): void;
/** Promise that never settles (used as a never type). */
export declare function never(): Promise<never>;
