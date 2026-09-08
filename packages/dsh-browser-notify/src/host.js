/**
 * dsh-browser-notify — Host half.
 *
 * A deliberately small cordis plugin: it declares the notification behaviour
 * as a schemastery `Config` (resolved with schema defaults, overridable from
 * the profile's cordis.patch.yml `config` block) and exposes the resolved
 * config to the browser half over the host webserver at
 * `GET /plugins/dsh-browser-notify/api/config`.
 *
 * All the real work lives in the client half (lib/client.cjs): subscribing to
 * the Remote event stream (`user-questions/request`, `approval/request`,
 * `api-session/status`) and raising browser notifications. The host only
 * answers one tiny JSON route, following the same webserver+fetch transport
 * the other persistent melon plugins (`plugin-dashboard`,
 * `model-select-plus`) use — no dynamic-plugin `harness`/host builtins.
 *
 * @param ctx - the mounted host Cordis context.
 * @param config - the resolved plugin config (schema defaults + patch overrides).
 */
import z from "@deepseek-ai/schemastery";

export const name = "dsh-browser-notify";
export const inject = ["webServer"];

/** Fallback defaults, mirrored by the client so it stays functional if the route is unreachable. */
const DEFAULTS = {
  question: true,
  approval: true,
  roundEnd: true,
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
  /** Only raise notifications while the GUI tab is not the visible tab. */
  onlyWhenHidden: z.boolean().default(true),
  /** Quiet window (ms) between notifications of the same kind/session, to avoid spam. */
  quietMs: z.natural().min(0).default(15000),
});

const ROUTE_PREFIX = "/plugins/dsh-browser-notify/api";

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function apply(ctx, config) {
  const resolved = { ...DEFAULTS, ...(config ?? {}) };
  const handler = async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/config`) {
        json(res, 200, { config: resolved });
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
