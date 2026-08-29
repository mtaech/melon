/**
 * model-select-plus — Client half (plain JS, no JSX/TS).
 *
 * Replaces the composer's default model affordance (`conversation.input.model`
 * single seat) at `priority: -1` (lower than the shipped occupant's `0`, and
 * the slot renders the lowest-priority entry).
 *
 * Look intent (quiet / tight / truthful):
 *   - quiet text-button trigger (no gray fill) that sits on the white composer;
 *     hover shows a subtle fill, chevron rotates
 *   - compact 336px panel, soft shadow, gentle entrance animation
 *   - FIRM typography: the panel sets `font-size: 12px; font-family: inherit`
 *     as its base so nothing inherits the app's larger base font; every control
 *     uses `font-family: inherit` + an explicit px size (never the `font`
 *     shorthand, which resets font-size to inherit). Name 12px, desc 11px,
 *     chips 10px.
 *   - no per-row provider tag (the provider is the group heading)
 *   - inline pill reasoning-effort chips (with 默认), tinted selected row,
 *     icon'd search with a clear button, pinned favorites, thin scrollbar
 *
 * Data comes from the Host half via `host.call('mdsl.catalog'|'mdsl.select')`.
 * The seat passes `locked` (owner prop) and we inject `sessionId`.
 *
 * @param ctx - the client Cordis context.
 */
