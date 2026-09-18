/**
 * dsh-worksop-plus — Client half.
 *
 * Takes over the sidebar's `sidebar.workspaces` region at `priority: -1` (the
 * shipped browser registers at the default 0, and a single slot renders its
 * lowest live entry). Shadowing is deliberately reversible: the shipped
 * registration stays on the slot ledger, so disposing ours — through the panel's
 * own "use the system panel" action or the sidebar-foot toggle this plugin also
 * registers — restores the stock browser instantly.
 *
 * Layout: pinned section → group filter chips → group sections (collapsible) →
 * ungrouped bucket → optional hidden bucket. Every action reads and writes the
 * durable `worksop-plus` settings namespace through `ctx.settingsScope`, with a
 * synchronous localStorage mirror so the first paint never waits on the wire.
 *
 * Visual language (`./styles.js`) is absorbed from the `dsh-skin-material-you`
 * skin: an expanded workspace becomes a tonal card, its sessions hang from a
 * guide line, and counts/times sit in fixed pill and column slots.
 *
 * Host contracts consumed (all public client services / standard slot props):
 *   - standard slot props `useWorkspaces` (Host Workspace snapshot),
 *     `useSessions` (Session list snapshot), and the Session status feed
 *     (`useSessionStatus` on DSH ≥ 0.1.6, `useSessionPendingInteraction`
 *     before that — see `WorksopPlusBrowser`);
 *   - `ctx.slots`, `ctx.locale`, `ctx.settingsScope`;
 *   - `ctx.workspaces` (create/rename/delete), `ctx.uiWorkspace`
 *     (startSession/open/archive/pickDirectory), `ctx.sessions` (open).
 */
import React from 'react'
import {
  DEFAULT_STATE, HIDDEN, PINNED, UNGROUPED,
  deriveSections, hostOrderWithPinned, moveIdBefore, normalizeState, relTimeParts, workspaceLabel,
} from './derive.js'
import { CSS } from './styles.js'

export const name = 'dsh-worksop-plus'

/** Hard client dependencies; `settingsScope` is acquired optionally so a cache-only boot still works. */
export const inject = ['slots', 'locale', 'workspaces', 'uiWorkspace', 'sessions']

/** Locale namespace owned by this plugin. */
const NS = 'worksopPlus'

/** Settings namespace registered by the host half. */
const SETTINGS_NAMESPACE = 'worksop-plus'

/** Synchronous local mirror of the durable section. */
const CACHE_KEY = 'dsh.worksop.plus.v1'

/** Owned `<style>` tag id. */
const STYLE_TAG = 'dsh-worksop-plus/style'

const ALL = 'all'
const SELECT_SELF = (snapshot) => snapshot
const h = React.createElement
/** Fallback for a shell that exposes no Session status feed at all (no dots, everything else works). */
const absentStatus = () => undefined

const ZH = {
  'section.workspaces': '工作区',
  'section.pinned': '置顶',
  'section.ungrouped': '未分组',
  'section.hidden': '已隐藏',
  'search.placeholder': '搜索工作区或会话',
  'search.aria': '搜索工作区',
  'search.clear': '清空搜索',
  'action.add': '添加工作区',
  'action.sort': '排序与视图',
  'action.newSession': '新建会话',
  'action.rename': '重命名',
  'action.hide': '隐藏',
  'action.unhide': '取消隐藏',
  'action.delete': '删除工作区',
  'action.pin': '置顶',
  'action.unpin': '取消置顶',
  'action.archive': '归档会话',
  'action.createGroup': '新建分组',
  'action.renameGroup': '重命名分组',
  'action.deleteGroup': '删除分组',
  'action.moveUp': '上移',
  'action.moveDown': '下移',
  'action.moveToGroup': '移入分组',
  'action.noGroup': '不分组',
  'action.more': '更多操作',
  'action.systemPanel': '使用系统面板',
  'action.enhance': '工作区增强',
  'action.enhanceOn': '工作区增强：已开启（点击切回系统面板）',
  'action.enhanceOff': '工作区增强：已关闭（点击开启）',
  'action.showHidden': '显示已隐藏',
  'action.hideHidden': '收起已隐藏',
  'dialog.cancel': '取消',
  'dialog.confirm': '确定',
  'dialog.createGroup.title': '新建分组',
  'dialog.renameGroup.title': '重命名分组',
  'dialog.renameWorkspace.title': '重命名工作区',
  'dialog.name.placeholder': '分组名称',
  'dialog.deleteWorkspace.title': '删除工作区？',
  'dialog.deleteWorkspace.body': '只删除注册记录，目录与历史会话都会保留。',
  'dialog.deleteGroup.title': '删除分组？',
  'dialog.deleteGroup.body': '组内工作区会回到「未分组」，不会被删除。',
  'sort.host': '宿主顺序',
  'sort.recent': '最近活动',
  'sort.name': '名称',
  'state.empty': '没有匹配的工作区',
  'state.noPinned': '还没有置顶的工作区',
  'time.now': '刚刚',
  'time.min': '{n}分',
  'time.hour': '{n}小时',
  'time.day': '{n}天',
  'group.empty': '该分组还没有工作区',
  'action.renameSession': '重命名会话',
  'chip.groups': '分组',
  'status.running': '运行中',
  'status.completed': '已完成（未查看）',
  'status.idle': '空闲',
  'status.waitingApproval': '等待授权',
  'status.planReview': '计划待确认',
  'status.waitingAnswer': '等待回答',
  'status.subagents': '{n} 个子代理运行中',
  'status.scheduled': '有定时任务',
  'action.forkSession': '分叉会话',
  'session.more': '还有 {n} 条',
  'session.less': '收起会话',
  'section.search': '内容匹配',
  'section.sessions': '会话',
  'view.workspace': '按工作区分组',
  'view.flat': '扁平列表',
  'search.hasMore': '结果较多，缩小关键词可更精确',
  'sort.manual': '手动顺序',
  'action.bulk': '多选整理',
  'action.bulkPin': '置顶',
  'action.bulkUnpin': '取消置顶',
  'action.bulkHide': '隐藏',
  'action.bulkGroup': '移入分组',
  'action.selectAll': '全选',
  'action.finish': '完成',
  'action.syncHostOrder': '置顶同步到系统顺序',
  'action.export': '导出配置',
  'action.import': '导入配置',
  'action.copy': '复制',
  'dir.title': '选择工作区目录',
  'dir.empty': '没有子目录',
  'dir.truncated': '目录过多，仅显示部分',
  'dir.new': '新建文件夹',
  'dir.create': '创建',
  'dir.choose': '选择此目录',
  'dir.native': '系统选择器',
  'dir.hidden': '含隐藏项',
  'action.close': '关闭',
  'bulk.selected': '已选 {n}',
  'dialog.import.title': '导入配置',
  'dialog.import.body': '粘贴之前导出的 JSON；导入会覆盖当前的置顶、分组、隐藏与偏好。',
  'dialog.import.invalid': 'JSON 解析失败，请检查内容',
  'dialog.export.title': '导出配置',
  'dialog.export.body': '复制下面的 JSON 保存，之后可以在任意浏览器导入回来。',
  'dialog.renameSession.title': '重命名会话',
  'status.copied': '已复制到剪贴板',
  'status.copyFailed': '复制失败，请手动全选复制',
}

const EN = {
  'section.workspaces': 'Workspaces',
  'section.pinned': 'Pinned',
  'section.ungrouped': 'Ungrouped',
  'section.hidden': 'Hidden',
  'search.placeholder': 'Search workspaces or sessions',
  'search.aria': 'Search workspaces',
  'search.clear': 'Clear search',
  'action.add': 'Add workspace',
  'action.sort': 'Order and view',
  'action.newSession': 'New session',
  'action.rename': 'Rename',
  'action.hide': 'Hide',
  'action.unhide': 'Unhide',
  'action.delete': 'Delete workspace',
  'action.pin': 'Pin',
  'action.unpin': 'Unpin',
  'action.archive': 'Archive session',
  'action.createGroup': 'New group',
  'action.renameGroup': 'Rename group',
  'action.deleteGroup': 'Delete group',
  'action.moveUp': 'Move up',
  'action.moveDown': 'Move down',
  'action.moveToGroup': 'Move to group',
  'action.noGroup': 'No group',
  'action.more': 'More actions',
  'action.systemPanel': 'Use the system panel',
  'action.enhance': 'Workspace Plus',
  'action.enhanceOn': 'Workspace Plus: on (click for the system panel)',
  'action.enhanceOff': 'Workspace Plus: off (click to enable)',
  'action.showHidden': 'Show hidden',
  'action.hideHidden': 'Hide hidden',
  'dialog.cancel': 'Cancel',
  'dialog.confirm': 'OK',
  'dialog.createGroup.title': 'New group',
  'dialog.renameGroup.title': 'Rename group',
  'dialog.renameWorkspace.title': 'Rename workspace',
  'dialog.name.placeholder': 'Group name',
  'dialog.deleteWorkspace.title': 'Delete workspace?',
  'dialog.deleteWorkspace.body': 'Only the registration is removed; the directory and every session stay.',
  'dialog.deleteGroup.title': 'Delete group?',
  'dialog.deleteGroup.body': 'Its workspaces return to Ungrouped; nothing is deleted.',
  'sort.host': 'Host order',
  'sort.recent': 'Recent activity',
  'sort.name': 'Name',
  'state.empty': 'No matching workspace',
  'state.noPinned': 'Nothing pinned yet',
  'time.now': 'now',
  'time.min': '{n}m',
  'time.hour': '{n}h',
  'time.day': '{n}d',
  'group.empty': 'No workspace in this group',
  'action.renameSession': 'Rename session',
  'chip.groups': 'Groups',
  'status.running': 'Running',
  'status.completed': 'Finished, unopened',
  'status.idle': 'Idle',
  'status.waitingApproval': 'Waiting for approval',
  'status.planReview': 'Plan awaiting review',
  'status.waitingAnswer': 'Waiting for your answer',
  'status.subagents': '{n} subagent(s) running',
  'status.scheduled': 'Scheduled task active',
  'action.forkSession': 'Fork session',
  'session.more': '{n} more',
  'session.less': 'Collapse sessions',
  'section.search': 'Content matches',
  'section.sessions': 'Sessions',
  'view.workspace': 'Group by workspace',
  'view.flat': 'Flat list',
  'search.hasMore': 'Many matches — narrow the keywords',
  'sort.manual': 'Manual order',
  'action.bulk': 'Select multiple',
  'action.bulkPin': 'Pin',
  'action.bulkUnpin': 'Unpin',
  'action.bulkHide': 'Hide',
  'action.bulkGroup': 'Move to group',
  'action.selectAll': 'Select all',
  'action.finish': 'Done',
  'action.syncHostOrder': 'Sync pins to system order',
  'action.export': 'Export config',
  'action.import': 'Import config',
  'action.copy': 'Copy',
  'dir.title': 'Pick a workspace directory',
  'dir.empty': 'No subdirectories',
  'dir.truncated': 'Too many directories — showing a subset',
  'dir.new': 'New folder',
  'dir.create': 'Create',
  'dir.choose': 'Use this folder',
  'dir.native': 'System picker',
  'dir.hidden': 'has hidden entries',
  'action.close': 'Close',
  'bulk.selected': '{n} selected',
  'dialog.import.title': 'Import config',
  'dialog.import.body': 'Paste a previously exported JSON document. Importing replaces the current pins, groups, hidden entries and preferences.',
  'dialog.import.invalid': 'Could not parse that JSON',
  'dialog.export.title': 'Export config',
  'dialog.export.body': 'Copy this JSON to keep, then import it in any browser.',
  'dialog.renameSession.title': 'Rename session',
  'status.copied': 'Copied to clipboard',
  'status.copyFailed': 'Copy failed — select and copy manually',
}

