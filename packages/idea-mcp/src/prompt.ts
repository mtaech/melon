/**
 * The system-prompt section this plugin contributes.
 *
 * Tool schemas alone make a plugin discoverable but not *preferred*: a model
 * facing a Java/Vue repository will reach for grep and read unless something
 * tells it that a semantic index is available. `ctx.systemPrompt.section()` is
 * the sanctioned way to add that text — the practices reference explicitly
 * forbids editing the assembled prompt through `system-prompt/assemble`.
 *
 * The text is deliberately conditional: it only claims the tools are the right
 * choice while IDEA is reachable, and names the fallback for when it is not, so
 * a stopped IDE costs the model nothing but one `idea_status` call.
 */

/** Unique section name; scoped contributions with this name shadow the global one. */
export const PROMPT_SECTION_NAME = "plugin:dsh-idea-mcp";

/**
 * Placement next to the built-in tool guidance. The harness allocates
 * `TOOL_LSP: 2200` and `TOOL_SESSION_QUERY: 2300`; IDEA's semantic tooling
 * belongs in the same neighbourhood, after the generic file tools.
 */
export const PROMPT_SECTION_ORDER = 2250;

/** The guidance text, kept short so it earns its place in every session. */
export const IDEA_PROMPT_TEXT = [
	"IntelliJ IDEA tools (`idea_*`) are available: `idea_search_symbol`, `idea_search_file`, `idea_get_symbol_info`,",
	"`idea_get_file_problems`, `idea_lint_files`, `idea_analyze_calls`, `idea_build_project`, `idea_project_modules`,",
	"`idea_project_dependencies`, `idea_git_status`, `idea_projects`, `idea_status`, and `idea_execute_tool`",
	"(raw escape hatch for databases, debugger, coverage, terminal, run configurations).",
	"Their project is resolved automatically from this session's working directory against the projects IDEA has open,",
	"and a mismatch fails with the full list — no need to verify IDEA's state before calling them; `idea_status`",
	"reports transport, IDE version and open projects on demand.",
	"Prefer them when the answer depends on semantics rather than text: symbol lookup across overloads and interfaces,",
	"inspections, unresolved references, call hierarchies, and compile verification against the whole module graph.",
	"For a unique literal name a plain text search is still fine.",
	"`idea_analyze_calls` sees in-JVM callers only — a Spring/REST endpoint has no Java caller, so its real callers are on",
	"the HTTP side; pair it with a text search for the endpoint URL in the frontend.",
	"If `idea_status` reports that nothing listens on `127.0.0.1:<port>`, IDEA is not running or its MCP Server is",
	"disabled: fall back to the ordinary file tools and tell the user to start IDEA.",
].join(" ");
