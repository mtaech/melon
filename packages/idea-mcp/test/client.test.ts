import { afterAll, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:net";
import { condenseStderr, probeTcp } from "../src/client.js";

/** Bind a throwaway server so the probe has something real to talk to. */
function listen(): Promise<{ server: Server; port: number }> {
	return new Promise(resolve => {
		const server = createServer();
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			resolve({ server, port: typeof address === "object" && address !== null ? address.port : 0 });
		});
	});
}

describe("condenseStderr", () => {
	test("drops Java stack frames, '... N more' lines and blanks", () => {
		expect(condenseStderr([
			"",
			"\tat java.net.http/jdk.internal.net.http.PlainHttpConnection.connectAsync(PlainHttpConnection.java:223)",
			"365 [ERROR] xplat_launcher::java: [JVM] main method failed: JavaException",
			"Caused by: java.net.ConnectException",
			"\t... 12 more",
		])).toEqual([
			"365 [ERROR] xplat_launcher::java: [JVM] main method failed: JavaException",
			"Caused by: java.net.ConnectException",
		]);
	});

	test("keeps only the newest lines", () => {
		const lines = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`);
		expect(condenseStderr(lines, 3)).toEqual(["line 10", "line 11", "line 12"]);
	});

	test("truncates a pathologically long line", () => {
		const [only] = condenseStderr([`x`.repeat(500)]);
		expect(only).toBeDefined();
		expect((only ?? "").length).toBe(301);
	});

	test("returns nothing for input that is entirely noise", () => {
		expect(condenseStderr(["\tat foo.bar(Baz.java:1)", ""])).toEqual([]);
	});
});

describe("probeTcp", () => {
	const started: Server[] = [];
	afterAll(() => {
		for (const server of started) server.close();
	});

	test("reports a listening port as reachable, and a closed one as unreachable", async () => {
		const { server, port } = await listen();
		started.push(server);
		expect(await probeTcp("127.0.0.1", port)).toBe(true);

		const dead = await listen();
		const deadPort = dead.port;
		await new Promise<void>(resolve => dead.server.close(() => resolve()));
		// The port is now free; nothing listens there.
		expect(await probeTcp("127.0.0.1", deadPort)).toBe(false);
	});

	test("gives up on a port nothing answers on", async () => {
		const started_at = Date.now();
		expect(await probeTcp("127.0.0.1", 6)).toBe(false);
		expect(Date.now() - started_at).toBeLessThan(2_000);
	});
});
