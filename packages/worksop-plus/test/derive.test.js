/**
 * Tests for the panel's framework-free derivation rules.
 * Run with `bun test`.
 */
import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_STATE, HIDDEN, PINNED, UNGROUPED,
  basename, deriveSections, hostOrderWithPinned, moveIdBefore, normalizeState,
  orphanSessionRows, owningWorkspaceLabel, pendingKindOf, relTimeParts, runningSubagentCounts,
  sectionStatus, sessionRowsFor, strongestAttention, workspaceLabel, applyStoredOrder, FLAT, SEARCH,
} from '../src/derive.js'

const workspace = (id, path, sessionIds = [], updatedAt = 0) => ({
  workspaceId: id,
  path,
  title: '',
  sessionIds,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt,
})

const summary = (id, patch = {}) => ({
  id,
  displayTitle: `会话 ${id}`,
  blank: false,
  running: false,
  updatedAt: 1000,
  parentId: undefined,
  ...patch,
})

const sessionsOf = (entries, current = undefined) => ({
  ids: Object.keys(entries),
  byId: entries,
  current,
})

describe('normalizeState', () => {
  test('fills defaults from junk input', () => {
    const state = normalizeState(null)
    expect(state.pinned).toEqual([])
    expect(state.groups).toEqual([])
    expect(state.assign).toEqual({})
    expect(state.hidden).toEqual([])
    expect(state.prefs).toEqual(DEFAULT_STATE.prefs)
  })

  test('drops malformed ids, groups and colours', () => {
    const state = normalizeState({
      pinned: ['a', '', 7, null],
      groups: [{ id: 'g1', name: '工作', color: 'nope' }, { name: '无 id' }, 'junk'],
      assign: { a: 'g1', b: '', c: 9 },
      hidden: ['x'],
      prefs: { enhanced: false, sort: 'nope' },
    })
    expect(state.pinned).toEqual(['a'])
    expect(state.groups).toHaveLength(2)
    expect(state.groups[0]).toMatchObject({ id: 'g1', name: '工作', color: 'gray', collapsed: false })
    expect(state.groups[1].id).toBe('group-1')
    expect(state.assign).toEqual({ a: 'g1' })
    expect(state.prefs.enhanced).toBe(false)
    expect(state.prefs.sort).toBe('host')
  })
})

describe('labels', () => {
  test('basename accepts both separators and trailing slashes', () => {
    expect(basename('/a/b/c')).toBe('c')
    expect(basename('C:\\a\\b\\')).toBe('b')
    expect(basename('plain')).toBe('plain')
    expect(basename('')).toBe('')
  })

  test('workspaceLabel prefers the title, then the directory basename', () => {
    expect(workspaceLabel({ title: '工作区', path: '/a/b' })).toBe('工作区')
    expect(workspaceLabel({ title: '   ', path: '/a/b' })).toBe('b')
  })
})

describe('session rows', () => {
  const account = workspace('w1', '/a', ['s1', 's2', 's3'])
  const list = sessionsOf({
    s1: summary('s1'),
    s2: summary('s2', { running: true }),
    s3: summary('s3', { blank: true }),
  })

  test('archived sessions never render', () => {
    const rows = sessionRowsFor(account, list, new Set(['s1']))
    expect(rows.map((row) => row.id)).toEqual(['s2'])
  })

  test('a blank session renders only while it is the current selection', () => {
    expect(sessionRowsFor(account, list, new Set()).map((row) => row.id)).toEqual(['s1', 's2'])
    const selected = { ...list, current: 's3' }
    expect(sessionRowsFor(account, selected, new Set()).map((row) => row.id)).toEqual(['s1', 's2', 's3'])
  })

  test('unknown members are skipped instead of rendering placeholders', () => {
    const rows = sessionRowsFor(workspace('w2', '/b', ['ghost']), list, new Set())
    expect(rows).toEqual([])
  })

  test('orphans are sessions owned by no workspace', () => {
    const rows = orphanSessionRows([account], sessionsOf({
      s1: summary('s1'),
      s9: summary('s9'),
      s8: summary('s8', { parentId: 's1' }),
    }), new Set())
    expect(rows.map((row) => row.id)).toEqual(['s9'])
  })
})

