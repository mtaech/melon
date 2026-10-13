/**
 * dsh-browser-notify — Host half.
 *
 * A deliberately small cordis plugin with two jobs:
 *
 *   1. declare the notification behaviour as a schemastery `Config` (resolved
 *      with schema defaults, overridable from the profile's cordis.patch.yml
 *      `config` block) and expose the resolved config to the browser half at
 *      `GET /plugins/dsh-browser-notify/api/config`.
 *   2. relay a notification to the desktop's own notifier at
 *      `POST /plugins/dsh-browser-notify/api/notify` — the fallback channel for
 *      the case the browser cannot deliver one at all.
 *
 * Why a native relay exists: the Web Notification permission is per ORIGIN, and
 * an origin includes the port. A desktop shell that spawns `dsh web --port 0`
 * (WhaleNest/dsh-desktop picks a free port unless the user locks one) therefore
 * lands on a fresh origin whenever the port drifts, the permission resets to
 * "default", and every notification the browser half raises is silently
 * dropped. The host runs on the same machine, so it can hand the message to the
 * desktop's notification service directly — no permission, no origin.
 *
 * The host never decides *whether* to notify: the browser half owns that
 * (foreground/conversation/quiet-window state lives there) and only calls here
 * when the browser channel is unavailable. Every response carries `available`
 * — whether this platform has a notifier at all — so the browser half can stop
 * asking on a host that could never show the message.
 *
 * @param ctx - the mounted host Cordis context.
 * @param config - the resolved plugin config (schema defaults + patch overrides).
 */
import { spawn } from "node:child_process";
import z from "@deepseek-ai/schemastery";

export const name = "dsh-browser-notify";
export const inject = ["webServer"];

/** Fallback defaults, mirrored by the client so it stays functional if the route is unreachable. */
const DEFAULTS = {
  question: true,
  approval: true,
  roundEnd: true,
  subagents: true,
  onlyWhenHidden: true,
  quietMs: 15000,
};

/** Notification behaviour, resolved with schema defaults and overridable per profile. */
export const Config = z.object({
  /** Notify when the agent asks the user a question (`ask_user_question`). */
  question: z.boolean().default(true),
  /** Notify when a tool call needs user approval. */
  approval: z.boolean().default(true),
  /** Notify when an agent round ends and it is waiting for input. */
  roundEnd: z.boolean().default(true),
  /**
   * Also notify for subagent children (a teammate, a delegated `subagent`
   * call). On by default: the notification names the subagent and its parent
   * conversation, so it is never mistaken for the main Agent. Turn it off to
   * hear only the main conversation.
   */
  subagents: z.boolean().default(true),
  /** Only raise notifications while the GUI tab is not the visible tab. */
  onlyWhenHidden: z.boolean().default(true),
  /** Quiet window (ms) between notifications of the same kind/session, to avoid spam. */
  quietMs: z.natural().min(0).default(15000),
});

const ROUTE_PREFIX = "/plugins/dsh-browser-notify/api";
const APP_NAME = "DeepSeek Harness";
/** Same tag inside this window came from another tab (or a burst): show it once. */
const DEDUPE_MS = 1500;
/** A notifier that has not answered by then is dead; the request must not hang. */
const NOTIFIER_TIMEOUT_MS = 3000;
const MAX_TITLE = 140;
const MAX_BODY = 800;
const MAX_PAYLOAD = 16 * 1024;
const MAX_TRACKED_TAGS = 64;
const DEFAULT_TIMEOUT_MS = 6000;

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** One notification line's copy: no control characters, no unbounded length. */
function clip(value, max) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text.length <= max ? text : text.slice(0, Math.max(0, max - 1)) + "…";
}

/**
 * Pure command plan for one native notification, or null on a platform without
 * a supported notifier (the browser half then falls back to its in-page alert).
 *
 * Linux goes through `gdbus`: it ships with glib and is present on KDE/GNOME
 * even where the `notify-send` CLI is not. `@as []` / `@a{sv} {}` are explicit
 * GVariant types because an empty literal cannot be inferred.
 *
 * Exported for the smoke test: pinning the argv is the part worth testing, and
 * a test that actually spawns would pop real notifications.
 *
 * @param platform - `process.platform` value.
 * @param message - `{ title, body, timeoutMs }`.
 * @param replacesId - id of the same tag's previous popup, so a re-notify replaces it.
 * @returns `{ command, args }` or null.
 */
export function nativePlan(platform, message, replacesId = 0) {
  const { title, body, timeoutMs } = message;
  if (platform === "linux") {
    return {
      command: "gdbus",
      args: [
        "call", "--session",
        "--dest", "org.freedesktop.Notifications",
        "--object-path", "/org/freedesktop/Notifications",
        "--method", "org.freedesktop.Notifications.Notify",
        APP_NAME,
        String(replacesId),
        "",
        title,
        body,
        "@as []",
        "@a{sv} {}",
        String(timeoutMs),
      ],
    };
  }
  if (platform === "darwin") {
    return {
      command: "osascript",
      args: ["-e", `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`],
    };
  }
  return null;
}

