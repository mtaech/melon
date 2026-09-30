/**
 * In-page half of the sidebar enrichment DOM check (dev-only).
 *
 * Loaded by scripts/dom-check.mjs inside a generated, self-contained page: the
 * real skin bundle has already registered `window.__skin`, and
 * `window.__HARNESS__` carries the real DSH workspace-browser class names plus
 * the texts to render. This script builds a sidebar that mirrors what
 * ui-workspace renders, drives `apply()` against one data source at a time, and
 * prints PASS/FAIL lines for both the DOM shape and the refresh behaviour.
 *
 * It is never shipped: scripts/ is not in the package's `files` list.
 */

/* eslint-disable no-console */

const H = window.__HARNESS__;
const results = [];

function check(label, ok, detail = "") {
  results.push({ label, ok: Boolean(ok), detail: ok ? "" : String(detail) });
}

function cls(local) {
  return H.classes[local] || local;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** One project row, exactly the shape ProjectRowItem renders. */
function projectRow(label, { actions = true, active = false } = {}) {
  const row = el("div", cls("projectRow"));
  row.setAttribute("role", "treeitem");
  row.appendChild(el("span", cls("slot") + " " + cls("folder") + (active ? " " + cls("folderActive") : ""), "▣"));
  row.appendChild(el("span", cls("slot") + " " + cls("chevron"), "▸"));
  const text = el("span", cls("projectText"));
  text.appendChild(el("span", cls("title"), label));
  row.appendChild(text);
  const rowActions = el("span", cls("rowActions"));
  if (actions) {
    rowActions.appendChild(el("button", cls("iconButton"), "⋯"));
    rowActions.appendChild(el("button", cls("iconButton"), "＋"));
  }
  row.appendChild(rowActions);
  return row;
}

function sessionRow(label, time) {
  const row = el("div", cls("sessionRow"));
  row.appendChild(el("span", cls("slot")));
  row.appendChild(el("span", cls("title"), label));
  row.appendChild(el("span", cls("time"), time));
  row.appendChild(el("span", cls("rowActions")));
  return row;
}

function groupSection(rows) {
  const section = el("div", cls("groupSection"));
  for (const row of rows) section.appendChild(row);
  return section;
}

function buildSidebar() {
  const mount = document.getElementById("sidebar");
  mount.textContent = "";
  const tree = el("div", cls("treeBody") + " " + cls("wide"));
  tree.appendChild(el("div", cls("sectionHeader"), "工作区"));
  // Expanded workspace: annotations must survive inside the tonal card.
  tree.appendChild(groupSection([
    projectRow("melon", { active: true }),
    sessionRow("会话数量改成 (x)", "2h"),
    sessionRow("存档后立即刷新", "5min"),
    sessionRow("引导线对齐", "1d"),
  ]));
  // Collapsed workspace with a title long enough to clip.
  tree.appendChild(groupSection([
    projectRow("这个工作区名字很长很长很长很长很长很长很长很长很长"),
  ]));
  // Collapsed workspace with no sessions at all.
  tree.appendChild(groupSection([
    projectRow("empty-workspace"),
  ]));
  // The ungrouped bucket has no backing Workspace: no annotation.
  tree.appendChild(groupSection([
    projectRow("未分组"),
  ]));
  mount.appendChild(tree);
  return tree;
}

/** Apply the shipped bundle with a fake client ctx and return its disposers. */
function mountSkin(ctx) {
  const skin = window.__skin;
  if (!skin) throw new Error("skin bundle was not loaded");
  const disposers = [];
  const full = Object.assign({
    theme: {
      overrideTokens: () => () => {},
      register: (definition) => {
        // Mimic ThemePresenter: apply the first registered scheme's tokens.
        if (!full.__painted) {
          full.__painted = true;
          const tokens = definition.tokens || {};
          for (const name of Object.keys(tokens)) document.body.style.setProperty(name, tokens[name]);
        }
        return () => {};
      },
    },
    effect: (fn) => {
      const dispose = fn();
      if (typeof dispose === "function") disposers.push(dispose);
    },
  }, ctx);
  skin.factory(() => { throw new Error("harness: unexpected require"); }).apply(full);
  return () => { for (const dispose of disposers.reverse()) dispose(); };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function countsOf(row) {
  return row.querySelectorAll("[data-dsh-skin-ws-count]");
}

function timeOf(row) {
  return row.querySelector("[data-dsh-skin-ws-time]");
}

function titleOf(row) {
  return row.querySelector('[class*="title"]');
}

function rowByLabel(tree, label) {
  for (const row of tree.querySelectorAll('[class*="projectRow"]')) {
    if ((titleOf(row) || {}).textContent === label) return row;
  }
  return null;
}

function rect(node) {
  const box = node.getBoundingClientRect();
  return { left: box.left, right: box.right, width: box.width, height: box.height };
}

/** Client-side Workspace store double: getSnapshot + subscribe + a push helper. */
function fakeWorkspaceService(snapshot) {
  const listeners = new Set();
  return {
    snapshot,
    list: {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    notify() {
      for (const listener of [...listeners]) listener();
    },
    listenerCount: () => listeners.size,
  };
}

function workspace(id, path, title, sessionIds, minutesAgo) {
  return {
    workspaceId: id,
    path,
    title,
    sessionIds,
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    updatedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  };
}

/**
 * Client-side Session list double. Only `byId` and `phase` matter to the count:
 * `blank` and `origin` are exactly what the visible-row predicate reads.
 * @param rows - id → { blank, origin } facts; other summary fields are noise here.
 */
function fakeSessionService(rows) {
  const listeners = new Set();
  const snapshot = {
    ids: Object.keys(rows),
    byId: Object.fromEntries(Object.entries(rows).map(([id, facts]) => [id, { sessionId: id, ...facts }])),
    phase: "ready",
  };
  return {
    snapshot,
    list: {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    notify() {
      for (const listener of [...listeners]) listener();
    },
    listenerCount: () => listeners.size,
  };
}

/** Session facts for ids that should each count as one visible row. */
function visibleFacts(ids) {
  return Object.fromEntries(ids.map((id) => [id, { blank: false, origin: "user" }]));
}

/** The fake ctx a phase mounts: whichever services that phase pretends exist. */
function contextFor(services) {
  return {
    get: (name) => {
      const service = services[name];
      return service === null || service === undefined ? undefined : { list: service.list };
    },
  };
}

function baseSnapshot() {
  return {
    items: [
      workspace("w1", "/repo/melon", "melon", ["s1", "s2", "s3"], 120),
      workspace("w2", "/repo/这个工作区名字很长很长很长很长很长很长很长很长很长", "长名字", ["s4"], 5),
      workspace("w3", "/repo/empty-workspace", "empty-workspace", [], 1),
    ],
    archivedSessionIds: [],
    pinnedSessionIds: [],
    state: "idle",
    phase: "ready",
    error: null,
  };
}

const LONG_LABEL = "这个工作区名字很长很长很长很长很长很长很长很长很长";
const UNGROUPED_LABEL = "未分组";

/* ---- Phase 1: live service, push refresh on archive ---------------------- */

async function phaseLiveService() {
  const service = fakeWorkspaceService(baseSnapshot());
  const sessions = fakeSessionService(visibleFacts(["s1", "s2", "s3", "s4"]));
  let fetches = 0;
  window.fetch = () => {
    fetches += 1;
    return Promise.reject(new Error("harness: the route must not be polled when the service is live"));
  };
  const tree = buildSidebar();
  const dispose = mountSkin(contextFor({ workspaces: service, sessions }));
  await sleep(120);

  const melonRow = rowByLabel(tree, "melon");
  const longRow = rowByLabel(tree, LONG_LABEL);
  const emptyRow = rowByLabel(tree, "empty-workspace");
  const ungroupedRow = rowByLabel(tree, UNGROUPED_LABEL);
  check("all four project rows rendered", tree.querySelectorAll('[class*="projectRow"]').length === 4);
  check("service list was subscribed", service.listenerCount() === 1);
  check("session list was subscribed", sessions.listenerCount() === 1);
  check("no route fetch while the live service answers", fetches === 0, `fetches=${fetches}`);

  const melonCount = melonRow === null ? null : countsOf(melonRow)[0];
  check("melon count is (3)", melonCount?.textContent === "(3)", melonCount?.textContent);
  check("count sits directly after the title, inside projectText",
    melonCount !== null && melonCount.previousElementSibling === titleOf(melonRow)
    && /projectText/.test(melonCount.parentElement.className),
    melonCount === null ? "no count node" : melonCount.parentElement.className);
  check("count is not the row's trailing flex item",
    melonCount !== null && melonCount.nextElementSibling === null,
    melonCount === null ? "no count node" : String(melonCount.nextElementSibling?.className));
  check("count is not right-aligned (left of the row's midline)",
    melonCount !== null && rect(melonCount).left < rect(melonRow).left + rect(melonRow).width / 2,
    melonCount === null ? "no count node" : `${rect(melonCount).left} vs ${rect(melonRow).left + rect(melonRow).width / 2}`);
  check("count tooltip names the visible-row meaning",
    melonCount?.getAttribute("title") === "3 个会话（不含归档）", melonCount?.getAttribute("title"));
  check("empty workspace still annotates (0)", countsOf(emptyRow)[0]?.textContent === "(0)", countsOf(emptyRow)[0]?.textContent);
  check("an unbacked bucket gets no annotation", countsOf(ungroupedRow).length === 0);

  const time = timeOf(melonRow);
  check("activity time stays on the trailing edge, before the actions",
    time !== null && time.nextElementSibling === melonRow.querySelector('[class*="rowActions"]'),
    time === null ? "no time node" : String(time.nextElementSibling?.className));
  check("activity time is right-aligned inside the row",
    time !== null && getComputedStyle(time).textAlign === "right"
    && rect(time).left > rect(melonRow).left + rect(melonRow).width / 2,
    time === null ? "no time node" : getComputedStyle(time).textAlign);
  check("long title clips with an ellipsis and keeps the count visible",
    titleOf(longRow).scrollWidth > titleOf(longRow).clientWidth && rect(countsOf(longRow)[0]).width > 0,
    `scroll=${titleOf(longRow).scrollWidth} client=${titleOf(longRow).clientWidth}`);

  // Idempotency: a store push must update text in place, never duplicate nodes.
  const before = countsOf(melonRow)[0];
  service.notify();
  await sleep(60);
  check("a store push reuses the same count node", countsOf(melonRow)[0] === before);
  check("a store push adds no duplicate annotation", countsOf(melonRow).length === 1 && countsOf(tree.querySelector('[class*="projectRow"]')[1] ?? longRow).length === 1);

  // The point of the whole request: archiving refreshes the count immediately.
  service.snapshot.items[0].sessionIds = ["s1", "s2"];
  service.snapshot.archivedSessionIds = ["s3"];
  service.notify();
  await sleep(60);
  check("archiving a session drops the count to (2) on the push alone", countsOf(melonRow)[0]?.textContent === "(2)", countsOf(melonRow)[0]?.textContent);
  check("the archive push needed no route fetch", fetches === 0, `fetches=${fetches}`);

  // The count must mirror the tree's own predicate: subagent-origin and blank
  // Sessions render no row, so they must not inflate the workspace's number.
  sessions.snapshot.byId.s4.origin = "subagent";
  sessions.notify();
  await sleep(60);
  check("a subagent-origin session leaves the count", countsOf(longRow)[0]?.textContent === "(0)", countsOf(longRow)[0]?.textContent);

  sessions.snapshot.byId.s4.origin = "user";
  sessions.snapshot.byId.s4.blank = true;
  sessions.notify();
  await sleep(60);
  check("a blank (never prompted) session leaves the count", countsOf(longRow)[0]?.textContent === "(0)", countsOf(longRow)[0]?.textContent);

  sessions.snapshot.byId.s4.blank = false;
  sessions.notify();
  await sleep(60);
  check("unblanking the session restores the count", countsOf(longRow)[0]?.textContent === "(1)", countsOf(longRow)[0]?.textContent);

  // An id the session list has not resolved yet is still a real Session: the
  // archive-filtered answer stands in rather than undercounting to zero.
  service.snapshot.items[0].sessionIds = ["s1", "s2", "not-yet-listed"];
  service.notify();
  await sleep(60);
  check("an id absent from the session list still counts (never undercounts)",
    countsOf(melonRow)[0]?.textContent === "(3)", countsOf(melonRow)[0]?.textContent);

  service.snapshot.items[0].sessionIds = ["s1", "s2"];
  service.notify();
  await sleep(60);
  check("archived ids stay excluded once the list resolves", countsOf(melonRow)[0]?.textContent === "(2)", countsOf(melonRow)[0]?.textContent);

  // A Workspace removed from the store loses its stale annotation.
  service.snapshot.items = service.snapshot.items.slice(1);
  service.notify();
  await sleep(60);
  check("a removed Workspace loses its annotation", countsOf(melonRow).length === 0 && timeOf(melonRow) === null);

  dispose();
  check("dispose removes every injected node",
    document.querySelectorAll("[data-dsh-skin-ws-count]").length === 0
    && document.querySelectorAll("[data-dsh-skin-ws-time]").length === 0);
  check("dispose unsubscribes from the store", service.listenerCount() === 0, `listeners=${service.listenerCount()}`);
  check("dispose unsubscribes from the session list", sessions.listenerCount() === 0, `listeners=${sessions.listenerCount()}`);

  return tree;
}

/* ---- Phase 2: no service, host route fallback, then a late service ------- */

async function phaseRouteFallback() {
  const tree = buildSidebar();
  const routeRows = [
    { path: "/repo/melon", title: "melon", sessions: 7, updatedAt: new Date(Date.now() - 3 * 3_600_000).toISOString() },
    { path: "/repo/这个工作区名字很长很长很长很长很长很长很长很长很长", title: "长名字", sessions: 0, updatedAt: null },
    { path: "/repo/empty-workspace", title: "empty-workspace", sessions: 2, updatedAt: new Date(Date.now() - 60_000).toISOString() },
  ];
  let fetches = 0;
  window.fetch = () => {
    fetches += 1;
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ workspaces: routeRows }) });
  };
  // Neither service is registered yet.
  let service = null;
  let sessions = null;
  const dispose = mountSkin({ get: (name) => {
    const live = name === "workspaces" ? service : (name === "sessions" ? sessions : null);
    return live === null ? undefined : { list: live.list };
  } });
  await sleep(150);

  const melonRow = rowByLabel(tree, "melon");
  check("route fallback annotates without the service", countsOf(melonRow)[0]?.textContent === "(7)", countsOf(melonRow)[0]?.textContent);
  check("route fallback was fetched once", fetches === 1, `fetches=${fetches}`);
  check("a row with no updatedAt keeps no time node", timeOf(rowByLabel(tree, LONG_LABEL)) === null);

  // The Workspace service registering late must upgrade the page to push refresh.
  service = fakeWorkspaceService(baseSnapshot());
  service.snapshot.items[0].sessionIds = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"];
  document.body.appendChild(document.createElement("i"));
  await sleep(300);
  check("a late workspace service takes over from the route",
    countsOf(melonRow)[0]?.textContent === "(8)" && fetches === 1,
    `${countsOf(melonRow)[0]?.textContent} fetches=${fetches}`);

  // A sessions service arriving even later must refine the count in place —
  // this is the upgrade path a boot race in the other order would take.
  sessions = fakeSessionService(visibleFacts(["s1", "s2", "s4", "s5", "s6", "s7"]));
  sessions.snapshot.byId.s3 = { sessionId: "s3", blank: true, origin: "user" };
  sessions.snapshot.byId.s8 = { sessionId: "s8", blank: false, origin: "subagent" };
  document.body.appendChild(document.createElement("i"));
  await sleep(300);
  check("a late session list refines the count without a reload",
    countsOf(melonRow)[0]?.textContent === "(6)" && fetches === 1,
    `${countsOf(melonRow)[0]?.textContent} fetches=${fetches}`);

  dispose();
}

