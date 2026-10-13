/**
 * Smoke: after build, drive both halves against fakes — the host's config
 * route, and the client's Remote-event -> Notification path.
 *
 *   - host   : apply() with a fake webServer, GET /plugins/dsh-browser-notify/api/config
 *   - client : evaluate lib/client.cjs with a fake window.__ModuleLoader__,
 *              the real DSH faces (`remote`, `sessions` without navigation,
 *              `uiWorkspace.openSession`, the persisted selection key), fake
 *              fetch + Notification, then fire the three event kinds and assert
 *              the right notifications appear (including the permission-gesture
 *              gate, the running-state seed that survives a missed rising edge,
 *              click-to-jump (ui-workspace navigation, the Desktop shell's
 *              window raise, and the legacy fallback), the subagent-vs-main-Agent labelling with its
 *              `subagents` switch, and the host-native relay that takes over
 *              whenever the browser channel cannot deliver).
 *
 * Run with `pnpm run smoke` (builds first).
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const host = path.join(root, "lib", "host.js");
const client = path.join(root, "lib", "client.cjs");

// ---------- host half ----------
if (!existsSync(host)) throw new Error("lib/host.js missing — run `pnpm run build` first");
const hostMod = await import(host);
if (typeof hostMod.apply !== "function") throw new Error("host.js does not export apply");

let registered = null;
const fakeWebServer = {
  register(route) {
    registered = route;
    return () => {
      registered = null;
    };
  },
};
const dispose = hostMod.apply({ webServer: fakeWebServer }, { question: false });
if (typeof dispose !== "function") throw new Error("host apply did not return a disposer");
if (!registered || registered.kind !== "prefix" || registered.path !== "/plugins/dsh-browser-notify/api") {
  throw new Error("host did not register the expected route");
}

let captured = null;
const fakeRes = {
  writeHead(code, headers) {
    this.code = code;
    this.headers = headers;
  },
  end(payload) {
    captured = { code: this.code, payload };
  },
};
await registered.handler({ method: "GET", url: "/plugins/dsh-browser-notify/api/config" }, fakeRes);
if (captured === null) throw new Error("config route never answered");
const configBody = JSON.parse(captured.payload);
if (captured.code !== 200 || configBody.config.question !== false || configBody.config.approval !== true || configBody.config.quietMs !== 15000) {
  throw new Error("config route returned an unexpected payload: " + captured.payload);
}
dispose();
if (registered !== null) throw new Error("host disposer did not unregister the route");

// The native plan is pure, so it can be pinned here without spawning a popup:
// it is also the evidence behind the `available` flag the client reads.
const linuxPlan = hostMod.nativePlan("linux", { title: "标题", body: "正文", timeoutMs: 6000 });
if (!linuxPlan || linuxPlan.command !== "gdbus") throw new Error("linux should plan a gdbus notification: " + JSON.stringify(linuxPlan));
if (!linuxPlan.args.includes("org.freedesktop.Notifications.Notify") || !linuxPlan.args.includes("标题")) {
  throw new Error("the gdbus argv lost the method or the title: " + JSON.stringify(linuxPlan.args));
}
if (hostMod.nativePlan("darwin", { title: "t", body: "b", timeoutMs: 6000 })?.command !== "osascript") {
  throw new Error("darwin should plan an osascript notification");
}
if (hostMod.nativePlan("win32", { title: "t", body: "b", timeoutMs: 6000 }) !== null) {
  throw new Error("a platform without a notifier must plan nothing (available: false)");
}
console.log("host OK: config route serves resolved config, disposer unregisters, nativePlan pins the notifier argv");

// ---------- client half ----------
const clientText = readFileSync(client, "utf8");
if (!clientText.includes("__ModuleLoader__.load")) throw new Error("client.cjs does not look like a ModuleLoader bundle");
if (!clientText.includes("dsh-browser-notify")) throw new Error("client.cjs is missing the plugin id");

const notifications = [];
let permissionState = "default";
let permissionRequests = 0;
let inGesture = false;

class FakeNotification {
  constructor(title, options) {
    this.title = title;
    this.options = options;
    notifications.push(this);
  }
  close() {}
}
Object.defineProperty(FakeNotification, "permission", { get: () => permissionState });
FakeNotification.requestPermission = async () => {
  permissionRequests += 1;
  // Firefox >= 72: a gesture-less request is ignored and resolves to the
  // current state; only a request inside a user gesture may prompt/grant.
  if (inGesture) permissionState = "granted";
  return permissionState;
};

const listeners = new Map();
const remote = {
  $on(event, listener) {
    listeners.set(event, listener);
    return () => {
      listeners.delete(event);
    };
  },
};

// The sessions service as DSH actually exposes it: scope resolution plus the
// running snapshot the plugin seeds from. Navigation is deliberately NOT here
// (it belongs to ui-workspace), and the list carries no `current` selection.
const seededRunning = new Map();
const openedSessions = [];
const sessionMeta = new Map();
sessionMeta.set("sess-a", { cwd: "/home/user/melon", displayTitle: "修复 dsh-browser-notify" });
/** The ui-workspace selection the plugin reads out of localStorage. */
let storedSelection = null;
/** A snapshot-level `current` the plugin prefers when a build carries one. */
let snapshotCurrent;
/** When set, the fake session controller grows a legacy `open()` method. */
let legacyOpen = null;
/** Child ids the plugin must classify through `subagentAddress` (no list row yet). */
const subagentAddresses = new Map();
const sessions = {
  scopeOf(owner) {
    if (owner !== null && typeof owner === "object" && typeof owner.id === "string") return owner.id;
    return undefined;
  },
  subagentAddress(id) {
    return subagentAddresses.get(id);
  },
  list: {
    getSnapshot() {
      const byId = {};
      for (const [id, running] of seededRunning) byId[id] = { id, running, ...(sessionMeta.get(id) || {}) };
      return { ids: [...seededRunning.keys()], byId, current: snapshotCurrent };
    },
  },
};
/** `connection/reset` handlers the plugin registered, so a config reload is drivable. */
const resetHandlers = [];
/** Payload `GET ./api/config` answers; mutated to test a config reload. */
let configPayload = { question: true, approval: true, roundEnd: true, subagents: true, onlyWhenHidden: true, quietMs: 60000 };
/** Every `POST ./api/notify` payload (the host-native fallback the client requests). */
const relayCalls = [];
/** What the host half answers a relay request with. */
let relayResponse = { shown: true, available: true, channel: "gdbus" };
// The real navigation face (`ctx.uiWorkspace`), held behind a flag so the
// legacy-fallback step can take it away.
const uiWorkspace = {
  openSession(id) {
    openedSessions.push(id);
  },
};
let uiWorkspaceAvailable = true;
/** `dshDesktop.window.focus` calls: the Desktop shell bridge the click must use. */
const desktopFocusCalls = [];