/** libnotify CLI, for a Linux desktop that has it but not glib's `gdbus`. */
function legacyPlan(message) {
  return {
    command: "notify-send",
    args: ["-a", APP_NAME, "-t", String(message.timeoutMs), message.title, message.body],
  };
}

/** Spawn a notifier and resolve its stdout, or null when it is missing / fails / stalls. */
function run(command, args) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve(null);
      return;
    }
    let out = "";
    let settled = false;
    let timer = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      resolve(value);
    };
    timer = setTimeout(() => {
      try {
        child.kill();
      } catch { /* already gone */ }
      finish(null);
    }, NOTIFIER_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
    });
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code === 0 ? out : null));
  });
}

/**
 * Hand one notification to the desktop.
 * @param message - `{ title, body, timeoutMs }`.
 * @param replacesId - previous popup id for the same tag (0 = new popup).
 * @returns `{ shown, id, channel }`; `available` is added by {@link notify} — it
 *   tells the browser half whether this host can notify at all, so it can stop
 *   asking instead of retrying a channel that will never work.
 */
async function showNative(message, replacesId) {
  const plan = nativePlan(process.platform, message, replacesId);
  if (plan === null) return { shown: false, id: null, channel: "none" };
  const out = await run(plan.command, plan.args);
  if (out !== null) {
    // `(uint32 13,)` — keep the id so the next same-tag notify replaces this popup.
    const id = /uint32 (\d+)/.exec(out);
    return { shown: true, id: id === null ? null : Number(id[1]), channel: plan.command };
  }
  if (process.platform !== "linux") return { shown: false, id: null, channel: plan.command };
  const legacy = legacyPlan(message);
  const legacyOut = await run(legacy.command, legacy.args);
  return { shown: legacyOut !== null, id: null, channel: legacy.command };
}

/** Read a small JSON request body (Node's IncomingMessage is async iterable). */
async function readBody(req) {
  if (typeof req[Symbol.asyncIterator] !== "function") return "";
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buffer.byteLength;
    if (size > MAX_PAYLOAD) throw new Error("payload too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function apply(ctx, config) {
  const resolved = { ...DEFAULTS, ...(config ?? {}) };
  /**
   * Whether this platform has a notifier at all. Reported on every response so
   * the browser half can disable its fallback instead of POSTing forever on a
   * host that can never show anything (Windows, a headless CI box).
   */
  const nativeAvailable = nativePlan(process.platform, { title: "", body: "", timeoutMs: 0 }, 0) !== null;
  /** tag -> { at, id }: absorbs bursts from several tabs and replaces the previous popup. */
  const recent = new Map();

  const notify = async (payload) => {
    const title = clip(payload.title, MAX_TITLE);
    const body = clip(payload.body, MAX_BODY);
    if (title === "" && body === "") return { shown: false, available: nativeAvailable, channel: "empty" };
    const tag = clip(payload.tag, 200);
    const now = Date.now();
    const previous = tag === "" ? undefined : recent.get(tag);
    if (previous !== undefined && now - previous.at < DEDUPE_MS) {
      return { shown: true, available: nativeAvailable, channel: "dedupe" };
    }
    const timeoutMs = Number.isFinite(payload.timeoutMs)
      ? Math.max(0, Math.min(60000, Math.round(payload.timeoutMs)))
      : DEFAULT_TIMEOUT_MS;
    const result = await showNative({ title, body, timeoutMs }, previous === undefined ? 0 : previous.id ?? 0);
    if (tag !== "") {
      recent.set(tag, { at: now, id: result.id });
      if (recent.size > MAX_TRACKED_TAGS) {
        for (const key of recent.keys()) {
          recent.delete(key);
          break;
        }
      }
    }
    return { shown: result.shown, available: nativeAvailable, channel: result.channel };
  };

  const handler = async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/config`) {
        json(res, 200, { config: resolved });
        return;
      }
      if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/notify`) {
        let payload = null;
        try {
          const raw = await readBody(req);
          payload = raw === "" ? {} : JSON.parse(raw);
        } catch {
          json(res, 400, { error: "invalid json" });
          return;
        }
        if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
          json(res, 400, { error: "invalid payload" });
          return;
        }
        json(res, 200, await notify(payload));
        return;
      }
      json(res, 404, { error: "not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      json(res, 500, { error: message });
    }
  };

  const disposer = ctx.webServer.register({ kind: "prefix", path: ROUTE_PREFIX, handler });
  return () => {
    disposer();
  };
}
