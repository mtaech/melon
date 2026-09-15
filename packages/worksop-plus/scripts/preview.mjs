/**
 * Offline visual preview of the panel.
 *
 * Renders the REAL built client bundle — same component, same injected CSS —
 * into a static HTML page, so a styling change can be eyeballed without a live
 * DSH host, a session, or the web GUI's auth token.
 *
 * How it works: the bundle is a `window.__ModuleLoader__.load({ id, factory })`
 * registration. We evaluate it with a fake `window`/`document`/`localStorage`,
 * materialize the factory with a stub `react` whose hooks are inert and whose
 * `createElement` builds a plain tree, run `apply(fakeCtx)` to capture the
 * component the plugin registers for `sidebar.workspaces` (plus the dictionaries
 * it registers with `ctx.locale`, so the copy is the real copy), then serialize
 * the component's output to HTML.
 *
 * Usage: `node scripts/preview.mjs [out.html]` — prints the written path.
 * The page is a dev aid only; it is not shipped (`files` excludes `scripts/`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const out = path.resolve(process.argv[2] ?? path.join(root, 'lib', 'preview.html'))

/* ------------------------------------------------------------------ react stub */

const ICON_SOURCE_PATH = '/home/huang/Personal/Dev/Code/deepseek-harness/packages/client/ui-primitives/src/icons/index.tsx'
let iconSourceText
function iconSource() {
  if (iconSourceText === undefined) {
    try { iconSourceText = readFileSync(ICON_SOURCE_PATH, 'utf8') } catch { iconSourceText = '' }
  }
  return iconSourceText
}

/** One shipped icon's JSX <svg> → equivalent HTML, so the preview shows the REAL glyphs. */
function iconSvg(name, size) {
  const source = iconSource()
  if (source === '') return undefined
  const block = new RegExp(`export const ${name}\\b[\\s\\S]*?(<svg[\\s\\S]*?<\\/svg>)`).exec(source)
  if (block === null) return undefined
  return block[1]
    .replace(/\s*className=\{className\}/g, '')
    .replace(/\{size\}/g, String(size))
    .replace(/\s([a-zA-Z]+)=\{([^}]*)\}/g, (all, attr, expr) => {
      const kebab = attr.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
      const trimmed = expr.trim()
      if (trimmed === 'size') return ` ${kebab}="${size}"`
      if (/^-?[\d.]+$/.test(trimmed)) return ` ${kebab}="${trimmed}"`
      return ''
    })
}

const ICON_SEED = '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Stand-in for the shipped primitives module: the panel imports its icon
 * components, so the preview materializes the same names into the same SVG
 * markup the shell ships.
 */
const STATE_COLORS = {
  done: '#1f8a4c',
  warning: '#b26a00',
  ongoing: '#015ac2',
  error: '#ba1a1a',
  idle: '#c7c6ca',
}

/** Faithful-enough stand-in for the shipped Menu (list surface + entry vocabulary). */
function menuStub(props = {}) {
  const items = Array.isArray(props.items) ? props.items : []
  const selected = typeof props.selectedId === 'string' ? props.selectedId : undefined
  // NOTE: children live inside `props` — the serializer reads props.children.
  return {
    type: 'div',
    props: {
      className: 'wp-menu wp-menu-stub',
      role: 'menu',
      children: items.map((entry) => {
        if (entry.type === 'separator') return { type: 'div', props: { className: 'wp-menu-sep' } }
        if (entry.type === 'label') return { type: 'div', props: { className: 'wp-menu-label', children: entry.text } }
        return {
          type: 'div',
          props: {
            className: entry.danger === true ? 'wp-menu-item wp-menu-danger' : 'wp-menu-item',
            children: [
              entry.id === selected ? { type: 'span', props: { className: 'wp-menu-check', children: '✓' } } : null,
              entry.label,
            ].filter((node) => node !== null),
          },
        }
      }),
    },
  }
}

