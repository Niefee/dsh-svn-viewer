/**
 * 用 react-dom/server 把插件的 App 组件渲染成静态 HTML，验证：
 * 组件树能渲染、关键结构存在、初始（未连接）状态正常。
 * 这是没有 GUI token 时能做的最强渲染验证。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { renderToStaticMarkup } from 'react-dom/server'

const require = createRequire(import.meta.url)
const React = require('react')
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

const registrations = []
const styleTags = []
const sandbox = {
  console,
  React,
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
    load({ factory }) {
      plugin = factory((name) => {
        if (name === 'react') return React
        throw new Error(`unexpected require: ${name}`)
      })
    },
  },
}
sandbox.globalThis = sandbox
vm.runInNewContext(source, sandbox, { filename: 'client.js' })
if (!plugin) throw new Error('factory did not run')

const ctx = {
  slots: {
    inject: (_key, callback) => callback(),
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
  },
  effect: (callback) => callback(),
}
plugin.apply(ctx)

const main = registrations.find((item) => item.options.name === 'main')
if (!main) throw new Error('main panel not registered')

const html = renderToStaticMarkup(React.createElement(main.component))
const checks = [
  ['renders without throwing', html.length > 500],
  ['app shell class', html.includes('class="svn-app"')],
  ['top bar', html.includes('svn-top') && html.includes('连接')],
  ['directory tree', html.includes('svn-tree') && html.includes('目录')],
  ['empty state hint', html.includes('连接一个工作副本或仓库开始浏览')],
  ['root input', html.includes('工作副本路径或 svn:// URL')],
  ['search box', html.includes('搜索文件名或内容')],
  ['styles injected', styleTags.length === 1 && styleTags[0].textContent.includes('.svn-app{')],
]
let failed = 0
for (const [label, ok] of checks) {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}`)
}
console.log(`\nrendered ${html.length} bytes; ${checks.length - failed}/${checks.length} passed`)
process.exit(failed ? 1 : 0)
