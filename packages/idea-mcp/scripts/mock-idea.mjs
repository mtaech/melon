/**
 * A fake IntelliJ IDEA MCP server, protocol-faithful enough to drive the
 * plugin end to end without an IDE. Shared by the stdio shim
 * (`mock-idea-stdio.mjs`) and the SSE server embedded in `smoke.mjs`.
 *
 * It reproduces the behaviour this plugin actually depends on:
 * - `tools/list` publishes only the router tool `execute_tool`;
 * - a routed call WITHOUT `projectPath` is rejected with IDEA's
 *   "Unable to determine the target project" message plus the open-project list;
 * - a routed call WITH `projectPath` echoes the command line back as JSON so
 *   the test can assert exactly what would have been sent to the IDE.
 */

/** Projects the fake IDE reports as open (a parent checkout plus a worktree). */
export const OPEN_PROJECTS = ["/work/acme/parent", "/work/acme/parent/.worktrees/feature-a"];

/** Build the rejection text IDEA returns when it cannot pick a project. */
export function unableToDetermineProject(projects = OPEN_PROJECTS) {
	return [
		"Unable to determine the target project for the current MCP tool call.",
		" You may specify the project path via `projectPath` parameter when calling a tool.",
		" Currently open projects: " + JSON.stringify({ projects: projects.map(path => ({ path })) }),
	].join("\n");
}

/** Handle one JSON-RPC request; returns the response object, or null for notifications. */
export function handleRequest(request) {
	if (request === null || typeof request !== "object") return null;
	if (request.id === undefined || request.id === null) return null;
	const base = { jsonrpc: "2.0", id: request.id };
	if (request.method === "initialize") {
		return {
			...base,
			result: {
				protocolVersion: "2024-11-05",
				capabilities: { tools: { listChanged: true } },
				serverInfo: { name: "Mock IntelliJ IDEA MCP Server", version: "2026.3-test" },
			},
		};
	}
	if (request.method === "tools/list") {
		return {
			...base,
			result: {
				tools: [{
					name: "execute_tool",
					description: "Universal tool executor that can invoke specific IDE MCP tool dynamically.",
					inputSchema: {
						type: "object",
						properties: {
							command: { type: "string" },
							projectPath: { type: "string" },
						},
						required: ["command"],
					},
				}],
			},
		};
	}
	if (request.method === "tools/call") {
		const args = request.params?.arguments ?? {};
		if (request.params?.name !== "execute_tool") {
			return { ...base, result: { content: [{ type: "text", text: `unknown tool ${String(request.params?.name)}` }], isError: true } };
		}
		if (typeof args.projectPath !== "string" || args.projectPath === "") {
			return { ...base, result: { content: [{ type: "text", text: unableToDetermineProject() }], isError: true } };
		}
		return {
			...base,
			result: {
				content: [{
					type: "text",
					text: JSON.stringify({ ok: true, command: args.command, projectPath: args.projectPath }),
				}],
				isError: false,
			},
		};
	}
	return { ...base, error: { code: -32601, message: `Method not found: ${String(request.method)}` } };
}
