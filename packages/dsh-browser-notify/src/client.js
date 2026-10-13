/**
 * dsh-browser-notify — Client half.
 *
 * Subscribes to the DSH Remote event stream (`ctx.remote`, provided by the
 * `@deepseek-ai/dsh-api-gateway` client that the standard web app already
 * mounts) and raises browser system notifications whenever the agent needs
 * the user's attention but the GUI is not in the foreground:
 *
 *   - `user-questions/request` : the agent asked a question (waterfall — we
 *     notify and then `next()` so the question composer still renders).
 *   - `approval/request`       : a tool call needs user approval (same deal).
 *   - `api-session/status`     : an agent round ended (running -> idle) and is
 *     waiting for input.
 *
 * Pure JavaScript, no React. Behaviour is read from the host half at
 * `GET /plugins/dsh-browser-notify/api/config`, with defaults here so a host that is
 * slow or unreachable never breaks the plugin.
 *
 * Two facts decide the copy of every notification:
 *
 *   - which conversation it belongs to (project basename + session title), and
 *   - whether that conversation is the main Agent or a subagent child
 *     (`origin: "subagent"` on the client session row). A child's copy names
 *     the subagent and its parent conversation, so a teammate finishing is
 *     never mistaken for the conversation the user is holding.
 *
 * Permission is the subtle part: browsers gate the notification permission
 * prompt behind a real user gesture (Firefox >= 72 rejects a gesture-less
 * `Notification.requestPermission()` outright and leaves the permission at
 * "default"). Asking only when a notification is due therefore never grants
 * permission, so the plugin arms a one-shot request on the first interaction.
 * The host's native notifier is the fallback for a document the browser will not
 * let notify: `dsh web` opened in the system browser (especially `--port 0`,
 * a fresh origin per launch) stays at "default", so its notifications go out at
 * `POST ./api/notify` — a channel with neither permission nor origin. The
 * Desktop shell serves the stable `dsh-app://app` origin and grants the
 * permission itself, so its documents keep the browser channel (and the click
 * that reaches them asks the shell to raise its window).
 */

export const name = "dsh-browser-notify";
export const inject = ["remote"];

const API = "/plugins/dsh-browser-notify/api";
const ICON = "/favicon.svg";
/** ui-workspace's persisted main selection: `{ sessionId }` or `{ subagentAddress }`. */
const SELECTION_KEY = "dsh.sessions.current";
/** Notification lifetime handed to the host-native fallback. */
const RELAY_TIMEOUT_MS = 6000;
/** A relay request that has not answered by then is dead; the page must not hang. */
const RELAY_ABORT_MS = 4000;

const DEFAULTS = {
  question: true,
  approval: true,
  roundEnd: true,
  subagents: true,
  onlyWhenHidden: true,
  quietMs: 15000,
};

/**
 * Notification copy (zh, matching the product's surface language). Every kind
 * carries two titles/bodies: the main Agent and a subagent child are told
 * apart, so a teammate finishing never reads as the conversation itself.
 */
const COPY = {
  questionTitle: "DeepSeek Harness · Agent 提问",
  subagentQuestionTitle: "DeepSeek Harness · 子代理提问",
  questionFallback: "Agent 需要你回答一个问题",
  subagentQuestionFallback: "子代理需要你回答一个问题",
  questionMore: (n) => `（共 ${n} 题）`,
  approvalTitle: "DeepSeek Harness · 需要授权",
  subagentApprovalTitle: "DeepSeek Harness · 子代理需要授权",
  approvalBody: (toolName) => `Agent 请求执行 ${toolName}`,
  subagentApprovalBody: (toolName) => `子代理请求执行 ${toolName}`,
  roundEndTitle: "DeepSeek Harness · Agent 已结束回合",
  subagentRoundEndTitle: "DeepSeek Harness · 子代理已结束回合",
  roundEndBody: "回合已完成，等待你的输入",
  subagentRoundEndBody: "子代理回合已完成",
  enabledTitle: "DeepSeek Harness · 通知已开启",
  enabledBody: "回合结束、提问或授权时会在这里提醒你",
  project: (name) => `项目：${name}`,
  conversation: (name) => `会话：${name}`,
  subagent: (name) => `子代理：${name}`,
  parent: (name) => `父会话：${name}`,
};

