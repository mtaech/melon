/**
 * Minimal MCP client for IntelliJ IDEA's built-in MCP server.
 *
 * IDEA exposes exactly one router tool (`execute_tool`) behind a plain
 * JSON-RPC handshake; this file speaks just enough of the protocol to drive it
 * over either transport:
 *
 * - `stdio`: spawn `idea stdioMcpServer`, which proxies to the running IDE on
 *   `IJ_MCP_SERVER_PORT`. Newline-delimited JSON on stdin/stdout.
 * - `sse`: connect straight to the IDE's own `http://127.0.0.1:<port>/sse`
 *   endpoint. Responses arrive on the event stream, requests are POSTed to the
 *   session-scoped `/message` URL.
 *
 * The connection is lazy (nothing is spawned until the first tool call), is
 * cached across calls, and is dropped after an idle period so a developer's IDE
 * is not left holding a proxy process open forever.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { createConnection } from "node:net";
import { ToolError, throwIfAborted } from "./errors.js";
import { parseOpenProjects } from "./projects.js";

/** MCP revision IDEA's server negotiates. */
const PROTOCOL_VERSION = "2024-11-05";
/** Client identity reported during the handshake; the version tracks package.json. */
const CLIENT_INFO = { name: "dsh-idea-mcp", version: packageVersion() } as const;
/** How long an open-project list stays valid before it is re-probed. */
const PROJECT_CACHE_TTL_MS = 30_000;
/** How many stderr lines from the stdio proxy are kept for diagnostics. */
const STDERR_TAIL_LINES = 20;
/** Bound on the loopback reachability probe that precedes a connection. */
const PROBE_TIMEOUT_MS = 800;

/** Transport used to reach IDEA's MCP server. */
export type IdeaTransport = "stdio" | "sse";

/** Narrow logging surface, so the plugin can pass `ctx.logger` without a hard dep. */
export interface IdeaLogger {
	debug?(message: string): void;
	warn?(message: string): void;
}

/** Resolved client options (defaults applied by the plugin's Config). */
export interface IdeaClientOptions {
	transport: IdeaTransport;
	/** stdio: executable that speaks MCP over stdio (`idea`). */
	command: string;
	/** stdio: argv for `command`. */
	args: readonly string[];
	/** stdio: extra environment merged over the ambient one. */
	env: Readonly<Record<string, string>>;
	/** sse: full endpoint URL, e.g. `http://127.0.0.1:64342/sse`. */
	url: string;
	/** Per-request timeout in milliseconds. */
	requestTimeoutMs: number;
	/** Drop an idle connection after this many milliseconds (0 disables). */
	idleTimeoutMs: number;
	logger?: IdeaLogger;
}

/** One routed IDEA tool call. */
export interface IdeaCallResult {
	/** Concatenated text content IDEA returned (usually a JSON string). */
	text: string;
	/** True when IDEA reported the call itself as failed. */
	isError: boolean;
}

/** Connection facts for `idea_status`. */
export interface IdeaConnectionStatus {
	transport: IdeaTransport;
	/** Human-readable endpoint: the command line or the SSE URL. */
	endpoint: string;
	/** Whether a handshake completed and the session is still open. */
	connected: boolean;
	/** `serverInfo.name version` from the last handshake. */
	server?: string;
	/** Why the last status probe failed, when it did. */
	error?: string;
	/** Projects the IDE currently has open. */
	projects: string[];
}

interface Pending {
	resolve(value: unknown): void;
	reject(error: Error): void;
	timer: ReturnType<typeof setTimeout>;
	signal?: AbortSignal;
	onAbort?: () => void;
}

/** Raised when the transport died; callers drop it and reconnect. */
export class SessionClosedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SessionClosedError";
	}
}

interface RpcSession {
	readonly endpoint: string;
	readonly closed: boolean;
	request(method: string, params: unknown, timeoutMs: number, signal?: AbortSignal): Promise<unknown>;
	notify(method: string, params?: unknown): void;
	close(): void;
}

/** Shared JSON-RPC bookkeeping for both transports. */
abstract class BaseSession implements RpcSession {
	readonly endpoint: string;
	#nextId = 1;
	#pending = new Map<number, Pending>();
	#closed = false;
	#closeReason: Error | undefined;

	constructor(endpoint: string) {
		this.endpoint = endpoint;
	}

	get closed(): boolean {
		return this.#closed;
	}

