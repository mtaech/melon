/**
 * End-to-end smoke: launch a real headless Chromium, acquire a tab, run code
 * through the tab worker, and tear everything down. Run with `npm run smoke`
 * after a build (loads `lib/`, so it exercises the compiled artifact).
 */
import { acquireBrowser, releaseBrowser, getBrowsersMapForTest } from "../lib/browsers/registry.js";
import { acquireTab, releaseTab, runInTab } from "../lib/browsers/tab-supervisor.js";

const SKIP = process.env.DSH_BROWSER_SKIP_SMOKE === "1";

function fail(message) {
	console.error(`[smoke] FAIL: ${message}`);
	process.exitCode = 1;
}

if (SKIP) {
	console.log("[smoke] skipped (DSH_BROWSER_SKIP_SMOKE=1)");
} else {
	const { defaultCandidates } = await import("../lib/browsers/launch.js").catch(() => ({ defaultCandidates: [] }));
	void defaultCandidates;

	const browserPath =
		process.env.PUPPETEER_EXECUTABLE_PATH ||
		process.env.DSH_BROWSER_EXECUTABLE ||
		"/home/huang/.omp/puppeteer/chrome/linux-150.0.7871.24/chrome-linux64/chrome";
	const exists = await import("node:fs").then(fs => fs.existsSync(browserPath));
	if (!exists) {
		fail(`no chromium binary; set PUPPETEER_EXECUTABLE_PATH (checked ${browserPath})`);
	} else {
		process.env.PUPPETEER_EXECUTABLE_PATH = browserPath;
		const ac = new AbortController();
		const config = {
			headless: true,
			relayEnabled: false,
			relayUrl: "http://127.0.0.1:9224",
			screenshotDir: undefined,
			excludeWebP: false,
			installChrome: false,
		};

		console.log(`[smoke] launching headless chromium (${browserPath})`);
		const browser = await acquireBrowser({ kind: "headless", headless: true }, { cwd: process.cwd(), viewport: { width: 1024, height: 768 }, config, signal: ac.signal });
		try {
			const html = `<html><head><title>SmokeOK</title></head><body><h1>Hello World</h1></body></html>`;
			const { tab, created } = await acquireTab("smoke-tab", browser, {
				url: `data:text/html,${encodeURIComponent(html)}`,
				waitUntil: "load",
				viewport: { width: 1024, height: 768 },
				timeoutMs: 60_000,
				signal: ac.signal,
			});
			console.log(`[smoke] tab acquired (created=${created}, worker=${tab.workerMode ?? "?"})`);
			// actionOpen drops its transient acquireBrowser hold once the tab owns a ref;
			// mirror that so closing the tab below can dispose the browser.
			await releaseBrowser(browser, { kill: false });

			const result = await runInTab("smoke-tab", {
				code: [
					`const title = await tab.evaluate("document.title");`,
					`const h1 = await tab.evaluate("document.querySelector('h1')?.textContent ?? ''");`,
					`({ title, h1 });`,
				].join("\n"),
				timeoutMs: 30_000,
				cwd: process.cwd(),
			});
			console.log(`[smoke] run returnValue=${JSON.stringify(result.returnValue)} displays=${result.displays.length}`);
			const rv = result.returnValue;
			if (rv && rv.title === "SmokeOK" && rv.h1 === "Hello World") {
				console.log("[smoke] OK: evaluate round-trip through tab worker");
			} else {
				fail(`unexpected returnValue ${JSON.stringify(rv)}`);
			}

			// Second cell: print stream + aria snapshot observation pipeline.
			const obs = await runInTab("smoke-tab", {
				code: [
					`print("h1 is: " + (await tab.evaluate("document.querySelector('h1')?.textContent ?? ''")));`,
					`const snap = await tab.observe();`,
					`"observed:" + snap.elements.length;`,
				].join("\n"),
				timeoutMs: 30_000,
				cwd: process.cwd(),
			});
			const text = obs.displays.map(d => (d.type === "text" ? d.text : "")).join("");
			console.log(`[smoke] observe returnValue=${JSON.stringify(obs.returnValue)} displays=${JSON.stringify(text.slice(0, 80))}`);
			if (text.includes("h1 is: Hello World") && String(obs.returnValue).startsWith("observed:")) {
				console.log("[smoke] OK: print stream + aria observation");
			} else {
				fail(`unexpected observe result ${JSON.stringify(obs.returnValue)}`);
			}

			await releaseTab("smoke-tab", {});
			if (browser.refCount !== 0 || getBrowsersMapForTest().size !== 0) {
				fail(`owned browser not disposed after close (refCount=${browser.refCount}, browsers=${getBrowsersMapForTest().size})`);
			} else {
				console.log("[smoke] OK: closing the last tab disposed the owned browser");
			}
		} finally {
			// Tolerate an already-disposed handle (close reached refCount 0 above).
			await releaseBrowser(browser, { kill: true, timeoutMs: 20_000 }).catch(() => undefined);
			console.log("[smoke] browser released");
		}
	}
}

if (process.exitCode) {
	console.error("[smoke] FAILED");
	process.exit(1);
}
console.log("[smoke] done");