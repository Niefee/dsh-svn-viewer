import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFile, spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { readdir, readFile, stat } from 'node:fs/promises'
import { createGunzip, createGzip } from 'node:zlib'
import { createHash } from 'node:crypto'
import { extractOfficeText } from './office.js'
import path from 'node:path'
import {
  TEXT_LIMIT,
  classify,
  decodeText,
  hasNul,
  isBinaryName,
  isUrlRoot,
  joinPath,
  languageOf,
  parseInfo,
  parseList,
  parseLog,
  parseStatus,
  resolveRoot,
  runSvn,
  VIDEO,
} from './svn.js'

export const name = 'dsh-svn-viewer'
export const inject = ['webServer']

const PREFIX = '/dsh-svn'
const TEXT_EXTS = new Set(['txt', 'md', 'markdown', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'css', 'scss', 'less', 'html', 'htm', 'xml', 'yml', 'yaml', 'sql', 'py', 'java', 'cs', 'c', 'h', 'cpp', 'hpp', 'go', 'rs', 'php', 'rb', 'sh', 'ps1', 'bat', 'ini', 'conf', 'toml', 'properties', 'csv', 'tsv', 'log', 'vue'])
const MAX_RAW = 100 * 1024 * 1024

/** Views the client renders itself from raw bytes (no server-side extraction). */
const DOCX_VIEW = new Set(['docx'])
const SHEET_VIEW = new Set(['xlsx', 'xls', 'xlsm', 'xlsb', 'ods'])
const SLIDES_VIEW = new Set(['pptx'])

/** Whitelisted browser libraries served from ./assets. */
const ASSET_TYPES = new Map([
  ['docx-preview.min.js', 'application/javascript; charset=utf-8'],
  ['jszip.min.js', 'application/javascript; charset=utf-8'],
  ['xlsx.core.min.js', 'application/javascript; charset=utf-8'],
  ['pptx-preview.umd.js', 'application/javascript; charset=utf-8'],
])

/* ---------------------------------------------------------------- helpers */

function json(res, code, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

function fail(res, code, error, detail) {
  json(res, code, { ok: false, error, detail: detail ?? null })
}

const cache = new Map()
function readCache(key, ttl) {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > ttl) { cache.delete(key); return null }
  return hit.value
}
function writeCache(key, value) {
  if (cache.size > 800) cache.clear()
  cache.set(key, { at: Date.now(), value })
  return value
}

let active = 0
const waiting = []
async function limited(task) {
  if (active >= 4) await new Promise((resolve) => waiting.push(resolve))
  active += 1
  try {
    return await task()
  } finally {
    active -= 1
    const next = waiting.shift()
    if (next) next()
  }
}