	/** Deliver one already-serialized JSON-RPC payload. */
	protected abstract send(payload: string): void;

	/** Release transport resources. Must be idempotent. */
	protected abstract teardown(): void;

	request(method: string, params: unknown, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
		if (this.#closed) {
			return Promise.reject(this.#closeReason ?? new SessionClosedError(`IDEA MCP 会话已关闭 (${this.endpoint})`));
		}
		const id = this.#nextId++;
		const promise = new Promise<unknown>((resolve, reject) => {
			const pending: Pending = {
				resolve,
				reject,
				timer: setTimeout(() => {
					this.#pending.delete(id);
					reject(new ToolError(`IDEA MCP 调用超时（${timeoutMs}ms）：${method} @ ${this.endpoint}`));
				}, Math.max(1, timeoutMs)),
			};
			if (signal !== undefined) {
				pending.signal = signal;
				pending.onAbort = () => {
					this.#pending.delete(id);
					reject(abortError());
				};
				signal.addEventListener("abort", pending.onAbort, { once: true });
			}
			this.#pending.set(id, pending);
		});
		try {
			this.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
		} catch (error) {
			this.#settle(id, error);
		}
		return promise;
	}

	notify(method: string, params?: unknown): void {
		if (this.#closed) return;
		try {
			this.send(JSON.stringify(params === undefined
				? { jsonrpc: "2.0", method }
				: { jsonrpc: "2.0", method, params }));
		} catch {
			// Notifications are fire-and-forget; a dead transport surfaces on the next request.
		}
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#closeReason = new SessionClosedError(`IDEA MCP 会话已关闭 (${this.endpoint})`);
		this.#rejectAll(this.#closeReason);
		this.#teardownQuietly();
	}

	/** Mark the transport dead after an unexpected failure. */
	protected fail(reason: Error): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#closeReason = reason;
		this.#rejectAll(reason);
		this.#teardownQuietly();
	}

	/** Route one inbound JSON-RPC payload from the transport. */
	protected handleMessage(raw: string): void {
		let message: unknown;
		try {
			message = JSON.parse(raw);
		} catch {
			return;
		}
		if (typeof message !== "object" || message === null) return;
		const record = message as { id?: unknown; result?: unknown; error?: unknown };
		if (typeof record.id !== "number") return;
		const error = record.error as { message?: unknown; code?: unknown } | null | undefined;
		if (error !== null && typeof error === "object") {
			const detail = typeof error.message === "string" ? error.message : JSON.stringify(error);
			this.#settle(record.id, new ToolError(`IDEA MCP 错误 (${String(error.code ?? "?")})：${detail}`));
			return;
		}
		this.#settle(record.id, undefined, record.result);
	}

	#teardownQuietly(): void {
		try {
			this.teardown();
		} catch {
			// Teardown is best-effort.
		}
	}

	#settle(id: number, error?: unknown, value?: unknown): void {
		const pending = this.#pending.get(id);
		if (pending === undefined) return;
		this.#pending.delete(id);
		clearTimeout(pending.timer);
		if (pending.onAbort !== undefined && pending.signal !== undefined) {
			pending.signal.removeEventListener("abort", pending.onAbort);
		}
		if (error !== undefined) pending.reject(error instanceof Error ? error : new Error(String(error)));
		else pending.resolve(value);
	}

	#rejectAll(reason: Error): void {
		const pending = [...this.#pending.values()];
		this.#pending.clear();
		for (const entry of pending) {
			clearTimeout(entry.timer);
			if (entry.onAbort !== undefined && entry.signal !== undefined) {
				entry.signal.removeEventListener("abort", entry.onAbort);
			}
			entry.reject(reason);
		}
	}
}

/** stdio transport: newline-delimited JSON-RPC over a spawned IDEA proxy. */
class StdioSession extends BaseSession {
	#child: ChildProcess;
	#stdoutBuffer = "";
	#stderrTail: string[] = [];
	#logger: IdeaLogger | undefined;

