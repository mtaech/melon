/**
 * Smoke: drive the built artifacts, not the source text.
 *
 * Browser half — evaluate `lib/client.cjs`, materialize the ModuleLoader
 * factory, then run `apply()` against a fake client context and assert the two
 * slot registrations (the shadowing browsing region and the sidebar-foot
 * switch) plus a clean teardown.
 *
 * Host half — import `lib/host.js` and assert it registers the durable
 * `worksop-plus` settings namespace with a schemastery schema.
 *
 * Run with `pnpm run smoke` (which builds first).
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const ID = 'dsh-worksop-plus'

let checks = 0
let failures = 0
function check(label, condition, detail = '') {
  checks += 1
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

/* ------------------------------------------------------------------ browser half */

const clientPath = path.join(root, 'lib', 'client.cjs')
check('lib/client.cjs exists', existsSync(clientPath))
const source = readFileSync(clientPath, 'utf8')
check('bundle is a ModuleLoader registration', source.includes('__ModuleLoader__.load'))
check('bundle carries the plugin id', source.includes(ID))

let registration
globalThis.window = { __ModuleLoader__: { load: (value) => { registration = value } } }
const styles = new Map()
globalThis.document = {
  getElementById: (id) => styles.get(id) ?? null,
  createElement: () => ({ id: '', textContent: '', remove() { styles.delete(this.id) } }),
  head: { appendChild(node) { styles.set(node.id, node) } },
}
const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => { storage.set(key, value) },
  removeItem: (key) => { storage.delete(key) },
}

// eslint-disable-next-line no-eval
;(0, eval)(source)
check('registration id matches the package', registration?.id === ID, String(registration?.id))
check('factory is a function', typeof registration?.factory === 'function')

const requested = []
const ICON_SEED = '@deepseek-ai/dsh-client-ui-primitives'
const exportsOfBundle = registration.factory((specifier) => {
  requested.push(specifier)
  if (specifier === ICON_SEED) return new Proxy({}, { get: () => () => null })
  if (specifier === 'react') {
    const createElement = (type, props, ...children) => ({ type, props, children })
    return {
      createElement,
      Fragment: 'Fragment',
      useState: (initial) => [initial, () => {}],
      useRef: () => ({ current: null }),
      useMemo: (fn) => fn(),
      useEffect: () => {},
      useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    }
  }
  throw new Error(`unexpected require("${specifier}")`)
})
check(
  'requires only react and the shipped icon seed module',
  requested.every((specifier) => specifier === 'react' || specifier === ICON_SEED),
  requested.join(', '),
)
check('uses the shipped icon set', requested.includes(ICON_SEED))
check('exports the plugin name', exportsOfBundle.name === ID)
check('exports inject with slots', Array.isArray(exportsOfBundle.inject) && exportsOfBundle.inject.includes('slots'))
check('exports apply', typeof exportsOfBundle.apply === 'function')

const registrations = []
const injections = []
const scopes = []
const disposers = []
let boundScope
const scope = {
  getSnapshot: () => ({ status: 'ready', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'host' }),
  subscribe: () => () => {},
  set: async () => {},
  unset: async () => {},
}
const services = {
  slots: {
    inject: (key, callback) => { injections.push(key); const disposer = callback(); return () => { if (typeof disposer === 'function') disposer() } },
    register: (options, component) => {
      registrations.push({ options, component })
      return () => { registrations.splice(registrations.findIndex((entry) => entry.options === options), 1) }
    },
  },
  locale: { register: () => () => {}, bind: () => (key) => key },
  workspaces: { create: async () => ({ workspaceId: 'w' }), rename: async () => {}, delete: async () => {} },
  uiWorkspace: { startSession: () => {}, pickDirectory: async () => null, archiveSession: async () => {} },
  sessions: { open: () => {} },
}
const ctx = {
  effect: (callback) => { const disposer = callback(); disposers.push(disposer) },
  get: (key) => services[key],
  inject: (deps, callback) => {
    scopes.push(deps.join(','))
    boundScope = callback({ settingsScope: { bind: () => scope } })
  },
}
exportsOfBundle.apply(ctx)

const browser = registrations.find((entry) => entry.options.name === 'sidebar.workspaces')
check('registers the browsing region', browser !== undefined)
check('shadows the shipped browser (priority -1)', browser?.options.priority === -1, String(browser?.options.priority))
check('declares the locale seat', browser?.options.locale === 'worksopPlus')
check('browser component is a function', typeof browser?.component === 'function')
const browserFace = browser?.options.inject?.()
check(
  'inject face exposes the observable store',
  typeof browserFace?.store?.getSnapshot === 'function' && typeof browserFace?.store?.subscribe === 'function',
)
check(
  'inject face exposes the baked actions',
  typeof browserFace?.store?.actions?.togglePin === 'function' && typeof browserFace?.store?.actions?.setPrefs === 'function',
)
const footer = registrations.find((entry) => entry.options.name === 'sidebar.footer.action')
check('registers the sidebar-foot switch', footer !== undefined)
check('foot switch id is stable', footer?.options.id === 'worksop-plus')
check('injects into both slots', injections.includes('sidebar.workspaces') && injections.includes('sidebar.footer.action'))
check('binds the settings namespace late', scopes.includes('settingsScope'))
check('injects a style tag', styles.has(`${ID}/style`))

let teardownError
try {
  for (const disposer of disposers) if (typeof disposer === 'function') disposer()
  if (typeof boundScope === 'function') boundScope()
} catch (error) {
  teardownError = error
}
check('teardown is clean', teardownError === undefined, String(teardownError))
check('teardown removed the browsing region', registrations.every((entry) => entry.options.name !== 'sidebar.workspaces'))

/* --------------------------------------------------------------------- host half */

const hostPath = path.join(root, 'lib', 'host.js')
check('lib/host.js exists', existsSync(hostPath))
const host = await import(`file://${hostPath}`)
check('host exports the plugin name', host.name === ID)
check('host exports apply', typeof host.apply === 'function')
const registeredNamespaces = []
host.apply({
  inject: (deps, callback) => {
    if (!deps.includes('settings')) return
    callback({ settings: { register: (namespace, schema) => { registeredNamespaces.push({ namespace, schema }) } } })
  },
})
const registered = registeredNamespaces[0]
check('host registers the settings namespace', registered?.namespace === 'worksop-plus', String(registered?.namespace))
check('host registers an actual schema', typeof registered?.schema?.toJSON === 'function')
const wire = registered?.schema?.toJSON()
check('schema declares the pinned field', JSON.stringify(wire ?? {}).includes('pinned'))

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) process.exit(1)