/* ---- Phase 3: the reported bug — a history-heavy workspace ---------------- */

/**
 * Reproduces the store that produced the report: a workspace whose account holds
 * a long history, most of it archived, plus subagent and blank rows. The count
 * must be the handful of visible rows, not the account size and not the
 * archive-filtered size.
 */
async function phaseHistoricalAccount() {
  const tree = buildSidebar();
  const history = Array.from({ length: 39 }, (_, index) => `h${index}`);
  const archived = history.slice(0, 25);
  const subagents = ["h30", "h31"];
  const blanks = ["h32", "h33"];
  // 39 accounted: 25 archived, 2 subagent, 2 blank → 10 visible rows.
  const service = fakeWorkspaceService({
    items: [
      workspace("w1", "/repo/melon", "melon", history, 120),
      workspace("w2", "/repo/这个工作区名字很长很长很长很长很长很长很长很长很长", "长名字", ["s4"], 5),
      workspace("w3", "/repo/empty-workspace", "empty-workspace", [], 1),
    ],
    archivedSessionIds: archived,
    pinnedSessionIds: [],
    state: "idle",
    phase: "ready",
    error: null,
  });
  const facts = visibleFacts(history);
  for (const id of subagents) facts[id] = { blank: false, origin: "subagent" };
  for (const id of blanks) facts[id] = { blank: true, origin: "user" };
  const sessions = fakeSessionService(facts);
  window.fetch = () => Promise.reject(new Error("harness: the route must not be polled when the service is live"));
  const dispose = mountSkin(contextFor({ workspaces: service, sessions }));
  await sleep(120);

  const melonRow = rowByLabel(tree, "melon");
  check("a history-heavy account counts only its visible rows",
    countsOf(melonRow)[0]?.textContent === "(10)", countsOf(melonRow)[0]?.textContent);
  check("the count is not the raw account size",
    countsOf(melonRow)[0]?.textContent !== "(39)", countsOf(melonRow)[0]?.textContent);
  check("the count is not the archive-filtered size either",
    countsOf(melonRow)[0]?.textContent !== "(14)", countsOf(melonRow)[0]?.textContent);

  // Every visible row must be individually excusable: unblank the blanks and
  // promote the subagents, and the count reaches the account size.
  for (const id of blanks) sessions.snapshot.byId[id].blank = false;
  for (const id of subagents) sessions.snapshot.byId[id].origin = "user";
  service.snapshot.archivedSessionIds = [];
  service.notify();
  sessions.notify();
  await sleep(60);
  check("clearing every exclusion reaches the full account size",
    countsOf(melonRow)[0]?.textContent === "(39)", countsOf(melonRow)[0]?.textContent);

  dispose();
}