const GROUP_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple']
/** Fixed accent palette: the alias tokens only carry four semantic hues, and a group
 *  accent must stay distinguishable across eight presets in both colour schemes. */
const COLOR_HEX = {
  gray: '#9aa0a6',
  red: '#e5484d',
  orange: '#f76b15',
  yellow: '#e2b53e',
  green: '#30a46c',
  teal: '#12a594',
  blue: '#3b82f6',
  purple: '#8b5cf6',
}

/** Sessions shown per workspace before the "more" row (the shipped limit). */
const SESSION_CAP = 5

/** Group emoji presets offered by the group editor ('' clears it). */
const EMOJIS = ['', '💼', '🧪', '🎨', '📦', '🛠️', '📚', '🏠', '⭐', '🌱', '🔥', '🚀', '🧩', '🗂️', '🎯', '💾']

function injectStyle() {
  const existing = document.getElementById(STYLE_TAG)
  if (existing !== null) existing.remove()
  const tag = document.createElement('style')
  tag.id = STYLE_TAG
  tag.textContent = CSS
  document.head.appendChild(tag)
  return () => { tag.remove() }
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw === null) return undefined
    return normalizeState(JSON.parse(raw))
  } catch {
    return undefined
  }
}

function writeCache(state) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state))
  } catch {
    /* cache-only degradation: a full or blocked localStorage must not break the panel */
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function nextGroupId(state) {
  let index = state.groups.length + 1
  while (state.groups.some((group) => group.id === `g${index}`)) index += 1
  return `g${index}`
}

/**
 * The panel's reactive store: one durable document, an optimistic local copy,
 * and a write-through to the Host settings scope.
 * @param scope - bound settings scope, or undefined when the settings UI is absent.
 * @returns the store handle plus its disposer.
 */
function createViewStore(scope) {
  let state = readCache() ?? normalizeState(DEFAULT_STATE)
  let bound = scope
  let unbind
  const listeners = new Set()
  const emit = () => { for (const fn of Array.from(listeners)) fn() }
  const pushRemote = (fields) => {
    if (bound === undefined) return
    const snapshot = bound.getSnapshot()
    if (snapshot.writable !== true) return
    for (const field of fields) {
      Promise.resolve(bound.set(field, clone(state[field]))).catch(() => {
        /* a rejected write already triggered the scope's recovery read */
      })
    }
  }
  const commit = (mutate, fields) => {
    const draft = clone(state)
    mutate(draft)
    state = normalizeState(draft)
    writeCache(state)
    emit()
    pushRemote(fields)
  }
  const pull = () => {
    if (bound === undefined) return
    const snapshot = bound.getSnapshot()
    if (snapshot.value === undefined) return
    const next = normalizeState(snapshot.value)
    if (JSON.stringify(next) === JSON.stringify(state)) return
    state = next
    writeCache(state)
    emit()
  }
  const attachScope = (next) => {
    if (unbind !== undefined) { unbind(); unbind = undefined }
    bound = next
    if (next === undefined) return
    unbind = next.subscribe(pull)
    pull()
  }
  attachScope(scope)
  const actions = {
    togglePin(id) {
      commit((draft) => {
        const index = draft.pinned.indexOf(id)
        if (index === -1) draft.pinned.unshift(id)
        else draft.pinned.splice(index, 1)
      }, ['pinned'])
    },
    createGroup(name) {
      const id = nextGroupId(state)
      commit((draft) => {
        draft.groups.push({ id, name, emoji: '', color: 'gray', collapsed: false })
      }, ['groups'])
      return id
    },
    renameGroup(id, name) {
      commit((draft) => {
        const group = draft.groups.find((entry) => entry.id === id)
        if (group !== undefined) group.name = name
      }, ['groups'])
    },
    setGroupColor(id, color) {
      commit((draft) => {
        const group = draft.groups.find((entry) => entry.id === id)
        if (group !== undefined) group.color = color
      }, ['groups'])
    },
    deleteGroup(id) {
      commit((draft) => {
        draft.groups = draft.groups.filter((entry) => entry.id !== id)
        for (const [workspaceId, groupId] of Object.entries(draft.assign)) {
          if (groupId === id) delete draft.assign[workspaceId]
        }
      }, ['groups', 'assign'])
    },
    moveGroup(id, delta) {
      commit((draft) => {
        const index = draft.groups.findIndex((entry) => entry.id === id)
        const target = index + delta
        if (index === -1 || target < 0 || target >= draft.groups.length) return
        const [moved] = draft.groups.splice(index, 1)
        draft.groups.splice(target, 0, moved)
      }, ['groups'])
    },
    toggleGroupCollapsed(id) {
      commit((draft) => {
        const group = draft.groups.find((entry) => entry.id === id)
        if (group !== undefined) group.collapsed = !group.collapsed
      }, ['groups'])
    },
    assign(workspaceId, groupId) {
      commit((draft) => {
        if (groupId === undefined || groupId === null || groupId === '') delete draft.assign[workspaceId]
        else draft.assign[workspaceId] = groupId
      }, ['assign'])
    },
    hide(workspaceId) {
      commit((draft) => {
        if (!draft.hidden.includes(workspaceId)) draft.hidden.push(workspaceId)
        const index = draft.pinned.indexOf(workspaceId)
        if (index !== -1) draft.pinned.splice(index, 1)
      }, ['hidden', 'pinned'])
    },
    unhide(workspaceId) {
      commit((draft) => {
        draft.hidden = draft.hidden.filter((id) => id !== workspaceId)
      }, ['hidden'])
    },
    pinMany(ids, on) {
      commit((draft) => {
        for (const id of ids) {
          const index = draft.pinned.indexOf(id)
          if (on === true && index === -1) draft.pinned.unshift(id)
          if (on !== true && index !== -1) draft.pinned.splice(index, 1)
        }
      }, ['pinned'])
    },
    hideMany(ids) {
      commit((draft) => {
        for (const id of ids) {
          if (!draft.hidden.includes(id)) draft.hidden.push(id)
          const index = draft.pinned.indexOf(id)
          if (index !== -1) draft.pinned.splice(index, 1)
        }
      }, ['hidden', 'pinned'])
    },
    assignMany(ids, groupId) {
      commit((draft) => {
        for (const id of ids) {
          if (groupId === undefined || groupId === null || groupId === '') delete draft.assign[id]
          else draft.assign[id] = groupId
        }
      }, ['assign'])
    },
    setPinnedOrder(ids) {
      commit((draft) => { draft.pinned = ids.slice() }, ['pinned'])
    },
    moveGroupBefore(id, beforeId) {
      commit((draft) => {
        const byId = new Map(draft.groups.map((group) => [group.id, group]))
        draft.groups = moveIdBefore(draft.groups.map((group) => group.id), id, beforeId)
          .map((entry) => byId.get(entry))
          .filter((group) => group !== undefined)
      }, ['groups'])
    },
    setGroupEmoji(id, emoji) {
      commit((draft) => {
        const group = draft.groups.find((entry) => entry.id === id)
        if (group !== undefined) group.emoji = emoji
      }, ['groups'])
    },
    replaceAll(next) {
      commit((draft) => {
        draft.pinned = next.pinned.slice()
        draft.groups = next.groups.map((group) => ({ ...group }))
        draft.assign = { ...next.assign }
        draft.hidden = next.hidden.slice()
        draft.prefs = { ...draft.prefs, ...next.prefs }
      }, ['pinned', 'groups', 'assign', 'hidden', 'prefs'])
    },
    setBucketOrder(key, ids) {
      commit((draft) => { draft.order = { ...draft.order, [key]: ids.slice() } }, ['order'])
    },
    setPrefs(patch) {
      commit((draft) => { Object.assign(draft.prefs, patch) }, ['prefs'])
    },
  }
  return {
    state: {
      getSnapshot: () => state,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    actions,
    attachScope,
    dispose: () => { if (unbind !== undefined) unbind() },
  }
}

/**
 * Shipped icon set. `@deepseek-ai/dsh-client-ui-primitives` is a browser seed
 * module (the shell's own instance), so the panel draws the product's real icons
 * instead of hand-rolled glyphs. The lookup is guarded: a shell that does not
 * expose the seed falls back to the inline glyphs below, and only the pin star
 * (absent from the shipped set) is always inline.
 */
const shippedIcons = (() => {
  try {
    return typeof require === 'function' ? require('@deepseek-ai/dsh-client-ui-primitives') : undefined
  } catch (error) {
    console.warn('worksop-plus: shipped icon set unavailable', error)
    return undefined
  }
})()

/** The shipped dropdown menu (same seed module as the icons), when available. */
const shippedMenu = shippedIcons === undefined ? undefined : shippedIcons.Menu

/** Semantic name → the shipped component's export name. */
const ICON_COMPONENTS = {
  chevron: 'IconChevronRightOutline14',
  chevronDown: 'IconChevronDownOutline14',
  search: 'IconSearchOutline16',
  plus: 'IconPlusOutline16',
  more: 'IconEllipsisOutline16',
  folderClosed: 'IconFolderClose16',
  folderOpen: 'IconFolderOpen16',
  close: 'IconCloseOutline16',
  check: 'IconCheckOutline14',
  sort: 'IconEnhanceOutline16',
  sparkle: 'IconSparkle16',
  alarm: 'IconAlarmClockOutline16',
  trash: 'IconTrashOutline16',
  panel: 'IconPanelLeftOutline16',
}

/** Inline fallbacks (16px grid), used only when the seed module is unavailable. */
const FALLBACK_ICONS = {
  chevron: 'M6 4l4 4-4 4',
  search: 'M7.2 2a5.2 5.2 0 013.7 8.9l3 3a.9.9 0 01-1.3 1.3l-3-3A5.2 5.2 0 117.2 2zm0 1.8a3.4 3.4 0 100 6.8 3.4 3.4 0 000-6.8z',
  plus: 'M8 3.2v9.6M3.2 8h9.6',
  more: 'M8 3.6a1 1 0 110 2 1 1 0 010-2zm0 3.4a1 1 0 110 2 1 1 0 010-2zm0 3.4a1 1 0 110 2 1 1 0 010-2z',
  folderClosed: 'M2.4 4.8a1.2 1.2 0 011.2-1.2h2.6l1.3 1.5h5.1a1.2 1.2 0 011.2 1.2v5.4a1.2 1.2 0 01-1.2 1.2H3.6a1.2 1.2 0 01-1.2-1.2V4.8z',
  folderOpen: 'M2.4 4.8a1.2 1.2 0 011.2-1.2h2.6l1.3 1.5h5.1a1.2 1.2 0 011.2 1.2v5.4a1.2 1.2 0 01-1.2 1.2H3.6a1.2 1.2 0 01-1.2-1.2V4.8z',
  close: 'M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6',
  check: 'M3.2 8.4l3 3 6.6-6.8',
  sort: 'M3 4.5h10M3 8h6.4M3 11.5h3.4',
  sparkle: 'M6.1 3.1Q6.6 7.8 11.3 8.3Q6.6 8.8 6.1 13.5Q5.6 8.8 0.9 8.3Q5.6 7.8 6.1 3.1Z',
  alarm: 'M8 3.4a4.6 4.6 0 100 9.2 4.6 4.6 0 000-9.2zM8 5.4v3l1.9 1.2M5.4 1.6L3.4 3.2M10.6 1.6l2 1.6',
  trash: 'M4 5.5V13a1 1 0 001 1h6a1 1 0 001-1V5.5M3 5.5h10M6.5 5.5V4a1 1 0 011-1h1a1 1 0 011 1v1.5',
  panel: 'M2.5 3.5h11v9h-11zM6 3.5v9',
  star: 'M8 1.8l1.86 3.9 4.24.52-3.13 2.9.83 4.28L8 11.3l-3.8 2.1.83-4.28-3.13-2.9 4.24-.52L8 1.8z',
  starLine: 'M8 1.8l1.86 3.9 4.24.52-3.13 2.9.83 4.28L8 11.3l-3.8 2.1.83-4.28-3.13-2.9 4.24-.52L8 1.8z',
}

function Icon({ name, size = 16, className }) {
  const componentName = ICON_COMPONENTS[name]
  const shipped = shippedIcons === undefined || componentName === undefined
    ? undefined
    : shippedIcons[componentName]
  if (typeof shipped === 'function') return h(shipped, { size, className })
  const filled = name === 'more' || name === 'star' || name === 'sparkle' || name === 'folderClosed' || name === 'folderOpen'
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    className,
    'aria-hidden': true,
    fill: filled ? 'currentColor' : 'none',
    stroke: filled ? 'none' : 'currentColor',
    strokeWidth: filled ? 0 : 1.35,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }, h('path', { d: FALLBACK_ICONS[name] }))
}