/** Faithful-enough stand-in for the shipped StateDot. */
function stateDotStub(props = {}) {
  const size = typeof props.size === 'number' ? props.size : 10
  const state = typeof props.state === 'string' ? props.state : 'idle'
  return {
    type: 'span',
    props: {
      'data-state': state,
      style: {
        display: 'inline-block',
        width: size,
        height: size,
        flex: 'none',
        borderRadius: '999px',
        background: STATE_COLORS[state] ?? STATE_COLORS.idle,
      },
    },
  }
}

const primitivesStub = new Proxy({}, {
  get: (_, prop) => {
    const name = String(prop)
    if (name === 'StateDot') return stateDotStub
    if (name === 'Menu') return menuStub
    if (name === 'writeClipboard') return async () => {}
    return (props = {}) => {
      const size = typeof props.size === 'number' ? props.size : 16
      const svg = iconSvg(name, size)
      if (svg !== undefined) {
        return { type: 'span', props: { style: { display: 'inline-flex' }, dangerouslySetInnerHTML: { __html: svg } } }
      }
      return { type: 'span', props: { style: { display: 'inline-block', width: size, height: size, background: 'currentColor', opacity: 0.25, borderRadius: '2px' } } }
    }
  },
})

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function styleString(style) {
  return Object.entries(style)
    .filter(([, value]) => value !== null && value !== undefined && value !== false)
    .map(([key, value]) => {
      const name = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
      const text = typeof value === 'number' && !/^(opacity|zIndex|flex|flexGrow|flexShrink|lineHeight|fontWeight)$/.test(key)
        ? `${value}px`
        : String(value)
      return `${name}:${text}`
    })
    .join(';')
}

const FRAGMENT = Symbol.for('react.fragment')
/**
 * Expansion lives in component-local state, which a static renderer cannot
 * click. `seedExpanded` lets a column start with cards already open — the one
 * empty-array `useState` in the component is the expansion list, so this is
 * unambiguous.
 */
let seedExpanded = null
let seedStates = {}
let stateCursor = 0
const react = {
  Fragment: FRAGMENT,
  createElement(type, props, ...children) {
    return {
      type,
      props: {
        ...(props ?? {}),
        children: children.length === 0 ? undefined : (children.length === 1 ? children[0] : children),
      },
    }
  },
  useState: (initial) => {
    const value = typeof initial === 'function' ? initial() : initial
    const index = stateCursor
    stateCursor += 1
    if (Object.prototype.hasOwnProperty.call(seedStates, index)) return [seedStates[index], () => {}]
    // Only the expansion list (its fixed hook index) takes the openIds shortcut;
    // other empty-array states must stay empty.
    if (index === 3 && Array.isArray(value) && value.length === 0 && seedExpanded !== null) return [seedExpanded, () => {}]
    return [value, () => {}]
  },
  useRef: (initial) => ({ current: initial === undefined ? null : initial }),
  useMemo: (factory) => factory(),
  useEffect: () => {},
  useCallback: (fn) => fn,
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
}

function render(node) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string') return escapeHtml(node)
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(render).join('')
  const { type, props } = node
  if (typeof type === 'function') {
    // Each component's hook order starts at zero, so an index seed addresses the
    // panel's own state; nested components never inherit its indices.
    const saved = stateCursor
    stateCursor = 0
    const out = render(type(props))
    stateCursor = saved
    return out
  }
  if (type === FRAGMENT || type === 'Fragment') return render(props.children)
  const attrs = []
  let raw
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' || typeof value === 'function' || value === null || value === undefined || value === false) continue
    if (key === 'dangerouslySetInnerHTML') { raw = String(value.__html ?? ''); continue }
    if (key === 'style') { attrs.push(`style="${escapeHtml(styleString(value))}"`); continue }
    if (key === 'className') { attrs.push(`class="${escapeHtml(value)}"`); continue }
    if (key === 'ref' || typeof value === 'object') continue
    attrs.push(`${key}="${escapeHtml(value)}"`)
  }
  const body = raw === undefined ? render(props.children) : raw
  const head = attrs.length === 0 ? type : `${type} ${attrs.join(' ')}`
  return `<${head}>${body}</${type}>`
}

/* --------------------------------------------------------------- bundle loading */

const bundlePath = path.join(root, 'lib', 'client.cjs')
if (!existsSync(bundlePath)) throw new Error('lib/client.cjs missing — run `pnpm run build` first')
const source = readFileSync(bundlePath, 'utf8')

