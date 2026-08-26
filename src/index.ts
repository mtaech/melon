/**
 * dsh-ast-edit-tool: DSH plugin surface. Registers one `ast_edit` tool that
 * previews and applies structural (AST-aware) rewrites via the bundled
 * ast-grep binary, ported from oh-my-pi's ast_edit semantics:
 * preview-first, staged proposal, apply-verifies-staleness, reject discards.
 *
 * Wire this package into a DSH profile by adding its built bundle to the
 * profile's `package.json > dsh.profile.bundles` list.
 */
import { promises as fs } from "node:fs";
import { ToolError } from "./errors.js";
import { resolveConfig, astEditConfigSchema, type AstEditConfig } from "./config.js";
import { resolveAstGrepBinary } from "./binary.js";
import { collectFiles } from "./files.js";
import { computeRewrite, resolveOps, type RewriteMatch, type ResolvedOp } from "./engine.js";
import { staging, type StagedRewrite } from "./staging.js";
import { defineTool, type Context, type ToolRunContext } from "./deps.js";

export const name = "dsh-ast-edit-tool";
export const inject = ["tools"];

export const Config = astEditConfigSchema;

/** Author-facing parameter schema (dsh-tools ValueSchemaSpec DSL). */
const parameters = {
	ops: {
		type: "array" as const,
		description:
			"One or more rewrite rules. Each rule: pat is an ast-grep pattern using $NAME / $_ / $$$NAME metavariables (uppercase, each standing for a whole AST node); out is the replacement, $NAME captures from pat substitute into out, and an empty out deletes the matched node. Duplicate pat values fail.",
		items: {
			type: "object" as const,
			additionalProperties: false as const,
			properties: {
				pat: { type: "string" as const, required: true as const, description: "ast-grep pattern; metavariable names must be uppercase and stand for whole AST nodes." },
				out: { type: "string" as const, required: true as const, description: "Replacement template; $NAME / $$$NAME captures from pat substitute in. Empty deletes the match." },
			},
		},
	},
	paths: {
		type: "array" as const,
		description:
			"Files, directories, or globs to rewrite. Directories are scanned recursively (hidden files included, node_modules skipped unless named in a path). At least one non-empty entry is required.",
		items: { type: "string" as const },
	},
	action: {
		type: "string" as const,
		enum: ["preview" as const, "apply" as const, "reject" as const],
		description:
			"preview (default): stage the rewrite in memory and show the proposed edits; files are NOT modified. apply: write the staged rewrite, requiring the stagedId returned by its preview; a stale preview is rejected. reject: discard the staged rewrite without touching files.",
	},
	stagedId: {
		type: "string" as const,
		description: "Proposal id returned by a preview; required for apply and reject.",
	},
};

const outputSchema = {
	type: "object" as const,
	additionalProperties: false as const,
	properties: {
		ok: { type: "boolean" as const, required: true as const },
		action: { type: "string" as const, enum: ["preview" as const, "apply" as const, "reject" as const], required: true as const },
		applied: { type: "boolean" as const, required: true as const },
		totalReplacements: { type: "integer" as const, required: true as const },
		filesTouched: { type: "integer" as const, required: true as const },
		filesSearched: { type: "integer" as const, required: true as const },
		limitReached: { type: "boolean" as const, required: true as const },
		stagedId: { type: "string" as const },
		message: { type: "string" as const },
		changes: {
			type: "array" as const,
			items: {
				type: "object" as const,
				additionalProperties: false as const,
				properties: {
					file: { type: "string" as const, required: true as const },
					line: { type: "integer" as const, required: true as const },
					column: { type: "integer" as const, required: true as const },
					before: { type: "string" as const, required: true as const },
					after: { type: "string" as const, required: true as const },
				},
			},
		},
		parseErrors: {
			type: "array" as const,
			items: {
				type: "object" as const,
				additionalProperties: false as const,
				properties: {
					kind: { type: "string" as const, required: true as const },
					file: { type: "string" as const },
					message: { type: "string" as const, required: true as const },
				},
			},
		},
	},
};

