/**
 * CDP façade over `chrome.debugger`. Ported from oh-my-pi `relay/bridge.ts`.
 *
 * Puppeteer clients (the browser tool: one supervisor connection plus one per
 * tab worker) connect to this bridge as if it were Chrome's browser debugging
 * endpoint. Chrome only allows a single debugger attachment per tab, so the
 * bridge owns ONE `chrome.debugger` attachment per tab (via the extension) and
 * multiplexes every downstream connection over it with minted per-connection
 * session ids.
 *
 * Emulated surface (everything else forwards to `chrome.debugger`):
 * - the browser target (`/json/version` handshake, `Browser.getVersion`)
 * - the `Target.*` domain, including puppeteer's tab → page auto-attach
 *   hierarchy
 *
 * Session id namespaces seen by a downstream connection:
 * - minted tab pseudo-sessions (`ST<tab>.<conn>.<n>`) — Target emulation only
 * - minted page pseudo-sessions (`SP<tab>.<conn>.<n>`) — forwarded to the
 *   tab's root debugger session
 * - real child session ids (OOPIFs, workers) — created by Chrome under the
 *   shared root session and passed through verbatim
 */
import type { ExtToRelayMessage, RelayRpcRequest, RelayToExtMessage, TabSnapshot } from "./protocol.js";

/** Transport-agnostic websocket surface the bridge writes to. */
export interface RelaySocket {
	send(text: string): void;
	close(): void;
}

interface CdpCommand {
	id: number;
	method: string;
	params?: Record<string, unknown>;
	sessionId?: string;
}

interface SessionRef {
	kind: "tab" | "page";
	tabId: number;
}

interface TargetInfo {
	targetId: string;
	type: "tab" | "page" | "browser";
	title: string;
	url: string;
	attached: boolean;
	canAccessOpener: boolean;
}

class CdpConnection {
	discover = false;
	autoAttach = false;
	/** Minted pseudo-sessions owned by this connection. */
	readonly sessions = new Map<string, SessionRef>();
	/** Tabs this connection claimed as drive targets (`OMP.claimTarget` / `Target.createTarget`). */
	readonly claims = new Set<number>();

	constructor(
		readonly id: number,
		readonly socket: RelaySocket,
	) {}

	sessionsForTab(tabId: number, kind?: "tab" | "page"): string[] {
		const out: string[] = [];
		for (const [sessionId, ref] of this.sessions) {
			if (ref.tabId === tabId && (!kind || ref.kind === kind)) out.push(sessionId);
		}
		return out;
	}
}

class TabState {
	url: string;
	title: string;
	active: boolean;
	windowId: number;
	pinned: boolean;
	/** Chrome tab group id from the last snapshot; -1 when ungrouped. */
	groupId: number;
	/** Whether `chrome.debugger` is currently attached to this tab. */
	attached = false;
	/** Set when attach failed or the user cancelled the debugger; cleared on navigation. */
	banned = false;
	/** Whether targets for this tab were announced to discovering connections. */
	announced = false;
	attaching: Promise<boolean> | null = null;
	/** True after the relay put this tab in the omp group; `ompGroupId` holds that group. */
	grouped = false;
	/** Group RPC in flight — suppresses duplicate requests from load-time tabUpdated bursts. */
	grouping = false;
	ompGroupId: number | undefined;
	/** User pulled the tab out of the omp group — never re-group it. */
	groupOptOut = false;
	/** Real Chrome session ids (OOPIF/worker children) living under this tab's root session. */
	readonly realSessions = new Set<string>();

	constructor(
		readonly tabId: number,
		snap: TabSnapshot,
	) {
		this.url = snap.url;
		this.title = snap.title;
		this.active = snap.active;
		this.windowId = snap.windowId;
		this.pinned = snap.pinned;
		this.groupId = snap.groupId;
	}

	update(snap: TabSnapshot): void {
		this.url = snap.url;
		this.title = snap.title;
		this.active = snap.active;
		this.windowId = snap.windowId;
		this.pinned = snap.pinned;
		this.groupId = snap.groupId;
	}
}

/** URLs `chrome.debugger` cannot attach to; hidden from downstream discovery entirely. */
const INELIGIBLE_URL = /^(chrome|devtools|edge|view-source|chrome-extension|chrome-untrusted|chrome-search):/i;