let registration
const styleTags = new Map()
globalThis.window = { __ModuleLoader__: { load: (value) => { registration = value } } }
globalThis.document = {
  getElementById: (id) => styleTags.get(id) ?? null,
  createElement: () => ({ id: '', textContent: '', remove() { styleTags.delete(this.id) } }),
  head: { appendChild(node) { styleTags.set(node.id, node) } },
}
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
// eslint-disable-next-line no-eval
;(0, eval)(source)

const bundle = registration.factory((specifier) => {
  if (specifier === 'react') return react
  if (specifier === ICON_SEED) return primitivesStub
  throw new Error(`unexpected require("${specifier}")`)
})

const dictionaries = {}
let panel
const noop = () => {}
const scope = {
  getSnapshot: () => ({ status: 'ready', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'host' }),
  subscribe: () => noop,
  set: async () => {},
  unset: async () => {},
}
const ctx = {
  effect: (callback) => { const disposer = callback(); return typeof disposer === 'function' ? disposer : noop },
  get: (key) => ({
    slots: {
      inject: (slotKey, callback) => { const disposer = callback(); return typeof disposer === 'function' ? disposer : noop },
      register: (options, component) => {
        if (options.name === 'sidebar.workspaces') panel = component
        return noop
      },
    },
    locale: {
      register: (namespace, dicts) => { dictionaries[namespace] = dicts; return noop },
      bind: (namespace) => (key, params) => interpolate(dictionaries[namespace]?.zh?.[key] ?? key, params),
    },
    workspaces: {}, uiWorkspace: {}, sessions: {},
  }[key]),
  inject: (deps, callback) => { callback({ settingsScope: { bind: () => scope } }) },
}
bundle.apply(ctx)
if (panel === undefined) throw new Error('the bundle registered no sidebar.workspaces component')

function interpolate(text, params) {
  if (params === undefined) return text
  return text.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''))
}
const t = ctx.get('locale').bind('worksopPlus')

/* -------------------------------------------------------------------- fixtures */

const DAY = 86_400_000
const MIN = 60_000
const now = Date.now()
const workspace = (id, title, sessionIds, age) => ({
  workspaceId: id,
  path: `/home/huang/Personal/Dev/Code/${title}`,
  title,
  sessionIds,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: now - age,
})
const summary = (id, title, patch = {}) => ({
  id, displayTitle: title, title, blank: false, running: false, updatedAt: now - 6 * MIN, ...patch,
})

const workspaces = [
  workspace('w-melon', 'melon', ['s-idea', 's-sub-idea'], 8 * MIN),
  workspace('w-octopus', 'octopus', ['s-octo1', 's-octo2'], 39 * MIN),
  workspace('w-qiz1', 'qiz-pg-hla-cq', ['s-q1', 's-q2', 's-q3', 's-q4', 's-q5', 's-q6'], 3 * DAY),
  workspace('w-lumix', 'lumix-tool', ['s-l1'], 4 * DAY),
  workspace('w-cheku', 'cheku', ['s-c1'], 6 * DAY),
  workspace('w-desktop', 'dsh-desktop', ['s-d1', 's-d2', 's-d3', 's-d4', 's-d5', 's-d6', 's-d7'], 4 * DAY),
  workspace('w-njpl', 'NJPL', ['s-n1', 's-n2', 's-n3', 's-n4'], 6 * DAY),
  workspace('w-upgrade', 'code-upgrade-tool', ['s-u1'], 12 * DAY),
  workspace('w-qiz2', 'qiz-pg-gcic-ui', ['s-g1'], 20 * MIN),
  workspace('w-text', '文本修改', ['s-t1', 's-t2'], 14 * DAY),
  workspace('w-grid', '国网华中华中分部-电网电压系统', ['s-w1', 's-w2', 's-w3', 's-w4'], DAY),
  workspace('w-brid', 'brid_data', ['s-b1'], 14 * DAY),
  workspace('w-photo', 'photo_tool', ['s-p1', 's-p2', 's-p3'], 5 * DAY),
  workspace('w-shangrao', '上饶需求', ['s-s1'], 15 * DAY),
]

