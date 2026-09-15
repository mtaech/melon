import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name (the profile row's `name`). */
export declare const name: 'dsh-worksop-plus'

/** No hard Host service dependency: `settings` is acquired optionally. */
export declare const inject: readonly string[]

/** Settings namespace owning this plugin's durable view state. */
export declare const WORKSOP_PLUS_SETTINGS_NAMESPACE: 'worksop-plus'

/** Per-group accent presets accepted by the group editor. */
export declare const GROUP_COLORS: readonly string[]

/** Ordering modes for the workspaces inside one section. */
export declare const SORTS: readonly string[]

/** Durable view state of the enhanced workspace panel. */
export interface WorkspacePlusSettings {
  pinned: string[]
  groups: {
    id: string
    name: string
    emoji: string
    color: string
    collapsed: boolean
  }[]
  assign: Record<string, string>
  hidden: string[]
  prefs: {
    enhanced: boolean
    pinCollapsed: boolean
    showHidden: boolean
    sort: string
  }
}

/**
 * Register the durable `worksop-plus` settings namespace when the Host
 * composes a settings provider.
 * @param ctx - Host context.
 */
export declare function apply(ctx: Context): void
