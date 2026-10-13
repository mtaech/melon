/**
 * Plugin configuration for dsh-idea-mcp.
 *
 * Precedence, highest first:
 *   1. `DSH_IDEA_MCP_*` environment variables (explicit, plugin-specific)
 *   2. the bundle's config block in the profile patch
 *   3. IDEA's own `IJ_MCP_SERVER_*` environment variables
 *   4. auto-detection (JetBrains Toolbox install locations, port 64342)
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import z from "@deepseek-ai/schemastery";
import type { IdeaTransport } from "./client.js";

/** IDEA's MCP server default port (Settings | Tools | MCP Server). */
const DEFAULT_IDEA_MCP_PORT = 64342;

/** Persisted config schema for the bundle row. */
export const ideaToolConfigSchema = z.object({
	enabled: z.boolean().default(true),
	transport: z.union([z.const("stdio"), z.const("sse")]).default("stdio"),
	command: z.string().default(""),
	args: z.array(z.string()).default(["stdioMcpServer"]),
	url: z.string().default(""),
	port: z.number().default(0),
	projectPath: z.string().default(""),
	requestTimeoutMs: z.number().default(120_000),
	idleTimeoutMs: z.number().default(600_000),
});

/** Fully resolved configuration (`DSH_IDEA_MCP_*` already applied). */
export type IdeaToolConfig = ReturnType<typeof ideaToolConfigSchema>;

/** Author-facing (un-parsed) config surface; see the README for env overrides. */
export interface IdeaToolConfigInput {
	enabled?: boolean;
	transport?: IdeaTransport;
	command?: string;
	args?: readonly string[];
	url?: string;
	port?: number;
	projectPath?: string;
	requestTimeoutMs?: number;
	idleTimeoutMs?: number;
}

/** Merge environment overrides and auto-detection onto the config block. */
export function resolveConfig(input: Partial<IdeaToolConfigInput> = {}): IdeaToolConfig {
	const port = resolvePort(input.port);
	return {
		enabled: envFlag("DSH_IDEA_MCP_ENABLED", input.enabled ?? true),
		transport: resolveTransport(input.transport),
		command: resolveCommand(input.command),
		args: input.args !== undefined && input.args.length > 0 ? [...input.args] : ["stdioMcpServer"],
		url: resolveUrl(input.url, port),
		port,
		projectPath: expandHome(env("DSH_IDEA_MCP_PROJECT_PATH") ?? process.env.IJ_MCP_SERVER_PROJECT_PATH ?? input.projectPath ?? ""),
		requestTimeoutMs: positive(envNumber("DSH_IDEA_MCP_REQUEST_TIMEOUT_MS"), input.requestTimeoutMs, 120_000),
		idleTimeoutMs: nonNegative(envNumber("DSH_IDEA_MCP_IDLE_TIMEOUT_MS"), input.idleTimeoutMs, 600_000),
	};
}

/** The port IDEA's MCP server listens on. */
export function resolvePort(configured?: number): number {
	if (configured !== undefined && configured > 0) return configured;
	const fromEnv = envNumber("DSH_IDEA_MCP_PORT") ?? envNumber("IJ_MCP_SERVER_PORT");
	return fromEnv !== undefined && fromEnv > 0 ? fromEnv : DEFAULT_IDEA_MCP_PORT;
}

function resolveTransport(configured?: IdeaTransport): IdeaTransport {
	const raw = (env("DSH_IDEA_MCP_TRANSPORT") ?? configured ?? "stdio").trim().toLowerCase();
	return raw === "sse" ? "sse" : "stdio";
}

function resolveUrl(configured: string | undefined, port: number): string {
	const explicit = env("DSH_IDEA_MCP_URL") ?? configured?.trim();
	if (explicit !== undefined && explicit !== "") return explicit;
	return `http://127.0.0.1:${port}/sse`;
}

/**
 * Locate the `idea` launcher. RID (remote development) and Toolbox installs
 * are not on PATH by default, so the well-known locations are probed too.
 */
export function resolveCommand(configured?: string): string {
	const explicit = env("DSH_IDEA_MCP_COMMAND") ?? configured?.trim();
	if (explicit !== undefined && explicit !== "") return expandHome(explicit);
	const fromIdeaEnv = env("IJ_MCP_SERVER_COMMAND");
	if (fromIdeaEnv !== undefined && fromIdeaEnv !== "") return expandHome(fromIdeaEnv);
	return findIdeaLauncher() ?? "idea";
}

/** Candidate launcher paths, most specific first. */
function findIdeaLauncher(): string | undefined {
	const home = process.env.HOME ?? "";
	const candidates = [
		path.join(home, ".local/bin/idea"),
		"/usr/local/bin/idea",
		"/snap/bin/idea",
		"/opt/idea/bin/idea",
		path.join(home, "Applications/IntelliJ IDEA.app/Contents/MacOS/idea"),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	// JetBrains Toolbox keeps one directory per product/version.
	const toolbox = path.join(home, ".local/share/JetBrains/Toolbox/apps");
	try {
		const products = readdirSync(toolbox).filter(name => name.startsWith("intellij-idea") || name.startsWith("IDEA"));
		for (const product of products) {
			const bin = path.join(toolbox, product, "bin");
			try {
				for (const file of readdirSync(bin)) {
					if (file !== "idea" && !/^idea(64)?(\.sh)?$/.test(file) && !file.startsWith("idea-")) continue;
					const candidate = path.join(bin, file);
					if (existsSync(candidate)) return candidate;
				}
			} catch {
				// Unreadable product directory: keep probing.
			}
		}
	} catch {
		// No Toolbox directory: fall through to PATH.
	}
	return findOnPath("idea");
}

/** Minimal PATH lookup (the host's `which`, without spawning a process). */
function findOnPath(name: string): string | undefined {
	const raw = process.env.PATH;
	if (raw === undefined) return undefined;
	for (const dir of raw.split(path.delimiter)) {
		if (dir === "") continue;
		const candidate = path.join(dir, name);
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

function env(name: string): string | undefined {
	const raw = process.env[name];
	if (raw === undefined) return undefined;
	const value = raw.trim();
	return value === "" ? undefined : value;
}

function envNumber(name: string): number | undefined {
	const raw = env(name);
	if (raw === undefined) return undefined;
	const value = Number(raw);
	return Number.isFinite(value) ? value : undefined;
}

function envFlag(name: string, fallback: boolean): boolean {
	const raw = env(name);
	if (raw === undefined) return fallback;
	const value = raw.toLowerCase();
	return !(value === "0" || value === "false" || value === "no" || value === "off");
}

function positive(fromEnv: number | undefined, configured: number | undefined, fallback: number): number {
	const value = fromEnv ?? configured ?? fallback;
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegative(fromEnv: number | undefined, configured: number | undefined, fallback: number): number {
	const value = fromEnv ?? configured ?? fallback;
	return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function expandHome(p: string): string {
	if (p === "" || p === "~") return p === "~" ? (process.env.HOME ?? p) : p;
	if (p.startsWith("~/")) return `${process.env.HOME ?? ""}${p.slice(1)}`;
	return p;
}
