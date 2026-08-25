/**
 * Relay server integration: start the HTTP+WS server, probe /json/version
 * (503 → 200 after the fake extension handshakes), and serve /json/list.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startRelayServer, type RelayServerHandle } from "../src/relay/server.js";
import { probeCdpStatus } from "../src/browsers/attach.js";
import { WebSocket } from "ws";
import type { ExtToRelayMessage } from "../src/relay/protocol.js";

let handle: RelayServerHandle;

beforeAll(async () => {
	handle = await startRelayServer({});
});

afterAll(async () => {
	await handle.close();
});

describe("relay server", () => {
	test("/json/version is 503 before the extension connects", async () => {
		const status = await probeCdpStatus(`${handle.url}/json/version`, { timeoutMs: 2000 });
		expect(status).toBe(503);
	});

	test("extension handshake flips /json/version to 200", async () => {
		const ws = new WebSocket(`${handle.url.replace("http", "ws")}/ext`, { origin: "chrome-extension://abc" });
		await new Promise<void>((resolve, reject) => {
			ws.on("open", () => resolve());
			ws.on("error", reject);
		});
		ws.send(
			JSON.stringify({
				t: "hello",
				userAgent: "UA",
				browserVersion: "Chrome/1",
				tabs: [{ tabId: 9, url: "https://x.test", title: "X", active: true, windowId: 1, pinned: false, groupId: -1 }],
				attachedTabIds: [],
			} satisfies ExtToRelayMessage),
		);
		// Wait a moment for the server to process.
		await Bun.sleep(150);
		const status = await probeCdpStatus(`${handle.url}/json/version`, { timeoutMs: 2000 });
		expect(status).toBe(200);
		const list = await probeJson(`${handle.url}/json/list`);
		expect(list.some((t: { url: string }) => t.url === "https://x.test")).toBe(true);
		ws.close();
	});

	test("/json/version serves the ws url for /cdp", async () => {
		const version = await probeJson(`${handle.url}/json/version`);
		expect(version).toBeTruthy();
		expect((version as { webSocketDebuggerUrl?: string }).webSocketDebuggerUrl).toContain("/cdp");
	});
});

async function probeJson(url: string): Promise<unknown> {
	const res = await fetch(url);
	return (await res.json()) as unknown;
}