/** 28px state-layer icon button used across the header. */
function IconButton({ name, label, onClick, active, size = 16 }) {
  return h('button', {
    type: 'button',
    className: active === true ? 'wp-iconbtn wp-iconbtn-on' : 'wp-iconbtn',
    'aria-label': label,
    title: label,
    'aria-pressed': active === true ? true : undefined,
    onClick,
  }, h(Icon, { name, size }))
}

function colorOf(color) {
  return COLOR_HEX[color] ?? COLOR_HEX.gray
}

/**
 * Convert the panel's plain menu rows into the shipped Menu's entry vocabulary.
 * Row ids encode the source index so `onSelect` can find its action again.
 * @param items - panel menu rows.
 * @returns shipped Menu entries.
 */
function menuEntries(items) {
  return items.map((entry, index) => {
    if (entry.sep === true) return { type: 'separator', id: `ms-${index}` }
    if (entry.label2 === true) return { type: 'label', id: `ml-${index}`, text: entry.label }
    return {
      id: `mi-${index}`,
      danger: entry.danger === true,
      label: entry.suffix === undefined
        ? entry.label
        : h('span', { className: 'wp-menu-label-row' },
          h('span', null, entry.label),
          h('small', null, entry.suffix)),
    }
  })
}

/** The single checked row's id, for the shipped Menu's selection marker. */
function selectedEntryId(items) {
  const index = items.findIndex((entry) => entry.check === true)
  return index === -1 ? undefined : `mi-${index}`
}

/** One fixed-position popup menu; a full-window backdrop owns dismissal. */
function PopupMenu({ anchor, children, onClose }) {
  const width = 196
  const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight
  const viewportWidth = typeof window === 'undefined' ? 400 : window.innerWidth
  const top = anchor === null ? 0 : Math.min(anchor.bottom + 4, Math.max(8, viewportHeight - 8 - 8 * 34))
  const left = anchor === null ? 0 : Math.max(8, Math.min(anchor.left, viewportWidth - width - 8))
  return h(React.Fragment, null,
    h('div', { className: 'wp-backdrop', onClick: onClose, onContextMenu: (event) => { event.preventDefault(); onClose() } }),
    h('div', { className: 'wp-menu', style: { top, left, width }, role: 'menu' }, children))
}

/** Centered modal used for create/rename/confirm flows. */
function Dialog({ title, body, value, placeholder, colors, color, emojis, emoji, onValue, onColor, onEmoji, confirmLabel, danger, busy, onConfirm, onCancel }) {
  const inputRef = React.useRef(null)
  React.useEffect(() => {
    const node = inputRef.current
    if (node === null) return undefined
    node.focus()
    node.select()
    return undefined
  }, [])
  const commit = () => { if (busy !== true) onConfirm() }
  return h(React.Fragment, null,
    h('div', { className: 'wp-backdrop', onClick: busy === true ? undefined : onCancel }),
    h('div', { className: 'wp-dialog', role: 'dialog', 'aria-modal': true },
      h('h4', null, title),
      body !== undefined ? h('p', null, body) : null,
      value !== undefined
        ? h('input', {
          ref: inputRef,
          value,
          placeholder,
          onChange: (event) => { onValue(event.target.value) },
          onKeyDown: (event) => {
            if (event.key === 'Enter') commit()
            if (event.key === 'Escape') onCancel()
          },
        })
        : null,
      colors === true
        ? h('div', { className: 'wp-colors' }, GROUP_COLORS.map((entry) => h('button', {
          key: entry,
          type: 'button',
          className: color === entry ? 'wp-color wp-color-on' : 'wp-color',
          style: { background: colorOf(entry) },
          'aria-label': entry,
          title: entry,
          onClick: () => { onColor(entry) },
        })))
        : null,
      emojis === undefined
        ? null
        : h('div', { className: 'wp-emojis' }, emojis.map((entry) => h('button', {
          key: entry === '' ? 'none' : entry,
          type: 'button',
          className: emoji === entry ? 'wp-emoji wp-emoji-on' : 'wp-emoji',
          'aria-label': entry === '' ? 'none' : entry,
          onClick: () => { onEmoji(entry) },
        }, entry === '' ? '∅' : entry))),
      h('div', { className: 'wp-dialog-actions' },
        h('button', { type: 'button', className: 'wp-btn', onClick: onCancel }, '×'),
        h('button', {
          type: 'button',
          className: danger === true ? 'wp-btn wp-btn-danger' : 'wp-btn wp-btn-primary',
          disabled: busy === true,
          onClick: commit,
        }, confirmLabel))))
}

function timeText(t, updatedAt) {
  const parts = relTimeParts(updatedAt, Date.now())
  return t(`time.${parts.unit}`, { n: parts.n })
}

/**
 * The enhanced browsing region.
 * @param props - composed slot props (owner share, standard hooks, inject face, locale seat).
 * @returns the region element tree.
 */
