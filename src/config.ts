/**
 * Plugin + tool configuration for dsh-ast-edit-tool. Environment overrides win
 * over the `astEdit` config block (DSH_AST_*), mirroring oh-my-pi and
 * dsh-browser-tool.
 */
import z from "@deepseek-ai/schemastery";

export const astEditConfigSchema = z.object({
	enabled: z.boolean().default(true),
	maxFiles: z.number().min(1).default(1000),
	maxRenderChanges: z.number().min(1).default(500),
	binaryPath: z.string().default(""),
});

export type AstEditConfig = ReturnType<typeof astEditConfigSchema>;

/** Parse environment overrides onto the flat config block. */
export function resolveConfig(input: Partial<AstEditConfig>): AstEditConfig {
	return {
		enabled: envFlag("DSH_AST_EDIT_ENABLED", input.enabled ?? true),
		maxFiles: envInt("DSH_AST_MAX_FILES", input.maxFiles ?? 1000),
		maxRenderChanges: envInt("DSH_AST_MAX_RENDER", input.maxRenderChanges ?? 500),
		binaryPath: process.env.DSH_AST_GREP_BINARY?.trim() || input.binaryPath || "",
	};
}

function envFlag(name: string, fallback: boolean): boolean {
	const raw = process.env[name];
	if (raw === undefined) return fallback;
	const value = raw.trim().toLowerCase();
	if (value === "" || value === "0" || value === "false" || value === "no" || value === "off") return false;
	return true;
}

function envInt(name: string, fallback: number): number {
	const raw = process.env[name]?.trim();
	if (raw === undefined) return fallback;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed < 1) return fallback;
	return parsed;
}