const SESSION_TITLES = {
  's-idea': '构思 dsh 工作区管理插件',
  's-octo1': '修一下导出路径',
  's-octo2': '补充单元测试',
  's-d1': '桌面端登录态丢失',
  's-d2': '打包脚本整理',
  's-q1': '迁移到新的任务图',
  's-n1': '电网电压模型校对',
  's-g1': '对齐设计稿间距',
  's-t1': '文档术语统一',
}
const sessions = {}
let serial = 0
for (const item of workspaces) {
  for (const sessionId of item.sessionIds) {
    serial += 1
    sessions[sessionId] = summary(sessionId, SESSION_TITLES[sessionId] ?? `会话记录 ${serial}`, {
      running: sessionId === 's-octo1',
      completed: sessionId === 's-d1',
      updatedAt: now - serial * 11 * MIN,
      // One session carries a live schedule projection: the panel shows its
      // clock affordance off exactly this leaf.
      ...(sessionId === 's-octo2' ? { projectionValues: { schedule: [{ id: 'job-1' }] } } : {}),
    })
  }
}
sessions['s-idea'] = summary('s-idea', SESSION_TITLES['s-idea'], { updatedAt: now - 3 * MIN })
// A running subagent descendant: advertised as a badge on its parent row.
sessions['s-sub-idea'] = summary('s-sub-idea', '子代理：扫描仓库结构', { parentId: 's-idea', origin: 'subagent', running: true })
const sessionList = { ids: Object.keys(sessions), byId: sessions, current: 's-idea' }
/** Pending interactions by session, shaped like the standard prop resolves them. */
const pendingBySession = new Map([
  ['s-octo1', { key: 'p-1', kind: 'approval', sessionId: 's-octo1' }],
  ['s-n1', { key: 'p-2', kind: 'question', sessionId: 's-n1' }],
])

const base = {
  wide: true,
  expandSidebar: noop,
  useWorkspaces: (selector) => selector({ items: workspaces, archivedSessionIds: [], phase: 'ready', state: 'idle', error: null }),
  useSessions: (selector) => selector(sessionList),
  useSessionPendingInteraction: (selector) => selector(pendingBySession),
  ui: {
    startSession: noop, open: noop, archive: async () => {},
    rename: async () => {}, remove: async () => {}, addWorkspace: async () => {},
    searchSessions: async () => ({ items: [], hasMore: false }),
  },
}

/** Render one panel column from the given durable state, with the listed cards open. */
function panelHtml(state, openIds = [], seeds = {}) {
  const store = {
    getSnapshot: () => state,
    subscribe: () => noop,
    actions: {},
  }
  seedExpanded = openIds.length === 0 ? null : openIds
  seedStates = seeds
  stateCursor = 0
  try {
    return render(panel({ ...base, store, t }))
  } finally {
    seedExpanded = null
    seedStates = {}
  }
}

const pinnedOnly = {
  pinned: ['w-qiz1', 'w-octopus', 'w-melon'],
  groups: [],
  assign: {},
  hidden: [],
  order: {},
  prefs: { enhanced: true, pinCollapsed: false, showHidden: false, sort: 'host' },
}
const grouped = {
  pinned: ['w-octopus'],
  groups: [
    { id: 'g1', name: '工作', emoji: '', color: 'blue', collapsed: false },
    { id: 'g2', name: '个人', emoji: '', color: 'green', collapsed: true },
  ],
  assign: { 'w-qiz1': 'g1', 'w-desktop': 'g1', 'w-njpl': 'g1', 'w-lumix': 'g2', 'w-photo': 'g2' },
  hidden: ['w-cheku'],
  order: {},
  prefs: { enhanced: true, pinCollapsed: false, showHidden: false, sort: 'host' },
}