export function apply(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) return
  const h = React.createElement

  // Favorites pinned across the plugin lifetime (in-memory, browser session).
  let favorites = new Set()
  const favKey = (g, m) => g + '/' + m

  // Crisp SVG star, centered precisely (unicode star was misaligned).
  const star = (filled) => h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: filled ? 'currentColor' : 'none', xmlns: 'http://www.w3.org/2000/svg' },
    h('path', { d: 'M12 2.6l2.86 5.8 6.4.94-4.63 4.5 1.1 6.37L12 17.02 6.27 20.2l1.1-6.37-4.63-4.5 6.4-.94L12 2.6z', stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round' }),
  )

  styles.insert(`
    .mdsl-root { position: relative; }
    .mdsl-backdrop { position: fixed; inset: 0; z-index: 35; }
    .mdsl-menu { font-size: 12px; font-family: inherit; }
    .mdsl-trigger { display: inline-flex; align-items: center; gap: 5px; padding: 4px 8px; border-radius: 8px; background: transparent; border: 1px solid transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font-family: inherit; font-size: 12px; transition: background .14s ease, border-color .14s ease, box-shadow .14s ease; }
    .mdsl-trigger:hover { background: var(--dsw-alias-interactive-bg-hover); }
    .mdsl-trigger:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }
    .mdsl-trigger:disabled { opacity: .5; cursor: default; }
    .mdsl-label { font-weight: 550; color: var(--dsw-alias-label-primary); white-space: nowrap; }
    .mdsl-effort { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
    .mdsl-sep { color: var(--dsw-alias-label-tertiary); opacity: .7; }
    .mdsl-chevron { transition: transform .16s ease; color: var(--dsw-alias-label-tertiary); font-size: 10px; }
    .mdsl-chevron-open { transform: rotate(180deg); }
    .mdsl-menu { position: absolute; right: 0; bottom: calc(100% + 8px); width: 336px; max-height: min(440px, 62vh); display: flex; flex-direction: column; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; box-shadow: 0 10px 36px rgba(0,0,0,.14); overflow: hidden; z-index: 40; animation: mdsl-in .15s ease-out; transform-origin: bottom right; }
    @keyframes mdsl-in { from { opacity: 0; transform: translateY(5px) scale(.985); } to { opacity: 1; transform: none; } }
    .mdsl-header { padding: 10px 12px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
    .mdsl-summary { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
    .mdsl-summary-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-brand-primary); flex: none; }
    .mdsl-summary-lbl { color: var(--dsw-alias-label-tertiary); }
    .mdsl-summary-b { font-weight: 600; color: var(--dsw-alias-label-primary); }
    .mdsl-search-wrap { position: relative; display: flex; align-items: center; }
    .mdsl-search-icon { position: absolute; left: 9px; color: var(--dsw-alias-label-tertiary); display: flex; pointer-events: none; }
    .mdsl-search { width: 100%; padding: 6px 28px; border-radius: 9px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 12px; outline: none; transition: border-color .16s ease, box-shadow .16s ease; }
    .mdsl-search::placeholder { color: var(--dsw-alias-label-tertiary); }
    .mdsl-search:focus { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 3px var(--dsw-alias-interactive-bg-active); }
    .mdsl-search-clear { position: absolute; right: 7px; border: none; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); border-radius: 50%; width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-family: inherit; font-size: 12px; line-height: 1; }
    .mdsl-search-clear:hover { background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-label-primary); }
    .mdsl-body { overflow-y: auto; padding: 5px; scrollbar-width: thin; scrollbar-color: var(--dsw-alias-scrollbar-bg-l1) transparent; }
    .mdsl-body::-webkit-scrollbar { width: 7px; }
    .mdsl-body::-webkit-scrollbar-thumb { background: var(--dsw-alias-scrollbar-bg-l1); border-radius: 8px; border: 2px solid transparent; background-clip: content-box; }
    .mdsl-body::-webkit-scrollbar-thumb:hover { background: var(--dsw-alias-scrollbar-hover-l1); }
    .mdsl-group { display: flex; flex-direction: column; gap: 3px; margin-bottom: 4px; }
    .mdsl-group-title { font-size: 10px; font-weight: 600; color: var(--dsw-alias-label-tertiary); letter-spacing: .06em; padding: 7px 8px 2px; text-transform: uppercase; }
    .mdsl-row { display: flex; align-items: flex-start; gap: 6px; padding: 6px 8px; border-radius: 10px; cursor: pointer; transition: background .12s ease; }
    .mdsl-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
    .mdsl-row-current, .mdsl-row-current:hover { background: var(--dsw-alias-interactive-bg-active); }
    .mdsl-star { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; margin-top: 0; background: none; border: none; padding: 0; cursor: pointer; color: var(--dsw-alias-label-tertiary); border-radius: 6px; transition: color .12s, background .12s; }
    .mdsl-star:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
    .mdsl-star-on { color: var(--dsw-alias-brand-primary); }
    .mdsl-row-main { flex: 1; min-width: 0; }
    .mdsl-row-head { display: flex; align-items: center; gap: 6px; min-width: 0; min-height: 18px; }
    .mdsl-row-name { font-size: 12px; font-weight: 550; line-height: 18px; color: var(--dsw-alias-label-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .mdsl-check { color: var(--dsw-alias-brand-primary); font-weight: 600; font-size: 11px; flex: none; }
    .mdsl-row-desc { font-size: 11px; line-height: 1.4; color: var(--dsw-alias-label-secondary); margin-top: 2px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .mdsl-row-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
    .mdsl-chip { font-family: inherit; font-size: 10px; line-height: 1.4; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); border-radius: 999px; padding: 1px 7px; cursor: pointer; transition: border-color .12s, color .12s, background .12s; }
    .mdsl-chip:hover { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); }
    .mdsl-chip-on { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-interactive-bg-active); }
    .mdsl-empty { font-size: 11px; color: var(--dsw-alias-label-tertiary); padding: 16px; text-align: center; }
    .mdsl-error { font-size: 11px; color: var(--dsw-alias-state-error-primary); padding: 9px 11px; }
    .mdsl-footer { padding: 8px 12px; border-top: 1px solid var(--dsw-alias-border-l1); font-size: 10.5px; color: var(--dsw-alias-label-tertiary); display: flex; align-items: center; gap: 6px; }
    .mdsl-footer-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--dsw-alias-label-tertiary); flex: none; }
  `)

  const searchIcon = () => h('span', { className: 'mdsl-search-icon' },
    h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg' },
      h('circle', { cx: 7, cy: 7, r: 5, stroke: 'currentColor', strokeWidth: 1.4 }),
      h('line', { x1: 10.8, y1: 10.8, x2: 14, y2: 14, stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
    ),
  )

  function ModelSelectLite(props) {
    const sessionId = props.sessionId
    const locked = props.locked === true
    const [open, setOpen] = React.useState(false)
    const [data, setData] = React.useState({ status: 'idle', groups: [], failures: [], current: null, error: null })
    const [query, setQuery] = React.useState('')
    const [busy, setBusy] = React.useState(false)
    const [, bump] = React.useState(0)

    const load = () => {
      setData((d) => ({ ...d, status: 'loading', error: null }))
      host.call('mdsl.catalog', { sessionId }).then((res) => {
        if (res === null || (res && res.error !== undefined)) {
          setData({ status: 'error', groups: [], failures: [], current: null, error: (res && res.error) || '加载失败' })
          return
        }
        setData({ status: 'ready', groups: res.groups || [], failures: res.failures || [], current: res.current || null, error: null })
      }).catch((err) => {
        setData({ status: 'error', groups: [], failures: [], current: null, error: String((err && err.message) || err) })
      })
    }

    const openMenu = () => { setOpen(true); load() }
    const closeMenu = () => { setOpen(false); setQuery('') }

    const selectSelection = (sel) => {
      if (busy) return
      setBusy(true)
      host.call('mdsl.select', {
        sessionId,
        provider: sel.provider,
        model: sel.model,
        ...(sel.reasoningEffort === undefined ? {} : { reasoningEffort: sel.reasoningEffort }),
      }).then((res) => {
        setBusy(false)
        if (res && res.ok === true) {
          setData((d) => ({ ...d, current: res.selected, error: null }))
          closeMenu()
        } else {
          setData((d) => ({ ...d, error: (res && res.message) || '选择失败' }))
        }
      }).catch((err) => {
        setBusy(false)
        setData((d) => ({ ...d, error: String((err && err.message) || err) }))
      })
    }

    const toggleFav = (g, m, ev) => {
      if (ev && ev.stopPropagation) ev.stopPropagation()
      const key = favKey(g, m)
      const next = new Set(favorites)
      if (next.has(key)) next.delete(key); else next.add(key)
      favorites = next
      bump((x) => x + 1)
    }

    const current = data.current
    const curGroup = current ? data.groups.find((g) => g.id === current.provider) : undefined
    const curModel = curGroup ? curGroup.models.find((mm) => mm.id === current.model) : undefined
    const modelName = (curModel && curModel.name) || (current ? current.model : '选择模型')
    const effEffort = current
      ? (current.reasoningEffort !== undefined ? current.reasoningEffort : (curModel && curModel.reasoning ? curModel.reasoning.defaultEffort : undefined))
      : undefined
    const effMatch = effEffort && curModel && curModel.reasoning ? curModel.reasoning.efforts.find((e) => e.id === effEffort) : undefined
    const effLabel = effMatch ? effMatch.name : (effEffort ? effEffort : (curModel && curModel.reasoning ? '默认' : undefined))

    const allChoices = []
    if (data.groups) {
      for (const g of data.groups) {
        for (const m of g.models) {
          allChoices.push({ g, m, selected: current !== null && current.provider === g.id && current.model === m.id })
        }
      }
    }

    const q = query.trim().toLowerCase()
    const filtered = q === '' ? allChoices : allChoices.filter((c) => (c.m.name + ' ' + (c.m.description || '') + ' ' + c.g.name).toLowerCase().includes(q))
    const favs = filtered.filter((c) => favorites.has(favKey(c.g.id, c.m.id)))
    const nonFavs = filtered.filter((c) => !favorites.has(favKey(c.g.id, c.m.id)))

    const renderRow = (c) => {
      const hasEfforts = c.m.reasoning && c.m.reasoning.efforts && c.m.reasoning.efforts.length
      const effEff = current !== null && current.provider === c.g.id && current.model === c.m.id ? effEffort : (hasEfforts ? c.m.reasoning.defaultEffort : undefined)
      const isFav = favorites.has(favKey(c.g.id, c.m.id))
      const chips = []
      if (hasEfforts) {
        chips.push(h('button', { key: 'default', className: 'mdsl-chip' + (effEff === undefined ? ' mdsl-chip-on' : ''), onClick: (ev) => { ev.stopPropagation(); selectSelection({ provider: c.g.id, model: c.m.id }) } }, '默认'))
        for (const e of c.m.reasoning.efforts) {
          chips.push(h('button', { key: e.id, className: 'mdsl-chip' + (effEff === e.id ? ' mdsl-chip-on' : ''), title: e.description || e.name, onClick: (ev) => { ev.stopPropagation(); selectSelection({ provider: c.g.id, model: c.m.id, reasoningEffort: e.id }) } }, e.name))
        }
      }
      return h('div', {
        key: favKey(c.g.id, c.m.id),
        className: 'mdsl-row' + (c.selected ? ' mdsl-row-current' : ''),
        onClick: () => selectSelection({ provider: c.g.id, model: c.m.id, ...(hasEfforts && c.m.reasoning.defaultEffort !== undefined ? { reasoningEffort: c.m.reasoning.defaultEffort } : {}) }),
      },
        h('button', { className: 'mdsl-star' + (isFav ? ' mdsl-star-on' : ''), 'aria-label': isFav ? '取消收藏' : '收藏', onClick: (ev) => toggleFav(c.g.id, c.m.id, ev) }, star(isFav)),
        h('div', { className: 'mdsl-row-main' },
          h('div', { className: 'mdsl-row-head' },
            h('span', { className: 'mdsl-row-name' }, c.m.name),
            c.selected ? h('span', { className: 'mdsl-check' }, '✓') : null,
          ),
          c.m.description ? h('div', { className: 'mdsl-row-desc' }, c.m.description) : null,
          chips.length ? h('div', { className: 'mdsl-row-chips' }, chips) : null,
        ),
      )
    }

    const renderGroup = (g) => {
      const items = nonFavs.filter((c) => c.g.id === g.id)
      if (items.length === 0) return null
      return h('div', { className: 'mdsl-group', key: g.id },
        h('div', { className: 'mdsl-group-title' }, g.name),
        items.map(renderRow),
      )
    }

    return h('div', { className: 'mdsl-root' },
      h('button', {
        className: 'mdsl-trigger',
        onClick: () => { if (open) closeMenu(); else openMenu() },
        disabled: locked,
        title: modelName + (effLabel ? ' · ' + effLabel : ''),
      },
        h('span', { className: 'mdsl-label' }, modelName),
        effLabel ? [h('span', { className: 'mdsl-sep' }, '·'), h('span', { className: 'mdsl-effort' }, effLabel)] : null,
        h('span', { className: 'mdsl-chevron' + (open ? ' mdsl-chevron-open' : '') }, '▾'),
      ),
      open ? h('div', { className: 'mdsl-backdrop', onClick: closeMenu }) : null,
      open ? h('div', { className: 'mdsl-menu' },
        h('div', { className: 'mdsl-header' },
          h('div', { className: 'mdsl-summary' },
            h('span', { className: 'mdsl-summary-dot' }),
            current
              ? [h('span', { className: 'mdsl-summary-lbl' }, '当前'), h('span', { className: 'mdsl-summary-b' }, modelName)]
              : h('span', { className: 'mdsl-summary-lbl' }, '选择模型'),
          ),
          h('div', { className: 'mdsl-search-wrap' },
            searchIcon(),
            h('input', { className: 'mdsl-search', placeholder: '搜索模型 / 描述 / 提供商…', value: query, onChange: (ev) => setQuery(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Escape') closeMenu() } }),
            query !== '' ? h('button', { className: 'mdsl-search-clear', onClick: () => setQuery('') }, '×') : null,
          ),
        ),
        data.status === 'error' ? h('div', { className: 'mdsl-error' }, data.error || '加载失败') : null,
        data.failures && data.failures.length ? h('div', { className: 'mdsl-error' }, data.failures.map((f) => f.name + ': ' + f.message).join('；')) : null,
        h('div', { className: 'mdsl-body' },
          data.status === 'loading' ? h('div', { className: 'mdsl-empty' }, '加载中…') : null,
          data.status === 'ready' && allChoices.length === 0 ? h('div', { className: 'mdsl-empty' }, '暂无可用模型') : null,
          favs.length ? h('div', { className: 'mdsl-group' },
            h('div', { className: 'mdsl-group-title' }, '收藏'),
            favs.map(renderRow),
          ) : null,
          (data.groups || []).map(renderGroup),
        ),
        h('div', { className: 'mdsl-footer' },
          h('span', { className: 'mdsl-footer-dot' }),
          h('span', null, '点击模型或推理等级即可切换 · 星标收藏会置顶'),
        ),
      ) : null,
    )
  }

  // Replace the shipped model seat occupant: lowest priority renders.
  slots.inject('conversation.input.model', () => slots.register(
    { name: 'conversation.input.model', priority: -1, inject: (sessionId) => ({ sessionId }) },
    ModelSelectLite,
  ))
}
