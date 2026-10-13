import { describe, expect, test } from "bun:test";
import { buildCommand, formatCommandValue, quoteCommandValue } from "../src/command.js";

describe("quoteCommandValue", () => {
	test("leaves bare-safe strings alone", () => {
		expect(quoteCommandValue("MainController")).toBe("MainController");
		expect(quoteCommandValue("src/main/java/App.java")).toBe("src/main/java/App.java");
		expect(quoteCommandValue("INCOMING_CALLS")).toBe("INCOMING_CALLS");
	});

	test("quotes and escapes anything with whitespace or quotes", () => {
		expect(quoteCommandValue("SELECT * FROM t")).toBe('"SELECT * FROM t"');
		expect(quoteCommandValue('say "hi"')).toBe('"say \\"hi\\""');
		expect(quoteCommandValue("")).toBe('""');
	});

	test("renders numbers as decimals", () => {
		expect(quoteCommandValue(12)).toBe("12");
	});
});

describe("formatCommandValue", () => {
	test("omits absent and false values", () => {
		expect(formatCommandValue(undefined)).toBeUndefined();
		expect(formatCommandValue(null)).toBeUndefined();
		expect(formatCommandValue(false)).toBeUndefined();
	});

	test("renders true with an explicit value", () => {
		// IDEA's parser rejects a bare `--errorsOnly` with
		// "Parameter 'errorsOnly' requires a value".
		expect(formatCommandValue(true)).toBe("true");
	});

	test("renders arrays and objects as bare JSON", () => {
		expect(formatCommandValue(["a/B.java", "c/D.java"])).toBe('["a/B.java","c/D.java"]');
		expect(formatCommandValue({ a: 1 })).toBe('{"a":1}');
	});
});

describe("buildCommand", () => {
	test("joins the tool name with present flags", () => {
		expect(buildCommand("search_symbol", [["q", "MainController"]])).toBe("search_symbol --q MainController");
	});

	test("skips omitted flags entirely", () => {
		expect(buildCommand("get_file_problems", [["filePath", "a/B.java"], ["errorsOnly", false]]))
			.toBe("get_file_problems --filePath a/B.java");
	});

	test("keeps declaration order and encodes every flag with a value", () => {
		expect(buildCommand("lint_files", [["files", ["a", "b"]], ["min_severity", "ERROR"]]))
			.toBe('lint_files --files ["a","b"] --min_severity ERROR');
		expect(buildCommand("build_project", [["rebuild", true]]))
			.toBe("build_project --rebuild true");
	});

	test("emits a bare tool name with no flags", () => {
		expect(buildCommand("git_status")).toBe("git_status");
		expect(buildCommand("get_project_modules", [])).toBe("get_project_modules");
	});
});
