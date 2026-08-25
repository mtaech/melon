/**
 * Central dependency re-exports so the package can swap modules without
 * touching every file.
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import type { ImageAttachmentRef } from "@deepseek-ai/dsh-attachment";
export { defineTool };
export type { ContentBlock, ImageAttachmentRef };
export type { ToolRunContext } from "@deepseek-ai/dsh-tools";
export type { Context } from "@deepseek-ai/cordis";