/** First 8 characters of a session id — the label used when no title is known. */
function shortId(sessionId) {
  return String(sessionId).slice(0, 8);
}

/**
 * The `项目 / 会话` line appended to a notification body — or
 * `项目 / 子代理 / 父会话` for a subagent child, which is what tells the user
 * at a glance whether the main conversation or one of its teammates moved.
 * @param facts - {@link sessionFacts} result.
 * @param session - the session id the event belongs to.
 * @returns one line, `""` when nothing is known.
 */
function contextLine(facts, session) {
  const parts = [];
  if (facts.project !== undefined) parts.push(COPY.project(facts.project));
  if (facts.subagent) {
    parts.push(COPY.subagent(facts.title ?? shortId(session)));
    if (facts.parentTitle !== undefined) parts.push(COPY.parent(facts.parentTitle));
  } else if (typeof session === "string" && session !== "" && session !== "any") {
    parts.push(COPY.conversation(facts.title ?? shortId(session)));
  }
  return parts.join(" · ");
}

/** Collapse whitespace and clip to `max` code points for a notification line. */
function truncate(text, max) {
  const s = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + "…";
}

/** Notification state holder: config, quiet-window bookkeeping, raising. */
function createNotifier(ctx) {
  let config = { ...DEFAULTS };
  /** tag -> last notify time, for the per-kind quiet window. */
  const lastAt = new Map();
  /** session -> last question/approval notify time, to suppress a redundant roundEnd. */
  const attentionAt = new Map();
  /** session -> last observed running state, so only the running -> idle edge notifies. */
  const running = new Map();
  let permissionArmed = false;
  let promptedThisLoad = false;
  /** `undefined` = untried, `true` = the host has a native notifier, `false` = it does not. */
  let relayState;

  const supported = () => typeof Notification !== "undefined";

  /**
   * Whether the user is currently looking at the GUI. `visibilityState` alone
   * is not enough: a background window keeps its tab "visible", so an
   * unfocused window must count as not-in-the-foreground too.
   */
  const isForeground = () => {
    if (typeof document === "undefined") return true;
    if (document.hidden === true) return false;
    if (typeof document.visibilityState === "string" && document.visibilityState !== "visible") return false;
    if (typeof document.hasFocus === "function") {
      try {
        return document.hasFocus() !== false;
      } catch { /* focus can throw in odd embedding contexts */ }
    }
    return true;
  };

  /** The session the user is currently viewing (sidebar selection), if resolvable. */
  const currentSession = () => {
    // A session-list snapshot that carries the selection would be the cleanest
    // source; no released DSH exposes one, so this only future-proofs the read.
    const sessions = ctx.get("sessions");
    if (sessions && sessions.list && typeof sessions.list.getSnapshot === "function") {
      try {
        const snapshot = sessions.list.getSnapshot();
        if (snapshot && typeof snapshot.current === "string" && snapshot.current !== "") {
          return snapshot.current;
        }
      } catch { /* a missing/odd snapshot must never break the plugin */ }
    }
    // ui-workspace persists its main selection (`{ sessionId }`, or a
    // `{ subagentAddress }` when a subagent is on screen) under this key —
    // the only readable source of "which conversation is displayed".
    try {
      if (typeof localStorage !== "undefined") {
        const raw = localStorage.getItem(SELECTION_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          const id = parsed && parsed.sessionId;
          if (typeof id === "string" && id !== "") return id;
        }
      }
    } catch { /* storage may be unavailable or hold a foreign value */ }
    return undefined;
  };

  /**
   * Jump to `sessionId`. DSH's client navigation belongs to the ui-workspace
   * service (`uiWorkspace.openSession`) — the session controller deliberately
   * exposes no navigation — with the older `sessions.open` face tried as a
   * fallback. Never throws: a notification click must not break the page.
   * @returns true when a navigation call was made.
   */
  const openSession = (sessionId) => {
    try {
      const uiWorkspace = ctx.get("uiWorkspace");
      if (uiWorkspace && typeof uiWorkspace.openSession === "function") {
        uiWorkspace.openSession(sessionId);
        return true;
      }
    } catch { /* an unregistered service or a refused navigation is not fatal */ }
    try {
      const sessions = ctx.get("sessions");
      if (sessions && typeof sessions.open === "function") {
        sessions.open(sessionId);
        return true;
      }
    } catch { /* the legacy face is best-effort */ }
    return false;
  };

  /**
   * Ask the Desktop shell to raise its native window. Electron delivers a
   * renderer notification click to the page but never activates the app window,
   * and `window.focus()` inside a renderer cannot either — so the shell offers
   * an explicit request. A plain browser has no such bridge: clicking the
   * notification already raises the browser window itself.
   * @returns true when the shell accepted the request.
   */
  const raiseDesktopWindow = () => {
    try {
      const desktop = typeof window !== "undefined" ? window.dshDesktop : undefined;
      const bridge = desktop ? desktop.window : undefined;
      if (bridge && typeof bridge.focus === "function") {
        const asked = bridge.focus();
        // The shell answers asynchronously; a rejection must not escape a click.
        if (asked && typeof asked.catch === "function") asked.catch(() => {});
        return true;
      }
    } catch { /* an older or foreign shell bridge must never break the click */ }
    return false;
  };

  /**
   * Whether an event for `session` should be surfaced. The page being focused
   * only means the user is looking at SOME conversation, not this one: an event
   * for a different conversation still deserves a notification. So notify when
   * the page is not in the foreground, or when the event belongs to a
   * conversation the user is not currently viewing. An unresolvable session
   * ("any") stays suppressed in the foreground — we cannot tell which
   * conversation it belongs to.
   */
  const shouldNotifyFor = (session) => {
    if (!config.onlyWhenHidden) return true;
    if (!isForeground()) return true;
    if (typeof session !== "string" || session === "" || session === "any") return false;
    const current = currentSession();
    if (typeof current === "string" && current !== session) return true;
    return false;
  };

  /**
   * Construct one notification; never throws. `session` (when a real id) makes
   * clicking the notification jump to that conversation, not just focus the
   * window.
   */
  const raise = (title, body, tag, session) => {
    try {
      const notification = new Notification(title, { body, tag, icon: ICON, requireInteraction: true, renotify: true });
      notification.onclick = () => {
        try {
          // A browser raises its own window/tab when a notification is clicked.
          // An Electron shell does not: its renderer click path only dispatches
          // this event, and `window.focus()` cannot activate the native window
          // (Electron's `ActivateContents` only notifies observers) — so the
          // shell's own activation request runs first, and `window.focus()`
          // stays as the DOM hint a plain browser may still want.
          raiseDesktopWindow();
          if (typeof window !== "undefined" && typeof window.focus === "function") window.focus();
          if (typeof session === "string" && session !== "" && session !== "any") openSession(session);
        } catch { /* focus/open can fail for odd sessions */ }
        notification.close();
      };
    } catch { /* some environments reject Notification construction */ }
  };

  /**
   * Hand one notification to the host's native notifier
   * (`POST /plugins/dsh-browser-notify/api/notify`), the channel that needs no
   * browser permission and no stable origin.
   *
   * This is the fallback for an origin the browser never granted: `dsh web` in
   * the system browser stays at "default" on a fresh port until a gesture grants
   * it. A host that reports it has no notifier at all (`available: false`, e.g.
   * Windows) is remembered so the page stops asking; every other failure just
   * returns false.
   *
   * @param title - notification title.
   * @param body - notification body.
   * @param tag - grouping tag, so a re-notify replaces the previous popup.
   * @param timeoutMs - how long the desktop should keep the popup.
   * @returns whether the host delivered (or replaced) the notification.
   */
  const relay = (title, body, tag, timeoutMs) => {
    if (relayState === false || typeof fetch !== "function") return Promise.resolve(false);
    const controller = typeof AbortController === "function" ? new AbortController() : undefined;
    let timer;
    if (controller !== undefined && typeof setTimeout === "function") {
      timer = setTimeout(() => {
        try {
          controller.abort();
        } catch { /* an aborted or finished request is not an error here */ }
      }, RELAY_ABORT_MS);
    }
    const done = (value) => {
      if (timer !== undefined) clearTimeout(timer);
      return value;
    };
    const init = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, body, tag, timeoutMs }),
      cache: "no-store",
    };
    if (controller !== undefined) init.signal = controller.signal;
    return fetch(`${API}/notify`, init)
      .then((res) => {
        // No host half mounted (404) or no route (405/501): never ask again.
        if (res.status === 404 || res.status === 405 || res.status === 501) relayState = false;
        return res.ok ? res.json() : null;
      })
      .then((data) => {
        if (data && data.available === false) relayState = false;
        if (data && data.channel === "none") relayState = false;
        if (data && data.shown === true) {
          relayState = true;
          return done(true);
        }
        return done(false);
      })
      .catch(() => done(false));
  };

  /**
   * Deliver one notification. The browser channel is preferred whenever it can
   * actually show something (permission granted); otherwise — notifications
   * unsupported, permission denied, or a request that came back without a
   * grant — the host's native relay takes over, so an event never disappears
   * just because this origin never got the permission.
   */
  const show = (title, body, tag, session) => {
    if (!supported()) {
      void relay(title, body, tag, RELAY_TIMEOUT_MS);
      return;
    }
    const permission = Notification.permission;
    if (permission === "granted") {
      raise(title, body, tag, session);
      return;
    }
    if (permission === "denied") {
      void relay(title, body, tag, RELAY_TIMEOUT_MS);
      return;
    }
    // Still "default": ask (a pending gesture may prompt), then fall back.
    try {
      const asked = Notification.requestPermission();
      if (asked && typeof asked.then === "function") {
        asked.then((granted) => {
          if (granted === "granted") raise(title, body, tag, session);
          else void relay(title, body, tag, RELAY_TIMEOUT_MS);
        }).catch(() => { void relay(title, body, tag, RELAY_TIMEOUT_MS); });
        return;
      }
    } catch { /* requestPermission can throw where notifications are unsupported */ }
    void relay(title, body, tag, RELAY_TIMEOUT_MS);
  };

  /**
   * Ask for notification permission from the first real user gesture. Browsers
   * ignore (Firefox: reject) a request made while no interaction is pending, so
   * this is the only reliable moment to obtain permission. Prompts once per
   * page load; the address-bar permission icon remains available afterwards.
   * @returns a disposer removing the gesture listeners.
   */
  const armPermission = () => {
    if (!supported()) return undefined;
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") return undefined;
    if (permissionArmed) return undefined;
    permissionArmed = true;
    const onGesture = () => {
      if (!supported() || Notification.permission !== "default" || promptedThisLoad) return;
      promptedThisLoad = true;
      try {
        const asked = Notification.requestPermission();
        if (asked && typeof asked.then === "function") {
          asked.then((permission) => {
            if (permission !== "granted") return;
            // Give the browser a beat to settle the grant before confirming:
            // Chromium can drop a notification created in the same task as the
            // permission resolution.
            const confirm = () => show(COPY.enabledTitle, COPY.enabledBody, "dsh-browser-notify:enabled");
            if (typeof setTimeout === "function") setTimeout(confirm, 500);
            else confirm();
          }).catch(() => {});
        }
      } catch { /* never let a permission request break the UI */ }
    };
    const types = ["pointerdown", "keydown", "click"];
    for (const type of types) window.addEventListener(type, onGesture, { capture: true, passive: true });
    return () => {
      for (const type of types) window.removeEventListener(type, onGesture, { capture: true });
    };
  };

  const loadConfig = () => {
    if (typeof fetch !== "function") return Promise.resolve(false);
    return fetch(`${API}/config`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.config && typeof data.config === "object") {
          config = { ...DEFAULTS, ...data.config };
          return true;
        }
        return false;
      })
      .catch(() => false);
  };

  /**
   * Seed the running map from the client session list. The forwarded
   * `api-session/status` stream only carries changes, so a page that loaded (or
   * reconnected) while a round was already running would otherwise miss the
   * rising edge and stay silent at the end of that round.
   */
  const seedRunning = () => {
    const sessions = ctx.get("sessions");
    if (!sessions || !sessions.list || typeof sessions.list.getSnapshot !== "function") return;
    try {
      const snapshot = sessions.list.getSnapshot();
      const byId = snapshot && snapshot.byId;
      if (!byId || typeof byId !== "object") return;
      for (const id of Object.keys(byId)) {
        const row = byId[id];
        if (row && typeof row === "object") running.set(id, row.running === true);
      }
    } catch { /* a missing/odd snapshot must never break the plugin */ }
  };

  /**
   * Raise a notification for `kind`/`session`. Returns true when a
   * notification was raised (or a permission prompt is on its way), false when
   * suppressed by foreground/other-conversation state, the subagent switch,
   * or the quiet window.
   * @param facts - {@link sessionFacts} for `session`, when the caller has it.
   */
  const notify = (kind, session, title, body, facts) => {
    if (!shouldNotifyFor(session)) return false;
    if (facts !== undefined && facts.subagent && !config.subagents) return false;
    const now = Date.now();
    const tag = `dsh-browser-notify:${kind}:${session}`;
    const last = lastAt.get(tag) ?? 0;
    if (now - last < config.quietMs) return false;
    lastAt.set(tag, now);
    if (kind !== "roundEnd" && session !== "any") attentionAt.set(session, now);
    show(title, body, tag, session);
    return true;
  };

  /** Whether a question/approval was just notified for `session` (suppresses the roundEnd that follows it). */
  const suppressRoundEnd = (session, now) => {
    if (!session || session === "any") return false;
    const last = attentionAt.get(session) ?? 0;
    return now - last < config.quietMs;
  };

  /** Re-raise cadence and lifetime for an unanswered question while the user is away. */
  const RENOTIFY_MS = 20000;
  const PENDING_TTL_MS = 300000;
  /** session -> pending unanswered question {title, body, at, lastRaised}. */
  const pendingQuestions = new Map();

  /**
   * Track an unanswered question. Popups auto-dismiss after a few seconds and
   * Chromium ignores `requireInteraction` on Linux, so a single notification is
   * easy to miss: raise now (when the user is not viewing this conversation)
   * and re-raise every {@link RENOTIFY_MS} until the user comes back to the
   * conversation (pending entry dropped) or the question ages past
   * {@link PENDING_TTL_MS}.
   * @param facts - {@link sessionFacts} for `session`.
   */
  const trackQuestion = (session, title, body, facts) => {
    if (typeof session !== "string" || session === "" || session === "any") return;
    const now = Date.now();
    const raised = notify("question", session, title, body, facts);
    pendingQuestions.set(session, {
      title,
      body,
      at: now,
      lastRaised: raised ? now : 0,
      subagent: facts !== undefined && facts.subagent === true,
    });
  };

  /** Periodically re-raise pending questions the user has not come back to answer. */
  const scheduleRenotify = () => {
    const timer = ctx.get("timer");
    if (!timer || typeof timer.interval !== "function") return () => {};
    return timer.interval(() => {
      const now = Date.now();
      for (const [session, q] of pendingQuestions) {
        if (now - q.at > PENDING_TTL_MS || (q.subagent && !config.subagents) || !shouldNotifyFor(session)) {
          pendingQuestions.delete(session);
          continue;
        }
        if (now - q.lastRaised < RENOTIFY_MS) continue;
        q.lastRaised = now;
        show(q.title, q.body, `dsh-browser-notify:question:${session}`, session);
      }
    }, RENOTIFY_MS);
  };

  /**
   * Best-effort session identity for an event. The scoped listener `this` is
   * the routing carrier the sessions service resolves; `request.agent` is the
   * resolved client scope when the payload carries one. Both are read
   * defensively — a bad subject must never break the listener.
   */
  const sessionKeyOf = (owner, agent) => {
    try {
      const sessions = ctx.get("sessions");
      if (sessions && typeof sessions.scopeOf === "function") {
        const id = sessions.scopeOf(owner);
        if (typeof id === "string" && id !== "") return id;
      }
    } catch { /* untagged contexts are legal here */ }
    try {
      if (agent !== null && typeof agent === "object") {
        const id = agent.id ?? (agent.scope && agent.scope.id);
        if (typeof id === "string" && id !== "") return id;
      }
    } catch { /* never let an odd subject break the listener */ }
    return "any";
  };

  /** Last path segment of a filesystem path. */
  const basenameOf = (path) => {
    const s = String(path).replace(/[\\/]+$/, "");
    const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
    return i >= 0 ? s.slice(i + 1) : s;
  };

  /** One client session-list row, or undefined when the list has none / is unreadable. */
  const sessionRow = (sessionId) => {
    const sessions = ctx.get("sessions");
    if (!sessions || !sessions.list || typeof sessions.list.getSnapshot !== "function") return undefined;
    try {
      const snapshot = sessions.list.getSnapshot();
      const row = snapshot && snapshot.byId ? snapshot.byId[sessionId] : undefined;
      return row && typeof row === "object" ? row : undefined;
    } catch { /* a missing/odd snapshot must never break the plugin */ }
    return undefined;
  };

  /** Display label of one list row: durable title first, then the derived display title. */
  const titleOfRow = (row) => {
    if (row === undefined) return undefined;
    if (typeof row.title === "string" && row.title !== "") return row.title;
    if (typeof row.displayTitle === "string" && row.displayTitle !== "") return row.displayTitle;
    return undefined;
  };

  /**
   * Whether one session is a subagent child. The client list marks it
   * (`origin: "subagent"`, or a `parentId`), and a child that has not reached
   * the list yet is still resolved through the session service's subagent
   * address — the same face the workspace breadcrumb uses.
   */
  const isSubagentOf = (row, sessionId) => {
    if (row !== undefined) {
      if (row.origin === "subagent") return true;
      const parent = row.parentId ?? row.parentSessionId;
      if (parent !== undefined && parent !== null && parent !== "") return true;
    }
    try {
      const sessions = ctx.get("sessions");
      if (sessions && typeof sessions.subagentAddress === "function") {
        return sessions.subagentAddress(sessionId) !== undefined;
      }
    } catch { /* the address face is best-effort, never required */ }
    return false;
  };

  /**
   * Best-effort facts about one session for notification copy: whether it is a
   * subagent child, its project (cwd basename), its label, and — for a child —
   * its parent's label. Every read is defensive: an unlisted session yields
   * `{ subagent: false }` and copy falls back to the id.
   * @param sessionId - the session the event belongs to (`"any"` is legal).
   * @returns `{ subagent, title?, project?, parentId?, parentTitle? }`.
   */
  const sessionFacts = (sessionId) => {
    const row = sessionRow(sessionId);
    const rawParent = row === undefined ? undefined : row.parentId ?? row.parentSessionId;
    const parentId = typeof rawParent === "string" && rawParent !== "" ? rawParent : undefined;
    return {
      subagent: isSubagentOf(row, sessionId),
      title: titleOfRow(row),
      project: row !== undefined && typeof row.cwd === "string" && row.cwd !== ""
        ? basenameOf(row.cwd)
        : undefined,
      parentId,
      parentTitle: parentId === undefined ? undefined : titleOfRow(sessionRow(parentId)),
    };
  };

  /** Round-end body enriched with the project and the conversation/subagent line. */
  const roundEndBody = (sessionId, facts) => {
    const line = contextLine(facts, sessionId);
    const base = facts.subagent ? COPY.subagentRoundEndBody : COPY.roundEndBody;
    return line === "" ? base : `${base}\n${line}`;
  };

  /**
   * Track one session's running state and notify on the falling edge, labelled
   * as the main Agent or as a subagent child. A question/approval notified
   * moments ago already told the user what to do, so the roundEnd is suppressed
   * then.
   */
  const handleStatus = (sessionId, isRunning) => {
    const id = typeof sessionId === "string" ? sessionId : String(sessionId);
    const prev = running.get(id) ?? false;
    running.set(id, isRunning === true);
    if (isRunning === true || prev !== true || !config.roundEnd) return;
    if (suppressRoundEnd(id, Date.now())) return;
    const facts = sessionFacts(id);
    notify(
      "roundEnd",
      id,
      facts.subagent ? COPY.subagentRoundEndTitle : COPY.roundEndTitle,
      roundEndBody(id, facts),
      facts,
    );
  };

  return {
    getConfig: () => config,
    loadConfig,
    armPermission,
    seedRunning,
    notify,
    sessionKeyOf,
    sessionFacts,
    handleStatus,
    trackQuestion,
    scheduleRenotify,
  };
}

