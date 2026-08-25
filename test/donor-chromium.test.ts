import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { adoptDonorChromium, donorCacheRoots, findDonorChromium } from "../src/browsers/donor-chromium.js";

// Real tags from @puppeteer/browsers' detectBrowserPlatform(): "linux", not "linux64".
const PLATFORM = process.platform === "win32" ? "win64" : process.platform === "darwin" ? "mac" : "linux";
const BINARY = process.platform === "win32" ? "chrome.exe" : "chrome";
const CHROME_DIR = process.platform === "win32" ? "chrome-win64" : "chrome-linux64";

let tmp: string;

/** Build a fake `@puppeteer/browsers` cache holding the given build ids. */
function makeCache(name: string, buildIds: string[]): string {
	const root = path.join(tmp, name);
	for (const buildId of buildIds) {
		const dir = path.join(root, "chrome", `${PLATFORM}-${buildId}`, CHROME_DIR);
		fs.mkdirSync(dir, { recursive: true });
		const bin = path.join(dir, BINARY);
		fs.writeFileSync(bin, "#!/bin/sh\necho fake chrome\n");
		fs.chmodSync(bin, 0o755);
		// A sibling file proves the whole build dir is copied, not just the binary.
		fs.writeFileSync(path.join(dir, "icudtl.dat"), "payload");
	}
	return root;
}

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "donor-test-"));
});

afterEach(() => {
	fs.rmSync(tmp, { recursive: true, force: true });
});

describe("donorCacheRoots", () => {
	test("prefers the explicit override, then omp, then puppeteer", () => {
		const roots = donorCacheRoots({ DSH_BROWSER_DONOR_CACHE: "/explicit" } as NodeJS.ProcessEnv);
		expect(roots[0]).toBe("/explicit");
		expect(roots.some(r => r.includes(path.join(".omp", "puppeteer")))).toBe(true);
		expect(roots.some(r => r.includes(path.join(".cache", "puppeteer")))).toBe(true);
	});

	test("skips blanks and de-duplicates", () => {
		const dup = path.join(os.homedir(), ".omp", "puppeteer");
		const roots = donorCacheRoots({ DSH_BROWSER_DONOR_CACHE: dup, PUPPETEER_CACHE_DIR: "" } as NodeJS.ProcessEnv);
		expect(roots.filter(r => r === dup)).toHaveLength(1);
		expect(roots.every(r => r.length > 0)).toBe(true);
	});
});

describe("findDonorChromium", () => {
	test("returns nothing when no donor cache exists", () => {
		expect(findDonorChromium(PLATFORM, "150.0.1.1", [path.join(tmp, "absent")])).toBeUndefined();
	});

	test("finds an exact build match", () => {
		const root = makeCache("omp", ["150.0.7871.24"]);
		const found = findDonorChromium(PLATFORM, "150.0.7871.24", [root]);
		expect(found?.buildId).toBe("150.0.7871.24");
		expect(fs.existsSync(found!.executablePath)).toBe(true);
	});

	test("prefers the exact match over a newer build", () => {
		const root = makeCache("omp", ["150.0.7871.24", "151.0.8000.1"]);
		expect(findDonorChromium(PLATFORM, "150.0.7871.24", [root])?.buildId).toBe("150.0.7871.24");
	});

	test("falls back to the newest build when the wanted one is absent", () => {
		const root = makeCache("omp", ["149.0.1.1", "151.0.8000.1", "150.0.7871.24"]);
		expect(findDonorChromium(PLATFORM, "152.0.0.0", [root])?.buildId).toBe("151.0.8000.1");
	});

	test("compares build ids numerically, not lexically", () => {
		// "9" > "10" as strings; the newest here is 150.0.9.0.
		const root = makeCache("omp", ["150.0.9.0", "150.0.10.0"]);
		expect(findDonorChromium(PLATFORM, undefined, [root])?.buildId).toBe("150.0.10.0");
	});

	test("honours donor priority order", () => {
		const first = makeCache("first", ["150.0.1.1"]);
		const second = makeCache("second", ["150.0.1.1"]);
		expect(findDonorChromium(PLATFORM, "150.0.1.1", [first, second])?.cacheRoot).toBe(first);
	});

	test("ignores directories for another platform", () => {
		const root = path.join(tmp, "other");
		const dir = path.join(root, "chrome", "someother-150.0.1.1", CHROME_DIR);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, BINARY), "x");
		expect(findDonorChromium(PLATFORM, "150.0.1.1", [root])).toBeUndefined();
	});

	test("ignores a build directory with no binary in it", () => {
		const root = path.join(tmp, "empty");
		fs.mkdirSync(path.join(root, "chrome", `${PLATFORM}-150.0.1.1`, CHROME_DIR), { recursive: true });
		expect(findDonorChromium(PLATFORM, "150.0.1.1", [root])).toBeUndefined();
	});
});

describe("adoptDonorChromium", () => {
	test("copies the whole build dir and keeps it executable", () => {
		const donorRoot = makeCache("omp", ["150.0.7871.24"]);
		const donor = findDonorChromium(PLATFORM, "150.0.7871.24", [donorRoot])!;
		const ours = path.join(tmp, "ourcache");

		const copied = adoptDonorChromium(donor, ours);

		expect(copied.startsWith(ours)).toBe(true);
		expect(fs.existsSync(copied)).toBe(true);
		// Sibling payload came along, so this is a full build, not just the binary.
		expect(fs.existsSync(path.join(path.dirname(copied), "icudtl.dat"))).toBe(true);
		if (process.platform !== "win32") {
			expect(fs.statSync(copied).mode & 0o111).toBeGreaterThan(0);
		}
	});

	test("files the copy under the donor's real build id", () => {
		const donorRoot = makeCache("omp", ["149.0.5.5"]);
		const donor = findDonorChromium(PLATFORM, "152.0.0.0", [donorRoot])!;
		const copied = adoptDonorChromium(donor, path.join(tmp, "ourcache"));
		expect(copied).toContain(`${PLATFORM}-149.0.5.5`);
	});

	test("is idempotent and does not re-copy", () => {
		const donorRoot = makeCache("omp", ["150.0.1.1"]);
		const donor = findDonorChromium(PLATFORM, "150.0.1.1", [donorRoot])!;
		const ours = path.join(tmp, "ourcache");
		const first = adoptDonorChromium(donor, ours);
		fs.writeFileSync(first, "marker");
		const second = adoptDonorChromium(donor, ours);
		expect(second).toBe(first);
		// Untouched: the existing copy was reused rather than overwritten.
		expect(fs.readFileSync(second, "utf8")).toBe("marker");
	});

	test("leaves no .partial dir behind on success", () => {
		const donorRoot = makeCache("omp", ["150.0.1.1"]);
		const donor = findDonorChromium(PLATFORM, "150.0.1.1", [donorRoot])!;
		const ours = path.join(tmp, "ourcache");
		adoptDonorChromium(donor, ours);
		const leftovers = fs.readdirSync(path.join(ours, "chrome")).filter(d => d.includes("partial"));
		expect(leftovers).toEqual([]);
	});

	test("falls back to the donor path when the copy cannot be written", () => {
		const donorRoot = makeCache("omp", ["150.0.1.1"]);
		const donor = findDonorChromium(PLATFORM, "150.0.1.1", [donorRoot])!;
		// A file where the cache dir should go makes mkdir/rename fail.
		const blocked = path.join(tmp, "blocked");
		fs.writeFileSync(blocked, "not a directory");
		expect(adoptDonorChromium(donor, blocked)).toBe(donor.executablePath);
	});
});
