/**
 * stdio shim around the fake IDEA MCP server: newline-delimited JSON-RPC on
 * stdin/stdout, exactly like `idea stdioMcpServer`.
 */
import { createInterface } from "node:readline";
import { handleRequest } from "./mock-idea.mjs";

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", line => {
	const trimmed = line.trim();
	if (trimmed === "") return;
	let request;
	try {
		request = JSON.parse(trimmed);
	} catch {
		return;
	}
	const response = handleRequest(request);
	if (response !== null) process.stdout.write(`${JSON.stringify(response)}\n`);
});
lines.on("close", () => process.exit(0));