function svnError(result) {
  if (result.spawn === false) return { code: 409, error: 'svn-unavailable', detail: result.err }
  const err = String(result.err ?? '')
  if (/E170001|Authentication failed|authorization failed/i.test(err)) return { code: 401, error: 'svn-auth', detail: err }
  if (/E155007|is not a working copy/i.test(err)) return { code: 400, error: 'not-a-working-copy', detail: err }
  if (/E200009|E160013|E195012|path not found|doesn't exist|is not under version control/i.test(err)) return { code: 404, error: 'not-found', detail: err }
  if (/E170013|E670002|Unable to connect|Could not resolve|Connection refused/i.test(err)) return { code: 502, error: 'svn-unreachable', detail: err }
  if (result.timeout) return { code: 504, error: 'svn-timeout', detail: err }
  return { code: 500, error: 'svn-failed', detail: err || `exit ${result.code}` }
}

async function svnXml(args, options = {}) {
  const result = await limited(() => runSvn(args, options))
  if (result.code !== 0) throw Object.assign(new Error('svn-failed'), { svn: svnError(result) })
  return result.out.toString('utf8')
}

async function svnBytes(args, options = {}) {
  const result = await limited(() => runSvn(args, options))
  if (result.code !== 0) throw Object.assign(new Error('svn-failed'), { svn: svnError(result) })
  return result.out
}

function rootOf(url) {
  const root = resolveRoot(url.searchParams.get('root'))
  return root
}

const wcUrlCache = new Map()
async function wcUrlOf(base) {
  const hit = wcUrlCache.get(base)
  if (hit && Date.now() - hit.at < 120000) return hit.value
  try {
    const xml = await svnXml(['info', '--xml', '--non-interactive', base], { timeout: 15000 })
    const info = parseInfo(xml)
    wcUrlCache.set(base, { at: Date.now(), value: info.url })
    return info.url
  } catch {
    return null
  }
}

async function targetOf(root, url) {
  const joined = joinPath(root, url.searchParams.get('path'))
  if (!joined) return null
  if (root.kind === 'wc') {
    const wcUrl = await wcUrlOf(root.base)
    const encoded = joined.rel.split('/').filter(Boolean).map((part) => encodeURIComponent(part)).join('/')
    return {
      rel: joined.rel,
      local: joined.local,
      target: joined.local,
      url: wcUrl ? `${wcUrl}${encoded ? `/${encoded}` : ''}` : null,
    }
  }
  return { rel: joined.rel, target: joined.url, local: null, url: joined.url }
}

/** Prefer the on-disk path when it exists (fast, offline); otherwise use the repository URL (sparse checkouts). */
function svnTargetOf(target) {
  if (target.local && existsSync(target.local)) return target.local
  return target.url ?? target.target
}

function revOf(url) {
  const raw = url.searchParams.get('rev')
  if (!raw || raw === 'HEAD' || raw === 'WORKING') return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

function normalizeStatusKey(key, base) {
  const normalized = String(key ?? '').replace(/\\/g, '/')
  if (path.isAbsolute(normalized)) {
    return path.relative(base, normalized).replace(/\\/g, '/')
  }
  return normalized.replace(/^\.\//, '')
}

/* --------------------------------------------------------------- handlers */

async function handleInfo(res, url) {
  const root = rootOf(url)
  if (!root.ok) return fail(res, 400, root.error, root.detail)
  const args = ['info', '--xml', '--non-interactive', root.base]
  const xml = await svnXml(args, { timeout: 15000 })
  const info = parseInfo(xml)
  return json(res, 200, { ok: true, root: root.base, kind: root.kind, info })
}

async function handleList(res, url) {
  const root = rootOf(url)
  if (!root.ok) return fail(res, 400, root.error, root.detail)
  const target = await targetOf(root, url)
  if (!target) return fail(res, 400, 'path-out-of-root')
  const rev = revOf(url)
  const key = `list|${root.kind}|${root.base}|${target.rel}|${rev ?? 'WORKING'}`
  const cached = readCache(key, 30000)
  if (cached) return json(res, 200, cached)

  let entries = []
  let note = null
  if (root.kind === 'wc') {
    const localDir = target.local
    let fsEntries = []
    const dirExists = existsSync(localDir)
    if (dirExists) {
      try {
        fsEntries = await readdir(localDir, { withFileTypes: true })
      } catch {
        fsEntries = []
      }
    }
    entries = fsEntries
      .filter((item) => item.name !== '.svn')
      .map((item) => ({ name: item.name, kind: item.isDirectory() ? 'dir' : 'file', size: 0, rev: 0, author: '', date: '', local: true }))

    const remoteArgs = ['list', '--xml', '--non-interactive']
    if (rev) remoteArgs.push('-r', String(rev))
    remoteArgs.push(dirExists ? localDir : (target.url ?? localDir))
    try {
      const meta = parseList(await svnXml(remoteArgs, { timeout: 15000 }))
      const byName = new Map(meta.map((entry) => [entry.name, entry]))
      entries = entries.map((entry) => {
        const hit = byName.get(entry.name)
        return hit ? { ...entry, ...hit, local: true } : entry
      })
      for (const extra of meta) {
        if (!entries.some((entry) => entry.name === extra.name)) entries.push({ ...extra, local: false })
      }

    } catch (error) {
      note = error.svn?.error ?? 'list-metadata-failed'
    }

    try {
      if (!dirExists) throw new Error('skip-status')
      const statusXml = await svnXml(['status', '--xml', '--non-interactive', localDir], { timeout: 8000 })
      const map = parseStatus(statusXml)
      for (const entry of entries) {
        const keyPath = normalizeStatusKey(path.join(localDir, entry.name), root.base)
        const item = map[keyPath] ?? map[entry.name]
        if (item && item !== 'normal') entry.status = item
      }
    } catch { /* status is optional */ }
  } else {
    const args = ['list', '--xml', '--non-interactive']
    if (rev) args.push('-r', String(rev))
    args.push(target.url)
    entries = parseList(await svnXml(args, { timeout: 20000 }))
  }

  entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
  if (!note && entries.some((entry) => entry.local === false)) note = 'sparse-working-copy'
  const payload = {
    ok: true,
    root: root.base,
    kind: root.kind,
    rev: rev ?? null,
    path: target.rel,
    entries,
    note,
  }
  return json(res, 200, writeCache(key, payload))
}

async function readBytes(root, target, rev, limit = MAX_RAW) {
  if (root.kind === 'wc' && !rev && target.local && existsSync(target.local)) {
    const info = await stat(target.local)
    if (info.isDirectory()) throw Object.assign(new Error('is-directory'), { svn: { code: 400, error: 'is-directory' } })
    if (info.size > limit) return { tooLarge: true, size: info.size }
    return { bytes: await readFile(target.local), size: info.size, mtimeMs: info.mtimeMs }
  }
  const args = ['cat', '--non-interactive']
  if (rev) args.push('-r', String(rev))
  args.push(svnTargetOf(target))
  const bytes = await svnBytes(args, { timeout: 30000, maxBytes: limit })
  return { bytes, size: bytes.length, mtimeMs: 0 }
}

async function handleFile(res, url) {
  const root = rootOf(url)
  if (!root.ok) return fail(res, 400, root.error, root.detail)
  const target = await targetOf(root, url)
  if (!target) return fail(res, 400, 'path-out-of-root')
  if (!target.rel) return fail(res, 400, 'file-required')
  const rev = revOf(url)
  const name = target.rel.split('/').pop() ?? target.rel
  const forceText = url.searchParams.get('text') === '1'
  const key = `file|${root.kind}|${root.base}|${target.rel}|${rev ?? 'WORKING'}|${forceText ? 'text' : 'raw'}`
  const cached = readCache(key, 60000)
  if (cached) return json(res, 200, cached)

  let payload
  try {
    // Videos stream straight from /raw: only probe the size, never load the bytes here.
    const videoExt = path.extname(name).slice(1).toLowerCase()
    if (!forceText && VIDEO.has(videoExt)) {
      let size = 0
      let mtimeMs = 0
      try {
        if (root.kind === 'wc' && !rev && target.local && existsSync(target.local)) {
          const local = await stat(target.local)
          size = local.size
          mtimeMs = local.mtimeMs ?? 0
        } else {
          size = await probeSize(root, target, rev)
        }
      } catch { /* size stays 0: the player streams regardless */ }
      payload = {
        ok: true, path: target.rel, name, size, mtimeMs, rev: rev ?? null,
        encoding: null, language: null, view: 'video', reason: null,
      }
      return json(res, 200, writeCache(key, payload))
    }
    const loaded = await readBytes(root, target, rev)
    if (loaded.tooLarge) {
      payload = { ok: true, path: target.rel, name, view: 'too-large', size: loaded.size, rev: rev ?? null }
    } else {
      const bytes = loaded.bytes
      const kind = classify(name, bytes)
      const ext = path.extname(name).slice(1).toLowerCase()
      const base = {
        ok: true,
        path: target.rel,
        name,
        size: loaded.size,
        mtimeMs: loaded.mtimeMs ?? 0,
        rev: rev ?? null,
        encoding: null,
        language: null,
        view: kind.view,
        reason: null,
      }
      if (!forceText && DOCX_VIEW.has(ext)) {
        payload = { ...base, view: 'docx' }
        return json(res, 200, writeCache(key, payload))
      }
      if (!forceText && SHEET_VIEW.has(ext)) {
        payload = { ...base, view: 'spreadsheet' }
        return json(res, 200, writeCache(key, payload))
      }
      if (!forceText && SLIDES_VIEW.has(ext)) {
        const office = await extractOfficeText(name, bytes)
        payload = office.ok
          ? { ...base, view: 'pptx', officeKind: office.kind, encoding: 'utf-8', language: 'text', truncated: office.truncated, content: office.text }
          : { ...base, view: 'binary', reason: 'extract-failed' }
        return json(res, 200, writeCache(key, payload))
      }
      if (kind.view === 'office') {
        const office = await extractOfficeText(name, bytes)
        if (office.ok) {
          payload = {
            ...base,
            view: 'office-text',
            officeKind: office.kind,
            encoding: 'utf-8',
            language: 'text',
            truncated: office.truncated,
            content: office.text,
          }
          return json(res, 200, writeCache(key, payload))
        }
      }
      if (kind.view === 'text') {
        const decoded = decodeText(bytes)
        const truncated = bytes.length > TEXT_LIMIT
        payload = {
          ...base,
          encoding: decoded.encoding,
          language: languageOf(name),
          truncated,
          content: truncated ? decoded.text.slice(0, TEXT_LIMIT) : decoded.text,
        }
      } else {
        payload = base
      }
    }
  } catch (error) {
    if (error.svn) return fail(res, error.svn.code, error.svn.error, error.svn.detail)
    if (error?.code === 'ENOENT') return fail(res, 404, 'file-not-found', target.rel)
    if (error?.code === 'EISDIR') return fail(res, 400, 'is-directory', target.rel)
    return fail(res, 500, 'read-failed', String(error?.message ?? error))
  }
  return json(res, 200, writeCache(key, payload))
}

const RAW_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif', pdf: 'application/pdf',
  mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', m4v: 'video/x-m4v', mov: 'video/quicktime',
}

/** Cheap size probe used by /file (video) and /stream: stat for working copies, svn list for repos. */
async function probeSize(root, target, rev) {
  if (root.kind === 'wc' && !rev && target.local && existsSync(target.local)) {
    const info = await stat(target.local)
    return info.size
  }
  const listed = await runSvn(['list', '--xml', '--non-interactive', svnTargetOf(target)], { timeout: 20000 })
  if (listed.code !== 0) throw Object.assign(new Error('svn-failed'), { svn: svnError(listed) })
  const match = /<size>(\d+)<\/size>/.exec(listed.out.toString('utf8'))
  return match ? Number(match[1]) : 0
}

/** Pipe file bytes without buffering: working copy from disk, repos straight from svn cat stdout. */
async function handleStream(req, res, url) {
  const root = rootOf(url)
  if (!root.ok) return fail(res, 400, root.error, root.detail)
  const target = await targetOf(root, url)
  if (!target) return fail(res, 400, 'path-out-of-root')
  if (!target.rel) return fail(res, 400, 'file-required')
  const rev = revOf(url)
  const name = target.rel.split('/').pop() ?? target.rel
  const ext = path.extname(name).slice(1).toLowerCase()
  const type = RAW_TYPES[ext] ?? 'application/octet-stream'
  try {
    const size = await probeSize(root, target, rev)
    const headers = {
      'content-type': type,
      'cache-control': 'no-store',
      'content-disposition': `inline; filename="download"; filename*=UTF-8''${encodeURIComponent(name)}`,
    }
    if (size) headers['content-length'] = String(size)
    if (root.kind === 'wc' && !rev && target.local && existsSync(target.local)) {
      res.writeHead(200, headers)
      if (req.method === 'HEAD') { res.end(); return }
      createReadStream(target.local).pipe(res)
      return
    }
    const args = ['cat', '--non-interactive']
    if (rev) args.push('-r', String(rev))
    args.push(svnTargetOf(target))
    const child = spawn('svn', args, { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
    child.on('error', () => { if (!res.headersSent) fail(res, 500, 'stream-failed', 'svn spawn error'); else res.destroy() })
    child.on('close', (code) => {
      if (code !== 0 && !res.headersSent) fail(res, 500, 'svn-failed', `exit ${code} ${stderr.slice(0, 200)}`)
      else if (code !== 0) res.destroy()
      else res.end()
    })
    res.writeHead(200, headers)
    if (req.method === 'HEAD') { child.kill(); res.end(); return }
    child.stdout.pipe(res)
  } catch (error) {
    if (error.svn) return fail(res, error.svn.code, error.svn.error, error.svn.detail)
    return fail(res, 500, 'stream-failed', String(error?.message ?? error))
  }
}

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header ?? '').trim())
  if (!match) return null
  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return null
  let start
  let end
  if (!rawStart) {
    const suffix = Number(rawEnd)
    if (!Number.isFinite(suffix) || suffix <= 0) return 'invalid'
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd ? Number(rawEnd) : size - 1
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return 'invalid'
  return { start, end: Math.min(end, size - 1) }
}

function rawHeaders(type, name, size) {
  const headers = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'content-disposition': `inline; filename="download"; filename*=UTF-8''${encodeURIComponent(name)}`,
  }
  if (size !== undefined) headers['content-length'] = String(size)
  return headers
}

async function handleRaw(req, res, url) {
  const root = rootOf(url)
  if (!root.ok) return fail(res, 400, root.error, root.detail)
  const target = await targetOf(root, url)
  if (!target) return fail(res, 400, 'path-out-of-root')
  const rev = revOf(url)
  const name = target.rel.split('/').pop() ?? ''
  const ext = path.extname(name).slice(1).toLowerCase()
  const type = RAW_TYPES[ext] ?? 'application/octet-stream'
  try {
    if (root.kind === 'wc' && !rev && target.local && existsSync(target.local)) {
      const info = await stat(target.local)
      const range = req.headers.range ? parseRange(req.headers.range, info.size) : null
      if (range === 'invalid') {
        res.writeHead(416, { ...rawHeaders(type, name), 'content-range': `bytes */${info.size}` })
        res.end()
        return
      }
      if (range) {
        res.writeHead(206, {
          ...rawHeaders(type, name, range.end - range.start + 1),
          'content-range': `bytes ${range.start}-${range.end}/${info.size}`,
        })
        if (req.method === 'HEAD') { res.end(); return }
        createReadStream(target.local, { start: range.start, end: range.end }).pipe(res)
        return
      }
      res.writeHead(200, rawHeaders(type, name, info.size))
      if (req.method === 'HEAD') { res.end(); return }
      createReadStream(target.local).pipe(res)
      return
    }
    const args = ['cat', '--non-interactive']
    if (rev) args.push('-r', String(rev))
    args.push(svnTargetOf(target))
    // Remote reads buffer the whole blob: the full raw budget, or svn cat gets killed mid-stream
    // (exit null -> 500) for anything above the old 16 MB default, breaking pptx/image previews.
    const bytes = await svnBytes(args, { timeout: 120000, maxBytes: MAX_RAW })
    const range = req.headers.range ? parseRange(req.headers.range, bytes.length) : null
    if (range === 'invalid') {
      res.writeHead(416, { ...rawHeaders(type, name), 'content-range': `bytes */${bytes.length}` })
      res.end()
      return
    }
    if (range) {
      const slice = bytes.subarray(range.start, range.end + 1)
      res.writeHead(206, {
        ...rawHeaders(type, name, slice.length),
        'content-range': `bytes ${range.start}-${range.end}/${bytes.length}`,
      })
      res.end(req.method === 'HEAD' ? undefined : slice)
      return
    }
    res.writeHead(200, rawHeaders(type, name, bytes.length))
    res.end(req.method === 'HEAD' ? undefined : bytes)
  } catch (error) {
    if (error.svn) return fail(res, error.svn.code, error.svn.error, error.svn.detail)
    return fail(res, 404, 'raw-failed', String(error?.message ?? error))
  }
}

/** Serve the vendored browser libraries used by the preview views. */
async function handleAsset(res, url, sub) {
  const name = decodeURIComponent(sub.slice('/assets/'.length))
  const type = ASSET_TYPES.get(name)
  if (!type) return fail(res, 404, 'asset-not-found', name)
  try {
    const file = new URL(`../assets/${name}`, import.meta.url)
    const bytes = await readFile(file)
    res.writeHead(200, {
      'content-type': type,
      'content-length': String(bytes.length),
      'cache-control': 'public, max-age=86400',
    })
    res.end(bytes)
  } catch (error) {
    return fail(res, 500, 'asset-read-failed', String(error?.message ?? error))
  }
}

async function handleLog(res, url) {
  const root = rootOf(url)
  if (!root.ok) return fail(res, 400, root.error, root.detail)
  const target = await targetOf(root, url)
  if (!target) return fail(res, 400, 'path-out-of-root')
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 30) || 30, 1), 200)
  const before = Number(url.searchParams.get('before') ?? 0) || 0
  const args = ['log', '--xml', '--non-interactive', '-l', String(limit)]
  if (before > 1) args.push('-r', `${before - 1}:1`)
  args.push(svnTargetOf(target))
  const xml = await svnXml(args, { timeout: 30000 })
  return json(res, 200, { ok: true, path: target.rel, entries: parseLog(xml), before: before || null })
}