describe('deriveSections', () => {
  const workspaces = [
    workspace('melon', '/dev/melon', ['s1'], 5000),
    workspace('octopus', '/dev/octopus', ['s2'], 9000),
    workspace('NJPL', '/dev/NJPL', [], 1000),
    workspace('old', '/dev/old', [], 100),
  ]
  const sessions = sessionsOf({ s1: summary('s1'), s2: summary('s2', { running: true }) }, 's1')
  const state = normalizeState({
    pinned: ['octopus'],
    groups: [{ id: 'g1', name: '工作' }, { id: 'g2', name: '个人', collapsed: true }],
    assign: { melon: 'g1', NJPL: 'g2' },
    hidden: ['old'],
  })
  const base = { workspaces, sessions, archivedSessionIds: [], state }

  test('pinned workspaces leave the group flow', () => {
    const { sections, counts } = deriveSections(base)
    const pinned = sections.find((section) => section.kind === 'pinned')
    expect(pinned.workspaces.map((item) => item.id)).toEqual(['octopus'])
    const group = sections.find((section) => section.key === 'g1')
    expect(group.workspaces.map((item) => item.id)).toEqual(['melon'])
    expect(counts[PINNED]).toBe(1)
    expect(counts.g1).toBe(1)
  })

  test('hidden workspaces leave the main flow until showHidden', () => {
    const hiddenOff = deriveSections(base).sections.map((section) => section.key)
    expect(hiddenOff).not.toContain(HIDDEN)
    const shown = deriveSections({ ...base, showHidden: true }).sections
    expect(shown.map((section) => section.key)).toContain(HIDDEN)
    expect(shown.find((section) => section.key === HIDDEN).workspaces.map((item) => item.id)).toEqual(['old'])
  })

  test('a workspace assigned to no live group falls into the ungrouped bucket', () => {
    const state2 = normalizeState({
      pinned: ['octopus'],
      hidden: ['old'],
      assign: { melon: 'gone' },
      groups: [{ id: 'g1', name: '工作' }],
    })
    const sections = deriveSections({ ...base, state: state2 }).sections
    const ungrouped = sections.find((section) => section.key === UNGROUPED)
    expect(ungrouped.workspaces.map((item) => item.id).sort()).toEqual(['NJPL', 'melon'])
  })

  test('a query matches the label, the path or a session title', () => {
    const byPath = deriveSections({ ...base, query: 'octopus' }).sections
    const ids = byPath.flatMap((section) => section.workspaces.map((item) => item.id))
    expect(ids).toEqual(['octopus'])
    const bySession = deriveSections({ ...base, query: '会话 s2' }).sections
    expect(bySession.flatMap((section) => section.workspaces.map((item) => item.id))).toEqual(['octopus'])
    expect(deriveSections({ ...base, query: 'nothing-here' }).sections.every((section) => section.workspaces.length === 0)).toBe(true)
  })

  test('filtering keeps only the selected section but counts stay global', () => {
    const { sections, counts } = deriveSections({ ...base, filter: 'g1' })
    expect(sections).toHaveLength(1)
    expect(sections[0].key).toBe('g1')
    expect(counts.all).toBe(3)
  })

  test('sort modes reorder within a section without crossing sections', () => {
    const recent = deriveSections({ ...base, sort: 'recent' }).sections
    const pinned = recent.find((section) => section.kind === 'pinned')
    expect(pinned.workspaces.map((item) => item.id)).toEqual(['octopus'])
    const byName = deriveSections({ ...base, sort: 'name' }).sections
    expect(byName.find((section) => section.key === 'g1').workspaces.map((item) => item.id)).toEqual(['melon'])
  })

  test('groups keep their declared order and expose their collapse flag', () => {
    const sections = deriveSections(base).sections
    const groupIds = sections.filter((section) => section.kind === 'group').map((section) => section.key)
    expect(groupIds).toEqual(['g1', 'g2'])
    expect(sections.find((section) => section.key === 'g2').collapsed).toBe(true)
  })
})

describe('relTimeParts', () => {
  const now = 10 * 24 * 60 * 60 * 1000
  test('unit boundaries', () => {
    expect(relTimeParts(0, now)).toEqual({ unit: 'now', n: 0 })
    expect(relTimeParts(now - 30_000, now)).toEqual({ unit: 'now', n: 0 })
    expect(relTimeParts(now - 3 * 60_000, now)).toEqual({ unit: 'min', n: 3 })
    expect(relTimeParts(now - 5 * 3_600_000, now)).toEqual({ unit: 'hour', n: 5 })
    expect(relTimeParts(now - 2 * 86_400_000, now)).toEqual({ unit: 'day', n: 2 })
  })
})

