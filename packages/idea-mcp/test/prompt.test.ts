import { describe, expect, test } from "bun:test";
import { IDEA_PROMPT_TEXT, PROMPT_SECTION_NAME, PROMPT_SECTION_ORDER } from "../src/prompt.js";

describe("prompt section", () => {
	test("uses a stable, plugin-namespaced name and a tool-guidance order", () => {
		expect(PROMPT_SECTION_NAME).toBe("plugin:dsh-idea-mcp");
		// Between the harness's TOOL_LSP (2200) and TOOL_SESSION_QUERY (2300).
		expect(PROMPT_SECTION_ORDER).toBeGreaterThan(2200);
		expect(PROMPT_SECTION_ORDER).toBeLessThan(2300);
	});

	test("names every registered tool", () => {
		for (const tool of [
			"idea_search_symbol",
			"idea_search_file",
			"idea_get_symbol_info",
			"idea_get_file_problems",
			"idea_lint_files",
			"idea_analyze_calls",
			"idea_build_project",
			"idea_project_modules",
			"idea_project_dependencies",
			"idea_git_status",
			"idea_projects",
			"idea_status",
			"idea_execute_tool",
		]) {
			expect(IDEA_PROMPT_TEXT).toContain(`\`${tool}\``);
		}
	});

	test("states when the tools win over grep, and when they do not", () => {
		expect(IDEA_PROMPT_TEXT).toContain("semantics rather than text");
		expect(IDEA_PROMPT_TEXT).toContain("overloads");
		// A measured model preference: for a unique literal name, text search is fine.
		expect(IDEA_PROMPT_TEXT).toContain("unique literal name");
	});

	test("removes the need to pre-verify the IDE's state", () => {
		expect(IDEA_PROMPT_TEXT).toContain("resolved automatically");
		expect(IDEA_PROMPT_TEXT).toContain("no need to verify");
	});

	test("warns that call hierarchy stops at the HTTP boundary", () => {
		expect(IDEA_PROMPT_TEXT).toContain("in-JVM callers only");
		expect(IDEA_PROMPT_TEXT).toContain("Spring/REST endpoint");
		expect(IDEA_PROMPT_TEXT).toContain("HTTP side");
	});

	test("states the fallback for a stopped IDE", () => {
		expect(IDEA_PROMPT_TEXT).toContain("idea_status");
		expect(IDEA_PROMPT_TEXT).toContain("127.0.0.1:<port>");
		expect(IDEA_PROMPT_TEXT).toContain("fall back");
		expect(IDEA_PROMPT_TEXT).toContain("MCP Server");
	});

	test("stays small enough to appear in every session", () => {
		expect(IDEA_PROMPT_TEXT.length).toBeLessThan(1_400);
	});
});