async function handleDiff(res, url) {
  const root = rootOf(url)
  if (!root.ok) return fail(res, 400, root.error, root.detail)
  const target = await targetOf(root, url)
  if (!target) return fail(res, 400, 'path-out-of-root')
  // svn diff would fetch both full texts of a binary just to say "cannot display": answer early.
  if (isBinaryName(path.basename(target.rel))) {
    return json(res, 200, { ok: true, path: target.rel, binary: true, rev: revOf(url) ?? null, lines: [], stat: { add: 0, del: 0 } })
  }
  const rev = revOf(url)
  const range = url.searchParams.get('range')
  const args = ['diff', '--non-interactive', '--internal-diff']
  let effRev = rev ?? null
  if (range && /^\d+:\d+$/.test(range)) args.push('-r', range)
  else if (rev) args.push('-c', String(rev))
  else if (root.kind === 'url') {
    // URL targets reject a bare diff (E195002): fall back to the file's last-changed revision.
    let last = 0
    try {
      last = Number((await svnBytes(['info', '--show-item', 'last-changed-revision', '--non-interactive', svnTargetOf(target)], { timeout: 20000, maxBytes: 64 })).toString('utf8').trim()) || 0
    } catch { /* stays 0 */ }
    if (last < 1) return json(res, 200, { ok: true, path: target.rel, rev: null, note: 'no-previous', lines: [], stat: { add: 0, del: 0 } })
    effRev = last
    args.push('-c', String(last))
  }
  // No revision on a working copy: compare it against BASE.
  args.push(svnTargetOf(target))
  let text
  try {
    const buf = await svnBytes(args, { timeout: 30000, maxBytes: 8 * 1024 * 1024 })
    text = buf.toString(guessEncoding(buf))
  } catch (error) {
    return fail(res, 500, 'diff-failed', String(error?.message ?? error))
  }
  const lines = text.split(/\r?\n/)
  const parsed = lines.map((line) => {
    if (line.startsWith('+++') || line.startsWith('---')) return { kind: 'meta', text: line }
    if (line.startsWith('@@')) return { kind: 'hunk', text: line }
    if (line.startsWith('+')) return { kind: 'add', text: line.slice(1) }
    if (line.startsWith('-')) return { kind: 'del', text: line.slice(1) }
    if (line.startsWith('Index:') || line.startsWith('=====')) return { kind: 'file', text: line }
    return { kind: 'ctx', text: line }
  })
  const stat = { add: 0, del: 0 }
  for (const line of parsed) {
    if (line.kind === 'add') stat.add += 1
    if (line.kind === 'del') stat.del += 1
  }
  // 0.3.16：Index:/====/+++/--- 原始头是给机器的，不进 payload；无变更时 lines 为空，客户端走白话空态。
  const content = parsed.filter((line) => line.kind !== 'file' && line.kind !== 'meta')
  return json(res, 200, { ok: true, path: target.rel, rev: effRev, range: range ?? null, lines: content, stat })
}

