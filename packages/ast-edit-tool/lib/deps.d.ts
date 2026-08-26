/**
 * Central dependency re-exports so the package can swap modules without
 * touching every file.
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
export { defineTool };
export type { ToolRunContext } from "@deepseek-ai/dsh-tools";
export type { Context } from "@deepseek-ai/cordis";