function WorksopPlusBrowser(props) {
  const {
    wide, expandSidebar, store, ui, useWorkspaces, useSessions,
    useSessionStatus, useSessionPendingInteraction, t,
  } = props
  const workspaceSnapshot = useWorkspaces(SELECT_SELF)
  const sessions = useSessions(SELECT_SELF)
  // DSH 0.1.6 folded the pending-interaction standard prop into
  // `useSessionStatus` (Map<SessionId, SessionStatus>); 0.1.5 exposes the older
  // `useSessionPendingInteraction`. Read whichever the shell assembled and
  // never call an absent prop: a throw here abdicates this shadowing entry,
  // which silently reverts the panel to the shipped browser.
  const statusHook = (typeof useSessionStatus === 'function' && useSessionStatus)
    || (typeof useSessionPendingInteraction === 'function' && useSessionPendingInteraction)
    || absentStatus
  const pending = statusHook(SELECT_SELF)
  const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [query, setQuery] = React.useState('')
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [filter, setFilter] = React.useState(ALL)
  const [expanded, setExpanded] = React.useState([])
  const [menu, setMenu] = React.useState(null)
  const [dialog, setDialog] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const [bulk, setBulk] = React.useState(false)
  const [selected, setSelected] = React.useState([])
  const [drag, setDrag] = React.useState(null)
  const [dropTarget, setDropTarget] = React.useState(null)
  const [status, setStatus] = React.useState(null)
  const [content, setContent] = React.useState(undefined)
  const [allSessions, setAllSessions] = React.useState([])
  const [dir, setDir] = React.useState(null)
  const searchRef = React.useRef(null)

  React.useEffect(() => {
    if (!searchOpen) return
    searchRef.current?.focus()
  }, [searchOpen])

  const labels = {
    pinned: t('section.pinned'),
    ungrouped: t('section.ungrouped'),
    hidden: t('section.hidden'),
    search: t('section.search'),
    flat: t('section.sessions'),
  }
  const derived = React.useMemo(() => deriveSections({
    workspaces: workspaceSnapshot.items,
    sessions,
    pending,
    content,
    archivedSessionIds: workspaceSnapshot.archivedSessionIds,
    state,
    query,
    filter,
    showHidden: state.prefs.showHidden === true,
    sort: state.prefs.sort,
    labels,
  }), [workspaceSnapshot, sessions, pending, content, state, query, filter, t])
  const counts = React.useMemo(() => deriveSections({
    workspaces: workspaceSnapshot.items,
    sessions,
    pending,
    archivedSessionIds: workspaceSnapshot.archivedSessionIds,
    state,
    query: '',
    filter: ALL,
    showHidden: state.prefs.showHidden === true,
    sort: state.prefs.sort,
    labels,
  }).counts, [workspaceSnapshot, sessions, pending, state, t])

  const closeMenu = () => { setMenu(null) }
  const openMenu = (event, builder) => {
    event.stopPropagation()
    setMenu({ rect: event.currentTarget.getBoundingClientRect(), items: builder() })
  }
  /** Context menus have no trigger element: synthesise a zero-size rect at the pointer. */
  const openMenuAt = (event, builder) => {
    setMenu({ rect: new DOMRect(event.clientX, event.clientY, 0, 0), items: builder() })
  }
  const toggleExpanded = (id) => {
    setExpanded((list) => list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id])
  }
  const runDialog = async (dialogState, job) => {
    setBusy(true)
    setError(null)
    try {
      await job()
      setDialog(null)
    } catch (reason) {
      setError(String(reason?.message ?? reason))
    } finally {
      setBusy(false)
    }
  }

  const isSelected = (id) => selected.includes(id)
  const toggleSelected = (id) => {
    setSelected((list) => list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id])
  }
  const visibleWorkspaceIds = () => derived.sections.flatMap((section) => section.workspaces.map((item) => item.id))
  /** HTML5 drag plumbing: a drop candidate must preventDefault on dragover. */
  const dropProps = (key, accept, handler) => ({
    onDragOver: (event) => {
      if (drag === null || accept(drag) !== true) return
      event.preventDefault()
      if (event.dataTransfer !== undefined) event.dataTransfer.dropEffect = 'move'
      if (dropTarget !== key) setDropTarget(key)
    },
    onDragLeave: () => { if (dropTarget === key) setDropTarget(null) },
    onDrop: (event) => {
      if (drag === null || accept(drag) !== true) return
      event.preventDefault()
      event.stopPropagation()
      handler(drag)
      setDrag(null)
      setDropTarget(null)
    },
  })
  const reorderPinned = (draggedId, targetId) => {
    store.actions.setPinnedOrder(moveIdBefore(state.pinned, draggedId, targetId))
  }
  /** Which bucket currently shows a workspace id, and that bucket's member list. */
  const bucketOfWorkspace = (id) => {
    for (const section of derived.sections) {
      const members = section.workspaces.map((item) => item.id)
      if (members.includes(id)) return { section, members }
    }
    return undefined
  }
  /**
   * Drop one workspace onto another row of the same bucket: reorder that
   * bucket's manual order (folding the target's half into an anchor) and switch
   * the view to manual so the new order is what shows.
   */
  const reorderWithin = (draggedId, targetId, half) => {
    const bucket = bucketOfWorkspace(targetId)
    if (bucket === undefined) return
    const anchor = half === 'before' ? targetId : bucket.members[bucket.members.indexOf(targetId) + 1]
    const next = moveIdBefore(bucket.members, draggedId, anchor)
    if (bucket.section.kind === 'pinned') store.actions.setPinnedOrder(next)
    else store.actions.setBucketOrder(bucket.section.key, next)
    if (state.prefs.sort !== 'manual') store.actions.setPrefs({ sort: 'manual' })
  }
  /**
   * Row drop plumbing: the pointer half decides before/after, the dragged
   * item's bucket decides reorder (same bucket) versus assignment (other).
   */
  const rowDropProps = (item, section) => {
    const key = `ws:${item.id}`
    const halfOf = (event) => {
      const box = event.currentTarget.getBoundingClientRect()
      return event.clientY < box.top + box.height / 2 ? 'before' : 'after'
    }
    return {
      onDragOver: (event) => {
        if (drag === null || drag.kind !== 'workspace' || drag.id === item.id) return
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer !== undefined) event.dataTransfer.dropEffect = 'move'
        const target = `${key}:${halfOf(event)}`
        if (dropTarget !== target) setDropTarget(target)
      },
      onDragLeave: () => {
        if (dropTarget === `${key}:before` || dropTarget === `${key}:after`) setDropTarget(null)
      },
      onDrop: (event) => {
        if (drag === null || drag.kind !== 'workspace' || drag.id === item.id) return
        event.preventDefault()
        event.stopPropagation()
        const half = halfOf(event)
        const origin = bucketOfWorkspace(drag.id)
        if (origin !== undefined && origin.section.key === section.key) reorderWithin(drag.id, item.id, half)
        else if (section.kind === 'pinned') store.actions.pinMany([drag.id], true)
        else store.actions.assign(drag.id, section.kind === 'group' ? section.key : undefined)
        setDrag(null)
        setDropTarget(null)
      },
    }
  }
  const exportConfig = () => {
    const text = JSON.stringify(state, null, 2)
    ui.copyText(text).then((copied) => {
      setStatus(copied ? t('status.copied') : t('status.copyFailed'))
      if (!copied) setDialog({ kind: 'export-config', value: text })
    })
  }
  const syncHostOrder = () => {
    const hostOrder = workspaceSnapshot.items.map((item) => item.workspaceId)
    ui.materializeOrder(hostOrderWithPinned(state.pinned, hostOrder))
      .then(() => { setStatus(`${t('action.syncHostOrder')} ✓`) })
      .catch((reason) => { setError(String(reason?.message ?? reason)) })
  }

  React.useEffect(() => {
    if (status === null) return undefined
    const handle = setTimeout(() => { setStatus(null) }, 2600)
    return () => { clearTimeout(handle) }
  }, [status])

  // In-app directory browser: one level per path, cancelled when it changes.
  const dirPath = dir === null ? null : dir.path
  React.useEffect(() => {
    if (dirPath === null) return undefined
    const controller = new AbortController()
    ui.listDirectory(dirPath === '' ? undefined : dirPath, controller.signal)
      .then((listing) => {
        setDir((current) => (current === null || current.path !== dirPath
          ? current
          : { ...current, listing, loading: false, error: null }))
      })
      .catch((reason) => {
        setDir((current) => (current === null || current.path !== dirPath
          ? current
          : { ...current, loading: false, error: String(reason?.message ?? reason) }))
      })
    return () => { controller.abort() }
  }, [dirPath, ui])

  // Host content search: debounced, cancelled on every keystroke and on close.
  const trimmedQuery = query.trim()
  React.useEffect(() => {
    if (searchOpen !== true || trimmedQuery === '') {
      setContent((previous) => (previous === undefined ? previous : undefined))
      return undefined
    }
    const controller = new AbortController()
    const handle = setTimeout(() => {
      ui.searchSessions(trimmedQuery, controller.signal)
        .then((page) => { setContent(page) })
        .catch(() => { setContent(undefined) })
    }, 250)
    return () => { clearTimeout(handle); controller.abort() }
  }, [searchOpen, trimmedQuery, ui])

  const workspaceMenu = (item) => [
    { label: item.pinned ? t('action.unpin') : t('action.pin'), run: () => { store.actions.togglePin(item.id) } },
    { label: t('action.newSession'), run: () => { ui.startSession(item.id) } },
    { sep: true },
    { label: t('action.rename'), run: () => { setDialog({ kind: 'rename-workspace', id: item.id, value: item.label }) } },
    { label: t('action.hide'), run: () => { store.actions.hide(item.id) } },
    { sep: true },
    { label: t('action.moveToGroup'), label2: true },
    ...state.groups.map((group) => ({
      label: `　${group.emoji}${group.name}`,
      check: state.assign[item.id] === group.id,
      run: () => { store.actions.assign(item.id, group.id) },
    })),
    { label: `　${t('action.noGroup')}`, check: state.assign[item.id] === undefined, run: () => { store.actions.assign(item.id, undefined) } },
    { label: `　+ ${t('action.createGroup')}`, run: () => { setDialog({ kind: 'create-group' }) } },
    { sep: true },
    { label: t('action.delete'), danger: true, run: () => { setDialog({ kind: 'delete-workspace', id: item.id, label: item.label }) } },
  ]

  const groupMenu = (section) => [
    { label: t('action.renameGroup'), run: () => { setDialog({ kind: 'rename-group', id: section.key, value: section.label }) } },
    { label: t('action.moveUp'), run: () => { store.actions.moveGroup(section.key, -1) } },
    { label: t('action.moveDown'), run: () => { store.actions.moveGroup(section.key, 1) } },
    { sep: true },
    { label: t('action.deleteGroup'), danger: true, run: () => { setDialog({ kind: 'delete-group', id: section.key, label: section.label }) } },
  ]

  const sessionMenu = (row) => [
    { label: t('action.newSession'), run: () => { ui.startSession() } },
    { label: t('action.renameSession'), run: () => { setDialog({ kind: 'rename-session', id: row.id, value: row.title }) } },
    { label: t('action.forkSession'), run: () => { ui.forkSession(row.id) } },
    {
      label: t('action.archive'),
      danger: true,
      run: () => {
        ui.archive(row.id).catch((reason) => { setError(String(reason?.message ?? reason)) })
      },
    },
  ]

  const viewMenu = () => [
    { label: t('sort.host'), check: state.prefs.sort === 'host', run: () => { store.actions.setPrefs({ sort: 'host' }) } },
    { label: t('sort.recent'), check: state.prefs.sort === 'recent', run: () => { store.actions.setPrefs({ sort: 'recent' }) } },
    { label: t('sort.name'), check: state.prefs.sort === 'name', run: () => { store.actions.setPrefs({ sort: 'name' }) } },
    { label: t('sort.manual'), check: state.prefs.sort === 'manual', run: () => { store.actions.setPrefs({ sort: 'manual' }) } },
    { sep: true },
    { label: t('view.workspace'), check: state.prefs.groupBy !== 'flat', run: () => { store.actions.setPrefs({ groupBy: 'workspace' }) } },
    { label: t('view.flat'), check: state.prefs.groupBy === 'flat', run: () => { store.actions.setPrefs({ groupBy: 'flat' }) } },
    { sep: true },
    { label: t('action.bulk'), check: bulk, run: () => { setBulk(!bulk); setSelected([]) } },
    { label: t('action.createGroup'), run: () => { setDialog({ kind: 'create-group' }) } },
    {
      label: state.prefs.showHidden === true ? t('action.hideHidden') : t('action.showHidden'),
      run: () => { store.actions.setPrefs({ showHidden: state.prefs.showHidden !== true }) },
    },
    { sep: true },
    { label: t('action.syncHostOrder'), run: () => { syncHostOrder() } },
    { label: t('action.export'), run: () => { exportConfig() } },
    { label: t('action.import'), run: () => { setDialog({ kind: 'import-config', value: '' }) } },
    { sep: true },
    { label: t('action.systemPanel'), run: () => { store.actions.setPrefs({ enhanced: false }) } },
  ]

  // Group names never occupy the chip row: however many groups exist, the row
  // stays [all][pinned][groups ▾][+], and every grouping filter (including the
  // ungrouped bucket) lives in the dropdown with its count and a check mark.
  const activeGroup = state.groups.find((group) => group.id === filter)
  const groupedTotal = state.groups.reduce((sum, group) => sum + (counts[group.id] ?? 0), 0)
  const groupFilterActive = activeGroup !== undefined || filter === UNGROUPED
  const groupFilterLabel = filter === UNGROUPED
    ? t('section.ungrouped')
    : activeGroup === undefined
      ? `${t('chip.groups')} ${state.groups.length}`
      : `${activeGroup.emoji}${activeGroup.name}`
  const groupFilterCount = filter === UNGROUPED
    ? counts[UNGROUPED]
    : activeGroup === undefined ? groupedTotal : (counts[activeGroup.id] ?? 0)
  const groupFilterMenu = () => [
    {
      label: t('section.ungrouped'),
      suffix: String(counts[UNGROUPED] ?? 0),
      check: filter === UNGROUPED,
      run: () => { setFilter(filter === UNGROUPED ? ALL : UNGROUPED) },
    },
    ...(state.groups.length === 0 ? [] : [{ sep: true }]),
    ...state.groups.map((group) => ({
      label: `${group.emoji}${group.name}`,
      suffix: String(counts[group.id] ?? 0),
      check: filter === group.id,
      run: () => { setFilter(filter === group.id ? ALL : group.id) },
    })),
    { sep: true },
    { label: t('action.createGroup'), run: () => { setDialog({ kind: 'create-group' }) } },
  ]

  const flatMode = state.prefs.groupBy === 'flat'
  const flatTotal = derived.sections.reduce((total, section) => total + section.orphans.length, 0)
  const chips = flatMode
    ? [{ key: ALL, label: t('section.sessions'), count: flatTotal }]
    : [
    { key: ALL, label: t('section.workspaces'), count: counts.all },
    ...(counts[PINNED] > 0 ? [{ key: PINNED, label: t('section.pinned'), icon: 'star', count: counts[PINNED] }] : []),
    ...(state.groups.length === 0 && filter !== UNGROUPED
      ? []
      : [{
        key: '__groups__',
        menu: true,
        active: groupFilterActive,
        label: groupFilterLabel,
        count: groupFilterCount,
      }]),
    ...(state.prefs.showHidden === true && counts[HIDDEN] > 0
      ? [{ key: HIDDEN, label: t('section.hidden'), count: counts[HIDDEN] }]
      : []),
    ]

  /**
   * Drop plumbing for one session row: only same-workspace reordering is legal
   * (the host's `insertSessionBefore` moves members of an existing account), so
   * a drag from another workspace is refused instead of erroring out.
   */
  const sessionDropProps = (row, workspaceId) => {
    const key = `s:${row.id}`
    const halfOf = (event) => {
      const box = event.currentTarget.getBoundingClientRect()
      return event.clientY < box.top + box.height / 2 ? 'before' : 'after'
    }
    return {
      onDragOver: (event) => {
        if (drag === null || drag.kind !== 'session' || drag.id === row.id) return
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer !== undefined) event.dataTransfer.dropEffect = 'move'
        const target = `${key}:${halfOf(event)}`
        if (dropTarget !== target) setDropTarget(target)
      },
      onDragLeave: () => {
        if (dropTarget === `${key}:before` || dropTarget === `${key}:after`) setDropTarget(null)
      },
      onDrop: (event) => {
        if (drag === null || drag.kind !== 'session' || drag.id === row.id) return
        if (drag.workspaceId !== workspaceId) return
        event.preventDefault()
        event.stopPropagation()
        const half = halfOf(event)
        const ids = drag.siblings
        const anchor = half === 'before' ? row.id : ids[ids.indexOf(row.id) + 1]
        ui.moveSession(workspaceId, drag.id, anchor).catch((reason) => {
          setError(String(reason?.message ?? reason))
        })
        setDrag(null)
        setDropTarget(null)
      },
    }
  }

  const renderSession = (row, workspaceId, siblings) => h('div', Object.assign({
    key: row.id,
    className: [
      'wp-session',
      row.selected ? 'wp-session-on' : null,
      row.content === true ? 'wp-session-content' : null,
      drag !== null && drag.kind === 'session' && drag.id === row.id ? 'wp-ws-dragging' : null,
      dropTarget === `s:${row.id}:before` || dropTarget === `s:${row.id}:after` ? 'wp-drop-target' : null,
    ].filter(Boolean).join(' '),
    draggable: workspaceId !== undefined,
    role: 'treeitem',
    'aria-selected': row.selected === true,
    title: row.title,
    tabIndex: 0,
    onClick: () => { ui.open(row.id) },
    onKeyDown: (event) => { if (event.key === 'Enter') ui.open(row.id) },
    onDragStart: (event) => {
      if (workspaceId === undefined) return
      event.stopPropagation()
      setDrag({ kind: 'session', id: row.id, workspaceId, siblings })
      try { event.dataTransfer.setData('text/plain', row.id) } catch (error) { /* Safari needs a write */ }
      event.dataTransfer.effectAllowed = 'move'
    },
    onDragEnd: () => { setDrag(null); setDropTarget(null) },
    onContextMenu: (event) => {
      event.preventDefault()
      openMenuAt(event, () => sessionMenu(row))
    },
  }, workspaceId === undefined ? {} : sessionDropProps(row, workspaceId)),
  h(StatusDot, { state: sessionStatusOf(t, row).state, title: sessionStatusOf(t, row).label }),
  h('span', { className: 'wp-body' },
    h('span', { className: 'wp-label' }, row.title),
    row.content === true && row.snippet !== ''
      ? h('span', { className: 'wp-snippet' }, row.workspace === '' ? row.snippet : `${row.workspace} · ${row.snippet}`)
      : null),
  row.runningSubagentCount > 0
    ? h('span', { className: 'wp-subagents', title: t('status.subagents', { n: row.runningSubagentCount }) }, `↳${row.runningSubagentCount}`)
    : null,
  row.scheduled === true ? h('span', { className: 'wp-scheduled', title: t('status.scheduled') }, h(Icon, { name: 'alarm', size: 12 })) : null,
  // The flat listing has no group headers, so each row carries its project.
  row.content !== true && row.workspace !== undefined && row.workspace !== ''
    ? h('span', { className: 'wp-rowspace' }, row.workspace)
    : null,
  h('span', { className: 'wp-actions' },
    h('button', {
      type: 'button',
      className: 'wp-rowbtn',
      'aria-label': t('action.more'),
      title: t('action.more'),
      onClick: (event) => { event.stopPropagation(); openMenu(event, () => sessionMenu(row)) },
    }, h(Icon, { name: 'more', size: 14 }))))

  const renderWorkspace = (item, section) => {
    const open = expanded.includes(item.id)
    const current = item.sessions.some((row) => row.selected === true)
    return h('div', { key: item.id, className: open ? 'wp-wsblock wp-wsblock-open' : 'wp-wsblock' },
      h('div', Object.assign({
        className: [
          'wp-ws',
          current ? 'wp-ws-current' : null,
          bulk === true && isSelected(item.id) ? 'wp-ws-picked' : null,
          drag !== null && drag.kind === 'workspace' && drag.id === item.id ? 'wp-ws-dragging' : null,
          dropTarget === `ws:${item.id}:before` || dropTarget === `ws:${item.id}:after` ? 'wp-drop-target' : null,
        ].filter(Boolean).join(' '),
        role: 'treeitem',
        'aria-expanded': bulk === true ? undefined : open,
        tabIndex: 0,
        title: item.path,
        draggable: bulk !== true,
        onClick: () => {
          if (bulk === true) { toggleSelected(item.id); return }
          toggleExpanded(item.id)
        },
        onDoubleClick: () => { if (bulk !== true) ui.startSession(item.id) },
        onKeyDown: (event) => {
          if (event.key !== 'Enter') return
          if (bulk === true) { toggleSelected(item.id); return }
          toggleExpanded(item.id)
        },
        onDragStart: (event) => {
          event.stopPropagation()
          setDrag({ kind: 'workspace', id: item.id })
          try { event.dataTransfer.setData('text/plain', item.id) } catch (error) { /* Safari needs a write */ }
          event.dataTransfer.effectAllowed = 'move'
        },
        onDragEnd: () => { setDrag(null); setDropTarget(null) },
        onContextMenu: (event) => {
          event.preventDefault()
          openMenuAt(event, () => workspaceMenu(item))
        },
      }, rowDropProps(item, section)),
      bulk === true
        ? h('span', { className: isSelected(item.id) ? 'wp-check wp-check-on' : 'wp-check' },
          isSelected(item.id) ? h(Icon, { name: 'check', size: 11 }) : null)
        : h('span', { className: open ? 'wp-caret wp-caret-open' : 'wp-caret' },
          item.sessionCount > 0 ? h(Icon, { name: 'chevron', size: 12 }) : null),
      h('span', { className: current ? 'wp-folder wp-folder-on' : 'wp-folder' }, h(Icon, { name: open ? 'folderOpen' : 'folderClosed', size: 16 })),
      h('span', { className: 'wp-label wp-label-hug' }, item.label),
      // The session count rides the name as "(n)" instead of a pill on the far
      // rail, so the label is no longer the flex grower and a spacer keeps the
      // time column right-aligned.
      item.sessionCount > 0 ? h('span', { className: 'wp-count-inline' }, `(${item.sessionCount})`) : null,
      h(StatusCluster, {
        t,
        pendingCount: item.pendingCount,
        runningCount: item.runningCount,
        completedCount: item.completedCount,
        attention: item.attention,
      }),
      h('span', { className: 'wp-spacer' }),
      h('span', { className: 'wp-meta' },
        item.pinned ? h('span', { className: 'wp-pinmark' }, h(Icon, { name: 'star', size: 11 })) : null,
        item.activityAt > 0 && wide ? h('span', { className: 'wp-time' }, timeText(t, item.activityAt)) : null),
      bulk === true ? null : h('span', { className: 'wp-actions' },
        h('button', {
          type: 'button',
          className: item.pinned ? 'wp-rowbtn wp-star-on' : 'wp-rowbtn',
          'aria-label': item.pinned ? t('action.unpin') : t('action.pin'),
          title: item.pinned ? t('action.unpin') : t('action.pin'),
          onClick: (event) => { event.stopPropagation(); store.actions.togglePin(item.id) },
        }, h(Icon, { name: item.pinned ? 'star' : 'starLine', size: 13 })),
        h('button', {
          type: 'button',
          className: 'wp-rowbtn',
          'aria-label': t('action.more'),
          title: t('action.more'),
          onClick: (event) => { openMenu(event, () => workspaceMenu(item)) },
        }, h(Icon, { name: 'more', size: 14 })))),
      dropTarget === `ws:${item.id}:before` ? h('div', { className: 'wp-insert-line' }) : null,
      open
        ? h('div', { className: 'wp-sessions', role: 'group' },
          (allSessions.includes(item.id) || item.sessions.length <= SESSION_CAP
            ? item.sessions
            : item.sessions.slice(0, SESSION_CAP)).map((row) => h(React.Fragment, { key: row.id },
            dropTarget === `s:${row.id}:before` ? h('div', { className: 'wp-insert-line wp-insert-line-session' }) : null,
            renderSession(row, item.id, item.sessions.map((entry) => entry.id)),
            dropTarget === `s:${row.id}:after` ? h('div', { className: 'wp-insert-line wp-insert-line-session' }) : null)),
          item.sessions.length > SESSION_CAP
            ? h('button', {
              type: 'button',
              className: 'wp-more',
              onClick: () => {
                setAllSessions((list) => list.includes(item.id) ? list.filter((id) => id !== item.id) : [...list, item.id])
              },
            }, allSessions.includes(item.id)
              ? t('session.less')
              : t('session.more', { n: item.sessions.length - SESSION_CAP }))
            : null)
        : null,
      dropTarget === `ws:${item.id}:after` ? h('div', { className: 'wp-insert-line wp-insert-line-after' }) : null)
  }

  const renderSection = (section) => {
    const isGroup = section.kind === 'group'
    const total = section.workspaces.length + section.orphans.length
    const collapsed = section.collapsed === true
    const dropKey = `sec:${section.key}`
    const folded = collapsed
    return h('div', Object.assign(
      {
        key: section.key,
        className: [
          'wp-sec',
          dropTarget === dropKey ? 'wp-sec-drop' : null,
          folded ? 'wp-sec-collapsed' : null,
        ].filter(Boolean).join(' '),
      },
      dropProps(dropKey, (payload) => payload.kind === 'workspace', (payload) => {
        if (section.kind === 'group') store.actions.assign(payload.id, section.key)
        else if (section.kind === 'ungrouped') store.actions.assign(payload.id, undefined)
        else if (section.kind === 'pinned') store.actions.pinMany([payload.id], true)
      })),
      h('div', Object.assign({ className: 'wp-sechead' },
        isGroup ? dropProps(`g:${section.key}`, (payload) => payload.kind === 'group' && payload.id !== section.key, (payload) => {
          store.actions.moveGroupBefore(payload.id, section.key)
        }) : {}),
        h('button', Object.assign({
          type: 'button',
          className: 'wp-sechead-main',
          'aria-expanded': !collapsed,
          onClick: () => {
            if (isGroup) store.actions.toggleGroupCollapsed(section.key)
            else if (section.kind === 'pinned') store.actions.setPrefs({ pinCollapsed: !collapsed })
            else if (section.kind === 'ungrouped') store.actions.setPrefs({ ungroupedCollapsed: !collapsed })
            else if (section.kind === 'hidden') store.actions.setPrefs({ hiddenCollapsed: !collapsed })
          },
          disabled: section.kind === 'search',
        }, isGroup ? {
          draggable: true,
          onDragStart: (event) => {
            event.stopPropagation()
            setDrag({ kind: 'group', id: section.key })
            try { event.dataTransfer.setData('text/plain', section.key) } catch (error) { /* Safari needs a write */ }
            event.dataTransfer.effectAllowed = 'move'
          },
          onDragEnd: () => { setDrag(null); setDropTarget(null) },
        } : {}),
        h('span', { className: collapsed ? 'wp-caret' : 'wp-caret wp-caret-open' }, h(Icon, { name: 'chevron', size: 12 })),
        isGroup
          ? h('span', { className: 'wp-gdot', style: { background: colorOf(section.color) } })
          : section.kind === 'pinned'
            ? h('span', { className: 'wp-secicon' }, h(Icon, { name: 'star', size: 11 }))
            : null,
        h('span', { className: 'wp-sectitle' }, isGroup ? `${section.emoji}${section.label}` : section.label),
        h('span', { className: 'wp-secright' },
          h(StatusCluster, {
            t,
            pendingCount: section.pendingCount,
            runningCount: section.runningCount,
            completedCount: section.completedCount,
            attention: section.attention,
          }),
          h('span', { className: 'wp-seccount' }, String(total)))),
        isGroup
          ? h('button', {
            type: 'button',
            className: 'wp-rowbtn',
            'aria-label': t('action.more'),
            title: t('action.more'),
            onClick: (event) => { openMenu(event, () => groupMenu(section)) },
          }, h(Icon, { name: 'more', size: 14 }))
          : null),
      collapsed
        ? null
        : h('div', { className: 'wp-secbody', role: 'group' },
          total === 0
            ? h('div', { className: 'wp-hint' }, section.kind === 'pinned' ? t('state.noPinned') : t('group.empty'))
            : null,
          section.kind === 'search'
            ? h('div', { className: 'wp-hint' }, section.hasMore === true ? t('search.hasMore') : '')
            : null,
          section.orphans.map(renderSession),
          section.workspaces.map((item) => renderWorkspace(item, section))))
  }

  if (wide !== true) {
    // Rail: search/expand plus every pinned project, carrying the same live
    // state a folded row shows. A click expands the column and unfolds it.
    const pinnedItems = state.pinned
      .map((id) => {
        const live = derived.sections.flatMap((section) => section.workspaces).find((item) => item.id === id)
        if (live !== undefined) return live
        const raw = workspaceSnapshot.items.find((entry) => entry.workspaceId === id)
        return raw === undefined ? undefined : { id, label: workspaceLabel(raw), pendingCount: 0, runningCount: 0, completedCount: 0 }
      })
      .filter((item) => item !== undefined)
    return h('div', { className: 'wp-root wp-rail' },
      h('button', {
        type: 'button',
        className: 'wp-railbtn',
        'aria-label': t('search.aria'),
        title: t('search.aria'),
        onClick: () => { expandSidebar() },
      }, h(Icon, { name: 'search', size: 18 })),
      h('div', { className: 'wp-rail-list' }, pinnedItems.map((item) => h('button', {
        key: item.id,
        type: 'button',
        className: 'wp-railletter',
        title: item.pendingCount > 0
          ? `${item.label} · ${t('status.waitingAnswer')}`
          : item.runningCount > 0 ? `${item.label} · ${t('status.running')}` : item.label,
        onClick: () => {
          setExpanded((list) => list.includes(item.id) ? list : [...list, item.id])
          setSearchOpen(false)
          expandSidebar()
        },
        onContextMenu: (event) => {
          event.preventDefault()
          openMenuAt(event, () => workspaceMenu(item))
        },
      },
      item.label.slice(0, 1).toUpperCase(),
      item.pendingCount > 0 || item.runningCount > 0 || item.completedCount > 0
        ? h('span', { className: 'wp-railbadge' }, h(StatusDot, {
          state: item.pendingCount > 0 ? 'warning' : item.runningCount > 0 ? 'ongoing' : 'done',
          size: 6,
        }))
        : null))))

  }

  return h('div', { className: 'wp-root' },
    h('div', { className: 'wp-head' },
      h('span', { className: 'wp-title' }, t('section.workspaces')),
      h('div', { className: 'wp-head-actions' },
        h(IconButton, {
          name: 'search',
          label: t('search.aria'),
          active: searchOpen,
          onClick: () => { setSearchOpen((open) => !open); if (searchOpen) setQuery('') },
        }),
        h(IconButton, {
          name: 'sort',
          label: t('action.sort'),
          onClick: (event) => { openMenu(event, viewMenu) },
        }),
        h(IconButton, {
          name: 'plus',
          label: t('action.add'),
          onClick: () => { setDir({ path: '', listing: undefined, loading: true, error: null }) },
        }))),
    searchOpen
      ? h('div', { className: 'wp-searchbar' },
        h(Icon, { name: 'search', size: 14 }),
        h('input', {
          ref: searchRef,
          type: 'text',
          value: query,
          placeholder: t('search.placeholder'),
          'aria-label': t('search.aria'),
          onChange: (event) => { setQuery(event.target.value) },
          onKeyDown: (event) => {
            if (event.key !== 'Escape') return
            setQuery('')
            setSearchOpen(false)
          },
        }),
        query !== ''
          ? h('button', {
            type: 'button',
            className: 'wp-search-clear',
            'aria-label': t('search.clear'),
            title: t('search.clear'),
            onClick: () => { setQuery('') },
          }, h(Icon, { name: 'close', size: 12 }))
          : null)
      : null,
    bulk === true
      ? h('div', { className: 'wp-bulkbar' },
        h('span', { className: 'wp-bulkcount' }, t('bulk.selected', { n: selected.length })),
        h('div', { className: 'wp-bulkbar-actions' },
        h('button', { type: 'button', className: 'wp-chip', disabled: selected.length === 0, onClick: () => { store.actions.pinMany(selected, true) } }, h('span', null, t('action.bulkPin'))),
        h('button', { type: 'button', className: 'wp-chip', disabled: selected.length === 0, onClick: () => { store.actions.pinMany(selected, false) } }, h('span', null, t('action.bulkUnpin'))),
        h('button', { type: 'button', className: 'wp-chip', disabled: selected.length === 0, onClick: (event) => {
          openMenu(event, () => [
            ...state.groups.map((group) => ({ label: `${group.emoji}${group.name}`, run: () => { store.actions.assignMany(selected, group.id) } })),
            { label: t('action.noGroup'), run: () => { store.actions.assignMany(selected, undefined) } },
            { sep: true },
            { label: t('action.createGroup'), run: () => { setDialog({ kind: 'create-group' }) } },
          ])
        } }, h('span', null, t('action.bulkGroup'))),
        h('button', { type: 'button', className: 'wp-chip', disabled: selected.length === 0, onClick: () => { store.actions.hideMany(selected); setSelected([]) } }, h('span', null, t('action.bulkHide'))),
        h('button', { type: 'button', className: 'wp-chip', onClick: () => { setSelected(visibleWorkspaceIds()) } }, h('span', null, t('action.selectAll')))),
        h('button', { type: 'button', className: 'wp-chip wp-chip-icon wp-bulkdone', 'aria-label': t('action.finish'), title: t('action.finish'), onClick: () => { setBulk(false); setSelected([]) } }, h(Icon, { name: 'check', size: 12 })))
      : null,
    status !== null ? h('div', { className: 'wp-status' }, status) : null,
    h('div', { className: 'wp-chips' },
      chips.map((chip) => {
        const on = chip.menu === true ? chip.active === true : filter === chip.key
        return h('button', {
          key: chip.key,
          type: 'button',
          className: on ? 'wp-chip wp-chip-on' : 'wp-chip',
          'aria-pressed': on,
          onClick: chip.menu === true
            ? (event) => { openMenu(event, groupFilterMenu) }
            : () => { setFilter(filter === chip.key ? ALL : chip.key) },
        },
        chip.icon !== undefined ? h(Icon, { name: chip.icon, size: 11 }) : null,
        h('span', null, chip.label),
        h('b', null, String(chip.count)),
        chip.menu === true ? h(Icon, { name: 'chevronDown', size: 11 }) : null)
      }),
      flatMode
        ? null
        : h('button', {
          type: 'button',
          className: 'wp-chip wp-chip-icon',
          'aria-label': t('action.createGroup'),
          title: t('action.createGroup'),
          onClick: () => { setDialog({ kind: 'create-group' }) },
        }, h(Icon, { name: 'plus', size: 12 }))),
    error !== null ? h('div', { className: 'wp-error' }, error) : null,
    h('div', { className: 'wp-scroll', role: 'tree' },
      derived.sections.length === 0
        ? h('div', { className: 'wp-hint' }, t('state.empty'))
        : derived.sections.map(renderSection),
      counts[HIDDEN] > 0 && state.prefs.showHidden !== true
        ? h('button', {
          type: 'button',
          className: 'wp-chip wp-hidden-hint',
          onClick: () => { store.actions.setPrefs({ showHidden: true }) },
        }, h('span', null, t('action.showHidden')), h('b', null, String(counts[HIDDEN])))
        : null),
    dir === null
      ? null
      : h(DirectoryDialog, {
        t,
        dir,
        onOpen: (path) => { setDir({ path, listing: undefined, loading: true, error: null }) },
        onClose: () => { setDir(null) },
        onChoose: (path) => {
          setDir(null)
          ui.adoptDirectory(path).catch((reason) => { setError(String(reason?.message ?? reason)) })
        },
        onNative: () => {
          setDir(null)
          ui.addWorkspace().catch((reason) => { setError(String(reason?.message ?? reason)) })
        },
        onCreate: async (parent, name) => {
          try {
            const created = await ui.createDirectory(parent, name)
            setDir({ path: created, listing: undefined, loading: true, error: null })
          } catch (reason) {
            setDir((current) => current === null ? current : { ...current, error: String(reason?.message ?? reason) })
          }
        },
      }),
    menu !== null && typeof shippedMenu === 'function'
      ? h(shippedMenu, {
        open: true,
        anchor: null,
        items: menuEntries(menu.items),
        selectedId: selectedEntryId(menu.items),
        onSelect: (id) => {
          const entry = menu.items[Number(String(id).replace('mi-', ''))]
          closeMenu()
          if (entry !== undefined && typeof entry.run === 'function') entry.run()
        },
        onClose: closeMenu,
        portal: true,
        getAnchorRect: () => menu.rect,
      })
      : null,
    menu !== null && typeof shippedMenu !== 'function'
      ? h(PopupMenu, { anchor: { left: menu.rect.left, bottom: menu.rect.bottom }, onClose: closeMenu },
        menu.items.map((entry, index) => entry.sep === true
          ? h('div', { key: `sep-${index}`, className: 'wp-menu-sep' })
          : entry.label2 === true
            ? h('div', { key: `label-${index}`, className: 'wp-menu-label' }, entry.label)
            : h('button', {
              key: `item-${index}`,
              type: 'button',
              className: entry.danger === true ? 'wp-menu-item wp-menu-danger' : 'wp-menu-item',
              onClick: () => { closeMenu(); entry.run() },
            },
            entry.check === true ? h('span', { className: 'wp-menu-check' }, h(Icon, { name: 'check', size: 12 })) : null,
            h('span', null, entry.label),
            entry.suffix === undefined ? null : h('small', null, entry.suffix))))
      : null,
    dialog === null ? null : renderDialog(dialog, { state, store, ui, t, busy, setDialog, setStatus, runDialog }))
}

