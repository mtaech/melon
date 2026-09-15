/**
 * dsh-worksop-plus — pure view derivation.
 *
 * Everything here is framework-free and deterministic: the browser half hands in
 * the Host Workspace snapshot, the Session list snapshot and the durable view
 * state, and gets back the sections the panel renders. Keeping derivation out of
 * the component is what makes the panel's rules (pinned first, one group per
 * workspace, hidden bucket, query filter, ordering) unit-testable.
 */

/** Pending-interaction kinds this panel recognises, most urgent first. */
export const ATTENTION_ORDER = ['approval', 'question', 'plan-review']

/**
 * Read one Session's pending-interaction kind from the snapshot the
 * `useSessionPendingInteraction` standard prop resolves. Accepts a Map (the
 * live shape) or a plain object (fixtures/tests), and tolerates a bare string.
 * @param pending - pending interactions by Session id.
 * @param sessionId - session to look up.
 * @returns the domain kind, or undefined when nothing is pending.
 */
export function pendingKindOf(pending, sessionId) {
  if (pending === undefined || pending === null) return undefined
  const value = typeof pending.get === 'function' ? pending.get(sessionId) : pending[sessionId]
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  return typeof value.kind === 'string' ? value.kind : undefined
}

/**
 * The most urgent pending kind among the supplied ones, or undefined.
 * @param kinds - pending kinds, possibly with undefined entries.
 * @returns the winning kind per {@link ATTENTION_ORDER}.
 */
export function strongestAttention(kinds) {
  for (const candidate of ATTENTION_ORDER) {
    if (kinds.includes(candidate)) return candidate
  }
  return kinds.find((kind) => kind !== undefined)
}

/** Section key for sessions that belong to no Host Workspace. */
export const UNGROUPED = '__ungrouped__'

/** Section key for workspaces the operator hid from this panel. */
export const HIDDEN = '__hidden__'

/** Section key of the flat (ungrouped) session listing. */
export const FLAT = '__flat__'

/** Section key of the content-search results. */
export const SEARCH = '__search__'

/** Section key of the pinned workspaces. */
export const PINNED = '__pinned__'

/** Default durable view state; mirrors the Host settings schema. */
export const DEFAULT_PREFS = {
  enhanced: true,
  pinCollapsed: false,
  ungroupedCollapsed: false,
  hiddenCollapsed: false,
  showHidden: false,
  sort: 'host',
  groupBy: 'workspace',
}

/** Default view state document. */
export const DEFAULT_STATE = {
  pinned: [],
  groups: [],
  assign: {},
  hidden: [],
  /** Manual workspace order per bucket (`pinned` keeps its own list). */
  order: {},
  prefs: { ...DEFAULT_PREFS },
}

const GROUP_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple']
const SORTS = ['host', 'recent', 'name', 'manual']

/**
 * Coerce one arbitrary stored/resolved settings section into the plugin's view
 * state. Unknown ids and malformed entries are dropped rather than trusted, so a
 * hand-edited settings document can never break rendering.
 * @param raw - settings section (or local cache) of unknown shape.
 * @returns a fresh, fully-populated view state.
 */
