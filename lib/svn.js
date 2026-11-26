import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

export const TEXT_LIMIT = 2 * 1024 * 1024
export const SNIFF_BYTES = 8192

const OFFICE = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'docm', 'xlsm', 'pptm', 'odt', 'ods', 'odp'])
const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'])
const ARCHIVE = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz'])
export const VIDEO = new Set(['mp4', 'webm', 'ogv', 'm4v', 'mov'])
const CODE = new Map([
  ['js', 'javascript'], ['mjs', 'javascript'], ['cjs', 'javascript'], ['ts', 'typescript'], ['tsx', 'typescript'],
  ['jsx', 'javascript'], ['json', 'json'], ['css', 'css'], ['scss', 'scss'], ['less', 'less'], ['html', 'html'],
  ['htm', 'html'], ['xml', 'xml'], ['yml', 'yaml'], ['yaml', 'yaml'], ['md', 'markdown'], ['markdown', 'markdown'],
  ['py', 'python'], ['java', 'java'], ['cs', 'csharp'], ['c', 'c'], ['h', 'c'], ['cpp', 'cpp'], ['hpp', 'cpp'],
  ['go', 'go'], ['rs', 'rust'], ['php', 'php'], ['rb', 'ruby'], ['sh', 'shell'], ['ps1', 'powershell'],
  ['bat', 'bat'], ['sql', 'sql'], ['vue', 'html'], ['ini', 'ini'], ['conf', 'ini'], ['toml', 'ini'],
  ['properties', 'ini'], ['txt', 'text'], ['log', 'text'], ['csv', 'text'], ['tsv', 'text'],
])

export function isUrlRoot(value) {
  return /^(svn|svn\+ssh|http|https|file):\/\//i.test(String(value ?? '').trim())
}

export function resolveRoot(input) {
  const raw = String(input ?? '').trim()
  if (!raw) return { ok: false, error: 'root-required' }
  if (isUrlRoot(raw)) {
    return { ok: true, kind: 'url', base: raw.replace(/\/+$/, '') }
  }
  const absolute = path.resolve(raw)
  if (!existsSync(absolute)) return { ok: false, error: 'root-not-found', detail: absolute }
  return { ok: true, kind: 'wc', base: absolute }
}

/** Join a repository-relative path onto the root, keeping it inside the root. */
export function joinPath(root, relative) {
  const rel = String(relative ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
  const parts = rel.split('/').filter(Boolean)
  if (parts.some((part) => part === '..' || part.includes('\0'))) return null
  if (root.kind === 'wc') {
    const target = path.resolve(root.base, ...parts)
    if (target !== root.base && !target.startsWith(root.base + path.sep)) return null
    return { rel: parts.join('/'), local: target }
  }
  const encoded = parts.map((part) => encodeURIComponent(part)).join('/')
  return { rel: parts.join('/'), url: encoded ? `${root.base}/${encoded}` : root.base }
}

export function runSvn(args, options = {}) {
  const { cwd, timeout = 20000, maxBytes = 16 * 1024 * 1024 } = options
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('svn', args, { cwd, windowsHide: true })
    } catch (error) {
      resolve({ code: -1, out: Buffer.alloc(0), err: String(error?.message ?? error), spawn: false })
      return
    }
    const chunks = []
    let size = 0
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill() } catch { /* ignore */ }
      resolve({ code: -1, out: Buffer.concat(chunks), err: 'timeout', timeout: true })
    }, timeout)
    child.stdout.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        try { child.kill() } catch { /* ignore */ }
        return
      }
      chunks.push(chunk)
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: -1, out: Buffer.concat(chunks), err: String(error?.message ?? error), spawn: false })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, out: Buffer.concat(chunks), err: stderr.trim() })
    })
  })
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }

export function unescapeXml(text) {
  return String(text ?? '')
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCodePoint(parseInt(code, 16)))
}

function pick(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))
  return match ? unescapeXml(match[1]) : ''
}

function attr(block, name) {
  const match = block.match(new RegExp(`\\b${name}="([^"]*)"`))
  return match ? unescapeXml(match[1]) : ''
}