const gestureHandlers = new Map();
let clientModule = null;
const sandbox = {
  console,
  document: { hidden: true, visibilityState: "hidden", hasFocus: () => false },
  Notification: FakeNotification,
  fetch: async (url, init) => {
    if (typeof url === "string" && url.endsWith("/api/notify")) {
      relayCalls.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => relayResponse };
    }
    return { ok: true, status: 200, json: async () => ({ config: configPayload }) };
  },
  addEventListener(type, handler) {
    const set = gestureHandlers.get(type) ?? new Set();
    set.add(handler);
    gestureHandlers.set(type, set);
  },
  removeEventListener(type, handler) {
    gestureHandlers.get(type)?.delete(handler);
  },
  // ui-workspace persists its main selection under this key; a served Web page
  // and the Electron shell both have it.
  localStorage: {
    getItem(key) {
      return key === "dsh.sessions.current" ? storedSelection : null;
    },
    setItem() {},
    removeItem() {},
  },
};
sandbox.window = sandbox;
sandbox.window.__ModuleLoader__ = {
  load({ id, factory }) {
    clientModule = factory(() => {
      throw new Error("unexpected require() in dsh-browser-notify client");
    });
  },
};

/** Run every armed gesture listener the way a real user interaction would. */
const fireGesture = () => {
  inGesture = true;
  try {
    for (const set of gestureHandlers.values()) for (const handler of set) handler();
  } finally {
    inGesture = false;
  }
};