export function normalizeState(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const stringArray = (value) => Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item !== '')
    : []
  const groups = Array.isArray(source.groups)
    ? source.groups
      .filter((group) => group !== null && typeof group === 'object')
      .map((group, index) => ({
        id: typeof group.id === 'string' && group.id !== '' ? group.id : `group-${index}`,
        name: typeof group.name === 'string' && group.name !== '' ? group.name : `#${index + 1}`,
        emoji: typeof group.emoji === 'string' ? group.emoji : '',
        color: GROUP_COLORS.includes(group.color) ? group.color : 'gray',
        collapsed: group.collapsed === true,
      }))
    : []
  const assign = {}
  if (source.assign !== null && typeof source.assign === 'object') {
    for (const [key, value] of Object.entries(source.assign)) {
      if (typeof value === 'string' && value !== '') assign[key] = value
    }
  }
  const order = {}
  if (source.order !== null && typeof source.order === 'object') {
    for (const [key, value] of Object.entries(source.order)) {
      if (Array.isArray(value)) order[key] = stringArray(value)
    }
  }
  const prefsRaw = source.prefs !== null && typeof source.prefs === 'object' ? source.prefs : {}
  return {
    pinned: stringArray(source.pinned),
    groups,
    assign,
    hidden: stringArray(source.hidden),
    order,
    prefs: {
      enhanced: prefsRaw.enhanced !== false,
      pinCollapsed: prefsRaw.pinCollapsed === true,
      ungroupedCollapsed: prefsRaw.ungroupedCollapsed === true,
      hiddenCollapsed: prefsRaw.hiddenCollapsed === true,
      showHidden: prefsRaw.showHidden === true,
      sort: SORTS.includes(prefsRaw.sort) ? prefsRaw.sort : 'host',
      groupBy: prefsRaw.groupBy === 'flat' ? 'flat' : 'workspace',
    },
  }
}

/**
 * Directory display label: the basename of a path, accepting both separators.
 * @param path - workspace directory path.
 * @returns the last path segment, or the raw path when it has none.
 */
export function basename(path) {
  if (typeof path !== 'string' || path === '') return ''
  const trimmed = path.replace(/[/\\]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return index === -1 ? trimmed : trimmed.slice(index + 1)
}

/**
 * Display label of the Workspace that accounts for a Session.
 * @param workspaces - Host Workspace projections.
 * @param sessionId - session to locate.
 * @returns the owning workspace label, or '' when no workspace owns it.
 */
export function owningWorkspaceLabel(workspaces, sessionId) {
  for (const workspace of workspaces) {
    if ((workspace?.sessionIds ?? []).includes(sessionId)) return workspaceLabel(workspace)
  }
  return ''
}

/**
 * Human label of one Host Workspace row.
 * @param workspace - `{ title, path }` projection.
 * @returns the workspace title, else the directory basename, else the path.
 */
export function workspaceLabel(workspace) {
  const title = typeof workspace?.title === 'string' ? workspace.title.trim() : ''
  if (title !== '') return title
  const base = basename(workspace?.path)
  return base !== '' ? base : (workspace?.path ?? '')
}

/**
 * Visible session rows of one workspace account.
 *
 * Mirrors the shipped browser's invariants: archived sessions never show, a
 * blank session shows only while it is the current selection, and a session
 * without a projected summary is skipped until one arrives.
 * @param workspace - Host Workspace projection (`sessionIds` in manual order).
 * @param sessions - Session list snapshot (`byId`, `current`).
 * @param archived - registry-global archived session ids.
 * @param pending - pending interactions by Session id.
 * @returns ordered session rows.
 */
export function sessionRowsFor(workspace, sessions, archived, pending, subagents) {
  const byId = sessions?.byId ?? {}
  const rows = []
  for (const sessionId of workspace?.sessionIds ?? []) {
    const summary = byId[sessionId]
    if (summary === undefined) continue
    if (archived.has(sessionId)) continue
    // Subagent descendants are advertised as a count on their parent row, not
    // as top-level rows of their own (the shipped browser does the same).
    if (summary.parentId !== undefined && summary.parentId !== null) continue
    if (summary.blank === true && sessions?.current !== sessionId) continue
    rows.push({
      id: sessionId,
      title: summary.displayTitle ?? summary.title ?? sessionId,
      running: summary.running === true,
      completed: summary.completed === true,
      blank: summary.blank === true,
      updatedAt: typeof summary.updatedAt === 'number' ? summary.updatedAt : 0,
      selected: sessions?.current === sessionId,
      attention: pendingKindOf(pending, sessionId),
      runningSubagentCount: (subagents === undefined ? undefined : subagents.get(sessionId)) ?? 0,
      // Best-effort live indicator, same leaf the shipped browser reads.
      scheduled: (summary.projectionValues?.schedule?.length ?? 0) > 0,
    })
  }
  return rows
}

/**
 * Sessions that belong to no Host Workspace, in Host list order.
 * @param workspaces - Host Workspace projections.
 * @param sessions - Session list snapshot.
 * @param archived - registry-global archived session ids.
 * @returns ordered orphan session rows.
 */
export function orphanSessionRows(workspaces, sessions, archived, pending, subagents) {
  const owned = new Set()
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds ?? []) owned.add(sessionId)
  }
  const byId = sessions?.byId ?? {}
  const rows = []
  for (const sessionId of sessions?.ids ?? []) {
    if (owned.has(sessionId)) continue
    const summary = byId[sessionId]
    if (summary === undefined) continue
    if (archived.has(sessionId)) continue
    if (summary.parentId !== undefined && summary.parentId !== null) continue
    if (summary.blank === true && sessions?.current !== sessionId) continue
    rows.push({
      id: sessionId,
      title: summary.displayTitle ?? summary.title ?? sessionId,
      running: summary.running === true,
      completed: summary.completed === true,
      blank: summary.blank === true,
      updatedAt: typeof summary.updatedAt === 'number' ? summary.updatedAt : 0,
      selected: sessions?.current === sessionId,
      attention: pendingKindOf(pending, sessionId),
      runningSubagentCount: (subagents === undefined ? undefined : subagents.get(sessionId)) ?? 0,
      // Best-effort live indicator, same leaf the shipped browser reads.
      scheduled: (summary.projectionValues?.schedule?.length ?? 0) > 0,
    })
  }
  return rows
}

