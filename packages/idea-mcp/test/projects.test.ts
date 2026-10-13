import { describe, expect, test } from "bun:test";
import { formatProjects, parseOpenProjects, pickProject } from "../src/projects.js";

const WORKTREE = "/work/acme/parent/.worktrees/feature-a";
const PROJECTS = ["/work/acme/parent", WORKTREE];

describe("parseOpenProjects", () => {
	test("reads the list out of IDEA's rejection message", () => {
		const text = [
			"Unable to determine the target project for the current MCP tool call.",
			" You may specify the project path via `projectPath` parameter when calling a tool.",
			` Currently open projects: {"projects":[{"path":"/work/acme/parent"},{"path":"${WORKTREE}"}]}`,
		].join("\n");
		expect(parseOpenProjects(text)).toEqual(["/work/acme/parent", WORKTREE]);
	});

	test("returns nothing for prose or malformed payloads", () => {
		expect(parseOpenProjects("Tool 'foo' not found")).toEqual([]);
		expect(parseOpenProjects("Currently open projects: not json")).toEqual([]);
		expect(parseOpenProjects('Currently open projects: {"projects":[]}')).toEqual([]);
	});
});

describe("pickProject", () => {
	test("prefers the deepest project containing cwd", () => {
		expect(pickProject(`${WORKTREE}/module/src`, PROJECTS)).toBe(WORKTREE);
		expect(pickProject("/work/acme/parent/module", PROJECTS)).toBe("/work/acme/parent");
	});

	test("matches the project root itself", () => {
		expect(pickProject(WORKTREE, PROJECTS)).toBe(WORKTREE);
	});

	test("requires a path-segment boundary, not a raw string prefix", () => {
		expect(pickProject("/work/acme/parent2/src", ["/work/acme/parent", "/work/acme/parent2"])).toBe("/work/acme/parent2");
	});

	test("does not treat a name-prefixed sibling as the same project", () => {
		// `${WORKTREE}-two` is not inside the worktree, but it IS inside the parent.
		expect(pickProject(`${WORKTREE}-two/src`, PROJECTS)).toBe("/work/acme/parent");
	});

	test("falls back to the only open project", () => {
		expect(pickProject("/somewhere/else", [WORKTREE])).toBe(WORKTREE);
		expect(pickProject(`${WORKTREE}-two/src`, [WORKTREE])).toBe(WORKTREE);
	});

	test("stays ambiguous with several unrelated projects", () => {
		expect(pickProject("/somewhere/else", PROJECTS)).toBeUndefined();
		expect(pickProject("/somewhere/else", [])).toBeUndefined();
	});
});

describe("formatProjects", () => {
	test("numbers the list and explains an empty IDE", () => {
		expect(formatProjects(PROJECTS)).toBe(`1. /work/acme/parent\n2. ${WORKTREE}`);
		expect(formatProjects([])).toContain("没有打开任何工程");
	});
});
