import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolveCommand, resolveConfig, resolvePort } from "../src/config.js";

const MANAGED = [
	"DSH_IDEA_MCP_ENABLED",
	"DSH_IDEA_MCP_TRANSPORT",
	"DSH_IDEA_MCP_URL",
	"DSH_IDEA_MCP_PORT",
	"DSH_IDEA_MCP_COMMAND",
	"DSH_IDEA_MCP_PROJECT_PATH",
	"DSH_IDEA_MCP_REQUEST_TIMEOUT_MS",
	"IJ_MCP_SERVER_PORT",
	"IJ_MCP_SERVER_PROJECT_PATH",
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
	saved = {};
	for (const key of MANAGED) {
		saved[key] = process.env[key];
		delete process.env[key];
	}
});

afterEach(() => {
	for (const key of MANAGED) {
		const value = saved[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

describe("resolveConfig", () => {
	test("defaults to stdio on IDEA's default port", () => {
		const config = resolveConfig();
		expect(config.enabled).toBe(true);
		expect(config.transport).toBe("stdio");
		expect(config.port).toBe(64342);
		expect(config.url).toBe("http://127.0.0.1:64342/sse");
		expect(config.args).toEqual(["stdioMcpServer"]);
		expect(config.command).not.toBe("");
		expect(config.idleTimeoutMs).toBe(600_000);
	});

	test("derives the SSE url from the resolved port", () => {
		process.env.DSH_IDEA_MCP_PORT = "1234";
		expect(resolveConfig().url).toBe("http://127.0.0.1:1234/sse");
	});

	test("prefers an explicit url over the derived one", () => {
		expect(resolveConfig({ url: "http://10.0.0.9:9999/other" }).url).toBe("http://10.0.0.9:9999/other");
	});

	test("takes the transport from the environment or the config block", () => {
		expect(resolveConfig({ transport: "sse" }).transport).toBe("sse");
		process.env.DSH_IDEA_MCP_TRANSPORT = "sse";
		expect(resolveConfig({ transport: "stdio" }).transport).toBe("sse");
	});
});

describe("resolvePort", () => {
	test("honours the config block, then IDEA's own env var, then the default", () => {
		expect(resolvePort(7000)).toBe(7000);
		process.env.IJ_MCP_SERVER_PORT = "7001";
		expect(resolvePort()).toBe(7001);
		expect(resolvePort(7000)).toBe(7000);
	});

	test("ignores unusable values", () => {
		process.env.IJ_MCP_SERVER_PORT = "not-a-port";
		expect(resolvePort()).toBe(64342);
		expect(resolvePort(0)).toBe(64342);
	});
});

describe("resolveCommand", () => {
	test("prefers the explicit value, then the DSH env, then IDEA's env", () => {
		expect(resolveCommand("/opt/custom/idea")).toBe("/opt/custom/idea");
		process.env.DSH_IDEA_MCP_COMMAND = "/dshenv/idea";
		expect(resolveCommand("/opt/custom/idea")).toBe("/dshenv/idea");
	});

	test("always resolves to a non-empty launcher", () => {
		expect(resolveCommand()).not.toBe("");
		expect(resolveCommand("")).not.toBe("");
	});
});

describe("enabled flag", () => {
	test("DSH_IDEA_MCP_ENABLED=0 disables the plugin", () => {
		process.env.DSH_IDEA_MCP_ENABLED = "0";
		expect(resolveConfig().enabled).toBe(false);
		process.env.DSH_IDEA_MCP_ENABLED = "true";
		expect(resolveConfig().enabled).toBe(true);
	});
});

describe("projectPath", () => {
	test("falls back to IDEA's own environment variable", () => {
		process.env.IJ_MCP_SERVER_PROJECT_PATH = "/work/acme/parent";
		expect(resolveConfig().projectPath).toBe("/work/acme/parent");
	});

	test("expands a leading ~", () => {
		expect(resolveConfig({ projectPath: "~/proj" }).projectPath).toBe(`${process.env.HOME ?? ""}/proj`);
	});
});
