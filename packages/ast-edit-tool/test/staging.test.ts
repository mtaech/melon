import { describe, expect, test } from "bun:test";
import { staging, StagingRegistry } from "../src/staging.js";

describe("StagingRegistry", () => {
	test("create/get/drop round-trips within a session", () => {
		const reg = new StagingRegistry();
		const entry = reg.create({ sessionId: "s1", ops: [{ pat: "foo($A)", out: "bar($A)" }], paths: ["x.js"], totalReplacements: 2, filesTouched: ["x.js"], perFileCount: { "x.js": 2 }, files: ["/x.js"] });
		expect(reg.get(entry.id, "s1")).toBe(entry);
		expect(reg.get(entry.id, "other-session")).toBeUndefined();
		expect(reg.drop(entry.id)).toBe(true);
		expect(reg.get(entry.id, "s1")).toBeUndefined();
	});

	test("evicts oldest beyond the cap", () => {
		const reg = new StagingRegistry();
		const ids: string[] = [];
		for (let i = 0; i < 60; i++) {
			ids.push(reg.create({ sessionId: "s", ops: [], paths: [], totalReplacements: 0, filesTouched: [], perFileCount: {}, files: [] }).id);
		}
		// 10 survivors: the cap is 50
		const alive = ids.filter((id) => reg.get(id, "s"));
		expect(alive.length).toBe(50);
	});
});