export interface AstEditValue {
	ok: boolean;
	action: "preview" | "apply" | "reject";
	applied: boolean;
	totalReplacements: number;
	filesTouched: number;
	filesSearched: number;
	limitReached: boolean;
	stagedId?: string;
	message?: string;
	changes?: Array<{ file: string; line: number; column: number; before: string; after: string }>;
	parseErrors?: Array<{ kind: string; file?: string; message: string }>;
}

const SNIPPET_LIMIT = 120;
const PARSE_ERRORS_LIMIT = 20;

function truncate(s: string, limit = SNIPPET_LIMIT): string {
	return s.length > limit ? `${s.slice(0, limit)}…` : s;
}

function toValue(matches: RewriteMatch[], cap: number): AstEditValue["changes"] {
	return matches.slice(0, cap).map((m) => ({
		file: m.file,
		line: m.line + 1, // 1-based for humans
		column: m.column + 1,
		before: truncate(m.before),
		after: truncate(m.after),
	}));
}

interface BuildNoticeOptions {
	limitReached?: boolean;
	changesTruncated?: number;
	warnings?: string[];
	parseErrors?: AstEditValue["parseErrors"];
}

function buildMessage(action: "preview" | "apply" | "reject", staged: StagedRewrite, counts: { total: number; touched: number }, notices: BuildNoticeOptions = {}): string {
	const lines: string[] = [];
	if (action === "apply") {
		lines.push(`Applied ${counts.total} replacements in ${counts.touched} files.`);
	} else if (action === "reject") {
		lines.push("Discarded staged rewrite; files unchanged.");
	} else {
		if (counts.total > 0) {
			lines.push("Staged as a proposal — files NOT modified yet.");
		} else {
			lines.push("No replacements made");
		}
	}
	if (notices.limitReached) lines.push("Limit reached; narrow paths.");
	if (notices.changesTruncated) lines.push(`Preview truncated at ${notices.changesTruncated} changes; narrow paths.`);
	for (const w of notices.warnings ?? []) lines.push(`Note: ${w}`);
	for (const e of notices.parseErrors ?? []) lines.push(`Note: ${e.kind === "pattern" ? e.message : `${e.file}: ${e.message}`}`);
	void staged;
	return lines.join("\n") || "No replacements made";
}

function collectionError(file: string, error: unknown): { kind: string; file: string; message: string } {
	return { kind: "read", file, message: error instanceof Error ? error.message : String(error) };
}

