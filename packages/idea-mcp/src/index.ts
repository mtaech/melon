/**
 * dsh-idea-mcp: DSH plugin surface.
 *
 * IntelliJ IDEA ships an MCP server whose only model-facing tool is a router
 * (`execute_tool`) taking a shell-ish command line. This plugin speaks that
 * protocol directly (stdio or SSE) and re-publishes IDEA's capabilities as
 * first-class DSH tools — typed parameters, one tool per job, and `projectPath`
 * resolved automatically from the agent session's cwd — so the model never has
 * to remember flag names, quoting rules, or which project is open.
 *
 * Wire this package into a DSH profile by adding its bundle to the profile's
 * `dsh.profile.bundles` list, or install it with `plugin_manager`.
 */
import type { JsonValue } from "@deepseek-ai/dsh-util-values";
import { IdeaClient, type IdeaClientOptions } from "./client.js";
import { buildCommand } from "./command.js";
import { ideaToolConfigSchema, resolveConfig, type IdeaToolConfig, type IdeaToolConfigInput } from "./config.js";
import { defineTool, type ContentBlock, type Context, type ParameterSchemaSpec, type ToolRunContext } from "./deps.js";
import { ToolError } from "./errors.js";
import { IDEA_PROMPT_TEXT, PROMPT_SECTION_NAME, PROMPT_SECTION_ORDER } from "./prompt.js";
import { formatProjects, pickProject } from "./projects.js";

export const name = "dsh-idea-mcp";
export const inject = ["tools"];

/** Persisted config schema, read by the Loader for the bundle's row. */
export const Config = ideaToolConfigSchema;

/** Author-facing plugin options (the parsed {@link Config}). */
export type IdeaMcpOptions = IdeaToolConfigInput;

/** Canonical result every `idea_*` tool returns. */
export type IdeaToolValue = {
	/** False when IDEA rejected the underlying tool call. */
	ok: boolean;
	/** IDEA's own output, verbatim (usually a JSON document). */
	text: string;
	/** Projects the IDE has open, on the tools that report them. */
	projects?: string[];
	/** `text` parsed as JSON, when it is JSON. */
	data?: JsonValue;
};

/** Output contract shared by every tool in this package. */
const OUTPUT_SCHEMA = {
	type: "object" as const,
	additionalProperties: false as const,
	properties: {
		ok: { type: "boolean" as const, required: true as const },
		text: { type: "string" as const, required: true as const },
		projects: { type: "array" as const, items: { type: "string" as const } },
		data: { type: "json" as const },
	},
};

/** One typed IDEA tool. */
interface IdeaToolSpec<A> {
	name: string;
	description: string;
	parameters: ParameterSchemaSpec;
	/** Cooperative timeout handed to the registry and to the MCP request. */
	timeoutMs?: number;
	/** False for tools that must run without a project scope. */
	needsProject?: boolean;
	/** Map validated arguments to an IDEA `execute_tool` command line. */
	build(args: A): string;
}