/**
 * Roll one section's rows up into the activity the header advertises while the
 * bucket is folded: how many sessions await the operator, run, or finished
 * unopened, plus the most urgent pending kind.
 * @param section - derived section (workspaces plus orphans).
 * @returns the section's status counts.
 */
export function sectionStatus(section) {
  const rows = [
    ...section.orphans,
    ...section.workspaces.flatMap((item) => item.sessions),
  ]
  return {
    pendingCount: rows.filter((row) => row.attention !== undefined).length,
    runningCount: rows.filter((row) => row.running === true).length,
    completedCount: rows.filter((row) => row.completed === true).length,
    attention: strongestAttention(rows.map((row) => row.attention)),
  }
}

function matchesQuery(haystack, query) {
  return haystack.toLowerCase().includes(query)
}

function workspaceMatches(workspace, rows, query) {
  if (query === '') return true
  if (matchesQuery(workspace.label, query)) return true
  if (matchesQuery(workspace.path ?? '', query)) return true
  return rows.some((row) => matchesQuery(row.title, query))
}

/**
 * Reorder items by a stored id list: ranked ids first in that exact order, the
 * unranked tail (new members) keeping its incoming Host order.
 * @param items - derived workspace items.
 * @param storedIds - saved order for this bucket.
 * @returns a new array; the input is never mutated.
 */
export function applyStoredOrder(items, storedIds) {
  if (!Array.isArray(storedIds) || storedIds.length === 0) return items
  const rank = new Map()
  storedIds.forEach((id, index) => { if (!rank.has(id)) rank.set(id, index) })
  const tail = Number.MAX_SAFE_INTEGER
  return [...items].sort((a, b) => (rank.has(a.id) ? rank.get(a.id) : tail) - (rank.has(b.id) ? rank.get(b.id) : tail))
}

function orderWorkspaces(items, sort, storedIds) {
  if (sort === 'name') {
    return [...items].sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'))
  }
  if (sort === 'recent') {
    return [...items].sort((a, b) => b.activityAt - a.activityAt)
  }
  if (sort === 'manual') return applyStoredOrder(items, storedIds)
  return items
}