const manyGroups = {
  pinned: ['w-melon'],
  groups: [
    { id: 'g1', name: '工作', emoji: '💼', color: 'blue', collapsed: false },
    { id: 'g2', name: '个人', emoji: '🏠', color: 'green', collapsed: true },
    { id: 'g3', name: '实验', emoji: '🧪', color: 'teal', collapsed: true },
    { id: 'g4', name: '客户', emoji: '📦', color: 'orange', collapsed: true },
    { id: 'g5', name: '归档', emoji: '🗂️', color: 'gray', collapsed: true },
    { id: 'g6', name: '学习', emoji: '📚', color: 'purple', collapsed: true },
  ],
  assign: {
    'w-qiz1': 'g1', 'w-desktop': 'g1', 'w-njpl': 'g1',
    'w-lumix': 'g2', 'w-photo': 'g2',
    'w-octopus': 'g3',
    'w-qiz2': 'g4', 'w-text': 'g4',
    'w-cheku': 'g5', 'w-brid': 'g5',
    'w-shangrao': 'g6', 'w-grid': 'g6',
  },
  hidden: [],
  order: {},
  prefs: { enhanced: true, pinCollapsed: false, showHidden: false, sort: 'host' },
}

/** One directory level, shaped like the host's DirectoryListing. */
const dirListing = {
  path: '/home/huang/Personal/Dev/Code/melon',
  home: '/home/huang',
  crumbs: [
    { name: 'huang', path: '/home/huang', hidden: false },
    { name: 'Personal', path: '/home/huang/Personal', hidden: false },
    { name: 'Dev', path: '/home/huang/Personal/Dev', hidden: false },
    { name: 'Code', path: '/home/huang/Personal/Dev/Code', hidden: false },
    { name: 'melon', path: '/home/huang/Personal/Dev/Code/melon', hidden: false },
  ],
  entries: [
    { name: 'deepseek-harness', path: '/home/huang/Personal/Dev/Code/deepseek-harness', hidden: false },
    { name: 'dsh-plugins', path: '/home/huang/Personal/Dev/Code/dsh-plugins', hidden: false },
    { name: 'melon', path: '/home/huang/Personal/Dev/Code/melon', hidden: false },
    { name: '.cache', path: '/home/huang/Personal/Dev/Code/.cache', hidden: true },
  ],
  truncated: false,
}

/** A representative open menu: labels, a checked row with a count, a danger row. */
const menuFixture = {
  rect: { left: 60, top: 200 },
  items: [
    { label: '置顶', run: () => {} },
    { label: '新建会话', run: () => {} },
    { sep: true },
    { label: '移入分组', label2: true },
    { label: '　💼工作', check: true, suffix: '3', run: () => {} },
    { label: '　🏠个人', suffix: '2', run: () => {} },
    { label: '　+ 新建分组', run: () => {} },
    { sep: true },
    { label: '删除工作区', danger: true, run: () => {} },
  ],
}

/** What the host content search returns for the G column. */
const contentPage = {
  items: [{ sessionId: 's-octo2', snippet: '…导出路径那段命中的内容…' }],
  hasMore: true,
}

/** The same view as A, switched to the flat listing. */
const flatState = {
  ...pinnedOnly,
  prefs: { ...pinnedOnly.prefs, groupBy: 'flat' },
}

const foldedUngrouped = {
  ...pinnedOnly,
  prefs: { ...pinnedOnly.prefs, ungroupedCollapsed: true },
}

const css = styleTags.get('dsh-worksop-plus/style')?.textContent ?? ''
if (css === '') throw new Error('the bundle injected no style tag')

const html = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>dsh-worksop-plus preview</title>
<style>
/* DSH light-theme stand-ins: the preview has no host, so the alias tokens the
   panel styles read are provided here with plausible light values. */
