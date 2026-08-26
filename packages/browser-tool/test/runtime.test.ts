import { describe, expect, test } from "bun:test";
import { injectFinalExpression } from "../src/browsers/final-expr.js";
import { runJsCode, type RuntimeHooks } from "../src/browsers/runtime.js";

const emptyHooks: RuntimeHooks = {
	onText() {},
	onDisplay() {},
};

async function run(code: string): Promise<unknown> {
	return runJsCode(code, { page: undefined, browser: undefined, tab: undefined, assert: () => {}, wait: async () => {}, sleep: async () => {} }, { name: "test", hooks: emptyHooks });
}

describe("injectFinalExpression", () => {
	test("captures a trailing expression", () => {
		const wrapped = injectFinalExpression("const a = 1;\n({ x: a });");
		expect(wrapped.returned).toBe(true);
		expect(wrapped.source).toContain("await __setFinalExpr(({ x: a }));");
		expect(wrapped.source).toContain("const a = 1;");
	});

	test("captures an explicit return", () => {
		const wrapped = injectFinalExpression("async function f() {}\nreturn 42;");
		expect(wrapped.returned).toBe(true);
		expect(wrapped.source).toContain("await __setFinalExpr((42));");
	});

	test("leaves non-expression endings untouched", () => {
		const wrapped = injectFinalExpression("const a = 1;");
		expect(wrapped.returned).toBe(false);
		expect(wrapped.source).toBe("const a = 1;");
	});

	test("skips trailing empty statements", () => {
		const wrapped = injectFinalExpression("1 + 1;;;");
		expect(wrapped.returned).toBe(true);
	});

	test("tolerates unparseable input", () => {
		const wrapped = injectFinalExpression("this is not js ?!?");
		expect(wrapped.returned).toBe(false);
	});
});

describe("runJsCode", () => {
	test("trailing expression becomes the return value", async () => {
		await expect(run("const title = 'x';\ntitle + '!'")).resolves.toBe("x!");
	});

	test("explicit return wins", async () => {
		await expect(run("await Promise.resolve(1);\nreturn 'r'")).resolves.toBe("r");
	});

	test("async trailing expression is awaited", async () => {
		await expect(run("await Promise.resolve(7)")).resolves.toBe(7);
	});

	test("statement-only cells resolve to undefined", async () => {
		const value = await run("const a = 1; let b = 2;");
		expect(value).toBeUndefined();
	});

	test("declarations stay visible to later statements", async () => {
		await expect(run("const n = 3;\nconst doubled = n * 2;\ndoubled")).resolves.toBe(6);
	});

	test("unsupported helpers produce a clear error", async () => {
		await expect(run("tool('x')")).rejects.toThrow(/not available in dsh-browser-tool/);
	});
});