async function handleBlame(res, url) {
  const root = rootOf(url)
  if (!root.ok) return fail(res, 400, root.error, root.detail)
  const target = await targetOf(root, url)
  if (!target) return fail(res, 400, 'path-out-of-root')
  const rev = revOf(url)
  const args = ['blame', '--xml', '--non-interactive']
  if (rev) args.push('-r', String(rev))
  args.push(svnTargetOf(target))
  const xml = await svnXml(args, { timeout: 30000 })
  const blocks = xml.match(/<entry\b[\s\S]*?<\/entry>/g) ?? []
  const lines = blocks.map((block) => ({
    line: Number(block.match(/line-number="(\d+)"/)?.[1] ?? 0),
    rev: Number(block.match(/<commit\b[^>]*revision="(\d+)"/)?.[1] ?? 0),
    author: (block.match(/<author>([\s\S]*?)<\/author>/)?.[1] ?? ''),
    text: (block.match(/<token>([\s\S]*?)<\/token>/)?.[1] ?? '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'),
  }))
  // 0.3.26：部分 SVN CLI 的 blame --xml 不输出 <token>（行文本全空）→ 回退非 XML blame 逐行解析；仍空则用 cat 内容按行补齐。
  if (lines.length && lines.every((l) => !l.text)) {
    try {
      const plainBuf = await svnBytes(args.filter((a) => a !== '--xml'), { timeout: 30000 })
      const rows = plainBuf.toString(guessEncoding(plainBuf)).split(/\r?\n/)
      lines.forEach((l, i) => {
        const m = /^\s*(\d+)\s+(\S+)\s?(.*)$/.exec(rows[i] ?? '')
        if (m) { l.rev = Number(m[1]) || l.rev; l.author = m[2] || l.author; l.text = m[3] }
      })
      if (lines.every((l) => !l.text)) {
        const catArgs = ['cat', '--non-interactive']
        if (rev) catArgs.push('-r', String(rev))
        catArgs.push(svnTargetOf(target))
        const catBuf = await svnBytes(catArgs, { timeout: 30000 })
        const catLines = catBuf.toString(guessEncoding(catBuf)).split(/\r?\n/)
        lines.forEach((l, i) => { if (!l.text) l.text = catLines[i] ?? '' })
      }
    } catch { /* 保留修订栏，行文本空好过整页报错 */ }
  }
  return json(res, 200, { ok: true, path: target.rel, lines })
}

async function handleStatus(res, url) {
  const root = rootOf(url)
  if (!root.ok) return fail(res, 400, root.error, root.detail)
  if (root.kind !== 'wc') return json(res, 200, { ok: true, kind: 'url', entries: {} })
  const key = `status|${root.base}`
  const cached = readCache(key, 8000)
  if (cached) return json(res, 200, cached)
  const xml = await svnXml(['status', '--xml', '--non-interactive', root.base], { timeout: 20000 })
  const map = parseStatus(xml)
  const entries = {}
  for (const [itemPath, item] of Object.entries(map)) {
    entries[normalizeStatusKey(itemPath, root.base)] = item
  }
  const payload = { ok: true, kind: 'wc', entries }
  return json(res, 200, writeCache(key, payload))
}

async function walkLocal(base, options = {}) {
  const { maxDepth = 12, maxEntries = 20000, budgetMs = 8000 } = options
  const started = Date.now()
  const files = []
  const dirs = []
  let truncated = false
  const queue = [{ rel: '', depth: 0 }]
  while (queue.length) {
    if (Date.now() - started > budgetMs) { truncated = true; break }
    const { rel, depth } = queue.shift()
    const abs = rel ? path.join(base, ...rel.split('/')) : base
    let items = []
    try { items = await readdir(abs, { withFileTypes: true }) } catch { continue }
    for (const item of items) {
      if (item.name === '.svn') continue
      const childRel = rel ? `${rel}/${item.name}` : item.name
      if (item.isDirectory()) {
        dirs.push({ name: childRel, kind: 'dir', size: 0 })
        if (depth + 1 < maxDepth) queue.push({ rel: childRel, depth: depth + 1 })
        else truncated = true
      } else if (item.isFile()) {
        if (files.length >= maxEntries) { truncated = true; break }
        let size = 0
        try { size = (await stat(`${abs}${path.sep}${item.name}`)).size } catch { /* ignore */ }
        files.push({ name: childRel, kind: 'file', size, rev: 0, author: '', date: '' })
      }
    }
    if (files.length >= maxEntries) { truncated = true; break }
  }
  return { entries: dirs.concat(files), truncated }
}

async function listUrlTree(base, options = {}) {
  const { maxDepth = 2, maxEntries = 1500, budgetMs = 15000 } = options
  const started = Date.now()
  const entries = []
  let truncated = false
  const queue = [{ rel: '', depth: 0 }]
  while (queue.length) {
    if (Date.now() - started > budgetMs || entries.length >= maxEntries) { truncated = true; break }
    const { rel, depth } = queue.shift()
    const joined = joinPath({ kind: 'url', base }, rel)
    if (!joined) continue
    let listed = []
    try {
      listed = parseList(await svnXml(['list', '--xml', '--non-interactive', joined.url], { timeout: 15000 }))
    } catch { continue }
    for (const item of listed) {
      const childRel = rel ? `${rel}/${item.name}` : item.name
      entries.push({ ...item, name: childRel })
      if (item.kind === 'dir') {
        if (depth + 1 < maxDepth) queue.push({ rel: childRel, depth: depth + 1 })
        else truncated = true
      }
      if (entries.length >= maxEntries) { truncated = true; break }
    }
  }
  return { entries, truncated }
}