/** Install the `idea_*` tools and return the plugin's disposer. */
export function apply(ctx: Context, options: IdeaMcpOptions = {}): (() => void) | void {
	const config = resolveConfig(options);
	if (config.enabled === false) return;
	const tools = ctx.get("tools");
	if (tools === undefined || tools === null) return;

	const client = new IdeaClient(clientOptions(config, ctx));

	registerIdeaTool<IdeaSearchArgs>(ctx, client, config, {
		name: "idea_search_symbol",
		description: [
			"Search the IntelliJ IDEA project index for symbols (classes, methods, fields, files-by-declaration).",
			"Uses IDEA's own index, so results are IDE-accurate and cheap: prefer it over grep for Java/Kotlin/",
			"TypeScript symbol lookups. Returns JSON: {items:[{filePath,startLine,startColumn,endLine,endColumn}]}",
			"with project-relative paths, suitable for passing straight to the other idea_* tools.",
		].join(" "),
		parameters: {
			q: { type: "string", required: true, description: "Symbol name or CamelCase fragment, e.g. MainController or MsmMaintPlan." },
		},
		build: args => buildCommand("search_symbol", [["q", args.q]]),
	});

	registerIdeaTool<IdeaSearchArgs>(ctx, client, config, {
		name: "idea_search_file",
		description: [
			"Search the IntelliJ IDEA project for files by name (fuzzy, extension-insensitive).",
			"Returns JSON: {items:[{filePath,startLine,startColumn,endLine,endColumn}]} with project-relative paths.",
		].join(" "),
		parameters: {
			q: { type: "string", required: true, description: "File name or fragment, e.g. application.yml or MsmMaintPlanController." },
		},
		build: args => buildCommand("search_file", [["q", args.q]]),
	});

	registerIdeaTool<IdeaSymbolInfoArgs>(ctx, client, config, {
		name: "idea_get_symbol_info",
		description: [
			"Read IDEA's Quick Doc and declaration for the symbol at a file position (1-based line and column).",
			"Use after idea_search_symbol to inspect an API contract without opening the file.",
		].join(" "),
		parameters: {
			filePath: { type: "string", required: true, description: "Project-relative path as returned by idea_search_symbol." },
			line: { type: "integer", required: true, description: "1-based line number." },
			column: { type: "integer", required: true, description: "1-based column number." },
		},
		build: args => buildCommand("get_symbol_info", [["filePath", args.filePath], ["line", args.line], ["column", args.column]]),
	});

	registerIdeaTool<IdeaFileProblemsArgs>(ctx, client, config, {
		name: "idea_get_file_problems",
		description: [
			"Run IntelliJ IDEA inspections on one file and return the problems it reports (errors, warnings,",
			"weak warnings, including unresolved references and language-specific issues). Use this to verify an",
			"edit the way the IDE would, rather than guessing from a compiler run.",
		].join(" "),
		parameters: {
			filePath: { type: "string", required: true, description: "Project-relative path of the file to inspect." },
			errorsOnly: { type: "boolean", description: "Only report errors, dropping warnings and weak warnings." },
		},
		build: args => buildCommand("get_file_problems", [["filePath", args.filePath], ["errorsOnly", args.errorsOnly === true]]),
	});

	registerIdeaTool<IdeaLintFilesArgs>(ctx, client, config, {
		name: "idea_lint_files",
		description: [
			"Run IDEA inspections across several files in one pass and return the aggregated problems.",
			"Preferred over one idea_get_file_problems call per file after a multi-file change.",
		].join(" "),
		timeoutMs: 300_000,
		parameters: {
			files: { type: "array", required: true, items: { type: "string" }, description: "Project-relative file paths to inspect." },
			minSeverity: { type: "string", enum: ["ERROR", "WARNING", "WEAK_WARNING", "INFO"], description: "Lowest severity to report; defaults to IDEA's own threshold." },
		},
		build: args => buildCommand("lint_files", [["files", args.files], ["min_severity", args.minSeverity]]),
	});

	registerIdeaTool<IdeaAnalyzeCallsArgs>(ctx, client, config, {
		name: "idea_analyze_calls",
		description: [
			"Answer call-hierarchy questions from IDEA's semantic index instead of text search:",
			"INCOMING_CALLS lists every real caller of a symbol, OUTGOING_CALLS everything it calls.",
			"Far less noisy than grep, and unlike grep it understands overloads and interfaces.",
		].join(" "),
		timeoutMs: 300_000,
		parameters: {
			symbolFqn: { type: "string", required: true, description: "Fully-qualified symbol name, e.g. com.qizhi.cloud.hla.msm.controller.MsmMaintPlanController.list." },
			analysisKind: { type: "string", required: true, enum: ["INCOMING_CALLS", "OUTGOING_CALLS"], description: "Direction of the call hierarchy to compute." },
		},
		build: args => buildCommand("analyze_calls", [["symbolFqn", args.symbolFqn], ["analysisKind", args.analysisKind]]),
	});

	registerIdeaTool<IdeaBuildArgs>(ctx, client, config, {
		name: "idea_build_project",
		description: [
			"Compile the IntelliJ IDEA project (or a subset of files) and return IDEA's own errors and warnings.",
			"This is the authoritative build check for the IDE's project model: it validates the whole module graph,",
			"not just the files touched by the current change. Slow — allow it to finish.",
		].join(" "),
		timeoutMs: 900_000,
		parameters: {
			rebuild: { type: "boolean", description: "Force a full rebuild instead of an incremental build." },
			filesToRebuild: { type: "array", items: { type: "string" }, description: "Restrict the build to these project-relative files." },
		},
		build: args => buildCommand("build_project", [["rebuild", args.rebuild === true], ["filesToRebuild", args.filesToRebuild]]),
	});

	registerIdeaTool<Record<string, never>>(ctx, client, config, {
		name: "idea_project_modules",
		description: "List the IntelliJ IDEA project's modules (name, type, content roots, dependencies summary).",
		parameters: {},
		build: () => buildCommand("get_project_modules"),
	});

	registerIdeaTool<Record<string, never>>(ctx, client, config, {
		name: "idea_project_dependencies",
		description: "List the IntelliJ IDEA project's resolved libraries and inter-module dependencies.",
		parameters: {},
		build: () => buildCommand("get_project_dependencies"),
	});

	registerIdeaTool<Record<string, never>>(ctx, client, config, {
		name: "idea_git_status",
		description: "Read IDEA's VCS view of the project: repositories, current branch, and uncommitted changes per changelist.",
		parameters: {},
		build: () => buildCommand("git_status"),
	});

	registerIdeaTool<IdeaExecuteToolArgs>(ctx, client, config, {
		name: "idea_execute_tool",
		description: [
			"Escape hatch: call any IntelliJ IDEA MCP tool by its raw command line when no dedicated idea_* tool",
			"covers it (databases, debugger, coverage, changelists, terminal, run configurations).",
			"Flags always take a value: write '--errorsOnly true', never a bare '--errorsOnly'.",
			"Format: `<tool_name> --flag value --flag value`, with JSON for array/object values.",
			"Examples: 'list_database_connections', 'execute_sql_query --connectionId X --databaseName d --schemaName s --queryText \"SELECT 1\"',",
			"'xdebug_get_debugger_status', 'rename_refactoring --filePath a/B.java --line 10 --newName C'.",
			"Available commands —",
			"core: search_symbol, search_file, search_text, search_regex, get_symbol_info, get_file_problems, lint_files,",
			"analyze_calls, build_project, get_project_modules, get_project_dependencies, git_status, apply_patch, create_new_file,",
			"list_directory_tree, open_file_in_editor, reformat_file, optimize_imports, rename_refactoring, get_all_open_file_paths,",
			"run_ide_script, get_run_configurations, execute_run_configuration, execute_terminal_command, get_ide_diagnostics,",
			"get_repositories, get_changelists, create_changelist, delete_changelist, move_changes_to_changelist;",
			"database: list_database_connections, test_database_connection, create_database_connection, edit_database_connection,",
			"list_database_schemas, list_schema_objects, list_schema_object_kinds, get_database_object_description, introspect_schema,",
			"execute_sql_query, fetch_query_result, preview_table_data, cancel_sql_query, list_recent_sql_queries;",
			"debugger: xdebug_get_debugger_status, xdebug_start_debugger_session, xdebug_control_session, xdebug_set_breakpoints,",
			"xdebug_remove_breakpoints, xdebug_list_breakpoints, xdebug_get_threads, xdebug_get_stack, xdebug_get_frame_values,",
			"xdebug_get_value_by_path, xdebug_evaluate_expression, xdebug_run_to_line, xdebug_attach_to_process,",
			"xdebug_get_process_output, xdebug_set_variable, xdebug_set_breakpoints_muted;",
			"coverage: coverage_run_configuration, coverage_get_status, coverage_get_stats, coverage_get_file.",
			"Not every command is available in every IDE: database, debugger and coverage tools come from optional IDE",
			"plugins, and an unavailable one answers \"Tool '<name>' not found\".",
			"Prefer the dedicated idea_* tools when one exists — they validate arguments before the call reaches the IDE.",
		].join(" "),
		timeoutMs: 600_000,
		parameters: {
			command: { type: "string", required: true, description: "Raw IDEA tool command line, e.g. 'execute_sql_query --connectionId 1 --queryText \"SELECT 1\"'." },
			projectPath: { type: "string", description: "Override the auto-resolved IDEA project path for this call." },
		},
		build: args => args.command,
	});

	registerProjectTools(ctx, client, config);
	registerPromptSection(ctx);
	return () => {
		client.dispose();
	};
}