/* ---- Preview mode: paint a realistic sidebar, no assertions ------------- */

function preview() {
  buildSidebar();
  mountSkin(contextFor({
    workspaces: fakeWorkspaceService(baseSnapshot()),
    sessions: fakeSessionService(visibleFacts(["s1", "s2", "s3", "s4"])),
  }));
  // Preview mode is only the sidebar: the report column would just sit empty.
  const report = document.getElementById("result");
  report.textContent = "preview";
  document.getElementById("report").style.display = "none";
  document.body.style.padding = "12px";
}

/* ---- Run ---------------------------------------------------------------- */

(async () => {
  const params = new URLSearchParams(location.search);
  if (params.has("preview")) {
    preview();
    return;
  }
  try {
    await phaseLiveService();
    await phaseRouteFallback();
    await phaseHistoricalAccount();
  } catch (error) {
    check("harness ran without throwing", false, error && error.stack ? error.stack : error);
  }
  const failed = results.filter((result) => !result.ok);
  const host = document.getElementById("result");
  const summary = failed.length === 0 ? `DOM CHECK OK (${results.length})` : `DOM CHECK FAILED (${failed.length}/${results.length})`;
  host.textContent = summary;
  host.className = failed.length === 0 ? "ok" : "bad";
  const list = el("ol");
  for (const result of results) {
    const item = el("li", result.ok ? "ok" : "bad", `${result.ok ? "PASS" : "FAIL"} ${result.label}${result.detail === "" ? "" : ` — ${result.detail}`}`);
    list.appendChild(item);
  }
  host.after(list);
  console.log(summary);
  for (const result of results) console.log(`${result.ok ? "PASS" : "FAIL"} ${result.label}${result.detail === "" ? "" : ` — ${result.detail}`}`);
})();
