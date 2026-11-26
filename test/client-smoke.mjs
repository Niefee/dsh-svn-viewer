import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

const registrations = []
const styleTags = []
const react = {
  createElement: (...args) => ({ args }),
  Fragment: 'fragment',
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useRef: (initial) => ({ current: initial }),
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
}

const sandbox = {
  console,
  URLSearchParams,
  setTimeout,
  clearTimeout,
  localStorage: { getItem: () => null, setItem: () => {} },
  fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, entries: [] }) }),
  document: {
    createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
    head: { appendChild: (node) => styleTags.push(node) },
  },
}
let plugin = null
sandbox.window = {
  addEventListener() {},
  removeEventListener() {},
  __ModuleLoader__: {
    load({ id, factory }) {
      plugin = factory((name) => {
        if (name === 'react') return react
        throw new Error(`unexpected require: ${name}`)
      })
      plugin.__id = id
    },
  },
}
sandbox.globalThis = sandbox

vm.runInNewContext(source, sandbox, { filename: 'client.js' })

if (!plugin) throw new Error('factory did not run')
const ctx = {
  slots: {
    inject: (key, callback) => callback(),
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
  },
  effect: (callback) => callback(),
}
plugin.apply(ctx)

const sidebar = registrations.find((item) => item.options.name === 'sidebar.panellist')
const main = registrations.find((item) => item.options.name === 'main')
const checks = [
  ['module id', plugin.__id === '@local/dsh-svn-viewer'],
  ['inject slots', JSON.stringify(plugin.inject) === '["slots"]'],
  ['sidebar id', sidebar?.options.id === 'dsh-svn-viewer'],
  ['sidebar label', typeof sidebar?.options.label === 'function' && sidebar.options.label() === 'SVN'],
  ['sidebar component', typeof sidebar?.component === 'function'],
  ['main key', main?.options.key === 'dsh-svn-viewer'],
  ['main component', typeof main?.component === 'function'],
  ['style injected', styleTags.length === 1 && styleTags[0].textContent.length > 2000],
  ['style tagged', styleTags[0]?.dataset?.dshPlugin === 'dsh-svn-viewer'],
]
let failed = 0
for (const [label, ok] of checks) {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}`)
}
console.log(`${checks.length - failed}/${checks.length} passed`)
process.exit(failed ? 1 : 0)