export function apply(ctx: Context, options: Partial<AstEditConfig> = {}): (() => void) | void {
	const config = resolveConfig(options);
	if (!config.enabled) return;

	const binary = resolveAstGrepBinary(config.binaryPath) ?? "";
	if (!binary) {
		throw new Error("ast-edit: ast-grep binary not found. Install the @ast-grep/cli package (or set DSH_AST_GREP_BINARY / astEdit.binaryPath).");
	}
	const tools = ctx.get("tools");
	if (!tools) return;

	return tools.register(
		defineTool({
			name: "ast_edit",
			description: [
				"Preview and apply structural (AST-aware) rewrites over source files via ast-grep.",
				"Rules use $NAME / $_ / $$$NAME metavariables that stand for whole AST nodes; captures from pat substitute into out, and an empty out deletes the matched node.",
				"Always previews first and stages the proposal: files are not modified until an apply with the returned stagedId, and a stale preview is rejected.",
			].join(" "),
			parameters,
			timeoutMs: 300_000,
			output: {
				schema: outputSchema,
				render(_args: unknown, rawValue: unknown): ContentBlockText[] {
					const value = rawValue as AstEditValue;
					const lines: string[] = [];
					if (value.message) lines.push(value.message);
					for (const change of value.changes ?? []) {
						lines.push(`[${change.file}]`);
						lines.push(`-${change.line}:${change.column} ${change.before}`);
						lines.push(`+${change.line}:${change.column} ${change.after}`);
					}
					return [{ type: "text", text: lines.join("\n") || "(no output)" }];
				},
				presentationMeta(_args: unknown, rawValue: unknown) {
					const value = rawValue as AstEditValue;
					return { action: value.action, ok: value.ok, replacements: value.totalReplacements, filesTouched: value.filesTouched };
				},
			},
			isConcurrencySafe(args: AstEditArgs): boolean {
				return !args.action || args.action === "preview";
			},
			async execute(rawArgs: unknown, exec: ToolRunContext): Promise<AstEditValue> {
				if (exec.signal.aborted) throw new ToolError("ast_edit aborted");
				const args = rawArgs as AstEditArgs;
				const action = args.action ?? "preview";
				if (action === "preview") {
					const ops = resolveOps(args.ops ?? []);
					if (!Array.isArray(args.paths) || args.paths.length === 0 || args.paths.every((p) => !p?.trim())) {
						throw new ToolError("paths is required: at least one non-empty file, directory, or glob");
					}
					const sessionId = (exec.agent?.session?.id ?? "anonymous") as string;
					const cwd = ((exec.agent?.session?.header as { cwd?: string } | undefined)?.cwd ?? process.cwd()) as string;
					return doPreview(args, ops, exec, config, cwd, sessionId);
				}
				const sessionId = (exec.agent?.session?.id ?? "anonymous") as string;
				const cwd = ((exec.agent?.session?.header as { cwd?: string } | undefined)?.cwd ?? process.cwd()) as string;
				switch (action) {
					case "apply":
						return doApply(args, [], exec, config, cwd, sessionId);
					case "reject":
						return doReject(args, exec, sessionId);
					default:
						throw new ToolError(`unknown action ${String(action)}`);
				}
			},
		}),
	);
}

type ContentBlockText = { type: "text"; text: string };

interface AstEditArgs {
	ops?: Array<{ pat?: string; out?: string }>;
	paths?: string[];
	action?: "preview" | "apply" | "reject";
	stagedId?: string;
}

async function doPreview(args: AstEditArgs, ops: ResolvedOp[], exec: ToolRunContext, config: AstEditConfig, cwd: string, sessionId: string): Promise<AstEditValue> {
	const collected = await collectFiles(args.paths ?? [], { cwd, maxFiles: config.maxFiles });
	if (collected.files.length === 0) {
		return { ok: true, action: "preview", applied: false, totalReplacements: 0, filesTouched: 0, filesSearched: collected.searchedCount, limitReached: collected.limitReached, message: "No files matched the given paths." };
	}

	const contents = new Map<string, string>();
	const parseErrors: AstEditValue["parseErrors"] = [];
	for (const file of collected.files) {
		try {
			contents.set(file, await fs.readFile(file, "utf8"));
		} catch (error) {
			parseErrors.push(collectionError(file, error));
		}
	}
	const parseable = collected.files.filter((f) => contents.has(f));
	if (parseable.length === 0) {
		return { ok: true, action: "preview", applied: false, totalReplacements: 0, filesTouched: 0, filesSearched: collected.searchedCount, limitReached: collected.limitReached, message: "No readable files matched the given paths.", parseErrors: parseErrors.slice(0, PARSE_ERRORS_LIMIT) };
	}

	const result = await computeRewrite(binary(config), ops, parseable, contents, exec.signal);
	const warnings = result.warnings;
	const totalWarnings = warnings.length;
	const mergedErrors = [...parseErrors, ...warnings.map((w) => ({ kind: "pattern" as const, message: w }))];

	const entry = staging.create({
		sessionId,
		ops,
		paths: args.paths ?? [],
		files: parseable,
		totalReplacements: result.totalReplacements,
		filesTouched: result.filesTouched,
		perFileCount: Object.fromEntries(result.perFileCount),
	});

	const changes = toValue(result.matches, config.maxRenderChanges);
	const truncated = result.matches.length > config.maxRenderChanges ? config.maxRenderChanges : undefined;
	const message = buildMessage("preview", entry, { total: result.totalReplacements, touched: result.filesTouched.length }, {
		limitReached: collected.limitReached,
		changesTruncated: truncated,
		warnings: totalWarnings ? warnings.slice(0, PARSE_ERRORS_LIMIT) : undefined,
		parseErrors: mergedErrors.length ? mergedErrors.slice(0, PARSE_ERRORS_LIMIT) : undefined,
	});
	return {
		ok: true,
		action: "preview",
		applied: false,
		totalReplacements: result.totalReplacements,
		filesTouched: result.filesTouched.length,
		filesSearched: collected.searchedCount,
		limitReached: collected.limitReached,
		stagedId: entry.id,
		message,
		changes,
		parseErrors: mergedErrors.length ? mergedErrors.slice(0, PARSE_ERRORS_LIMIT) : undefined,
	};
}