export function apply(ctx) {
  const remote = ctx.get("remote");
  if (remote === undefined) return;
  const notifier = createNotifier(ctx);

  // Best-effort config load; retry once shortly after boot if the host route
  // was not ready yet. Defaults keep the plugin functional meanwhile.
  const load = () => notifier.loadConfig().then((ok) => {
    if (!ok && typeof setTimeout === "function") {
      setTimeout(load, 3000);
    }
  });
  load();
  notifier.seedRunning();

  // Browsers gate the permission prompt behind a user gesture (Firefox >= 72
  // rejects a gesture-less request outright), so arm it on the first click.
  ctx.effect(() => notifier.armPermission(), "dsh-browser-notify: permission gesture");

  // Questions the user has not come back to answer get re-raised periodically.
  ctx.effect(() => notifier.scheduleRenotify(), "dsh-browser-notify: renotify questions");

  if (typeof ctx.on === "function") {
    ctx.effect(() => ctx.on("connection/reset", () => {
      load();
      notifier.seedRunning();
    }), "dsh-browser-notify: reload config on connection/reset");
  }

  // The agent asked the user a question. Waterfall: notify, then hand the
  // request to the next answerer (the question composer) unchanged.
  ctx.effect(() => remote.$on("user-questions/request", function (request, next) {
    try {
      const cfg = notifier.getConfig();
      if (cfg.question && request && Array.isArray(request.questions) && request.questions.length > 0) {
        const session = notifier.sessionKeyOf(this, request.agent);
        const facts = notifier.sessionFacts(session);
        const questions = request.questions;
        const first = questions[0] || {};
        const text = first.question || first.header || "";
        const options = Array.isArray(first.options) && first.options.length > 0
          ? first.options.map((option) => option && option.label).filter(Boolean).slice(0, 3).join(" / ")
          : "";
        const fallback = facts.subagent ? COPY.subagentQuestionFallback : COPY.questionFallback;
        let body = text ? truncate(text, 110) : fallback;
        if (options) body = `${body}\n${options}`;
        if (questions.length > 1) body = `${body} ${COPY.questionMore(questions.length)}`;
        const line = contextLine(facts, session);
        if (line !== "") body = `${body}\n${line}`;
        notifier.trackQuestion(session, facts.subagent ? COPY.subagentQuestionTitle : COPY.questionTitle, body, facts);
      }
    } catch { /* a notification failure must never break the question flow */ }
    return next();
  }), "dsh-browser-notify: user-questions");

  // A tool call needs approval. Waterfall: notify, then delegate unchanged.
  ctx.effect(() => remote.$on("approval/request", function (req, next) {
    try {
      const cfg = notifier.getConfig();
      if (cfg.approval && req && typeof req === "object") {
        const session = notifier.sessionKeyOf(this, req.agent);
        const facts = notifier.sessionFacts(session);
        const toolName = typeof req.toolName === "string" && req.toolName ? req.toolName : "工具";
        const describe = facts.subagent ? COPY.subagentApprovalBody : COPY.approvalBody;
        let body = describe(toolName);
        if (typeof req.reason === "string" && req.reason) body = `${body}：${truncate(req.reason, 90)}`;
        const line = contextLine(facts, session);
        if (line !== "") body = `${body}\n${line}`;
        notifier.notify("approval", session, facts.subagent ? COPY.subagentApprovalTitle : COPY.approvalTitle, body, facts);
      }
    } catch { /* a notification failure must never break the approval flow */ }
    return next();
  }), "dsh-browser-notify: approval");

  // An agent round ended (running -> idle): it is waiting for input.
  ctx.effect(() => remote.$on("api-session/status", (sessionId, isRunning) => {
    try {
      notifier.handleStatus(sessionId, isRunning);
    } catch { /* notification failures are non-fatal */ }
  }), "dsh-browser-notify: api-session/status");
}
