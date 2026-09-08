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
 * Permission is the subtle part: browsers gate the notification permission
 * prompt behind a real user gesture (Firefox >= 72 rejects a gesture-less
 * `Notification.requestPermission()` outright and leaves the permission at
 * "default"). Asking only when a notification is due therefore never grants
 * permission, so the plugin arms a one-shot request on the first interaction.
 */

export const name = "dsh-browser-notify";
export const inject = ["remote"];

const API = "/plugins/dsh-browser-notify/api";
const ICON = "/favicon.svg";

const DEFAULTS = {
  question: true,
  approval: true,
  roundEnd: true,
  onlyWhenHidden: true,
  quietMs: 15000,
};

/** Notification copy (zh, matching the product's surface language). */
const COPY = {
  questionTitle: "DeepSeek Harness · Agent 提问",
  questionFallback: "Agent 需要你回答一个问题",
  questionMore: (n) => `（共 ${n} 题）`,
  approvalTitle: "DeepSeek Harness · 需要授权",
  approvalBody: (toolName) => `Agent 请求执行 ${toolName}`,
  roundEndTitle: "DeepSeek Harness · Agent 已结束回合",
  roundEndBody: "回合已完成，等待你的输入",
  enabledTitle: "DeepSeek Harness · 通知已开启",
  enabledBody: "回合结束、提问或授权时会在这里提醒你",
};

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
    const sessions = ctx.get("sessions");
    if (!sessions || !sessions.list || typeof sessions.list.getSnapshot !== "function") return undefined;
    try {
      const snapshot = sessions.list.getSnapshot();
      return snapshot && snapshot.current;
    } catch { /* a missing/odd snapshot must never break the plugin */ }
    return undefined;
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
          if (typeof window !== "undefined" && typeof window.focus === "function") window.focus();
          if (typeof session === "string" && session !== "" && session !== "any") {
            const sessions = ctx.get("sessions");
            if (sessions && typeof sessions.open === "function") sessions.open(session);
          }
        } catch { /* focus/open can fail for odd sessions */ }
        notification.close();
      };
    } catch { /* some environments reject Notification construction */ }
  };

  /**
   * Raise one notification if permission allows. When permission is still
   * "default" the gesture-less request is attempted anyway (Chrome may prompt);
   * browsers that reject it fall back to {@link armPermission}.
   */
  const show = (title, body, tag, session) => {
    if (!supported()) return;
    if (Notification.permission === "denied") return;
    if (Notification.permission === "granted") {
      raise(title, body, tag, session);
      return;
    }
    try {
      const asked = Notification.requestPermission();
      if (asked && typeof asked.then === "function") {
        asked.then((permission) => {
          if (permission === "granted") raise(title, body, tag, session);
        }).catch(() => {});
      }
    } catch { /* requestPermission can throw where notifications are unsupported */ }
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
   * suppressed by foreground/other-conversation state, permission, or the
   * quiet window.
   */
  const notify = (kind, session, title, body) => {
    if (!shouldNotifyFor(session)) return false;
    if (!supported()) return false;
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
   */
  const trackQuestion = (session, title, body) => {
    if (typeof session !== "string" || session === "" || session === "any") return;
    const now = Date.now();
    const raised = notify("question", session, title, body);
    pendingQuestions.set(session, { title, body, at: now, lastRaised: raised ? now : 0 });
  };

  /** Periodically re-raise pending questions the user has not come back to answer. */
  const scheduleRenotify = () => {
    const timer = ctx.get("timer");
    if (!timer || typeof timer.interval !== "function") return () => {};
    return timer.interval(() => {
      const now = Date.now();
      for (const [session, q] of pendingQuestions) {
        if (now - q.at > PENDING_TTL_MS || !shouldNotifyFor(session)) {
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

  /**
   * Best-effort project + session label for a session, read from the client
   * session list (`cwd` → project basename, `displayTitle`/`title` → session
   * title). Returns null when the session is not listed or unreadable.
   */
  const sessionLabel = (sessionId) => {
    const sessions = ctx.get("sessions");
    if (!sessions || !sessions.list || typeof sessions.list.getSnapshot !== "function") return null;
    try {
      const snapshot = sessions.list.getSnapshot();
      const row = snapshot && snapshot.byId ? snapshot.byId[sessionId] : undefined;
      if (!row || typeof row !== "object") return null;
      const project = typeof row.cwd === "string" && row.cwd !== "" ? basenameOf(row.cwd) : undefined;
      const title = typeof row.displayTitle === "string" && row.displayTitle !== ""
        ? row.displayTitle
        : typeof row.title === "string" && row.title !== "" ? row.title : undefined;
      return { project, title };
    } catch { /* a missing/odd snapshot must never break the plugin */ }
    return null;
  };

  /** Round-end body enriched with the project and conversation label. */
  const roundEndBody = (sessionId) => {
    const label = sessionLabel(sessionId);
    let body = COPY.roundEndBody;
    if (label) {
      const parts = [];
      if (label.project) parts.push(`项目：${label.project}`);
      if (label.title) parts.push(`会话：${label.title}`);
      else parts.push(`会话：${String(sessionId).slice(0, 8)}`);
      if (parts.length > 0) body = `${body}\n${parts.join(" · ")}`;
    }
    return body;
  };

  /**
   * Track one session's running state and notify on the falling edge. A
   * question/approval notified moments ago already told the user what to do,
   * so the roundEnd is suppressed then.
   */
  const handleStatus = (sessionId, isRunning) => {
    const id = typeof sessionId === "string" ? sessionId : String(sessionId);
    const prev = running.get(id) ?? false;
    running.set(id, isRunning === true);
    const cfg = config;
    if (cfg.roundEnd && prev === true && isRunning === false && !suppressRoundEnd(id, Date.now())) {
      notify("roundEnd", id, COPY.roundEndTitle, roundEndBody(id));
    }
  };

  return {
    getConfig: () => config,
    loadConfig,
    armPermission,
    seedRunning,
    notify,
    sessionKeyOf,
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
        const questions = request.questions;
        const first = questions[0] || {};
        const text = first.question || first.header || "";
        const options = Array.isArray(first.options) && first.options.length > 0
          ? first.options.map((option) => option && option.label).filter(Boolean).slice(0, 3).join(" / ")
          : "";
        let body = text ? truncate(text, 110) : COPY.questionFallback;
        if (options) body = `${body}\n${options}`;
        if (questions.length > 1) body = `${body} ${COPY.questionMore(questions.length)}`;
        notifier.trackQuestion(session, COPY.questionTitle, body);
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
        const toolName = typeof req.toolName === "string" && req.toolName ? req.toolName : "工具";
        let body = COPY.approvalBody(toolName);
        if (typeof req.reason === "string" && req.reason) body = `${body}：${truncate(req.reason, 90)}`;
        notifier.notify("approval", session, COPY.approvalTitle, body);
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