/** Dialog factory; keeps the modal vocabulary in one place. */
function renderDialog(dialog, ctx) {
  const { store, ui, t, busy, setDialog, runDialog, state } = ctx
  if (dialog.kind === 'create-group') {
    return h(CreateGroupDialog, {
      t,
      busy,
      onCancel: () => { setDialog(null) },
      onSubmit: (name, emoji) => {
        const id = store.actions.createGroup(name)
        if (emoji !== undefined && emoji !== '') store.actions.setGroupEmoji(id, emoji)
        setDialog(null)
      },
    })
  }
  if (dialog.kind === 'rename-group') {
    return h(RenameDialog, {
      t,
      busy,
      title: t('dialog.renameGroup.title'),
      value: dialog.value,
      colors: true,
      color: state.groups.find((group) => group.id === dialog.id)?.color ?? 'gray',
      emojis: EMOJIS,
      emoji: state.groups.find((group) => group.id === dialog.id)?.emoji ?? '',
      onColor: (color) => { store.actions.setGroupColor(dialog.id, color) },
      onEmoji: (emoji) => { store.actions.setGroupEmoji(dialog.id, emoji) },
      onCancel: () => { setDialog(null) },
      onSubmit: (name) => { store.actions.renameGroup(dialog.id, name); setDialog(null) },
    })
  }
  if (dialog.kind === 'rename-workspace') {
    return h(RenameDialog, {
      t,
      busy,
      title: t('dialog.renameWorkspace.title'),
      value: dialog.value,
      onCancel: () => { setDialog(null) },
      onSubmit: (name) => { runDialog(dialog, () => ui.rename(dialog.id, name)) },
    })
  }
  if (dialog.kind === 'delete-workspace') {
    return h(Dialog, {
      title: `${t('dialog.deleteWorkspace.title')} ${dialog.label}`,
      body: t('dialog.deleteWorkspace.body'),
      confirmLabel: t('dialog.confirm'),
      danger: true,
      busy,
      onCancel: () => { setDialog(null) },
      onConfirm: () => { runDialog(dialog, () => ui.remove(dialog.id)) },
    })
  }
  if (dialog.kind === 'delete-group') {
    return h(Dialog, {
      title: t('dialog.deleteGroup.title'),
      body: t('dialog.deleteGroup.body'),
      confirmLabel: t('dialog.confirm'),
      danger: true,
      busy,
      onCancel: () => { setDialog(null) },
      onConfirm: () => { store.actions.deleteGroup(dialog.id); setDialog(null) },
    })
  }
  if (dialog.kind === 'rename-session') {
    return h(RenameDialog, {
      t,
      busy,
      title: t('dialog.renameSession.title'),
      value: dialog.value,
      onCancel: () => { setDialog(null) },
      onSubmit: (name) => { runDialog(dialog, () => ui.renameSession(dialog.id, name)) },
    })
  }
  if (dialog.kind === 'export-config') {
    return h(TextDialog, {
      t,
      title: t('dialog.export.title'),
      body: t('dialog.export.body'),
      value: dialog.value,
      actionLabel: t('action.copy'),
      onAction: (text) => { ui.copyText(text).then((copied) => { if (copied) setStatus(t('status.copied')) }) },
      onCancel: () => { setDialog(null) },
    })
  }
  if (dialog.kind === 'import-config') {
    return h(ImportDialog, {
      t,
      busy,
      onCancel: () => { setDialog(null) },
      onSubmit: (text) => {
        let parsed
        try {
          parsed = JSON.parse(text)
        } catch (error) {
          return t('dialog.import.invalid')
        }
        store.actions.replaceAll(normalizeState(parsed))
        setDialog(null)
        setStatus(`${t('action.import')} ✓`)
        return undefined
      },
    })
  }
  return null
}

