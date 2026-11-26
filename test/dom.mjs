/**
 * DOM 集成测试：jsdom + react-dom/client 真渲染插件面板，模拟 /dsh-svn/* 的响应，
 * 走通「连接 → 目录树 → 文件列表 → 打开文件 → 预览 → 历史」的完整前端链路。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'

const require = createRequire(import.meta.url)
const React = require('react')
const { createRoot } = require('react-dom/client')

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="host"></div></body></html>', {
  url: 'http://127.0.0.1:3080/',
  pretendToBeVisual: true,
})
const { window } = dom
globalThis.window = window
globalThis.document = window.document
globalThis.localStorage = window.localStorage
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ROOT = 'svn://example.test/demo'
const listing = {
  '': [
    { name: 'docs', kind: 'dir', size: 0, rev: 3, author: 'alice', date: '2026-01-02T03:04:05Z' },
    { name: 'README.md', kind: 'file', size: 42, rev: 3, author: 'alice', date: '2026-01-02T03:04:05Z' },
    { name: 'app.js', kind: 'file', size: 128, rev: 2, author: 'bob', date: '2026-01-01T00:00:00Z', status: 'modified' },
  ],
  docs: [
    { name: '设计说明.md', kind: 'file', size: 20, rev: 3, author: 'alice', date: '2026-01-02T03:04:05Z' },
    { name: 'logo.png', kind: 'file', size: 70, rev: 3, author: 'alice', date: '2026-01-02T03:04:05Z' },
    { name: 'spec.pdf', kind: 'file', size: 1024, rev: 3, author: 'alice', date: '2026-01-02T03:04:05Z' },
    { name: '汇报.pptx', kind: 'file', size: 2048, rev: 3, author: 'alice', date: '2026-01-02T03:04:05Z' },
    { name: '坏.pptx', kind: 'file', size: 2048, rev: 3, author: 'alice', date: '2026-01-02T03:04:05Z' },
    { name: '演示.mp4', kind: 'file', size: 48 * 1024 * 1024, rev: 3, author: 'alice', date: '2026-01-02T03:04:05Z' },
    { name: '超大.mp4', kind: 'file', size: 200 * 1024 * 1024, rev: 3, author: 'alice', date: '2026-01-02T03:04:05Z' },
    { name: 'big.docx', kind: 'file', size: 120 * 1024 * 1024, rev: 3, author: 'alice', date: '2026-01-02T03:04:05Z' },
    { name: 'err.docx', kind: 'file', size: 10, rev: 3, author: 'alice', date: '2026-01-02T03:04:05Z' },
    { name: 'big.log', kind: 'file', size: 46 * 1024 * 1024, rev: 3, author: 'alice', date: '2026-01-02T03:04:05Z' },
    { name: '停线预警统计.xlsx', kind: 'file', size: 900, rev: 3, author: 'alice', date: '2026-01-02T03:04:05Z' },
    { name: '培训视频.mp4', kind: 'file', size: 5 * 1024 * 1024, rev: 7, author: 'bob', date: '2026-02-03T04:05:06Z' },
  ],
}
const files = {
  'README.md': { view: 'text', language: 'markdown', encoding: 'utf-8', size: 42, content: '# 示例仓库\n\n停线预警说明。', path: 'README.md', name: 'README.md' },
  'docs/logo.png': { view: 'image', size: 70, path: 'docs/logo.png', name: 'logo.png' },
  'docs/spec.pdf': { view: 'pdf', size: 1024, path: 'docs/spec.pdf', name: 'spec.pdf' },
  'docs/汇报.pptx': { view: 'pptx', size: 2048, path: 'docs/汇报.pptx', name: '汇报.pptx', content: '--- 第 1 页 ---\n停线预警方案\n--- 第 2 页 ---\n验收标准' },
  'docs/坏.pptx': { view: 'pptx', size: 2048, path: 'docs/坏.pptx', name: '坏.pptx', content: '--- 第 1 页 ---\n停线预警方案' },
  'docs/演示.mp4': { view: 'video', size: 48 * 1024 * 1024, path: 'docs/演示.mp4', name: '演示.mp4' },
  'docs/超大.mp4': { view: 'video', size: 200 * 1024 * 1024, path: 'docs/超大.mp4', name: '超大.mp4' },
  'docs/big.docx': { view: 'docx', size: 120 * 1024 * 1024, path: 'docs/big.docx', name: 'big.docx' },
  'docs/err.docx': { view: 'docx', size: 10, path: 'docs/err.docx', name: 'err.docx' },
  'docs/big.log': { view: 'text', content: 'line1\nline2', size: 46 * 1024 * 1024, path: 'docs/big.log', name: 'big.log', encoding: 'utf-8' },
  'ghost/文件.txt': { view: 'text', content: 'x', size: 10, path: 'ghost/文件.txt', name: '文件.txt', encoding: 'utf-8' },
  'docs/培训视频.mp4': { view: 'video', size: 5 * 1024 * 1024, path: 'docs/培训视频.mp4', name: '培训视频.mp4' },
  'docs/停线预警统计.xlsx': { view: 'spreadsheet', size: 900, path: 'docs/停线预警统计.xlsx', name: '停线预警统计.xlsx' },
}
window.__rawOk = false
window.__diffFail = false
const calls = []
function respond(url) {
  const parsed = new URL(url, 'http://127.0.0.1:3080')
  calls.push(parsed.pathname + parsed.search)
  const path = parsed.searchParams.get('path') ?? ''
  if (parsed.pathname === '/dsh-svn/info') {
    return { ok: true, root: ROOT, kind: 'url', info: { url: ROOT, revision: 3, lastAuthor: 'alice', lastDate: '2026-01-02T03:04:05Z' } }
  }
  if (parsed.pathname === '/dsh-svn/list') {
    return { ok: true, root: ROOT, kind: 'url', rev: null, path, entries: listing[path] ?? [] }
  }
  if (parsed.pathname === '/dsh-svn/file') {
    return { ok: true, ...(files[path] ?? { view: 'text', content: '', size: 0, path, name: path.split('/').pop() }) }
  }
  if (parsed.pathname === '/dsh-svn/log') {
    return { ok: true, path, entries: [{ rev: 3, author: 'alice', date: '2026-01-02T03:04:05Z', message: '更新说明', paths: [] }] }
  }
  if (parsed.pathname === '/dsh-svn/diff') {
    if (window.__diffFail) return { ok: false, error: 'diff-failed' }
    if (window.__diffEmpty) return { ok: true, path, rev: 3, lines: [{ kind: 'file', text: 'Index: 旧宿主乱码.txt' }, { kind: 'file', text: '===================================================================' }, { kind: 'ctx', text: '' }], stat: { add: 0, del: 0 } }
    if (/\.(mp4|png|pdf|pptx|docx|xlsx|zip)$/i.test(path)) return { ok: true, path, binary: true, rev: 3, lines: [], stat: { add: 0, del: 0 } }
    return { ok: true, path, rev: 3, lines: [{ kind: 'add', text: '停线预警' }, { kind: 'del', text: '旧说明' }], stat: { add: 1, del: 1 } }
  }
  if (parsed.pathname === '/dsh-svn/context') {
    return { ok: true, cwd: 'D:\\code', repos: [{ path: 'D:\\code\\svn2doc', url: 'svn://example.test/demo', rev: 3 }] }
  }
  if (parsed.pathname === '/dsh-svn/search') {
    const searchValue = parsed.searchParams.get('q') ?? ''
    if (parsed.searchParams.get('cancel') === '1') return { ok: true, cancelled: false }
    if (searchValue === '分页') {
      const files = Array.from({ length: 130 }, (_, index) => ({
        path: `docs/分页样例-${String(index + 1).padStart(3, '0')}.txt`,
        name: `分页样例-${String(index + 1).padStart(3, '0')}.txt`,
        kind: 'file', size: (index + 1) * 1024, rev: 3, author: 'alice', date: '2026-01-02T03:04:05Z', count: 1,
      }))
      return { ok: true, mode: 'name', query: searchValue, total: 130, files, scanned: 130, truncated: false, scope: null }
    }
    if (searchValue === '无元') {
      return { ok: true, mode: 'name', query: searchValue, total: 1, indexed: true, indexedEntries: 1, scanned: 1, scope: null, files: [{ path: 'ghost/文件.txt', name: '文件.txt', kind: 'file', size: 10, rev: null, author: null, date: null, count: 1 }] }
    }
    if (searchValue === '视频') {
      if (!window.__indexReady) {
        window.__indexReady = 1
        return { ok: true, mode: 'name', query: searchValue, total: 0, files: [], indexing: true, scanned: 1234, scope: null }
      }
      return {
        ok: true, mode: 'name', query: searchValue, total: 2, indexed: true, scanned: 15, indexedEntries: 2, elapsedMs: 12, scope: null, truncated: false,
        files: [
          { path: 'docs/培训视频', name: '培训视频', kind: 'dir', size: 0, rev: null, author: null, date: null, count: 1, indexed: true },
          { path: 'docs/培训视频.mp4', name: '培训视频.mp4', kind: 'file', size: 0, rev: null, author: null, date: null, count: 1, indexed: true },
        ],
      }
    }
    // 模拟旧宿主：名称搜索只回文件，目录要靠 /tree 兜底
    return {
      ok: true, mode: 'name', query: 'docs', total: 1, truncated: false, scope: null,
      files: [{ path: 'README.md', name: 'README.md', kind: 'file', size: 42, rev: 3, author: 'alice', date: '2026-01-02T03:04:05Z', count: 1 }],
    }
  }
  if (parsed.pathname === '/dsh-svn/fs') {
    const fsPath = parsed.searchParams.get('path') ?? ''
    if (!fsPath) {
      return { ok: true, path: '', parent: null, mode: 'drives', entries: [{ name: 'D:', path: 'D:\\' }] }
    }
    if (fsPath === 'D:\\') return { ok: true, path: 'D:\\', parent: null, mode: 'dirs', entries: [{ name: 'work', path: 'D:\\work' }, { name: 'temp', path: 'D:\\temp' }] }
    return { ok: true, path: 'D:\\work', parent: 'D:\\', mode: 'dirs', entries: [{ name: 'demo-wc', path: 'D:\\work\\demo-wc' }] }
  }
  if (parsed.pathname === '/dsh-svn/tree') {
    const treePath = parsed.searchParams.get('path') ?? ''
    return { ok: true, root: ROOT, count: 5, truncated: false, entries: listing[treePath] ?? [] }
  }
  if (parsed.pathname === '/dsh-svn/raw') {
    if (path.includes('err.docx') && !window.__rawOk) return { ok: false, error: 'boom' }
    return { ok: true, raw: true }
  }
  if (parsed.pathname === '/dsh-svn/stream') {
    return { ok: true, raw: true }
  }
  return { ok: false, error: 'not-found' }
}

globalThis.fetch = async (input) => {
  const url = String(input)
  // 大文本的 /file 在服务端读取慢：延迟响应以观察不确定进度卡
  if (url.includes('/dsh-svn/file') && url.includes('docs%2Fbig.log')) await new Promise((resolve) => setTimeout(resolve, 250))
  // 0.3.18：慢 diff，观察加载态骨架
  if (url.includes('/dsh-svn/diff') && window.__diffSlow) await new Promise((resolve) => setTimeout(resolve, 300))
  const payload = respond(url)
  if (url.includes('/dsh-svn/export') && window.__exportFail) {
    return { ok: false, status: 500, headers: { get: () => null }, async json() { return { detail: 'zip-boom' } } }
  }
  // 0.3.18：404 导出失败。/export 回 404 会触发 0.3.17 的浏览器兜底（该行为不改），
  // 兜底里的 /list 也回 404，让 exportDir 走 catch → 白话 toast。
  if (window.__export404 && (url.includes('/dsh-svn/export') || url.includes('/dsh-svn/list'))) {
    return { ok: false, status: 404, headers: { get: () => null }, async json() { return { detail: 'http-404' } } }
  }
  return {
    ok: payload.ok !== false,
    status: payload.ok === false ? 404 : 200,
    headers: { get: () => null },
    async json() { return payload },
    async blob() { return new window.Blob([]) },
    async arrayBuffer() { return url.includes('/dsh-svn/stream') ? new ArrayBuffer(16) : new ArrayBuffer(0) },
  }
}

// Node 的 URL.createObjectURL 不认 jsdom Blob，视频手动加载走 blob URL 时替换为桩
URL.createObjectURL = () => 'blob:mock-media'
URL.revokeObjectURL = () => {}

// 载入插件客户端半侧
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const registrations = []
const styleTags = []
const sandbox = {
  console,
  React,
  window,
  document: window.document,
  navigator: window.navigator,
  localStorage: window.localStorage,
  URLSearchParams,
  AbortController,
  setTimeout,
  clearTimeout,
  fetch: globalThis.fetch,
  Blob: window.Blob,
  Response: window.Response ?? globalThis.Response,
  DecompressionStream: globalThis.DecompressionStream,
  TextDecoder,
  TextEncoder,
  Uint8Array,
  DataView,
  URL,
}
let plugin = null
sandbox.window = Object.assign(window, {
  __ModuleLoader__: {
    load({ factory }) {
      plugin = factory((name) => {
        if (name === 'react') return React
        throw new Error(`unexpected require: ${name}`)
      })
    },
  },
  pptxPreview: {
    init: (host) => ({
      preview: async () => {
        if (window.__pptxFail) throw new Error('stub-render-fail')
        host.innerHTML = '<div class="slide"></div><div class="slide"></div>'
      },
    }),
  },
})
sandbox.globalThis = sandbox
vm.runInNewContext(source, sandbox, { filename: 'client.js' })

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

const { act, Simulate } = require('react-dom/test-utils')
const container = window.document.getElementById('host')
const root = createRoot(container)

const text = () => container.textContent ?? ''
const waitFor = async (predicate, label, timeout = 4000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    if (predicate()) return true
    if (Date.now() - started > timeout) break
  }
  throw new Error(`timeout waiting for: ${label}`)
}

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ` | ${detail}` : ''}`)
}

await act(async () => { root.render(React.createElement(main.component)) })
await waitFor(() => text().includes('README.md'), 'file list')
await waitFor(() => [...container.querySelectorAll('.svn-tree .svn-row')].some((row) => row.textContent.includes('docs')), 'docs root row visible')
check('connected automatically (DEFAULT_ROOT)', calls.some((call) => call.startsWith('/dsh-svn/info')))
check('file list shows entries', text().includes('README.md') && text().includes('app.js'))
check('directory row', text().includes('docs'))
check('modified status dot', container.querySelector('.svn-dot') !== null)
check('revision badges', text().includes('r3'))
const firstMeta = container.querySelector('.svn-tr .s')?.textContent ?? ''
check('list meta line grouped', firstMeta.includes('r3') && firstMeta.includes('alice'), JSON.stringify(firstMeta))

// 目录树：caret 展开 / 收起
const treeText = () => container.querySelector('.svn-tree')?.textContent ?? ''
const docsTreeRow = [...container.querySelectorAll('.svn-tree .svn-row')].find((row) => row.textContent.includes('docs'))
check('tree row has caret', Boolean(docsTreeRow?.querySelector('.svn-caret')))
const caret = docsTreeRow?.querySelector('.svn-caret')
await act(async () => { caret.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => treeText().includes('设计说明.md'), 'tree expand')
check('tree expand loads children', treeText().includes('设计说明.md'))
await act(async () => { caret.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => !treeText().includes('设计说明.md'), 'tree collapse')
check('tree collapse hides children', !treeText().includes('设计说明.md'))

// 打开文件
const readmeRow = [...container.querySelectorAll('.svn-tr')].find((row) => row.textContent.includes('README.md'))
check('readme row found', Boolean(readmeRow))
await act(async () => { readmeRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => text().includes('示例仓库'), 'file content')
check('preview shows content', text().includes('停线预警说明'))
check('preview tabs', ['内容', '历史', '归属', '对比'].every((label) => text().includes(label)))
const styleText = [...container.ownerDocument.querySelectorAll('style')].map((node) => node.textContent).join('')
check('preview body flex column (image height fix)',
  styleText.includes('.svn-pv-body{flex:1;overflow:auto;min-height:0;display:flex;flex-direction:column'),
  styleText.includes('.svn-pv-body') ? 'rule present' : 'rule missing')
check('imgview checker variant carries background',
  styleText.includes('.svn-imgview.bg-checker{background:repeating-conic-gradient('), 'bg variants')
check('ghost buttons outlined (text vs button)',
  styleText.includes('.svn-btn.ghost{background:transparent;color:var(--svn-act);box-shadow:inset 0 0 0 1px'), 'outline')
check('cta gradient + nested icon rules present',
  styleText.includes('.svn-btn.cta{display:inline-flex;align-items:center;gap:8px;background:linear-gradient(')
  && styleText.includes('.svn-nest{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:999px'), 'cta/nest')
check('preview header actions never shrink',
  styleText.includes('.svn-fa{display:flex;align-items:center;gap:3px;flex:0 0 auto}'), 'flex none')
check('two-pane layout with splitter',
  Boolean(container.querySelector('.svn-tree')) && Boolean(container.querySelector('.svn-splitbar'))
  && Boolean(container.querySelector('.svn-main')) && !container.querySelector('.svn-work'),
  'tree + splitbar + main, no svn-work')
check('preview occupies right pane (list hidden while previewing)',
  Boolean(container.querySelector('.svn-fhd')) && !container.querySelector('.svn-tr'), 'preview mode')
check('file call hit host', calls.some((call) => call.includes('/dsh-svn/file') && call.includes('README.md')))
check('log call hit host', calls.some((call) => call.includes('/dsh-svn/log')))

// 切到历史
const historyTab = [...container.querySelectorAll('.svn-tabbar button')].find((button) => button.textContent === '历史')
await act(async () => { historyTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => text().includes('更新说明'), 'history list')
check('history tab renders commits', text().includes('更新说明') && text().includes('alice'))

// 回到列表模式（预览态右 pane 不再渲染列表）
const closePathBack = container.querySelector('.svn-fhd button[title="关闭预览（Esc）"]')
await act(async () => { closePathBack.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-tr') !== null, 'back to list mode')
check('close icon returns to directory list', Boolean(container.querySelector('.svn-tr')) && !container.querySelector('.svn-fhd'))

// 进入子目录
const docsRow = [...container.querySelectorAll('.svn-tr')].find((row) => row.textContent.includes('docs'))
if (docsRow) {
  await act(async () => { docsRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  await waitFor(() => text().includes('设计说明.md'), 'subdirectory')
  check('navigate into subdirectory', text().includes('设计说明.md'))
} else {
  check('navigate into subdirectory', false, 'docs row missing')
}

// PPT：版式渲染（stub 成功）与失败回落大纲
const pptxRow = [...container.querySelectorAll('.svn-tr')].find((row) => row.textContent.includes('汇报.pptx'))
check('pptx row found', Boolean(pptxRow))
if (pptxRow) {
  await act(async () => { pptxRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  await waitFor(() => container.querySelectorAll('.svn-pptx .slide').length === 2, 'pptx layout render')
  check('pptx layout view renders slides', container.querySelectorAll('.svn-pptx .slide').length === 2 && text().includes('共 2 页'))
  check('pptx page nav reports the first page', text().includes('1 / 2'), [...container.querySelectorAll('.svn-pg span')].map((n) => n.textContent).join(','))
  const nextPage = [...container.querySelectorAll('.svn-pg button')].find((button) => button.getAttribute('title') === '下一页')
  await act(async () => { nextPage.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  check('pptx page nav advances', text().includes('2 / 2'), [...container.querySelectorAll('.svn-pg span')].map((n) => n.textContent).join(','))
  // 预览态点面包屑目录段回列表
  const crumbDir = [...container.querySelectorAll('.svn-fhd .svn-crumbseg')].find((node) => node.textContent.includes('docs'))
  check('preview crumb shows clickable dir segment', Boolean(crumbDir))
  await act(async () => { crumbDir.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  await waitFor(() => container.querySelector('.svn-tr') !== null, 'list after crumb dir click')
  check('crumb dir segment returns to list', Boolean(container.querySelector('.svn-tr')) && !container.querySelector('.svn-fhd'))
  window.__pptxFail = true
  const badRow = [...container.querySelectorAll('.svn-tr')].find((row) => row.textContent.includes('坏.pptx'))
  await act(async () => { badRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  await waitFor(() => text().includes('仅文本'), 'pptx fallback outline')
  check('pptx fallback to outline', text().includes('仅文本') && text().includes('stub-render-fail'))
  window.__pptxFail = false
}

// 搜索：目录命中 + 点击进入（先回根目录）
const backFromFallback = container.querySelector('.svn-fhd button[title="关闭预览（Esc）"]')
await act(async () => { backFromFallback.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-tr') !== null, 'docs list after fallback')
const rootCrumb = [...container.querySelectorAll('.svn-dirtools button')].find((node) => node.textContent === '根目录')
await act(async () => { rootCrumb.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => text().includes('README.md'), 'back to root')
const searchInput = container.querySelector('.svn-search input')
await act(async () => { Simulate.change(searchInput, { target: { value: 'docs' } }) })
await act(async () => { Simulate.keyDown(searchInput, { key: 'Enter' }) })
await waitFor(() => container.querySelector('.svn-hit') !== null, 'search results')
const hit = container.querySelector('.svn-hit')
check('search result shows directory', Boolean(hit) && hit.textContent.includes('目录'))
await act(async () => { hit.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => text().includes('设计说明.md') && !text().includes('命中 '), 'open dir from search')
check('search dir hit navigates into directory', true)

// 图片预览：缩放控件与图片视图
const imageRow = [...container.querySelectorAll('.svn-tr')].find((row) => row.textContent.includes('logo.png'))
check('image row found', Boolean(imageRow))
if (imageRow) {
  await act(async () => { imageRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  await waitFor(() => container.querySelector('.svn-imgview img') !== null, 'image view')
  check('image view renders img', Boolean(container.querySelector('.svn-imgview img')))
  const bgSelect = container.querySelector('.svn-vctl select.svn-vsel')
  const segButtons = bgSelect ? [...bgSelect.options].map((option) => option.textContent) : []
  check('image background select present', ['自动', '棋盘', '白', '黑', '深灰'].every((label) => segButtons.includes(label)), segButtons.join(','))
  await act(async () => { Simulate.change(bgSelect, { target: { value: 'black' } }) })
  check('background choice applies class and persists', container.querySelector('.svn-imgview.bg-black') !== null && window.localStorage.getItem('dsh-svn-viewer:imgbg') === 'black', String(window.localStorage.getItem('dsh-svn-viewer:imgbg')))
  const zoomIn = container.querySelector('.svn-vctl .svn-vico[title="放大"]')
  await act(async () => { zoomIn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  check('image zoom control', text().includes('125%'), text().match(/\d+%/)?.[0] ?? 'no-percent')
  const crumbDir2 = [...container.querySelectorAll('.svn-fhd .svn-crumbseg')].find((node) => node.textContent.includes('docs'))
  await act(async () => { crumbDir2.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  await waitFor(() => container.querySelector('.svn-tr') !== null, 'list for pdf')
}
// PDF 预览：内嵌阅读器 + 新标签入口
const pdfRow = [...container.querySelectorAll('.svn-tr')].find((row) => row.textContent.includes('spec.pdf'))
check('pdf row found', Boolean(pdfRow))
if (pdfRow) {
  await act(async () => { pdfRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  await waitFor(() => container.querySelector('iframe.svn-frame') !== null, 'pdf view')
  const frame = container.querySelector('iframe.svn-frame')
  check('pdf iframe with toolbar', Boolean(frame) && String(frame.getAttribute('src')).includes('#toolbar=1'))
  check('pdf new-tab action', text().includes('新标签打开'))
}
// 图标：类型图标使用 sprite，目录展开态用 folder-open
check('type icons use sprite', Boolean(container.querySelector('.svn-ico use')))
const treeOpenIcon = container.querySelector('.svn-tree .svn-row[title="docs"] .svn-ico use')
check('folder open icon', String(treeOpenIcon?.getAttribute('href')) === '#svn-i-folder-open', String(treeOpenIcon?.getAttribute('href')))

// 目录行点击：只展开、不收起（收起交给三角），右 pane 始终切成该目录列表
const treeRowDocs = () => [...container.querySelectorAll('.svn-tree .svn-row')].find((row) => row.textContent.includes('docs'))
const docsCaret = () => container.querySelector('.svn-tree .svn-row[title="docs"] .svn-caret')
await act(async () => { treeRowDocs().dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-tr') !== null, 'row click shows list')
check('row click on an expanded dir keeps it expanded', treeText().includes('设计说明.md'))
check('row click shows the dir list on the right',
  Boolean(container.querySelector('.svn-tr')) && text().includes('设计说明.md') && !container.querySelector('.svn-fhd'))
await act(async () => { docsCaret().dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => !treeText().includes('设计说明.md'), 'caret collapse')
check('caret collapses the dir without changing the right pane',
  !treeText().includes('设计说明.md') && Boolean(container.querySelector('.svn-tr')))
await act(async () => { treeRowDocs().dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => treeText().includes('设计说明.md'), 'row click expands collapsed dir')
check('row click on a collapsed dir expands it', treeText().includes('设计说明.md'))

// 全部收起
const collapseButton = container.querySelector('.svn-sec-hd button[title="全部收起"]')
check('collapse-all button in tree header', Boolean(collapseButton))
await act(async () => { collapseButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
check('collapse-all collapses every dir', !treeText().includes('设计说明.md'))
check('collapse-all keeps right pane', text().includes('设计说明.md') && Boolean(container.querySelector('.svn-tr')))

// 分隔条拖拽与双击复位
const splitBar = container.querySelector('.svn-splitbar')
const treePane = container.querySelector('.svn-tree')
const widthBefore = treePane.style.flexBasis
await act(async () => { splitBar.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, clientX: 300 })) })
await act(async () => { window.document.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 360 })) })
await act(async () => { window.document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, clientX: 360 })) })
check('splitter drag resizes tree', treePane.style.flexBasis === '380px', `${widthBefore} -> ${treePane.style.flexBasis}`)
check('splitter width persisted', localStorage.getItem('dsh-svn-viewer:treewidth') === '380', String(localStorage.getItem('dsh-svn-viewer:treewidth')))
await act(async () => { splitBar.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true })) })
check('splitter double click resets', treePane.style.flexBasis === '320px' && localStorage.getItem('dsh-svn-viewer:treewidth') === '320', treePane.style.flexBasis)

// 视口联动上限：右 pane 至少保留 420px
Object.defineProperty(window, 'innerWidth', { configurable: true, value: 700 })
await act(async () => { splitBar.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, clientX: 300 })) })
await act(async () => { window.document.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 900 })) })
await act(async () => { window.document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, clientX: 900 })) })
check('tree width capped by viewport (right pane >= 420)', treePane.style.flexBasis === '280px', treePane.style.flexBasis)
Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
await act(async () => { splitBar.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true })) })
check('splitter reset after viewport restore', treePane.style.flexBasis === '320px', treePane.style.flexBasis)
check('tree min-width zero (content cannot force width)', styleText.includes('.svn-tree{flex:0 0 320px;min-width:0;overflow:hidden;'))
check('tree row name can ellipsize', styleText.includes('.svn-row .nm{min-width:0;overflow:hidden;text-overflow:ellipsis}'))

// 复制路径：列表态目录按钮 + 预览态文件按钮 + execCommand 降级
const written = []
Object.defineProperty(window.navigator, 'clipboard', {
  configurable: true,
  value: { writeText: async (value) => { written.push(value) } },
})
const copyDirButton = [...container.querySelectorAll('.svn-dirtools button')].find((button) => button.textContent === '复制目录路径')
check('copy dir button in list header', Boolean(copyDirButton))
await act(async () => { copyDirButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => text().includes('已复制'), 'copied chip')
check('copy dir path writes svn url', written[0] === `${ROOT}/docs`, String(written[0]))
const logoRow = [...container.querySelectorAll('.svn-tr')].find((row) => row.textContent.includes('logo.png'))
await act(async () => { logoRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-fhd') !== null, 'preview header')
const copyMenuButton = container.querySelector('.svn-fhd button[title="复制路径"]')
check('copy path icon in preview header', Boolean(copyMenuButton), String(copyMenuButton?.className))
const openCopyMenu = async () => {
  await act(async () => { copyMenuButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  await waitFor(() => [...container.querySelectorAll('.svn-menu button')].some((b) => b.textContent === '复制文件路径'), 'copy menu')
  return [...container.querySelectorAll('.svn-menu button')].find((b) => b.textContent === '复制文件路径')
}
const copyFileButton = await openCopyMenu()
await act(async () => { copyFileButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => written.length >= 2, 'file path copied')
check('copy file path writes svn url', written[1] === `${ROOT}/docs/logo.png`, String(written[1]))
// 降级路径：clipboard 抛错时走 execCommand
window.navigator.clipboard.writeText = async () => { throw new Error('denied') }
window.document.execCommand = (command) => { written.push(`exec:${command}`); return true }
const copyFileButton2 = await openCopyMenu()
await act(async () => { copyFileButton2.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => written.some((item) => item === 'exec:copy'), 'execCommand fallback')
check('clipboard fallback uses execCommand', written.some((item) => item === 'exec:copy'))
const copiedNote = [...container.querySelectorAll('.svn-copied')].map((node) => node.textContent).join('|')
check('copy success shows inline confirmation', copiedNote.includes('已复制 ✓'), copiedNote)

// 视频预览：原生 video + 超限提示
const closeAfterCopy = container.querySelector('.svn-fhd button[title="关闭预览（Esc）"]')
await act(async () => { closeAfterCopy.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-tr') !== null, 'docs list after copy test')
const crumbRoot2 = [...container.querySelectorAll('.svn-dirtools button')].find((node) => node.textContent === '根目录')
await act(async () => { crumbRoot2.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-tr') !== null, 'list for video')
const docsRow2 = [...container.querySelectorAll('.svn-tr')].find((row) => row.textContent.includes('docs'))
await act(async () => { docsRow2.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => text().includes('演示.mp4'), 'video row visible')
const videoRow = [...container.querySelectorAll('.svn-tr')].find((row) => row.textContent.includes('演示.mp4'))
await act(async () => { videoRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-video video') !== null, 'video element')
const videoEl = container.querySelector('.svn-video video')
check('video view renders native player', Boolean(videoEl) && videoEl.controls === true, String(videoEl?.getAttribute('src')))
check('video src points at raw route', String(videoEl?.getAttribute('src') ?? '').includes('/dsh-svn/raw'))
const crumbDir3 = [...container.querySelectorAll('.svn-fhd .svn-crumbseg')].find((node) => node.textContent.includes('docs'))
await act(async () => { crumbDir3.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-tr') !== null, 'list for big video')
const bigRow = [...container.querySelectorAll('.svn-tr')].find((row) => row.textContent.includes('超大.mp4'))
await act(async () => { bigRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => [...container.querySelectorAll('.svn-gate button')].some((b) => b.textContent === '加载并预览'), 'manual load card')
check('oversized video shows manual load card', text().includes('超过自动加载门槛') && !container.querySelector('.svn-video video'), 'card not player')
const vloadBtn = [...container.querySelectorAll('.svn-gate button')].find((b) => b.textContent === '加载并预览')
await act(async () => { vloadBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-video video') !== null, 'blob video after manual load')
const vsrc = String(container.querySelector('.svn-video video')?.getAttribute('src') ?? '')
check('manual video load streams then plays blob', calls.some((c) => c.includes('/dsh-svn/stream')) && vsrc.startsWith('blob:'), vsrc.slice(0, 24))

// 超限 docx 同样落到手动加载卡片
const crumbDir4 = [...container.querySelectorAll('.svn-fhd .svn-crumbseg')].find((node) => node.textContent.includes('docs'))
await act(async () => { crumbDir4.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => text().includes('big.docx'), 'docs list back')
const bigDocxRow = [...container.querySelectorAll('.svn-tr')].find((row) => row.textContent.includes('big.docx'))
await act(async () => { bigDocxRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => [...container.querySelectorAll('.svn-gate button')].some((b) => b.textContent === '加载并预览'), 'docx manual card')
check('oversized docx shows manual load card', text().includes('超过自动加载门槛'), 'gated')

// err.docx 自动加载失败 → 失败卡片 → 翻转 mock 后重试
const crumbDir5 = [...container.querySelectorAll('.svn-fhd .svn-crumbseg')].find((node) => node.textContent.includes('docs'))
await act(async () => { crumbDir5.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => [...container.querySelectorAll('.svn-tr')].some((row) => row.textContent.includes('err.docx')), 'docs list back for err')
const errRow = [...container.querySelectorAll('.svn-tr')].find((row) => row.textContent.includes('err.docx'))
await act(async () => { errRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => text().includes('读取失败'), 'failed card')
check('failed load offers reason and retry', text().includes('读取失败（http-404）') && [...container.querySelectorAll('.svn-gate button')].some((b) => b.textContent === '重试'), 'retry button')
window.__rawOk = true
const retryBtn = [...container.querySelectorAll('.svn-gate button')].find((b) => b.textContent === '重试')
await act(async () => { retryBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-gate') === null, 'card cleared after retry')
check('retry passes gate into render stage', text().includes('渲染失败') || container.querySelector('.svn-gate') === null, 'render stage')

// 大文本：/file 在飞时落不确定信息卡，而非只有顶栏细条
const crumbDocs1 = [...container.querySelectorAll('.svn-fhd .svn-crumbseg')].find((node) => node.textContent.includes('docs'))
await act(async () => { crumbDocs1.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => [...container.querySelectorAll('.svn-tr')].some((row) => row.textContent.includes('big.log')), 'docs list for big.log')
const bigLogRow = [...container.querySelectorAll('.svn-tr')].find((row) => row.textContent.includes('big.log'))
await act(async () => { bigLogRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => text().includes('主机读取中'), 'indeterminate overview card')
check('big text shows indeterminate overview card', container.querySelector('.svn-skel .bar') !== null && text().includes('46.0 MB'), 'card')
await waitFor(() => container.querySelector('.svn-code') !== null, 'text view after host read')
check('text view reports line count in the view controls', text().includes('共 2 行'), 'vstat')

// 缓存命中：二次打开 0 字节/元信息请求，视图条出绿 chip + 重新加载
const callsBeforeCache = calls.length
const crumbDocs2 = [...container.querySelectorAll('.svn-fhd .svn-crumbseg')].find((node) => node.textContent.includes('docs'))
await act(async () => { crumbDocs2.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => [...container.querySelectorAll('.svn-tr')].some((row) => row.textContent.includes('超大.mp4')), 'list for cache test')
const bigRow2 = [...container.querySelectorAll('.svn-tr')].find((row) => row.textContent.includes('超大.mp4'))
await act(async () => { bigRow2.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-video video') !== null, 'cached video renders instantly')
const cacheCalls = calls.slice(callsBeforeCache).join('|')
check('second open served from cache (0 refetch)', !cacheCalls.includes('/dsh-svn/stream') && !cacheCalls.includes('/dsh-svn/raw') && !cacheCalls.includes('/dsh-svn/file'), cacheCalls)
const reloadBtn = container.querySelector('.svn-vico[title^="重新加载"]')
check('cache hit reported + reload control visible', text().includes('缓存命中') && Boolean(reloadBtn), 'cache')
await act(async () => { reloadBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => calls.slice(callsBeforeCache).some((c) => c.includes('/dsh-svn/stream')), 'reload refetches')
check('reload bypasses cache and refetches', true, 'refetch')

// 关闭 × 返回父目录列表
const closeBtn = container.querySelector('.svn-fhd button[title="关闭预览（Esc）"]')
check('preview header close is a ghost icon button', Boolean(closeBtn) && closeBtn.className.includes('svn-ibtn'), String(closeBtn?.className))
await act(async () => { closeBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-fhd') === null && text().includes('超大.mp4'), 'list restored after close')
check('close × restores parent directory list', container.querySelector('.svn-fhd') === null, 'list mode')

// 重挂载（槽位重建）从快照恢复，不重新拉目录
const callsBeforeRemount = calls.length
await act(async () => { root.unmount() })
const root2 = createRoot(container)
await act(async () => { root2.render(React.createElement(main.component)) })
await waitFor(() => container.querySelector('.svn-fhd') !== null || text().includes('超大.mp4'), 'remount restore')
const callsAfterRemount = calls.slice(callsBeforeRemount).join('|')
check('remount restores snapshot UI', container.querySelector('.svn-fhd') !== null && text().includes('超大.mp4'), callsAfterRemount)

// 视图条不再重复放下载按钮（仅保留新标签打开）
check('view bar has no duplicate download button', ![...container.querySelectorAll('.svn-viewbar button')].some((b) => b.textContent === '下载'), 'deduped')

// 下载：blob + a[download] 真下载，按钮瞬态反馈
const dlBtn = [...container.querySelectorAll('.svn-fhd button')].find((b) => ['下载', '下载中…', '已下载 ✓', '下载失败'].includes(b.textContent))
check('single download entry in preview header', Boolean(dlBtn), String(dlBtn?.textContent))
check('download is the single primary action', dlBtn.className.includes('svn-btn primary') && dlBtn.querySelector('.svn-nest') !== null, dlBtn.className)
const connectHidden = [...container.querySelectorAll('.svn-top button')].find((b) => b.textContent.includes('连接'))
check('connect hidden while connected and address unchanged', !connectHidden, String(connectHidden?.textContent))
const rootInput = container.querySelector('.svn-rootbox input')
await act(async () => { Simulate.change(rootInput, { target: { value: `${ROOT}/docs` } }) })
const connectBtn = [...container.querySelectorAll('.svn-top button')].find((b) => b.textContent.includes('连接'))
check('connect appears once the address changes (gradient cta)', Boolean(connectBtn) && connectBtn.className.includes('svn-btn cta') && connectBtn.querySelector('.svn-nest') !== null, String(connectBtn?.className))
await act(async () => { Simulate.change(rootInput, { target: { value: ROOT } }) })
await act(async () => { dlBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => dlBtn.textContent === '已下载 ✓' || dlBtn.textContent === '下载失败', 'download feedback')
check('download saves via blob and reports state', dlBtn.textContent === '已下载 ✓' && dlBtn.className.includes('svn-btn ok'), dlBtn.textContent)

// 地址历史：连接成功自动记录，下拉可选择/删除
const savedRoots = JSON.parse(window.localStorage.getItem('dsh-svn-viewer:roots') ?? '[]')
check('connect records root history', savedRoots.some((item) => item.root === ROOT), JSON.stringify(savedRoots.map((item) => item.root)))
const histBtn = container.querySelector('.svn-rootcaret')
await act(async () => { histBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-roots') !== null, 'roots panel')
const histItem = [...container.querySelectorAll('.svn-roots .it .p')].find((node) => node.textContent === ROOT)
check('roots panel lists saved root', Boolean(histItem), 'listed')
const rmBtn = container.querySelector('.svn-roots .it .rm')
await act(async () => { rmBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => ![...container.querySelectorAll('.svn-roots .it')].length, 'history emptied')
check('root history entry removable', text().includes('暂无历史'), 'empty hint')
await act(async () => { histBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-roots') === null, 'panel closed')

// 对比：页签蓝色文字按钮、二进制说明卡、失败面板内报错 + 重试
const tabBtn = (label) => [...container.querySelectorAll('.svn-tabbar button')].find((b) => b.textContent === label)
check('tabs own their row with an underline indicator', styleText.includes('.svn-tab.on{color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:inset 0 -2px 0 var(--svn-act)}'), 'tab rule')
check('diff tab explains itself via title', String(tabBtn('对比')?.title ?? '').includes('逐行'), String(tabBtn('对比')?.title))
await act(async () => { tabBtn('对比').dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => text().includes('二进制文件不做逐行对比'), 'binary diff card')
check('binary file gets explain card instead of diff', text().includes('二进制文件不做逐行对比') && text().includes('超大.mp4'), 'card')
const close2 = container.querySelector('.svn-fhd button[title="关闭预览（Esc）"]')
await act(async () => { close2.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-fhd') === null, 'list after close')
const crumbRoot3 = [...container.querySelectorAll('.svn-dirtools button')].find((node) => node.textContent === '根目录')
await act(async () => { crumbRoot3.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => [...container.querySelectorAll('.svn-tr')].some((row) => row.textContent.includes('README.md')), 'root list for readme')
const readmeRow2 = [...container.querySelectorAll('.svn-tr')].find((row) => row.textContent.includes('README.md'))
await act(async () => { readmeRow2.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-fhd') !== null && text().includes('示例仓库'), 'readme preview')
window.__diffFail = true
await act(async () => { tabBtn('对比').dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => text().includes('差异加载失败'), 'diff error card')
check('diff failure renders in-panel error with retry', text().includes('差异加载失败') && [...container.querySelectorAll('.svn-pv-body button')].some((b) => b.textContent === '重试'), 'error card')
window.__diffFail = false
const retryBtn2 = [...container.querySelectorAll('.svn-pv-body button')].find((b) => b.textContent === '重试')
await act(async () => { retryBtn2.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-split') !== null, 'diff after retry')
check('retry renders line diff with stat', text().includes('对比 r3 · +1 / -1') && text().includes('停线预警'), 'diff body')
check('diff jump bar reports hunk position', (container.querySelector('.svn-jumpbar .cnt')?.textContent ?? '') === '1/1')
const sideBtn = [...container.querySelectorAll('.svn-jumpbar .svn-seg button')].find((button) => button.textContent === '并排')
await act(async () => { sideBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
check('side-by-side renders two paired columns', container.querySelectorAll('.svn-diffsplit .col').length === 2)
const inlineBtn = [...container.querySelectorAll('.svn-jumpbar .svn-seg button')].find((button) => button.textContent === '行内')
await act(async () => { inlineBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
check('inline mode restores single column', !container.querySelector('.svn-diffsplit'))

// 表格版式还原：合并单元格 → rowspan/colspan、标题行提为文档标题、双层表头、单元格全文浮层、拍平逃生口
const closeReadme = container.querySelector('.svn-fhd button[title="关闭预览（Esc）"]')
await act(async () => { closeReadme.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-tr') !== null, 'list before xlsx')
const docsForXlsx = [...container.querySelectorAll('.svn-tr')].find((row) => row.textContent.includes('docs'))
await act(async () => { docsForXlsx.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => [...container.querySelectorAll('.svn-tr')].some((row) => row.textContent.includes('停线预警统计.xlsx')), 'xlsx row visible')

const sheetKey = (r, c) => `${String.fromCharCode(65 + c)}${r + 1}`
const fakeSheet = { '!ref': 'B2:G8', '!merges': [
  { s: { r: 1, c: 1 }, e: { r: 1, c: 6 } },
  { s: { r: 2, c: 1 }, e: { r: 3, c: 1 } },
  { s: { r: 2, c: 2 }, e: { r: 2, c: 6 } },
  { s: { r: 4, c: 1 }, e: { r: 7, c: 1 } },
] }
const setCell = (r, c, text) => { fakeSheet[sheetKey(r, c)] = { v: text, w: text } }
setCell(1, 1, '停线预警统计--按等级')
setCell(2, 1, '等级')
setCell(2, 2, '停线预警')
;['A', 'B', 'C', 'D', 'E'].forEach((label, index) => setCell(3, 2 + index, label))
setCell(4, 1, '一级')
for (let r = 4; r <= 7; r += 1) for (let c = 2; c <= 6; c += 1) setCell(r, c, `${r + 1}-${c}`)
const decodeRange = (ref) => {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref)
  const col = (letters) => [...letters].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1
  return { s: { r: Number(m[2]) - 1, c: col(m[1]) }, e: { r: Number(m[4]) - 1, c: col(m[3]) } }
}
window.XLSX = {
  utils: {
    decode_range: decodeRange,
    encode_cell: ({ r, c }) => sheetKey(r, c),
    sheet_to_json: () => [['拍平一', '拍平二']],
  },
  read: () => ({ SheetNames: ['明细'], Sheets: { 明细: fakeSheet } }),
}
const xlsxRow = [...container.querySelectorAll('.svn-tr')].find((row) => row.textContent.includes('停线预警统计.xlsx'))
await act(async () => { xlsxRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-grid2') !== null, 'merged sheet render')
check('merged title becomes a document title', (container.querySelector('.svn-sheettitle')?.textContent ?? '') === '停线预警统计--按等级')
check('two-level header rows rendered', container.querySelectorAll('.svn-grid2 thead tr').length === 2)
const groupCell = container.querySelector('.svn-grid2 thead th[colspan="5"]')
check('horizontal merge becomes colspan', Boolean(groupCell) && groupCell.textContent === '停线预警')
const rowSpanCell = [...container.querySelectorAll('.svn-grid2 tbody td')].find((cell) => cell.getAttribute('rowspan') === '4')
check('vertical merge becomes rowspan', Boolean(rowSpanCell) && rowSpanCell.textContent.includes('一级'))
check('row gutter keeps real sheet numbers', [...container.querySelectorAll('.svn-grid2 tbody th.rn')][0]?.textContent === '5',
  [...container.querySelectorAll('.svn-grid2 tbody th.rn')][0]?.textContent)
const firstBodyCell = [...container.querySelectorAll('.svn-grid2 tbody td')][1]
await act(async () => { firstBodyCell.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-pop') !== null, 'cell popover')
check('cell click shows full text with address', (container.querySelector('.svn-pop')?.textContent ?? '').includes('单元格') && container.querySelectorAll('.svn-pop .pv').length === 1,
  container.querySelector('.svn-pop')?.textContent?.slice(0, 40))
await act(async () => { window.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })) })
const flatBtn = [...container.querySelectorAll('.svn-vctl .svn-vbtn')].find((button) => button.textContent === '拍平')
check('flat escape hatch present', Boolean(flatBtn))
await act(async () => { flatBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-grid') !== null, 'flat table')
check('flat mode drops merges', container.querySelector('.svn-grid2') === null && container.querySelector('.svn-grid') !== null, 'flat')
check('sheet tabs expose the sheet name', (container.querySelector('.svn-sheetbar .svn-sheet')?.textContent ?? '') === '明细')

// 全仓库搜索：首次回 indexing → 显示扫描进度与取消 → 轮询后出结果
const indexInput = container.querySelector('.svn-search input')
await act(async () => { Simulate.change(indexInput, { target: { value: '视频' } }) })
await act(async () => { Simulate.keyDown(indexInput, { key: 'Enter' }) })
await waitFor(() => text().includes('建立文件名索引'), 'index progress')
check('indexing shows scan progress', text().includes('已扫描 1,234 项'), text().slice(0, 60))
check('indexing offers a cancel action', Boolean([...container.querySelectorAll('.svn-idxcard button')].find((button) => button.textContent === '取消')))
await waitFor(() => container.querySelector('.svn-hit') !== null, 'index results', 6000)
check('indexed hits carry the index chip', Boolean(container.querySelector('.svn-split .svn-seg')) && text().includes('索引 2 项'))
check('indexed dir hit renders as directory', (container.querySelector('.svn-hit')?.textContent ?? '').includes('目录'))
await waitFor(() => (container.querySelectorAll('.svn-hit')[1]?.textContent ?? '').includes('bob'), 'indexed hit metadata', 4000)
const indexedFileRow = container.querySelectorAll('.svn-hit')[1]?.textContent ?? ''
check('indexed hits get size, revision and date filled in', indexedFileRow.includes('bob') && indexedFileRow.includes('r7') && indexedFileRow.includes('5.0 MB') && indexedFileRow.includes('2026-02-03'), indexedFileRow.slice(0, 90))
await act(async () => { container.querySelectorAll('.svn-hit')[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-fhd') !== null, 'preview after clicking a search hit')
check('clicking a search hit opens the preview', text().includes('培训视频.mp4') && !container.querySelector('.svn-hit'), 'preview open')
const closeFhd = container.querySelector('.svn-fhd button[title="关闭预览（Esc）"]')
await act(async () => { closeFhd.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-hit') !== null, 'search results restored after closing the preview')
check('closing a preview returns to the search results', container.querySelectorAll('.svn-hit').length === 2, String(container.querySelectorAll('.svn-hit').length))

// 顶层搜索框：左框是树过滤（本地），右框是仓库搜索（发请求）；远程仓库上范围下拉必须可点
const modeChip = container.querySelector('.svn-mode')
check('search mode chip is clickable on a url root', Boolean(modeChip) && !modeChip.disabled)
await act(async () => { modeChip.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-mode-menu') !== null, 'search scope menu')
const menuItems = [...container.querySelectorAll('.svn-mode-menu button')].map((button) => ({ text: button.textContent, disabled: button.disabled }))
check('scope menu lists repo/dir/content', menuItems.length === 3
  && menuItems[0].text.includes('整个仓库') && menuItems[1].text.includes('当前目录') && menuItems[2].text.includes('全文'), JSON.stringify(menuItems.map((item) => item.text.slice(0, 12))))
check('content search stays disabled on a url root', menuItems[2].disabled === true)
check('full-text item says it needs a working copy', menuItems[2].text.includes('需本地工作副本'), menuItems[2].text)
check('menu explains full-text needs a working copy', (container.querySelector('.svn-mode-note')?.textContent ?? '').includes('Office 正文') && (container.querySelector('.svn-mode-note')?.textContent ?? '').includes('切到工作副本'), container.querySelector('.svn-mode-note')?.textContent?.slice(0, 30))
await act(async () => { menuItems[1] && container.querySelectorAll('.svn-mode-menu button')[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
check('choosing current-dir scope updates the chip', (container.querySelector('.svn-mode')?.textContent ?? '').includes('名称'), container.querySelector('.svn-mode')?.textContent)
const treeFilter = container.querySelector('.svn-treefilter input')
check('tree header keeps its own local filter box', Boolean(treeFilter) && treeFilter.getAttribute('placeholder') === '过滤目录与文件', treeFilter?.getAttribute('placeholder'))

// 输入框聚焦：去掉浏览器矩形描边，地址框/搜索框只留 1px 柔和蓝环
check('focus ring drops the browser outline', styleText.includes('.svn-rootbox .svn-input:focus-within{box-shadow:none}'), styleText.includes('.svn-rootbox .svn-input:focus-within{box-shadow:none}') ? 'reset present' : 'reset missing')
check('address and search share one focus ring', styleText.includes('.svn-rootbox:focus-within,.svn-search:focus-within{'), styleText.includes('.svn-rootbox:focus-within,.svn-search:focus-within{') ? 'shared rule' : 'rule missing')
// 搜索懒加载：先 100 条，点“加载更多”再 50 条
const pagingInput = container.querySelector('.svn-search input')
await act(async () => { Simulate.change(pagingInput, { target: { value: '分页' } }) })
await act(async () => { Simulate.keyDown(pagingInput, { key: 'Enter' }) })
await waitFor(() => container.querySelectorAll('.svn-hit').length === 100, 'first page of 100 hits', 6000)
check('lazy list renders 100 rows first', container.querySelectorAll('.svn-hit').length === 100)
const moreBtn = [...container.querySelectorAll('.loadmore button')].find((button) => button.textContent.includes('加载更多'))
check('load-more offers the next 50', Boolean(moreBtn) && moreBtn.textContent.includes('30'), moreBtn?.textContent)
await act(async () => { moreBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)) })
check('load-more appends the remaining rows', container.querySelectorAll('.svn-hit').length === 130, String(container.querySelectorAll('.svn-hit').length))
check('load-more disappears when everything is shown', !container.querySelector('.loadmore'))
check('row shows size on the right and meta below', (container.querySelector('.svn-hit')?.textContent ?? '').includes('1.0 KB') && (container.querySelector('.svn-hit')?.textContent ?? '').includes('alice'))

// 目录选择弹窗：选盘 → 进目录 → 连接
const pickerBtn = [...container.querySelectorAll('.svn-top button')].find((button) => button.getAttribute('title') === '选择本地目录（工作副本）')
check('picker button lives next to the address box', Boolean(pickerBtn))
await act(async () => { pickerBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-picker') !== null, 'picker open')
check('picker lists drives first', (container.querySelector('.svn-picker')?.textContent ?? '').includes('D:'))
const driveItem = [...container.querySelectorAll('.svn-picker-item')].find((item) => item.textContent.includes('D:'))
await act(async () => { driveItem.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => (container.querySelector('.svn-picker')?.textContent ?? '').includes('work'), 'picker navigates into a disk')
check('picker navigates into a disk', (container.querySelector('.svn-picker')?.textContent ?? '').includes('D:\\'))
const workItem = [...container.querySelectorAll('.svn-picker-item')].find((item) => item.textContent.includes('work'))
await act(async () => { workItem.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => (container.querySelector('.svn-picker')?.textContent ?? '').includes('demo-wc'), 'picker lists nested dirs')
const pickerConnectBtn = [...container.querySelectorAll('.svn-picker-ft button')].find((button) => button.textContent.includes('连接此目录'))
await act(async () => { pickerConnectBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)) })
check('picker closes and connects to the picked dir', !container.querySelector('.svn-picker') && calls.some((call) => call.includes('/dsh-svn/info') && decodeURIComponent(call).includes('D:\\work')), calls.filter((call) => call.includes('/dsh-svn/info')).slice(-1)[0])

// 搜索模式/范围持久化
const savedSearch = JSON.parse(window.localStorage.getItem('dsh-svn-viewer:search') ?? '{}')
check('search mode and scope are persisted', savedSearch.scope === 'dir' || savedSearch.scope === 'repo', JSON.stringify(savedSearch))

// 0.3.13 回归：键盘树 / 状态栏 / 上下文栏 / 导出失败 toast 带重试
const treeRow0 = container.querySelector('.svn-row[tabindex="0"]')
check('tree exposes a single roving tab stop', Boolean(treeRow0) && container.querySelectorAll('.svn-row[tabindex="0"]').length === 1)
check('tree rows carry treeitem semantics', treeRow0?.getAttribute('role') === 'treeitem')
await act(async () => { treeRow0.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
const treeRow1 = container.querySelector('.svn-row[tabindex="0"]')
check('arrow down moves tree focus', Boolean(treeRow1) && treeRow1 !== treeRow0)
const statusText = container.querySelector('.svn-statusbar')?.textContent ?? ''
check('status bar shows connection and head', statusText.includes('只读连接') && statusText.includes('仓库 HEAD'))
const railBtn = [...container.querySelectorAll('.svn-dirtools button')].find((button) => button.textContent === '上下文')
await act(async () => { railBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-rail') !== null, 'rail open')
check('context rail opens with siblings', (container.querySelector('.svn-rail')?.textContent ?? '').includes('同目录'))
const railClose = container.querySelector('.svn-rail button[title="收起上下文栏"]')
await act(async () => { railClose.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-rail') === null, 'rail closed')
check('context rail closes again', !container.querySelector('.svn-rail'))
const exportBtn = [...container.querySelectorAll('.svn-dirtools button')].find((button) => button.textContent === '导出')
window.__exportFail = true
await act(async () => { exportBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-toast.fail') !== null, 'export fail toast', 6000)
check('export failure toast offers retry', Boolean([...container.querySelectorAll('.svn-toast.fail button')].find((button) => button.textContent === '重试')))
check('export failure toast names the reason', (container.querySelector('.svn-toast.fail')?.textContent ?? '').includes('zip-boom'))
window.__exportFail = false

// 0.3.16 回归：元数据单一事实源（命中无作者时回退 log）+ 无变更 diff 白话空态
const mi16 = container.querySelector('.svn-search input')
await act(async () => { Simulate.change(mi16, { target: { value: '无元' } }) })
await act(async () => { Simulate.keyDown(mi16, { key: 'Enter' }) })
await waitFor(() => container.querySelector('.svn-hit') !== null, '0.3.16 indexed hits')
await act(async () => { container.querySelector('.svn-hit').dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-fhd') !== null, '0.3.16 preview')
await waitFor(() => (container.querySelector('.svn-fhd .fid small')?.textContent ?? '').includes('alice'), 'meta fallback')
check('file head meta falls back to log when hit lacks author', (container.querySelector('.svn-fhd .fid small')?.textContent ?? '').includes('alice'), container.querySelector('.svn-fhd .fid small')?.textContent)
await act(async () => { container.querySelector('.svn-fhd button[title="关闭预览（Esc）"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)) })
window.__diffEmpty = true
await act(async () => { Simulate.change(mi16, { target: { value: 'README' } }) })
await act(async () => { Simulate.keyDown(mi16, { key: 'Enter' }) })
await waitFor(() => container.querySelector('.svn-hit') !== null, '0.3.16 search')
await act(async () => { container.querySelector('.svn-hit').dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-fhd') !== null, '0.3.16 preview 2')
const dt16 = [...container.querySelectorAll('.svn-tab')].find((b) => b.textContent === '对比')
await act(async () => { dt16.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => text().includes('该修订没有差异'), 'no-change empty state')
check('no-change diff shows plain empty state without raw header', text().includes('该修订没有差异') && !text().includes('Index:'))
window.__diffEmpty = false

// 0.3.18 回归：diff 加载骨架 / picker Esc 层级 / 图标钮 aria-label / 导出失败白话
window.__diffSlow = true
await act(async () => { container.querySelector('.svn-fhd button[title="关闭预览（Esc）"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-hit') !== null, '0.3.18 search restored')
await act(async () => { container.querySelector('.svn-hit').dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-fhd') !== null, '0.3.18 preview reopened')
const dt18 = [...container.querySelectorAll('.svn-tab')].find((b) => b.textContent === '对比')
await act(async () => { dt18.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
check('diff loading state uses the shared skeleton', container.querySelector('.svn-pv-body .svn-skel') !== null && text().includes('正在加载差异…'), container.querySelector('.svn-pv-body .svn-skel') ? 'svn-skel' : 'missing')
await waitFor(() => container.querySelector('.svn-split') !== null, '0.3.18 diff after slow load')
check('slow diff still renders the line diff', text().includes('对比 r3 · +1 / -1'))
window.__diffSlow = false

const ariaClose = container.querySelector('.svn-fhd button[title="关闭预览（Esc）"]')
check('close icon button exposes aria-label', Boolean(ariaClose?.getAttribute('aria-label')), String(ariaClose?.getAttribute('aria-label')))
const ariaSelectors = [
  '.svn-fhd button[title="复制路径"]',
  '.svn-fhd button[title="更多"]',
  '.svn-tabbar button[aria-pressed]',
  '.svn-tabbar button[title="重新加载此文件（绕过缓存）"]',
  '.svn-sec-hd button[title="全部收起"]',
  '.svn-top button[title="选择本地目录（工作副本）"]',
  '.svn-top button[title="刷新当前目录"]',
  '.svn-rootcaret',
]
const ariaMissing = ariaSelectors.filter((sel) => {
  const el = container.querySelector(sel)
  return !el || !el.getAttribute('aria-label') || el.getAttribute('aria-label') !== el.getAttribute('title')
})
check('icon buttons aria-label matches title', ariaMissing.length === 0, ariaMissing.join(','))

const pickerBtn18 = [...container.querySelectorAll('.svn-top button')].find((b) => b.getAttribute('title') === '选择本地目录（工作副本）')
await act(async () => { pickerBtn18.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-picker') !== null, '0.3.18 picker open')
await act(async () => { document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
check('picker Esc closes picker without closing preview', !container.querySelector('.svn-picker') && container.querySelector('.svn-fhd') !== null)

await act(async () => { container.querySelector('.svn-fhd button[title="关闭预览（Esc）"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-hit') !== null, '0.3.18 search restored for export')
const clearBtn18 = [...container.querySelectorAll('.svn-split button')].find((b) => b.textContent === '清除')
await act(async () => { clearBtn18.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-dirtools') !== null, '0.3.18 dir tools for export')
window.__export404 = true
const exportBtn18 = [...container.querySelectorAll('.svn-dirtools button')].find((b) => b.textContent === '导出')
await act(async () => { exportBtn18.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => [...container.querySelectorAll('.svn-toast.fail')].some((t) => t.textContent.includes('路径或路由不存在')), '0.3.18 plain export failure', 6000)
const plainToast = [...container.querySelectorAll('.svn-toast.fail')].find((t) => t.textContent.includes('路径或路由不存在'))
check('export 404 toast is plain language without raw code', plainToast.textContent.includes('路径或路由不存在') && !plainToast.textContent.includes('http-404'), plainToast.textContent.slice(0, 60))
window.__export404 = false

// ===== 0.3.20 V4 回归：根级五组聚类 / 最近段 / 目录栏收起浮层 / 全树 roving =====
// 换用覆盖五组边界的真实 34 名根列表（01/09、10/19、101/110、95/99、IPD），重连刷新根目录。
const V4_ROOTS = ['01_MES', '02_ACP', '03_APS', '04_SCADA', '05_SCM', '06_CCS', '07_SCRM', '08_ECC', '09_MPLM',
  '10_FN', '101自动化控制', '102智能制造', '103数字供应链', '104数字研发', '105数字运营', '106研发中心', '107售后项目', '108项目与体系管理', '109行业售前',
  '11_iHR', '110项目群', '12_Mission', '13_M-bigdata', '14_M-BI', '15_IDM', '17_GPM', '18_设备云', '19_协作云',
  '95_项目交付平台', '96_技术交付平台', '97_业务交付平台', '98_业务咨询', '99_行业解决方案', 'IPD']
listing[''] = V4_ROOTS.map((name) => ({ name, kind: 'dir', size: 0, rev: 3, author: 'alice', date: '2026-01-02T03:04:05Z' }))
listing['01_MES'] = [{ name: '说明.md', kind: 'file', size: 10, rev: 3, author: 'alice', date: '2026-01-02T03:04:05Z' }]
files['01_MES/说明.md'] = { view: 'text', content: '模块说明', size: 10, path: '01_MES/说明.md', name: '说明.md', encoding: 'utf-8' }
const v4Input = container.querySelector('.svn-rootbox input')
await act(async () => { Simulate.change(v4Input, { target: { value: ROOT } }) })
await act(async () => { Simulate.keyDown(v4Input, { key: 'Enter' }) })
await waitFor(() => container.querySelectorAll('.svn-tree .svn-row').length >= 34, '0.3.21 flat root rows')
// 重连后「全部收起」回到默认折叠再断言。
const v4CollapseAll = container.querySelector('.svn-sec-hd button[title="全部收起"]')
await act(async () => { v4CollapseAll.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })

// ① 0.3.21：根级平铺、无组头（模块分类已移除）
check('0.3.21 no group headers', container.querySelectorAll('.svn-grp-hd').length === 0)
const v4RootRows = [...container.querySelectorAll('.svn-tree .svn-row')]
check('0.3.21 root rows flat 34', v4RootRows.length === 34, String(v4RootRows.length))
check('0.3.21 first root row is real dir', v4RootRows[0]?.getAttribute('data-tree-path') === '01_MES', v4RootRows[0]?.getAttribute('data-tree-path'))

// ③ 0.3.25：最近只记文件——openDir 不记、openFile 记、清空后消失
const v4MesRow = [...container.querySelectorAll('.svn-tree .svn-row')].find((row) => row.textContent.includes('01_MES'))
await act(async () => { v4MesRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => [...container.querySelectorAll('.svn-tr')].some((row) => row.textContent.includes('说明.md')), 'dir listing')
check('0.3.25 openDir does not record recent', !JSON.parse(window.localStorage.getItem('dsh-svn-viewer:recent') ?? '[]').some((it) => it.root === ROOT && it.path === '01_MES'))
const v4FileRow0 = [...container.querySelectorAll('.svn-tr')].find((row) => row.textContent.includes('说明.md'))
await act(async () => { v4FileRow0.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => [...container.querySelectorAll('.svn-recent-row')].some((row) => row.textContent.includes('说明.md')), 'recent file row')
check('0.3.25 recent records opened file', [...container.querySelectorAll('.svn-recent-row')].some((row) => row.textContent.includes('说明.md')))
const v4SavedRecent = JSON.parse(window.localStorage.getItem('dsh-svn-viewer:recent') ?? '[]')
check('0.3.25 recent persisted kind=file only', v4SavedRecent.some((it) => it.root === ROOT && it.path === '01_MES/说明.md' && it.kind === 'file') && v4SavedRecent.every((it) => it.kind === 'file'), JSON.stringify(v4SavedRecent.slice(0, 2)))
const v4Clear = container.querySelector('.svn-sec-clear')
await act(async () => { v4Clear.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelectorAll('.svn-recent-row').length === 0, 'V4 recent cleared')
check('V4 recent clear removes current-root entries',
  container.querySelectorAll('.svn-recent-row').length === 0
  && JSON.parse(window.localStorage.getItem('dsh-svn-viewer:recent') ?? '[]').filter((it) => it.root === ROOT).length === 0)

// ④ 收起态渲染 44px 图标条；悬停「目录」出浮层、首可见行 tabIndex=0；Esc 关浮层不关预览（预览已由③打开）
await waitFor(() => container.querySelector('.svn-fhd') !== null, 'V4 preview open')
const v4DockBtn = container.querySelector('.svn-treehd button[title="收起目录栏"]')
check('V4 dock collapse button present', Boolean(v4DockBtn))
await act(async () => { v4DockBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-dockrail') !== null, 'V4 dock rail')
check('V4 collapsed renders 44px icon rail (no panel tree)',
  Boolean(container.querySelector('.svn-dockrail')) && !container.querySelector('.svn-tree') && styleText.includes('.svn-dockrail{flex:0 0 44px'))
const v4RailTree = [...container.querySelectorAll('.svn-dockrail button')].find((b) => b.textContent.includes('目录'))
await act(async () => { v4RailTree.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true })) })
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)) })
await waitFor(() => container.querySelector('.svn-flyout') !== null, 'V4 tree flyout')
check('V4 rail tree hover opens flyout (aria-expanded)', Boolean(container.querySelector('.svn-flyout')) && v4RailTree.getAttribute('aria-expanded') === 'true')
const v4FlyFirst = container.querySelector('.svn-flyout [data-tree-path][tabindex="0"]')
check('V4 flyout first visible row roving tabIndex=0', Boolean(v4FlyFirst))
await act(async () => { document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
check('V4 Esc closes flyout without closing preview', !container.querySelector('.svn-flyout') && container.querySelector('.svn-fhd') !== null)

// ⑤ 全树 roving 单 tabindex=0（模块行统一）；0.3.25 底部展开钮已移除，点「目录」展开
const v4RailExpand = [...container.querySelectorAll('.svn-dockrail button')].find((b) => b.textContent.includes('目录'))
check('0.3.25 no bottom expand button in rail', ![...container.querySelectorAll('.svn-dockrail button')].some((b) => b.textContent.trim() === '展开'))
await act(async () => { v4RailExpand.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-tree') !== null, 'V4 dock expanded')
const v4Roving = container.querySelectorAll('.svn-tree [data-tree-path][tabindex="0"]')
check('V4 whole tree single roving tab stop', v4Roving.length === 1, String(v4Roving.length))

// ⑦ 0.3.24：收起态悬停浮层持续显示（overlay 不盖图标条）；点击「目录」正常展开侧栏
const v4DockBtn2 = container.querySelector('.svn-treehd button[title="收起目录栏"]')
await act(async () => { v4DockBtn2.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-dockrail') !== null, '0.3.24 dock rail again')
const railTreeBtn2 = [...container.querySelectorAll('.svn-dockrail button')].find((b) => b.textContent.includes('目录'))
await act(async () => { railTreeBtn2.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true })) })
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)) })
check('0.3.24 hover flyout stays open', Boolean(container.querySelector('.svn-flyout')))
const overlay = container.querySelector('.svn-flyout')?.previousElementSibling
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)) })
check('0.3.24 hover flyout persists (no instant hide)', Boolean(container.querySelector('.svn-flyout')))
await act(async () => { railTreeBtn2.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-tree') !== null, '0.3.24 click rail tree expands dock')
check('0.3.24 click rail tree expands dock', Boolean(container.querySelector('.svn-tree')) && !container.querySelector('.svn-dockrail'))

// ⑧ 0.3.25：点击「最近」图标也正常展开侧栏
const v4DockBtn3 = container.querySelector('.svn-treehd button[title="收起目录栏"]')
await act(async () => { v4DockBtn3.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-dockrail') !== null, '0.3.25 rail again')
const railRecentBtn3 = [...container.querySelectorAll('.svn-dockrail button')].find((b) => b.textContent.includes('最近'))
await act(async () => { railRecentBtn3.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await waitFor(() => container.querySelector('.svn-tree') !== null, '0.3.25 click rail recent expands dock')
check('0.3.25 click rail recent expands dock', Boolean(container.querySelector('.svn-tree')) && !container.querySelector('.svn-dockrail'))

// ⑥ 0.3.22：最近/全部目录 VS Code 式折叠段；最近限 4 行高可滚
const secToggles = [...container.querySelectorAll('.svn-sec-toggle')]
check('0.3.22 two collapsible section headers', secToggles.length === 2, String(secToggles.length))
check('0.3.22 section headers aria-expanded/controls', secToggles.every((b) => b.getAttribute('aria-expanded') === 'true' && b.getAttribute('aria-controls')))
const allToggle = secToggles.find((b) => b.textContent.includes('全部目录'))
await act(async () => { allToggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
check('0.3.22 collapsing all hides tree rows', allToggle.getAttribute('aria-expanded') === 'false' && container.querySelector('#svn-sec-all').hidden === true)
await act(async () => { allToggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
check('0.3.22 expanding all restores tree rows', allToggle.getAttribute('aria-expanded') === 'true' && container.querySelector('#svn-sec-all').hidden === false)
check('0.3.22 recent capped 4 rows scrollable', styleText.includes('.svn-sec-recent{max-height:120px;overflow-y:auto'))
check('0.3.23 sec-toggle padding 6px 4px', styleText.includes('.svn-sec-toggle{flex:1;min-width:0;display:flex;align-items:center;gap:6px;border:0;background:transparent;font:inherit;color:inherit;padding:6px 4px'))
check('0.3.23 treefoot strip removed', !styleText.includes('.svn-treefoot{') && !container.querySelector('.svn-treefoot'))
check('0.3.24 dock collapse back in treehd', Boolean(container.querySelector('.svn-treehd button[title="收起目录栏"]')) && !container.querySelector('.svn-sec-hd button[title="收起目录栏"]'))
check('0.3.24 collapse-all lives in section header', Boolean(container.querySelector('.svn-sec-hd button[title="全部收起"]')) && !container.querySelector('.svn-treehd button[title="全部收起"]'))
const secsSaved = JSON.parse(window.localStorage.getItem('dsh-svn-viewer:secs') ?? '{}')
check('0.3.22 section state persisted', secsSaved.all === true && secsSaved.recent === true, JSON.stringify(secsSaved))

const failed = checks.filter((item) => !item.ok).length
console.log(`\n${checks.length - failed}/${checks.length} passed; fetch calls: ${calls.length}`)
process.exit(failed ? 1 : 0)
