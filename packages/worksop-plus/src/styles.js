/**
 * dsh-worksop-plus — panel styles.
 *
 * The visual language is absorbed from the `dsh-skin-material-you` skin, whose
 * `sidebar.css` refined this very sidebar. That stylesheet targets the shipped
 * browser's DOM (`projectRow` / `sessionRow` / `groupSection`), so it no longer
 * reaches this region once the plugin takes the slot over — the recipes are
 * therefore re-stated here against this panel's own class names:
 *
 *   - an expanded workspace becomes a tonal card (brand 6% fill, brand 22%
 *     hairline, 16px radius); collapsed workspaces are flat rows separated by
 *     whitespace only — the skin's notes rule out dividers in a narrow column;
 *   - session rows indent under their workspace and hang a 2px guide line from
 *     the caret column, so ownership is visible without a nested box;
 *   - the selected session is a brand 10% tonal pill with a brand guide segment;
 *   - counts live in a 20×18 pill and time in a fixed 46px tabular column, so
 *     the right-hand rail never jitters as numbers change;
 *   - hover is a 5–6% neutral state layer, never a hard fill.
 *
 * Every M3 token is read through `var(--m3-*, fallback)` and every colour
 * through `--dsw-alias-*`, so the panel looks right with the skin installed and
 * still coherent without it (and in light *and* dark themes).
 */
