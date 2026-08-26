/**
 * Run-output accumulator for browser `run` cells. Ported from oh-my-pi
 * `run-output.ts` with pi-ai content types replaced by local ones.
 */
import type { ImageContent, TextContent } from "./types.js";
import { safeJsonStringify } from "./../util.js";
export type JsDisplayOutput = {
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
};
/**
 * Accumulates a browser run's result entries: explicit `display()` payloads,
 * screenshot captions/images, and buffered stream text. Stream text is flushed
 * as one entry before the next display/screenshot (and on `finish()`) so it
 * reaches the tool result in order.
 */
export declare class RunOutput {
    #private;
    pushText(chunk: string): void;
    pushDisplay(output: JsDisplayOutput): void;
    push(entry: TextContent | ImageContent): void;
    finish(): Array<TextContent | ImageContent>;
}
export { safeJsonStringify };
/** Pass a return value across the run boundary: structured-cloneable as-is, else JSON round-trip, else String. */
export declare function cloneSafe(value: unknown): unknown;