/**
 * Tell the model the tools exist, when they are the better choice, and what to
 * do when IDEA is not running. Optional service: a profile without the prompt
 * registry simply gets no guidance text.
 */
function registerPromptSection(ctx: Context): void {
	const systemPrompt = ctx.get("systemPrompt");
	if (systemPrompt === undefined || systemPrompt === null) return;
	ctx.effect(
		() => systemPrompt.section({
			name: PROMPT_SECTION_NAME,
			order: PROMPT_SECTION_ORDER,
			text: IDEA_PROMPT_TEXT,
		}),
		"dsh-idea-mcp: prompt section",
	);
}

/** `idea_status` and `idea_projects`: connection facts, never project-scoped. */
function registerProjectTools(ctx: Context, client: IdeaClient, config: IdeaToolConfig): void {
	const tools = ctx.get("tools");
	if (tools === undefined || tools === null) return;

	tools.register(
		defineTool({
			name: "idea_status",
			description: [
				"Report the DSH↔IntelliJ IDEA MCP bridge state: transport, endpoint, handshake server version, and the",
				"projects the IDE currently has open. Call this first when any idea_* tool fails, or when the agent needs",
				"to know which project the IDE is looking at.",
			].join(" "),
			parameters: {},
			output: {
				schema: OUTPUT_SCHEMA,
				render(_args: unknown, value: unknown): ContentBlock[] {
					return [{ type: "text", text: (value as IdeaToolValue).text }];
				},
			},
			async execute(_args: unknown, exec: ToolRunContext): Promise<IdeaToolValue> {
				const status = await client.status({ signal: exec.signal });
				const lines = [
					`transport: ${status.transport}`,
					`endpoint: ${status.endpoint}`,
					`connected: ${status.connected}`,
					...(status.server === undefined ? [] : [`server: ${status.server}`]),
					...(status.error === undefined ? [] : [`error: ${status.error}`]),
					`open projects (${status.projects.length}):`,
					formatProjects(status.projects),
				];
				return {
					ok: status.error === undefined,
					text: lines.join("\n"),
					projects: status.projects,
					data: { ...status },
				};
			},
		}),
	);

	tools.register(
		defineTool({
			name: "idea_projects",
			description: [
				"List the projects currently open in IntelliJ IDEA, in the order the IDE reports them.",
				"Use it when a call failed because the target project was ambiguous, or to confirm the IDE has the",
				"checkout the agent is working in.",
			].join(" "),
			parameters: {},
			output: {
				schema: OUTPUT_SCHEMA,
				render(_args: unknown, value: unknown): ContentBlock[] {
					return [{ type: "text", text: (value as IdeaToolValue).text }];
				},
			},
			async execute(_args: unknown, exec: ToolRunContext): Promise<IdeaToolValue> {
				const projects = await client.listOpenProjects({ signal: exec.signal, force: true });
				return {
					ok: true,
					text: formatProjects(projects),
					projects,
					data: projects,
				};
			},
		}),
	);
}