	constructor(options: IdeaClientOptions) {
		super(`${options.command} ${options.args.join(" ")}`.trim());
		this.#logger = options.logger;
		this.#child = spawn(options.command, [...options.args], {
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, ...options.env },
			shell: false,
		});
		this.#child.stdout?.setEncoding("utf8");
		this.#child.stdout?.on("data", (chunk: string) => this.#onStdout(chunk));
		this.#child.stderr?.setEncoding("utf8");
		this.#child.stderr?.on("data", (chunk: string) => this.#onStderr(chunk));
		this.#child.on("error", (error: Error) => {
			this.fail(new ToolError(`无法启动 IDEA MCP 代理「${this.endpoint}」：${error.message}`, { cause: error }));
		});
		this.#child.on("exit", (code, signal) => {
			this.fail(new ToolError(
				`IDEA MCP 代理已退出 (code=${String(code)}, signal=${String(signal)})：${this.endpoint}${this.#stderrHint()}`,
			));
		});
	}

	protected send(payload: string): void {
		const stdin = this.#child.stdin;
		if (stdin === null || stdin.destroyed) throw new SessionClosedError(`IDEA MCP 代理 stdin 不可用：${this.endpoint}`);
		stdin.write(`${payload}\n`);
	}

	protected teardown(): void {
		try {
			this.#child.stdin?.end();
		} catch {
			// ignore
		}
		this.#child.kill("SIGTERM");
	}

	#onStdout(chunk: string): void {
		this.#stdoutBuffer += chunk;
		let newline = this.#stdoutBuffer.indexOf("\n");
		while (newline >= 0) {
			const line = this.#stdoutBuffer.slice(0, newline).trim();
			this.#stdoutBuffer = this.#stdoutBuffer.slice(newline + 1);
			if (line !== "") this.handleMessage(line);
			newline = this.#stdoutBuffer.indexOf("\n");
		}
	}

	#onStderr(chunk: string): void {
		for (const line of chunk.split("\n")) {
			if (line.trim() === "") continue;
			this.#stderrTail.push(line.trim());
			this.#logger?.debug?.(`[idea-mcp] ${line.trim()}`);
		}
		if (this.#stderrTail.length > STDERR_TAIL_LINES) {
			this.#stderrTail = this.#stderrTail.slice(-STDERR_TAIL_LINES);
		}
	}

	#stderrHint(): string {
		const lines = condenseStderr(this.#stderrTail);
		if (lines.length === 0) return "";
		return `\n代理输出：\n${lines.join("\n")}`;
	}
}

/** SSE transport: requests POST to `/message`, responses arrive on the stream. */
class SseSession extends BaseSession {
	#url: string;
	#messageUrl: string | undefined;
	#controller = new AbortController();
	#ready: Promise<void>;
	#settleReady: { resolve(): void; reject(error: Error): void } | undefined;

	constructor(options: IdeaClientOptions) {
		super(options.url);
		this.#url = options.url;
		this.#ready = new Promise<void>((resolve, reject) => {
			this.#settleReady = { resolve, reject };
		});
		void this.#open().catch((error: unknown) => {
			this.fail(error instanceof Error ? error : new ToolError(messageOf(error)));
		});
	}

	override async request(method: string, params: unknown, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
		await this.#waitReady(timeoutMs, signal);
		return super.request(method, params, timeoutMs, signal);
	}

	override notify(method: string, params?: unknown): void {
		if (this.closed) return;
		void this.#ready.then(() => {
			super.notify(method, params);
		}).catch(() => undefined);
	}

	override close(): void {
		this.#settleReady?.reject(new SessionClosedError(`IDEA MCP SSE 会话已关闭：${this.#url}`));
		this.#settleReady = undefined;
		super.close();
	}

	protected override fail(reason: Error): void {
		this.#settleReady?.reject(reason);
		this.#settleReady = undefined;
		super.fail(reason);
	}

	protected send(payload: string): void {
		const target = this.#messageUrl;
		if (target === undefined) throw new SessionClosedError(`IDEA MCP SSE 会话尚未就绪：${this.#url}`);
		void fetch(target, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: payload,
			signal: this.#controller.signal,
		}).catch((error: unknown) => {
			this.fail(new ToolError(`向 IDEA MCP 发送请求失败：${messageOf(error)}`, { cause: error }));
		});
	}

	protected teardown(): void {
		this.#controller.abort();
	}

	async #waitReady(timeoutMs: number, signal?: AbortSignal): Promise<void> {
		if (this.closed) throw new SessionClosedError(`IDEA MCP SSE 会话已关闭：${this.#url}`);
		let timer: ReturnType<typeof setTimeout> | undefined;
		const deadline = new Promise<never>((_, reject) => {
			timer = setTimeout(
				() => reject(new ToolError(`等待 IDEA MCP SSE 会话就绪超时（${timeoutMs}ms）：${this.#url}`)),
				Math.max(1, timeoutMs),
			);
		});
		try {
			await Promise.race([this.#ready, deadline]);
		} finally {
			if (timer !== undefined) clearTimeout(timer);
		}
		throwIfAborted(signal);
	}

	async #open(): Promise<void> {
		let response: Response;
		try {
			response = await fetch(this.#url, {
				headers: { accept: "text/event-stream" },
				signal: this.#controller.signal,
			});
		} catch (error) {
			throw new ToolError(`无法连接 IDEA MCP SSE 端点：${this.#url}（${messageOf(error)}）`, { cause: error });
		}
		if (!response.ok || response.body === null) {
			throw new ToolError(`IDEA MCP SSE 端点返回 HTTP ${response.status}：${this.#url}`);
		}
		const base = this.#url.endsWith("/sse") ? this.#url.slice(0, -4) : new URL(this.#url).origin;
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
			let boundary = buffer.indexOf("\n\n");
			while (boundary >= 0) {
				const frame = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);
				this.#handleFrame(frame, base);
				boundary = buffer.indexOf("\n\n");
			}
		}
		throw new SessionClosedError(`IDEA MCP SSE 流已结束：${this.#url}`);
	}

	#handleFrame(frame: string, base: string): void {
		let event = "message";
		const data: string[] = [];
		for (const line of frame.split("\n")) {
			if (line.startsWith(":")) continue;
			if (line.startsWith("event:")) event = line.slice(6).trim();
			else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
		}
		if (data.length === 0) return;
		const payload = data.join("\n");
		if (event === "endpoint") {
			this.#messageUrl = payload.startsWith("http")
				? payload
				: `${base}${payload.startsWith("/") ? "" : "/"}${payload}`;
			const ready = this.#settleReady;
			this.#settleReady = undefined;
			ready?.resolve();
			return;
		}
		this.handleMessage(payload);
	}
}