const RPC_TIMEOUT_MS = 20_000;
const CDP_ERROR_METHOD_NOT_FOUND = -32601;
const CDP_ERROR_SERVER = -32000;

function tabTargetId(tabId: number): string {
	return `TAB${tabId}`;
}

function pageTargetId(tabId: number): string {
	return `PAGE${tabId}`;
}

function parseTargetId(targetId: string): { kind: "tab" | "page"; tabId: number } | null {
	const match = /^(TAB|PAGE)(\d+)$/.exec(targetId);
	if (!match) return null;
	return { kind: match[1] === "TAB" ? "tab" : "page", tabId: Number(match[2]) };
}

/**
 * Multiplexing CDP bridge between downstream puppeteer connections and the
 * relay extension. One instance per relay server; all state lives here so an
 * extension service-worker restart only has to re-handshake.
 */
export class RelayBridge {
	#tabs = new Map<number, TabState>();
	#conns = new Map<number, CdpConnection>();
	#connSeq = 0;
	#sessionSeq = 0;
	#rpcSeq = 0;
	#ext: RelaySocket | null = null;
	#extInfo: { userAgent: string; browserVersion: string } | null = null;
	#pendingRpc = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
	>();
	/** Real child session id → owning tab, learned from `Target.attachedToTarget` events. */
	#realSessionTabs = new Map<string, number>();
	#log: (message: string, data?: Record<string, unknown>) => void;
	/** Tab-group appearance for driven tabs; null disables grouping. */
	#group: { title: string; color: string } | null;
	/** Tabs awaiting the next group RPC; drained one batch at a time. */
	#groupQueue: TabState[] = [];
	/** True while {@link #drainGroupQueue} runs — group RPCs must never overlap. */
	#groupDraining = false;

	constructor(
		opts: {
			log?: (message: string, data?: Record<string, unknown>) => void;
			/** Group tabs the agent actively drives under one per-window Chrome tab group. */
			group?: { title: string; color: string } | null;
		} = {},
	) {
		this.#log = opts.log ?? (() => {});
		this.#group = opts.group ?? null;
	}

	/** True once the extension has completed its hello handshake. */
	get ready(): boolean {
		return this.#ext !== null && this.#extInfo !== null;
	}

	/** Payload for `GET /json/version`. */
	versionInfo(wsUrl: string): Record<string, string> {
		const ua = this.#extInfo?.userAgent ?? "";
		return {
			Browser: this.#extInfo?.browserVersion ?? "Chrome/unknown",
			"Protocol-Version": "1.3",
			"User-Agent": ua,
			"V8-Version": "",
			"WebKit-Version": "",
			webSocketDebuggerUrl: wsUrl,
		};
	}

