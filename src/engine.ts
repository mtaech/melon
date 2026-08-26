/**
 * Rewrite engine over the ast-grep CLI.
 *
 * All ast-grep invocations operate on a throwaway temp mirror of the target
 * files, never on the real tree: previews are side-effect free, and apply
 * writes real files only after a fresh full pass confirms the staged preview
 * is not stale (totals + per-file counts, mirroring oh-my-pi).
 *
 * Semantics preserved from oh-my-pi's ast_edit:
 * - ops apply cumulatively, sorted by pattern string,
 * - overlapping replacements within one op are a hard error,
 * - a rewrite whose output equals the matched text counts as no change,
 * - files the CLI cannot parse (or languages a pattern cannot compile for)
 *   are silently skipped by ast-grep itself.
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ToolError } from "./errors.js";

export interface ResolvedOp {
	pat: string;
	out: string;
}

/** One effective (content-changing) replacement, in editor-friendly form. */
export interface RewriteMatch {
	/** Real absolute path of the file. */
	file: string;
	/** 0-based line of the match start. */
	line: number;
	/** 0-based column of the match start. */
	column: number;
	/** Matched node text. */
	before: string;
	/** Replacement text (empty when the node is deleted). */
	after: string;
}

export interface RewriteResult {
	/** Effective replacement count per real file. */
	perFileCount: Map<string, number>;
	totalReplacements: number;
	filesTouched: string[];
	/** Effective matches in op order (op rules sorted by pattern string). */
	matches: RewriteMatch[];
	/** Cumulative rewritten content per real file (post-all-ops). */
	finalContents: Map<string, string>;
	/** Non-fatal CLI diagnostics (e.g. pattern parse notes on stderr). */
	warnings: string[];
}

interface CliResult {
	code: number;
	stdout: string;
	stderr: string;
}

function runCli(binary: string, args: string[], signal: AbortSignal): Promise<CliResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(binary, args, {
			stdio: ["ignore", "pipe", "pipe"],
			signal,
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
		child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
		child.on("error", (err) => {
			if (signal.aborted) reject(new ToolError("ast-edit aborted"));
			else reject(new ToolError(`failed to start ast-grep (${binary}): ${err.message}`));
		});
		child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
	});
}

interface RawMatch {
	file: string;
	text: string;
	replacement: string;
	startByte: number;
	endByte: number;
	line: number;
	column: number;
}

function parseMatchStream(stdout: string, mirrorMap: Map<string, string>): RawMatch[] {
	const out: RawMatch[] = [];
	for (const rawLine of stdout.split("\n")) {
		const trimmed = rawLine.trim();
		if (!trimmed) continue;
		let obj: unknown;
		try {
			obj = JSON.parse(trimmed);
		} catch {
			continue; // non-JSON noise (progress etc.)
		}
		if (!obj || typeof obj !== "object") continue;
		const record = obj as {
			file?: unknown;
			text?: unknown;
			replacement?: unknown;
			range?: { byteOffset?: { start?: unknown; end?: unknown }; start?: { line?: unknown; column?: unknown } };
		};
		if (typeof record.file !== "string" || typeof record.text !== "string" || typeof record.replacement !== "string") continue;
		const byteStart = record.range?.byteOffset?.start;
		const byteEnd = record.range?.byteOffset?.end;
		if (typeof byteStart !== "number" || typeof byteEnd !== "number") continue;
		const realFile = mirrorMap.get(record.file);
		if (!realFile) continue;
		const matchLine = record.range?.start?.line;
		const matchColumn = record.range?.start?.column;
		out.push({
			file: realFile,
			text: record.text,
			replacement: record.replacement,
			startByte: byteStart,
			endByte: byteEnd,
			line: typeof matchLine === "number" ? matchLine : 0,
			column: typeof matchColumn === "number" ? matchColumn : 0,
		});
	}
	return out;
}

function assertNoOverlap(matches: RawMatch[], file: string, pat: string): void {
	const sorted = [...matches].sort((a, b) => (a.startByte === b.startByte ? b.endByte - a.endByte : a.startByte - b.startByte));
	for (let i = 1; i < sorted.length; i++) {
		const prev = sorted[i - 1]!;
		const curr = sorted[i]!;
		if (curr.startByte < prev.endByte) {
			throw new ToolError(`Overlapping replacements detected in ${file} for pattern ${JSON.stringify(pat)}; refine pattern to avoid ambiguous edits`);
		}
	}
}

