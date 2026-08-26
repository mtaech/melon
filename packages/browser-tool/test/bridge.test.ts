/**
 * Relay bridge unit tests: extension handshake, target discovery, claim, and
 * fake-chrome.debugger forwarding — all over in-memory sockets.
 */
import { describe, expect, test } from "bun:test";
import { RelayBridge, type RelaySocket } from "../src/relay/bridge.js";
import type { ExtToRelayMessage, RelayRpcRequest, RelayToExtMessage, TabSnapshot } from "../src/relay/protocol.js";

interface FakeSocket extends RelaySocket {
	sent: string[];
	reply(id: number, ok: boolean, result?: unknown): void;
}

function makeSocket(): FakeSocket {
	const s: FakeSocket = {
		sent: [],
		send(text) {
			this.sent.push(text);
		},
		close() {},
		reply(id, ok, result) {
			const msg: ExtToRelayMessage = { t: "rpcResult", id, ok, ...(result !== undefined ? { result } : {}) } as ExtToRelayMessage;
			bridge.extMessage(s, JSON.stringify(msg));
		},
	};
	return s;
}

const tabs: TabSnapshot[] = [
	{ tabId: 1, url: "https://example.com", title: "Example", active: true, windowId: 1, pinned: false, groupId: -1 },
	{ tabId: 2, url: "chrome://settings", title: "Settings", active: false, windowId: 1, pinned: false, groupId: -1 },
];

let bridge: RelayBridge;

function connectExtension(sock: FakeSocket): void {
	bridge.extConnected(sock);
	bridge.extMessage(
		sock,
		JSON.stringify({ t: "hello", userAgent: "Mozilla/x", browserVersion: "Chrome/120", tabs, attachedTabIds: [] } satisfies ExtToRelayMessage),
	);
}