vm.createContext(sandbox);
vm.runInContext(clientText, sandbox);

if (!clientModule || typeof clientModule.apply !== "function") throw new Error("client.cjs did not export apply");
if (!Array.isArray(clientModule.inject) || !clientModule.inject.includes("remote")) throw new Error("client inject does not declare \"remote\"");

// Seed a session that is already running before the plugin attaches: its
// rising edge is invisible, so only the seed can make the falling edge notify.
seededRunning.set("sess-seed", true);
// sess-a is listed (with project/title meta) so roundEnd carries its labels.
seededRunning.set("sess-a", false);

const intervalCallbacks = [];
const fakeTimer = {
  interval(callback, ms) {
    intervalCallbacks.push(callback);
    return () => {};
  },
};

const disposers = [];
const fakeCtx = {
  get(key) {
    if (key === "remote") return remote;
    if (key === "sessions") return legacyOpen === null ? sessions : { ...sessions, open: legacyOpen };
    if (key === "uiWorkspace") return uiWorkspaceAvailable ? uiWorkspace : undefined;
    if (key === "timer") return fakeTimer;
    return undefined;
  },
  effect(fn) {
    const disposer = fn();
    if (typeof disposer === "function") disposers.push(disposer);
  },
  on(event, handler) {
    if (event === "connection/reset") resetHandlers.push(handler);
    return () => {};
  },
};
clientModule.apply(fakeCtx);
await new Promise((resolve) => setTimeout(resolve, 10)); // let the config fetch settle

const hasListener = (event) => typeof listeners.get(event) === "function";
if (!hasListener("user-questions/request")) throw new Error("client did not subscribe user-questions/request");
if (!hasListener("approval/request")) throw new Error("client did not subscribe approval/request");
if (!hasListener("api-session/status")) throw new Error("client did not subscribe api-session/status");
if (gestureHandlers.size === 0) throw new Error("client did not arm a permission-gesture request");

// 1. permission is still "default": a round end must ask but cannot raise yet,
//    and — because this browser cannot show anything — it must reach the
//    host-native relay instead of vanishing.
relayCalls.length = 0;
await listeners.get("api-session/status")("sess-seed", false);
if (notifications.length !== 0) throw new Error("no notification may appear before permission is granted");
if (permissionRequests !== 1) throw new Error("round end should have attempted a permission request; got " + permissionRequests);
await new Promise((resolve) => setTimeout(resolve, 0));
if (relayCalls.length !== 1) {
  throw new Error("an unraisable browser notification should reach the host relay; got " + relayCalls.length);
}
if (!relayCalls[0].tag.includes("roundEnd:sess-seed")) {
  throw new Error("the relay payload should carry the same grouping tag: " + JSON.stringify(relayCalls[0]));
}
console.log("client OK: seeded running state detects the falling edge, and the host relay takes over without permission");

// 2. the gesture request grants permission and confirms it once
fireGesture();
await new Promise((resolve) => setTimeout(resolve, 0));
if (permissionState !== "granted") throw new Error("gesture did not grant permission");
if (notifications.length !== 1 || !notifications[0].title.includes("通知已开启")) {
  throw new Error("granting permission should raise the confirmation: " + JSON.stringify(notifications.map((n) => n.title)));
}
console.log("client OK: permission granted from the first user gesture");

