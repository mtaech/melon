/**
 * Material You skin — sidebar workspace info enrichment (client half).
 *
 * The native workspace row renders only the folder icon + label. This adds the
 * per-workspace facts the row omits: visible session count and how long ago the
 * workspace was last touched. Data comes from the host half's read-only
 * `/dsh-skin-material-you/api/workspaces` route, which reads the Host workspace
 * store; the DOM is decorated in place, so a missing route or unmatched label
 * simply means no annotation (never an error).
 *
 * Rows are React-rendered and re-render on their own schedule, so decoration
 * runs behind a debounced MutationObserver and is idempotent. This file is
 * inlined verbatim into the client bundle by build.mjs — it must stay plain JS
 * with no imports/exports.
 */

function enhanceSidebarWorkspaces() {
  if (
    typeof document === "undefined" ||
    typeof MutationObserver === "undefined" ||
    typeof fetch === "undefined" ||
    document.body === undefined
  ) {
    return () => {};
  }

  const META_ATTR = "data-dsh-skin-ws-meta";
  const ROW_SELECTOR = '[class*="treeBody"] [class*="projectRow"]';
  const META_SELECTOR = "[" + META_ATTR + "]";
  const API = "/dsh-skin-material-you/api/workspaces";
  const REFRESH_MS = 60_000;

  /** row label → workspace entry; rebuilt on every fetch. */
  let info = null;
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
   * sidebar and makes the right-hand column ragged, so Chinese uses bare units
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

  function clearMeta() {
    for (const el of document.querySelectorAll(META_SELECTOR)) el.remove();
  }

  function buildMeta(entry) {
    const meta = document.createElement("span");
    meta.setAttribute(META_ATTR, "1");
    meta.className = "dsh-skin-ws-meta";

    const count = document.createElement("span");
    count.className = "dsh-skin-ws-count";
    count.textContent = String(entry.sessions);
    count.title = String(entry.sessions);
    meta.appendChild(count);

    const time = relativeTime(entry.updatedAt);
    if (time !== "") {
      const timeEl = document.createElement("span");
      timeEl.className = "dsh-skin-ws-time";
      timeEl.textContent = time;
      meta.appendChild(timeEl);
    }
    return meta;
  }

  function decorate() {
    if (disposed || info === null) return;
    for (const row of document.querySelectorAll(ROW_SELECTOR)) {
      if (row.querySelector(META_SELECTOR)) continue;
      const titleEl = row.querySelector('[class*="title"]');
      if (titleEl === null) continue;
      const entry = info.get((titleEl.textContent || "").trim());
      if (entry === undefined) continue;
      const actions = row.querySelector('[class*="rowActions"]');
      const meta = buildMeta(entry);
      if (actions !== null && actions.parentElement === row) row.insertBefore(meta, actions);
      else row.appendChild(meta);
    }
  }

  function scheduleDecorate() {
    if (disposed || debounceTimer !== null) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      decorate();
    }, 150);
  }

  function load() {
    fetch(API, { headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (disposed || data === null || !Array.isArray(data.workspaces)) return;
        const map = new Map();
        for (const workspace of data.workspaces) {
          const keys = [basename(workspace.path)];
          if (typeof workspace.title === "string") keys.push(workspace.title.trim());
          for (const key of keys) {
            if (key !== "" && !map.has(key)) map.set(key, workspace);
          }
        }
        info = map;
        clearMeta();
        decorate();
      })
      .catch(() => {});
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
    clearMeta();
  };
}