function workspaceItem(workspace, state, sessions, archived, pending, subagents) {
  const rows = sessionRowsFor(workspace, sessions, archived, pending, subagents)
  const activityAt = Math.max(
    typeof workspace.updatedAt === 'number' ? workspace.updatedAt : 0,
    ...rows.map((row) => row.updatedAt),
    0,
  )
  return {
    id: workspace.workspaceId,
    label: workspaceLabel(workspace),
    path: workspace.path ?? '',
    pinned: state.pinned.includes(workspace.workspaceId),
    hidden: state.hidden.includes(workspace.workspaceId),
    groupId: state.assign[workspace.workspaceId],
    sessionCount: rows.length,
    runningCount: rows.filter((row) => row.running).length,
    pendingCount: rows.filter((row) => row.attention !== undefined).length,
    completedCount: rows.filter((row) => row.completed === true).length,
    attention: strongestAttention(rows.map((row) => row.attention)),
    activityAt,
    sessions: rows,
  }
}

/**
 * Derive the panel's sections from the Host snapshots plus durable view state.
 *
 * Rules: a pinned workspace appears only in the pinned section; a workspace
 * belongs to at most one group and falls back to the ungrouped bucket; hidden
 * workspaces leave the main flow and return only through `showHidden`; a query
 * matches the workspace label, its path, or one of its session titles.
 * @param input - snapshots, view state, query and filter.
 * @returns `{ sections, counts, total }` in render order.
 */