/** `serverInfo` extracted from an initialize result. */
function readServerInfo(result: unknown): string | undefined {
	const info = (result as { serverInfo?: { name?: unknown; version?: unknown } } | null)?.serverInfo;
	if (info === undefined || info === null) return undefined;
	const name = typeof info.name === "string" ? info.name : undefined;
	const version = typeof info.version === "string" ? info.version : undefined;
	if (name === undefined) return version;
	return version === undefined ? name : `${name} ${version}`;
}

/** Normalize an MCP `tools/call` result into text + isError. */
function normalizeToolResult(result: unknown): IdeaCallResult {
	const record = result as { content?: unknown; isError?: unknown } | null;
	const blocks = Array.isArray(record?.content) ? record.content : [];
	const texts: string[] = [];
	for (const block of blocks) {
		const text = (block as { text?: unknown } | null)?.text;
		if (typeof text === "string") texts.push(text);
	}
	return { text: texts.join("\n"), isError: record?.isError === true };
}

/** A named abort error, so callers can distinguish cancellation from failure. */
function abortError(): Error {
	const error = new Error("Aborted");
	error.name = "AbortError";
	return error;
}

/** Error-message extraction that tolerates non-Error throws. */
function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * This package's version, read from its own manifest so the MCP handshake
 * never drifts from `package.json`.
 * @returns the version, or `0.0.0` when the manifest cannot be read.
 */
function packageVersion(): string {
	try {
		const manifest = createRequire(import.meta.url)("../package.json") as { version?: unknown };
		return typeof manifest.version === "string" ? manifest.version : "0.0.0";
	} catch {
		return "0.0.0";
	}
}

/**
 * Keep only the actionable lines of the launcher's stderr.
 *
 * A dead IDE makes `idea stdioMcpServer` print a full Java stack trace
 * (dozens of `at java.net.http...` frames) and exit 1. Those frames say
 * nothing the model can act on, so they are dropped and the tail is bounded.
 * @param lines - raw stderr lines, oldest first.
 * @param maxLines - how many trailing lines to keep.
 * @returns the condensed lines, newest last.
 */
export function condenseStderr(lines: readonly string[], maxLines = 6): string[] {
	const kept: string[] = [];
	for (const raw of lines) {
		const line = raw.trim();
		if (line === "" || line.startsWith("at ") || line.startsWith("...")) continue;
		kept.push(line.length > 300 ? `${line.slice(0, 300)}…` : line);
	}
	return kept.slice(-maxLines);
}

