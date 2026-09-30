/**
 * Material You skin — sidebar workspace info enrichment (client half).
 *
 * The native workspace row renders only the folder icon + label. This adds the
 * per-workspace facts the row omits: the visible session count as a "(n)" suffix
 * riding the workspace title, and how long ago the workspace was last touched on
 * the row's trailing edge (where session rows carry their own timestamp).
 *
 * The count answers "how many Session rows does expanding this Workspace show",
 * so it must apply the same predicate the tree does (ui-workspace `tree.ts`
 * `sessionVisible()`): drop the registry-global archives, drop subagent-origin
 * rows, and drop blank Sessions — a blank one is only visible while it is the
 * current selection, which has no stable meaning on a collapsed workspace row.
 * Counting raw `sessionIds` instead reports the all-time history (dozens per
 * row, differing from the store's own "visible" filtering), and subtracting
 * only the archive set still over-counts subagent and blank rows. The session
 * list is therefore the authority for the count; `sessionIds` only says which
 * Workspace accounts for an id.
 *
 * Three data sources, tried in this order:
 *
 *   1. the Client Workspace service (`ctx.get("workspaces")`) joined with the
 *      Client Session service (`ctx.get("sessions")`), whose snapshots together
 *      carry `sessionIds`, the archive set, and each summary's `blank`/`origin`.
 *      Subscribing to both means an archive or a new Session refreshes the
 *      counts the moment the Host confirms it — no polling, no staleness. Each
 *      service is looked up again until it appears, and this file must keep
 *      working without either.
 *   2. the host half's read-only `/dsh-skin-material-you/api/workspaces` route,
 *      polled: the fallback while a service is absent (foreign surface, older
 *      Host) or has not published its first snapshot yet. The route sees the
 *      persisted store only, so it cannot know `blank`/`origin` and its count is
 *      the archive-filtered approximation.
 *   3. no source at all: the row simply shows no annotation.
 *
 * Either way the DOM is decorated in place: a missing service, route, or
 * unmatched label means "no annotation", never an error, and a row that no
 * longer matches a Workspace loses its annotation. Rows are React-rendered and
 * re-render on their own schedule, so decoration runs behind a debounced
 * MutationObserver and is idempotent — it updates the injected nodes in place
 * rather than rebuilding them, which also keeps the observer from re-firing on
 * its own writes. This file is inlined verbatim into the client bundle by
 * build.mjs — it must stay plain JS with no imports/exports.
 */