async function remoteRecursive(url, options = {}) {
  const { timeout = 25000, maxBytes = 24 * 1024 * 1024, maxEntries = 20000 } = options
  const xml = await svnXml(['list', '--xml', '-R', '--non-interactive', url], { timeout, maxBytes })
  const entries = parseList(xml)
  return { entries: entries.slice(0, maxEntries), truncated: entries.length > maxEntries }
}

// ---- 文件名索引：远程仓库一次性 svn list -R，落到 gz 缓存，之后按需扫描 ----
// 全仓库文件名搜索没法在请求里做完（大仓库实测百万级条目、分钟级耗时），
// 所以第一次搜索先建索引并回 indexing，客户端轮询，建好后每次搜索只读缓存（秒级）。
const NAME_INDEX_TTL = 7 * 24 * 3600 * 1000
let nameIndex = null
const headRevCache = new Map()

function nameIndexDir() {
  const dir = process.env.DSH_SVN_INDEX_DIR || path.join(tmpdir(), 'dsh-svn-viewer-index')
  mkdirSync(dir, { recursive: true })
  return dir
}

function urlHashOf(url) {
  return createHash('sha1').update(String(url)).digest('hex').slice(0, 12)
}

async function headRevOf(root) {
  const cached = headRevCache.get(root.base)
  if (cached && Date.now() - cached.at < 60000) return cached.rev
  if (root.kind !== 'url') return null
  try {
    const result = await limited(() => runSvn(['info', '--show-item', 'revision', '--non-interactive', root.base], { timeout: 15000 }))
    if (result.code !== 0) return null
    const rev = Number(result.out.toString('utf8').trim())
    if (!Number.isFinite(rev) || rev <= 0) return null
    headRevCache.set(root.base, { at: Date.now(), rev })
    return rev
  } catch {
    return null
  }
}

/** 判断一段 svn 输出是 UTF-8 还是 GBK（中文 Windows 下 svn 走 ANSI 码页输出）。 */
function guessEncoding(buffer) {
  let hasHigh = false
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] > 0x7f) { hasHigh = true; break }
  }
  if (!hasHigh) return 'utf8'
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return 'utf8'
  } catch {
    return 'gbk'
  }
}

/** 按整行切分（回退到最后一个 \n，保证不会把多字节字符切开）。 */
function makeLineSplitter(onLine) {
  let pending = Buffer.alloc(0)
  let encoding = null
  const take = (complete) => {
    if (!encoding) encoding = guessEncoding(complete)
    const text = encoding === 'gbk' ? new TextDecoder('gbk').decode(complete) : complete.toString('utf8')
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\r$/, '')
      if (line) onLine(line)
    }
  }
  return {
    push(chunk) {
      const buffer = pending.length ? Buffer.concat([pending, chunk]) : chunk
      const lastLf = buffer.lastIndexOf(10)
      if (lastLf < 0) { pending = Buffer.from(buffer); return }
      take(buffer.subarray(0, lastLf + 1))
      pending = Buffer.from(buffer.subarray(lastLf + 1))
    },
    end() {
      if (!pending.length) return
      take(pending)
      pending = Buffer.alloc(0)
    },
  }
}

function pruneIndexFiles(hash, keepFile) {
  let names = []
  try { names = readdirSync(nameIndexDir()) } catch { return }
  for (const name of names) {
    if (!name.startsWith(`names-${hash}-`)) continue
    const full = path.join(nameIndexDir(), name)
    if (full === keepFile) continue
    try { rmSync(full, { force: true }) } catch { /* 忽略清理失败 */ }
  }
}

/** 找当前（url, HEAD rev）对应的索引：ready 直接用；没有就返回 idle 由调用方决定是否开建。 */
async function indexStateOf(root) {
  if (root.kind !== 'url') return null
  const hash = urlHashOf(root.base)
  const rev = await headRevOf(root)
  const key = `${hash}-${rev ?? 'head'}`
  if (nameIndex && nameIndex.key === key && nameIndex.phase !== 'error' && nameIndex.phase !== 'cancelled') return nameIndex
  if (nameIndex && nameIndex.phase === 'error' && Date.now() - (nameIndex.failedAt ?? 0) < 60000) {
    return { key, url: root.base, rev, phase: 'error' }
  }
  const file = path.join(nameIndexDir(), `names-${key}.txt.gz`)
  if (existsSync(file)) {
    try {
      const info = statSync(file)
      if (Date.now() - info.mtimeMs < NAME_INDEX_TTL) {
        let count = 0
        try {
          const meta = JSON.parse(readFileSync(file.replace(/\.txt\.gz$/, '.meta.json'), 'utf8'))
          if (Number.isFinite(meta?.count)) count = meta.count
        } catch { /* meta 缺失按 0 处理 */ }
        nameIndex = { key, url: root.base, rev, phase: 'ready', file, scanned: count, bytes: info.size, startedAt: 0 }
        return nameIndex
      }
      rmSync(file, { force: true })
    } catch { /* 忽略损坏的缓存 */ }
  }
  return { key, url: root.base, rev, phase: 'idle' }
}

function startIndexBuild(root, key, rev) {
  const file = path.join(nameIndexDir(), `names-${key}.txt.gz`)
  const tmp = `${file}.part`
  const hash = key.split('-')[0]
  const job = { key, url: root.base, rev, phase: 'building', scanned: 0, startedAt: Date.now(), file, tmp, error: null, child: null, bytes: 0 }
  const gzip = createGzip({ level: 6 })
  const sink = createWriteStream(tmp)
  let buffered = []
  let paused = false
  const flush = (force = false) => {
    if (!buffered.length) return
    if (!force && buffered.length < 4096) return
    const batch = buffered.join('')
    buffered = []
    if (!gzip.write(batch) && !paused && job.child?.stdout) {
      paused = true
      job.child.stdout.pause()
      gzip.once('drain', () => { paused = false; job.child?.stdout?.resume() })
    }
  }
  gzip.pipe(sink)
  const child = spawn('svn', ['list', '-R', '--non-interactive', root.base], { windowsHide: true })
  job.child = child
  const splitter = makeLineSplitter((line) => {
    job.scanned += 1
    buffered.push(line, '\n')
    flush()
  })
  child.stdout.on('data', (chunk) => { splitter.push(chunk); flush() })
  child.stderr.on('data', () => {})
  child.on('error', (error) => {
    job.error = String(error?.message ?? error)
    job.failedAt = Date.now()
    job.phase = 'error'
    try { rmSync(tmp, { force: true }) } catch { /* 忽略 */ }
  })
  child.on('close', (code) => {
    splitter.end()
    flush(true)
    gzip.end()
    sink.on('close', () => {
      if (job.phase === 'error') return
      if (code !== 0) {
        job.error = `svn list 退出码 ${code}`
        job.failedAt = Date.now()
        job.phase = 'error'
        try { rmSync(tmp, { force: true }) } catch { /* 忽略 */ }
        return
      }
      try {
        renameSync(tmp, file)
        job.bytes = statSync(file).size
        try {
          writeFileSync(file.replace(/\.txt\.gz$/, '.meta.json'), JSON.stringify({ rev: job.rev, count: job.scanned, bytes: job.bytes, builtAt: Date.now() }), 'utf8')
        } catch { /* meta 写失败不影响搜索 */ }
        job.phase = 'ready'
        job.finishedAt = Date.now()
        job.child = null
        pruneIndexFiles(hash, file)
      } catch (error) {
        job.error = String(error?.message ?? error)
        job.failedAt = Date.now()
        job.phase = 'error'
      }
    })
  })
  nameIndex = job
  return job
}

