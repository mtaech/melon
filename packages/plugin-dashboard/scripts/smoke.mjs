/**
 * Smoke test: build lib/ first (npm run build), then
 *  1. boot the host plugin against a fixture profile with a fake registry and
 *     drive the route handler end-to-end,
 *  2. verify the client bundle has the ModuleLoader factory shape,
 *  3. run the real web profile through the host plugin (network-tolerant).
 */
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { apply } = await import(path.resolve(process.cwd(), "lib/host.js"));

let failures = 0;
function check(name, condition, detail = "") {
	if (condition) {
		console.log(`  PASS ${name}`);
	} else {
		failures += 1;
		console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
	}
}

// ── 1. fixture profile through the real host route path ──
const root = await mkdtemp(path.join(os.tmpdir(), "dash-smoke-"));
const prof = path.join(root, "web");
await mkdir(path.join(prof, "node_modules", "fx-npm"), { recursive: true });
await mkdir(path.join(prof, "node_modules", "fx-git"), { recursive: true });
await writeFile(path.join(prof, "package.json"), JSON.stringify({
	name: "web",
	dependencies: { "fx-npm": "^1.0.0", "fx-git": "github:example/fx-git", "@deepseek-ai/dsh-base": "^1.0.0" },
	dsh: { profile: { bundles: ["fx-npm", "fx-git", "@deepseek-ai/dsh-base"] } },
}, null, 2) + "\n");
await writeFile(path.join(prof, "node_modules", "fx-npm", "package.json"), JSON.stringify({ version: "1.0.0" }));
await writeFile(path.join(prof, "node_modules", "fx-git", "package.json"), JSON.stringify({ version: "0.1.0" }));
await writeFile(path.join(prof, "pnpm-lock.yaml"), `lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      fx-npm:
        specifier: ^1.0.0
        version: 1.0.0
      fx-git:
        specifier: github:example/fx-git
        version: https://codeload.github.com/example/fx-git/tar.gz/1111111111111111111111111111111111111111

packages: {}
`);

function fakeRegistry() {
	return {
		async latestNpm(name) {
			if (name === "fx-npm") return { kind: "npm", latest: "1.1.0", error: null };
			return { kind: "npm", latest: null, error: "not found" };
		},
		async latestGit() {
			return { kind: "git", latestTag: "v0.2.0", latestTagCommit: "a".repeat(40), headSha: "a".repeat(40), error: null };
		},
	};
}

function fakeReq(method, url, body) {
	const payload = body === undefined ? "" : JSON.stringify(body);
	return {
		method,
		url,
		on(event, cb) {
			if (event === "data" && payload) cb(Buffer.from(payload));
			if (event === "end") setImmediate(() => cb(Buffer.alloc(0)));
		},
	};
}
function fakeRes() {
	let resolve;
	const promise = new Promise((r) => (resolve = r));
	let status = 200;
	const res = {
		writeHead(code) { status = code; },
		end(payload) { setImmediate(() => resolve({ status, body: payload ? JSON.parse(payload) : null })); },
	};
	return { promise, res };
}

let route;
const fakeSubprocess = {
	spawn: () => ({
		done: Promise.resolve({ exitCode: 0, signal: null }),
		collected: {
			stdout: { readFrom: () => ({ text: "", nextOffset: 0, lossy: false }) },
			stderr: { readFrom: () => ({ text: "", nextOffset: 0, lossy: false }) },
		},
	}),
};
const ctx = { webServer: { register: (r) => { route = r; return () => undefined; } }, subprocess: fakeSubprocess };
const disposer = apply(ctx, { registry: fakeRegistry(), profileDir: prof });
check("plugin registers prefix route", route && route.kind === "prefix" && route.path === "/plugins/dsh-plugin-dashboard/api");
check("plugin returns disposer", typeof disposer === "function");