/** Register one typed IDEA tool through the shared output contract. */
function registerIdeaTool<A>(
	ctx: Context,
	client: IdeaClient,
	config: IdeaToolConfig,
	spec: IdeaToolSpec<A>,
): void {
	const tools = ctx.get("tools");
	if (tools === undefined || tools === null) return;
	tools.register(
		defineTool({
			name: spec.name,
			description: spec.description,
			parameters: spec.parameters,
			...(spec.timeoutMs === undefined ? {} : { timeoutMs: spec.timeoutMs }),
			output: {
				schema: OUTPUT_SCHEMA,
				render(_args: unknown, value: unknown): ContentBlock[] {
					return [{ type: "text", text: (value as IdeaToolValue).text }];
				},
				presentationMeta(_args: unknown, value: unknown): JsonValue {
					const idea = value as IdeaToolValue;
					return { ok: idea.ok };
				},
			},
			async execute(rawArgs: unknown, exec: ToolRunContext): Promise<IdeaToolValue> {
				const args = rawArgs as A;
				const projectPath = spec.needsProject === false
					? undefined
					: await resolveProjectPath(client, config, exec);
				const result = await client.execute(spec.build(args), {
					projectPath,
					timeoutMs: spec.timeoutMs ?? config.requestTimeoutMs,
					signal: exec.signal,
				});
				return toToolValue(result.text, result.isError);
			},
		}),
	);
}