function enhanceSidebarWorkspaces(ctx) {
  if (
    typeof document === "undefined" ||
    typeof MutationObserver === "undefined" ||
    document.body === undefined
  ) {
    return () => {};
  }

  const COUNT_ATTR = "data-dsh-skin-ws-count";
  const TIME_ATTR = "data-dsh-skin-ws-time";
  const ROW_SELECTOR = '[class*="treeBody"] [class*="projectRow"]';
  const TITLE_SELECTOR = '[class*="title"]';
  const ACTIONS_SELECTOR = '[class*="rowActions"]';
  const COUNT_SELECTOR = "[" + COUNT_ATTR + "]";
  const TIME_SELECTOR = "[" + TIME_ATTR + "]";
  const API = "/dsh-skin-material-you/api/workspaces";
  const REFRESH_MS = 60_000;

  /** row label → workspace entry; rebuilt whenever a source publishes rows. */
  let info = null;
  /** Live Client Workspace list once the service is up; null while it is absent. */
  let list = null;
  /** Live Client Session list; null while absent. Its summaries decide visibility. */
  let sessionList = null;
  let unsubscribe = null;
  let unsubscribeSessions = null;
  let disposed = false;
  let debounceTimer = null;
  let refreshTimer = null;

  function locale() {
    const lang = document.documentElement && document.documentElement.lang;
    if (typeof lang === "string" && lang !== "") return lang;
    return typeof navigator !== "undefined" && typeof navigator.language === "string" ? navigator.language : "en";
  }

  /**
   * Compact relative time. Intl's zh-CN output ("2 小时前") is too wide for this
   * sidebar and makes the trailing column ragged, so Chinese uses bare units
   * ("2小时") and other locales use Latin abbreviations ("2h ago").
   */
  const COMPACT_UNITS = {
    zh: { now: "刚刚", suffix: "", minute: "分", hour: "小时", day: "天", month: "月", year: "年" },
    latin: { now: "now", suffix: " ago", minute: "m", hour: "h", day: "d", month: "mo", year: "y" },
  };

  function relativeTime(iso) {
    if (typeof iso !== "string") return "";
    const deltaMs = Date.now() - Date.parse(iso);
    if (!Number.isFinite(deltaMs)) return "";
    const table = locale().toLowerCase().startsWith("zh") ? COMPACT_UNITS.zh : COMPACT_UNITS.latin;
    const minutes = deltaMs / 60_000;
    if (Math.abs(minutes) < 1) return table.now;
    const hours = minutes / 60;
    const days = hours / 24;
    const months = days / 30;
    const years = months / 12;
    let value;
    let unit;
    if (Math.abs(minutes) < 60) {
      value = minutes;
      unit = "minute";
    } else if (Math.abs(hours) < 24) {
      value = hours;
      unit = "hour";
    } else if (Math.abs(days) < 30) {
      value = days;
      unit = "day";
    } else if (Math.abs(months) < 12) {
      value = months;
      unit = "month";
    } else {
      value = years;
      unit = "year";
    }
    return Math.max(1, Math.round(value)) + table[unit] + table.suffix;
  }

  /**
   * Tooltip copy for the count: "3 个会话" / "3 sessions". It names the visible
   * rows deliberately — the number excludes archived, subagent, and blank
   * Sessions, so "N sessions" alone would read as an all-time total.
   */
  function countLabel(sessions) {
    if (locale().toLowerCase().startsWith("zh")) return sessions + " 个会话（不含归档）";
    return sessions + (sessions === 1 ? " session" : " sessions") + " (archived excluded)";
  }

  /**
   * The sidebar label is the basename of the workspace path (DSH's
   * workspaceLabel), NOT the workspace title — a renamed Workspace still shows
   * its directory name. Match on the basename, and keep the title as a fallback
   * key for stores where the two coincide.
   */
  function basename(path) {
    if (typeof path !== "string" || path === "") return "";
    const parts = path.split(/[\\/]+/).filter((part) => part !== "");
    return parts.length > 0 ? parts[parts.length - 1] : "";
  }

  /**
   * Resolve the live Client Workspace list, subscribing on first success.
   * Re-probing until it exists is what makes a late-registered service (a boot
   * race) upgrade this enrichment from polling to push without a reload.
   * @returns the list, or null while the service is unavailable.
   */
  function liveList() {
    if (list !== null) return list;
    try {
      const service = typeof ctx?.get === "function" ? ctx.get("workspaces") : null;
      const candidate = service?.list ?? null;
      if (
        candidate === null ||
        typeof candidate.getSnapshot !== "function" ||
        typeof candidate.subscribe !== "function"
      ) {
        return null;
      }
      unsubscribe = candidate.subscribe(load);
      list = candidate;
    } catch {
      list = null;
      unsubscribe = null;
    }
    return list;
  }

  /**
   * Resolve the live Client Session list, subscribing on first success.
   * Its summaries are the only place `blank`/`origin` exist client-side, so the
   * count stays the archive-filtered approximation until this resolves.
   * @returns the session list, or null while the service is unavailable.
   */
  function liveSessions() {
    if (sessionList !== null) return sessionList;
    try {
      const service = typeof ctx?.get === "function" ? ctx.get("sessions") : null;
      const candidate = service?.list ?? null;
      if (
        candidate === null ||
        typeof candidate.getSnapshot !== "function" ||
        typeof candidate.subscribe !== "function"
      ) {
        return null;
      }
      unsubscribeSessions = candidate.subscribe(load);
      sessionList = candidate;
    } catch {
      sessionList = null;
      unsubscribeSessions = null;
    }
    return sessionList;
  }

  /**
   * The session rows one Workspace actually renders, counting the same way the
   * tree does (ui-workspace `tree.ts` `sessionVisible()`): subagent-origin rows
   * are never shown, blank rows only while they are the current selection (and a
   * collapsed workspace row has no current selection to speak of), and archived
   * rows are hidden while the default filter is on. The filter itself is
   * unreachable from here, so the count is the default-filter answer.
   * @param sessionIds - the Workspace's accounted ids, in manual order.
   * @returns how many of them produce a visible row.
   */
  function visibleCount(sessionIds) {
    let rows;
    try {
      rows = sessionList.getSnapshot();
    } catch {
      return null;
    }
    if (rows === null || typeof rows !== "object") return null;
    if (rows.phase !== undefined && rows.phase !== "ready") return null;
    if (rows.byId === null || typeof rows.byId !== "object") return null;
    let sessions;
    try {
      sessions = list.getSnapshot();
    } catch {
      return null;
    }
    const archived = new Set(
      sessions !== null && Array.isArray(sessions.archivedSessionIds) ? sessions.archivedSessionIds : [],
    );
    let count = 0;
    for (const sessionId of sessionIds) {
      const summary = rows.byId[sessionId];
      // An id the list has not resolved is still a real accounted Session; keep
      // it unless the archive set hides it, so a warm-up list never undercounts.
      if (summary === undefined) {
        if (!archived.has(sessionId)) count += 1;
        continue;
      }
      if (summary.origin === "subagent") continue;
      if (summary.blank === true) continue;
      if (archived.has(sessionId)) continue;
      count += 1;
    }
    return count;
  }

  /**
   * Rows from the live snapshot, shaped exactly like the host route's rows.
   * @returns rows, or null while the store has no usable baseline yet — the
   * caller then falls back to the route instead of blanking the annotations.
   */
  function snapshotRows() {
    if (list === null) return null;
    let snapshot;
    try {
      snapshot = list.getSnapshot();
    } catch {
      return null;
    }
    if (snapshot === null || typeof snapshot !== "object") return null;
    if (snapshot.phase !== undefined && snapshot.phase !== "ready") return null;
    if (snapshot.state === "error") return null;
    if (!Array.isArray(snapshot.items)) return null;
    const archived = new Set(Array.isArray(snapshot.archivedSessionIds) ? snapshot.archivedSessionIds : []);
    const hasSessions = sessionList !== null;
    return snapshot.items.map((workspace) => {
      const sessionIds = Array.isArray(workspace?.sessionIds) ? workspace.sessionIds : [];
      const counted = hasSessions ? visibleCount(sessionIds) : null;
      return {
        title: typeof workspace?.title === "string" ? workspace.title : "",
        path: typeof workspace?.path === "string" ? workspace.path : "",
        // Without the session list this falls back to the archive-filtered
        // count: honest about archives, blind to subagent and blank rows.
        sessions: counted !== null
          ? counted
          : sessionIds.filter((sessionId) => !archived.has(sessionId)).length,
        updatedAt: typeof workspace?.updatedAt === "string" ? workspace.updatedAt : null,
      };
    });
  }

  function applyRows(rows) {
    const map = new Map();
    for (const workspace of rows) {
      const keys = [basename(workspace.path)];
      if (typeof workspace.title === "string") keys.push(workspace.title.trim());
      for (const key of keys) {
        if (key !== "" && !map.has(key)) map.set(key, workspace);
      }
    }
    info = map;
    decorate();
  }

  function load() {
    if (disposed) return;
    // Probe the session list first so a late registration upgrades the count,
    // but never let its absence gate the Workspace snapshot: the live rows are
    // useful on their own (the session list only refines the count).
    liveSessions();
    if (liveList() !== null) {
      const rows = snapshotRows();
      if (rows !== null) {
        applyRows(rows);
        return;
      }
    }
    if (typeof fetch !== "function") return;
    fetch(API, { headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (disposed || data === null || !Array.isArray(data.workspaces)) return;
        // A live snapshot that landed while this request was in flight is newer.
        if (list !== null && snapshotRows() !== null) return;
        applyRows(data.workspaces);
      })
      .catch(() => {});
  }

  /** Create the "(n)" node that trails the title. */
  function createCount() {
    const count = document.createElement("span");
    count.setAttribute(COUNT_ATTR, "1");
    count.className = "dsh-skin-ws-count";
    return count;
  }

  function updateCount(count, sessions) {
    const text = "(" + sessions + ")";
    if (count.textContent !== text) count.textContent = text;
    const label = countLabel(sessions);
    if (count.getAttribute("title") !== label) count.setAttribute("title", label);
  }

  /**
   * Upsert the trailing activity time.
   * @returns the node in the DOM, or null when the entry has no usable time.
   */
  function updateTime(row, time) {
    let elapsed = row.querySelector(TIME_SELECTOR);
    if (time === "") {
      if (elapsed !== null) elapsed.remove();
      return null;
    }
    if (elapsed === null) {
      elapsed = document.createElement("span");
      elapsed.setAttribute(TIME_ATTR, "1");
      elapsed.className = "dsh-skin-ws-time";
      const actions = row.querySelector(ACTIONS_SELECTOR);
      if (actions !== null && actions.parentElement === row) row.insertBefore(elapsed, actions);
      else row.appendChild(elapsed);
    }
    if (elapsed.textContent !== time) elapsed.textContent = time;
    return elapsed;
  }

  function decorate() {
    if (disposed || info === null) return;
    const counts = new Set();
    const times = new Set();
    for (const row of document.querySelectorAll(ROW_SELECTOR)) {
      const titleEl = row.querySelector(TITLE_SELECTOR);
      if (titleEl === null) continue;
      // The count is a sibling of the title, so this label stays clean.
      const entry = info.get((titleEl.textContent || "").trim());
      if (entry === undefined) continue;

      let count = row.querySelector(COUNT_SELECTOR);
      if (count === null) {
        count = createCount();
        titleEl.insertAdjacentElement("afterend", count);
      }
      updateCount(count, entry.sessions);
      counts.add(count);

      const elapsed = updateTime(row, relativeTime(entry.updatedAt));
      if (elapsed !== null) times.add(elapsed);
    }
    // A row that stopped matching a Workspace (deleted, relabeled) keeps no annotation.
    for (const node of document.querySelectorAll(COUNT_SELECTOR)) if (!counts.has(node)) node.remove();
    for (const node of document.querySelectorAll(TIME_SELECTOR)) if (!times.has(node)) node.remove();
  }

  function scheduleDecorate() {
    if (disposed || debounceTimer !== null) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      // A service that registered late takes over here, without waiting a tick.
      const lateList = list === null && liveList() !== null;
      const lateSessions = sessionList === null && liveSessions() !== null;
      if (lateList || lateSessions) {
        load();
        return;
      }
      decorate();
    }, 150);
  }

  const observer = new MutationObserver(scheduleDecorate);
  observer.observe(document.body, { childList: true, subtree: true });
  load();
  refreshTimer = setInterval(load, REFRESH_MS);

  return () => {
    disposed = true;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    if (refreshTimer !== null) clearInterval(refreshTimer);
    observer.disconnect();
    if (unsubscribe !== null) unsubscribe();
    if (unsubscribeSessions !== null) unsubscribeSessions();
    unsubscribe = null;
    unsubscribeSessions = null;
    list = null;
    sessionList = null;
    info = null;
    for (const node of document.querySelectorAll(COUNT_SELECTOR)) node.remove();
    for (const node of document.querySelectorAll(TIME_SELECTOR)) node.remove();
  };
}
