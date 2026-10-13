/**
 * Shared error types for dsh-idea-mcp. `ToolError` is surfaced to the model
 * verbatim (connection problems, unresolvable project, timeouts), so its
 * message must stay actionable and free of internal stack detail.
 */

/** An error that should be surfaced to the model as-is. */
export class ToolError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "ToolError";
	}
}

/** True when a failure is caller cancellation rather than a real failure. */
export function isAbortError(error: unknown): boolean {
	if (error instanceof Error && error.name === "AbortError") return true;
	return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

/** Reject with a named AbortError so the registry reports cancellation, not failure. */
export function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		const error = new Error("Aborted");
		error.name = "AbortError";
		throw error;
	}
}