function CreateGroupDialog({ t, busy, onSubmit, onCancel }) {
  const [value, setValue] = React.useState('')
  const [emoji, setEmoji] = React.useState('')
  return h(Dialog, {
    title: t('dialog.createGroup.title'),
    value,
    placeholder: t('dialog.name.placeholder'),
    emojis: EMOJIS,
    emoji,
    onEmoji: setEmoji,
    confirmLabel: t('dialog.confirm'),
    busy,
    onValue: setValue,
    onCancel,
    onConfirm: () => { if (value.trim() !== '') onSubmit(value.trim(), emoji) },
  })
}

function RenameDialog({ t, busy, title, value, colors, color, emojis, emoji, onValue, onColor, onEmoji, onSubmit, onCancel }) {
  const [draft, setDraft] = React.useState(value ?? '')
  return h(Dialog, {
    title,
    value: draft,
    placeholder: t('dialog.name.placeholder'),
    colors,
    color,
    emojis,
    emoji,
    onEmoji,
    confirmLabel: t('dialog.confirm'),
    busy,
    onValue: (next) => { setDraft(next); if (onValue !== undefined) onValue(next) },
    onColor,
    onCancel,
    onConfirm: () => { if (draft.trim() !== '') onSubmit(draft.trim()) },
  })
}

