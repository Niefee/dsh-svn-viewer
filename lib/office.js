import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const CACHE = new Map()
const MAX_TEXT = 1024 * 1024

function run(file, args, timeout = 20000) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ error, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
}

function unescape(text) {
  return String(text ?? '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
}

function docxText(xml) {
  return unescape(xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function xlsxText(sharedXml, sheetXml) {
  const shared = sharedXml
    ? [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => unescape(match[1].replace(/<[^>]+>/g, '')))
    : []
  const rows = [...sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)]
  const lines = []
  for (const row of rows) {
    const cells = [...row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)]
    const values = cells.map((cell) => {
      const attrs = cell[1] ?? ''
      const body = cell[2] ?? ''
      const value = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? ''
      if (/t="s"/.test(attrs)) return shared[Number(value)] ?? value
      if (/t="inlineStr"/.test(attrs)) return unescape(body.replace(/<[^>]+>/g, ''))
      return unescape(value)
    })
    const line = values.join('\t').replace(/\t+$/g, '')
    if (line.trim()) lines.push(line)
  }
  return lines.join('\n')
}

function pptxText(root, names) {
  const slides = names
    .filter((name) => /^slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
  return slides.map((name, index) => {
    const xml = readFileSync(path.join(root, name), 'utf8')
    const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) => unescape(match[1])).filter(Boolean)
    return `--- 第 ${index + 1} 页 ---\n${texts.join('\n')}`
  }).join('\n\n')
}

/** Extract plain text from a docx/xlsx/pptx buffer. Uses bsdtar to unpack the OOXML container. */
export async function extractOfficeText(name, bytes) {
  const ext = path.extname(String(name)).slice(1).toLowerCase()
  const kind = ext.startsWith('doc') ? 'docx'
    : ext.startsWith('xls') ? 'xlsx'
      : ext.startsWith('ppt') ? 'pptx' : null
  if (!kind) return { ok: false, kind: null, reason: 'unsupported' }
  const key = `${kind}|${name}|${bytes.length}`
  const cached = CACHE.get(key)
  if (cached) return cached

  const work = mkdtempSync(path.join(tmpdir(), 'dsh-svn-office-'))
  const archive = path.join(work, 'package.zip')
  const outDir = path.join(work, 'out')
  let text = ''
  try {
    writeFileSync(archive, bytes)
    mkdirSync(outDir, { recursive: true })
    const unpack = await run('tar', ['-xf', archive, '-C', outDir])
    if (unpack.error) throw new Error(unpack.stderr || 'unpack-failed')
    if (kind === 'docx') {
      text = docxText(readFileSync(path.join(outDir, 'word', 'document.xml'), 'utf8'))
    } else if (kind === 'xlsx') {
      const sharedPath = path.join(outDir, 'xl', 'sharedStrings.xml')
      let sharedXml = ''
      try { sharedXml = readFileSync(sharedPath, 'utf8') } catch { /* optional */ }
      const sheets = readdirSync(path.join(outDir, 'xl', 'worksheets')).filter((file) => file.endsWith('.xml')).sort()
      text = sheets.map((file) => xlsxText(sharedXml, readFileSync(path.join(outDir, 'xl', 'worksheets', file), 'utf8')))
        .filter(Boolean).join('\n\n')
    } else {
      const slidesDir = path.join(outDir, 'ppt', 'slides')
      text = pptxText(slidesDir, readdirSync(slidesDir))
    }
  } catch (error) {
    const failed = { ok: false, kind, reason: String(error?.message ?? error) }
    CACHE.set(key, failed)
    return failed
  } finally {
    try { rmSync(work, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  const truncated = text.length > MAX_TEXT
  const result = { ok: Boolean(text), kind, text: truncated ? text.slice(0, MAX_TEXT) : text, truncated }
  if (CACHE.size > 60) CACHE.clear()
  CACHE.set(key, result)
  return result
}
