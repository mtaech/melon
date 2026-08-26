import { describe, expect, test } from "bun:test";
import { valueSchemaSpecToJsonSchema, validateJsonSchemaValue } from "@deepseek-ai/dsh-tools";
import { outputSchema, type BrowserToolValue } from "../src/index.js";

/**
 * Optional keys in the declared output schema must be ABSENT keys, never own keys
 * holding `undefined`: dsh-tools validates the whole result against the lossless
 * JSON boundary, so `{ returnValue: undefined }` fails with
 * "must be a lossless JSON object" even though returnValue is optional.
 */
const compiled = valueSchemaSpecToJsonSchema(outputSchema);
const check = (value: BrowserToolValue): string[] => validateJsonSchemaValue(compiled, value);

describe("browser tool output contract", () => {
	test("a run cell with no reportable value omits the returnValue key", () => {
		const value: BrowserToolValue = { ok: true, name: "tab", output: [] };
		expect(Object.hasOwn(value, "returnValue")).toBe(false);
		expect(check(value)).toEqual([]);
	});

	test("an own returnValue key holding undefined is rejected by the validator", () => {
		const value = { ok: true, name: "tab", output: [], returnValue: undefined } as unknown as BrowserToolValue;
		expect(check(value)).not.toEqual([]);
	});

	test("json return values of every shape pass", () => {
		for (const returnValue of [null, 0, "", false, { a: [1, 2] }, [{ b: null }]]) {
			expect(check({ ok: true, name: "tab", output: [], returnValue })).toEqual([]);
		}
	});

	test("open results omit url when neither the tab nor the args supply one", () => {
		expect(check({ ok: true, name: "tab", created: true, message: "Opened tab" })).toEqual([]);
		expect(check({ ok: true, name: "tab", created: true, url: "about:blank", message: "Opened tab" })).toEqual([]);
	});

	test("image output entries omit dest when the capture was not saved", () => {
		const image = { attachmentId: "a1", mediaType: "image/png", bytes: 10, width: 2, height: 2 };
		expect(check({ ok: true, name: "tab", output: [{ kind: "image", image }] })).toEqual([]);
		expect(check({ ok: true, name: "tab", output: [{ kind: "image", image, dest: "/tmp/a.png" }] })).toEqual([]);
	});
});