/**
 * The shipped state dot (green done / amber attention / blue running ring),
 * reached through the same seed module as the icons. The inline fallback keeps
 * the panel readable if a shell does not expose it.
 */
function StatusDot({ state, size = 8, title }) {
  const shipped = shippedIcons === undefined ? undefined : shippedIcons.StateDot
  if (typeof shipped === 'function') return h(shipped, { state, size, className: 'wp-state' })
  return h('span', { className: `wp-fallback-dot wp-fallback-${state}`, title })
}

/** One session's status, with the shipped precedence: pending outranks running. */
function sessionStatusOf(t, row) {
  if (row.attention === 'approval') return { state: 'warning', label: t('status.waitingApproval') }
  if (row.attention === 'plan-review') return { state: 'warning', label: t('status.planReview') }
  if (row.attention !== undefined) return { state: 'warning', label: t('status.waitingAnswer') }
  if (row.running === true) return { state: 'ongoing', label: t('status.running') }
  if (row.completed === true) return { state: 'done', label: t('status.completed') }
  return { state: 'idle', label: t('status.idle') }
}

/**
 * Workspace/section status cluster: one dot per live state, with a count when
 * more than one session shares it. Rendered on collapsed rows too, so a folded
 * project still says whether work is running or the operator is awaited.
 */
function StatusCluster({ t, pendingCount, runningCount, completedCount, attention }) {
  const entries = []
  if (pendingCount > 0) {
    const label = attention === 'approval' ? t('status.waitingApproval')
      : attention === 'plan-review' ? t('status.planReview') : t('status.waitingAnswer')
    entries.push({ state: 'warning', label, count: pendingCount })
  }
  if (runningCount > 0) entries.push({ state: 'ongoing', label: t('status.running'), count: runningCount })
  if (completedCount > 0) entries.push({ state: 'done', label: t('status.completed'), count: completedCount })
  if (entries.length === 0) return null
  return h('span', { className: 'wp-cluster' }, entries.map((entry) => h('span', {
    key: entry.state,
    className: 'wp-cluster-item',
    title: entry.label,
    'aria-label': entry.label,
  }, h(StatusDot, { state: entry.state }), entry.count > 1 ? h('b', null, String(entry.count)) : null)))
}

/**
 * In-app directory browser: the panel's own picker, driven by the
 * `uiWorkspace` client service. The shipped region reaches its picker through
 * the `directoryFlow` child hole, which belongs to the entry we shadow, so this
 * panel carries its own — and it works where the OS chooser cannot (a remote
 * browser, a headless host).
 */