// 3. round end (running -> idle) -> notification
await listeners.get("api-session/status")("sess-a", true);
await listeners.get("api-session/status")("sess-a", false);
if (notifications.length !== 2 || !notifications[1].title.includes("回合")) {
  throw new Error("round end did not raise the expected notification: " + JSON.stringify(notifications.map((n) => n.title)));
}
if (!notifications[1].options.body.includes("melon") || !notifications[1].options.body.includes("修复")) {
  throw new Error("roundEnd body should carry project and session labels: " + JSON.stringify(notifications[1].options.body));
}
console.log("client OK: api-session/status running->idle raises a roundEnd notification (with project/session)");

// 3b. clicking the notification raises the Desktop shell window (when the shell
//     bridge is there) and jumps to its session through ui-workspace
openedSessions.length = 0;
desktopFocusCalls.length = 0;
let focusAtNavigation = -1;
sandbox.dshDesktop = {
  window: {
    focus() {
      focusAtNavigation = openedSessions.length;
      desktopFocusCalls.push(focusAtNavigation);
      return Promise.resolve();
    },
  },
};
if (typeof notifications[1].onclick !== "function") throw new Error("roundEnd notification has no click handler");
notifications[1].onclick();
if (desktopFocusCalls.length !== 1) {
  throw new Error("clicking a notification should ask the Desktop shell to raise its window: " + desktopFocusCalls.length);
}
// The window is raised before the in-app navigation, so the jump is visible.
if (focusAtNavigation !== 0) throw new Error("the shell window must be raised before navigating: " + focusAtNavigation);
if (openedSessions.length !== 1 || openedSessions[0] !== "sess-a") {
  throw new Error("clicking the roundEnd notification should open sess-a through uiWorkspace: " + JSON.stringify(openedSessions));
}
console.log("client OK: clicking a notification raises the Desktop shell window, then opens its session");

// 3c. with no ui-workspace face, the legacy sessions.open() is still tried
openedSessions.length = 0;
uiWorkspaceAvailable = false;
legacyOpen = (id) => { openedSessions.push("legacy:" + id); };
notifications[1].onclick();
if (openedSessions.length !== 1 || openedSessions[0] !== "legacy:sess-a") {
  throw new Error("the legacy sessions.open() fallback should run without uiWorkspace: " + JSON.stringify(openedSessions));
}
uiWorkspaceAvailable = true;
legacyOpen = null;
// 3d. neither face present: the click stays silent instead of throwing
openedSessions.length = 0;
uiWorkspaceAvailable = false;
notifications[1].onclick();
if (openedSessions.length !== 0) throw new Error("a click without any navigation face must not navigate");
uiWorkspaceAvailable = true;
// 3e. the shell bridge is best-effort: a throwing or refusing request must not
//     stop the jump, and a rejection must not surface as an unhandled one
sandbox.dshDesktop = { window: { focus() { throw new Error("no native window"); } } };
openedSessions.length = 0;
notifications[1].onclick();
if (openedSessions.length !== 1 || openedSessions[0] !== "sess-a") {
  throw new Error("a throwing shell bridge must not stop the session jump: " + JSON.stringify(openedSessions));
}
sandbox.dshDesktop = { window: { focus: () => Promise.reject(new Error("refused")) } };
openedSessions.length = 0;
notifications[1].onclick();
if (openedSessions.length !== 1) throw new Error("a refusing shell bridge must not stop the session jump");
sandbox.dshDesktop = undefined;
await new Promise((resolve) => setTimeout(resolve, 0));
console.log("client OK: legacy sessions.open() fallback runs, a faceless click stays silent, and a broken shell bridge never breaks the click");

// 4. question event -> notification carrying the question text, keyed by the
//    listener carrier (the payload here has no agent).
const questionListener = listeners.get("user-questions/request");
await questionListener.call({ id: "sess-b" }, { questions: [{ question: "确定要删除这个文件吗？", options: [{ label: "删除" }, { label: "取消" }] }] }, async () => {});
if (notifications.length !== 3 || !notifications[2].title.includes("提问") || !notifications[2].options.body.includes("删除")) {
  throw new Error("question event did not raise the expected notification: " + JSON.stringify(notifications.map((n) => ({ title: n.title, body: n.options.body }))));
}
console.log("client OK: user-questions/request raises a question notification");

