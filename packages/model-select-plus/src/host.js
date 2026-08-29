/**
 * model-select-plus — Host half.
 *
 * Registers two package-private Client→Host JSON-RPC handlers. Both reuse the
 * RUNNING harness's own model directory instead of re-deriving data. The
 * `sessionController` service key is not exposed to a dynamic plugin's Host
 * context, and the newer `session/modelCatalog` typert endpoint does not exist
 * in this built harness (it uses the apiproxy `session.models` RPC). So the
 * handlers call the reachable `ctx.apiProxy.sessions` API directly:
 *   - `mdsl.catalog`: `apiProxy.sessions.models({ sessionId })` → provider-
 *     grouped models, provider failures, and the effective current selection
 *     (`{ current, routable, groups, failures }`).
 *   - `mdsl.select`: `apiProxy.sessions.selectModel({ sessionId, provider,
 *     model, reasoningEffort? })` → validates via llm.resolveCallConfig,
 *     sets the Agent's live selection ref, then saves the deployment default.
 *
 * The Client half calls these via `host.call('mdsl.catalog'|'mdsl.select', …)`.
 *
 * @param ctx - the mounted host Cordis context.
 */
export function apply(ctx) {
  const proxy = () => ctx.get('apiProxy')

  // Catalog + current selection for one session.
  ctx.effect(() => harness.handle('mdsl.catalog', async (args) => {
    const p = proxy()
    if (p === undefined || (p.sessions === undefined || p.sessions.models === undefined)) {
      return { error: 'apiProxy.sessions service unavailable' }
    }
    try {
      const sessionId = args === undefined ? undefined : args.sessionId
      const res = await p.sessions.models({ rpcId: 'mdsl-catalog', payload: { sessionId } })
      if (res.result.ok === true) {
        const v = res.result.value
        return { groups: v.groups, failures: v.failures, current: v.current, routable: v.routable }
      }
      return { error: (res.result.error && res.result.error.message) || '加载模型目录失败' }
    } catch (error) {
      return { error: String((error && error.message) || error) }
    }
  }))

  // Validate and persist one selection.
  ctx.effect(() => harness.handle('mdsl.select', async (args) => {
    const p = proxy()
    if (p === undefined || (p.sessions === undefined || p.sessions.selectModel === undefined)) {
      return { ok: false, message: 'apiProxy.sessions service unavailable' }
    }
    try {
      const res = await p.sessions.selectModel({
        rpcId: 'mdsl-select',
        payload: {
          sessionId: args.sessionId,
          provider: args.provider,
          model: args.model,
          ...(args.reasoningEffort === undefined ? {} : { reasoningEffort: args.reasoningEffort }),
        },
      })
      if (res.result.ok === true) return { ok: true, selected: res.result.value.selected }
      return { ok: false, message: (res.result.error && res.result.error.message) || '模型不可用' }
    } catch (error) {
      return { ok: false, message: String((error && error.message) || error) }
    }
  }))
}
