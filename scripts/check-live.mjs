/**
 * 对运行中的 dsh web 做一次真机自检：只打 /dsh-svn/* 路由，不需要 GUI token。
 * 用法：node scripts/check-live.mjs [root]
 *   root 默认 https://svn.apache.org/repos/asf/poi/trunk（公开示例仓库）
 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const BASE = process.env.DSH_SVN_BASE ?? 'http://127.0.0.1:3080'
const ROOT = process.argv[2] ?? 'https://svn.apache.org/repos/asf/poi/trunk'

const rows = []
function record(name, ok, detail) {
  rows.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`)
}

async function get(path, options = {}) {
  const started = Date.now()
  const response = await fetch(`${BASE}/dsh-svn${path}`, { signal: AbortSignal.timeout(options.timeout ?? 60000) })
  const buffer = Buffer.from(await response.arrayBuffer())
  let json = null
  try { json = JSON.parse(buffer.toString('utf8')) } catch { /* binary */ }
  return { status: response.status, headers: response.headers, bytes: buffer.length, head: buffer.subarray(0, 2).toString('hex'), json, ms: Date.now() - started }
}

const q = (value) => encodeURIComponent(value)

// 复用客户端自带的浏览器端兜底实现（Office 提取 + zip 打包），用于验证旧宿主下的能力。
function loadClientHelpers() {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const start = source.indexOf('/* --- browser fallbacks')
  const end = source.indexOf('/* --- end browser fallbacks --- */')
  if (start < 0 || end < 0) throw new Error('client fallback markers missing')
  const sandbox = { TextDecoder, TextEncoder, Blob, Response, DecompressionStream, Uint8Array, DataView, fetch, URLSearchParams }
  sandbox.globalThis = sandbox
  vm.runInNewContext(`${source.slice(start, end)}
globalThis.__extractOffice = extractOfficeInBrowser
globalThis.__buildZip = buildZip`, sandbox, { filename: 'client-fallbacks.js' })
  return { extractOffice: sandbox.__extractOffice, buildZip: sandbox.__buildZip }
}

async function fetchBytes(path) {
  const response = await fetch(`${BASE}/dsh-svn${path}`, { signal: AbortSignal.timeout(120000) })
  return { ok: response.ok, status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) }
}

async function main() {
  const health = await get('/health', { timeout: 15000 })
  record('host health', health.status === 200 && health.json?.ok === true, `${health.ms}ms svn=${health.json?.svn ?? 'n/a'}`)

  const context = await get('/context', { timeout: 60000 })
  const repos = context.json?.repos
  record('host version >= 0.1.1 (/context.repos)', Array.isArray(repos), Array.isArray(repos) ? `${repos.length} 个工作副本` : '字段缺失 → 宿主仍是旧版本，需要重启 dsh web')

  const info = await get(`/info?root=${q(ROOT)}`, { timeout: 60000 })
  record('info', info.status === 200 && info.json?.ok === true, `${info.ms}ms rev=${info.json?.info?.revision} kind=${info.json?.kind}`)

  const list = await get(`/list?root=${q(ROOT)}`, { timeout: 60000 })
  record('list root', list.status === 200 && (list.json?.entries?.length ?? 0) > 0, `${list.ms}ms entries=${list.json?.entries?.length}`)
  const firstDir = list.json?.entries?.find((entry) => entry.kind === 'dir')?.name

  if (firstDir) {
    const sub = await get(`/list?root=${q(ROOT)}&path=${q(firstDir)}`, { timeout: 60000 })
    record('list subdirectory', sub.status === 200, `${sub.ms}ms ${firstDir} entries=${sub.json?.entries?.length}`)
  }

  const search = await get(`/search?root=${q(ROOT)}&q=${q('PQC')}&mode=name&limit=5${firstDir ? `&path=${q(firstDir)}` : ''}`, { timeout: 90000 })
  record('search (name)', search.status === 200, `${search.ms}ms total=${search.json?.total} scanned=${search.json?.scanned}`)

  const docx = await findDocx(ROOT, firstDir)
  if (docx) {
    const helpers = loadClientHelpers()
    const file = await get(`/file?root=${q(ROOT)}&path=${q(docx)}`, { timeout: 90000 })
    if (file.json?.view === 'office-text') {
      record('docx text preview', true, `${file.ms}ms 宿主提取 chars=${String(file.json?.content ?? '').length}`)
    } else {
      const raw = await fetchBytes(`/raw?root=${q(ROOT)}&path=${q(docx)}`)
      const extracted = raw.ok ? await helpers.extractOffice(docx.split('/').pop(), raw.bytes.buffer) : null
      record('docx text preview (浏览器端兜底)', Boolean(extracted?.text), `${raw.status} ${raw.bytes.length}B → chars=${extracted?.text?.length ?? 0}`)
    }
    const exported = await get(`/export?root=${q(ROOT)}&path=${q(docx)}`, { timeout: 120000 })
    if (exported.status === 200 && exported.head === '504b') {
      record('export single file', true, `${exported.ms}ms 宿主打包 bytes=${exported.bytes}`)
    } else {
      const raw = await fetchBytes(`/raw?root=${q(ROOT)}&path=${q(docx)}`)
      const name = docx.split('/').pop()
      const zip = raw.ok ? await helpers.buildZip([{ name, bytes: raw.bytes }]) : null
      const zipBytes = zip ? new Uint8Array(await zip.arrayBuffer()) : new Uint8Array(0)
      const head = Buffer.from(zipBytes.subarray(0, 2)).toString('hex')
      record('export single file (浏览器端兜底)', zipBytes.length > 0 && head === '504b', `${raw.status} → zip ${zipBytes.length}B head=${head}`)
    }
  } else {
    record('docx text preview', false, '未在仓库里找到 docx 样本')
    record('export single file', false, '未在仓库里找到可导出的样本')
  }

  const failed = rows.filter((row) => !row.ok).length
  console.log(`\n${rows.length - failed}/${rows.length} passed`)
  process.exit(failed ? 1 : 0)
}

async function findDocx(root, startDir) {
  const queue = startDir ? [startDir] : ['']
  const seen = new Set()
  let scanned = 0
  const deadline = Date.now() + 45000
  while (queue.length && scanned < 60 && Date.now() < deadline) {
    const dir = queue.shift()
    seen.add(dir)
    const listing = await get(`/list?root=${q(root)}&path=${q(dir)}`, { timeout: 60000 })
    for (const entry of listing.json?.entries ?? []) {
      const path = dir ? `${dir}/${entry.name}` : entry.name
      if (entry.kind === 'file' && /\.docx$/i.test(entry.name)) return path
      if (entry.kind === 'dir' && !seen.has(path) && queue.length < 200) queue.push(path)
    }
    scanned += 1
  }
  return null
}

main().catch((error) => {
  console.error('check-live failed:', error?.message ?? error)
  process.exit(1)
})