// 5. suppression: that question suppresses the roundEnd right after it
await listeners.get("api-session/status")("sess-b", true);
await listeners.get("api-session/status")("sess-b", false);
if (notifications.length !== 3) {
  throw new Error("roundEnd should be suppressed right after a question for the same session; got " + JSON.stringify(notifications.map((n) => n.title)));
}
console.log("client OK: roundEnd suppressed right after a same-session question");

// 6. approval event -> notification naming the tool
const approvalListener = listeners.get("approval/request");
await approvalListener.call({ id: "sess-e" }, { toolName: "bash", reason: "运行 pnpm build" }, async () => {});
if (notifications.length !== 4 || !notifications[3].title.includes("授权") || !notifications[3].options.body.includes("bash")) {
  throw new Error("approval event did not raise the expected notification: " + JSON.stringify(notifications.map((n) => n.options.body)));
}
console.log("client OK: approval/request raises an approval notification");

// 7. a background window (tab visible, no focus) still counts as not watching
notifications.length = 0;
sandbox.document.hidden = false;
sandbox.document.visibilityState = "visible";
sandbox.document.hasFocus = () => false;
await listeners.get("api-session/status")("sess-c", true);
await listeners.get("api-session/status")("sess-c", false);
if (notifications.length !== 1) throw new Error("an unfocused window should still notify: " + JSON.stringify(notifications.map((n) => n.title)));
console.log("client OK: unfocused window notifies (onlyWhenHidden means not in the foreground)");

// 8. a focused, visible tab suppresses notifications
notifications.length = 0;
sandbox.document.hasFocus = () => true;
await listeners.get("api-session/status")("sess-d", true);
await listeners.get("api-session/status")("sess-d", false);
if (notifications.length !== 0) throw new Error("a focused tab should suppress notifications under onlyWhenHidden");
console.log("client OK: focused tab suppresses notifications (onlyWhenHidden)");

// 9. viewing a DIFFERENT conversation still notifies while the tab is focused
//    (the selection is read from ui-workspace's persisted key, exactly as DSH
//    writes it — the session list snapshot has no `current`)
notifications.length = 0;
storedSelection = JSON.stringify({ sessionId: "sess-main" });
sandbox.document.hasFocus = () => true;
await listeners.get("api-session/status")("sess-other", true);
await listeners.get("api-session/status")("sess-other", false);
if (notifications.length !== 1 || !notifications[0].title.includes("回合")) {
  throw new Error("an event for another conversation should notify even when focused: " + JSON.stringify(notifications.map((n) => n.title)));
}
console.log("client OK: event for another conversation notifies while focused");

// 10. viewing the SAME conversation suppresses while focused
notifications.length = 0;
storedSelection = JSON.stringify({ sessionId: "sess-main" });
await listeners.get("api-session/status")("sess-main", true);
await listeners.get("api-session/status")("sess-main", false);
if (notifications.length !== 0) throw new Error("same-conversation event should stay suppressed while focused");
console.log("client OK: same-conversation event suppressed while focused");

// 10b. an unresolvable selection (a subagent address carries no sessionId)
//      stays conservative while the window is focused: no notification
notifications.length = 0;
storedSelection = JSON.stringify({ subagentAddress: "sub-1" });
await listeners.get("api-session/status")("sess-main2", true);
await listeners.get("api-session/status")("sess-main2", false);
if (notifications.length !== 0) throw new Error("an unresolvable selection should suppress while focused");
// 10c. a snapshot-level `current` wins over storage when a build carries one
notifications.length = 0;
snapshotCurrent = "sess-main2";
storedSelection = JSON.stringify({ sessionId: "elsewhere" });
await listeners.get("api-session/status")("sess-main2", true);
await listeners.get("api-session/status")("sess-main2", false);
if (notifications.length !== 0) throw new Error("snapshot.current should take precedence over the persisted selection");
snapshotCurrent = undefined;
console.log("client OK: subagent selection and snapshot.current precedence behave");