	/** Payload for `GET /json/list` (debugging aid; per-target endpoints are not served). */
	listTargets(): Array<Record<string, string>> {
		const out: Array<Record<string, string>> = [];
		for (const tab of this.#tabs.values()) {
			if (!this.#eligible(tab)) continue;
			out.push({ id: pageTargetId(tab.tabId), type: "page", title: tab.title, url: tab.url });
		}
		return out;
	}

	// ---- extension lifecycle -------------------------------------------------

	extConnected(socket: RelaySocket): void {
		if (this.#ext && this.#ext !== socket) {
			this.#log("replacing extension socket");
			this.#ext.close();
		}
		this.#ext = socket;
	}

	extClosed(socket: RelaySocket): void {
		if (this.#ext !== socket) return;
		this.#ext = null;
		this.#extInfo = null;
		for (const pending of this.#pendingRpc.values()) {
			clearTimeout(pending.timer);
			pending.reject(new Error("relay extension disconnected"));
		}
		this.#pendingRpc.clear();
		for (const tab of this.#tabs.values()) {
			tab.attached = false;
			tab.attaching = null;
			tab.grouped = false;
			tab.grouping = false;
			tab.ompGroupId = undefined;
		}
		this.#groupQueue.length = 0;
	}

	extMessage(socket: RelaySocket, raw: string): void {
		if (socket !== this.#ext) return;
		let msg: ExtToRelayMessage;
		try {
			msg = JSON.parse(raw) as ExtToRelayMessage;
		} catch {
			this.#log("dropping malformed extension message");
			return;
		}
		switch (msg.t) {
			case "hello":
				this.#onHello(msg);
				return;
			case "rpcResult": {
				const pending = this.#pendingRpc.get(msg.id);
				if (!pending) return;
				this.#pendingRpc.delete(msg.id);
				clearTimeout(pending.timer);
				if (msg.ok) pending.resolve(msg.result);
				else pending.reject(new Error(msg.error ?? "extension rpc failed"));
				return;
			}
			case "cdpEvent":
				this.#onCdpEvent(msg.tabId, msg.sessionId, msg.method, msg.params);
				return;
			case "detached":
				this.#onTabDetached(msg.tabId, msg.reason);
				return;
			case "tabCreated":
				this.#onTabUpsert(msg.tab);
				return;
			case "tabUpdated":
				this.#onTabUpsert(msg.tab);
				return;
			case "tabRemoved":
				this.#onTabRemoved(msg.tabId);
				return;
			case "ping":
				socket.send(JSON.stringify({ t: "pong" } satisfies RelayToExtMessage));
				return;
		}
	}

	#onHello(msg: Extract<ExtToRelayMessage, { t: "hello" }>): void {
		this.#extInfo = { userAgent: msg.userAgent, browserVersion: msg.browserVersion };
		const seen = new Set<number>();
		const attachedNow = new Set(msg.attachedTabIds);
		for (const snap of msg.tabs) {
			seen.add(snap.tabId);
			this.#onTabUpsert(snap, { silent: true });
		}
		for (const tabId of [...this.#tabs.keys()]) {
			if (!seen.has(tabId)) this.#onTabRemoved(tabId);
		}
		for (const tab of this.#tabs.values()) {
			const wasAttached = tab.attached;
			tab.attached = attachedNow.has(tab.tabId);
			tab.attaching = null;
			if (wasAttached && !tab.attached && this.#sessionHolders(tab.tabId).length > 0) {
				void this.#ensureAttached(tab).then(ok => {
					if (!ok) this.#onTabDetached(tab.tabId, "reattach_failed");
				});
			}
		}
		this.#syncGrouping();
		this.#log("extension connected", { tabs: this.#tabs.size, version: msg.browserVersion });
	}

	// ---- downstream (puppeteer) lifecycle -------------------------------------

	/** Register a downstream CDP websocket; returns the connection id. */
	cdpConnected(socket: RelaySocket): number {
		const conn = new CdpConnection(++this.#connSeq, socket);
		this.#conns.set(conn.id, conn);
		this.#log("cdp client connected", { conn: conn.id });
		return conn.id;
	}

	cdpClosed(connId: number): void {
		const conn = this.#conns.get(connId);
		if (!conn) return;
		this.#conns.delete(connId);
		const touched = new Set<number>();
		for (const ref of conn.sessions.values()) touched.add(ref.tabId);
		conn.sessions.clear();
		for (const tabId of conn.claims) {
			const tab = this.#tabs.get(tabId);
			if (tab) this.#syncTabGrouping(tab);
		}
		conn.claims.clear();
		for (const tabId of touched) {
			if (this.#sessionHolders(tabId).length > 0) continue;
			const tab = this.#tabs.get(tabId);
			if (tab?.attached) {
				tab.attached = false;
				void this.#rpc({ op: "detach", tabId }).catch(() => {});
			}
		}
		this.#log("cdp client closed", { conn: connId });
	}

	cdpMessage(connId: number, raw: string): void {
		const conn = this.#conns.get(connId);
		if (!conn) return;
		let msg: CdpCommand;
		try {
			msg = JSON.parse(raw) as CdpCommand;
		} catch {
			return;
		}
		if (typeof msg.id !== "number" || typeof msg.method !== "string") return;
		void this.#handleCdpCommand(conn, msg).catch(err => {
			this.#replyError(conn, msg, err instanceof Error ? err.message : String(err));
		});
	}

	// ---- command routing -------------------------------------------------------

	async #handleCdpCommand(conn: CdpConnection, msg: CdpCommand): Promise<void> {
		const sessionId = msg.sessionId;
		if (!sessionId) {
			await this.#handleBrowserCommand(conn, msg);
			return;
		}
		const ref = conn.sessions.get(sessionId);
		if (ref?.kind === "tab") {
			this.#handleTabSessionCommand(conn, msg, ref);
			return;
		}
		if (ref?.kind === "page") {
			await this.#forwardToTab(conn, msg, ref.tabId, undefined);
			return;
		}
		const realTab = this.#realSessionTabs.get(sessionId);
		if (realTab !== undefined) {
			await this.#forwardToTab(conn, msg, realTab, sessionId);
			return;
		}
		this.#replyError(conn, msg, `Unknown session id ${sessionId}`);
	}

