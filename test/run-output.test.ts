import { describe, expect, test } from "bun:test";
import { RunOutput } from "../src/browsers/run-output.js";

describe("RunOutput", () => {
	test("text buffer flushes in order", () => {
		const out = new RunOutput();
		out.pushText("hello");
		out.pushText(" world");
		out.push({ type: "image", data: "AA==", mimeType: "image/webp", width: 1, height: 1 });
		out.pushText("after");
		out.push({ type: "text", text: "explicit" });
		const displays = out.finish();
		expect(displays[0]).toEqual({ type: "text", text: "hello world" });
		expect(displays[1]!.type).toBe("image");
		expect(displays[2]).toEqual({ type: "text", text: "after" });
		expect(displays[3]).toEqual({ type: "text", text: "explicit" });
	});

	test("finish() flushes a trailing buffer", () => {
		const out = new RunOutput();
		out.pushText("tail");
		const displays = out.finish();
		expect(displays).toHaveLength(1);
		expect(displays[0]).toEqual({ type: "text", text: "tail" });
	});

	test("json display renders as text", () => {
		const out = new RunOutput();
		out.pushDisplay({ type: "json", data: { a: 1 } });
		const displays = out.finish();
		expect(displays[0]!.type).toBe("text");
		expect(displays[0]!.text).toContain('"a"');
	});

	test("image display becomes ImageContent", () => {
		const out = new RunOutput();
		out.pushDisplay({ type: "image", data: "YQ==", mimeType: "image/png", width: 4, height: 4 });
		const [entry] = out.finish();
		expect(entry).toEqual({ type: "image", data: "YQ==", mimeType: "image/png", width: 4, height: 4 });
	});
});