export function parseList(xml) {
  const entries = []
  const blocks = String(xml ?? '').match(/<entry\b[\s\S]*?<\/entry>/g) ?? []
  for (const block of blocks) {
    const name = pick(block, 'name')
    if (!name) continue
    entries.push({
      name,
      kind: attr(block, 'kind') === 'dir' ? 'dir' : 'file',
      size: Number(pick(block, 'size') || 0),
      rev: Number(block.match(/<commit\b[^>]*revision="(\d+)"/)?.[1] ?? 0) || 0,
      author: pick(block, 'author'),
      date: pick(block, 'date'),
    })
  }
  return entries
}

export function parseLog(xml) {
  const entries = []
  const blocks = String(xml ?? '').match(/<logentry\b[\s\S]*?<\/logentry>/g) ?? []
  for (const block of blocks) {
    entries.push({
      rev: Number(attr(block, 'revision')),
      author: pick(block, 'author'),
      date: pick(block, 'date'),
      message: pick(block, 'msg'),
      paths: (block.match(/<path\b[^>]*>[\s\S]*?<\/path>/g) ?? []).map((p) => ({
        action: attr(p, 'action'),
        text: unescapeXml(p.replace(/<[^>]+>/g, '')),
        copyFrom: attr(p, 'copyfrom-path'),
      })),
    })
  }
  return entries
}

export function parseInfo(xml) {
  const text = String(xml ?? '')
  const entry = text.match(/<entry\b[\s\S]*$/)?.[0] ?? text
  const url = pick(entry, 'url')
  const rel = pick(entry, 'relative-url')
  const root = pick(entry, 'root')
  const revision = Number(attr(entry, 'revision') || pick(entry, 'revision') || 0)
  const commit = entry.match(/<commit\b[\s\S]*?<\/commit>/)?.[0] ?? ''
  return {
    url,
    relativeUrl: rel,
    repositoryRoot: root,
    revision,
    kind: attr(entry, 'kind') || 'dir',
    lastRev: Number(attr(commit, 'revision') || 0),
    lastAuthor: pick(commit, 'author'),
    lastDate: pick(commit, 'date'),
  }
}

export function parseStatus(xml) {
  const map = {}
  const blocks = String(xml ?? '').match(/<entry\b[\s\S]*?<\/entry>/g) ?? []
  for (const block of blocks) {
    const itemPath = attr(block, 'path')
    const item = block.match(/item="([^"]+)"/)?.[1] ?? 'normal'
    if (itemPath) map[itemPath.replace(/\\/g, '/')] = item
  }
  return map
}

/** Decide how the client should render a file. */
export function classify(name, buffer) {
  const ext = path.extname(name).slice(1).toLowerCase()
  if (IMAGE.has(ext)) return { view: 'image', language: null }
  if (ext === 'pdf') return { view: 'pdf', language: null }
  if (OFFICE.has(ext)) return { view: 'office', language: null }
  if (ARCHIVE.has(ext)) return { view: 'archive', language: null }
  if (VIDEO.has(ext)) return { view: 'video', language: null }
  if (buffer) {
    const head = buffer.subarray(0, SNIFF_BYTES)
    if (head.includes(0)) return { view: 'binary', language: null }
  }
  return { view: 'text', language: CODE.get(ext) ?? 'text' }
}

export function hasNul(buffer) {
  return buffer.subarray(0, SNIFF_BYTES).includes(0)
}

/** True when svn can never produce a line diff for this name (video/image/office/archive/pdf). */
export function isBinaryName(name) {
  const ext = path.extname(String(name ?? '')).slice(1).toLowerCase()
  return IMAGE.has(ext) || ARCHIVE.has(ext) || VIDEO.has(ext) || OFFICE.has(ext) || ext === 'pdf'
}

/** Decode file bytes, trying UTF-8 first and falling back to GBK (common on Chinese Windows). */
export function decodeText(buffer) {
  const bom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
  const body = bom ? buffer.subarray(3) : buffer
  for (const encoding of ['utf-8', 'gbk', 'gb18030']) {
    try {
      const text = new TextDecoder(encoding, { fatal: true }).decode(body)
      return { text, encoding: bom ? `${encoding}-bom` : encoding }
    } catch { /* try next */ }
  }
  return { text: body.toString('latin1'), encoding: 'latin1' }
}

export function languageOf(name) {
  const ext = path.extname(name).slice(1).toLowerCase()
  return CODE.get(ext) ?? 'text'
}