:root {
  --dsw-alias-label-primary: #1b1b1f;
  --dsw-alias-label-secondary: #53535c;
  --dsw-alias-label-tertiary: #8b8b95;
  --dsw-alias-label-dimmed: #c7c6ca;
  --dsw-alias-label-primary-inverted: #ffffff;
  --dsw-alias-bg-base: #faf8fd;
  --dsw-alias-bg-layer-1: #ffffff;
  --dsw-alias-bg-overlay: #ffffff;
  --dsw-alias-border-l1: rgba(0,0,0,.08);
  --dsw-alias-border-l2: rgba(0,0,0,.13);
  --dsw-alias-border-l4: rgba(0,0,0,.18);
  --dsw-alias-interactive-bg-hover: rgba(0,0,0,.05);
  --dsw-alias-interactive-bg-active: rgba(0,0,0,.08);
  --dsw-alias-brand-primary: #015ac2;
  --dsw-alias-state-error-primary: #ba1a1a;
  --dsw-alias-state-success-primary: #1f8a4c;
  --dsw-alias-state-business-primary: #015ac2;
  --dsw-alias-state-warn-primary: #b26a00;
  --dsw-alias-scrollbar-bg-l1: rgba(0,0,0,.22);
  --dsw-specific-sidebar-fill: #f4f2f7;
  --dsh-sidebar-inline-padding: 8px;
  --m3-shape-extra-small: 4px; --m3-shape-small: 8px; --m3-shape-medium: 12px;
  --m3-shape-large: 16px; --m3-shape-extra-large: 28px; --m3-shape-full: 999px;
  --m3-elevation-2: 0 1px 2px rgba(0,0,0,.14), 0 2px 6px 2px rgba(0,0,0,.10);
}
body { margin: 0; padding: 18px; display: flex; gap: 18px; align-items: flex-start;
  background: var(--dsw-specific-sidebar-fill);
  font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
.column { position: relative; width: 292px; height: 940px; display: flex; box-sizing: border-box;
  background: var(--dsw-specific-sidebar-fill); }
/* Confine the panel's fixed-position overlays to their own preview column. */
.column .wp-backdrop { position: absolute; inset: 0; }
.column .wp-dialog { position: absolute; left: 50%; top: 96px; transform: translateX(-50%); }
.column .wp-menu { position: absolute; }
.caption { position: absolute; margin-top: -14px; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
${css}
</style></head>
<body>
<div><div class="caption">A · 置顶 + 未分组（两个工作区展开）</div><div class="column">${panelHtml(pinnedOnly, ['w-melon', 'w-octopus'])}</div></div>
<div><div class="caption">B · 分组态 + 拖拽高亮（把 melon 拖到「工作」）</div><div class="column">${panelHtml(grouped, ['w-desktop'], { 10: { kind: 'workspace', id: 'w-melon' }, 11: 'sec:g1' })}</div></div>
<div><div class="caption">C · 多选整理（已选 2 + 状态提示）</div><div class="column">${panelHtml(pinnedOnly, [], { 8: true, 9: ['w-melon', 'w-octopus'], 12: '已复制到剪贴板' })}</div></div>
<div><div class="caption">D · 分组编辑（颜色 + emoji）</div><div class="column">${panelHtml(grouped, [], { 5: { kind: 'rename-group', id: 'g1', value: '工作' } })}</div></div>
<div><div class="caption">E · 六个分组：chip 行只有 4 个（分组名收进 ▾）</div><div class="column">${panelHtml(manyGroups, [])}</div></div>
<div><div class="caption">F · 「未分组」折叠后也是 chip</div><div class="column">${panelHtml(foldedUngrouped, [])}</div></div>
<div><div class="caption">G · 宿主内容匹配（只有正文命中时）</div><div class="column">${panelHtml(pinnedOnly, ['w-octopus'], { 0: '命中', 1: true, 13: contentPage })}</div></div>
<div><div class="caption">H · 拖拽插入线 + 子代理角标</div><div class="column">${panelHtml(pinnedOnly, ['w-melon'], { 11: 'ws:w-octopus:after' })}</div></div>
<div><div class="caption">I · 产品 Menu（条目转换：计数/勾选/危险项）</div><div class="column">${panelHtml(pinnedOnly, [], { 4: menuFixture })}</div></div>
<div><div class="caption">J · 扁平列表视图</div><div class="column">${panelHtml(flatState, [])}</div></div>
<div><div class="caption">K · 应用内目录浏览器</div><div class="column">${panelHtml(pinnedOnly, [], { 15: { path: dirListing.path, listing: dirListing, loading: false, error: null } })}</div></div>
</body></html>
`

mkdirSync(path.dirname(out), { recursive: true })
writeFileSync(out, html)
console.log(`preview written: ${out}`)