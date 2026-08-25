/**
 * Ad-hoc page check: render a URL in headless Chromium and report what is
 * actually on it. Runs entirely out of this repo — it does not touch the
 * user's dsh profile.
 */
import { acquireBrowser, releaseBrowser } from "../lib/browsers/registry.js";
import { acquireTab, releaseTab, runInTab } from "../lib/browsers/tab-supervisor.js";

const url = process.argv[2];
if (!url) {
	console.error("usage: node scripts/check-page.mjs <url>");
	process.exit(1);
}

process.env.PUPPETEER_EXECUTABLE_PATH ||= "/home/huang/.omp/puppeteer/chrome/linux-150.0.7871.24/chrome-linux64/chrome";

const config = {
	headless: true,
	relayEnabled: false,
	relayUrl: "http://127.0.0.1:9224",
	excludeWebP: false,
	installChrome: false,
};

const browser = await acquireBrowser(
	{ kind: "headless", headless: true },
	{ cwd: process.cwd(), viewport: { width: 1365, height: 900 }, config },
);

try {
	await acquireTab("check", browser, {
		url,
		waitUntil: "networkidle2",
		viewport: { width: 1365, height: 900 },
		timeoutMs: 60_000,
	});

	const result = await runInTab("check", {
		code: `
			// Let the SPA settle.
			await sleep(1200);
			const info = await tab.evaluate(\`(() => {
				const errs = [];
				const text = document.body ? document.body.innerText : '';
				const heads = [...document.querySelectorAll('h1,h2,h3')].map(e => e.tagName + ': ' + e.innerText.trim()).slice(0, 25);
				const btns = [...document.querySelectorAll('button,a[href],[role=button]')].map(e => (e.innerText || e.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(0, 30);
				const tables = document.querySelectorAll('table').length;
				const inputs = document.querySelectorAll('input,select,textarea').length;
				const app = document.querySelector('#app');
				return {
					title: document.title,
					url: location.href,
					appChildren: app ? app.children.length : -1,
					bodyTextLen: text.length,
					bodyText: text.slice(0, 2500),
					heads, btns, tables, inputs,
				};
			})()\`);
			info;
		`,
		timeoutMs: 45_000,
		cwd: process.cwd(),
	});

	const v = result.returnValue ?? {};
	console.log("=== PAGE ===");
	console.log("title      :", v.title);
	console.log("final url  :", v.url);
	console.log("#app kids  :", v.appChildren);
	console.log("body chars :", v.bodyTextLen);
	console.log("tables  :", v.tables, " form controls:", v.inputs);
	console.log("\n=== HEADINGS ===");
	console.log((v.heads ?? []).join("\n") || "(none)");
	console.log("\n=== CLICKABLES ===");
	console.log((v.btns ?? []).join(" | ") || "(none)");
	console.log("\n=== BODY TEXT ===");
	console.log(v.bodyText || "(empty)");

	await releaseTab("check", {});
} finally {
	await releaseBrowser(browser, { kill: true, timeoutMs: 20_000 });
}