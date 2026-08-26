import { describe, expect, test } from "bun:test";
import { parseGithubSpec, sourceOf, readLockCommit } from "../src/profile.js";

describe("parseGithubSpec", () => {
	test("parses plain and ref forms", () => {
		expect(parseGithubSpec("github:mtaech/dsh-browser-tool")).toEqual({ user: "mtaech", repo: "dsh-browser-tool", ref: null });
		expect(parseGithubSpec("github:mtaech/dsh-browser-tool#v0.2.0")).toEqual({ user: "mtaech", repo: "dsh-browser-tool", ref: "v0.2.0" });
		expect(parseGithubSpec("github:mtaech/dsh-browser-tool.git")).toEqual({ user: "mtaech", repo: "dsh-browser-tool", ref: null });
		expect(parseGithubSpec("git+https://github.com/mtaech/dsh-plugin-dashboard.git")).toEqual({ user: "mtaech", repo: "dsh-plugin-dashboard", ref: null });
		expect(parseGithubSpec("git+https://github.com/mtaech/dsh-plugin-dashboard.git#v0.2.0")).toEqual({ user: "mtaech", repo: "dsh-plugin-dashboard", ref: "v0.2.0" });
		expect(parseGithubSpec("^0.14.0")).toBeNull();
	});
});

describe("sourceOf", () => {
	test("classifies specifiers", () => {
		expect(sourceOf("github:mtaech/x")).toBe("git");
		expect(sourceOf("git+https://github.com/a/b.git")).toBe("git");
		expect(sourceOf("^0.2.2")).toBe("npm");
		expect(sourceOf("file:../local")).toBe("local");
		expect(sourceOf("workspace:*")).toBe("local");
		expect(sourceOf("")).toBe("unknown");
	});
});

describe("readLockCommit", () => {
	const lock = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:
  .:
    dependencies:
      dsh-browser-tool:
        specifier: github:mtaech/dsh-browser-tool
        version: https://codeload.github.com/mtaech/dsh-browser-tool/tar.gz/e5f13a7555681b0598b7a9a9ec397dfdd9142063
      dsh-better-sidebar:
        specifier: ^0.14.0
        version: 0.14.0
      '@linxin666/dsh-liangshen':
        specifier: ^0.3.2
        version: 0.3.2
    optionalDependencies:
      openpets-v2-workspace:
        specifier: github:alvinunreal/openpets
        version: https://codeload.github.com/alvinunreal/openpets/tar.gz/042844d8e3cd43d8984a2742865d100c3a7be4a4

packages:
  dsh-browser-tool@https://codeload.github.com/mtaech/dsh-browser-tool/tar.gz/e5f13a7555681b0598b7a9a9ec397dfdd9142063:
    resolution: {tarball: https://codeload.github.com/mtaech/dsh-browser-tool/tar.gz/e5f13a7555681b0598b7a9a9ec397dfdd9142063}
    version: 0.1.0
`;

	test("extracts resolved commit from github-installed deps", () => {
		expect(readLockCommit(lock, "dsh-browser-tool")).toBe("e5f13a7555681b0598b7a9a9ec397dfdd9142063");
	});

	test("extracts from optionalDependencies too", () => {
		expect(readLockCommit(lock, "openpets-v2-workspace")).toBe("042844d8e3cd43d8984a2742865d100c3a7be4a4");
	});

	test("npm-installed deps and unknowns return null", () => {
		expect(readLockCommit(lock, "dsh-better-sidebar")).toBeNull();
		expect(readLockCommit(lock, "no-such-package")).toBeNull();
	});

	test("no importers section returns null", () => {
		expect(readLockCommit("lockfileVersion: '9.0'", "x")).toBeNull();
	});
});