async function doApply(args: AstEditArgs, _ops: ResolvedOp[], exec: ToolRunContext, config: AstEditConfig, cwd: string, sessionId: string): Promise<AstEditValue> {
	if (!args.stagedId) throw new ToolError("stagedId is required for apply; run a preview first");
	const entry = staging.get(args.stagedId, sessionId);
	if (!entry) throw new ToolError(`unknown or expired stagedId ${args.stagedId}; run a preview again`);

	const live = new Map<string, string>();
	for (const file of entry.files) {
		try {
			live.set(file, await fs.readFile(file, "utf8"));
		} catch {
			throw new ToolError(`file changed or unreadable since preview: ${file}; re-run the preview`);
		}
	}

	const result = await computeRewrite(binary(config), entry.ops, entry.files, live, exec.signal);

	// staleness: totals + per-file counts must match the preview exactly (omp parity)
	if (result.totalReplacements !== entry.totalReplacements) {
		throw new ToolError(`staged rewrite is stale (replacement count changed ${entry.totalReplacements} → ${result.totalReplacements}); re-run the preview`);
	}
	for (const [file, count] of result.perFileCount) {
		if ((entry.perFileCount[file] ?? 0) !== count) {
			throw new ToolError(`staged rewrite is stale (file ${file} changed); re-run the preview`);
		}
	}

	// write only the files whose content actually changed
	const writeErrors: string[] = [];
	for (const [file, content] of result.finalContents) {
		if (live.get(file) === content) continue;
		try {
			await fs.writeFile(file, content);
		} catch (error) {
			writeErrors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	if (writeErrors.length) {
		throw new ToolError(`apply wrote only some files, then failed: ${writeErrors.join("; ")}`);
	}

	staging.drop(entry.id);
	const message = buildMessage("apply", entry, { total: result.totalReplacements, touched: result.filesTouched.length }, { warnings: result.warnings });
	return {
		ok: true,
		action: "apply",
		applied: true,
		totalReplacements: result.totalReplacements,
		filesTouched: result.filesTouched.length,
		filesSearched: entry.files.length,
		limitReached: false,
		message,
	};
}

async function doReject(args: AstEditArgs, exec: ToolRunContext, sessionId: string): Promise<AstEditValue> {
	if (!args.stagedId) throw new ToolError("stagedId is required for reject; run a preview first");
	const entry = staging.get(args.stagedId, sessionId);
	if (!entry) throw new ToolError(`unknown or expired stagedId ${args.stagedId}; run a preview again`);
	staging.drop(entry.id);
	return {
		ok: true,
		action: "reject",
		applied: false,
		totalReplacements: 0,
		filesTouched: 0,
		filesSearched: entry.files.length,
		limitReached: false,
		message: "Discarded staged rewrite; files unchanged.",
	};
}

function binary(config: AstEditConfig): string {
	const resolved = resolveAstGrepBinary(config.binaryPath);
	if (!resolved) throw new ToolError("ast-grep binary not found; install @ast-grep/cli or set DSH_AST_GREP_BINARY");
	return resolved;
}