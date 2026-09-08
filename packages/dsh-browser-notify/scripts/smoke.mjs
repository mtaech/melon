/**
 * Smoke: after build, drive both halves against fakes — the host's config
 * route, and the client's Remote-event -> Notification path.
 *
 *   - host   : apply() with a fake webServer, GET /plugins/dsh-browser-notify/api/config
 *   - client : evaluate lib/client.cjs with a fake window.__ModuleLoader__,
 *              fake `remote` + `sessions` services, fake fetch + Notification,
 *              then fire the three event kinds and assert the right
 *              notifications appear (including the permission-gesture gate and
 *              the running-state seed that survives a missed rising edge).
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
console.log("host OK: config route serves resolved config, disposer unregisters");

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

// The sessions service: scope resolution for event carriers plus the running
// snapshot the plugin seeds from on connect, and the current-viewed session.
const seededRunning = new Map();
const openedSessions = [];
const sessionMeta = new Map();
sessionMeta.set("sess-a", { cwd: "/home/user/melon", displayTitle: "修复 dsh-browser-notify" });
let currentSessionId = undefined;
const sessions = {
  open(id) {
    openedSessions.push(id);
  },
  scopeOf(owner) {
    if (owner !== null && typeof owner === "object" && typeof owner.id === "string") return owner.id;
    return undefined;
  },
  list: {
    getSnapshot() {
      const byId = {};
      for (const [id, running] of seededRunning) byId[id] = { id, running, ...(sessionMeta.get(id) || {}) };
      return { ids: [...seededRunning.keys()], byId, current: currentSessionId };
    },
  },
};

const gestureHandlers = new Map();
let clientModule = null;
const sandbox = {
  console,
  document: { hidden: true, visibilityState: "hidden", hasFocus: () => false },
  Notification: FakeNotification,
  fetch: async () => ({
    ok: true,
    json: async () => ({ config: { question: true, approval: true, roundEnd: true, onlyWhenHidden: true, quietMs: 60000 } }),
  }),
  addEventListener(type, handler) {
    const set = gestureHandlers.get(type) ?? new Set();
    set.add(handler);
    gestureHandlers.set(type, set);
  },
  removeEventListener(type, handler) {
    gestureHandlers.get(type)?.delete(handler);
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
    if (key === "sessions") return sessions;
    if (key === "timer") return fakeTimer;
    return undefined;
  },
  effect(fn) {
    const disposer = fn();
    if (typeof disposer === "function") disposers.push(disposer);
  },
  on() {
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

// 1. permission is still "default": a round end must ask but cannot raise yet
await listeners.get("api-session/status")("sess-seed", false);
if (notifications.length !== 0) throw new Error("no notification may appear before permission is granted");
if (permissionRequests !== 1) throw new Error("round end should have attempted a permission request; got " + permissionRequests);
console.log("client OK: seeded running state detects the falling edge without a rising edge");

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

// 3b. clicking the notification jumps to its session
openedSessions.length = 0;
if (typeof notifications[1].onclick !== "function") throw new Error("roundEnd notification has no click handler");
notifications[1].onclick();
if (openedSessions.length !== 1 || openedSessions[0] !== "sess-a") {
  throw new Error("clicking the roundEnd notification should open sess-a: " + JSON.stringify(openedSessions));
}
console.log("client OK: clicking a notification opens its session");

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
notifications.length = 0;
currentSessionId = "sess-main";
sandbox.document.hasFocus = () => true;
await listeners.get("api-session/status")("sess-other", true);
await listeners.get("api-session/status")("sess-other", false);
if (notifications.length !== 1 || !notifications[0].title.includes("回合")) {
  throw new Error("an event for another conversation should notify even when focused: " + JSON.stringify(notifications.map((n) => n.title)));
}
console.log("client OK: event for another conversation notifies while focused");

// 10. viewing the SAME conversation suppresses while focused
notifications.length = 0;
currentSessionId = "sess-main";
await listeners.get("api-session/status")("sess-main", true);
await listeners.get("api-session/status")("sess-main", false);
if (notifications.length !== 0) throw new Error("same-conversation event should stay suppressed while focused");
console.log("client OK: same-conversation event suppressed while focused");

// 11. re-notify: an unanswered question for another conversation re-raises
//     after the re-notify interval while the user stays away
let fakeNow = Date.now();
sandbox.Date = { now: () => fakeNow };
// clear the step-4 pending question (sess-b) by "viewing" it first
currentSessionId = "sess-b";
for (const cb of intervalCallbacks) cb();
notifications.length = 0;
currentSessionId = "sess-away"; // user is viewing another conversation
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
currentSessionId = "sess-pending";
fakeNow += 21000;
for (const cb of intervalCallbacks) cb();
if (notifications.length !== 0) throw new Error("viewing the question's conversation should stop re-notify");
console.log("client OK: viewing the conversation stops re-notify");

console.log("smoke OK: host config route + client Remote->Notification flow");