/** Resolve true when something accepts a TCP connection at `host:port`. */
export function probeTcp(host: string, port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
	return new Promise<boolean>(resolve => {
		let settled = false;
		const socket = createConnection({ host, port });
		const done = (reachable: boolean): void => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(reachable);
		};
		socket.setTimeout(timeoutMs);
		socket.once("connect", () => done(true));
		socket.once("timeout", () => done(false));
		socket.once("error", () => done(false));
	});
}

/** Host and port of an HTTP(S) URL, or undefined when it cannot be parsed. */
function urlTarget(url: string): { host: string; port: number } | undefined {
	try {
		const parsed = new URL(url);
		const port = parsed.port === "" ? (parsed.protocol === "https:" ? 443 : 80) : Number(parsed.port);
		return Number.isFinite(port) && port > 0 ? { host: parsed.hostname, port } : undefined;
	} catch {
		return undefined;
	}
}

/** Loopback targets fail fast and unambiguously, so they are worth pre-flighting. */
function isLoopbackHost(host: string): boolean {
	return host === "localhost" || host === "::1" || host === "[::1]" || /^127\./.test(host);
}

/**
 * Where this client expects IDEA's MCP server, for the reachability probe.
 * stdio always proxies to IDEA on loopback; SSE may point anywhere.
 */
function probeTarget(options: IdeaClientOptions): { host: string; port: number } | undefined {
	if (options.transport === "sse") {
		const target = urlTarget(options.url);
		return target !== undefined && isLoopbackHost(target.host) ? target : undefined;
	}
	const port = Number(options.env.IJ_MCP_SERVER_PORT ?? "");
	return Number.isFinite(port) && port > 0 ? { host: "127.0.0.1", port } : undefined;
}

/** The message shown when nothing is listening where IDEA should be. */
function notListeningHint(options: IdeaClientOptions, host: string, port: number): string {
	const skipped = options.transport === "stdio"
		? `已跳过启动 stdio 代理（${options.command} ${options.args.join(" ")}）。`
		: `端点：${options.url}`;
	return [
		`无法连接 IntelliJ IDEA MCP：${host}:${port} 上没有服务在监听。${skipped}`,
		"通常意味着 IDEA 没有运行，或 Settings | Tools | MCP Server 里的 “Enable MCP Server” 没有勾选；",
		"也可能是插件配置的 port 与 IDEA 实际端口不一致（端口在同一个设置页里可以看到）。",
		"启动 IDEA 后直接重试即可——插件不缓存失败状态，下一次调用会重新连接。",
	].join("\n");
}

/** The endpoint string reported before any connection exists. */
function defaultEndpoint(options: IdeaClientOptions): string {
	if (options.transport === "sse") return options.url;
	return `${options.command} ${options.args.join(" ")}`.trim();
}

/** Actionable connection failure text. */
function connectionHint(options: IdeaClientOptions, error: unknown): string {
	const target = defaultEndpoint(options);
	const detail = messageOf(error);
	if (options.transport === "sse") {
		return [
			`无法连接 IntelliJ IDEA MCP（SSE: ${target}）：${detail}`,
			"请确认 IDEA 已打开，且 Settings | Tools | MCP Server 已勾选 “Enable MCP Server”，端口与本插件配置一致。",
		].join("\n");
	}
	return [
		`无法连接 IntelliJ IDEA MCP（stdio: ${target}）：${detail}`,
		"请确认 IDEA 已打开、Settings | Tools | MCP Server 已启用，并检查插件配置里的 command / port 是否指向本机 IDEA。",
	].join("\n");
}

/**
 * A cached, lazily connected IDEA MCP client. One instance serves every tool
 * call in the plugin; a dead transport is dropped and re-established on the
 * next call.
 */
export class IdeaClient {
	#options: IdeaClientOptions;
	#session: RpcSession | undefined;
	#connecting: Promise<RpcSession> | undefined;
	#idleTimer: ReturnType<typeof setTimeout> | undefined;
	#projectCache: { at: number; projects: string[] } | undefined;
	#server: string | undefined;

	constructor(options: IdeaClientOptions) {
		this.#options = options;
	}

	/** Endpoint description used in status output and error messages. */
	get endpoint(): string {
		return this.#session?.endpoint ?? defaultEndpoint(this.#options);
	}

