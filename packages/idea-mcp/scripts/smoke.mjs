/**
 * End-to-end smoke test: load the built plugin, mount it on a stub tools
 * registry, and drive every `idea_*` tool through a protocol-faithful fake
 * IntelliJ IDEA MCP server — once over stdio and once over SSE. Run with
 * `pnpm run smoke` after a build; it exercises `lib/`, not `src/`.
 */
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apply } from "../lib/index.js";
import { OPEN_PROJECTS, handleRequest } from "./mock-idea.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const STDIO_SHIM = path.join(here, "mock-idea-stdio.mjs");
const WORKTREE = "/work/acme/parent/.worktrees/feature-a";

let failures = 0;

function check(label, condition, detail) {
	if (condition) {
		console.log(`[smoke] ok   ${label}`);
	} else {
		failures += 1;
		console.error(`[smoke] FAIL ${label}${detail === undefined ? "" : ` — ${detail}`}`);
	}
}

/** Mount the plugin and collect the tools and prompt sections it registers. */
function mount(options) {
	const tools = [];
	const sections = [];
	const ctx = {
		get(name) {
			if (name === "tools") {
				return { register: definition => {
					tools.push(definition);
					return () => {};
				} };
			}
			if (name === "systemPrompt") {
				return { section: section => {
					sections.push(section);
					return () => {};
				} };
			}
			return undefined;
		},
		effect(execute) {
			return { dispose: execute() };
		},
		logger: { debug: () => {}, warn: () => {} },
	};
	const dispose = apply(ctx, options);
	return { tools, sections, dispose: typeof dispose === "function" ? dispose : () => {} };
}

/** Minimal ToolRunContext stand-in: cancellation signal + session cwd. */
function runContext(cwd) {
	const controller = new AbortController();
	return { signal: controller.signal, agent: { session: { header: { cwd } } } };
}

/** Call a registered tool by name and return its canonical value. */
async function call(tools, name, args, cwd) {
	const tool = tools.find(candidate => candidate.name === name);
	if (tool === undefined) throw new Error(`tool ${name} was not registered`);
	return await tool.execute(args, runContext(cwd));
}

/** Parse the JSON the fake IDE echoes back. */
function echoed(value) {
	if (value?.data === undefined) throw new Error(`expected JSON data, got ${JSON.stringify(value)}`);
	return value.data;
}

async function startMockSseServer() {
	const streams = new Set();
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		if (request.method === "GET" && url.pathname === "/sse") {
			response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
			response.write(": heartbeat\n\n");
			response.write(`event: endpoint\ndata: /message?sessionId=mock-session\n\n`);
			streams.add(response);
			request.on("close", () => streams.delete(response));
			return;
		}
		if (request.method === "POST" && url.pathname === "/message") {
			let body = "";
			request.on("data", chunk => {
				body += chunk;
			});
			request.on("end", () => {
				response.writeHead(202, { "content-type": "text/plain" });
				response.end("Accepted");
				let parsed;
				try {
					parsed = JSON.parse(body);
				} catch {
					return;
				}
				const reply = handleRequest(parsed);
				if (reply === null) return;
				const frame = `event: message\ndata: ${JSON.stringify(reply)}\n\n`;
				for (const stream of streams) stream.write(frame);
			});
			return;
		}
		response.writeHead(404);
		response.end();
	});
	await new Promise(resolve => {
		server.listen(0, "127.0.0.1", resolve);
	});
	const port = server.address().port;
	return {
		url: `http://127.0.0.1:${port}/sse`,
		close: () => {
			for (const stream of streams) stream.end();
			server.close();
		},
	};
}