async function searchIndexFile(job, terms, scope, limit) {
  const started = Date.now()
  const hits = []
  const prefix = scope ? `${scope}/` : ''
  let total = 0
  let scanned = 0
  const splitter = makeLineSplitter((line) => {
    scanned += 1
    if (prefix && !line.startsWith(prefix)) return
    const lower = line.toLowerCase()
    if (!terms.every((term) => lower.includes(term))) return
    total += 1
    if (hits.length >= limit) return
    const isDir = line.endsWith('/')
    const clean = isDir ? line.slice(0, -1) : line
    hits.push({
      path: clean, name: clean.split('/').pop() || clean,
      kind: isDir ? 'dir' : 'file', size: 0, rev: null, author: null, date: null, count: 1, indexed: true,
    })
  })
  const stream = createReadStream(job.file).pipe(createGunzip())
  for await (const chunk of stream) splitter.push(chunk)
  splitter.end()
  return { hits, total, scanned, elapsedMs: Date.now() - started }
}

/** 目录选择器：列出磁盘与子目录（只读，只返回目录名与绝对路径）。 */
async function handleFs(res, url) {
  const raw = String(url.searchParams.get('path') ?? '').trim()
  if (!raw) {
    const drives = []
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const root = `${letter}:\\`
      try { if (existsSync(root)) drives.push({ name: `${letter}:`, path: root }) } catch { /* 跳过不可访问的盘 */ }
    }
    return json(res, 200, { ok: true, path: '', parent: null, entries: drives, mode: 'drives' })
  }
  let resolved
  try { resolved = path.resolve(raw) } catch { return fail(res, 400, 'bad-path', raw) }
  let info = null
  try { info = statSync(resolved) } catch { return fail(res, 404, 'not-found', resolved) }
  if (!info.isDirectory()) return fail(res, 400, 'not-a-directory', resolved)
  const entries = []
  try {
    for (const item of readdirSync(resolved, { withFileTypes: true })) {
      if (entries.length >= 500) break
      if (!item.isDirectory()) continue
      if (item.name.startsWith('.')) continue
      entries.push({ name: item.name, path: path.join(resolved, item.name) })
    }
  } catch (error) {
    return fail(res, 500, 'read-dir-failed', String(error?.message ?? error))
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  const parent = path.dirname(resolved)
  return json(res, 200, { ok: true, path: resolved, parent: parent === resolved ? null : parent, entries, mode: 'dirs' })
}

async function treeOf(root, scope, options = {}) {
  const key = `tree|${root.kind}|${root.base}|${scope}|${options.deep ? 'deep' : ''}`
  const cached = readCache(key, 300000)
  if (cached) return cached
  let result = { entries: [], truncated: false }
  const { deep = false } = options
  if (root.kind === 'url') {
    const joined = scope ? joinPath({ kind: 'url', base: root.base }, scope) : { url: root.base }
    if (deep) {
      try {
        const remote = await remoteRecursive(joined.url, { timeout: 20000, maxBytes: 24 * 1024 * 1024, maxEntries: 30000 })
        result = { entries: remote.entries, truncated: remote.truncated }
      } catch { /* fall back to the bounded walk below */ }
    }
    if (scope && !result.entries.length) {
      try {
        const remote = await remoteRecursive(joined.url)
        result = {
          entries: remote.entries.map((entry) => ({ ...entry, name: `${scope}/${entry.name}` })),
          truncated: remote.truncated,
        }
      } catch { /* fall back to a bounded breadth-first walk */ }
    }
    if (!result.entries.length) {
      const remote = await listUrlTree(joined.url, { maxDepth: scope ? 3 : 2, maxEntries: 1500, budgetMs: 12000 })
      result = {
        entries: remote.entries.map((entry) => (scope ? { ...entry, name: `${scope}/${entry.name}` } : entry)),
        truncated: remote.truncated,
      }
    }
  } else {
    const base = scope ? path.join(root.base, ...scope.split('/')) : root.base
    result = await walkLocal(base, { maxDepth: 24, maxEntries: 20000, budgetMs: 8000 })
    if (scope) result.entries = result.entries.map((entry) => ({ ...entry, name: `${scope}/${entry.name}` }))
    const fileCount = result.entries.filter((entry) => entry.kind === 'file').length
    if (fileCount < 5 && (scope || !result.entries.length)) {
      const wcUrl = await wcUrlOf(root.base)
      if (wcUrl) {
        const scopeUrl = scope ? joinPath({ kind: 'url', base: wcUrl }, scope) : { url: wcUrl }
        try {
          const remote = scope ? await remoteRecursive(scopeUrl.url) : await listUrlTree(wcUrl, { maxDepth: 2, maxEntries: 1500, budgetMs: 12000 })
          const known = new Set(result.entries.map((entry) => entry.name))
          for (const entry of remote.entries) {
            const name = scope ? `${scope}/${entry.name}` : entry.name
            if (!known.has(name)) result.entries.push({ ...entry, name })
          }
          result.truncated = result.truncated || remote.truncated
        } catch { /* keep the local view */ }
      }
    }
  }
  const payload = { ok: true, root: root.base, count: result.entries.length, truncated: result.truncated, entries: result.entries }
  return writeCache(key, payload)
}
async function handleTree(res, url) {
  const root = rootOf(url)
  if (!root.ok) return fail(res, 400, root.error, root.detail)
  const scope = String(url.searchParams.get('path') ?? '').replace(/^\/+|\/+$/g, '')
  const payload = await treeOf(root, scope)
  return json(res, 200, payload)
}

const CONTENT_TEXT_MAX = 1024 * 1024
const CONTENT_OFFICE_MAX = 8 * 1024 * 1024
const CONTENT_OFFICE_LIMIT = 200
const OFFICE_EXTS = new Set(['docx', 'xlsx', 'pptx'])

/** 全文搜索的候选：本地文本文件 + Office 文档（文本优先，Office 限 200 个）。 */
async function collectContentCandidates(base, budgetMs = 6000) {
  const started = Date.now()
  const all = []
  const stack = ['']
  let truncated = false
  while (stack.length) {
    if (Date.now() - started > budgetMs) { truncated = true; break }
    const rel = stack.pop()
    const abs = rel ? path.join(base, ...rel.split('/')) : base
    let items = []
    try { items = await readdir(abs, { withFileTypes: true }) } catch { continue }
    for (const item of items) {
      if (item.name === '.svn') continue
      const childRel = rel ? `${rel}/${item.name}` : item.name
      if (item.isDirectory()) { stack.push(childRel); continue }
      if (!item.isFile()) continue
      const ext = path.extname(item.name).slice(1).toLowerCase()
      const isText = TEXT_EXTS.has(ext)
      const isOffice = OFFICE_EXTS.has(ext)
      if (!isText && !isOffice) continue
      let size = 0
      try { size = (await stat(`${abs}${path.sep}${item.name}`)).size } catch { continue }
      if (isText && size > CONTENT_TEXT_MAX) continue
      if (isOffice && size > CONTENT_OFFICE_MAX) continue
      all.push({ name: childRel, kind: 'file', size, office: isOffice })
    }
    if (all.length > 6000) { truncated = true; break }
  }
  const texted = all.filter((entry) => !entry.office)
  const office = all.filter((entry) => entry.office).slice(0, CONTENT_OFFICE_LIMIT)
  return { entries: [...texted, ...office], truncated: truncated || office.length < all.filter((entry) => entry.office).length }
}

