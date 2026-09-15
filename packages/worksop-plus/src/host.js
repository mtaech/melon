/**
 * dsh-worksop-plus — Host half.
 *
 * Registers the durable `worksop-plus` settings namespace, which owns every
 * piece of view-organisation metadata this plugin adds: pinned workspaces,
 * named groups, group assignment, hidden workspaces, and presentation
 * preferences.
 *
 * The Host registry (`@deepseek-ai/dsh-workspace`, `~/.dsh/storages/workspace.json`)
 * cannot carry these fields — its record schema strips unknown keys and its
 * storage domain may be opened once — so the settings document is the right
 * residence: schema-validated, revision-fenced, and reachable from the browser
 * half through `ctx.settingsScope` without a bespoke HTTP channel.
 *
 * The namespace schema is also the wire envelope the browser scope validates
 * against, so every field added here must stay JSON-compatible.
 */
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-worksop-plus'

/** The settings service is optional: without it the browser half degrades to its local cache. */
export const inject = []

/** Settings namespace owned by this plugin (lowercase-hyphen form). */
export const WORKSOP_PLUS_SETTINGS_NAMESPACE = 'worksop-plus'

/** Per-group accent presets accepted by the group editor. */
export const GROUP_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple']

/** Ordering modes for the workspaces inside one section. */
export const SORTS = ['host', 'recent', 'name', 'manual']

/** One named group of workspaces. */
const GroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  emoji: z.string().default(''),
  color: z.union([...GROUP_COLORS]).default('gray'),
  collapsed: z.boolean().default(false),
})

/** Durable view state of the enhanced workspace panel. */
export const WorkspacePlusSettingsSchema = z.object({
  /** Pinned workspace ids, most recently pinned first. */
  pinned: z.array(String).default([]),
  /** Named groups in display order. */
  groups: z.array(GroupSchema).default([]),
  /** Workspace id → group id; an absent key means the workspace is ungrouped. */
  assign: z.dict(z.string()).default({}),
  /** Workspaces hidden from this panel without touching the Host registry. */
  hidden: z.array(String).default([]),
  /** Presentation preferences owned by the panel rather than by a group. */
  prefs: z.object({
    /** Whether the enhanced panel takes over `sidebar.workspaces`. */
    enhanced: z.boolean().default(true),
    /** Whether the pinned section is folded. */
    pinCollapsed: z.boolean().default(false),
    /** Whether the ungrouped bucket is folded. */
    ungroupedCollapsed: z.boolean().default(false),
    /** Whether the hidden bucket is folded. */
    hiddenCollapsed: z.boolean().default(false),
    /** Whether hidden workspaces are listed again. */
    showHidden: z.boolean().default(false),
    /** Section ordering mode. */
    sort: z.union([...SORTS]).default('host'),
    /** Listing shape: grouped by workspace, or one flat session list. */
    groupBy: z.union(['workspace', 'flat']).default('workspace'),
  }).default({ enhanced: true, pinCollapsed: false, ungroupedCollapsed: false, hiddenCollapsed: false, showHidden: false, sort: 'host', groupBy: 'workspace' }),
})

/**
 * Register the durable section when a settings provider is composed. Uses the
 * optional-injection form so a composition without `ctx.settings` still boots
 * the plugin (its browser half then runs cache-only).
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx) {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      WORKSOP_PLUS_SETTINGS_NAMESPACE,
      WorkspacePlusSettingsSchema,
      { applies: 'live' },
    )
  })
}
