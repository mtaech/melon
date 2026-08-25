/**
 * Run-output accumulator for browser `run` cells. Ported from oh-my-pi
 * `run-output.ts` with pi-ai content types replaced by local ones.
 */
import type { ImageContent, TextContent } from "./types.js";
import { safeJsonStringify } from "./../util.js";

export type JsDisplayOutput =
	| { type: "image"; data: string; mimeType: string; width: number; height: number }
	| { type: "json"; data: unknown }
	| { type: "status"; event: Record<string, unknown> };

/**
 * Accumulates a browser run's result entries: explicit `display()` payloads,
 * screenshot captions/images, and buffered stream text. Stream text is flushed
 * as one entry before the next display/screenshot (and on `finish()`) so it
 * reaches the tool result in order.
 */
export class RunOutput {
	readonly #displays: Array<TextContent | ImageContent> = [];
	#textBuffer = "";

	pushText(chunk: string): void {
		this.#textBuffer += chunk;
	}

	pushDisplay(output: JsDisplayOutput): void {
		if (output.type === "image") {
			this.push({ type: "image", data: output.data, mimeType: output.mimeType, width: output.width, height: output.height });
			return;
		}
		if (output.type === "json") {
			this.push({ type: "text", text: safeJsonStringify(output.data) });
			return;
		}
		this.push({ type: "text", text: safeJsonStringify(output.event) });
	}

	push(entry: TextContent | ImageContent): void {
		this.#flush();
		this.#displays.push(entry);
	}

	finish(): Array<TextContent | ImageContent> {
		this.#flush();
		return this.#displays;
	}

	#flush(): void {
		if (!this.#textBuffer) return;
		this.#displays.push({ type: "text", text: this.#textBuffer.replace(/\n$/, "") });
		this.#textBuffer = "";
	}
}

export { safeJsonStringify };

/** Pass a return value across the run boundary: structured-cloneable as-is, else JSON round-trip, else String. */
export function cloneSafe(value: unknown): unknown {
	if (value === undefined) return undefined;
	try {
		structuredClone(value);
		return value;
	} catch {
		// fall through
	}
	try {
		return JSON.parse(JSON.stringify(value)) as unknown;
	} catch {
		// fall through
	}
	return String(value);
}