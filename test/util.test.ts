import { describe, expect, test } from "bun:test";
import { cloneSafe, parseFlag, safeJsonStringify, uid, untilAborted, withTimeout } from "../src/util.js";
import { ToolAbortError } from "../src/errors.js";

describe("parseFlag", () => {
	test("fallback when unset", () => {
		expect(parseFlag(undefined, true)).toBe(true);
		expect(parseFlag(undefined, false)).toBe(false);
	});
	test("truthy values", () => {
		expect(parseFlag("1", false)).toBe(true);
		expect(parseFlag("true", false)).toBe(true);
		expect(parseFlag("TRUE", false)).toBe(true);
	});
	test("blank counts as fallback", () => {
		expect(parseFlag("", true)).toBe(true);
	});
	test("other values are false", () => {
		expect(parseFlag("0", true)).toBe(false);
		expect(parseFlag("no", true)).toBe(false);
		expect(parseFlag("2", true)).toBe(false);
	});
});

describe("uid", () => {
	test("monotonic within a millisecond", () => {
		const a = uid.next();
		const b = uid.next();
		expect(a).not.toBe(b);
	});
});

describe("cloneSafe", () => {
	test("plain JSON passes through", () => {
		const value = { a: [1, 2, { b: "x" }] };
		expect(cloneSafe(value)).toBe(value);
	});
	test("non-cloneable values degrade via JSON round-trip", () => {
		// structuredClone handles cycles; functions drop through the JSON path.
		const out = cloneSafe({ fn: () => 1, n: 2 } as unknown);
		expect(typeof out).toBe("object");
		expect((out as { n?: number }).n).toBe(2);
		expect("fn" in (out as object)).toBe(false);
	});
	test("undefined stays undefined", () => {
		expect(cloneSafe(undefined)).toBeUndefined();
	});
});

describe("safeJsonStringify", () => {
	test("never throws", () => {
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(() => safeJsonStringify(cyclic)).not.toThrow();
	});
});

describe("withTimeout", () => {
	test("resolves before timeout", async () => {
		await expect(withTimeout(Promise.resolve(42), 200, "too slow")).resolves.toBe(42);
	});
	test("rejects on timeout", async () => {
		const slow = new Promise<never>(() => {});
		await expect(withTimeout(slow, 30, "too slow")).rejects.toThrow("too slow");
	});
	test("signal abort rejects with abort reason", async () => {
		const ac = new AbortController();
		const slow = new Promise<never>(() => {});
		const pending = withTimeout(slow, 500, "too slow", ac.signal);
		ac.abort(new ToolAbortError("stopped"));
		await expect(pending).rejects.toThrow("stopped");
	});
});

describe("untilAborted", () => {
	test("passes the promise through without a signal", async () => {
		await expect(untilAborted(undefined, Promise.resolve(7))).resolves.toBe(7);
	});
	test("aborted signal rejects immediately", async () => {
		const ac = new AbortController();
		ac.abort();
		await expect(untilAborted(ac.signal, Promise.resolve(1))).rejects.toBeInstanceOf(ToolAbortError);
	});
	test("abort mid-flight rejects", async () => {
		const ac = new AbortController();
		const pending = untilAborted(ac.signal, new Promise<number>(resolve => setTimeout(() => resolve(1), 200)));
		setTimeout(() => ac.abort(), 10);
		await expect(pending).rejects.toBeInstanceOf(ToolAbortError);
	});
});