{
	const { promise, res } = fakeRes();
	await route.handler(fakeReq("GET", "/plugins/dsh-plugin-dashboard/api/list"), res);
	const { status, body } = await promise;
	const list = body.plugins || [];
	const npm = list.find((p) => p.name === "fx-npm");
	const git = list.find((p) => p.name === "fx-git");
	check("list 200 with third-party entries only", status === 200 && list.length === 2 && !list.some((p) => p.isCore), JSON.stringify(body).slice(0, 150));
	check("npm entry classified", npm && npm.source === "npm" && npm.installedVersion === "1.0.0" && npm.latest.label === "1.1.0" && npm.upgradeable, JSON.stringify(npm));
	check("git entry classified", git && git.source === "git" && git.installedCommit === "1".repeat(40) && git.latest.label === "v0.2.0", JSON.stringify(git));
}
{
	const { promise, res } = fakeRes();
	await route.handler(fakeReq("POST", "/plugins/dsh-plugin-dashboard/api/upgrade", { name: "fx-npm" }), res);
	const { status, body } = await promise;
	check("plan newSpecifier ^1.1.0", status === 200 && body.plan.newSpecifier === "^1.1.0" && body.plan.wouldChange, JSON.stringify(body));
}
{
	const { promise, res } = fakeRes();
	await route.handler(fakeReq("POST", "/plugins/dsh-plugin-dashboard/api/upgrade", { name: "ghost" }), res);
	check("ghost rejected 400", (await promise).status === 400);
}
{
	const { promise, res } = fakeRes();
	await route.handler(fakeReq("POST", "/plugins/dsh-plugin-dashboard/api/uninstall", { name: "fx-npm" }), res);
	const { status, body } = await promise;
	check("uninstall plan", status === 200 && body.plan.wouldRemove === true && body.plan.inDependencies && body.plan.inBundles, JSON.stringify(body));
}
{
	const { promise, res } = fakeRes();
	await route.handler(fakeReq("POST", "/plugins/dsh-plugin-dashboard/api/uninstall", { name: "@deepseek-ai/dsh-base" }), res);
	const { body } = await promise;
	check("core uninstall refused", String(body.plan.error).includes("core"), JSON.stringify(body));
}
await rm(root, { recursive: true, force: true });

// ── 2. client bundle factory shape ──
{
	const client = await import("node:fs/promises").then((fs) => fs.readFile(path.resolve(process.cwd(), "lib/client.cjs"), "utf8"));
	check("client.cjs is a ModuleLoader factory", client.includes('window.__ModuleLoader__.load({') && client.includes('factory: (require) =>') && client.includes('"dsh-plugin-dashboard"'), "");
	check("client requires react from the shell", client.includes('require("react")'), "");
	check("client registers the plugin-versions tab", client.includes('plugin-versions'), "");
	// ModuleLoader contract: factory declares module/exports, returns module.exports
	check("client factory returns exports", client.includes('return module.exports;'), "");
	check("client exports inject", client.includes('inject: () => inject') && client.includes('var inject = ["slots"]'), "");
}

// ── 3. real web profile through the host plugin (network tolerant) ──
{
	console.log("real web profile (network)…");
	let realRoute;
	const ctx2 = { webServer: { register: (r) => { realRoute = r; return () => undefined; } }, subprocess: fakeSubprocess };
	apply(ctx2, { profileDir: path.join(os.homedir(), ".dsh", "profiles", "web") });
	const { promise, res } = fakeRes();
	await realRoute.handler(fakeReq("GET", "/plugins/dsh-plugin-dashboard/api/list?force=1"), res);
	const { status, body } = await promise;
	const list = body.plugins || [];
	check("real profile list ok", status === 200 && list.length > 5, JSON.stringify(body).slice(0, 150));
	const bt = list.find((p) => p.name === "dsh-browser-tool");
	check("dsh-browser-tool present", !!bt, JSON.stringify(list.map((p) => p.name)));
	check("browser-tool git source + commit", bt && bt.source === "git" && /^[0-9a-f]{40}$/.test(bt.installedCommit || ""), JSON.stringify(bt));
	console.log("  statuses:", list.map((p) => `${p.name}=${p.status}`).join(", "));
}

disposer();
console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);