import { describe, expect, test } from "bun:test";
import { parseAriaRefSelector, assertSelectorString } from "../src/browsers/aria/aria-snapshot.js";
import { ToolError } from "../src/errors.js";

describe("parseAriaRefSelector", () => {
	test("explicit prefixes", () => {
		expect(parseAriaRefSelector("aria-ref=e5")).toBe("e5");
		expect(parseAriaRefSelector("aria-ref/e5")).toBe("e5");
		expect(parseAriaRefSelector("ariaref/e5")).toBe("e5");
	});
	test("bare ids and @-prefixed", () => {
		expect(parseAriaRefSelector("e5")).toBe("e5");
		expect(parseAriaRefSelector("@e5")).toBe("e5");
	});
	test("non-ref strings are null", () => {
		expect(parseAriaRefSelector("body")).toBeNull();
		expect(parseAriaRefSelector("#main")).toBeNull();
		expect(parseAriaRefSelector("aria/e5")).toBeNull();
		expect(parseAriaRefSelector("aria-ref=xyz")).toBeNull();
	});
});

describe("assertSelectorString", () => {
	test("accepts strings", () => {
		expect(() => assertSelectorString("div")).not.toThrow();
	});
	test("rejects handles and promises with a named error", () => {
		expect(() => assertSelectorString({} as string)).toThrow(ToolError);
		expect(() => assertSelectorString({ then() {} } as string)).toThrow(/Promise/);
		expect(() => assertSelectorString(42 as string)).toThrow(/number/);
	});
});

// Re-exported through tab-worker; verify the prefix mapping here via the function.
const { normalizeSelector } = await import("../src/browsers/tab-worker.js");

describe("normalizeSelector", () => {
	test("legacy p- prefixes remap", () => {
		expect(normalizeSelector("p-text/Allow all")).toBe("text/Allow all");
		expect(normalizeSelector("p-xpath//html/body")).toBe("xpath//html/body");
		expect(normalizeSelector("p-pierce/#shadow")).toBe("pierce/#shadow");
	});
	test("p-aria extracts the name", () => {
		expect(normalizeSelector('p-aria/[name="Save"]')).toBe("aria/Save");
		expect(normalizeSelector("p-aria/[name='Save']")).toBe("aria/Save");
		expect(normalizeSelector("p-aria/[name=Save]")).toBe("aria/Save");
	});
	test("playwright-only selectors are rejected", () => {
		expect(() => normalizeSelector("button:has-text('x')")).toThrow(/Playwright-only/);
		expect(() => normalizeSelector("button:visible")).toThrow(/Playwright-only/);
	});
	test("css passes through", () => {
		expect(normalizeSelector("#a .b")).toBe("#a .b");
	});
});