/** 在一段文本里找出命中行（最多 5 行）。 */
function matchLines(text, terms) {
  const matches = []
  const lines = String(text).split(/\r?\n/)
  for (let n = 0; n < lines.length && matches.length < 5; n += 1) {
    const line = lines[n]
    const lower = line.toLowerCase()
    if (terms.every((term) => lower.includes(term))) matches.push({ line: n + 1, text: line.slice(0, 300) })
  }
  return matches
}

async function handleSearch(res, url) {
  const root = rootOf(url)
  if (!root.ok) return fail(res, 400, root.error, root.detail)
  const query = String(url.searchParams.get('q') ?? '').trim()
  if (url.searchParams.get('cancel') === '1') {
    if (nameIndex && nameIndex.phase === 'building') {
      try { nameIndex.child?.kill() } catch { /* 忽略 */ }
      nameIndex = null
      return json(res, 200, { ok: true, cancelled: true })
    }
    return json(res, 200, { ok: true, cancelled: false })
  }
  if (!query) return fail(res, 400, 'query-required')
  const mode = url.searchParams.get('mode') === 'content' ? 'content' : 'name'
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 200)
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)

  const scope = String(url.searchParams.get('path') ?? '').replace(/^\/+|\/+$/g, '')

  if (mode === 'name') {
    // 有索引（或能建索引）时优先走全仓库索引；索引不可用时退回原来的目录检索
    const index = await indexStateOf(root)
    if (index && index.phase === 'ready') {
      const found = await searchIndexFile(index, terms, scope, limit)
      return json(res, 200, {
        ok: true, mode, query, total: found.total, files: found.hits,
        scanned: found.scanned, truncated: false, scope: scope || null, deep: !scope,
        indexed: true, indexedEntries: index.scanned || null, elapsedMs: found.elapsedMs,
      })
    }
    if (index && index.phase === 'building') {
      return json(res, 200, {
        ok: true, mode, query, total: 0, files: [], indexing: true,
        scanned: index.scanned, startedAgoMs: Date.now() - index.startedAt,
        scope: scope || null, deep: !scope,
      })
    }
    if (index && index.phase !== 'error' && !scope) {
      const job = startIndexBuild(root, index.key, index.rev)
      return json(res, 200, {
        ok: true, mode, query, total: 0, files: [], indexing: true,
        scanned: job.scanned, startedAgoMs: 0, scope: null, deep: true,
      })
    }
  }

  const deep = !scope && url.searchParams.get('mode') !== 'content'
  const tree = await treeOf(root, scope, { deep })
  const files = tree.entries.filter((entry) => entry.kind === 'file')

  if (mode === 'name') {
    const hits = tree.entries
      .filter((entry) => {
        const haystack = entry.name.toLowerCase()
        return terms.every((term) => haystack.includes(term))
      })
      .slice(0, limit)
      .map((entry) => ({
        path: entry.name,
        name: entry.name.split('/').pop(),
        kind: entry.kind,
        size: entry.size,
        rev: entry.rev,
        author: entry.author,
        date: entry.date,
        count: 1,
      }))
    return json(res, 200, {
      ok: true, mode, query, total: hits.length, files: hits,
      scanned: tree.entries.length, truncated: tree.truncated, scope: scope || null, deep,
    })
  }

  if (root.kind !== 'wc') {
    return fail(res, 400, 'content-search-needs-working-copy', '内容搜索需要本地工作副本；远程仓库只支持按文件名搜索。')
  }
  const started = Date.now()
  const collected = await collectContentCandidates(root.base)
  const candidates = collected.entries
  const results = []
  let scanned = 0
  for (let i = 0; i < candidates.length && results.length < limit; i += 6) {
    const batch = candidates.slice(i, i + 6)
    const found = await Promise.all(batch.map(async (entry) => {
      const local = path.join(root.base, ...entry.name.split('/'))
      try {
        const info = await stat(local)
        if (!info.isFile()) return null
        let text = ''
        if (entry.office) {
          const bytes = await readFile(local)
          const office = await extractOfficeText(entry.name, bytes)
          if (!office || !office.ok || !office.text) return null
          text = String(office.text)
        } else {
          if (info.size > 1024 * 1024) return null
          const buffer = await readFile(local)
          if (hasNul(buffer)) return null
          text = decodeText(buffer).text
        }
        const matched = matchLines(text, terms)
        if (!matched.length) return null
        return { path: entry.name, name: entry.name.split('/').pop(), size: entry.size, rev: entry.rev, author: entry.author, date: entry.date, count: matched.length, matches: matched, office: !!entry.office }
      } catch {
        return null
      }
    }))
    scanned += batch.length
    for (const item of found) if (item) results.push(item)
    if (Date.now() - started > 15000) break
  }
  return json(res, 200, {
    ok: true, mode, query, total: results.length,
    files: results.slice(0, limit), scanned,
    truncated: scanned < candidates.length,
    elapsedMs: Date.now() - started,
    scope: scope || null,
    treeTruncated: tree.truncated,
  })
}

async function findWorkingCopies(base, depth = 2) {
  const found = []
  const queue = [{ dir: base, level: 0 }]
  let visited = 0
  while (queue.length && visited < 400) {
    const { dir, level } = queue.shift()
    visited += 1
    let items = []
    try {
      items = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    if (items.some((item) => item.name === '.svn')) {
      found.push(dir)
      continue
    }
    if (level >= depth) continue
    for (const item of items) {
      if (!item.isDirectory() || item.name.startsWith('.') || item.name === 'node_modules') continue
      queue.push({ dir: path.join(dir, item.name), level: level + 1 })
    }
  }
  return found
}

function directorySize(dir, budget = 400 * 1024 * 1024) {
  let total = 0
  const queue = [dir]
  while (queue.length) {
    const current = queue.shift()
    let items = []
    try { items = readdirSync(current, { withFileTypes: true }) } catch { continue }
    for (const item of items) {
      const full = path.join(current, item.name)
      if (item.isDirectory()) queue.push(full)
      else {
        try { total += statSync(full).size } catch { /* ignore */ }
        if (total > budget) return total
      }
    }
  }
  return total
}

function safeFileName(value) {
  return String(value || 'export').replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 80) || 'export'
}