function DirectoryDialog({ t, dir, onOpen, onClose, onChoose, onNative, onCreate }) {
  const [name, setName] = React.useState('')
  const listing = dir.listing
  const currentPath = listing === undefined ? dir.path : listing.path
  const crumbStyle = { display: 'flex', flexWrap: 'wrap', gap: '2px', alignItems: 'center' }
  return h(React.Fragment, null,
    h('div', { className: 'wp-backdrop', onClick: onClose }),
    h('div', { className: 'wp-dialog wp-dialog-wide', role: 'dialog', 'aria-modal': true },
      h('h4', null, t('dir.title')),
      h('div', { className: 'wp-crumbs', style: crumbStyle },
        (listing?.crumbs ?? []).map((crumb, index) => h(React.Fragment, { key: crumb.path },
          index === 0 ? null : h('span', { className: 'wp-crumb-sep' }, '/'),
          h('button', {
            type: 'button',
            className: index === (listing?.crumbs?.length ?? 0) - 1 ? 'wp-crumb wp-crumb-on' : 'wp-crumb',
            onClick: () => { onOpen(crumb.path) },
          }, crumb.name)))),
      dir.error !== null && dir.error !== undefined
        ? h('div', { className: 'wp-dialog-error' }, dir.error)
        : null,
      h('div', { className: 'wp-dir-list' },
        dir.loading === true && listing === undefined
          ? h('div', { className: 'wp-hint' }, '…')
          : (listing?.entries ?? []).length === 0
            ? h('div', { className: 'wp-hint' }, t('dir.empty'))
            : (listing?.entries ?? []).map((entry) => h('button', {
              key: entry.path,
              type: 'button',
              className: entry.hidden === true ? 'wp-dir-row wp-dir-hidden' : 'wp-dir-row',
              title: entry.path,
              onClick: () => { onOpen(entry.path) },
            }, h(Icon, { name: 'folderClosed', size: 14 }), h('span', { className: 'wp-label' }, entry.name)))),
      listing?.truncated === true ? h('div', { className: 'wp-hint' }, t('dir.truncated')) : null,
      h('div', { className: 'wp-dir-new' },
        h('input', {
          type: 'text',
          value: name,
          placeholder: t('dir.new'),
          onChange: (event) => { setName(event.target.value) },
        }),
        h('button', {
          type: 'button',
          className: 'wp-btn',
          disabled: name.trim() === '',
          onClick: () => { const draft = name.trim(); if (draft === '') return; setName(''); onCreate(currentPath, draft) },
        }, t('dir.create'))),
      h('div', { className: 'wp-dialog-actions' },
        h('button', { type: 'button', className: 'wp-btn', onClick: onNative }, t('dir.native')),
        h('button', { type: 'button', className: 'wp-btn', onClick: onClose }, t('action.close')),
        h('button', {
          type: 'button',
          className: 'wp-btn wp-btn-primary',
          disabled: currentPath === '' || currentPath === undefined,
          onClick: () => { onChoose(currentPath) },
        }, t('dir.choose')))))
}

/** Read-only textarea dialog used by config export. */
function TextDialog({ t, title, body, value, actionLabel, onAction, onCancel }) {
  return h(React.Fragment, null,
    h('div', { className: 'wp-backdrop', onClick: onCancel }),
    h('div', { className: 'wp-dialog', role: 'dialog', 'aria-modal': true },
      h('h4', null, title),
      h('p', null, body),
      h('textarea', {
        readOnly: true,
        value,
        onFocus: (event) => { event.target.select() },
      }),
      h('div', { className: 'wp-dialog-actions' },
        h('button', { type: 'button', className: 'wp-btn', onClick: onCancel }, t('action.close')),
        h('button', { type: 'button', className: 'wp-btn wp-btn-primary', onClick: () => { onAction(value) } }, actionLabel))))
}

/** Paste-a-document dialog used by config import; returns a message on failure. */
function ImportDialog({ t, busy, onSubmit, onCancel }) {
  const [draft, setDraft] = React.useState('')
  const [problem, setProblem] = React.useState(null)
  return h(React.Fragment, null,
    h('div', { className: 'wp-backdrop', onClick: onCancel }),
    h('div', { className: 'wp-dialog', role: 'dialog', 'aria-modal': true },
      h('h4', null, t('dialog.import.title')),
      h('p', null, t('dialog.import.body')),
      h('textarea', {
        value: draft,
        placeholder: '{ "pinned": [], "groups": [] }',
        onChange: (event) => { setDraft(event.target.value); setProblem(null) },
      }),
      problem === null ? null : h('div', { className: 'wp-dialog-error' }, problem),
      h('div', { className: 'wp-dialog-actions' },
        h('button', { type: 'button', className: 'wp-btn', onClick: onCancel }, t('action.close')),
        h('button', {
          type: 'button',
          className: 'wp-btn wp-btn-primary',
          disabled: busy === true,
          onClick: () => {
            const failure = onSubmit(draft)
            if (failure !== undefined) setProblem(failure)
          },
        }, t('dialog.confirm')))))
}

/** Sidebar-foot switch: always reachable, including after the panel is disabled. */
function FooterToggle(props) {
  const { store, t } = props
  const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot)
  const on = state.prefs.enhanced !== false
  return h('button', {
    type: 'button',
    className: on ? 'wp-footbtn wp-footbtn-on' : 'wp-footbtn',
    title: on ? t('action.enhanceOn') : t('action.enhanceOff'),
    'aria-pressed': on,
    onClick: () => { store.actions.setPrefs({ enhanced: !on }) },
  }, h(Icon, { name: 'sparkle', size: 12 }), h('span', null, t('action.enhance')))
}

/**
 * Register the panel and the footer switch once their slot declarations exist.
 * @param ctx - client root context.
 */
export function apply(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) return
  const locale = ctx.get('locale')
  if (locale !== undefined) {
    ctx.effect(
      () => locale.register(NS, { zh: ZH, en: EN }),
      'worksop-plus: dictionaries',
    )
  }
  const store = createViewStore(undefined)
  // Late binding: ui-settings may apply before or after this plugin.
  ctx.inject(['settingsScope'], (scopedCtx) => {
    store.attachScope(scopedCtx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE }))
    return () => { store.attachScope(undefined) }
  })
  ctx.effect(() => store.dispose, 'worksop-plus: settings subscription')
  ctx.effect(() => injectStyle(), 'worksop-plus: styles')

  const workspaces = ctx.get('workspaces')
  const uiWorkspace = ctx.get('uiWorkspace')
  const sessions = ctx.get('sessions')
  const ui = {
    startSession: (workspaceId) => {
      if (workspaceId === undefined) { uiWorkspace?.startSession(); return }
      uiWorkspace?.startSession(workspaceId)
    },
    open: (sessionId) => { sessions?.open(sessionId) },
    archive: async (sessionId) => { await uiWorkspace?.archiveSession(sessionId) },
    rename: async (workspaceId, title) => { await workspaces?.rename(workspaceId, title) },
    remove: async (workspaceId) => { await workspaces?.delete(workspaceId) },
    moveSession: async (workspaceId, sessionId, beforeSessionId) => {
      await workspaces?.insertSessionBefore(workspaceId, sessionId, beforeSessionId)
    },
    forkSession: (sessionId) => {
      sessions?.fork({ sessionId, increaseTitle: true })
        .then((childId) => { sessions?.open(childId) })
        .catch((reason) => { console.error('worksop-plus: fork failed', reason) })
    },
    renameSession: async (sessionId, title) => {
      const session = sessions?.binding(sessionId)?.session
      if (session === undefined) throw new Error(`unknown session "${sessionId}"`)
      const result = await session.rename(title)
      if (result !== undefined && result.ok !== true) throw new Error(result.error?.message ?? 'rename failed')
    },
    materializeOrder: async (orderedIds) => {
      // insertBefore is DOM-shaped: walking the target order backwards, each
      // entry anchors before its successor, ending with an append of the last.
      for (let index = orderedIds.length - 1; index >= 0; index -= 1) {
        await workspaces?.insertBefore(orderedIds[index], orderedIds[index + 1])
      }
    },
    copyText: async (text) => {
      try {
        const shipped = shippedIcons?.writeClipboard
        if (typeof shipped === 'function') { await shipped(text); return true }
        if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
          await navigator.clipboard.writeText(text)
          return true
        }
        return false
      } catch (error) {
        console.error('worksop-plus: clipboard write failed', error)
        return false
      }
    },
    searchSessions: async (query, signal) => {
      if (sessions === undefined) return { items: [], hasMore: false }
      const result = await sessions.search(query, signal)
      if (result === undefined || result.ok !== true) return { items: [], hasMore: false }
      const items = Array.isArray(result.value?.items) ? result.value.items : []
      return {
        items: items
          .filter((entry) => entry !== null && typeof entry === 'object')
          .map((entry) => ({ sessionId: entry.sessionId, snippet: entry.snippet })),
        hasMore: result.value?.hasMore === true,
      }
    },
    addWorkspace: async () => {
      const picked = await uiWorkspace?.pickDirectory()
      if (picked === null || picked === undefined) return
      const created = await workspaces?.create({ path: picked })
      const id = created?.workspaceId
      if (id !== undefined) uiWorkspace?.startSession(id)
    },
    adoptDirectory: async (path) => {
      const created = await workspaces?.create({ path })
      const id = created?.workspaceId
      if (id !== undefined) uiWorkspace?.startSession(id)
    },
    listDirectory: async (path, signal) => {
      if (uiWorkspace === undefined) return undefined
      return await uiWorkspace.listDirectory(path, signal)
    },
    createDirectory: async (parent, name) => {
      if (uiWorkspace === undefined) throw new Error('directory service unavailable')
      return await uiWorkspace.createDirectory(parent, name)
    },
  }
  // One stable face for both registrations: an observable state handle plus the
  // baked actions (the renderer memoizes an entry's inject result for the
  // registration's lifetime, so both components read the same live store).
  const viewStore = {
    getSnapshot: store.state.getSnapshot,
    subscribe: store.state.subscribe,
    actions: store.actions,
  }
  const browserProps = () => ({ store: viewStore, ui })

  let disposeBrowser
  const enableBrowser = () => {
    if (disposeBrowser !== undefined) return
    disposeBrowser = slots.register({
      name: 'sidebar.workspaces',
      priority: -1,
      locale: NS,
      inject: browserProps,
    }, WorksopPlusBrowser)
  }
  const disableBrowser = () => {
    if (disposeBrowser === undefined) return
    disposeBrowser()
    disposeBrowser = undefined
  }
  const syncBrowser = () => {
    if (store.state.getSnapshot().prefs.enhanced !== false) enableBrowser()
    else disableBrowser()
  }
  // The shipped browser keeps its own registration on the ledger, so disposing
  // ours is a complete, instantaneous restore of the stock panel.
  ctx.effect(() => slots.inject('sidebar.workspaces', () => {
    syncBrowser()
    return () => { disableBrowser() }
  }), 'worksop-plus: browsing region')
  ctx.effect(() => store.state.subscribe(syncBrowser), 'worksop-plus: enhancement switch')

  ctx.effect(() => slots.inject('sidebar.footer.action', () => slots.register({
    name: 'sidebar.footer.action',
    id: 'worksop-plus',
    order: 60,
    locale: NS,
    inject: () => ({ store: viewStore }),
  }, FooterToggle)), 'worksop-plus: sidebar switch')
}