export const CSS = `
/* ---- bulk selection ------------------------------------------------------- */

.wp-bulkbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 0 8px;
}
.wp-bulkbar-actions {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: none;
}
.wp-bulkbar-actions::-webkit-scrollbar { display: none; }
.wp-bulkcount, .wp-bulkdone { flex: none; }
.wp-bulkcount {
  flex: none;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-weight: 560;
  font-variant-numeric: tabular-nums;
}
.wp-chip:disabled { opacity: .45; cursor: default; }
.wp-chip:disabled:hover { background: transparent; color: var(--dsw-alias-label-secondary); }

.wp-status {
  flex: none;
  margin: 0 0 6px;
  padding: 6px 10px;
  border-radius: var(--wp-shape-m);
  background: var(--wp-brand-soft);
  color: var(--dsw-alias-brand-primary);
  font-size: 12px;
  line-height: 17px;
}

/* checkbox shown while the panel is in selection mode */
.wp-check {
  flex: none;
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1.4px solid var(--dsw-alias-border-l4);
  border-radius: var(--wp-shape-full);
  color: var(--dsw-alias-label-primary-inverted, #fff);
}
.wp-check-on {
  border-color: transparent;
  background: var(--dsw-alias-brand-primary);
}
.wp-ws-picked .wp-label { color: var(--dsw-alias-brand-primary); font-weight: 600; }

/* ---- drag & drop ---------------------------------------------------------- */

.wp-ws-dragging { opacity: .45; }
.wp-drop-on {
  background: var(--wp-brand-selected) !important;
  box-shadow: inset 0 0 0 1px var(--wp-brand-line);
}
.wp-sec-drop > .wp-sechead { background: var(--wp-brand-selected); border-radius: var(--wp-shape-s); }

/* ---- group emoji picker --------------------------------------------------- */

.wp-emojis { display: flex; flex-wrap: wrap; gap: 4px; margin: 10px 0 0; }
.wp-emoji {
  width: 26px;
  height: 26px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: var(--wp-shape-s);
  background: var(--wp-state);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.wp-emoji:hover { background: var(--wp-state-strong); }
.wp-emoji-on { border-color: var(--dsw-alias-brand-primary); background: var(--wp-brand-selected); }

/* ---- in-app directory browser --------------------------------------------- */

.wp-dialog-wide { width: min(420px, calc(100vw - 32px)); }
.wp-crumbs { margin: 0 0 8px; font-size: 11px; }
.wp-crumb {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 6px;
  border: none;
  border-radius: var(--wp-shape-s);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}
.wp-crumb:hover { background: var(--wp-state); color: var(--dsw-alias-label-primary); }
.wp-crumb-on { color: var(--dsw-alias-label-primary); font-weight: 560; }
.wp-crumb-sep { color: var(--dsw-alias-label-tertiary); }
.wp-dir-list {
  max-height: 260px;
  overflow-y: auto;
  margin: 0 0 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--wp-shape-m);
  padding: 4px;
}
.wp-dir-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 6px;
  border: none;
  border-radius: var(--wp-shape-s);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.wp-dir-row:hover { background: var(--wp-state-strong); }
.wp-dir-hidden { opacity: .55; }
.wp-dir-new { display: flex; gap: 6px; align-items: center; }
.wp-dir-new input {
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--dsw-alias-border-l4);
  border-radius: var(--wp-shape-full);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 13px;
  outline: none;
}
.wp-dir-new input:focus { border-color: var(--dsw-alias-brand-primary); }

/* ---- textarea dialogs (config import / export) ---------------------------- */

.wp-dialog textarea {
  box-sizing: border-box;
  width: 100%;
  height: 132px;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l4);
  border-radius: var(--wp-shape-m);
  background: var(--wp-state);
  color: var(--dsw-alias-label-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  line-height: 16px;
  resize: vertical;
  outline: none;
}
.wp-dialog textarea:focus { border-color: var(--dsw-alias-brand-primary); }
.wp-dialog-error { margin: 8px 0 0; color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 17px; }

.wp-root {
  --wp-shape-s: var(--m3-shape-small, 8px);
  --wp-shape-m: var(--m3-shape-medium, 12px);
  --wp-shape-l: var(--m3-shape-large, 16px);
  --wp-shape-xl: var(--m3-shape-extra-large, 28px);
  --wp-shape-full: var(--m3-shape-full, 999px);
  --wp-state: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent);
  --wp-state-strong: color-mix(in srgb, var(--dsw-alias-label-primary) 11%, transparent);
  --wp-brand-soft: color-mix(in srgb, var(--dsw-alias-brand-primary) 6%, transparent);
  --wp-brand-line: color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, transparent);
  --wp-brand-selected: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent);
  --wp-guide: var(--dsw-alias-border-l2);
  --wp-elev: var(--m3-elevation-2, 0 1px 2px rgba(0,0,0,.14), 0 2px 6px 2px rgba(0,0,0,.10));
  box-sizing: border-box;
  min-height: 0;
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  padding-right: var(--dsh-sidebar-inline-padding, 8px);
}

/* ---- header: caption label + three 28px icon buttons --------------------- */

.wp-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 36px;
  margin: 2px -4px 2px 0;
}
.wp-title {
  flex: none;
  max-width: 45%;
  overflow: hidden;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-weight: 560;
  letter-spacing: .06em;
  line-height: 16px;
}
.wp-head-actions { margin-left: auto; display: flex; align-items: center; gap: 2px; }
.wp-iconbtn {
  width: 28px;
  height: 28px;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: var(--wp-shape-full);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  transition: background-color .14s var(--ds-ease-in-out, ease), color .14s var(--ds-ease-in-out, ease);
}
.wp-iconbtn:hover { background: var(--wp-state); color: var(--dsw-alias-label-primary); }
.wp-iconbtn:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }
.wp-iconbtn-on { background: var(--wp-brand-selected); color: var(--dsw-alias-brand-primary); }

/* ---- search: collapsed to an icon, expands to a full-width M3 search bar -- */

.wp-searchbar {
  flex: none;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  margin: 0 0 6px;
  padding: 0 12px;
  box-sizing: border-box;
  border-radius: var(--wp-shape-full);
  background: var(--wp-state);
  color: var(--dsw-alias-label-tertiary);
  animation: wp-fade-in .14s var(--ds-ease-in-out, ease);
}
.wp-searchbar input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 13px;
  line-height: 18px;
}
.wp-searchbar input::placeholder { color: var(--dsw-alias-label-tertiary); }
.wp-search-clear {
  flex: none;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: var(--wp-shape-full);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.wp-search-clear:hover { background: var(--wp-state-strong); color: var(--dsw-alias-label-primary); }
@keyframes wp-fade-in { from { opacity: 0; transform: translateY(-2px) } to { opacity: 1; transform: none } }

/* ---- filter chips (M3): outlined when idle, tonal when active ------------- */

.wp-chips {
  flex: none;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  padding: 0 0 8px;
  scrollbar-width: none;
  mask-image: linear-gradient(to right, #000 calc(100% - 14px), transparent);
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 14px), transparent);
}
.wp-chips::-webkit-scrollbar { display: none; }
.wp-chip {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  max-width: 148px;
  padding: 0 8px;
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--wp-shape-s);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color .14s var(--ds-ease-in-out, ease), color .14s var(--ds-ease-in-out, ease), border-color .14s var(--ds-ease-in-out, ease);
}
.wp-chip:hover { background: var(--wp-state); color: var(--dsw-alias-label-primary); }
.wp-chip:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }
.wp-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-chip b { font-weight: 500; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.wp-chip-on {
  border-color: transparent;
  background: var(--wp-brand-selected);
  color: var(--dsw-alias-brand-primary);
  font-weight: 560;
}
.wp-chip-on b { color: var(--dsw-alias-brand-primary); opacity: .75; }
.wp-chip-icon { padding: 0 8px; }

/* ---- scroll area ---------------------------------------------------------- */

.wp-scroll {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  padding: 0 0 16px;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-scrollbar-bg-l1) transparent;
}
.wp-scroll::-webkit-scrollbar { width: 7px; }
.wp-scroll::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-scrollbar-bg-l1);
  border: 2px solid transparent;
  background-clip: content-box;
  border-radius: 8px;
}

/* ---- section header: caption title, count on the right -------------------- */

.wp-sec + .wp-sec { margin-top: 10px; }
.wp-sechead { display: flex; align-items: center; gap: 2px; height: 28px; padding-left: 2px; }
.wp-sechead-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 6px;
  border: none;
  border-radius: var(--wp-shape-s);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-size: 12px;
  font-weight: 560;
  letter-spacing: .06em;
  line-height: 16px;
  text-align: left;
  cursor: pointer;
  transition: background-color .14s var(--ds-ease-in-out, ease);
}
.wp-sechead-main:hover { background: var(--wp-state); }
.wp-sechead-main:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }
.wp-sectitle { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-secicon { flex: none; display: inline-flex; align-items: center; color: var(--dsw-alias-state-warn-primary); font-size: 11px; }
.wp-secright { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; }
.wp-seccount { color: var(--dsw-alias-label-tertiary); font-weight: 500; font-variant-numeric: tabular-nums; }
.wp-gdot { flex: none; width: 8px; height: 8px; border-radius: var(--wp-shape-full); }
.wp-gap { flex: 1; }
.wp-secbody { display: flex; flex-direction: column; gap: 2px; padding-bottom: 2px; }

/* A folded bucket seals into a FULL-WIDTH tonal row. Hugging the text made short
 * group names look like stray tags and broke the left/right alignment of the
 * column; full width keeps the container read (tint + hairline) and lines up
 * with every other row. The group's actions button rides the right edge instead
 * of consuming layout width. */
.wp-sec-collapsed { margin-top: 4px; }
.wp-sec-collapsed > .wp-sechead { position: relative; height: 30px; }
.wp-sec-collapsed .wp-sechead-main {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 32px 0 10px;
  border: 1px solid var(--wp-brand-line);
  border-radius: var(--wp-shape-m);
  background: var(--wp-brand-soft);
  color: var(--dsw-alias-label-secondary);
  letter-spacing: .02em;
}
.wp-sec-collapsed .wp-sechead-main:hover { background: var(--wp-brand-selected); }
.wp-sec-collapsed > .wp-sechead > .wp-rowbtn {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
}

/* ---- workspace rows: flat with whitespace, tonal card while expanded ------ */

.wp-wsblock { border-radius: var(--wp-shape-l); }
.wp-wsblock + .wp-wsblock { margin-top: 8px; }
.wp-wsblock-open {
  background: var(--wp-brand-soft);
  border: 1px solid var(--wp-brand-line);
  border-radius: var(--wp-shape-l);
  padding: 6px 6px 8px;
  margin: 8px 0 6px;
}
.wp-wsblock-open + .wp-wsblock { margin-top: 4px; }

.wp-ws {
  box-sizing: border-box;
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 38px;
  padding: 0 8px;
  border-radius: var(--wp-shape-m);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  user-select: none;
  transition: background-color .14s var(--ds-ease-in-out, ease);
}
.wp-wsblock-open > .wp-ws { height: 40px; }
.wp-ws:hover { background: var(--wp-state); }
.wp-ws:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }
.wp-caret {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  color: var(--dsw-alias-label-tertiary);
  transition: transform .16s var(--ds-ease-in-out, ease);
}
.wp-caret-open { transform: rotate(90deg); }
.wp-folder { flex: none; display: inline-flex; align-items: center; color: var(--dsw-alias-label-tertiary); }
.wp-folder-on { color: var(--dsw-alias-brand-primary); }
.wp-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 560;
  line-height: 20px;
}
.wp-ws .wp-label { color: var(--dsw-alias-label-primary); }
.wp-ws-current .wp-label { color: var(--dsw-alias-brand-primary); font-weight: 600; }

/* Meta rail: pin mark + count pill + fixed tabular time column. The row's
 * action buttons ride an absolutely positioned rail instead of occupying flow
 * width, so the label keeps the ~50px that hidden 24px buttons used to reserve. */
.wp-meta { flex: none; min-width: 0; display: inline-flex; align-items: center; gap: 6px; }
.wp-pinmark { flex: none; display: inline-flex; align-items: center; color: var(--dsw-alias-state-warn-primary); }
.wp-ws:hover .wp-meta { visibility: hidden; }
.wp-actions {
  position: absolute;
  right: 2px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  gap: 0;
  opacity: 0;
  pointer-events: none;
  transition: opacity .14s var(--ds-ease-in-out, ease);
}
.wp-ws:hover .wp-actions,
.wp-session:hover .wp-actions,
.wp-actions:focus-within { opacity: 1; pointer-events: auto; }
/* Inline session count: hugs the workspace name, no pill, no loud colour.
 * The row's own 6px gap is all the separation it needs. */
.wp-count-inline {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
}
/* The name no longer grows, so an explicit spacer owns the right rail. */
.wp-spacer { flex: 1; min-width: 8px; }
.wp-label-hug { flex: 0 1 auto; }
.wp-time {
  flex: 0 0 46px;
  text-align: right;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* row actions: state-layer icon buttons revealed on hover/focus */
.wp-rowbtn {
  flex: none;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: var(--wp-shape-full);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  transition: background-color .14s var(--ds-ease-in-out, ease);
}
/* The section-header button sits in the flow, so it owns its own reveal. */
.wp-sechead .wp-rowbtn { opacity: 0; }
.wp-sechead:hover .wp-rowbtn, .wp-sechead .wp-rowbtn:focus-visible { opacity: 1; }
.wp-rowbtn:hover { background: var(--wp-state-strong); color: var(--dsw-alias-label-primary); }
.wp-rowbtn:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }
.wp-star-on { color: var(--dsw-alias-state-warn-primary); }

/* ---- session rows: indented, hung from a guide line ----------------------- */

/* No inter-row gap: the 2px guide segments must butt together into one
 * continuous line, exactly as the skin's notes require. */
.wp-sessions { display: flex; flex-direction: column; gap: 0; position: relative; }
.wp-session {
  position: relative;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  margin-left: 28px;
  padding: 0 8px 0 6px;
  border-radius: var(--wp-shape-s);
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  user-select: none;
  transition: background-color .14s var(--ds-ease-in-out, ease), color .14s var(--ds-ease-in-out, ease);
}
.wp-session::before {
  content: "";
  position: absolute;
  left: -14px;
  top: 0;
  bottom: 0;
  width: 2px;
  border-radius: 1px;
  background: var(--wp-guide);
  transition: background-color .14s var(--ds-ease-in-out, ease);
}
.wp-session:hover { background: var(--wp-state); color: var(--dsw-alias-label-primary); }
.wp-session:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }
.wp-session .wp-label { font-size: 13px; font-weight: 400; line-height: 18px; }
.wp-session-on { background: var(--wp-brand-selected); }
.wp-session-on .wp-label { color: var(--dsw-alias-brand-primary); font-weight: 560; }
.wp-session-on::before { background: var(--dsw-alias-brand-primary); }
/* Status: the shipped StateDot carries the live states; these classes are the
 * inline fallback plus the cluster layout that folds several states into one
 * compact group on a row or section header. */
.wp-state { flex: none; }
.wp-cluster { flex: none; display: inline-flex; align-items: center; gap: 6px; }
.wp-cluster-item { display: inline-flex; align-items: center; gap: 2px; }
.wp-cluster-item b {
  font-size: 11px;
  font-weight: 560;
  line-height: 1;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}
.wp-fallback-dot { flex: none; width: 8px; height: 8px; border-radius: var(--wp-shape-full); background: var(--dsw-alias-label-dimmed); }
.wp-fallback-warning { background: var(--dsw-alias-state-warn-primary); }
.wp-fallback-ongoing { background: var(--dsw-alias-state-business-primary); animation: wp-pulse 1.4s ease-in-out infinite; }
.wp-fallback-done { background: var(--dsw-alias-state-success-primary); }
.wp-fallback-idle { background: var(--dsw-alias-label-dimmed); }
@keyframes wp-pulse { 0%, 100% { opacity: 1 } 50% { opacity: .3 } }

/* ---- drag insertion indicator + content-search rows ----------------------- */

.wp-insert-line-session { margin-left: 42px; }
.wp-scheduled { flex: none; display: inline-flex; align-items: center; color: var(--dsw-alias-label-tertiary); }
.wp-more {
  height: 26px;
  margin: 2px 8px 2px 34px;
  padding: 0 8px;
  border: none;
  border-radius: var(--wp-shape-s);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-family: inherit;
  font-size: 11px;
  text-align: left;
  cursor: pointer;
}
.wp-more:hover { background: var(--wp-state); color: var(--dsw-alias-label-secondary); }


.wp-insert-line {
  height: 2px;
  margin: 0 8px 0 28px;
  border-radius: 1px;
  background: var(--dsw-alias-brand-primary);
}
.wp-insert-line-after { margin-top: 0; }
.wp-drop-target { background: var(--wp-state); }

.wp-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.wp-session-content {
  height: auto;
  min-height: 42px;
  align-items: flex-start;
  padding-top: 6px;
  padding-bottom: 6px;
}
.wp-session-content .wp-dot, .wp-session-content .wp-state { margin-top: 6px; }
.wp-snippet {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 15px;
}
.wp-rowspace {
  flex: none;
  max-width: 42%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 15px;
}
.wp-subagents {
  flex: none;
  padding: 0 4px;
  border-radius: var(--wp-shape-full);
  background: var(--wp-state);
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  line-height: 15px;
  font-variant-numeric: tabular-nums;
}

/* ---- hints, errors, hidden-bucket affordance ------------------------------ */

.wp-hint { padding: 10px 12px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 17px; }
.wp-error {
  margin: 0 0 6px;
  padding: 8px 10px;
  border-radius: var(--wp-shape-m);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 17px;
}
.wp-hidden-hint { margin: 10px 8px 0; }

/* ---- menus: elevated surface, 34px state-layer items ---------------------- */

.wp-backdrop { position: fixed; inset: 0; z-index: 60; }
.wp-menu {
  position: fixed;
  z-index: 61;
  box-sizing: border-box;
  min-width: 188px;
  max-height: 62vh;
  overflow-y: auto;
  padding: 6px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--wp-shape-l);
  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1));
  box-shadow: var(--wp-elev);
  animation: wp-fade-in .12s var(--ds-ease-in-out, ease);
}
.wp-menu-label {
  padding: 6px 10px 4px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  font-weight: 560;
  letter-spacing: .06em;
}
.wp-menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 10px;
  box-sizing: border-box;
  border: none;
  border-radius: var(--wp-shape-s);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 13px;
  line-height: 18px;
  text-align: left;
  cursor: pointer;
  transition: background-color .12s var(--ds-ease-in-out, ease);
}
.wp-menu-item:hover { background: var(--wp-state-strong); }
.wp-menu-item:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }
.wp-menu-danger { color: var(--dsw-alias-state-error-primary); }
.wp-menu-sep { height: 1px; margin: 5px 8px; background: var(--dsw-alias-border-l1); }
.wp-menu-check { flex: none; width: 12px; color: var(--dsw-alias-brand-primary); }

/* Right-aligned count inside a shipped-Menu item label. */
.wp-menu-label-row { display: flex; align-items: center; gap: 10px; width: 100%; }
.wp-menu-label-row small { margin-left: auto; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }

/* ---- dialogs: 28px radius card, pill field, pill actions ------------------ */

.wp-dialog {
  position: fixed;
  z-index: 62;
  left: 50%;
  top: 50%;
  width: min(320px, calc(100vw - 32px));
  transform: translate(-50%, -50%);
  box-sizing: border-box;
  padding: 20px 20px 16px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--wp-shape-xl);
  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1));
  box-shadow: var(--wp-elev);
  animation: wp-dialog-in .16s var(--ds-ease-in-out, ease);
}
@keyframes wp-dialog-in { from { opacity: 0; transform: translate(-50%, -48%) scale(.98) } to { opacity: 1; transform: translate(-50%, -50%) scale(1) } }
.wp-dialog h4 { margin: 0 0 6px; color: var(--dsw-alias-label-primary); font-size: 16px; font-weight: 500; line-height: 24px; }
.wp-dialog p { margin: 0 0 12px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 19px; }
.wp-dialog input {
  box-sizing: border-box;
  width: 100%;
  height: 40px;
  padding: 0 16px;
  border: 1px solid transparent;
  border-radius: var(--wp-shape-full);
  background: var(--wp-state);
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 14px;
  outline: none;
  transition: border-color .14s var(--ds-ease-in-out, ease), background-color .14s var(--ds-ease-in-out, ease);
}
.wp-dialog input::placeholder { color: var(--dsw-alias-label-tertiary); }
.wp-dialog input:focus { border-color: var(--dsw-alias-brand-primary); background: transparent; }
.wp-colors { display: flex; gap: 8px; margin: 14px 2px 2px; }
.wp-color {
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--wp-shape-full);
  cursor: pointer;
  transition: transform .12s var(--ds-ease-in-out, ease), box-shadow .12s var(--ds-ease-in-out, ease);
}
.wp-color:hover { transform: scale(1.12); }
.wp-color:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }
.wp-color-on { box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }
.wp-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
.wp-btn {
  height: 34px;
  padding: 0 16px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--wp-shape-full);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color .14s var(--ds-ease-in-out, ease);
}
.wp-btn:hover { background: var(--wp-state); }
.wp-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary); }
.wp-btn:disabled { opacity: .5; cursor: default; }
.wp-btn-primary {
  border-color: transparent;
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-label-primary-inverted, #fff);
}
.wp-btn-primary:hover { filter: brightness(1.06); }
.wp-btn-danger {
  border-color: transparent;
  background: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-label-primary-inverted, #fff);
}
.wp-btn-danger:hover { filter: brightness(1.06); }

/* ---- collapsed rail + sidebar-foot switch --------------------------------- */

.wp-rail { align-items: center; padding-right: 0; }
.wp-rail-list { flex: 1; min-height: 0; width: 100%; display: flex; flex-direction: column; align-items: center; gap: 4px; overflow-y: auto; padding-top: 4px; scrollbar-width: none; }
.wp-rail-list::-webkit-scrollbar { display: none; }
.wp-railbadge { position: absolute; right: -1px; top: -1px; display: inline-flex; }
.wp-rail .wp-railbtn {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: var(--wp-shape-full);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  transition: background-color .14s var(--ds-ease-in-out, ease);
}
.wp-rail .wp-railbtn:hover { background: var(--wp-state); }
.wp-rail .wp-railletter {
  position: relative;
  width: 32px;
  height: 32px;
  margin-top: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--wp-shape-m);
  background: var(--wp-state);
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-size: 12px;
  font-weight: 560;
  cursor: pointer;
  transition: background-color .14s var(--ds-ease-in-out, ease), color .14s var(--ds-ease-in-out, ease);
}
.wp-rail .wp-railletter:hover { background: var(--wp-brand-selected); color: var(--dsw-alias-brand-primary); }
.wp-footbtn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: none;
  border-radius: var(--wp-shape-full);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color .14s var(--ds-ease-in-out, ease), color .14s var(--ds-ease-in-out, ease);
}
.wp-footbtn:hover { background: var(--wp-state); color: var(--dsw-alias-label-primary); }
.wp-footbtn-on { color: var(--dsw-alias-brand-primary); }
.wp-footbtn-on:hover { background: var(--wp-brand-selected); }

@media (prefers-reduced-motion: reduce) {
  .wp-caret, .wp-fallback-ongoing, .wp-menu, .wp-dialog, .wp-searchbar { animation: none; transition: none; }
}
`