// 10d. a subagent child is told apart from the main Agent: its copy names the
//      subagent and its parent conversation, and clicking lands on the child.
notifications.length = 0;
storedSelection = JSON.stringify({ sessionId: "sess-main" });
sandbox.document.hidden = true;
sandbox.document.visibilityState = "hidden";
sessionMeta.set("sess-child", {
  cwd: "/home/user/melon",
  displayTitle: "teammate-1",
  origin: "subagent",
  parentId: "sess-a",
});
seededRunning.set("sess-child", false);
await listeners.get("api-session/status")("sess-child", true);
await listeners.get("api-session/status")("sess-child", false);
if (notifications.length !== 1) {
  throw new Error("a subagent round end should notify: " + JSON.stringify(notifications.map((n) => n.title)));
}
const childNotification = notifications[0];
if (!childNotification.title.includes("子代理")) {
  throw new Error("a subagent notification must say so in its title: " + childNotification.title);
}
if (!childNotification.options.body.includes("子代理：teammate-1")) {
  throw new Error("a subagent body must name the subagent: " + JSON.stringify(childNotification.options.body));
}
if (!childNotification.options.body.includes("父会话：修复 dsh-browser-notify")) {
  throw new Error("a subagent body must name its parent conversation: " + JSON.stringify(childNotification.options.body));
}
openedSessions.length = 0;
childNotification.onclick();
if (openedSessions.length !== 1 || openedSessions[0] !== "sess-child") {
  throw new Error("clicking a subagent notification should open the child session: " + JSON.stringify(openedSessions));
}
console.log("client OK: a subagent child is labelled apart from the main Agent and openable");

// 10e. a child with no list row yet is still classified, through the session
//      service's subagent address; the main copy stays unchanged.
notifications.length = 0;
subagentAddresses.set("sess-child-norow", { parentSessionId: "sess-a", childSessionId: "sess-child-norow", mode: "one-shot" });
await listeners.get("api-session/status")("sess-child-norow", true);
await listeners.get("api-session/status")("sess-child-norow", false);
if (notifications.length !== 1 || !notifications[0].title.includes("子代理")) {
  throw new Error("a catalog-only subagent child should still be labelled a subagent: " + JSON.stringify(notifications.map((n) => n.title)));
}
notifications.length = 0;
await listeners.get("api-session/status")("sess-plain", true);
await listeners.get("api-session/status")("sess-plain", false);
if (notifications.length !== 1 || notifications[0].title.includes("子代理")) {
  throw new Error("a main-Agent event must not be labelled a subagent: " + JSON.stringify(notifications.map((n) => n.title)));
}
console.log("client OK: subagent classification falls back to the subagent address");

// 10f. config.subagents=false silences children only; the main Agent still notifies
sessionMeta.set("sess-child2", { cwd: "/home/user/melon", displayTitle: "teammate-2", origin: "subagent", parentId: "sess-a" });
seededRunning.set("sess-child2", false);
configPayload = { question: true, approval: true, roundEnd: true, subagents: false, onlyWhenHidden: true, quietMs: 60000 };
for (const handler of resetHandlers) handler();
await new Promise((resolve) => setTimeout(resolve, 0));
notifications.length = 0;
await listeners.get("api-session/status")("sess-child2", true);
await listeners.get("api-session/status")("sess-child2", false);
if (notifications.length !== 0) {
  throw new Error("subagents=false must silence a subagent round end: " + JSON.stringify(notifications.map((n) => n.title)));
}
await listeners.get("api-session/status")("sess-main3", true);
await listeners.get("api-session/status")("sess-main3", false);
if (notifications.length !== 1 || notifications[0].title.includes("子代理")) {
  throw new Error("subagents=false must not silence the main Agent: " + JSON.stringify(notifications.map((n) => n.title)));
}
configPayload = { question: true, approval: true, roundEnd: true, subagents: true, onlyWhenHidden: true, quietMs: 60000 };
for (const handler of resetHandlers) handler();
await new Promise((resolve) => setTimeout(resolve, 0));
console.log("client OK: subagents=false silences children, keeps the main Agent");