export function deriveSections(input) {
  const {
    workspaces = [],
    sessions = {},
    archivedSessionIds = [],
    state = DEFAULT_STATE,
    pending = undefined,
    content = undefined,
    query = '',
    filter = 'all',
    showHidden = false,
    sort = undefined,
    labels = {},
  } = input ?? {}
  const archived = new Set(archivedSessionIds)
  const activeSort = sort === undefined ? state.prefs.sort : sort
  // Tolerate a partial/cached state (older snapshots carry no order map).
  const bucketOrder = state.order ?? {}
  const subagents = runningSubagentCounts(sessions?.byId)
  const normalizedQuery = query.trim().toLowerCase()

  const items = []
  for (const workspace of workspaces) {
    if (workspace?.workspaceId === undefined) continue
    items.push(workspaceItem(workspace, state, sessions, archived, pending, subagents))
  }
  const orphans = orphanSessionRows(workspaces, sessions, archived, pending, subagents)
  const passQuery = (item) => workspaceMatches(item, item.sessions, normalizedQuery)
  const orphansPass = normalizedQuery === ''
    || orphans.some((row) => matchesQuery(row.title, normalizedQuery))

  const pinned = applyStoredOrder(items.filter((item) => item.pinned && !item.hidden && passQuery(item)), state.pinned)
  const grouped = new Map()
  for (const item of orderWorkspaces(items, activeSort)) {
    if (item.pinned || item.hidden) continue
    if (!passQuery(item)) continue
    const key = item.groupId !== undefined && state.groups.some((group) => group.id === item.groupId)
      ? item.groupId
      : UNGROUPED
    const bucket = grouped.get(key) ?? []
    bucket.push(item)
    grouped.set(key, bucket)
  }

  // The hidden bucket is always derived so its count can advertise the way back
  // even while the bucket itself stays out of the render list.
  const hidden = orderWorkspaces(items.filter((item) => item.hidden && passQuery(item)), sort)
  const groupSections = state.groups.map((group) => ({
    kind: 'group',
    key: group.id,
    label: group.name,
    emoji: group.emoji,
    color: group.color,
    collapsed: group.collapsed === true,
    workspaces: orderWorkspaces(grouped.get(group.id) ?? [], activeSort, bucketOrder[group.id]),
    orphans: [],
  }))
  const pinnedSection = {
    kind: 'pinned',
    key: PINNED,
    label: labels.pinned ?? 'Pinned',
    emoji: '★',
    color: 'yellow',
    collapsed: state.prefs.pinCollapsed === true,
    workspaces: pinned,
    orphans: [],
  }
  const ungroupedSection = {
    kind: 'ungrouped',
    key: UNGROUPED,
    label: labels.ungrouped ?? 'Ungrouped',
    emoji: '',
    color: 'gray',
    collapsed: state.prefs.ungroupedCollapsed === true,
    workspaces: orderWorkspaces(grouped.get(UNGROUPED) ?? [], activeSort, bucketOrder[UNGROUPED]),
    orphans: orphansPass ? orphans : [],
  }
  const hiddenSection = {
    kind: 'hidden',
    key: HIDDEN,
    label: labels.hidden ?? 'Hidden',
    emoji: '',
    color: 'gray',
    collapsed: state.prefs.hiddenCollapsed === true,
    workspaces: orderWorkspaces(hidden, activeSort, bucketOrder[HIDDEN]),
    orphans: [],
  }

  // Content matches the tree does not already show get their own section: local
  // matches stay in place, content-only hits carry the host snippet.
  const known = new Set()
  for (const section of [pinnedSection, ...groupSections, ungroupedSection, hiddenSection]) {
    for (const item of section.workspaces) for (const row of item.sessions) known.add(row.id)
    for (const row of section.orphans) known.add(row.id)
  }
  const contentRows = []
  if (normalizedQuery !== '' && content !== undefined && Array.isArray(content.items)) {
    for (const entry of content.items) {
      if (entry === null || typeof entry !== 'object') continue
      if (typeof entry.sessionId !== 'string' || known.has(entry.sessionId)) continue
      const summary = (sessions?.byId ?? {})[entry.sessionId]
      contentRows.push({
        id: entry.sessionId,
        title: summary?.displayTitle ?? summary?.title ?? entry.sessionId,
        workspace: owningWorkspaceLabel(workspaces, entry.sessionId),
        snippet: typeof entry.snippet === 'string' ? entry.snippet : '',
        running: summary?.running === true,
        completed: summary?.completed === true,
        blank: false,
        updatedAt: typeof summary?.updatedAt === 'number' ? summary.updatedAt : 0,
        selected: sessions?.current === entry.sessionId,
        attention: pendingKindOf(pending, entry.sessionId),
        runningSubagentCount: subagents.get(entry.sessionId) ?? 0,
        scheduled: (summary?.projectionValues?.schedule?.length ?? 0) > 0,
        content: true,
      })
    }
  }
  const searchSection = {
    kind: 'search',
    key: SEARCH,
    label: labels.search ?? 'Content matches',
    emoji: '',
    color: 'gray',
    collapsed: false,
    workspaces: [],
    orphans: contentRows,
    hasMore: content !== undefined && content.hasMore === true,
  }
  // Flat listing: one row per visible session, workspace-labelled, ordered by
  // the same sort preference (Host order, recency, name).
  const flatMode = state.prefs.groupBy === 'flat'
  let flatRows = []
  if (flatMode) {
    for (const item of items) {
      for (const row of item.sessions) {
        if (normalizedQuery !== '' && !matchesQuery(row.title, normalizedQuery) && !matchesQuery(item.label, normalizedQuery)) continue
        flatRows.push({ ...row, workspace: item.label })
      }
    }
    for (const row of orphans) {
      if (normalizedQuery !== '' && !matchesQuery(row.title, normalizedQuery)) continue
      flatRows.push({ ...row, workspace: '' })
    }
    if (activeSort === 'recent') flatRows = [...flatRows].sort((a, b) => b.updatedAt - a.updatedAt)
    else if (activeSort === 'name') flatRows = [...flatRows].sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'))
  }
  const flatSection = {
    kind: 'flat',
    key: FLAT,
    label: labels.flat ?? 'Sessions',
    emoji: '',
    color: 'gray',
    collapsed: false,
    workspaces: [],
    orphans: flatRows,
  }
  const head = contentRows.length === 0 ? [] : [searchSection]
  const allSections = flatMode
    ? [...head, flatSection]
    : showHidden
      ? [...head, pinnedSection, ...groupSections, ungroupedSection, hiddenSection]
      : [...head, pinnedSection, ...groupSections, ungroupedSection]
  const counts = {
    all: items.filter((item) => !item.hidden).length + orphans.length,
    [PINNED]: pinned.length,
    [UNGROUPED]: (grouped.get(UNGROUPED) ?? []).length + ungroupedSection.orphans.length,
    [HIDDEN]: hidden.length,
  }
  for (const group of state.groups) counts[group.id] = (grouped.get(group.id) ?? []).length
  const sections = (filter === 'all'
    ? allSections
    : allSections.filter((section) => section.key === filter)
  )
    // While a query is active, an empty bucket is noise: the operator is looking
    // at matches, not at the shape of their groups.
    .filter((section) => normalizedQuery === ''
      || section.key === SEARCH
      || section.workspaces.length > 0
      || section.orphans.length > 0)
    .map((section) => ({ ...section, ...sectionStatus(section) }))
  return { sections, counts, total: counts.all }
}