describe('order helpers', () => {
  test('moveIdBefore moves to the front, the middle and the end', () => {
    expect(moveIdBefore(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
    expect(moveIdBefore(['a', 'b', 'c'], 'a', 'b')).toEqual(['a', 'b', 'c'])
    expect(moveIdBefore(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'a', 'c'])
    expect(moveIdBefore(['a', 'b', 'c'], 'b', undefined)).toEqual(['a', 'c', 'b'])
  })

  test('moveIdBefore ignores unknown ids and absent anchors', () => {
    expect(moveIdBefore(['a', 'b'], 'ghost', 'a')).toEqual(['a', 'b'])
    expect(moveIdBefore(['a', 'b'], 'a', 'ghost')).toEqual(['b', 'a'])
    const input = ['a', 'b']
    moveIdBefore(input, 'b', 'a')
    expect(input).toEqual(['a', 'b'])
  })

  test('hostOrderWithPinned puts pins first and keeps the rest in host order', () => {
    expect(hostOrderWithPinned(['c', 'a'], ['a', 'b', 'c', 'd'])).toEqual(['c', 'a', 'b', 'd'])
    expect(hostOrderWithPinned([], ['a', 'b'])).toEqual(['a', 'b'])
    expect(hostOrderWithPinned(['ghost', 'b'], ['a', 'b'])).toEqual(['ghost', 'b', 'a'])
    expect(hostOrderWithPinned(['b', 'b'], ['a', 'b'])).toEqual(['b', 'a'])
  })
})

describe('bucket folding', () => {
  const workspaces = [
    workspace('melon', '/dev/melon', ['s1'], 5000),
    workspace('NJPL', '/dev/NJPL', [], 1000),
  ]
  const sessions = sessionsOf({ s1: summary('s1') }, 's1')

  test('the ungrouped and hidden buckets fold from their preference flags', () => {
    const open = deriveSections({ workspaces, sessions, archivedSessionIds: [], state: normalizeState({}) })
    expect(open.sections.find((section) => section.key === UNGROUPED).collapsed).toBe(false)
    const folded = deriveSections({
      workspaces,
      sessions,
      archivedSessionIds: [],
      state: normalizeState({ prefs: { ungroupedCollapsed: true, hiddenCollapsed: true } }),
      showHidden: true,
    })
    expect(folded.sections.find((section) => section.key === UNGROUPED).collapsed).toBe(true)
    expect(folded.sections.find((section) => section.key === HIDDEN).collapsed).toBe(true)
  })

  test('folding keeps the bucket in place and its members listed', () => {
    const folded = deriveSections({
      workspaces,
      sessions,
      archivedSessionIds: [],
      state: normalizeState({ prefs: { ungroupedCollapsed: true } }),
    })
    const bucket = folded.sections.find((section) => section.key === UNGROUPED)
    // Neither fixture workspace is assigned to a group, so both stay in the
    // bucket in Host order — folding is a display concern, not a membership one.
    expect(bucket.workspaces.map((item) => item.id)).toEqual(['melon', 'NJPL'])
    expect(folded.counts[UNGROUPED]).toBe(2)
  })
})

describe('session attention', () => {
  const workspaces = [workspace('w1', '/dev/one', ['s-run', 's-ask', 's-done', 's-idle'], 5000)]
  const sessions = sessionsOf({
    's-run': summary('s-run', { running: true }),
    's-ask': summary('s-ask'),
    's-done': summary('s-done', { completed: true }),
    's-idle': summary('s-idle'),
  })
  const pending = new Map([
    ['s-ask', { kind: 'approval', key: 'k', sessionId: 's-ask' }],
    ['s-gone', { kind: 'question', key: 'k2', sessionId: 's-gone' }],
  ])

  test('pendingKindOf reads a Map, a plain object, a bare string and nothing', () => {
    expect(pendingKindOf(pending, 's-ask')).toBe('approval')
    expect(pendingKindOf({ 's-ask': { kind: 'question' } }, 's-ask')).toBe('question')
    expect(pendingKindOf({ 's-ask': 'plan-review' }, 's-ask')).toBe('plan-review')
    expect(pendingKindOf(pending, 's-run')).toBeUndefined()
    expect(pendingKindOf(undefined, 's-ask')).toBeUndefined()
  })

  test('strongestAttention follows the urgency order', () => {
    expect(strongestAttention(['plan-review', 'approval'])).toBe('approval')
    expect(strongestAttention(['plan-review', 'question'])).toBe('question')
    expect(strongestAttention([undefined, 'plan-review'])).toBe('plan-review')
    expect(strongestAttention([])).toBeUndefined()
    expect(strongestAttention(['custom-kind'])).toBe('custom-kind')
  })

  test('rows carry their pending kind', () => {
    const rows = sessionRowsFor(workspaces[0], sessions, new Set(), pending)
    // Host manual order: the running session leads, the awaiting one follows.
    expect(rows.map((row) => row.attention ?? null)).toEqual([null, 'approval', null, null])
  })

  test('workspace roll-up counts pending, running and completed separately', () => {
    const item = deriveSections({ workspaces, sessions, archivedSessionIds: [], state: normalizeState({}), pending })
      .sections.flatMap((section) => section.workspaces)[0]
    expect(item.pendingCount).toBe(1)
    expect(item.runningCount).toBe(1)
    expect(item.completedCount).toBe(1)
    expect(item.attention).toBe('approval')
  })

  test('a folded bucket still advertises what is inside it', () => {
    const state = normalizeState({ groups: [{ id: 'g1', name: 'G' }], assign: { w1: 'g1' }, prefs: { ungroupedCollapsed: true } })
    const sections = deriveSections({ workspaces, sessions, archivedSessionIds: [], state, pending }).sections
    const group = sections.find((section) => section.key === 'g1')
    expect(group.pendingCount).toBe(1)
    expect(group.runningCount).toBe(1)
    expect(group.attention).toBe('approval')
    expect(sectionStatus(group)).toMatchObject({ pendingCount: 1, runningCount: 1, completedCount: 1 })
  })
})

describe('manual order, lineage and content search', () => {
  const workspaces = [
    workspace('a', '/dev/a', ['s-a', 's-sub1'], 100),
    workspace('b', '/dev/b', ['s-b'], 200),
    workspace('c', '/dev/c', ['s-c'], 300),
  ]
  const sessions = sessionsOf({
    's-a': summary('s-a'),
    's-b': summary('s-b'),
    's-c': summary('s-c'),
    's-sub1': summary('s-sub1', { parentId: 's-a', running: true, origin: 'subagent' }),
    's-sub2': summary('s-sub2', { parentId: 's-sub1', running: true, origin: 'subagent' }),
    's-hidden': summary('s-hidden'),
  })

  test('applyStoredOrder ranks saved ids and keeps the tail in Host order', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(applyStoredOrder(items, ['c', 'a']).map((item) => item.id)).toEqual(['c', 'a', 'b'])
    expect(applyStoredOrder(items, []).map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(applyStoredOrder(items, ['c', 'c']).map((item) => item.id)).toEqual(['c', 'a', 'b'])
  })

  test('manual sort applies the stored bucket order', () => {
    const state = normalizeState({ order: { [UNGROUPED]: ['c', 'a'] }, prefs: { sort: 'manual' } })
    const sections = deriveSections({ workspaces, sessions, archivedSessionIds: [], state })
    const bucket = sections.sections.find((section) => section.key === UNGROUPED)
    expect(bucket.workspaces.map((item) => item.id)).toEqual(['c', 'a', 'b'])
    const sorted = deriveSections({ workspaces, sessions, archivedSessionIds: [], state: normalizeState({ order: { [UNGROUPED]: ['c', 'a'] } }) })
    expect(sorted.sections.find((section) => section.key === UNGROUPED).workspaces.map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  test('the pinned section follows the pinned list, like the pin drag implies', () => {
    const state = normalizeState({ pinned: ['c', 'a'] })
    const sections = deriveSections({ workspaces, sessions, archivedSessionIds: [], state }).sections
    expect(sections.find((section) => section.kind === 'pinned').workspaces.map((item) => item.id)).toEqual(['c', 'a'])
  })

  test('running subagent descendants roll up onto the parent row', () => {
    const counts = runningSubagentCounts(sessions)
    expect(counts.get('s-a')).toBe(2)
    expect(counts.get('s-sub1')).toBe(1)
    const rows = sessionRowsFor(workspaces[0], sessions, new Set(), new Map(), counts)
    expect(rows[0].runningSubagentCount).toBe(2)
  })

  test('content matches join the visible tree, and only unseen ones get a section', () => {
    // 'dev/a' matches workspace a locally, so its session row is already on
    // screen (a content hit for it must NOT be duplicated); v c/s-c is filtered
    // out by the same query, so its content hit belongs in the search section.
    const content = { items: [{ sessionId: 's-a', snippet: 'dup' }, { sessionId: 's-c', snippet: '…命中的片段…' }], hasMore: true }
    const sections = deriveSections({ workspaces, sessions, archivedSessionIds: [], state: normalizeState({}), content, query: 'dev/a' }).sections
    const search = sections.find((section) => section.key === SEARCH)
    expect(search.orphans.map((row) => row.id)).toEqual(['s-c'])
    expect(search.orphans[0].snippet).toBe('…命中的片段…')
    expect(search.orphans[0].workspace).toBe('c')
    expect(search.hasMore).toBe(true)
    expect(sections[0].key).toBe(SEARCH)
    expect(sections.some((section) => section.workspaces.some((item) => item.id === 'a'))).toBe(true)
  })

  test('no query means no content section', () => {
    const content = { items: [{ sessionId: 's-hidden', snippet: 'x' }], hasMore: false }
    const sections = deriveSections({ workspaces, sessions, archivedSessionIds: [], state: normalizeState({}), content }).sections
    expect(sections.some((section) => section.key === SEARCH)).toBe(false)
  })
})

describe('query noise control', () => {
  test('empty buckets disappear while a query is active', () => {
    const workspaces = [workspace('melon', '/dev/melon', ['s1'], 100)]
    const sessions = sessionsOf({ s1: summary('s1') })
    const state = normalizeState({ groups: [{ id: 'g1', name: 'Empty group' }] })
    const idle = deriveSections({ workspaces, sessions, archivedSessionIds: [], state }).sections
    expect(idle.some((section) => section.key === 'g1')).toBe(true)
    const searching = deriveSections({ workspaces, sessions, archivedSessionIds: [], state, query: 'melon' }).sections
    expect(searching.some((section) => section.key === 'g1')).toBe(false)
    expect(searching.some((section) => section.key === UNGROUPED)).toBe(true)
  })

  test('the content section survives a query with no local match at all', () => {
    const workspaces = [workspace('melon', '/dev/melon', ['s1'], 100)]
    const sessions = sessionsOf({ s1: summary('s1'), s2: summary('s2') })
    const content = { items: [{ sessionId: 's2', snippet: 'hit' }], hasMore: false }
    const sections = deriveSections({ workspaces, sessions, archivedSessionIds: [], state: normalizeState({}), content, query: 'zzz' }).sections
    expect(sections.map((section) => section.key)).toEqual([SEARCH])
  })
})

describe('flat listing', () => {
  const workspaces = [
    workspace('one', '/dev/one', ['s1'], 100),
    workspace('two', '/dev/two', ['s2'], 200),
  ]
  const sessions = sessionsOf({
    s1: summary('s1', { updatedAt: 500 }),
    s2: summary('s2', { updatedAt: 900 }),
    s3: summary('s3', { updatedAt: 700 }),
  })

  test('flat mode yields one section of workspace-labelled rows', () => {
    const state = normalizeState({ prefs: { groupBy: 'flat' } })
    const sections = deriveSections({ workspaces, sessions, archivedSessionIds: [], state }).sections
    expect(sections).toHaveLength(1)
    expect(sections[0].key).toBe(FLAT)
    const rows = sections[0].orphans
    expect(rows.map((row) => row.id)).toEqual(['s1', 's2', 's3'])
    expect(rows.map((row) => row.workspace)).toEqual(['one', 'two', ''])
  })

  test('flat mode honours the recency sort', () => {
    const state = normalizeState({ prefs: { groupBy: 'flat', sort: 'recent' } })
    const rows = deriveSections({ workspaces, sessions, archivedSessionIds: [], state }).sections[0].orphans
    expect(rows.map((row) => row.id)).toEqual(['s2', 's3', 's1'])
  })

  test('flat mode filters rows by title or owning workspace', () => {
    const state = normalizeState({ prefs: { groupBy: 'flat' } })
    const byTitle = deriveSections({ workspaces, sessions, archivedSessionIds: [], state, query: '会话 s2' }).sections[0].orphans
    expect(byTitle.map((row) => row.id)).toEqual(['s2'])
    const byWorkspace = deriveSections({ workspaces, sessions, archivedSessionIds: [], state, query: 'two' }).sections[0].orphans
    expect(byWorkspace.map((row) => row.id)).toEqual(['s2'])
  })
})