// 10g. permission denied -> the host relay carries the event, no browser object
permissionState = "denied";
relayCalls.length = 0;
notifications.length = 0;
await listeners.get("api-session/status")("sess-main4", true);
await listeners.get("api-session/status")("sess-main4", false);
await new Promise((resolve) => setTimeout(resolve, 0));
if (notifications.length !== 0) {
  throw new Error("a denied permission must not construct a browser notification");
}
if (relayCalls.length !== 1 || !relayCalls[0].title.includes("回合")) {
  throw new Error("a denied permission should fall back to the host relay once: " + JSON.stringify(relayCalls));
}
if (!relayCalls[0].body.includes("会话：sess-mai")) {
  throw new Error("the relayed body should stay the enriched one: " + JSON.stringify(relayCalls[0].body));
}
// a host that can never notify disables the fallback instead of retrying forever
permissionState = "denied";
relayCalls.length = 0;
relayResponse = { shown: false, available: false, channel: "none" };
await listeners.get("api-session/status")("sess-main5", true);
await listeners.get("api-session/status")("sess-main5", false);
await new Promise((resolve) => setTimeout(resolve, 0));
if (relayCalls.length !== 1) throw new Error("the first relay attempt should happen: " + relayCalls.length);
await listeners.get("api-session/status")("sess-main6", true);
await listeners.get("api-session/status")("sess-main6", false);
await new Promise((resolve) => setTimeout(resolve, 0));
if (relayCalls.length !== 1) throw new Error("a host without a notifier must stop the fallback: " + relayCalls.length);
relayResponse = { shown: true, available: true, channel: "gdbus" };
permissionState = "granted";
sandbox.document.hidden = false;
sandbox.document.visibilityState = "visible";
sandbox.document.hasFocus = () => true;
console.log("client OK: denied permission relays to the host, and a notifier-less host stops the retry");

// 11. re-notify: an unanswered question for another conversation re-raises
//     after the re-notify interval while the user stays away
let fakeNow = Date.now();
sandbox.Date = { now: () => fakeNow };
// clear the step-4 pending question (sess-b) by "viewing" it first
storedSelection = JSON.stringify({ sessionId: "sess-b" });
for (const cb of intervalCallbacks) cb();
notifications.length = 0;
storedSelection = JSON.stringify({ sessionId: "sess-away" }); // user is viewing another conversation
await questionListener.call({ id: "sess-pending" }, { questions: [{ question: "继续？" }] }, async () => {});
if (notifications.length !== 1) throw new Error("question for another conversation should notify once: " + notifications.length);

// tick before the interval elapses: no extra raise
for (const cb of intervalCallbacks) cb();
if (notifications.length !== 1) throw new Error("no re-raise before the interval elapses: " + notifications.length);

// advance the clock past RENOTIFY_MS and tick: re-raise happens
fakeNow += 21000;
for (const cb of intervalCallbacks) cb();
if (notifications.length !== 2) throw new Error("unanswered question should re-raise after the interval: " + notifications.length);
console.log("client OK: unanswered question re-notifies while the user is away");

// 12. coming back to the conversation stops the reminders
notifications.length = 0;
storedSelection = JSON.stringify({ sessionId: "sess-pending" });
fakeNow += 21000;
for (const cb of intervalCallbacks) cb();
if (notifications.length !== 0) throw new Error("viewing the question's conversation should stop re-notify");
console.log("client OK: viewing the conversation stops re-notify");

console.log("smoke OK: host config route + client Remote->Notification flow");
