import { safeJsonStringify } from "./../util.js";
/**
 * Accumulates a browser run's result entries: explicit `display()` payloads,
 * screenshot captions/images, and buffered stream text. Stream text is flushed
 * as one entry before the next display/screenshot (and on `finish()`) so it
 * reaches the tool result in order.
 */
export class RunOutput {
    #displays = [];
    #textBuffer = "";
    pushText(chunk) {
        this.#textBuffer += chunk;
    }
    pushDisplay(output) {
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
    push(entry) {
        this.#flush();
        this.#displays.push(entry);
    }
    finish() {
        this.#flush();
        return this.#displays;
    }
    #flush() {
        if (!this.#textBuffer)
            return;
        this.#displays.push({ type: "text", text: this.#textBuffer.replace(/\n$/, "") });
        this.#textBuffer = "";
    }
}
export { safeJsonStringify };
/** Pass a return value across the run boundary: structured-cloneable as-is, else JSON round-trip, else String. */
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
