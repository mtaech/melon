/**
 * dsh-model-select-plus — Host half.
 *
 * A cordis plugin that exposes the real Session model catalog + selection over
 * the host webserver, so the bundled browser half can read/write it with plain
 * `fetch`. Persistent plugins avoid the dynamic-plugin `harness`/`host`
 * builtins, so this follows the `plugin-dashboard` pattern (webServer routes).
 *
 * Both handlers call the running harness's own `apiProxy.sessions` API:
 *   - GET  /plugins/dsh-model-select-plus/api/catalog?sessionId=<id>
 *     → apiProxy.sessions.models({ rpcId, payload:{ sessionId } })
 *     → { groups, failures, current, routable }
 *   - POST /plugins/dsh-model-select-plus/api/select
 *     body { sessionId, provider, model, reasoningEffort? }
 *     → apiProxy.sessions.selectModel(...) → { ok, selected } | { ok:false, message }
 *
 * `selectModel` validates via llm.resolveCallConfig, sets the session Agent's
 * live selection ref and saves the deployment default — the exact shipped path.
 *
 * @param ctx - the mounted host Cordis context.
 */
export const name = "dsh-model-select-plus";
export const inject = ["webServer"];

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

export function apply(ctx) {
  const api = () => ctx.get("apiProxy");

  const handler = async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const pathname = url.pathname;
      const proxy = api();
      if (proxy === undefined || proxy.sessions === undefined) {
        json(res, 500, { error: "apiProxy.sessions unavailable" });
        return;
      }

      if (req.method === "GET" && pathname === `${PREFIX}/catalog`) {
        const sessionId = url.searchParams.get("sessionId") ?? "";
        const r = await proxy.sessions.models({ rpcId: "mdsl-catalog", payload: { sessionId } });
        if (r.result.ok === true) {
          const v = r.result.value;
          json(res, 200, { groups: v.groups, failures: v.failures, current: v.current, routable: v.routable });
        } else {
          json(res, 200, { error: (r.result.error && r.result.error.message) || "加载模型目录失败" });
        }
        return;
      }

      if (req.method === "POST" && pathname === `${PREFIX}/select`) {
        const body = JSON.parse((await readBody(req)) || "{}");
        const r = await proxy.sessions.selectModel({
          rpcId: "mdsl-select",
          payload: {
            sessionId: body.sessionId,
            provider: body.provider,
            model: body.model,
            ...(body.reasoningEffort === undefined || body.reasoningEffort === null
              ? {}
              : { reasoningEffort: body.reasoningEffort }),
          },
        });
        if (r.result.ok === true) {
          json(res, 200, { ok: true, selected: r.result.value.selected });
        } else {
          json(res, 200, { ok: false, message: (r.result.error && r.result.error.message) || "模型不可用" });
        }
        return;
      }

      json(res, 404, { error: "not found" });
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  };

  const disposer = ctx.webServer.register({ kind: "prefix", path: PREFIX, handler });
  return () => {
    disposer();
  };
}