/**
 * Count running subagent descendants per Session.
 *
 * The shipped browser keeps a lineage index of its own; this panel only needs
 * the number to advertise on the parent row, so it walks the `parentId` forest
 * once per derivation.
 * @param byId - session summaries by id.
 * @returns map of session id → running descendant count.
 */
export function runningSubagentCounts(source) {
  const summaries = source !== null && typeof source === 'object' && source.byId !== undefined
    ? source.byId
    : (source ?? {})
  const children = new Map()
  for (const [id, summary] of Object.entries(summaries)) {
    const parent = summary?.parentId
    if (parent === undefined || parent === null) continue
    const bucket = children.get(parent) ?? []
    bucket.push(id)
    children.set(parent, bucket)
  }
  const counts = new Map()
  const walk = (id) => {
    let total = 0
    for (const child of children.get(id) ?? []) {
      if (summaries[child]?.running === true) total += 1
      total += walk(child)
    }
    counts.set(id, total)
    return total
  }
  for (const id of Object.keys(summaries)) if (!counts.has(id)) walk(id)
  return counts
}

/**
 * Move one id so it sits directly before another (DOM `insertBefore` shape).
 * Unknown ids are ignored, and an absent anchor appends to the end.
 * @param ids - current id order.
 * @param id - the id to move.
 * @param beforeId - the anchor, or undefined to append.
 * @returns a new order; the input is never mutated.
 */
export function moveIdBefore(ids, id, beforeId) {
  const from = ids.indexOf(id)
  if (from === -1) return ids.slice()
  const next = ids.slice()
  next.splice(from, 1)
  const at = beforeId === undefined || beforeId === null ? next.length : next.indexOf(beforeId)
  next.splice(at === -1 ? next.length : at, 0, id)
  return next
}

/**
 * The host order a pin-materialisation write should realise: pinned ids first
 * (in pinned order, de-duplicated), then every remaining host id untouched.
 * @param pinned - pinned workspace ids.
 * @param hostOrder - current Host registry order.
 * @returns the complete target order.
 */
export function hostOrderWithPinned(pinned, hostOrder) {
  const seen = new Set()
  const head = []
  for (const id of pinned) {
    if (seen.has(id)) continue
    seen.add(id)
    head.push(id)
  }
  return [...head, ...hostOrder.filter((id) => !seen.has(id))]
}

/**
 * Split a millisecond age into the unit the panel renders.
 * @param updatedAt - epoch milliseconds of the last activity.
 * @param now - current epoch milliseconds.
 * @returns `{ unit, n }` with `unit` in `now|min|hour|day`.
 */
export function relTimeParts(updatedAt, now) {
  const delta = Math.max(0, (typeof now === 'number' ? now : Date.now()) - (updatedAt || 0))
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (updatedAt === 0 || delta < minute) return { unit: 'now', n: 0 }
  if (delta < hour) return { unit: 'min', n: Math.floor(delta / minute) }
  if (delta < day) return { unit: 'hour', n: Math.floor(delta / hour) }
  return { unit: 'day', n: Math.floor(delta / day) }
}
