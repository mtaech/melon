import { describe, expect, test } from "bun:test";
import { resolveRelayKind, DEFAULT_RELAY_URL } from "../src/relay/kind.js";

describe("resolveRelayKind", () => {
	test("null when disabled", () => {
		expect(resolveRelayKind({ settingEnabled: false }, {})).toBeNull();
	});
	test("null when env explicitly disables", () => {
		expect(resolveRelayKind({ settingEnabled: true }, { DSH_BROWSER_RELAY: "0" })).toBeNull();
	});
	test("enabled via env", () => {
		const kind = resolveRelayKind({ settingEnabled: false }, { DSH_BROWSER_RELAY: "1" });
		expect(kind?.kind).toBe("relay");
		expect(kind?.cdpUrl).toBe(DEFAULT_RELAY_URL);
	});
	test("respects custom url and strips trailing slash", () => {
		const kind = resolveRelayKind({ settingEnabled: true, url: "http://127.0.0.1:9999/" }, {});
		expect(kind?.cdpUrl).toBe("http://127.0.0.1:9999");
	});
	test("env url wins", () => {
		const kind = resolveRelayKind({ settingEnabled: true, url: "http://x:1" }, { DSH_BROWSER_RELAY_URL: "http://y:2" });
		expect(kind?.cdpUrl).toBe("http://y:2");
	});
});