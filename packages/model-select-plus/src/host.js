/**
 * dsh-model-select-plus — Host half.
 *
 * A cordis plugin that exposes the real Session model catalog + selection over
 * the host webserver, so the bundled browser half can read/write it with plain
 * `fetch`. Persistent plugins avoid the dynamic-plugin `harness`/`host`
 * builtins, so this follows the `plugin-dashboard` pattern (webServer routes).
 *
 * Both handlers call the running harness's own `sessionController` Remote
 * service (the `0.1.2` replacement for the removed `apiProxy.sessions`):
 *   - GET  /plugins/dsh-model-select-plus/api/catalog?sessionId=<id>
 *     → ctx.sessionController.modelCatalog()
 *     → { default, routableProviders, groups, failures }, then folded with the
 *       session's durable modelSelection projection to produce the client
 *       shape { groups, failures, current, routable }.
 *   - POST /plugins/dsh-model-select-plus/api/select
 *     body { sessionId, provider, model, reasoningEffort? }
 *     → ctx.sessionController.selectModel(...) → { selected } | RemoteError
 *
 * `modelCatalog()` describes every currently routable provider/model without
 * requiring a Session; `selectModel()` validates via llm.resolveCallConfig,
 * sets the session Agent's live selection ref and saves the deployment default
 * — the exact shipped path. The per-session `current`/`routable` client fields
 * are derived here from the durable `modelSelection` projection (the client
 * face of the same fold the first-party ModelDirectory reads).
 *
 * @param ctx - the mounted host Cordis context.
 */
export const name = "dsh-model-select-plus";
export const inject = ["webServer", "sessionController", "sessionProjections", "sessions"];

const PREFIX = "/plugins/dsh-model-select-plus/api";

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (d) => {
      data += d.toString("utf8");
      if (data.length > 1_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/**
 * Derive the client's per-session `current`/`routable` from the durable
 * modelSelection projection (pending → lastUsed) falling back to the catalog's
 * deployment default. Mirrors the first-party ModelDirectory fold
 * (`current = projected.next ?? catalog.default`) so the client's "current
 * model" trigger reflects the session's actual selection rather than guessing.
 * A session that is not live (cold/persisted) still reports the deployment
 * default so the trigger never shows an empty placeholder when the catalog is
 * ready.
 *
 * @param ctx - host context (sessionProjections, sessions).
 * @param sessionId - the session being previewed.
 * @param catalog - `modelCatalog()` result for this host generation.
 * @returns `{ current, routable }` where current is never null while the catalog is ready.
 */
function currentSelection(ctx, sessionId, catalog) {
  const session = ctx.sessions.get(sessionId);
  let pending;
  let lastUsed;
  if (session !== undefined) {
    const projections = ctx.sessionProjections.stateOf(session, "modelSelection");
    if (projections !== undefined) {
      pending = projections.pending;
      lastUsed = projections.lastUsed;
    }
  }
  // pending → lastUsed → deployment default (the same precedence the first-party
  // client uses for `projected.next`, falling back to catalog.default).
  const current = pending ?? lastUsed ?? catalog.default;
  const routable = (catalog.routableProviders ?? []).includes(current.provider);
  return { current: { ...current }, routable };
}

export function apply(ctx) {
  const handler = async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const pathname = url.pathname;

      if (req.method === "GET" && pathname === `${PREFIX}/catalog`) {
        const sessionId = url.searchParams.get("sessionId") ?? "";
        const catalog = await ctx.sessionController.modelCatalog();
        const current = currentSelection(ctx, sessionId, catalog);
        json(res, 200, {
          groups: catalog.groups,
          failures: catalog.failures,
          current: current.current,
          routable: current.routable,
          default: catalog.default,
          routableProviders: catalog.routableProviders,
        });
        return;
      }

      if (req.method === "POST" && pathname === `${PREFIX}/select`) {
        const body = JSON.parse((await readBody(req)) || "{}");
        const value = await ctx.sessionController.selectModel({
          sessionId: body.sessionId,
          provider: body.provider,
          model: body.model,
          ...(body.reasoningEffort === undefined || body.reasoningEffort === null
            ? {}
            : { reasoningEffort: body.reasoningEffort }),
        });
        json(res, 200, { ok: true, selected: value.selected });
        return;
      }

      json(res, 404, { error: "not found" });
    } catch (error) {
      // selectModel throws a RemoteError on failure (e.g. model-unavailable);
      // report it as a soft 200 `{ ok:false, message }` so the client renders
      // the in-menu error instead of a hard network failure.
      const remote = error && typeof error === "object" ? error : undefined;
      const code = remote && remote.code ? remote.code : undefined;
      const message = remote && remote.message
        ? remote.message
        : (error instanceof Error ? error.message : String(error));
      json(res, 200, { ok: false, message, code });
    }
  };

  const disposer = ctx.webServer.register({ kind: "prefix", path: PREFIX, handler });
  return () => {
    disposer();
  };
}