async function handleExport(res, url) {
  const root = rootOf(url)
  if (!root.ok) return fail(res, 400, root.error, root.detail)
  const target = await targetOf(root, url)
  if (!target) return fail(res, 400, 'path-out-of-root')
  const rev = revOf(url)
  const source = target.url ?? svnTargetOf(target)

  let isDirectory = true
  if (root.kind === 'wc' && target.local && existsSync(target.local)) {
    try { isDirectory = statSync(target.local).isDirectory() } catch { /* keep default */ }
  } else {
    try {
      const infoArgs = ['info', '--xml', '--non-interactive']
      if (rev) infoArgs.push('-r', String(rev))
      infoArgs.push(source)
      isDirectory = parseInfo(await svnXml(infoArgs, { timeout: 15000 })).kind === 'dir'
    } catch { /* keep default */ }
  }

  // Refuse an oversized export up front: a remote directory export can otherwise run for minutes.
  if (isDirectory) {
    let planned = { files: 0, bytes: 0, complete: false }
    try {
      const planArgs = ['list', '--xml', '-R', '--non-interactive']
      if (rev) planArgs.push('-r', String(rev))
      planArgs.push(source)
      const plannedXml = await svnXml(planArgs, { timeout: 10000, maxBytes: 12 * 1024 * 1024 })
      planned.complete = true
      for (const entry of parseList(plannedXml)) {
        if (entry.kind !== 'file') continue
        planned.files += 1
        planned.bytes += entry.size || 0
        if (planned.files > 800 || planned.bytes > 120 * 1024 * 1024) break
      }
    } catch { /* planning timed out or was truncated: treat as too large */ }
    if (!planned.complete || planned.files > 800 || planned.bytes > 120 * 1024 * 1024) {
      const detail = planned.complete
        ? `目录含约 ${planned.files} 个文件、${Math.round(planned.bytes / 1024 / 1024)} MB，请先进入子目录再导出`
        : '该目录过大，10 秒内无法完成统计；请进入更小的子目录再导出'
      return fail(res, 413, 'export-too-large', detail)
    }
  }

  const work = mkdtempSync(path.join(tmpdir(), 'dsh-svn-export-'))
  const outDir = path.join(work, 'export')
  const cleanup = () => { try { rmSync(work, { recursive: true, force: true }) } catch { /* ignore */ } }
  const args = ['export', '--force', '--non-interactive']
  if (rev) args.push('-r', String(rev))
  if (isDirectory) {
    args.push(source, outDir)
  } else {
    try { mkdirSync(outDir, { recursive: true }) } catch { /* ignore */ }
    args.push(source, path.join(outDir, safeFileName(target.rel.split('/').filter(Boolean).pop() ?? 'file')))
  }
  const exported = await limited(() => runSvn(args, { timeout: 90000 }))
  if (exported.code !== 0) {
    cleanup()
    const mapped = svnError(exported)
    return fail(res, mapped.code, mapped.error, mapped.detail)
  }
  const size = directorySize(outDir)
  if (size > 300 * 1024 * 1024) {
    cleanup()
    return fail(res, 413, 'export-too-large', `${Math.round(size / 1024 / 1024)} MB`)
  }
  const zipPath = path.join(work, 'bundle.zip')
  const packed = await new Promise((resolve) => {
    execFile('tar', ['-a', '-cf', zipPath, '-C', outDir, '.'], { timeout: 120000, windowsHide: true }, (error, _stdout, stderr) => {
      resolve({ error, stderr: String(stderr ?? '') })
    })
  })
  if (packed.error) {
    cleanup()
    return fail(res, 500, 'zip-failed', packed.stderr || String(packed.error?.message ?? packed.error))
  }
  const segment = target.rel.split('/').filter(Boolean).pop() ?? 'root'
  const fileName = `${safeFileName(segment)}-${rev ? `r${rev}` : 'working'}.zip`
  res.statusCode = 200
  res.setHeader('content-type', 'application/zip')
  res.setHeader('content-length', String(statSync(zipPath).size))
  const asciiName = (safeFileName(segment).replace(/[^\x20-\x7E]/g, '_') || 'export').slice(0, 60)
  res.setHeader('content-disposition', `attachment; filename="${asciiName}.zip"; filename*=UTF-8''${encodeURIComponent(fileName)}`)
  res.setHeader('cache-control', 'no-store')
  const stream = createReadStream(zipPath)
  stream.on('close', cleanup)
  stream.on('error', () => { cleanup(); try { res.end() } catch { /* ignore */ } })
  res.on('close', () => { try { stream.destroy() } catch { /* ignore */ } })
  stream.pipe(res)
}
async function handleContext(res, ctx) {
  const cwd = process.cwd()
  let defaultRoot = null
  let svnVersion = null
  try {
    const version = await limited(() => runSvn(['--version', '--quiet'], { timeout: 5000 }))
    if (version.code === 0) svnVersion = version.out.toString('utf8').trim()
  } catch { /* ignore */ }
  try {
    const info = await limited(() => runSvn(['info', '--xml', '--non-interactive', cwd], { timeout: 8000 }))
    if (info.code === 0) defaultRoot = cwd
  } catch { /* ignore */ }
  const candidates = []
  for (const candidate of [cwd, path.resolve(cwd, '..')]) {
    if (!candidates.includes(candidate)) candidates.push(candidate)
  }
  const repos = []
  try {
    const found = await findWorkingCopies(cwd, 2)
    for (const candidate of found.slice(0, 6)) {
      const probe = await limited(() => runSvn(['info', '--xml', '--non-interactive', candidate], { timeout: 8000 }))
      if (probe.code !== 0) continue
      const parsed = parseInfo(probe.out.toString('utf8'))
      if (!parsed.url) continue
      repos.push({ path: candidate, url: parsed.url, rev: parsed.revision })
    }
  } catch { /* ignore */ }
  if (!defaultRoot && repos.length) defaultRoot = repos[0].path
  return json(res, 200, {
    ok: true, cwd, defaultRoot, roots: repos.map((item) => item.path), repos,
    candidates, svnVersion, home: process.env.USERPROFILE ?? process.env.HOME ?? '',
  })
}

/* ------------------------------------------------------------------ apply */

export function apply(ctx) {
  // A newer version can be installed while an older row still owns the route: keep activation quiet.
  try { registerRoutes(ctx) } catch (error) { ctx.logger?.warn?.('dsh-svn-viewer: route registration skipped: ' + String(error?.message ?? error)) }
}

function registerRoutes(ctx) {
  ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const sub = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) || '/' : url.pathname
      try {
        if (req.method === 'GET' && sub === '/health') {
          const version = await limited(() => runSvn(['--version', '--quiet'], { timeout: 5000 }))
          return json(res, 200, { ok: version.code === 0, svn: version.out.toString('utf8').trim(), error: version.code === 0 ? null : version.err })
        }
        if (req.method === 'GET' && sub === '/context') return await handleContext(res, ctx)
        if (req.method === 'GET' && sub === '/info') return await handleInfo(res, url)
        if (req.method === 'GET' && sub === '/list') return await handleList(res, url)
        if (req.method === 'GET' && sub === '/file') return await handleFile(res, url)
        if ((req.method === 'GET' || req.method === 'HEAD') && sub === '/raw') return await handleRaw(req, res, url)
        if ((req.method === 'GET' || req.method === 'HEAD') && sub === '/stream') return await handleStream(req, res, url)
        if (req.method === 'GET' && sub === '/log') return await handleLog(res, url)
        if (req.method === 'GET' && sub === '/diff') return await handleDiff(res, url)
        if (req.method === 'GET' && sub === '/blame') return await handleBlame(res, url)
        if (req.method === 'GET' && sub === '/status') return await handleStatus(res, url)
        if (req.method === 'GET' && sub === '/tree') return await handleTree(res, url)
        if (req.method === 'GET' && sub === '/fs') return await handleFs(res, url)
        if (req.method === 'GET' && sub === '/search') return await handleSearch(res, url)
        if (req.method === 'GET' && sub === '/export') return await handleExport(res, url)
        if ((req.method === 'GET' || req.method === 'HEAD') && sub.startsWith('/assets/')) return await handleAsset(res, url, sub)
        return fail(res, 404, 'not-found', sub)
      } catch (error) {
        if (error?.svn) return fail(res, error.svn.code, error.svn.error, error.svn.detail)
        return fail(res, 500, 'internal-error', String(error?.stack ?? error))
      }
    },
  })
}

export { isUrlRoot }
