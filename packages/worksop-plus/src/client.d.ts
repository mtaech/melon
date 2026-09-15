import type { Context as ClientContext } from '@deepseek-ai/cordis'

/** Cordis plugin name (the browser entry's `id`). */
export declare const name: 'dsh-worksop-plus'

/** Hard client services: `settingsScope` is acquired optionally through `ctx.inject`. */
export declare const inject: readonly string[]

/**
 * Register the enhanced browsing region (shadowing `sidebar.workspaces` at
 * priority -1) and the sidebar-foot switch that toggles it.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void