export async function computeRewrite(binary: string, ops: ResolvedOp[], files: string[], contents: ReadonlyMap<string, string>, signal: AbortSignal): Promise<RewriteResult> {
	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-ast-edit-"));
	const mirrorFiles: string[] = [];
	const mirrorMap = new Map<string, string>();
	try {
		for (const [i, file] of files.entries()) {
			const mirror = path.join(tempDir, `${i}_${path.basename(file)}`);
			mirrorFiles.push(mirror);
			mirrorMap.set(mirror, file);
			await fs.writeFile(mirror, contents.get(file) ?? "");
		}

		const perFileCount = new Map<string, number>();
		const matches: RewriteMatch[] = [];
		const warnings: string[] = [];

		for (const op of ops) {
			const json = await runCli(binary, ["run", "-p", op.pat, "-r", op.out, "--json=stream", ...mirrorFiles], signal);
			if (json.code >= 2) {
				throw new ToolError(`ast-grep failed for pattern ${JSON.stringify(op.pat)}: ${(json.stderr || json.stdout).trim().slice(0, 500)}`);
			}
			if (json.code === 1 && json.stderr.trim()) warnings.push(`pattern ${JSON.stringify(op.pat)}: ${json.stderr.trim().slice(0, 300)}`);

			const raw = parseMatchStream(json.stdout, mirrorMap);
			if (raw.length === 0) continue;

			const byFile = new Map<string, RawMatch[]>();
			for (const m of raw) {
				const group = byFile.get(m.file);
				if (group) group.push(m);
				else byFile.set(m.file, [m]);
			}
			for (const [file, group] of byFile) assertNoOverlap(group, file, op.pat);

			const effective = raw.filter((m) => m.replacement !== m.text);
			if (effective.length === 0) continue;

			const write = await runCli(binary, ["run", "-p", op.pat, "-r", op.out, "-U", ...mirrorFiles], signal);
			if (write.code >= 2) {
				throw new ToolError(`ast-grep apply failed for pattern ${JSON.stringify(op.pat)}: ${(write.stderr || write.stdout).trim().slice(0, 500)}`);
			}

			for (const m of effective) {
				perFileCount.set(m.file, (perFileCount.get(m.file) ?? 0) + 1);
				matches.push({ file: m.file, line: m.line, column: m.column, before: m.text, after: m.replacement });
			}
		}

		const finalContents = new Map<string, string>();
		for (const [i, file] of files.entries()) {
			try {
				finalContents.set(file, await fs.readFile(mirrorFiles[i]!, "utf8"));
			} catch {
				// file vanished or unreadable in the mirror; skip it
			}
		}

		const filesTouched = [...perFileCount.keys()];
		return {
			perFileCount,
			totalReplacements: matches.length,
			filesTouched,
			matches,
			finalContents,
			warnings,
		};
	} finally {
		await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
	}
}

/** Validate and normalize model-supplied ops; throws on empty/duplicate patterns. */
export function resolveOps(ops: ReadonlyArray<{ pat?: string; out?: string }>): ResolvedOp[] {
	if (!Array.isArray(ops) || ops.length === 0) {
		throw new ToolError("ops is required: at least one rewrite rule (pat + out)");
	}
	if (ops.length > 50) throw new ToolError("too many rewrite rules (max 50)");
	const seen = new Set<string>();
	const resolved: ResolvedOp[] = [];
	for (const op of ops) {
		const pat = op?.pat?.trim();
		const out = op?.out ?? "";
		if (!pat) throw new ToolError("every rewrite rule needs a non-empty pat");
		if (seen.has(pat)) throw new ToolError(`duplicate rewrite pattern ${JSON.stringify(pat)}`);
		seen.add(pat);
		resolved.push({ pat, out });
	}
	// omp orders rules by pattern string; keep that deterministic order.
	resolved.sort((a, b) => (a.pat < b.pat ? -1 : a.pat > b.pat ? 1 : 0));
	return resolved;
}