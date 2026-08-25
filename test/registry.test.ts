import { describe, expect, test } from "bun:test";
import { Registry } from "../src/registry.js";

function fakeFetch(routes: Record<string, unknown>): typeof fetch {
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const body = routes[url];
		return new Response(typeof body === "string" ? body : JSON.stringify(body ?? { error: "not found" }), {
			status: body === undefined ? 404 : 200,
			headers: { "content-type": "application/json" },
		});
	}) as typeof fetch;
}

describe("Registry — npm", () => {
	test("resolves latest from the registry /latest endpoint", async () => {
		const reg = new Registry({ fetchFn: fakeFetch({ "https://registry.npmjs.org/dsh-x/latest": { name: "dsh-x", version: "1.2.3" } }) });
		const info = await reg.latestNpm("dsh-x");
		expect(info.latest).toBe("1.2.3");
		expect(info.error).toBeNull();
	});

	test("encodes scoped names", async () => {
		let hit = "";
		const reg = new Registry({
			fetchFn: (async (input: RequestInfo | URL) => {
				hit = String(input);
				return new Response(JSON.stringify({ version: "0.3.2" }), { status: 200 });
			}) as typeof fetch,
		});
		await reg.latestNpm("@linxin666/dsh-liangshen");
		expect(hit).toBe("https://registry.npmjs.org/@linxin666%2Fdsh-liangshen/latest");
	});

	test("reports missing packages", async () => {
		const reg = new Registry({ fetchFn: fakeFetch({}) });
		const info = await reg.latestNpm("ghost-pkg");
		expect(info.latest).toBeNull();
		expect(info.error).toContain("404");
	});
});

describe("Registry — git", () => {
	const tags = [
		{ name: "v0.1.0", commit: { sha: "c1".repeat(20) } },
		{ name: "v0.2.0-rc.1", commit: { sha: "c2".repeat(20) } },
		{ name: "v0.1.2", commit: { sha: "c3".repeat(20) } },
		{ name: "not-a-version", commit: { sha: "c4".repeat(20) } },
	];
	const head = { sha: "c5".repeat(20) };

	test("picks the highest semver tag with its commit", async () => {
		const reg = new Registry({
			fetchFn: fakeFetch({
				"https://api.github.com/repos/mtaech/dsh-x/tags": tags,
				"https://api.github.com/repos/mtaech/dsh-x/commits/HEAD": head,
			}),
		});
		const info = await reg.latestGit("mtaech", "dsh-x");
		expect(info.latestTag).toBe("v0.2.0-rc.1"); // 0.2.0-rc.1 > 0.1.2 (major wins)
		expect(info.latestTagCommit).toBe("c2".repeat(20));
		expect(info.headSha).toBe("c5".repeat(20));
		expect(info.error).toBeNull();
	});

	test("no tags falls back to HEAD", async () => {
		const reg = new Registry({
			fetchFn: fakeFetch({
				"https://api.github.com/repos/mtaech/dsh-x/tags": [],
				"https://api.github.com/repos/mtaech/dsh-x/commits/HEAD": head,
			}),
		});
		const info = await reg.latestGit("mtaech", "dsh-x");
		expect(info.latestTag).toBeNull();
		expect(info.latestTagCommit).toBeNull();
		expect(info.headSha).toBe("c5".repeat(20));
	});

	test("rate-limited repos degrade with the status reason", async () => {
		const reg = new Registry({ fetchFn: fakeFetch({}) });
		const info = await reg.latestGit("private", "repo");
		expect(info.error).toContain("github 404");
		expect(info.headSha).toBeNull();
	});
});

describe("Registry — cache", () => {
	test("caches npm lookups within TTL", async () => {
		let calls = 0;
		const reg = new Registry({
			fetchFn: (async (input: RequestInfo | URL) => {
				calls += 1;
				return new Response(JSON.stringify({ version: `1.0.${calls}` }), { status: 200 });
			}) as typeof fetch,
		});
		await reg.latestNpm("dsh-x");
		await reg.latestNpm("dsh-x");
		expect(calls).toBe(1);
		reg.clearCache();
		await reg.latestNpm("dsh-x");
		expect(calls).toBe(2);
	});
});