	/** Call IDEA's router tool with a ready-made command line. */
	async execute(
		command: string,
		call: { projectPath?: string; timeoutMs?: number; signal?: AbortSignal } = {},
	): Promise<IdeaCallResult> {
		throwIfAborted(call.signal);
		const session = await this.#ensure(call.signal);
		const args: Record<string, unknown> = { command };
		if (call.projectPath !== undefined && call.projectPath !== "") args.projectPath = call.projectPath;
		try {
			const result = await session.request(
				"tools/call",
				{ name: "execute_tool", arguments: args },
				call.timeoutMs ?? this.#options.requestTimeoutMs,
				call.signal,
			);
			this.#touchIdle();
			return normalizeToolResult(result);
		} catch (error) {
			if (session.closed) this.#session = undefined;
			throw error;
		}
	}

	/**
	 * Enumerate the IDE's open projects. IDEA only volunteers this list inside
	 * the rejection message of a call made without `projectPath`, so a harmless
	 * `search_file` probe is issued (and its rejection parsed) on purpose.
	 */
	async listOpenProjects(options: { signal?: AbortSignal; force?: boolean } = {}): Promise<string[]> {
		const now = Date.now();
		if (options.force !== true && this.#projectCache !== undefined && now - this.#projectCache.at < PROJECT_CACHE_TTL_MS) {
			return this.#projectCache.projects;
		}
		const result = await this.execute("search_file --q .", { signal: options.signal });
		const projects = result.isError ? parseOpenProjects(result.text) : [];
		this.#projectCache = { at: now, projects };
		return projects;
	}

	/** Connection facts for `idea_status`; never throws. */
	async status(options: { signal?: AbortSignal } = {}): Promise<IdeaConnectionStatus> {
		const status: IdeaConnectionStatus = {
			transport: this.#options.transport,
			endpoint: this.endpoint,
			connected: this.#session !== undefined && !this.#session.closed,
			projects: [],
		};
		if (this.#server !== undefined) status.server = this.#server;
		try {
			status.projects = await this.listOpenProjects({ signal: options.signal, force: true });
			status.connected = this.#session !== undefined && !this.#session.closed;
			if (this.#server !== undefined) status.server = this.#server;
		} catch (error) {
			status.error = messageOf(error);
			status.connected = false;
		}
		return status;
	}

	/** Drop the current connection and clear cached project data. */
	dispose(): void {
		this.#clearIdle();
		this.#projectCache = undefined;
		const session = this.#session;
		this.#session = undefined;
		session?.close();
	}

	async #ensure(signal?: AbortSignal): Promise<RpcSession> {
		throwIfAborted(signal);
		this.#clearIdle();
		const current = this.#session;
		if (current !== undefined && !current.closed) return current;
		this.#session = undefined;
		this.#connecting ??= this.#connect().finally(() => {
			this.#connecting = undefined;
		});
		return await this.#connecting;
	}

	async #connect(): Promise<RpcSession> {
		// Pre-flight the loopback target so a stopped IDE fails in milliseconds with
		// an actionable message, instead of spawning a doomed `idea` proxy (or
		// waiting out the request timeout) on every call.
		const target = probeTarget(this.#options);
		if (target !== undefined && !await probeTcp(target.host, target.port)) {
			throw new ToolError(notListeningHint(this.#options, target.host, target.port));
		}
		const session: RpcSession = this.#options.transport === "sse"
			? new SseSession(this.#options)
			: new StdioSession(this.#options);
		try {
			const result = await session.request(
				"initialize",
				{ protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
				this.#options.requestTimeoutMs,
			);
			session.notify("notifications/initialized");
			this.#server = readServerInfo(result);
			this.#session = session;
			this.#touchIdle();
			this.#options.logger?.debug?.(`[idea-mcp] connected via ${this.#options.transport}: ${session.endpoint}`);
			return session;
		} catch (error) {
			session.close();
			throw new ToolError(connectionHint(this.#options, error), { cause: error });
		}
	}

	#touchIdle(): void {
		this.#clearIdle();
		const idle = this.#options.idleTimeoutMs;
		if (idle <= 0) return;
		this.#idleTimer = setTimeout(() => {
			this.#idleTimer = undefined;
			const session = this.#session;
			this.#session = undefined;
			this.#projectCache = undefined;
			session?.close();
		}, idle);
		// Never keep the host process alive just for the idle timer.
		this.#idleTimer.unref?.();
	}

	#clearIdle(): void {
		if (this.#idleTimer === undefined) return;
		clearTimeout(this.#idleTimer);
		this.#idleTimer = undefined;
	}
}