/** The assertions both transports must satisfy. */
async function exercise(label, tools, sections) {
	const names = tools.map(tool => tool.name).sort();
	check(`${label}: registers 13 tools`, tools.length === 13, `got ${tools.length}: ${names.join(", ")}`);
	check(`${label}: has idea_search_symbol`, names.includes("idea_search_symbol"));
	check(`${label}: has idea_execute_tool`, names.includes("idea_execute_tool"));

	const section = sections[0];
	check(`${label}: contributes exactly one prompt section`, sections.length === 1, `got ${sections.length}`);
	check(`${label}: prompt section has the stable name`, section?.name === "plugin:dsh-idea-mcp", String(section?.name));
	check(`${label}: prompt section sits with the tool guidance`, section?.order === 2250, String(section?.order));
	check(
		`${label}: prompt section names the tools and the fallback`,
		typeof section?.text === "string"
			&& section.text.includes("idea_search_symbol")
			&& section.text.includes("idea_status")
			&& section.text.includes("fall back"),
		String(section?.text).slice(0, 120),
	);

	const search = await call(tools, "idea_search_symbol", { q: "MainController" }, `${WORKTREE}/module/src`);
	check(`${label}: search_symbol command`, echoed(search).command === "search_symbol --q MainController", JSON.stringify(search.data));
	check(`${label}: deepest project wins`, echoed(search).projectPath === WORKTREE, JSON.stringify(search.data));

	const lint = await call(tools, "idea_lint_files", {
		files: ["a/B.java", "c/D.java"],
		minSeverity: "ERROR",
	}, `${WORKTREE}/module`);
	check(
		`${label}: lint_files JSON array + severity`,
		echoed(lint).command === 'lint_files --files ["a/B.java","c/D.java"] --min_severity ERROR',
		JSON.stringify(lint.data),
	);

	const problems = await call(tools, "idea_get_file_problems", { filePath: "a/B.java", errorsOnly: true }, WORKTREE);
	check(`${label}: boolean flag carries an explicit value`, echoed(problems).command === "get_file_problems --filePath a/B.java --errorsOnly true", JSON.stringify(problems.data));

	const quiet = await call(tools, "idea_get_file_problems", { filePath: "a/B.java" }, WORKTREE);
	check(`${label}: absent boolean is omitted`, echoed(quiet).command === "get_file_problems --filePath a/B.java", JSON.stringify(quiet.data));

	const calls = await call(tools, "idea_analyze_calls", {
		symbolFqn: "com.acme.Main.list",
		analysisKind: "INCOMING_CALLS",
	}, WORKTREE);
	check(`${label}: analyze_calls`, echoed(calls).command === "analyze_calls --symbolFqn com.acme.Main.list --analysisKind INCOMING_CALLS");

	const escaped = await call(tools, "idea_execute_tool", {
		command: 'execute_sql_query --connectionId 1 --queryText "SELECT * FROM t"',
	}, WORKTREE);
	check(`${label}: escape hatch passes the command through verbatim`, echoed(escaped).command === 'execute_sql_query --connectionId 1 --queryText "SELECT * FROM t"');

	const projects = await call(tools, "idea_projects", {}, WORKTREE);
	check(`${label}: idea_projects lists the IDE's projects`, JSON.stringify(projects.projects) === JSON.stringify(OPEN_PROJECTS), JSON.stringify(projects.projects));

	const status = await call(tools, "idea_status", {}, WORKTREE);
	check(`${label}: idea_status reports the handshake server`, status.text.includes("Mock IntelliJ IDEA MCP Server"), status.text);

	let ambiguous;
	try {
		await call(tools, "idea_git_status", {}, "/tmp/elsewhere");
	} catch (error) {
		ambiguous = error;
	}
	check(
		`${label}: unmatched cwd fails with the project list`,
		ambiguous !== undefined && String(ambiguous.message).includes("无法从会话工作目录确定") && String(ambiguous.message).includes(OPEN_PROJECTS[1]),
		ambiguous === undefined ? "no error thrown" : String(ambiguous),
	);

	const override = await call(tools, "idea_git_status", {}, WORKTREE);
	check(`${label}: git_status needs no arguments`, echoed(override).command === "git_status", JSON.stringify(override.data));
}