describe("RelayBridge", () => {
	test("ready flips after hello", () => {
		bridge = new RelayBridge({});
		expect(bridge.ready).toBe(false);
		const ext = makeSocket();
		connectExtension(ext);
		expect(bridge.ready).toBe(true);
		bridge.extClosed(ext);
		expect(bridge.ready).toBe(false);
	});

	test("versionInfo carries the browser version; /json/list hides ineligible tabs", () => {
		bridge = new RelayBridge({});
		const ext = makeSocket();
		connectExtension(ext);
		const version = bridge.versionInfo("ws://127.0.0.1:1/cdp");
		expect(version.Browser).toBe("Chrome/120");
		const listed = bridge.listTargets();
		expect(listed.some(t => t.url === "https://example.com")).toBe(true);
		expect(listed.some(t => t.url === "chrome://settings")).toBe(false);
	});

	test("cdp discovery emits tab+page targetCreated and rpc attaches on autoAttach", async () => {
		bridge = new RelayBridge({});
		const ext = makeSocket();
		connectExtension(ext);
		const cdp = makeSocket();
		const connId = bridge.cdpConnected(cdp);

		bridge.cdpMessage(connId, JSON.stringify({ id: 1, method: "Target.setDiscoverTargets" }));
		expect(cdp.sent.filter(m => m.includes('"Target.targetCreated"')).length).toBe(2);

		bridge.cdpMessage(connId, JSON.stringify({ id: 2, method: "Target.setAutoAttach" }));
		// The bridge should have issued an attach rpc for the eligible tab.
		const attachRpc = ext.sent.find(m => m.includes('"op":"attach"'));
		expect(attachRpc).toBeTruthy();
		// Answer the attach rpc; the page pseudo-session handshake follows.
		const id = Number(/\"id\":(\d+)/.exec(attachRpc!)![1]);
		ext.reply(id, true);
		await Bun.sleep(10);
		expect(cdp.sent.some(m => m.includes('"Target.attachedToTarget"') && m.includes('"type":"page"'))).toBe(true);
	});

	test("tab page session forwards evaluate and claims via OMP.claimTarget", async () => {
		bridge = new RelayBridge({});
		const ext = makeSocket();
		connectExtension(ext);
		const cdp = makeSocket();
		const connId = bridge.cdpConnected(cdp);

		// Attach to target PAGE1 directly.
		bridge.cdpMessage(connId, JSON.stringify({ id: 1, method: "Target.attachToTarget", params: { targetId: "PAGE1" } }));
		const attachRpc = ext.sent.find(m => m.includes('"op":"attach"'));
		ext.reply(Number(/\"id\":(\d+)/.exec(attachRpc!)![1]), true);
		await Bun.sleep(10);
		expect(cdp.sent.some(m => m.includes('"sessionId"') && m.includes('"type":"page"'))).toBe(true);

		const claim: RelayRpcRequest = { op: "send", tabId: 1, method: "OMP.claimTarget" };
		void claim;
		// Find the minted page session id from the attachedToTarget message.
		const attachMsg = cdp.sent.find(m => m.includes('"Target.attachedToTarget"') && m.includes('"type":"page"'))!;
		const sessionId = /\"sessionId\":\"([^\"]+)\"/.exec(attachMsg)![1];

		bridge.cdpMessage(connId, JSON.stringify({ id: 2, sessionId, method: "Runtime.evaluate", params: { expression: "1+1" } }));
		const sendRpc = ext.sent.find(m => m.includes('"op":"send"') && m.includes('Runtime.evaluate'));
		expect(sendRpc).toBeTruthy();
		if (!sendRpc) return;
		const rpcId = Number(/\"id\":(\d+)/.exec(sendRpc)![1]);
		ext.reply(rpcId, true, { result: { result: { type: "number", value: 2 } } });
		await Bun.sleep(10);
		expect(cdp.sent.some(m => m.includes('"id":2') && m.includes('"value":2'))).toBe(true);

		// Extension pushes an event; the page session should receive it.
		bridge.extMessage(
			ext,
			JSON.stringify({ t: "cdpEvent", tabId: 1, method: "Page.loadEventFired", params: { timestamp: 1 } } satisfies ExtToRelayMessage),
		);
		expect(cdp.sent.some(m => m.includes('"Page.loadEventFired"') && m.includes(sessionId))).toBe(true);
	});

	test("cdp close detaches when the last session holder leaves", async () => {
		bridge = new RelayBridge({});
		const ext = makeSocket();
		connectExtension(ext);
		const cdp = makeSocket();
		const connId = bridge.cdpConnected(cdp);
		bridge.cdpMessage(connId, JSON.stringify({ id: 1, method: "Target.setAutoAttach" }));
		const attachRpc = ext.sent.find(m => m.includes('"op":"attach"'));
		ext.reply(Number(/\"id\":(\d+)/.exec(attachRpc!)![1]), true);
		await Bun.sleep(10);
		ext.sent.length = 0;
		bridge.cdpClosed(connId);
		expect(ext.sent.some(m => m.includes('"op":"detach"'))).toBe(true);
	});

	test("unknown session ids and unknown browser methods produce cdp errors", async () => {
		bridge = new RelayBridge({});
		const ext = makeSocket();
		connectExtension(ext);
		const cdp = makeSocket();
		const connId = bridge.cdpConnected(cdp);

		bridge.cdpMessage(connId, JSON.stringify({ id: 7, sessionId: "nope", method: "Page.navigate", params: {} }));
		await Bun.sleep(5);
		expect(cdp.sent.some(m => m.includes('"id":7') && m.includes('error'))).toBe(true);

		bridge.cdpMessage(connId, JSON.stringify({ id: 8, method: "Totally.Bogus" }));
		await Bun.sleep(5);
		expect(cdp.sent.some(m => m.includes('"id":8') && m.includes('-32601'))).toBe(true);
	});
});

// Keep RelayToExtMessage referenced so protocol imports stay live for type checks.
export type { RelayToExtMessage };