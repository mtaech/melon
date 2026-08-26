import { describe, expect, test } from "bun:test";
import { parseSemver, compareSemver, formatSemver, extractTagVersion } from "../src/semver.js";

describe("semver", () => {
	test("parses and formats", () => {
		expect(formatSemver(parseSemver("1.2.3")!)).toBe("1.2.3");
		expect(formatSemver(parseSemver("v2.0.0-rc.1")!)).toBe("2.0.0-rc.1");
		expect(parseSemver("not-a-version")).toBeNull();
	});

	test("compares release > prerelease", () => {
		expect(compareSemver(parseSemver("1.0.0")!, parseSemver("1.0.0-rc.1")!)).toBe(1);
		expect(compareSemver(parseSemver("1.0.0-rc.1")!, parseSemver("1.0.0")!)).toBe(-1);
		expect(compareSemver(parseSemver("1.0.0")!, parseSemver("1.0.0")!)).toBe(0);
	});

	test("compares prerelease identifiers", () => {
		expect(compareSemver(parseSemver("1.0.0-rc.2")!, parseSemver("1.0.0-rc.10")!)).toBe(-1);
		expect(compareSemver(parseSemver("1.0.0-alpha")!, parseSemver("1.0.0-beta")!)).toBe(-1);
		expect(compareSemver(parseSemver("1.0.0-alpha.1")!, parseSemver("1.0.0-alpha")!)).toBe(1);
	});

	test("extracts version from git tags", () => {
		expect(extractTagVersion("v1.2.3")?.major).toBe(1);
		expect(extractTagVersion("1.2.3-rc.1")?.prerelease).toBe("rc.1");
		expect(extractTagVersion("release-2024")).toBeNull();
	});
});