/** IDEA args for the name-based search tools. */
interface IdeaSearchArgs {
	q: string;
}

interface IdeaSymbolInfoArgs {
	filePath: string;
	line: number;
	column: number;
}

interface IdeaFileProblemsArgs {
	filePath: string;
	errorsOnly?: boolean;
}

interface IdeaLintFilesArgs {
	files: readonly string[];
	minSeverity?: string;
}

interface IdeaAnalyzeCallsArgs {
	symbolFqn: string;
	analysisKind: "INCOMING_CALLS" | "OUTGOING_CALLS";
}

interface IdeaBuildArgs {
	rebuild?: boolean;
	filesToRebuild?: readonly string[];
}

interface IdeaExecuteToolArgs {
	command: string;
	projectPath?: string;
}

/** Resolve the IDEA project a call targets, or explain precisely why it cannot. */
async function resolveProjectPath(client: IdeaClient, config: IdeaToolConfig, exec: ToolRunContext): Promise<string> {
	if (config.projectPath !== "") return config.projectPath;
	const cwd = sessionCwd(exec);
	const projects = await client.listOpenProjects({ signal: exec.signal });
	const picked = pickProject(cwd, projects);
	if (picked !== undefined) return picked;
	if (projects.length === 0) {
		throw new ToolError([
			"IDEA 没有打开任何工程，无法执行该调用。",
			`会话工作目录：${cwd}`,
			"请在 IntelliJ IDEA 里打开目标工程（Settings | Tools | MCP Server 保持启用）后重试。",
		].join("\n"));
	}
	throw new ToolError([
		`无法从会话工作目录确定要操作的 IDEA 工程：${cwd}`,
		"IDEA 当前打开的工程：",
		formatProjects(projects),
		"处理方式：把会话工作目录切到其中某个工程目录下，或改用 idea_execute_tool 显式传 projectPath，",
		"也可以在插件配置里写死 projectPath。",
	].join("\n"));
}

/** The agent session's working directory, falling back to the host process cwd. */
function sessionCwd(exec: ToolRunContext): string {
	const header = exec.agent?.session?.header as { cwd?: string } | undefined;
	return header?.cwd ?? process.cwd();
}

/** Project the IDEA call result into the tools' shared value shape. */
function toToolValue(text: string, isError: boolean): IdeaToolValue {
	const trimmed = text.trim();
	const data = parseJson(trimmed);
	return {
		ok: !isError,
		text: trimmed === "" ? (isError ? "(IDEA returned no detail)" : "(ok)") : trimmed,
		...(data === undefined ? {} : { data }),
	};
}

/** Parse IDEA output as JSON, or report `undefined` for prose output. */
function parseJson(text: string): JsonValue | undefined {
	if (!text.startsWith("{") && !text.startsWith("[")) return undefined;
	try {
		return JSON.parse(text) as JsonValue;
	} catch {
		return undefined;
	}
}

/** Translate resolved config into the client's option shape. */
function clientOptions(config: IdeaToolConfig, ctx: Context): IdeaClientOptions {
	const env: Record<string, string> = { IJ_MCP_SERVER_PORT: String(config.port) };
	if (config.projectPath !== "") env.IJ_MCP_SERVER_PROJECT_PATH = config.projectPath;
	return {
		transport: config.transport,
		command: config.command,
		args: config.args,
		env,
		url: config.url,
		requestTimeoutMs: config.requestTimeoutMs,
		idleTimeoutMs: config.idleTimeoutMs,
		logger: {
			debug: (message: string) => {
				ctx.logger?.debug?.(message);
			},
		},
	};
}