/** A port that was just released, so nothing is listening on it. */
async function freePort() {
	const server = createTcpServer();
	await new Promise(resolve => {
		server.listen(0, "127.0.0.1", resolve);
	});
	const port = server.address().port;
	await new Promise(resolve => {
		server.close(resolve);
	});
	return port;
}

/**
 * The "IDEA is not running" path: mounting must stay silent, and a call must
 * fail fast with an actionable message instead of spawning a doomed proxy.
 */
async function exerciseStoppedIde() {
	const port = await freePort();

	const sseMount = mount({ transport: "sse", url: `http://127.0.0.1:${port}/sse`, requestTimeoutMs: 120_000 });
	check("stopped IDE: mounting registers tools without connecting", sseMount.tools.length === 13, `got ${sseMount.tools.length}`);
	check("stopped IDE: guidance section is still registered", sseMount.sections.length === 1, `got ${sseMount.sections.length}`);
	let sseError;
	let sseStarted = Date.now();
	try {
		await call(sseMount.tools, "idea_search_symbol", { q: "X" }, WORKTREE);
	} catch (error) {
		sseError = error;
	}
	sseStarted = Date.now() - sseStarted;
	check(
		"stopped IDE: sse fails fast with the not-listening hint",
		sseError !== undefined && String(sseError.message).includes("没有服务在监听"),
		sseError === undefined ? "no error thrown" : String(sseError).slice(0, 200),
	);
	check("stopped IDE: sse does not wait out the 120s request timeout", sseStarted < 5_000, `${sseStarted}ms`);
	sseMount.dispose();

	// A stdio mount pointed at the same dead port must not even start the proxy.
	const marker = path.join(mkdtempSync(path.join(tmpdir(), "idea-mcp-smoke-")), "spawned.marker");
	const stdioMount = mount({
		transport: "stdio",
		command: process.execPath,
		args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "spawned")`],
		port,
		requestTimeoutMs: 120_000,
	});
	let stdioError;
	const stdioStarted = Date.now();
	try {
		await call(stdioMount.tools, "idea_git_status", {}, WORKTREE);
	} catch (error) {
		stdioError = error;
	}
	const stdioElapsed = Date.now() - stdioStarted;
	check(
		"stopped IDE: stdio fails fast with the not-listening hint",
		stdioError !== undefined && String(stdioError.message).includes("没有服务在监听"),
		stdioError === undefined ? "no error thrown" : String(stdioError).slice(0, 200),
	);
	check("stopped IDE: stdio never spawns the proxy", !existsSync(marker), "proxy was spawned despite the dead port");
	check("stopped IDE: stdio does not wait out the request timeout", stdioElapsed < 5_000, `${stdioElapsed}ms`);

	// idea_status reports the outage without throwing.
	const status = await call(stdioMount.tools, "idea_status", {}, WORKTREE);
	check("stopped IDE: idea_status reports the outage instead of throwing", status.ok === false && status.text.includes("connected: false"), status.text.slice(0, 160));
	stdioMount.dispose();
}

async function main() {
	const sse = await startMockSseServer();
	const sseMount = mount({ transport: "sse", url: sse.url, requestTimeoutMs: 15_000, idleTimeoutMs: 0 });
	try {
		await exercise("sse", sseMount.tools, sseMount.sections);
	} finally {
		sseMount.dispose();
		sse.close();
	}

	const stdioMount = mount({
		transport: "stdio",
		command: process.execPath,
		args: [STDIO_SHIM],
		requestTimeoutMs: 15_000,
		idleTimeoutMs: 0,
	});
	try {
		await exercise("stdio", stdioMount.tools, stdioMount.sections);
	} finally {
		stdioMount.dispose();
	}

	await exerciseStoppedIde();

	if (failures > 0) {
		console.error(`[smoke] FAILED: ${failures} assertion(s)`);
		process.exitCode = 1;
	} else {
		console.log("[smoke] OK: every idea_* tool round-tripped over stdio and SSE, and a stopped IDE fails fast");
	}
}

await main();