	async #forwardToTab(
		conn: CdpConnection,
		msg: CdpCommand,
		tabId: number,
		realSessionId: string | undefined,
	): Promise<void> {
		if (msg.method === "Browser.close") {
			this.#reply(conn, msg, {});
			return;
		}
		if (msg.method === "OMP.claimTarget") {
			this.#claimTab(conn, tabId);
			this.#reply(conn, msg, {});
			return;
		}
		try {
			const result = await this.#rpc({
				op: "send",
				tabId,
				sessionId: realSessionId,
				method: msg.method,
				params: msg.params,
			});
			this.#reply(conn, msg, (result as Record<string, unknown> | undefined) ?? {});
		} catch (err) {
			this.#replyError(conn, msg, err instanceof Error ? err.message : String(err));
		}
	}

	#claimTab(conn: CdpConnection, tabId: number): void {
		const tab = this.#tabs.get(tabId);
		if (!tab) return;
		if (!conn.claims.has(tabId)) {
			conn.claims.add(tabId);
			this.#log("tab claimed", { conn: conn.id, tabId });
		}
		this.#syncTabGrouping(tab);
	}

	#claimed(tabId: number): boolean {
		for (const conn of this.#conns.values()) {
			if (conn.claims.has(tabId)) return true;
		}
		return false;
	}

	/** Tab pseudo-sessions only exist to satisfy puppeteer's Target hierarchy. */
	#handleTabSessionCommand(conn: CdpConnection, msg: CdpCommand, ref: SessionRef): void {
		switch (msg.method) {
			case "Target.setAutoAttach": {
				const tab = this.#tabs.get(ref.tabId);
				if (!tab) {
					this.#replyError(conn, msg, `Tab ${ref.tabId} is gone`);
					return;
				}
				this.#emit(conn, "Target.attachedToTarget", {
					sessionId: this.#mintSession(conn, "page", tab.tabId),
					targetInfo: this.#pageInfo(tab, true),
					waitingForDebugger: false,
				}, msg.sessionId);
				this.#reply(conn, msg, {});
				return;
			}
			case "Runtime.runIfWaitingForDebugger":
				this.#reply(conn, msg, {});
				return;
			case "Target.detachFromTarget": {
				const child = typeof msg.params?.sessionId === "string" ? msg.params.sessionId : undefined;
				if (child) this.#releaseSession(conn, child, msg.sessionId);
				this.#reply(conn, msg, {});
				return;
			}
			default:
				this.#replyError(conn, msg, `'${msg.method}' is not supported on a tab target`, CDP_ERROR_METHOD_NOT_FOUND);
		}
	}

	async #handleBrowserCommand(conn: CdpConnection, msg: CdpCommand): Promise<void> {
		switch (msg.method) {
			case "Browser.getVersion": {
				this.#reply(conn, msg, {
					protocolVersion: "1.3",
					product: this.#extInfo?.browserVersion ?? "Chrome/unknown",
					revision: "",
					userAgent: this.#extInfo?.userAgent ?? "",
					jsVersion: "",
				});
				return;
			}
			case "Target.getBrowserContexts":
				this.#reply(conn, msg, { browserContextIds: [] });
				return;
			case "Target.setDiscoverTargets": {
				conn.discover = true;
				for (const tab of this.#tabs.values()) {
					if (!this.#eligible(tab)) continue;
					tab.announced = true;
					this.#emit(conn, "Target.targetCreated", { targetInfo: this.#tabInfo(tab, tab.attached) });
					this.#emit(conn, "Target.targetCreated", { targetInfo: this.#pageInfo(tab, tab.attached) });
				}
				this.#reply(conn, msg, {});
				return;
			}
			case "Target.setAutoAttach": {
				conn.autoAttach = true;
				const tabs = [...this.#tabs.values()].filter(tab => this.#eligible(tab));
				await Promise.all(tabs.map(tab => this.#ensureAttached(tab)));
				for (const tab of tabs) {
					if (!tab.attached) {
						this.#retractTab(tab);
						continue;
					}
					this.#emitTabAttached(conn, tab);
				}
				this.#reply(conn, msg, {});
				return;
			}
			case "Target.attachToTarget": {
				const parsed = typeof msg.params?.targetId === "string" ? parseTargetId(msg.params.targetId) : null;
				const tab = parsed ? this.#tabs.get(parsed.tabId) : undefined;
				if (!parsed || !tab) {
					this.#replyError(conn, msg, `No target with id ${String(msg.params?.targetId)}`);
					return;
				}
				if (!(await this.#ensureAttached(tab))) {
					this.#replyError(conn, msg, `Cannot attach to tab ${tab.tabId} (${tab.url})`);
					return;
				}
				const sessionId = this.#mintSession(conn, parsed.kind, tab.tabId);
				const info = parsed.kind === "tab" ? this.#tabInfo(tab, true) : this.#pageInfo(tab, true);
				this.#emit(conn, "Target.attachedToTarget", { sessionId, targetInfo: info, waitingForDebugger: false });
				this.#reply(conn, msg, { sessionId });
				return;
			}
			case "Target.detachFromTarget": {
				const sessionId = typeof msg.params?.sessionId === "string" ? msg.params.sessionId : undefined;
				if (sessionId) this.#releaseSession(conn, sessionId, undefined);
				this.#reply(conn, msg, {});
				return;
			}
			case "Target.createTarget": {
				const url = typeof msg.params?.url === "string" && msg.params.url.length > 0 ? msg.params.url : "about:blank";
				const result = (await this.#rpc({ op: "createTab", url })) as { tab: TabSnapshot };
				this.#onTabUpsert(result.tab);
				this.#claimTab(conn, result.tab.tabId);
				this.#reply(conn, msg, { targetId: pageTargetId(result.tab.tabId) });
				return;
			}
			case "Target.closeTarget": {
				const parsed = typeof msg.params?.targetId === "string" ? parseTargetId(msg.params.targetId) : null;
				if (!parsed) {
					this.#replyError(conn, msg, `No target with id ${String(msg.params?.targetId)}`);
					return;
				}
				await this.#rpc({ op: "removeTab", tabId: parsed.tabId });
				this.#reply(conn, msg, { success: true });
				return;
			}
			case "Target.getTargets": {
				const tabs = [...this.#tabs.values()].filter(tab => this.#eligible(tab));
				const infos: TargetInfo[] = tabs.flatMap(tab => [
					this.#tabInfo(tab, this.#sessionHolders(tab.tabId, "tab").length > 0),
					this.#pageInfo(tab, this.#sessionHolders(tab.tabId, "page").length > 0),
				]);
				this.#reply(conn, msg, { targetInfos: infos });
				return;
			}
			case "Target.activateTarget": {
				const parsed = typeof msg.params?.targetId === "string" ? parseTargetId(msg.params.targetId) : null;
				if (!parsed) {
					this.#replyError(conn, msg, `No target with id ${String(msg.params?.targetId)}`);
					return;
				}
				await this.#rpc({ op: "activateTab", tabId: parsed.tabId });
				this.#reply(conn, msg, {});
				return;
			}
			case "Target.disposeBrowserContext":
				this.#reply(conn, msg, {});
				return;
			case "Target.closeBrowser":
				this.#reply(conn, msg, {});
				return;
			case "Browser.setDownloadBehavior":
				this.#reply(conn, msg, {});
				return;
			case "Page.captureScreenshot":
			case "Page.printToPDF": {
				// Rarely used by puppeteer through the browser session; forward to the
				// visible tab's root session as a best effort.
				const tab = [...this.#tabs.values()].find(candidate => this.#eligible(candidate));
				if (!tab) {
					this.#replyError(conn, msg, "No tab available");
					return;
				}
				await this.#forwardToTab(conn, msg, tab.tabId, undefined);
				return;
			}
			default:
				this.#replyError(conn, msg, `'${msg.method}' is not supported on the browser target`, CDP_ERROR_METHOD_NOT_FOUND);
		}
	}

	// ---- tab lifecycle ---------------------------------------------------------

	#onTabUpsert(snap: TabSnapshot, opts: { silent?: boolean } = {}): void {
		const prev = this.#tabs.get(snap.tabId);
		if (prev) {
			const urlChanged = prev.url !== snap.url;
			prev.update(snap);
			// A navigation clears a debugger ban (the page is a fresh document).
			if (urlChanged && prev.banned) prev.banned = false;
			this.#onGroupChange(prev);
			return;
		}
		if (this.#eligible(snap)) {
			const tab = new TabState(snap.tabId, snap);
			this.#tabs.set(snap.tabId, tab);
			this.#onGroupChange(tab);
			if (!opts.silent) {
				this.#announceTab(tab);
				this.#log("tab created", { tabId: tab.tabId, url: tab.url });
			}
		}
	}

	#onTabRemoved(tabId: number): void {
		const tab = this.#tabs.get(tabId);
		if (!tab) return;
		this.#tabs.delete(tabId);
		this.#retractTab(tab);
		for (const session of tab.realSessions) this.#realSessionTabs.delete(session);
	}

	#onTabDetached(tabId: number, reason: string): void {
		const tab = this.#tabs.get(tabId);
		if (!tab) return;
		const wasAttached = tab.attached;
		tab.attached = false;
		tab.banned = true;
		tab.attaching = null;
		this.#log("tab detached", { tabId, reason });
		if (!this.#claimed(tabId)) return;
		for (const conn of this.#conns.values()) {
			for (const sessionId of conn.sessionsForTab(tabId)) {
				this.#emit(conn, "Target.detachedFromTarget", {
					sessionId,
					targetId: pageTargetId(tabId),
					reason: "tab-detached",
				});
				conn.sessions.delete(sessionId);
			}
		}
		if (!wasAttached) return;
		void this.#rpc({ op: "detach", tabId }).catch(() => {});
	}

	#retractTab(tab: TabState): void {
		const info = this.#tabInfo(tab, false);
		for (const conn of [...this.#conns.values()]) {
			if (!conn.discover) continue;
			for (const sessionId of conn.sessionsForTab(tab.tabId)) {
				this.#emit(conn, "Target.detachedFromTarget", { sessionId, targetId: info.targetId, reason: "tab-removed" });
				conn.sessions.delete(sessionId);
			}
			this.#emit(conn, "Target.targetDestroyed", { targetId: info.targetId });
			this.#emit(conn, "Target.targetDestroyed", { targetId: this.#pageInfo(tab, false).targetId });
		}
	}

	#announceTab(tab: TabState): void {
		const tabInfo = this.#tabInfo(tab, tab.attached);
		const pageInfo = this.#pageInfo(tab, tab.attached);
		for (const conn of [...this.#conns.values()]) {
			if (!conn.discover) continue;
			conn.socket.send(JSON.stringify({ method: "Target.targetCreated", params: { targetInfo: tabInfo } }));
			conn.socket.send(JSON.stringify({ method: "Target.targetCreated", params: { targetInfo: pageInfo } }));
		}
		tab.announced = true;
	}

	#eligible(tab: { url: string }): boolean {
		return !INELIGIBLE_URL.test(tab.url) && !tab.url.startsWith("about:");
	}

	async #ensureAttached(tab: TabState): Promise<boolean> {
		if (tab.attached) return true;
		if (tab.banned) return false;
		if (tab.attaching) return await tab.attaching;
		tab.attaching = (async () => {
			try {
				await this.#rpc({ op: "attach", tabId: tab.tabId });
				tab.attached = true;
				return true;
			} catch (error) {
				this.#log("attach failed", {
					tabId: tab.tabId,
					url: tab.url,
					error: error instanceof Error ? error.message : String(error),
				});
				tab.banned = true;
				return false;
			}
		})();
		const ok = await tab.attaching;
		tab.attaching = null;
		return ok;
	}

	/** Emit the standard attach handshake for an existing attached tab on `conn`. */
	#emitTabAttached(conn: CdpConnection, tab: TabState): void {
		const tabSession = this.#mintSession(conn, "tab", tab.tabId);
		const pageSession = this.#mintSession(conn, "page", tab.tabId);
		this.#emit(conn, "Target.attachedToTarget", {
			sessionId: tabSession,
			targetInfo: this.#tabInfo(tab, true),
			waitingForDebugger: false,
		});
		this.#emit(conn, "Target.attachedToTarget", {
			sessionId: pageSession,
			targetInfo: this.#pageInfo(tab, true),
			waitingForDebugger: false,
		});
	}

	#mintSession(conn: CdpConnection, kind: "tab" | "page", tabId: number): string {
		const prefix = kind === "tab" ? "ST" : "SP";
		const sessionId = `${prefix}${tabId}.${conn.id}.${++this.#sessionSeq}`;
		conn.sessions.set(sessionId, { kind, tabId });
		return sessionId;
	}

	#releaseSession(conn: CdpConnection, sessionId: string, via?: string): void {
		const ref = conn.sessions.get(sessionId);
		if (!ref) return;
		conn.sessions.delete(sessionId);
		const tab = this.#tabs.get(ref.tabId);
		if (!tab) return;
		if (via) {
			this.#emit(conn, "Target.detachedFromTarget", {
				sessionId,
				targetId: ref.kind === "tab" ? tabTargetId(ref.tabId) : pageTargetId(ref.tabId),
				reason: "driver-detached",
			}, via);
		}
	}

	#sessionHolders(tabId: number, kind?: "tab" | "page"): string[] {
		const out: string[] = [];
		for (const conn of this.#conns.values()) out.push(...conn.sessionsForTab(tabId, kind));
		return out;
	}

	#tabInfo(tab: TabState, attached: boolean): TargetInfo {
		return {
			targetId: tabTargetId(tab.tabId),
			type: "tab",
			title: tab.title,
			url: tab.url,
			attached,
			canAccessOpener: false,
		};
	}

	#pageInfo(tab: TabState, attached: boolean): TargetInfo {
		return {
			targetId: pageTargetId(tab.tabId),
			type: "page",
			title: tab.title,
			url: tab.url,
			attached,
			canAccessOpener: false,
		};
	}

	// ---- chrome.debugger event fan-out -----------------------------------------

	#onCdpEvent(tabId: number, sessionId: string | undefined, method: string, params: Record<string, unknown> | undefined): void {
		const tab = this.#tabs.get(tabId);
		if (!tab) return;
		if (sessionId && method === "Target.attachedToTarget") {
			const childSessionId = typeof params?.sessionId === "string" ? params.sessionId : undefined;
			if (childSessionId) {
				tab.realSessions.add(childSessionId);
				this.#realSessionTabs.set(childSessionId, tabId);
			}
		}
		if (sessionId && method === "Target.detachedFromTarget") {
			const childSessionId = typeof params?.sessionId === "string" ? params.sessionId : undefined;
			if (childSessionId) {
				tab.realSessions.delete(childSessionId);
				this.#realSessionTabs.delete(childSessionId);
			}
		}
		const realTargetId = sessionId ? this.#realTargetIdFor(tab, sessionId) : undefined;
		for (const conn of this.#conns.values()) {
			if (sessionId) {
				if (this.#realSessionTabs.get(sessionId) !== tabId) continue;
				this.#emit(conn, method, params ?? {}, sessionId);
				continue;
			}
			if (!conn.autoAttach && !conn.discover && conn.sessionsForTab(tab.tabId).length === 0) continue;
			if (method === "Target.targetInfoChanged" || method === "Target.targetCreated") {
				if (realTargetId === tabTargetId(tab.tabId) || realTargetId === pageTargetId(tab.tabId)) {
					this.#emit(conn, method, { targetInfo: this.#tabInfo(tab, tab.attached) }, undefined);
				}
				continue;
			}
			for (const sessionId2 of conn.sessionsForTab(tab.tabId)) {
				this.#emit(conn, method, params ?? {}, sessionId2);
			}
		}
	}

	#realTargetIdFor(tab: TabState, sessionId: string): string | undefined {
		for (const conn of this.#conns.values()) {
			for (const [minted, ref] of conn.sessions) {
				if (minted === sessionId) return ref.kind === "tab" ? tabTargetId(tab.tabId) : pageTargetId(tab.tabId);
			}
		}
		return undefined;
	}

	// ---- tab grouping -----------------------------------------------------------

	#onGroupChange(tab: TabState): void {
		if (!this.#group || !this.#claimed(tab.tabId)) return;
		if (!tab.grouped && !tab.grouping && !tab.groupOptOut) {
			tab.grouping = true;
			this.#groupQueue.push(tab);
			this.#syncGrouping();
		}
	}

	#syncGrouping(): void {
		if (this.#groupDraining) return;
		this.#groupDraining = true;
		void (async () => {
			try {
				while (this.#groupQueue.length > 0) {
					const batch = this.#groupQueue.splice(0, 20);
					await this.#drainGroupBatch(batch);
				}
			} catch (error) {
				this.#log("group sync failed", {
					error: error instanceof Error ? error.message : String(error),
				});
			} finally {
				this.#groupDraining = false;
			}
		})();
	}

	async #drainGroupBatch(batch: TabState[]): Promise<void> {
		const ungrouped: TabState[] = [];
		await Promise.all(
			batch.map(async tab => {
				if (tab.groupId >= 0) {
					// Already in the user's own group — record and skip.
					tab.groupOptOut = true;
					tab.grouping = false;
					return;
				}
				ungrouped.push(tab);
				const result = (await this.#rpc({
					op: "group",
					tabIds: [tab.tabId],
					title: this.#group!.title,
					color: this.#group!.color,
				})) as { grouped: Record<string, number> };
				const groupId = result.grouped?.[tab.tabId];
				tab.grouping = false;
				if (groupId !== undefined) {
					tab.grouped = true;
					tab.ompGroupId = groupId;
				} else {
					tab.groupOptOut = true;
				}
			}),
		);
		// Reconcile tabs that left the omp group on their own.
		for (const tab of this.#tabs.values()) {
			if (!tab.grouped) continue;
			if (tab.ompGroupId !== undefined && tab.groupId !== tab.ompGroupId) {
				tab.grouped = false;
				this.#syncTabGrouping(tab);
			}
		}
		void ungrouped;
	}

	#syncTabGrouping(tab: TabState): void {
		if (!this.#group) return;
		const shouldGroup = this.#claimed(tab.tabId) && !tab.groupOptOut;
		if (shouldGroup && !tab.grouped && !tab.grouping) {
			tab.grouping = true;
			this.#groupQueue.push(tab);
			this.#syncGrouping();
		} else if (!shouldGroup && tab.grouped) {
			tab.grouped = false;
			tab.grouping = true;
			void (async () => {
				try {
					await this.#rpc({ op: "ungroup", tabIds: [tab.tabId] });
				} finally {
					tab.grouping = false;
				}
			})();
		}
	}

	// ---- transport plumbing ------------------------------------------------------

	#reply(conn: CdpConnection, msg: CdpCommand, result: Record<string, unknown>): void {
		conn.socket.send(JSON.stringify({ id: msg.id, sessionId: msg.sessionId, result }));
	}

	#replyError(conn: CdpConnection, msg: CdpCommand, message: string, code = CDP_ERROR_SERVER): void {
		conn.socket.send(JSON.stringify({ id: msg.id, sessionId: msg.sessionId, error: { code, message } }));
	}

	#emit(conn: CdpConnection, method: string, params: Record<string, unknown>, sessionId?: string): void {
		conn.socket.send(JSON.stringify({ sessionId, method, params }));
	}

	#rpc(req: RelayRpcRequest, timeoutMs = RPC_TIMEOUT_MS): Promise<unknown> {
		const ext = this.#ext;
		if (!ext) return Promise.reject(new Error("relay extension is not connected"));
		const id = ++this.#rpcSeq;
		const { promise, resolve, reject } = Promise.withResolvers<unknown>();
		const timer = setTimeout(() => {
			this.#pendingRpc.delete(id);
			reject(new Error(`extension rpc '${req.op}' timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		this.#pendingRpc.set(id, { resolve, reject, timer });
		ext.send(JSON.stringify({ t: "rpc", id, ...req } satisfies RelayToExtMessage));
		return promise;
	}
}