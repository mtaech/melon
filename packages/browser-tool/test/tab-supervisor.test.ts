import { describe, expect, test } from "bun:test";
import { getOpenTabsForOwner, releaseTab } from "../src/browsers/tab-supervisor.js";

describe("releaseTab contract", () => {
	test("an unknown tab reports closed=false with no browser info", async () => {
		const result = await releaseTab("no-such-tab");
		expect(result).toEqual({ closed: false, kindTag: "", browserAlive: false });
	});

	test("getOpenTabsForOwner lists no tabs for an unknown owner", () => {
		expect(getOpenTabsForOwner(undefined)).toEqual([]);
		expect(getOpenTabsForOwner("no-such-owner")).toEqual([]);
	});
});
