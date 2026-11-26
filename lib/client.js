window.__ModuleLoader__.load({
  id: '@local/dsh-svn-viewer',
  factory(require) {
    const React = require('react')
    const e = React.createElement
    const { useState, useEffect, useRef, useCallback, useMemo } = React

    const PANEL_ID = 'dsh-svn-viewer'
    const STORAGE_ROOT = 'dsh-svn-viewer:root'
    const STORAGE_ROOTS = 'dsh-svn-viewer:roots'
    const STORAGE_TREE_WIDTH = 'dsh-svn-viewer:treewidth'
    const STORAGE_IMG_BG = 'dsh-svn-viewer:imgbg'
    const STORAGE_PATH = 'dsh-svn-viewer:path'
    const STORAGE_SELECTED = 'dsh-svn-viewer:selected'
    const STORAGE_EXPANDED = 'dsh-svn-viewer:expanded'
const STORAGE_SEARCH = 'dsh-svn-viewer:search'
    const STORAGE_RAIL = 'dsh-svn-viewer:rail'
    // 0.3.20 V4：最近访问 / 目录栏收起态。
    // 注意：目录栏收起不复用 STORAGE_RAIL（那是上下文栏），另开 treerail 键避免互相覆盖。
    const STORAGE_RECENT = 'dsh-svn-viewer:recent'
    const STORAGE_TREE_RAIL = 'dsh-svn-viewer:treerail'
    const STORAGE_SECS = 'dsh-svn-viewer:secs'
    const RECENT_MAX = 12
    const TREE_WIDTH_MIN = 220
    const TREE_WIDTH_MAX = 560
    const TREE_WIDTH_DEFAULT = 320
    const RIGHT_MIN_PX = 420
    const DEFAULT_ROOT = 'https://svn.apache.org/repos/asf/poi/trunk'
    const TEXT_RENDER_LIMIT = 4000

    /* --------------------------------------------------------------- utils */

    const STATUS_LABEL = {
      modified: 'M', added: 'A', deleted: 'D', replaced: 'R', conflicted: 'C',
      unversioned: '?', missing: '!', obstructed: '~', ignored: 'I', external: 'X',
    }
    const STATUS_COLOR = {
      modified: 'var(--dsw-alias-state-warn-primary)',
      added: 'var(--dsw-alias-state-success-primary)',
      deleted: 'var(--dsw-alias-state-error-primary)',
      conflicted: 'var(--dsw-alias-state-error-primary)',
      missing: 'var(--dsw-alias-state-error-primary)',
      unversioned: 'var(--dsw-alias-label-secondary)',
      replaced: 'var(--dsw-alias-state-warn-primary)',
    }

    // jsdom 等无 rAF 的环境退化为 setTimeout，保证测试与旧宿主可运行。
    const raf = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 0))
    const caf = (id) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id))

    function fmtSize(bytes) {
      const n = Number(bytes) || 0
      if (!n) return '—'
      if (n < 1024) return `${n} B`
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
      return `${(n / 1024 / 1024).toFixed(1)} MB`
    }

    function fmtDate(iso) {
      if (!iso) return '—'
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return '—'
      const pad = (v) => String(v).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    /* 文件类型图标：id 对应 <svg> 里的 <symbol>，颜色取主题令牌 */
    const ICON_GROUPS = [
      ['word', ['doc', 'docx', 'docm', 'dot', 'dotx', 'odt', 'rtf', 'wps'], 'var(--svn-icon-word)'],
      ['excel', ['xls', 'xlsx', 'xlsm', 'xlsb', 'ods', 'csv', 'tsv'], 'var(--svn-icon-excel)'],
      ['ppt', ['ppt', 'pptx', 'pptm', 'odp', 'dps'], 'var(--svn-icon-ppt)'],
      ['pdf', ['pdf'], 'var(--svn-icon-pdf)'],
      ['image', ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif', 'tif', 'tiff'], 'var(--svn-icon-image)'],
      ['archive', ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz'], 'var(--svn-icon-archive)'],
      ['markdown', ['md', 'markdown'], 'var(--svn-icon-markdown)'],
      ['code', ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'java', 'cs', 'c', 'h', 'cpp', 'hpp', 'go', 'rs', 'php', 'rb', 'sh', 'ps1', 'bat', 'sql', 'vue', 'css', 'scss', 'less', 'html', 'htm', 'dart', 'kt', 'swift'], 'var(--svn-icon-code)'],
      ['json', ['json', 'xml', 'yml', 'yaml', 'ini', 'conf', 'toml', 'properties'], 'var(--svn-icon-json)'],
      ['video', ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'rmvb'], 'var(--svn-icon-video)'],
      ['font', ['ttf', 'otf', 'woff', 'woff2', 'eot'], 'var(--svn-icon-font)'],
      ['text', ['txt', 'log', 'text', 'nfo'], 'var(--svn-icon-text)'],
    ]
    const ICON_BY_EXT = new Map()
    for (const [id, exts, color] of ICON_GROUPS) for (const ext of exts) ICON_BY_EXT.set(ext, { id, color })

    function iconOf(name) {
      const ext = String(name ?? '').split('.').pop().toLowerCase()
      return ICON_BY_EXT.get(ext) ?? { id: 'unknown', color: 'var(--dsw-alias-label-secondary)' }
    }

    /* --- browser fallbacks: Office text extraction and zip export when the host is older --- */
    async function unzipZip(buffer) {
      const view = new DataView(buffer)
      let eocd = -1
      const floor = Math.max(0, buffer.byteLength - 66000)
      for (let i = buffer.byteLength - 22; i >= floor; i -= 1) {
        if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break }
      }
      if (eocd < 0) throw new Error('not-a-zip')
      const count = view.getUint16(eocd + 10, true)
      let offset = view.getUint32(eocd + 16, true)
      const entries = new Map()
      for (let i = 0; i < count; i += 1) {
        if (offset + 46 > buffer.byteLength || view.getUint32(offset, true) !== 0x02014b50) break
        const method = view.getUint16(offset + 10, true)
        const compSize = view.getUint32(offset + 20, true)
        const nameLen = view.getUint16(offset + 28, true)
        const extraLen = view.getUint16(offset + 30, true)
        const commentLen = view.getUint16(offset + 32, true)
        const localOffset = view.getUint32(offset + 42, true)
        const name = new TextDecoder('utf-8').decode(new Uint8Array(buffer, offset + 46, nameLen))
        const localNameLen = view.getUint16(localOffset + 26, true)
        const localExtraLen = view.getUint16(localOffset + 28, true)
        entries.set(name, { method, compSize, dataStart: localOffset + 30 + localNameLen + localExtraLen })
        offset += 46 + nameLen + extraLen + commentLen
      }
      return {
        names: [...entries.keys()],
        async read(name) {
          const entry = entries.get(name)
          if (!entry) return null
          const slice = new Uint8Array(buffer, entry.dataStart, entry.compSize)
          if (entry.method === 0) return new TextDecoder('utf-8').decode(slice)
          const stream = new Blob([slice]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
          const inflated = await new Response(stream).arrayBuffer()
          return new TextDecoder('utf-8').decode(inflated)
        },
      }
    }

    function stripXml(xml) {
      return String(xml ?? '')
        .replace(/<w:tab\/>/g, '\t')
        .replace(/<w:br\/>/g, '\n')
        .replace(/<\/(w:p|w:tr|a:p)>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    }

    async function extractOfficeInBrowser(name, buffer) {
      const ext = String(name).split('.').pop().toLowerCase()
      const kind = ext.startsWith('doc') ? 'docx' : ext.startsWith('xls') ? 'xlsx' : ext.startsWith('ppt') ? 'pptx' : null
      if (!kind) return null
      const zip = await unzipZip(buffer)
      if (kind === 'docx') {
        const xml = await zip.read('word/document.xml')
        return xml ? { kind, text: stripXml(xml) } : null
      }
      if (kind === 'xlsx') {
        const sharedXml = await zip.read('xl/sharedStrings.xml')
        const shared = sharedXml
          ? [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => stripXml(match[1]))
          : []
        const sheets = zip.names.filter((item) => /^xl\/worksheets\/sheet\d+\.xml$/.test(item)).sort()
        const lines = []
        for (const sheet of sheets) {
          const xml = await zip.read(sheet)
          if (!xml) continue
          for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
            const cells = [...row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)]
            const values = cells.map((cell) => {
              const attrs = cell[1] ?? ''
              const body = cell[2] ?? ''
              const value = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? ''
              if (/t="s"/.test(attrs)) return shared[Number(value)] ?? value
              if (/t="inlineStr"/.test(attrs)) return stripXml(body)
              return value
            })
            const line = values.join('\t').replace(/\t+$/g, '')
            if (line.trim()) lines.push(line)
          }
        }
        return { kind, text: lines.join('\n') }
      }
      const slides = zip.names.filter((item) => /^ppt\/slides\/slide\d+\.xml$/.test(item))
        .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
      const pages = []
      for (let index = 0; index < slides.length; index += 1) {
        const xml = await zip.read(slides[index])
        if (!xml) continue
        const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) => match[1])
        pages.push(`--- 第 ${index + 1} 页 ---\n${texts.join('\n')}`)
      }
      return { kind, text: pages.join('\n\n') }
    }

    const CRC_TABLE = (() => {
      const table = new Uint32Array(256)
      for (let i = 0; i < 256; i += 1) {
        let value = i
        for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1
        table[i] = value >>> 0
      }
      return table
    })()

    function crc32(bytes) {
      let value = 0xFFFFFFFF
      for (let i = 0; i < bytes.length; i += 1) value = CRC_TABLE[(value ^ bytes[i]) & 0xFF] ^ (value >>> 8)
      return (value ^ 0xFFFFFFFF) >>> 0
    }

    async function deflateRawBytes(bytes) {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))
      return new Uint8Array(await new Response(stream).arrayBuffer())
    }

    /** Build a zip archive from { name, bytes } entries. Used when the host has no /export route. */
    async function buildZip(entries) {
      const encoder = new TextEncoder()
      const localParts = []
      const centralParts = []
      let offset = 0
      for (const entry of entries) {
        const nameBytes = encoder.encode(entry.name)
        const raw = entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(entry.bytes)
        const crc = crc32(raw)
        let payload = raw
        let method = 0
        try {
          const deflated = await deflateRawBytes(raw)
          if (deflated.length < raw.length) { payload = deflated; method = 8 }
        } catch { /* store instead */ }
        const local = new Uint8Array(30 + nameBytes.length)
        const lv = new DataView(local.buffer)
        lv.setUint32(0, 0x04034b50, true)
        lv.setUint16(4, 20, true)
        lv.setUint16(6, 0x0800, true)
        lv.setUint16(8, method, true)
        lv.setUint16(10, 0, true)
        lv.setUint16(12, 0x21, true)
        lv.setUint32(14, crc, true)
        lv.setUint32(18, payload.length, true)
        lv.setUint32(22, raw.length, true)
        lv.setUint16(26, nameBytes.length, true)
        lv.setUint16(28, 0, true)
        local.set(nameBytes, 30)
        localParts.push(local, payload)

        const central = new Uint8Array(46 + nameBytes.length)
        const cv = new DataView(central.buffer)
        cv.setUint32(0, 0x02014b50, true)
        cv.setUint16(4, 20, true)
        cv.setUint16(6, 20, true)
        cv.setUint16(8, 0x0800, true)
        cv.setUint16(10, method, true)
        cv.setUint16(12, 0, true)
        cv.setUint16(14, 0x21, true)
        cv.setUint32(16, crc, true)
        cv.setUint32(20, payload.length, true)
        cv.setUint32(24, raw.length, true)
        cv.setUint16(28, nameBytes.length, true)
        cv.setUint16(30, 0, true)
        cv.setUint16(32, 0, true)
        cv.setUint16(34, 0, true)
        cv.setUint16(36, 0, true)
        cv.setUint32(38, 0, true)
        cv.setUint32(42, offset, true)
        central.set(nameBytes, 46)
        centralParts.push(central)
        offset += local.length + payload.length
      }
      const centralSize = centralParts.reduce((sum, item) => sum + item.length, 0)
      const end = new Uint8Array(22)
      const ev = new DataView(end.buffer)
      ev.setUint32(0, 0x06054b50, true)
      ev.setUint16(8, entries.length, true)
      ev.setUint16(10, entries.length, true)
      ev.setUint32(12, centralSize, true)
      ev.setUint32(16, offset, true)
      return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' })
    }

    /** Client-side directory export: list, fetch each file's bytes, zip in the browser. */
    async function exportInBrowser(rootValue, basePath, revValue, onProgress) {
      const files = []
      const queue = [basePath || '']
      let total = 0
      while (queue.length) {
        const dir = queue.shift()
        const listing = await api('/list', { root: rootValue, path: dir, rev: revValue })
        for (const entry of listing.entries ?? []) {
          const path = dir ? `${dir}/${entry.name}` : entry.name
          if (entry.kind === 'dir') { queue.push(path); continue }
          if (files.length >= 300) throw new Error('目录超过 300 个文件，请进入子目录导出')
          const params = new URLSearchParams({ root: rootValue, path })
          if (revValue) params.set('rev', String(revValue))
          const response = await fetch(`/dsh-svn/raw?${params.toString()}`)
          if (!response.ok) continue
          const bytes = new Uint8Array(await response.arrayBuffer())
          total += bytes.length
          if (total > 60 * 1024 * 1024) throw new Error('导出内容超过 60 MB，请进入子目录导出')
          files.push({ name: path, bytes })
          if (onProgress) onProgress(files.length)
        }
      }
      if (!files.length) throw new Error('目录里没有可导出的文件')
      return buildZip(files)
    }
    async function officePreviewFallback(file, rootValue, revValue) {
      if (!file || (file.view !== 'office' && file.view !== 'office-text')) return null
      if (file.view === 'office-text' && file.content) return null
      const size = Number(file.size) || 0
      if (size > 30 * 1024 * 1024) return null
      const params = new URLSearchParams({ root: rootValue, path: file.path })
      if (revValue) params.set('rev', String(revValue))
      const response = await fetch(`/dsh-svn/raw?${params.toString()}`)
      if (!response.ok) return null
      const buffer = await response.arrayBuffer()
      const extracted = await extractOfficeInBrowser(file.name, buffer)
      if (!extracted || !extracted.text) return null
      return {
        ...file,
        view: 'office-text',
        officeKind: extracted.kind,
        encoding: '浏览器端提取',
        content: extracted.text.slice(0, 1024 * 1024),
        truncated: extracted.text.length > 1024 * 1024,
      }
    }
    /* --- end browser fallbacks --- */
    async function api(url, params, options = {}) {
      const query = new URLSearchParams()
      for (const [key, value] of Object.entries(params ?? {})) {
        if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
      }
      const target = `/dsh-svn${url}${query.toString() ? `?${query}` : ''}`
      const response = await fetch(target, { headers: { accept: 'application/json' }, signal: options.signal })
      let payload = null
      try { payload = await response.json() } catch { payload = null }
      if (!response.ok || (payload && payload.ok === false)) {
        const error = new Error((payload && (payload.error || payload.detail)) || `HTTP ${response.status}`)
        error.payload = payload
        error.status = response.status
        throw error
      }
      return payload
    }

    /* --------------------------------------------------------------- styles */

    const CSS = `
.svn-app{position:relative;height:100%;min-height:0;width:100%;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:13px;font-family:var(--svn-ui)}
.svn-top{display:flex;align-items:center;gap:10px;height:54px;padding:0 16px;border-bottom:1px solid var(--svn-hair);background:linear-gradient(180deg,var(--dsw-alias-bg-layer-1),color-mix(in srgb,var(--dsw-alias-bg-layer-1) 40%,var(--dsw-alias-bg-base)));flex:0 0 54px}
.svn-top>.svn-btn{height:34px;padding:0 14px}
.svn-rootbox{display:flex;align-items:center;gap:8px;position:relative;height:34px;padding:0 5px 0 14px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);box-shadow:inset 0 0 0 1px var(--svn-hair);transition:box-shadow .35s var(--svn-ease)}
.svn-rootbox:focus-within{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--svn-act) 45%,transparent)}
.svn-rootbox .svn-input{flex:1;min-width:0;background:transparent;box-shadow:none;height:auto;padding:0;border-radius:0}
.svn-rootbox>.svn-btn{width:26px;height:26px;border-radius:999px;background:var(--dsw-alias-bg-base);box-shadow:0 0 0 1px var(--svn-hair);padding:0;flex:0 0 26px}
/* 地址栏的下拉箭头：图标按钮（0.3.5 起用 SVG chevron，不再用 ▾ 字形） */
.svn-rootcaret{flex:0 0 28px;width:28px;height:28px;display:grid;place-items:center;padding:0;border:0;border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 0 0 1px var(--svn-hair);cursor:pointer;transition:background .14s ease,color .14s ease}
.svn-rootcaret svg{width:15px;height:15px}
.svn-rootcaret:hover{background:var(--svn-hover);color:var(--svn-act)}
.svn-rootcaret:focus-visible{outline:2px solid color-mix(in srgb,var(--svn-act) 55%,transparent);outline-offset:1px}
.svn-roots{position:absolute;top:40px;left:0;right:0;z-index:40;border:0;border-radius:16px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));box-shadow:0 0 0 1px var(--svn-hair),var(--svn-sh2);padding:6px;max-height:340px;overflow:auto;display:flex;flex-direction:column;gap:2px}
.svn-roots .hd{font-size:10.5px;color:var(--dsw-alias-label-secondary);padding:4px 8px 2px}
.svn-roots .it{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:10px;cursor:pointer;font-size:12.5px;color:var(--dsw-alias-label-primary);transition:background .3s var(--svn-ease)}
.svn-roots .it:hover{background:var(--dsw-alias-bg-layer-2)}
.svn-roots .it .p{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.svn-roots .it .t{font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent)}
.svn-roots .rm{border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:12px;padding:2px 5px;border-radius:4px}
.svn-roots .rm:hover{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}
.svn-brand{display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px}
.svn-brand span{color:var(--dsw-alias-label-secondary);font-weight:500}
.svn-input{display:flex;align-items:center;gap:8px;height:34px;padding:0 14px;border:0;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);box-shadow:inset 0 0 0 1px var(--svn-hair);min-width:220px;transition:box-shadow .35s var(--svn-ease)}
.svn-input input{flex:1;border:0;outline:0;background:transparent;color:inherit;font:inherit;font-size:12.5px;min-width:0}
.svn-search{display:flex;align-items:center;gap:8px;height:34px;padding:0 14px;border:0;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);box-shadow:inset 0 0 0 1px var(--svn-hair);width:300px;transition:box-shadow .35s var(--svn-ease)}
.svn-input:focus-within,.svn-search:focus-within{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--svn-act) 45%,transparent)}
.svn-search input{flex:1;border:0;outline:0;background:transparent;color:inherit;font:inherit;font-size:12.5px;min-width:0}
.svn-btn{height:30px;padding:0 12px;border-radius:999px;border:0;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;box-shadow:inset 0 0 0 1px var(--svn-hair);transition:transform .35s var(--svn-ease),background .35s var(--svn-ease),color .35s var(--svn-ease),box-shadow .35s var(--svn-ease)}
.svn-btn:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}
.svn-btn:active{transform:scale(.97)}
.svn-btn.primary{background:var(--svn-act);border-color:var(--svn-act);color:#fff;box-shadow:none}
.svn-btn.ghost{background:transparent;color:var(--svn-act);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--svn-act) 35%,transparent)}
.svn-btn.act{border-color:var(--svn-act);color:var(--svn-act);background:color-mix(in srgb,var(--svn-act) 8%,transparent);box-shadow:none}
.svn-btn.act:hover{background:color-mix(in srgb,var(--svn-act) 16%,transparent)}
.svn-btn.ok{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);box-shadow:none}
.svn-btn.danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);background:transparent;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,transparent)}
.svn-btn.danger:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}
.svn-btn:disabled{opacity:.5;cursor:default}
.svn-btn.cta{display:inline-flex;align-items:center;gap:8px;background:linear-gradient(180deg,color-mix(in srgb,var(--svn-act) 82%,#ffffff),var(--svn-act));color:#fff;font-weight:700;box-shadow:0 10px 20px -10px color-mix(in srgb,var(--svn-act) 55%,transparent),inset 0 1px 0 rgb(255 255 255/.25)}
.svn-btn.cta.ghost{background:var(--dsw-alias-bg-base);color:var(--svn-act);font-weight:600;box-shadow:inset 0 0 0 1px var(--svn-hair),var(--svn-sh1)}
.svn-btn.cta.ghost:hover{background:color-mix(in srgb,var(--svn-act) 6%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--svn-act) 45%,transparent),var(--svn-sh1)}
.svn-nest{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:999px;background:rgb(255 255 255/.18);transition:transform .35s var(--svn-ease)}
.svn-btn.cta.ghost .svn-nest{background:color-mix(in srgb,var(--svn-act) 12%,transparent)}
.svn-btn.cta:hover .svn-nest{transform:translate(2px,-1px) scale(1.06)}
/* 下载钮（ghost CTA）悬浮/按压不做任何缩放或位移，仅底色变化 */
.svn-btn.cta.ghost:hover .svn-nest,.svn-btn.cta.ghost:active{transform:none}
.svn-chip{font-size:10.5px;padding:3px 10px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.svn-chip.blue{background:color-mix(in srgb,var(--svn-act) 12%,transparent);color:var(--svn-act)}
.svn-body{flex:1;display:flex;min-height:0}
.svn-tree{flex:0 0 320px;min-width:0;overflow:hidden;border-right:1px solid var(--svn-hair);display:flex;flex-direction:column;min-height:0;background:var(--dsw-alias-bg-layer-1)}
.svn-splitbar{flex:0 0 6px;margin-left:-6px;position:relative;z-index:4;cursor:col-resize;background:transparent}
.svn-splitbar:hover,.svn-splitbar.on{background:color-mix(in srgb,var(--svn-act) 22%,transparent)}
.svn-app.drag,.svn-app.drag *{user-select:none!important;cursor:col-resize!important}
.svn-pane-hd{display:flex;align-items:center;gap:8px;height:36px;flex:0 0 36px;padding:0 12px;border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:11.5px}
.svn-pane-hd b{color:var(--dsw-alias-label-primary);font-size:12px}
.svn-scroll{flex:1;overflow:auto;min-height:0}
.svn-row{display:flex;align-items:center;gap:6px;height:30px;padding:0 8px;border-radius:10px;margin:0 6px;cursor:pointer;white-space:nowrap;font-size:12.5px;color:var(--dsw-alias-label-primary);transition:background .3s var(--svn-ease)}
.svn-row:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent)}
.svn-row.sel{background:color-mix(in srgb,var(--svn-act) 10%,transparent);color:var(--svn-act);box-shadow:inset 2px 0 0 var(--svn-act)}
.svn-caret{width:20px;height:20px;flex:0 0 20px;display:grid;place-items:center;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0;border-radius:5px}
.svn-caret:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.svn-caret svg{width:16px;height:16px;transition:transform .12s ease}
.svn-caret.open svg{transform:rotate(90deg)}
.svn-caret.leaf{visibility:hidden;pointer-events:none}
.svn-folder{width:16px;height:16px;flex:0 0 16px;color:#d99a00}
.svn-row .nm{min-width:0;overflow:hidden;text-overflow:ellipsis}
.svn-row .n{margin-left:auto;font-size:10.5px;font-family:var(--svn-mono);color:var(--dsw-alias-label-secondary)}
.svn-tag{flex:0 0 26px;height:16px;border-radius:4px;color:#fff;font-size:8px;font-weight:700;display:flex;align-items:center;justify-content:center;letter-spacing:.2px}
.svn-main{flex:1;display:flex;flex-direction:column;min-width:0;background:var(--dsw-alias-bg-base)}
.svn-crumb{display:flex;align-items:center;gap:6px;height:38px;flex:0 0 38px;padding:0 14px;border-bottom:1px solid var(--svn-hair);color:var(--dsw-alias-label-secondary);font-size:11.5px;overflow:hidden}
.svn-crumb b{color:var(--dsw-alias-label-primary);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.svn-tabs{display:flex;gap:14px;margin-left:auto}
.svn-tabs button{border:0;background:transparent;color:var(--svn-act);font:inherit;font-size:12.5px;height:30px;padding:0 2px;cursor:pointer;white-space:nowrap;box-shadow:inset 0 -2px 0 transparent;transition:box-shadow .35s var(--svn-ease)}
.svn-tabs button:hover,.svn-tabs button.on{box-shadow:inset 0 -2px 0 var(--svn-act)}
.svn-tabs button.on{font-weight:600}
.svn-table{display:flex;flex-direction:column;min-height:0;flex:1}
.svn-chip.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);color:var(--dsw-alias-state-success-primary)}
.svn-chip.fail{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);color:var(--dsw-alias-state-error-primary)}
.svn-th,.svn-tr{display:grid;grid-template-columns:minmax(0,1fr) 64px 18px;gap:10px;align-items:center;padding:0 12px}
.svn-th{height:28px;flex:0 0 28px;font-size:11px;color:var(--dsw-alias-label-secondary);border-bottom:1px solid var(--dsw-alias-border-l1)}
.svn-tr{height:44px;overflow:hidden;border-bottom:1px solid var(--dsw-alias-border-l1);cursor:pointer}
.svn-tr:hover{background:var(--dsw-alias-bg-layer-1)}
.svn-tr.sel{background:color-mix(in srgb,var(--svn-act) 10%,transparent)}
.svn-tr .nm{display:flex;align-items:center;gap:8px;min-width:0}
.svn-tr .nm>div{min-width:0;flex:1}
.svn-tr .t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12.5px}
.svn-tr .s{font-size:10.5px;color:var(--dsw-alias-label-secondary);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.svn-tr .c{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.svn-dot{width:6px;height:6px;border-radius:50%}
.svn-preview{flex:1;display:flex;flex-direction:column;min-height:0;background:var(--dsw-alias-bg-layer-1)}
.svn-pv-hd{display:flex;align-items:center;gap:8px;height:42px;flex:0 0 42px;padding:0 14px;border-bottom:1px solid var(--svn-hair);font-size:11.5px;color:var(--dsw-alias-label-secondary);min-width:0;overflow:hidden}
.svn-pv-hd .svn-btn,.svn-pv-hd .svn-tabs,.svn-crumb .svn-btn{flex:0 0 auto}
/* 头部行按钮紧凑化：42/36px 行高内用 30px 圆钮，与审阅稿两级高度标尺一致 */
.svn-pv-hd .svn-btn,.svn-crumb .svn-btn,.svn-viewbar .svn-btn{height:30px;padding:0 12px;font-size:12px;border-radius:999px}
.svn-pv-hd{gap:6px}
.svn-crumb{gap:6px}
.svn-viewbar{gap:8px}
.svn-pv-body{flex:1;overflow:auto;min-height:0;display:flex;flex-direction:column;background:radial-gradient(1200px 300px at 50% -80px,color-mix(in srgb,var(--svn-act) 5%,transparent),transparent 70%),var(--dsw-alias-bg-base)}
.svn-pv-hd>b{font-size:13.5px;font-weight:600;color:var(--dsw-alias-label-primary)}
.svn-pv-body>.svn-code,.svn-pv-body>.svn-empty,.svn-pv-body>div>.svn-code{flex:0 0 auto}
.svn-code{font-family:var(--svn-mono);font-size:12px;line-height:20px;padding:10px 12px;white-space:pre;tab-size:2}
.svn-ln{display:grid;grid-template-columns:44px 1fr;gap:10px}
.svn-ln .g{color:var(--dsw-alias-label-secondary);text-align:right;user-select:none;font-size:11px}
.svn-ln.add{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent)}
.svn-ln.del{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent)}
.svn-ln.hunk{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.svn-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:var(--dsw-alias-label-secondary);font-size:12.5px;height:100%;padding:30px;text-align:center}
.svn-logo{width:56px;height:56px;border-radius:14px;background:color-mix(in srgb,var(--svn-act) 14%,transparent);color:var(--svn-act);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px}
.svn-err{margin:10px 14px 0;padding:9px 14px;border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-error-primary) 25%,transparent);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.6}
.svn-hist{border-bottom:1px solid var(--svn-hair);padding:8px 12px}
.svn-hist .l1{display:flex;align-items:center;gap:8px;font-size:12px}
.svn-hist .no{color:var(--svn-act);font-weight:600}
.svn-hist .au{color:var(--dsw-alias-label-secondary)}
.svn-hist .tm{margin-left:auto;font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.svn-hist .msg{font-size:11.5px;margin-top:4px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.svn-hist .meta{margin-top:4px;display:flex;gap:6px;font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.svn-seg{display:flex;background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent);border-radius:999px;padding:3px;gap:2px}
.svn-seg button{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;padding:4px 12px;border-radius:999px;cursor:pointer;transition:background .3s var(--svn-ease),color .3s var(--svn-ease)}
.svn-seg button.on{background:var(--dsw-alias-bg-base);color:var(--svn-act);font-weight:600;box-shadow:var(--svn-sh1)}
.svn-seg button:disabled{opacity:.45;cursor:not-allowed}
.svn-hit{padding:9px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);cursor:pointer}
.svn-hit:hover{background:var(--dsw-alias-bg-layer-1)}
.svn-hit .h1{display:flex;align-items:center;gap:8px;min-width:0}
.svn-hit .p{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.svn-hit .cnt{margin-left:auto;flex:0 0 auto;min-width:64px;text-align:right;white-space:nowrap;font-size:10.5px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
.svn-hit .meta{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.svn-hit .meta b{font-weight:500;color:color-mix(in srgb,var(--dsw-alias-label-primary) 72%,transparent)}
.svn-hit .meta .dot{color:color-mix(in srgb,var(--dsw-alias-label-primary) 22%,transparent)}
.svn-hit .loadmore{display:flex;align-items:center;justify-content:center;gap:10px;padding:12px}
.svn-hit .snip{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:4px;padding-left:34px;line-height:1.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.svn-hit mark{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 30%,transparent);color:inherit;border-radius:2px;padding:0 1px}
.svn-img{display:flex;align-items:center;justify-content:center;height:100%;padding:16px}
.svn-img img{max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;background:var(--dsw-alias-bg-layer-2)}
.svn-frame{width:100%;height:100%;border:0;background:#fff}
.svn-note{font-size:11px;color:var(--dsw-alias-label-secondary)}
.svn-split{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--svn-hair);font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.svn-loading{position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,var(--svn-act),transparent);animation:svn-slide 1.1s linear infinite}
.svn-app{--svn-act:var(--dsw-static-blue-600);--svn-icon-page:var(--dsw-alias-bg-layer-2,#ffffff);--svn-icon-page-fold:var(--dsw-alias-bg-layer-1,#eef1f5);--svn-icon-folder:#d9a441;--svn-icon-word:#2b579a;--svn-icon-excel:#217346;--svn-icon-ppt:#c43e1c;--svn-icon-pdf:#d93025;--svn-icon-image:#7c4dff;--svn-icon-archive:#b26a00;--svn-icon-markdown:#527da5;--svn-icon-code:#00897b;--svn-icon-json:#c79100;--svn-icon-video:#8e24aa;--svn-icon-font:#546e7a;--svn-icon-text:#5f6368;--svn-ease:cubic-bezier(.32,.72,0,1);--svn-hair:color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent);--svn-sh1:0 1px 2px rgb(16 24 40/.05);--svn-sh2:0 24px 48px -24px rgb(16 24 40/.16);--svn-ui:var(--dsw-font-sans, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif);--svn-mono:"Cascadia Mono","SF Mono",Consolas,ui-monospace,monospace}
/* 本主题 brand-primary 为黑灰色（neutral-bluish-1000），动作色改用静态蓝并随暗色提亮 */
@media (prefers-color-scheme: dark){.svn-app{--svn-act:var(--dsw-static-blue-400)}}
.dark .svn-app,.svn-app.dark,:where(.dark) .svn-app{--svn-act:var(--dsw-static-blue-400)}
.svn-ico{display:block;flex:0 0 auto}
.svn-viewbar{display:flex;align-items:center;gap:10px;margin:10px 14px 0;padding:8px 14px;border:0;border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent);box-shadow:inset 0 0 0 1px var(--svn-hair);font-size:11.5px;color:var(--dsw-alias-label-secondary);min-height:38px;flex-wrap:wrap}
.svn-viewbar b{font-size:11.5px;color:var(--dsw-alias-label-primary);font-weight:600}
.svn-viewbody{flex:1;overflow:auto;min-height:0;background:var(--dsw-alias-bg-base)}
.svn-viewbody.center{display:flex;align-items:center;justify-content:center}
.svn-docx{padding:16px 8px;overflow-x:auto}.svn-docx section.docx{font-size:10pt;line-height:1.4}.svn-docx section.docx tr{height:auto!important}.svn-docx section.docx td p,.svn-docx section.docx th p{margin:0!important;line-height:1.4!important}
.svn-docx .docx-wrapper{background:transparent!important;padding:0!important;display:flex;flex-direction:column;gap:14px;align-items:flex-start}
.svn-docx .docx-wrapper>section.docx{box-shadow:var(--svn-sh2);border-radius:6px;margin:0 auto!important;max-width:100%}.svn-docx td,.svn-docx th{overflow-wrap:break-word}
.svn-docx .docx-wrapper>section.docx>*{max-width:100%}
.svn-tablewrap{padding:0 0 12px}
.svn-sheetnav{display:flex;gap:4px;padding:6px 10px;flex-wrap:wrap;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);position:sticky;top:0;z-index:2}
.svn-sheetnav button{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;padding:2px 9px;border-radius:6px;cursor:pointer}
.svn-sheetnav button.on{border-color:var(--svn-act);color:var(--svn-act);font-weight:600}
.svn-grid{border-collapse:separate;border-spacing:0;font-size:11.5px;font-variant-numeric:tabular-nums}
.svn-grid td{border-right:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1);padding:3px 8px;white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis;background:var(--dsw-alias-bg-layer-1)}
.svn-grid tr:first-child td{position:sticky;top:0;background:var(--dsw-alias-bg-layer-2);font-weight:600;z-index:1}
.svn-grid .rownum{color:var(--dsw-alias-label-secondary);text-align:right;background:var(--dsw-alias-bg-layer-2);position:sticky;left:0;z-index:1;font-size:10.5px}
.svn-imgview{position:relative;flex:1;min-height:0;overflow:hidden;cursor:grab}
.svn-imgview.bg-checker{background:repeating-conic-gradient(#9aa2ae 0 25%,#c6ccd4 0 50%) 0 0/20px 20px}
.svn-imgview.bg-white{background:#ffffff}
.svn-imgview.bg-black{background:#000000}
.svn-imgview.bg-dark{background:#20242b}
.svn-video{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;background:#101418;padding:10px}
.svn-video video{max-width:100%;max-height:100%;background:#000;border-radius:6px;outline:none}
.svn-imgview img{position:absolute;left:50%;top:50%;transform-origin:center;user-select:none;max-width:none;image-rendering:auto}
.svn-imgview.drag{cursor:grabbing}
.svn-slides{padding:14px;display:flex;flex-direction:column;gap:14px}
.svn-pptx{padding:14px;display:flex;flex-direction:column;gap:14px;align-items:center}
.svn-pptx>div{box-shadow:var(--svn-sh2);border-radius:6px;background:#fff}
.svn-slide{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px 14px}
.svn-slide .no{font-size:10.5px;color:var(--dsw-alias-label-secondary);margin-bottom:6px}
.svn-slide .body{font-size:12.5px;white-space:pre-wrap;line-height:1.8}
.svn-fallback{padding:14px}
.svn-load{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:24px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent)}
.svn-load .card{width:min(560px,92%);border:0;border-radius:18px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 0 0 1px var(--svn-hair),var(--svn-sh2);padding:18px 20px;display:flex;flex-direction:column;gap:10px}
.svn-load .card .row1{display:flex;align-items:center;gap:8px;min-width:0}
.svn-load .card .row1 b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.svn-load .bar{height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.svn-load .bar i{display:block;height:100%;background:var(--svn-act);transition:width .2s linear}
.svn-load .bar.indet i{width:30%;transition:none;animation:svn-indet 1.2s linear infinite}
@keyframes svn-indet{0%{transform:translateX(-100%)}100%{transform:translateX(340%)}}
.svn-load .acts{display:flex;gap:8px;justify-content:flex-end}
.svn-tip{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}

/* ===== toolbar v2 (0.2.0): 8px 圆角、两行身份、页签独立行、视图控件区、表格版式还原 ===== */
.svn-app{--svn-r1:8px;--svn-r2:10px;--svn-sel:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}
.svn-btn{border-radius:var(--svn-r1)}
.svn-input,.svn-search,.svn-rootbox{border-radius:var(--svn-r1)}
.svn-roots{border-radius:var(--svn-r2)}
.svn-top{height:52px;flex:0 0 52px;gap:9px;padding:0 14px}
.svn-brand{flex:0 0 auto;white-space:nowrap}
.svn-repometa{display:flex;align-items:center;gap:6px;flex:0 0 auto;white-space:nowrap;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.svn-repometa .dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-secondary);flex:0 0 6px}
.svn-repometa.live .dot{background:var(--dsw-alias-state-success-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-success-primary) 16%,transparent)}
.svn-repometa b{font-family:var(--svn-mono);font-size:11px;font-weight:500;color:var(--dsw-alias-label-secondary);padding:1px 6px;border-radius:5px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent)}
.svn-repometa .sep{color:color-mix(in srgb,var(--dsw-alias-label-primary) 22%,transparent)}
.svn-search{position:relative;padding:0 8px 0 5px;gap:6px}
.svn-mode{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border:0;border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;font-weight:500;cursor:pointer;white-space:nowrap}
.svn-mode:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 11%,transparent)}
.svn-mode:disabled{opacity:.5;cursor:default}
.svn-mode-menu{position:absolute;top:36px;left:0;z-index:60;min-width:150px;padding:5px;border:0;border-radius:var(--svn-r2);background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));box-shadow:0 0 0 1px var(--svn-hair),var(--svn-sh2);display:flex;flex-direction:column;gap:2px}
.svn-mode-menu button{display:flex;align-items:center;gap:8px;border:0;background:transparent;border-radius:6px;padding:7px 9px;font:inherit;font-size:12px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left}
.svn-mode-menu button:hover{background:var(--svn-sel)}
.svn-mode-menu button.on{color:var(--svn-act);font-weight:600}
.svn-mode-menu button small{margin-left:auto;max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;color:var(--dsw-alias-label-secondary);font-weight:400}
.svn-mode-menu button.svn-mode-switch{color:var(--svn-act);font-weight:500}
.svn-mode-menu button.svn-mode-switch::before{content:"↳";margin-right:2px;font-family:var(--svn-mono);font-size:11px;opacity:.8}
.svn-mode-menu{min-width:210px;max-width:420px}
.svn-kbd{font-family:var(--svn-mono);font-size:9.5px;color:var(--dsw-alias-label-secondary);padding:1px 5px;border-radius:4px;box-shadow:inset 0 0 0 1px var(--svn-hair);white-space:nowrap}

/* 文件头：两行身份 + 1 主 3 从 */
.svn-fhd{display:flex;align-items:center;gap:10px;flex:0 0 58px;padding:0 12px 0 14px;border-bottom:1px solid var(--svn-hair);min-width:0;overflow:hidden}
.svn-fhd .fid{min-width:0;flex:1}
.svn-fhd .fid b{display:block;font-size:13.5px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.svn-fhd .fid small{display:block;margin-top:2px;font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.svn-fhd .fid .path{font-family:var(--svn-mono);font-size:10.5px;color:color-mix(in srgb,var(--dsw-alias-label-primary) 58%,transparent)}
.svn-fhd .fid .sep{margin:0 5px;color:color-mix(in srgb,var(--dsw-alias-label-primary) 20%,transparent)}
.svn-fa{display:flex;align-items:center;gap:3px;flex:0 0 auto}
.svn-copied{font-size:11px;color:var(--dsw-alias-state-success-primary);white-space:nowrap;margin-right:2px}
.svn-copied.bad{color:var(--dsw-alias-state-error-primary)}
.svn-ibtn{width:28px;height:28px;display:grid;place-items:center;padding:0;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .18s var(--svn-ease),color .18s var(--svn-ease)}
.svn-ibtn svg{width:15px;height:15px}
.svn-ibtn:hover{background:var(--svn-sel);color:var(--dsw-alias-label-primary)}
.svn-ibtn.close:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary)}
.svn-ibtn:disabled{opacity:.4;cursor:default;background:transparent}

/* 文件头内联读取进度 */
.svn-dlprog{display:flex;align-items:center;gap:7px;height:28px;padding:0 3px 0 9px;border-radius:var(--svn-r1);background:color-mix(in srgb,var(--svn-act) 9%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--svn-act) 22%,transparent);color:var(--svn-act);font-size:11px;white-space:nowrap}
.svn-dlprog .track{width:56px;height:4px;border-radius:2px;background:color-mix(in srgb,var(--svn-act) 22%,transparent);overflow:hidden}
.svn-dlprog .track i{display:block;height:100%;border-radius:2px;background:var(--svn-act);transition:width .2s linear}
.svn-dlprog .track.indet i{width:34%;transition:none;animation:svn-indet 1.2s linear infinite}
.svn-dlprog .x{width:20px;height:20px;display:grid;place-items:center;border:0;border-radius:5px;background:transparent;color:inherit;cursor:pointer;font-size:11px}
.svn-dlprog .x:hover{background:color-mix(in srgb,var(--svn-act) 16%,transparent)}
.svn-dlprog.fail{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 9%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-error-primary) 22%,transparent);color:var(--dsw-alias-state-error-primary)}

/* 页签独立行 + 视图控件区 */
.svn-tabbar{display:flex;align-items:center;gap:2px;height:38px;flex:0 0 38px;padding:0 12px;border-bottom:1px solid var(--svn-hair);min-width:0}
.svn-tab{height:38px;padding:0 10px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;cursor:pointer;box-shadow:inset 0 -2px 0 transparent;transition:color .18s var(--svn-ease),box-shadow .18s var(--svn-ease);white-space:nowrap}
.svn-tab:hover{color:var(--dsw-alias-label-primary)}
.svn-tab.on{color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:inset 0 -2px 0 var(--svn-act)}
.svn-tabbar .sp{flex:1;min-width:8px}
.svn-vctl{display:flex;align-items:center;gap:3px;flex:0 0 auto;min-width:0;overflow:hidden}
.svn-vstat{display:inline-flex;align-items:center;gap:5px;margin-right:4px;font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.svn-vstat .dot{width:5px;height:5px;border-radius:50%;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 70%,transparent);flex:0 0 5px}
.svn-vstat .dot.ok{background:var(--dsw-alias-state-success-primary)}
.svn-vstat .dot.warn{background:var(--dsw-alias-state-warn-primary)}
.svn-vbtn{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;cursor:pointer;white-space:nowrap}
.svn-vbtn:hover{background:var(--svn-sel);color:var(--dsw-alias-label-primary)}
.svn-vbtn.on{background:var(--svn-sel);color:var(--dsw-alias-label-primary);font-weight:500}
.svn-vbtn:disabled{opacity:.4;cursor:default}
.svn-vsel{height:24px;border:0;border-radius:6px;background:var(--svn-sel);color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;padding:0 4px;cursor:pointer}
.svn-pg{display:flex;align-items:center;gap:1px;margin-right:2px}
.svn-pg button{width:22px;height:22px;display:grid;place-items:center;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:11px;padding:0}
.svn-pg button:hover{background:var(--svn-sel);color:var(--dsw-alias-label-primary)}
.svn-pg button:disabled{opacity:.35;cursor:default;background:transparent}
.svn-pg span{min-width:46px;text-align:center;font-family:var(--svn-mono);font-size:11px;color:var(--dsw-alias-label-secondary)}
.svn-vico{width:24px;height:24px;display:grid;place-items:center;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0}
.svn-vico:hover{background:var(--svn-sel);color:var(--dsw-alias-label-primary)}
.svn-vico svg{width:14px;height:14px}

/* 浮层：单元格全文 / 菜单 */
.svn-pop{position:fixed;z-index:80;min-width:200px;max-width:420px;padding:9px 11px;border:0;border-radius:var(--svn-r2);background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));box-shadow:0 0 0 1px var(--svn-hair),0 18px 40px -18px rgb(16 24 40/.28);font-size:12px;color:var(--dsw-alias-label-primary)}
.svn-pop .ph{display:flex;align-items:center;gap:8px;margin-bottom:5px}
.svn-pop .ph b{font-family:var(--svn-mono);font-size:10.5px;font-weight:500;letter-spacing:.04em;color:var(--dsw-alias-label-secondary)}
.svn-pop .pv{line-height:1.8;white-space:pre-wrap;word-break:break-word;max-height:200px;overflow:auto}
.svn-pop .acts{display:flex;gap:6px;justify-content:flex-end;margin-top:8px}
.svn-menu{min-width:190px;padding:5px}
.svn-menu button{display:flex;width:100%;align-items:center;gap:8px;border:0;background:transparent;border-radius:6px;padding:7px 9px;font:inherit;font-size:12px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left}
.svn-menu button:hover{background:var(--svn-sel)}
.svn-menu button span{margin-left:auto;font-family:var(--svn-mono);font-size:10px;color:var(--dsw-alias-label-secondary)}
.svn-menu button:disabled{opacity:.45;cursor:default}

/* 读取骨架 / 门槛卡片 */
.svn-skel{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:22px;background:var(--dsw-alias-bg-base)}
.svn-skel .box{width:min(100%,760px);padding:26px 24px;border-radius:var(--svn-r2);background:var(--dsw-alias-bg-layer-1);box-shadow:inset 0 0 0 1px var(--svn-hair);display:flex;flex-direction:column;gap:12px}
.svn-skel .lines{display:flex;flex-direction:column;gap:8px}
.svn-skel .lines i{display:block;height:7px;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent)}
.svn-skel .lines i:nth-child(2){width:82%}
.svn-skel .lines i:nth-child(3){width:64%}
.svn-skel .lines i:nth-child(4){width:73%}
.svn-skel .t1{font-size:12.5px;color:var(--dsw-alias-label-primary);font-weight:500}
.svn-skel .t2{font-size:11.5px;color:var(--dsw-alias-label-secondary);line-height:1.8}
.svn-skel .bar{height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.svn-skel .bar i{display:block;height:100%;background:var(--svn-act);border-radius:2px;transition:width .2s linear}
.svn-skel .bar.indet i{width:30%;transition:none;animation:svn-indet 1.2s linear infinite}
.svn-skel .acts{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.svn-gate{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:24px}
.svn-gate .box{width:min(520px,92%);padding:20px 22px;border-radius:var(--svn-r2);background:var(--dsw-alias-bg-layer-1);box-shadow:0 0 0 1px var(--svn-hair),var(--svn-sh1);display:flex;flex-direction:column;gap:10px}
.svn-gate .row1{display:flex;align-items:center;gap:8px;min-width:0}
.svn-gate .row1 b{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.svn-gate .reason{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.7}
.svn-gate .acts{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}

/* 目录树头 = 过滤框 */
.svn-treehd{display:flex;align-items:center;gap:7px;height:38px;flex:0 0 38px;padding:0 8px 0 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.svn-treefilter{flex:1;display:flex;align-items:center;gap:6px;height:26px;padding:0 8px;border-radius:7px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent);box-shadow:inset 0 0 0 1px var(--svn-hair);min-width:0;transition:box-shadow .3s var(--svn-ease)}
.svn-treefilter:focus-within{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--svn-act) 45%,transparent)}
.svn-treefilter .mag{color:var(--dsw-alias-label-secondary);display:grid;place-items:center;flex:0 0 auto}
.svn-treefilter input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:11.5px;color:var(--dsw-alias-label-primary)}
.svn-treefilter input::placeholder{color:var(--dsw-alias-label-secondary)}
.svn-treecount{font-family:var(--svn-mono);font-size:10.5px;color:var(--dsw-alias-label-secondary);flex:0 0 auto}
.svn-treehit{color:var(--svn-act)}

/* 目录态工具栏（原面包屑行，仅无文件时出现） */
.svn-dirtools{display:flex;align-items:center;gap:6px;height:38px;flex:0 0 38px;padding:0 12px;border-bottom:1px solid var(--svn-hair);min-width:0;overflow:hidden}

/* 表格 v2：合并还原 + 双层吸顶表头 */
.svn-sheetbar{display:flex;align-items:center;gap:8px;flex:0 0 34px;padding:0 12px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);min-width:0;overflow:hidden}
.svn-sheet{height:24px;padding:0 9px;border:0;border-radius:6px;background:var(--dsw-alias-bg-base);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;cursor:pointer;white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis}
.svn-sheet:hover{color:var(--dsw-alias-label-primary)}
.svn-sheet.on{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--svn-act) 45%,transparent);color:var(--svn-act);font-weight:600}
.svn-gridwrap{flex:1;min-height:0;overflow:auto;position:relative}
.svn-sheettitle{padding:12px 14px 8px;font-size:13px;font-weight:600;letter-spacing:-.01em;color:var(--dsw-alias-label-primary)}
.svn-grid2{width:100%;table-layout:fixed;border-collapse:separate;border-spacing:0;font-size:11.5px;font-variant-numeric:tabular-nums}
.svn-grid2 th,.svn-grid2 td{border-right:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1);padding:5px 8px;text-align:left;vertical-align:top;overflow:hidden}
.svn-grid2 thead{position:sticky;top:0;z-index:3;background:var(--dsw-alias-bg-layer-2)}
.svn-grid2 thead th{background:var(--dsw-alias-bg-layer-2);font-weight:600;color:var(--dsw-alias-label-primary);vertical-align:middle}
.svn-grid2 .rn{position:sticky;left:0;z-index:1;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);text-align:right;font-family:var(--svn-mono);font-size:10px;padding-right:7px;font-weight:400}
.svn-grid2 thead .rn{z-index:3;background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,var(--dsw-alias-bg-layer-1))}
.svn-grid2 td{cursor:default;background:var(--dsw-alias-bg-base)}
.svn-grid2 td:hover{background:color-mix(in srgb,var(--svn-act) 5%,var(--dsw-alias-bg-base))}
.svn-grid2 td.grp,.svn-grid2 th.grp{background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,var(--dsw-alias-bg-layer-1))}
.svn-grid2 td.grp{font-weight:500}
.svn-grid2 .note td{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.8;padding:9px 10px;white-space:pre-wrap}
.svn-grid2 .note .rn{background:var(--dsw-alias-bg-layer-1)}
.svn-cl2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.55}
.svn-gridwrap.nowrap .svn-cl2{-webkit-line-clamp:1;white-space:nowrap;text-overflow:ellipsis}
.svn-gridwrap.nowrap .svn-grid2 td,.svn-gridwrap.nowrap .svn-grid2 th{white-space:nowrap}
.svn-more{padding:8px 12px}

/* ===== 浮层 v3（0.2.2）：白底表面 + 三件套阴影 + 蓝色悬停 ===== */
.svn-app{
  --svn-surface:#ffffff;
  --svn-pop-line:rgb(16 24 40 / .08);
  --svn-pop-shadow:0 0 0 1px var(--svn-pop-line),0 2px 4px rgb(16 24 40 / .06),0 18px 36px -18px rgb(16 24 40 / .26);
  --svn-hover:color-mix(in srgb,var(--svn-act) 7%,transparent);
  --svn-hover-on:color-mix(in srgb,var(--svn-act) 12%,transparent);
}
@media (prefers-color-scheme:dark){
  .svn-app{
    --svn-surface:#20252c;
    --svn-pop-line:rgb(255 255 255 / .09);
    --svn-pop-shadow:0 0 0 1px var(--svn-pop-line),0 2px 6px rgb(0 0 0 / .4),0 20px 40px -20px rgb(0 0 0 / .7);
    --svn-hover:color-mix(in srgb,var(--svn-act) 16%,transparent);
    --svn-hover-on:color-mix(in srgb,var(--svn-act) 22%,transparent);
  }
}
.dark .svn-app,.svn-app.dark,:where(.dark) .svn-app{
  --svn-surface:#20252c;
  --svn-pop-line:rgb(255 255 255 / .09);
  --svn-pop-shadow:0 0 0 1px var(--svn-pop-line),0 2px 6px rgb(0 0 0 / .4),0 20px 40px -20px rgb(0 0 0 / .7);
  --svn-hover:color-mix(in srgb,var(--svn-act) 16%,transparent);
  --svn-hover-on:color-mix(in srgb,var(--svn-act) 22%,transparent);
}

/* 按钮内的图标与文字：统一 flex 对齐 + 间距 */
.svn-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px}
.svn-btn.primary{gap:9px}
.svn-nest{width:18px;height:18px;flex:0 0 18px}

/* 连接历史浮层 */
.svn-roots{
  top:38px;padding:6px;border-radius:12px;background:var(--svn-surface);
  box-shadow:var(--svn-pop-shadow);
}
.svn-roots .hd{display:flex;align-items:center;gap:8px;padding:7px 9px 6px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.svn-roots .hd b{font-size:11px;font-weight:500;color:var(--dsw-alias-label-primary)}
.svn-roots .hd .cnt{margin-left:auto;font-family:var(--svn-mono);font-size:10px;color:var(--dsw-alias-label-secondary)}
.svn-roots .it{
  position:relative;display:flex;align-items:center;gap:9px;height:38px;padding:0 6px 0 10px;border-radius:7px;
  font-size:12.5px;color:var(--dsw-alias-label-primary);cursor:pointer;outline:0;
  transition:background .15s var(--svn-ease);
}
.svn-roots .it:hover,.svn-roots .it:focus-visible{background:var(--svn-hover)}
.svn-roots .it:focus-visible{box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--svn-act) 55%,transparent)}
.svn-roots .it.cur{background:var(--svn-hover-on)}
.svn-roots .it.cur::before{content:"";position:absolute;left:0;top:9px;bottom:9px;width:2px;border-radius:2px;background:var(--svn-act)}
.svn-roots .it .p{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--svn-mono);font-size:11.5px}
.svn-roots .it .t{flex:0 0 auto;padding:1px 6px;border-radius:5px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);color:var(--dsw-alias-label-secondary);font-size:10px}
.svn-roots .it .tm{flex:0 0 auto;font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.svn-roots .rm{
  flex:0 0 auto;width:22px;height:22px;display:grid;place-items:center;border:0;border-radius:5px;background:transparent;
  color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:12px;opacity:0;
  transition:opacity .12s var(--svn-ease),background .12s var(--svn-ease),color .12s var(--svn-ease);
}
.svn-roots .it:hover .rm,.svn-roots .it:focus-within .rm,.svn-roots .it.cur .rm{opacity:1}
.svn-roots .rm:hover{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}

/* 菜单浮层（更多 / 复制路径 / 搜索模式） */
.svn-pop{background:var(--svn-surface);box-shadow:var(--svn-pop-shadow);border-radius:12px}
.svn-pop.svn-menu{padding:5px}
.svn-menu button{
  height:34px;padding:0 9px;border-radius:7px;gap:9px;font-size:12.5px;outline:0;
  transition:background .15s var(--svn-ease);
}
.svn-menu button:hover,.svn-menu button:focus-visible{background:var(--svn-hover)}
.svn-menu button:focus-visible{box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--svn-act) 55%,transparent)}
.svn-menu button svg{width:15px;height:15px;flex:0 0 15px;color:var(--dsw-alias-label-secondary)}
.svn-menu button .hint{margin-left:auto;font-family:var(--svn-mono);font-size:10px;color:var(--dsw-alias-label-secondary)}
.svn-mode-menu{background:var(--svn-surface);box-shadow:var(--svn-pop-shadow);border-radius:12px}
.svn-mode-menu button{height:34px;border-radius:7px;padding:0 9px}
.svn-mode-menu button:hover{background:var(--svn-hover)}

/* ===== 输入类控件聚焦态（0.2.7）：去掉浏览器矩形描边，只留一圈柔和蓝环 ===== */
.svn-rootbox .svn-input:focus,.svn-rootbox .svn-input:focus-visible,.svn-rootbox .svn-input:focus-within{box-shadow:none}
.svn-search input:focus,.svn-search input:focus-visible,.svn-treefilter input:focus,.svn-treefilter input:focus-visible{outline:0}
.svn-rootbox:focus-within,.svn-search:focus-within{
  background:var(--dsw-alias-bg-base);
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--svn-act) 40%,transparent);
}
.svn-treefilter:focus-within{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--svn-act) 40%,transparent)}

/* 目录选择弹窗（0.3.4） */
.svn-picker-overlay{position:fixed;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;padding:24px;background:rgb(16 24 40 / .28)}
.svn-picker{width:min(600px,100%);max-height:min(70vh,560px);display:flex;flex-direction:column;background:var(--svn-surface);border-radius:12px;box-shadow:var(--svn-pop-shadow);overflow:hidden}
.svn-picker-hd{display:flex;align-items:baseline;gap:10px;padding:14px 16px 6px}
.svn-picker-hd b{font-size:13.5px;font-weight:600}
.svn-picker-path{display:flex;align-items:center;gap:8px;padding:0 16px 10px}
.svn-picker-path .p{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--svn-mono);font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.svn-picker-list{flex:1;min-height:120px;overflow:auto;padding:4px 8px;border-top:1px solid var(--svn-hair)}
.svn-picker-item{display:flex;align-items:center;gap:9px;width:100%;height:34px;padding:0 10px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;text-align:left;cursor:pointer;outline:0}
.svn-picker-item:hover,.svn-picker-item:focus-visible{background:var(--svn-hover)}
.svn-picker-item:focus-visible{box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--svn-act) 55%,transparent)}
.svn-picker-item .ico{flex:0 0 14px;height:11px;border-radius:2px;background:#fdf3e3;box-shadow:inset 0 0 0 1px #e8cfa4}
.svn-picker-item .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.svn-picker-ft{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--svn-hair)}
/* 范围/模式菜单底部的说明行（0.2.8） */
.svn-mode-note{padding:7px 9px 5px;margin-top:3px;border-top:1px solid var(--svn-pop-line,var(--svn-hair));font-size:10.5px;line-height:1.6;color:var(--dsw-alias-label-secondary);max-width:300px}
@keyframes svn-slide{0%{transform:translateX(-60%)}100%{transform:translateX(60%)}}
/* ===== 按钮配色：三色角色（2026-11-20 用户定稿）+ 填充强度 100% =====
   导航 --nav / 检索 --find / 主操作 --go；浅底与描边由 color-mix 从角色色推导，
   以后换色只改这三个变量。 */
.svn-app{--nav:#3694f2;--find:#2b6cf0;--go:#37ae71}
/* 导航：地址栏下拉箭头、刷新、全部收起、页签与工作表标签 */
.svn-rootcaret{background:color-mix(in srgb,var(--nav) 14%,var(--svn-surface));color:color-mix(in srgb,var(--nav) 86%,var(--dsw-alias-label-primary));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--nav) 30%,transparent)}
.svn-rootcaret:hover{background:var(--nav);color:#fff;box-shadow:none}
.svn-top>.svn-ibtn,.svn-treehd .svn-ibtn{color:color-mix(in srgb,var(--nav) 86%,var(--dsw-alias-label-primary));background:color-mix(in srgb,var(--nav) 14%,var(--svn-surface));border-radius:6px}
.svn-top>.svn-ibtn:hover,.svn-treehd .svn-ibtn:hover{background:color-mix(in srgb,var(--nav) 24%,var(--svn-surface));color:color-mix(in srgb,var(--nav) 86%,var(--dsw-alias-label-primary))}
.svn-tab.on{color:color-mix(in srgb,var(--nav) 86%,var(--dsw-alias-label-primary))}
.svn-tab.on::after{background:var(--nav)}
.svn-sheet.on{color:color-mix(in srgb,var(--nav) 86%,var(--dsw-alias-label-primary));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--nav) 40%,transparent)}
/* 检索：搜索、名称·全仓、搜索框焦点、命中大小、范围 chip */
.svn-top>.svn-btn{background:var(--find);color:#fff;font-weight:600;box-shadow:0 1px 2px color-mix(in srgb,var(--find) 30%,transparent)}
.svn-top>.svn-btn:hover{background:color-mix(in srgb,var(--find) 84%,#000)}
.svn-mode{background:color-mix(in srgb,var(--find) 14%,var(--svn-surface));color:color-mix(in srgb,var(--find) 60%,var(--dsw-alias-label-primary));font-weight:500}
.svn-mode:hover{background:color-mix(in srgb,var(--find) 22%,var(--svn-surface))}
.svn-search:focus-within{background:var(--dsw-alias-bg-base);box-shadow:inset 0 0 0 1px var(--find)}
.svn-hit:hover{background:color-mix(in srgb,var(--find) 6%,var(--svn-surface))}
.svn-hit .cnt{color:color-mix(in srgb,var(--find) 60%,var(--dsw-alias-label-primary))}
.svn-treehit{color:color-mix(in srgb,var(--find) 60%,var(--dsw-alias-label-primary))}
.svn-split .svn-chip{background:color-mix(in srgb,var(--find) 14%,var(--svn-surface));color:color-mix(in srgb,var(--find) 60%,var(--dsw-alias-label-primary));box-shadow:none}
.svn-split .svn-btn.act{background:var(--svn-surface);color:var(--dsw-alias-label-primary);box-shadow:inset 0 0 0 1px var(--svn-hair)}
/* 主操作：下载、加载更多、已缓存成功 */
/* 主操作绿改浅底深字（0.3.14 对比度收口）：从表面色推导，深浅主题都 ≥4.5:1；选择器/门槛卡与文件头下载同一模式 */
.svn-btn.primary{background:color-mix(in srgb,var(--go) 14%,var(--svn-surface));color:color-mix(in srgb,var(--go) 62%,var(--dsw-alias-label-primary));font-weight:600;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--go) 26%,transparent)}
.svn-btn.primary:hover{background:color-mix(in srgb,var(--go) 22%,var(--svn-surface))}
.svn-btn.ok{background:color-mix(in srgb,var(--go) 14%,var(--svn-surface));color:color-mix(in srgb,var(--go) 82%,var(--dsw-alias-label-primary));box-shadow:none}
.loadmore .svn-btn{background:color-mix(in srgb,var(--go) 14%,var(--svn-surface));color:color-mix(in srgb,var(--go) 82%,var(--dsw-alias-label-primary));box-shadow:none}
.loadmore .svn-btn:hover{background:color-mix(in srgb,var(--go) 22%,var(--svn-surface))}
/* 视图开关保持中性描边，选中转墨；关闭仍是幽灵图标 */
.svn-vbtn{background:var(--svn-surface);color:var(--dsw-alias-label-primary);box-shadow:inset 0 0 0 1px var(--svn-hair);border-radius:6px}
.svn-vbtn:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,var(--svn-surface))}
.svn-vbtn.on{background:#16181d;color:#fff;box-shadow:none}
.svn-fhd .svn-ibtn{color:var(--dsw-alias-label-secondary)}
.svn-fhd .svn-ibtn:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,var(--svn-surface));color:color-mix(in srgb,var(--nav) 86%,var(--dsw-alias-label-primary))}
.svn-fhd .svn-ibtn.close:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,var(--svn-surface));color:var(--dsw-alias-state-error-primary)}

/* 下载按钮：浅色背景 + 深绿字（2026-11-20 用户定）；仅文件头这一处，其它主操作不变 */
.svn-fhd .svn-btn.primary{background:color-mix(in srgb,var(--go) 12%,var(--svn-surface));color:color-mix(in srgb,var(--go) 62%,var(--dsw-alias-label-primary));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--go) 26%,transparent);border-color:transparent}
.svn-fhd .svn-btn.primary:hover{background:color-mix(in srgb,var(--go) 20%,var(--svn-surface))}
.svn-fhd .svn-btn.primary .svn-nest{background:color-mix(in srgb,var(--go) 20%,var(--svn-surface));color:color-mix(in srgb,var(--go) 62%,var(--dsw-alias-label-primary))}
.svn-fhd .svn-btn.primary:disabled{opacity:.55}

/* ===== 0.3.13：toast 层 / 状态栏 / 图例 / 上下文栏 / diff 跳转条 / 键盘焦点 ===== */
.svn-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.svn-toasts{position:absolute;right:16px;bottom:44px;z-index:70;display:flex;flex-direction:column;align-items:flex-end;gap:8px;max-width:calc(100% - 32px);pointer-events:none}
.svn-toast{pointer-events:auto;display:flex;align-items:flex-start;gap:8px;max-width:min(320px,100%);padding:9px 10px 9px 12px;border-radius:11px;background:var(--svn-surface);box-shadow:var(--svn-pop-shadow);font-size:12px;animation:svn-toast-in .22s var(--svn-ease)}
@keyframes svn-toast-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.svn-toast .sign{flex:0 0 18px;width:18px;height:18px;border-radius:50%;display:grid;place-items:center;color:#fff;margin-top:1px}
.svn-toast.ok .sign{background:var(--go)}
.svn-toast.fail .sign{background:var(--dsw-alias-state-error-primary)}
.svn-toast .sign svg{width:11px;height:11px}
.svn-toast .tbody{min-width:0;flex:1}
.svn-toast .msg{font-weight:600;line-height:18px;overflow-wrap:anywhere}
.svn-toast .sub{margin-top:2px;font-size:11px;font-weight:400;color:var(--dsw-alias-label-secondary);line-height:1.5;overflow-wrap:anywhere}
.svn-toast .acts{display:flex;gap:6px;margin-top:6px}
.svn-toast .acts button{border:0;border-radius:6px;padding:3px 9px;font:inherit;font-size:11px;font-weight:600;cursor:pointer;background:color-mix(in srgb,var(--svn-act) 12%,transparent);color:var(--svn-act)}
.svn-toast .acts button:hover{background:color-mix(in srgb,var(--svn-act) 20%,transparent)}
.svn-toast .x{flex:0 0 19px;width:19px;height:19px;display:grid;place-items:center;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:11px;padding:0}
.svn-toast .x:hover{background:var(--svn-sel);color:var(--dsw-alias-label-primary)}
.svn-statusbar{display:flex;align-items:center;gap:10px;height:29px;flex:0 0 29px;padding:0 14px;border-top:1px solid var(--svn-hair);background:var(--dsw-alias-bg-layer-1);font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden}
.svn-statusbar .seg{display:inline-flex;align-items:center;gap:5px;min-width:0}
.svn-statusbar .seg.click{cursor:pointer;border:0;background:transparent;font:inherit;font-size:11px;color:inherit;padding:2px 6px;border-radius:5px}
.svn-statusbar .seg.click:hover{background:var(--svn-sel);color:var(--dsw-alias-label-primary)}
.svn-statusbar .dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary);flex:0 0 6px}
.svn-statusbar .dot.off{background:var(--dsw-alias-label-secondary)}
.svn-statusbar .mono{font-family:var(--svn-mono);font-size:10.5px}
.svn-statusbar .sp{flex:1}
.svn-legend{padding:6px 10px;border-bottom:1px solid var(--svn-hair);background:var(--dsw-alias-bg-base);display:flex;flex-direction:column;gap:5px;font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.svn-legend .l1{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.svn-legend .sw{width:8px;height:10px;border-radius:2px;display:inline-block}
.svn-legend .it{display:inline-flex;align-items:center;gap:4px}
.svn-legend .stag{flex:0 0 18px;height:16px;border-radius:4px;color:#fff;font-size:9px;font-weight:700;display:inline-flex;align-items:center;justify-content:center}
.svn-legend .fold{margin-left:auto;width:18px;height:18px;display:grid;place-items:center;border:0;border-radius:5px;background:transparent;color:inherit;cursor:pointer;padding:0}
.svn-legend .fold:hover{background:var(--svn-sel)}
.svn-row:focus-visible,.svn-tr:focus-visible,.svn-hit:focus-visible,.svn-hist:focus-visible{outline:2px solid color-mix(in srgb,var(--svn-act) 55%,transparent);outline-offset:-2px;border-radius:8px}
.svn-row .pv{margin-left:auto;display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--find)}
.svn-row .pv+.n{margin-left:6px}
.svn-crumbseg{border:0;background:transparent;font:inherit;font-size:11px;color:var(--dsw-alias-label-secondary);padding:1px 4px;border-radius:4px;cursor:pointer;white-space:nowrap}
.svn-crumbseg:hover{background:var(--svn-hover);color:var(--svn-act)}
.svn-crumbseg.cur{color:var(--dsw-alias-label-primary);font-weight:600}
.svn-crumbwrap{display:inline-flex;align-items:center;min-width:0;overflow:hidden}
.svn-fhd .fid small{display:flex;align-items:center}
.svn-jumpbar{display:flex;align-items:center;gap:6px;padding:6px 12px;border-bottom:1px solid var(--svn-hair);font-size:11px;color:var(--dsw-alias-label-secondary)}
.svn-jumpbar .cnt{font-family:var(--svn-mono);font-size:10.5px}
.svn-jumpbar .sp{flex:1}
.svn-diffsplit{display:grid;grid-template-columns:1fr 1fr;font-family:var(--svn-mono);font-size:12px;line-height:20px}
.svn-diffsplit .col{min-width:0;overflow-x:auto;padding:10px 12px;white-space:pre}
.svn-diffsplit .col+.col{border-left:1px solid var(--svn-hair)}
.svn-diffsplit .svn-ln{grid-template-columns:34px 1fr}
.svn-ln.jump{box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--svn-act) 55%,transparent)}
.svn-rail{flex:0 0 264px;min-width:0;display:flex;flex-direction:column;border-left:1px solid var(--svn-hair);background:var(--dsw-alias-bg-layer-1);overflow:auto}
.svn-rail .sec{padding:10px 12px;border-bottom:1px solid var(--svn-hair)}
.svn-rail .sec h3{display:flex;align-items:center;gap:6px;margin:0 0 8px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.svn-rail .sec h3 .x{margin-left:auto;font-size:10px;font-weight:400}
.svn-rail .idcard{display:flex;gap:8px;align-items:flex-start;font-size:12px}
.svn-rail .idcard b{display:block;font-size:12.5px;overflow-wrap:anywhere}
.svn-rail .idcard .sub{display:block;margin-top:3px;font-size:10.5px;color:var(--dsw-alias-label-secondary);line-height:1.6;overflow-wrap:anywhere}
.svn-rail .acts{display:flex;flex-wrap:wrap;gap:6px}
.svn-rail .revmini{display:flex;gap:8px;width:100%;text-align:left;border:0;background:transparent;border-radius:7px;padding:6px 7px;cursor:pointer;font:inherit;color:inherit}
.svn-rail .revmini:hover{background:var(--svn-hover)}
.svn-rail .revmini.cur{background:var(--svn-hover-on)}
.svn-rail .revmini .rn2{font-family:var(--svn-mono);font-size:10.5px;color:var(--svn-act);flex:0 0 auto}
.svn-rail .revmini .rm2{min-width:0}
.svn-rail .revmini .rm2 p{margin:0;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.svn-rail .revmini .rm2 small{font-size:10px;color:var(--dsw-alias-label-secondary)}
.svn-rail .sib{display:flex;align-items:center;gap:6px;width:100%;text-align:left;border:0;background:transparent;font:inherit;font-size:11.5px;color:inherit;padding:4px 2px;min-width:0;cursor:pointer;border-radius:5px}
.svn-rail .sib:hover{background:var(--svn-hover)}
.svn-rail .sib .nm2{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.svn-rail .sib .sz{font-size:10px;color:var(--dsw-alias-label-secondary);font-family:var(--svn-mono)}
.svn-rail .foot{padding:10px 12px}
.svn-setpop{min-width:210px}
.svn-setpop .row{display:flex;align-items:center;gap:8px;padding:5px 2px;font-size:12px}
.svn-setpop .row label{display:flex;align-items:center;gap:7px;flex:1;cursor:pointer}
.svn-setpop .row input[type=checkbox]{accent-color:var(--svn-act);width:14px;height:14px}
.svn-setpop .row select{height:24px;border:0;border-radius:6px;background:var(--svn-sel);color:inherit;font:inherit;font-size:11.5px;padding:0 4px}
.svn-idxcard{margin:10px 12px 0;padding:10px 14px;border-radius:10px;background:color-mix(in srgb,var(--find) 7%,var(--dsw-alias-bg-base));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--find) 22%,transparent);display:flex;flex-direction:column;gap:7px;font-size:11.5px;color:var(--dsw-alias-label-primary)}
.svn-idxcard .r1{display:flex;align-items:center;gap:8px}
.svn-idxcard .r1 .sp{flex:1}
.svn-idxcard .track{height:5px;border-radius:3px;background:color-mix(in srgb,var(--find) 18%,transparent);overflow:hidden}
.svn-idxcard .track i{display:block;height:100%;background:var(--find);border-radius:3px;transition:width .3s linear}
.svn-idxcard .track.indet i{width:34%;animation:svn-indet 1.2s linear infinite}
.svn-idxcard .note{font-size:10.5px;color:var(--dsw-alias-label-secondary);line-height:1.6}

/* ===== 0.3.20 V4：最近段 + 目录栏收起/浮层 =====
   新增表面色一律从角色色/令牌 color-mix 推导，双主题对比度 ≥4.5:1；不硬混 #fff/#000。 */
.svn-sec-hd{display:flex;align-items:center;gap:8px;padding:8px 14px 4px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.svn-sec-hd b{font-size:11px;font-weight:600;color:var(--dsw-alias-label-primary)}
.svn-sec-hd .cnt{margin-left:auto;font-family:var(--svn-mono);font-size:10px}
.svn-sec-clear{border:0;background:transparent;font:inherit;font-size:10.5px;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:1px 6px;border-radius:5px}
.svn-sec-clear:hover{background:var(--svn-sel);color:var(--dsw-alias-label-primary)}
/* 0.3.22：VS Code 资源管理器式折叠段头（twisty+标题+计数），清空钮独立不嵌套 */
.svn-sec-hd{padding:6px 10px 4px}
.svn-sec-toggle{flex:1;min-width:0;display:flex;align-items:center;gap:6px;border:0;background:transparent;font:inherit;color:inherit;padding:6px 4px;border-radius:6px;cursor:pointer;text-align:left}
.svn-sec-toggle:hover{background:var(--svn-sel)}
.svn-sec-toggle .chev{flex:0 0 12px;width:12px;height:12px;transition:transform .15s var(--svn-ease)}
.svn-sec-toggle[aria-expanded="false"] .chev{transform:rotate(-90deg)}
.svn-sec-toggle b{font-size:11px;font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.svn-sec-toggle .cnt{margin-left:auto;font-family:var(--svn-mono);font-size:10px;color:var(--dsw-alias-label-secondary)}
.svn-sec-recent{max-height:120px;overflow-y:auto;overscroll-behavior:contain}
.svn-sec-all{flex:1;min-height:0;display:flex;flex-direction:column}
.svn-sec-recent[hidden],.svn-sec-all[hidden]{display:none}
.svn-sec-sep{border-top:1px solid var(--svn-hair);margin:6px 0 2px}
.svn-recent-row{display:flex;align-items:center;gap:6px;width:calc(100% - 12px);margin:0 6px;height:30px;padding:0 8px;border:0;border-radius:10px;background:transparent;font:inherit;font-size:12.5px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;transition:background .15s var(--svn-ease)}
.svn-recent-row:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent)}
.svn-recent-row:focus-visible{outline:2px solid color-mix(in srgb,var(--svn-act) 55%,transparent);outline-offset:-2px}
.svn-recent-row .nm{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.svn-recent-row .tm{margin-left:auto;font-size:10.5px;color:var(--dsw-alias-label-secondary);font-family:var(--svn-mono);white-space:nowrap}
.svn-recent-empty{padding:2px 14px 6px}
/* 0.3.23：树脚注状态条移除（用户指令），计数已在段头 */
.svn-dockrail{flex:0 0 44px;display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px 0;background:var(--dsw-alias-bg-layer-1);border-right:1px solid var(--svn-hair)}
.svn-dockrail button{width:38px;min-height:44px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;border:0;border-radius:8px;background:transparent;color:color-mix(in srgb,var(--nav) 70%,var(--dsw-alias-label-primary));cursor:pointer;font:inherit;font-size:10.5px;line-height:1.2;padding:4px 0;transition:background .14s ease}
.svn-dockrail button:hover{background:color-mix(in srgb,var(--nav) 14%,var(--svn-surface))}
.svn-dockrail button[aria-expanded="true"]{background:color-mix(in srgb,var(--nav) 20%,var(--svn-surface))}
.svn-dockrail button:focus-visible{outline:2px solid color-mix(in srgb,var(--svn-act) 55%,transparent);outline-offset:-2px}
.svn-dockrail button svg{width:16px;height:16px}
.svn-dockrail .sp{flex:1}
.svn-dockrail button.neutral{color:var(--dsw-alias-label-secondary)}
.svn-dockrail button.neutral:hover{background:var(--svn-sel);color:var(--dsw-alias-label-primary)}
.svn-flyout{position:fixed;z-index:50;width:300px;display:flex;flex-direction:column;border:0;border-radius:12px;background:var(--svn-surface);box-shadow:var(--svn-pop-shadow);overflow:hidden;color:var(--dsw-alias-label-primary)}
.svn-flyout-hd{display:flex;align-items:center;gap:8px;height:38px;flex:0 0 38px;padding:0 8px 0 14px;border-bottom:1px solid var(--svn-hair);font-size:12px;font-weight:600}
.svn-flyout-hd .cnt{font-family:var(--svn-mono);font-size:10px;color:var(--dsw-alias-label-secondary);font-weight:400}
.svn-flyout-hd .sp{flex:1}
.svn-flyout .svn-scroll{max-height:400px}
.svn-flyout .svn-ibtn.neutral{background:transparent;color:var(--dsw-alias-label-secondary)}
.svn-flyout .svn-ibtn.neutral:hover{background:var(--svn-sel);color:var(--dsw-alias-label-primary)}

`

    /* ------------------------------------------------------------- pieces */

    /* 图标精灵：一次注册，行内用 <use href="#svn-i-xxx"> */
    const PAGE_SHAPES = [
      ['path', { d: 'M7 2.5h6.7c.3 0 .6.1.8.3l4 4c.2.2.3.5.3.8v11.5c0 .9-.7 1.6-1.6 1.6H7c-.9 0-1.6-.7-1.6-1.6V4.1c0-.9.7-1.6 1.6-1.6Z', fill: 'var(--svn-icon-page)', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' }],
      ['path', { d: 'M13.7 2.6v3.8c0 .6.5 1.1 1.1 1.1h3.8', fill: 'var(--svn-icon-page-fold)', stroke: 'currentColor', strokeWidth: 1.1, strokeLinejoin: 'round' }],
    ]
    const ICON_SHAPES = {
      folder: [
        ['path', { d: 'M3.5 7.2c0-.9.7-1.6 1.6-1.6h4l1.8 2h8c.9 0 1.6.7 1.6 1.6v7.6c0 .9-.7 1.6-1.6 1.6H5.1c-.9 0-1.6-.7-1.6-1.6V7.2Z', fill: 'currentColor', fillOpacity: 0.18, stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round' }],
      ],
      'folder-open': [
        ['path', { d: 'M3.6 7.2c0-.9.7-1.6 1.6-1.6h3.9l1.8 2h8.2c.9 0 1.6.7 1.6 1.6v2.2H3.6V7.2Z', fill: 'currentColor', fillOpacity: 0.18, stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round' }],
        ['path', { d: 'M2.6 12.9h18.8c.6 0 1.1.6 1 1.3l-1.3 4.2c-.2.7-.8 1.1-1.5 1.1H4.4c-.7 0-1.3-.4-1.5-1.1l-1.3-4.2c-.1-.7.4-1.3 1-1.3Z', fill: 'currentColor', fillOpacity: 0.18, stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round' }],
      ],
      repo: [
        ['path', { d: 'M4 6.2c0-1.5 3.6-2.7 8-2.7s8 1.2 8 2.7v11.6c0 1.5-3.6 2.7-8 2.7s-8-1.2-8-2.7V6.2Z', fill: 'var(--svn-icon-page)', stroke: 'currentColor', strokeWidth: 1.3 }],
        ['path', { d: 'M4 6.2c0 1.5 3.6 2.7 8 2.7s8-1.2 8-2.7', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 }],
        ['path', { d: 'M4 11.6c0 1.5 3.6 2.7 8 2.7s8-1.2 8-2.7', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, opacity: 0.55 }],
        ['path', { d: 'M4 16.9c0 1.5 3.6 2.7 8 2.7s8-1.2 8-2.7', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, opacity: 0.55 }],
      ],
      word: PAGE_SHAPES.concat([
        ['path', { d: 'M8.2 11.2 9.6 17h1.5l.9-3.9.9 3.9h1.5l1.4-5.8h-1.4l-.8 4.1-1-4.1h-1.3l-1 4.1-.8-4.1H8.2Z', fill: 'currentColor' }],
      ]),
      excel: PAGE_SHAPES.concat([
        ['path', { d: 'M8.3 11.4h7.4v1.2H8.3zM8.3 13.6h7.4v1.2H8.3zM8.3 15.8h4.6v1.2H8.3z', fill: 'currentColor', opacity: 0.9 }],
      ]),
      ppt: PAGE_SHAPES.concat([
        ['path', { d: 'M8.6 17V11h2.6a2.2 2.2 0 0 1 0 4.4H9.9V17H8.6Zm1.3-2.9h1.3a.9.9 0 0 0 0-1.8H9.9v1.8Z', fill: 'currentColor' }],
        ['path', { d: 'M14.6 15.4v1.6h1.6a1.6 1.6 0 0 0 0-3.2h-1.6v1.6Z', fill: 'currentColor', opacity: 0.55 }],
      ]),
      pdf: PAGE_SHAPES.concat([
        ['path', { d: 'M8.4 17V11h2.3a2 2 0 0 1 0 4h-1v2H8.4Zm1.3-3.1h1a.8.8 0 0 0 0-1.6h-1v1.6Z', fill: 'currentColor' }],
        ['path', { d: 'M12.6 11h1.7a3 3 0 0 1 0 6h-1.7v-6Zm1.3 1.3v3.4h.4a1.7 1.7 0 0 0 0-3.4h-.4Z', fill: 'currentColor', opacity: 0.85 }],
        ['path', { d: 'M17 11h2.6v1.3h-1.3v1.1h1.2v1.2h-1.2V17H17v-6Z', fill: 'currentColor', opacity: 0.6 }],
      ]),
      image: PAGE_SHAPES.concat([
        ['circle', { cx: 10.2, cy: 12.4, r: 1.3, fill: 'currentColor' }],
        ['path', { d: 'M8.2 17.4l2.9-3.1 1.6 1.6 1.5-1.8 1.8 3.3H8.2Z', fill: 'currentColor' }],
      ]),
      archive: PAGE_SHAPES.concat([
        ['path', { d: 'M11 3.4h2v1.6h-2zM11 6.2h2v1.6h-2zM11 9h2v1.6h-2z', fill: 'currentColor', opacity: 0.75 }],
        ['rect', { x: 9.4, y: 11.4, width: 5.2, height: 5.6, rx: 1, fill: 'currentColor' }],
        ['rect', { x: 11, y: 12.6, width: 2, height: 2.6, rx: 0.6, fill: 'var(--svn-icon-page)' }],
      ]),
      code: PAGE_SHAPES.concat([
        ['path', { d: 'M10.4 11.2 8 14l2.4 2.8M13.6 11.2 16 14l-2.4 2.8', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }],
      ]),
      markdown: PAGE_SHAPES.concat([
        ['path', { d: 'M7.6 17V11h1.5l1.7 2.4L12.5 11H14v6h-1.5v-3.4l-1.7 2.3-1.7-2.3V17H7.6Z', fill: 'currentColor' }],
        ['path', { d: 'M15.4 11h1.4v3.6h1.6L16.1 17.4 13.8 14.6h1.6V11Z', fill: 'currentColor', opacity: 0.7 }],
      ]),
      text: PAGE_SHAPES.concat([
        ['path', { d: 'M8.2 11.6h7.6v1.2H8.2zM8.2 14h7.6v1.2H8.2zM8.2 16.4h4.8v1.2H8.2z', fill: 'currentColor', opacity: 0.8 }],
      ]),
      json: PAGE_SHAPES.concat([
        ['path', { d: 'M10.1 11.3c-1 0-1.4.5-1.4 1.3v.7c0 .5-.2.8-.7.8.5 0 .7.3.7.8v.7c0 .8.4 1.3 1.4 1.3M13.9 11.3c1 0 1.4.5 1.4 1.3v.7c0 .5.2.8.7.8-.5 0-.7.3-.7.8v.7c0 .8-.4 1.3-1.4 1.3', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }],
      ]),
      video: PAGE_SHAPES.concat([
        ['path', { d: 'M10.4 11.4v5.2l4.4-2.6-4.4-2.6Z', fill: 'currentColor' }],
      ]),
      font: PAGE_SHAPES.concat([
        ['path', { d: 'M9.2 17 11.6 11h1.6l2.4 6h-1.5l-.4-1.1h-2.6L10.7 17H9.2Zm2-2.2h1.8l-.9-2.5-.9 2.5Z', fill: 'currentColor' }],
      ]),
      unknown: PAGE_SHAPES.concat([
        ['circle', { cx: 12, cy: 15.6, r: 1.1, fill: 'currentColor' }],
        ['path', { d: 'M12 10.4c1.2 0 2 .7 2 1.7 0 .8-.4 1.2-1 1.6-.4.3-.6.5-.6 1', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }],
      ]),
    }

    function shapeNode(shape, index) {
      return e(shape[0], { key: index, ...shape[1] })
    }

    function IconSprite() {
      return e('svg', { width: 0, height: 0, style: { position: 'absolute', width: 0, height: 0, overflow: 'hidden' }, 'aria-hidden': true },
        Object.entries(ICON_SHAPES).map(([id, shapes]) => e('symbol', {
          key: id, id: `svn-i-${id}`, viewBox: '0 0 24 24',
        }, shapes.map(shapeNode))))
    }

    function TypeIcon({ name, dir, size = 16, open }) {
      const info = dir ? { id: open ? 'folder-open' : 'folder', color: 'var(--svn-icon-folder)' } : iconOf(name)
      return e('svg', {
        className: 'svn-ico', width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true,
        style: { color: info.color },
      }, e('use', { href: `#svn-i-${info.id}` }))
    }

    function StatusDot({ status }) {
      if (!status) return e('span', { className: 'svn-dot' })
      return e('span', { className: 'svn-dot', style: { background: STATUS_COLOR[status] ?? 'var(--dsw-alias-label-secondary)' }, title: status })
    }

    function Caret({ open, leaf, onClick }) {
      return e('button', {
        className: `svn-caret${open ? ' open' : ''}${leaf ? ' leaf' : ''}`,
        type: 'button',
        tabIndex: -1,
        'aria-label': open ? '收起' : '展开',
        onClick: (event) => { event.stopPropagation(); if (!leaf) onClick() },
      },
      e('svg', { viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        e('path', { d: 'M9 6l6 6-6 6', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' })))
    }

    /* ------------------------------------------------------ preview views */

    const ASSET_BASE = '/dsh-svn/assets/'
    const scriptCache = new Map()

    function loadScript(src) {
      if (!scriptCache.has(src)) {
        scriptCache.set(src, new Promise((resolve, reject) => {
          const el = document.createElement('script')
          el.src = src
          el.async = true
          el.onload = () => resolve()
          el.onerror = () => reject(new Error(`load-failed: ${src}`))
          document.head.appendChild(el)
        }))
      }
      return scriptCache.get(src)
    }

    async function ensureDocxLibs() {
      if (!window.JSZip) await loadScript(`${ASSET_BASE}jszip.min.js`)
      if (!window.docx) await loadScript(`${ASSET_BASE}docx-preview.min.js`)
      if (!window.docx || typeof window.docx.renderAsync !== 'function') throw new Error('docx-preview-unavailable')
    }

    async function ensureXlsxLib() {
      if (!window.XLSX) await loadScript(`${ASSET_BASE}xlsx.core.min.js`)
      if (!window.XLSX) throw new Error('sheetjs-unavailable')
    }

    async function fetchBytes(url) {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`http-${response.status}`)
      return response.arrayBuffer()
    }

    function OfficeTextView({ file, reason, onCtl }) {
      const [state, setState] = useState({ loading: true, text: '', error: null })
      useEffect(() => {
        if (!onCtl) return undefined
        onCtl({
          status: { dot: null, text: ['正文提取', '仅文本，版式不保留'].join(' · ') },
          controls: null,
        })
        return () => onCtl(null)
      }, [onCtl])
      useEffect(() => {
        let cancelled = false
        ;(async () => {
          try {
            const url = `${file.fileUrl}&text=1`
            const payload = await (await fetch(url, { headers: { accept: 'application/json' } })).json()
            if (cancelled) return
            if (!payload.ok || !payload.content) throw new Error(payload.error ?? 'no-text')
            setState({ loading: false, text: String(payload.content), error: null })
          } catch (error) {
            if (!cancelled) setState({ loading: false, text: '', error: String(error?.message ?? error) })
          }
        })()
        return () => { cancelled = true }
      }, [file.fileUrl])
      if (state.loading) return e('div', { className: 'svn-fallback' }, e('span', { className: 'svn-tip' }, '正在提取正文…'))
      if (state.error) return e('div', { className: 'svn-fallback' }, e('div', { className: 'svn-note' }, `无法预览：${state.error}`))
      return e('div', null,
        e('div', { className: 'svn-split' }, `版式未还原，以下为正文提取${reason ? `（${reason}）` : ''}`),
        e('div', { className: 'svn-code' }, codeLines(state.text)))
    }

    const RAW_AUTO_BYTES = 100 * 1024 * 1024
    const DOCX_MAX_BYTES = 100 * 1024 * 1024
    const SHEET_MAX_BYTES = 100 * 1024 * 1024

    /* ------------------------------------------------------- preview cache */
    // L1: module-level LRU (survives panel switches). L2: IndexedDB blobs (survives reloads).
    const CACHE_L1_MAX_BYTES = 512 * 1024 * 1024
    const CACHE_L1_MAX_ITEMS = 8
    const CACHE_L2_MAX_BYTES = 512 * 1024 * 1024
    const CACHE_TTL_MS = 7 * 24 * 3600 * 1000
    // Loading overview card appears only at or above this size; smaller loads stay silent.
    const CACHE_GATE_BYTES = 1024 * 1024
    const l1Cache = new Map() // key -> { value, size, at }
    const l1Get = (key) => {
      const hit = l1Cache.get(key)
      if (!hit) return null
      if (Date.now() - hit.at > CACHE_TTL_MS) { l1Cache.delete(key); return null }
      l1Cache.delete(key)
      l1Cache.set(key, hit)
      return hit
    }
    const l1Put = (key, value, size) => {
      if (!size || size > CACHE_L1_MAX_BYTES) return
      l1Cache.set(key, { value, size, at: Date.now() })
      let total = 0
      for (const [oldKey, old] of l1Cache) {
        total += old.size
        if (total > CACHE_L1_MAX_BYTES || l1Cache.size > CACHE_L1_MAX_ITEMS) l1Cache.delete(oldKey)
      }
    }
    const l1Drop = (key) => { l1Cache.delete(key) }

    let idbPromise = null
    function idb() {
      if (idbPromise) return idbPromise
      idbPromise = new Promise((resolve) => {
        try {
          if (!window.indexedDB) { resolve(null); return }
          const req = window.indexedDB.open('dsh-svn-viewer', 1)
          req.onupgradeneeded = () => {
            const db = req.result
            if (!db.objectStoreNames.contains('bytes')) db.createObjectStore('bytes', { keyPath: 'key' })
          }
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => resolve(null)
          req.onblocked = () => resolve(null)
        } catch { resolve(null) }
      })
      return idbPromise
    }
    const idbRun = async (mode, fn) => {
      const db = await idb()
      if (!db) return null
      try {
        return await new Promise((resolve) => {
          const tx = db.transaction('bytes', mode)
          const out = fn(tx.objectStore('bytes'))
          tx.oncomplete = () => resolve(out?.result ?? out ?? true)
          tx.onabort = () => resolve(null)
          tx.onerror = () => resolve(null)
        })
      } catch { return null }
    }
    const l2Get = async (key) => {
      const row = await idbRun('readonly', (store) => store.get(key))
      if (!row || Date.now() - row.at > CACHE_TTL_MS) return null
      return row
    }
    const l2Put = async (key, blob, size) => {
      if (!size || size > CACHE_L2_MAX_BYTES) return
      await idbRun('readwrite', (store) => store.put({ key, blob, size, at: Date.now() }))
      // Prune oldest rows while over budget; quota errors also drop the oldest and retry once.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const rows = await idbRun('readonly', (store) => store.getAll())
        if (!Array.isArray(rows)) return
        let total = rows.reduce((sum, row) => sum + (row.size ?? 0), 0)
        if (total <= CACHE_L2_MAX_BYTES) return
        const sorted = rows.slice().sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
        for (const row of sorted) {
          if (total <= CACHE_L2_MAX_BYTES * 0.8) break
          await idbRun('readwrite', (store) => store.delete(row.key))
          total -= row.size ?? 0
        }
      }
    }
    const l2Drop = (key) => idbRun('readwrite', (store) => store.delete(key))

    const bytesCacheGet = async (key) => {
      const hit = l1Get(key)
      if (hit) return { from: 'mem', buffer: hit.value }
      const row = await l2Get(key)
      if (row?.blob) {
        try {
          const buffer = new Uint8Array(await row.blob.arrayBuffer())
          l1Put(key, buffer, buffer.length)
          return { from: 'idb', buffer }
        } catch { return null }
      }
      return null
    }
    const bytesCachePut = (key, buffer, meta) => {
      l1Put(key, buffer, buffer.length)
      try { l2Put(key, new Blob([buffer]), buffer.length).catch(() => {}) } catch { /* ignore */ }
      void meta
    }
    const payloadCacheGet = async (key) => {
      const hit = l1Get(`p:${key}`)
      if (hit) return { from: 'mem', value: hit.value }
      const row = await l2Get(`p:${key}`)
      if (row?.blob) {
        try {
          const value = JSON.parse(await row.blob.text())
          l1Put(`p:${key}`, value, row.size ?? 0)
          return { from: 'idb', value }
        } catch { return null }
      }
      return null
    }
    const payloadCachePut = (key, value) => {
      let text = ''
      try { text = JSON.stringify(value) } catch { return }
      if (!text || text.length > 2 * 1024 * 1024) return
      const size = text.length
      l1Put(`p:${key}`, value, size)
      try { l2Put(`p:${key}`, new Blob([text]), size).catch(() => {}) } catch { /* ignore */ }
    }
    const cacheDrop = (key) => { l1Drop(key); l1Drop(`p:${key}`); l2Drop(key); l2Drop(`p:${key}`) }

    /** Green "cached" chip + blue reload entry, shown in a view bar only on cache hit. */
    function CacheChip({ hit, onReload }) {
      if (!hit) return null
      return e(React.Fragment, null,
        e('span', { className: 'svn-chip ok', title: hit === 'mem' ? '预览内容来自内存缓存' : '预览内容来自本地磁盘缓存' }, '缓存'),
        e('button', { className: 'svn-btn act', onClick: onReload, title: '绕过缓存，强制从网络重新加载' }, '重新加载'))
    }

    const fmtCount = (value) => Number(value || 0).toLocaleString('zh-CN')

    const fmtRel = (at) => {
      const diff = Date.now() - Number(at || 0)
      const min = Math.floor(diff / 60000)
      if (min < 1) return '刚刚'
      if (min < 60) return `${min} 分钟前`
      const hr = Math.floor(min / 60)
      if (hr < 24) return `${hr} 小时前`
      return `${Math.floor(hr / 24)} 天前`
    }

    /** Real download: fetch bytes (stream route for huge files) then save via a[download].
     *  The host serves raw bytes with content-disposition:inline, so window.open would
     *  play/preview instead of saving — hence the blob round-trip. */
    function triggerFileDownload(file) {
      const url = (file.size ?? 0) > RAW_AUTO_BYTES ? file.streamUrl : file.rawUrl
      return fetch(url).then((response) => {
        if (!response.ok) throw new Error(`http-${response.status}`)
        return response.blob()
      }).then((blob) => {
        const obj = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = obj
        link.download = file.name || 'download'
        document.body.appendChild(link)
        link.click()
        link.remove()
        setTimeout(() => URL.revokeObjectURL(obj), 5000)
      })
    }

    /** Fetch whole-file bytes with progress, manual gating and retry; shared by docx/xlsx/pptx/video. */
    function useBytes(file, capBytes, startAuto = true) {
      const cacheKey = file.rawUrl ?? ''
      const [state, setState] = useState(() => ((file.size ?? 0) > capBytes
        ? { phase: 'manual', reason: 'oversize', error: null, buffer: null, received: 0, total: file.size ?? 0, rate: 0, fromCache: null }
        : startAuto
          ? { phase: 'loading', reason: null, error: null, buffer: null, received: 0, total: file.size ?? 0, rate: 0, fromCache: null }
          : { phase: 'idle', reason: null, error: null, buffer: null, received: 0, total: file.size ?? 0, rate: 0, fromCache: null }))
      const ctrlRef = useRef(null)
      const load = useCallback(async (options = {}) => {
        if (!options.skipCache && !file.skipCache) {
          const hit = await bytesCacheGet(cacheKey)
          if (hit) {
            setState((prev) => ({ ...prev, phase: 'ready', buffer: hit.buffer, received: hit.buffer.length, total: hit.buffer.length, rate: 0, fromCache: hit.from, error: null }))
            return
          }
        }
        cacheDrop(cacheKey)
        const controller = new AbortController()
        ctrlRef.current = controller
        const started = Date.now()
        let lastTick = 0
        setState((prev) => ({ ...prev, phase: 'loading', error: null, received: 0, rate: 0, fromCache: null }))
        try {
          const url = (file.size ?? 0) > RAW_AUTO_BYTES ? file.streamUrl : file.rawUrl
          const response = await fetch(url, { signal: controller.signal })
          if (!response.ok) throw new Error(`http-${response.status}`)
          const total = Number(response.headers?.get?.('content-length') ?? 0) || file.size || 0
          let buffer
          if (response.body && typeof response.body.getReader === 'function') {
            const reader = response.body.getReader()
            const chunks = []
            let received = 0
            for (;;) {
              const piece = await reader.read()
              if (piece.done) break
              chunks.push(piece.value)
              received += piece.value.length
              const now = Date.now()
              if (now - lastTick > 200) {
                lastTick = now
                const rate = received / Math.max(0.001, (now - started) / 1000)
                setState((prev) => ({ ...prev, received, total, rate }))
              }
            }
            buffer = new Uint8Array(received)
            let offset = 0
            for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length }
          } else {
            buffer = new Uint8Array(await response.arrayBuffer())
            setState((prev) => ({ ...prev, received: buffer.length, total: buffer.length }))
          }
          const rate = buffer.length / Math.max(0.001, (Date.now() - started) / 1000)
          bytesCachePut(cacheKey, buffer, { path: file.path, rev: file.rev })
          setState((prev) => ({ ...prev, phase: 'ready', buffer, received: buffer.length, total: buffer.length, rate, fromCache: null }))
        } catch (error) {
          if (error?.name === 'AbortError') setState((prev) => ({ ...prev, phase: 'manual', reason: 'cancelled', buffer: null, fromCache: null }))
          else setState((prev) => ({ ...prev, phase: 'failed', error: String(error?.message ?? error), buffer: null, fromCache: null }))
        }
      }, [file.rawUrl, file.streamUrl, file.size, file.skipCache, cacheKey])
      useEffect(() => {
        // Synchronous L1 probe avoids a card flash for already-cached bytes.
        if (!file.skipCache) {
          const hit = l1Get(cacheKey)
          if (hit) {
            setState((prev) => ({ ...prev, phase: 'ready', buffer: hit.value, received: hit.value.length, total: hit.value.length, rate: 0, fromCache: 'mem' }))
            return undefined
          }
        }
        if (state.phase === 'loading' && !ctrlRef.current) load()
        return () => { try { ctrlRef.current?.abort() } catch { /* ignore */ } }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [file.rawUrl])
      const cancel = useCallback(() => { try { ctrlRef.current?.abort() } catch { /* ignore */ } }, [])
      const reload = useCallback(() => { load({ skipCache: true }) }, [load])
      return { state, load, cancel, reload }
    }

    /** 读取进度上报：把字节流的实时状态交给文件头渲染，内容区只放骨架。 */
    function useViewProgress(onProgress, bytes) {
      useEffect(() => {
        if (!onProgress) return undefined
        onProgress({
          phase: bytes.state.phase,
          received: bytes.state.received,
          total: bytes.state.total,
          rate: bytes.state.rate,
          error: bytes.state.error,
          cancel: bytes.cancel,
          retry: bytes.load,
          reload: bytes.reload,
        })
        return () => onProgress(null)
      }, [onProgress, bytes.state.phase, bytes.state.received, bytes.state.total, bytes.state.error, bytes.cancel, bytes.load, bytes.reload])
    }

    /** 读取中的骨架 / 超大文件的手动门槛 / 失败重试，都不再占满整页。 */
    function LoadState({ file, state, capBytes, onLoad, onCancel, indeterminate, note, reason }) {
      const download = file.rawUrl
        ? e('button', {
          className: 'svn-btn',
          onClick: () => { triggerFileDownload(file).catch(() => { try { window.open(file.rawUrl, '_blank') } catch { /* ignore */ } }) },
        }, '下载')
        : null
      if (state.phase === 'failed' || state.phase === 'manual') {
        const text = reason
          ?? (state.phase === 'failed'
            ? `读取失败（${state.error ?? '未知错误'}）`
            : state.reason === 'cancelled'
              ? '上次读取已取消'
              : `超过自动加载门槛（${fmtSize(capBytes)}），需要手动确认后读取`)
        return e('div', { className: 'svn-gate' },
          e('div', { className: 'box' },
            e('div', { className: 'row1' },
              e(TypeIcon, { name: file.name, size: 18 }),
              e('b', null, file.name),
              e('span', { className: 'svn-note' }, fmtSize(file.size))),
            e('div', { className: 'reason' }, text),
            e('div', { className: 'acts' },
              download,
              state.phase === 'failed'
                ? e('button', { className: 'svn-btn danger', onClick: onLoad }, '重试')
                : e('button', { className: 'svn-btn primary', onClick: onLoad }, '加载并预览'))))
      }
      const pct = state.total ? Math.min(100, Math.round((state.received / state.total) * 100)) : 0
      return e('div', { className: 'svn-skel' },
        e('div', { className: 'box' },
          e('div', { className: 'lines' }, e('i'), e('i'), e('i'), e('i')),
          e('div', { className: 't1' }, indeterminate
            ? (note ?? '主机读取中…')
            : state.total
              ? `正在读取 ${fmtSize(state.received)} / ${fmtSize(state.total)} · ${pct}%`
              : `已收 ${fmtSize(state.received)}`),
          e('div', { className: 'bar' }, e('i', { style: { width: `${state.total ? Math.max(3, pct) : 34}%` } })),
          e('div', { className: 't2' }, indeterminate ? '文本提取与编码在服务端完成，返回后立即渲染。' : '读取完成后自动渲染版式；进度与取消在文件头。'),
          onCancel ? e('div', { className: 'acts' }, e('button', { className: 'svn-btn', onClick: onCancel }, '取消')) : null))
    }

    const loadRootStyle = { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }

    function DocxView({ file, onCtl, onProgress }) {
      const hostRef = useRef(null)
      const bytes = useBytes(file, DOCX_MAX_BYTES)
      const [state, setState] = useState({ phase: 'loading', error: null })
      useViewProgress(onProgress, bytes)
      useEffect(() => {
        if (!onCtl) return undefined
        onCtl({
          status: {
            dot: bytes.state.fromCache ? 'ok' : null,
            text: ['Word 版式', bytes.state.fromCache ? '缓存命中' : null].filter(Boolean).join(' · '),
          },
          controls: null,
        })
        return () => onCtl(null)
      }, [onCtl, bytes.state.fromCache])
      useEffect(() => {
        if (bytes.state.phase !== 'ready' || !bytes.state.buffer) return undefined
        let cancelled = false
        ;(async () => {
          try {
            const buffer = bytes.state.buffer
            await ensureDocxLibs()
            if (cancelled || !hostRef.current) return
            hostRef.current.innerHTML = ''
            await window.docx.renderAsync(buffer, hostRef.current, null, {
              inWrapper: true, breakPages: true, ignoreWidth: false, ignoreHeight: false,
              renderHeaders: true, renderFooters: true, experiments: true,
            })
            const avail = (hostRef.current.clientWidth || 0) - 8
            for (const section of hostRef.current.querySelectorAll('section.docx')) {
              const width = section.offsetWidth || 0
              if (avail > 200 && width > avail) section.style.zoom = String(Math.max(0.5, avail / width))
            }
            if (!cancelled) setState({ phase: 'ready', error: null })
          } catch (error) {
            if (!cancelled) setState({ phase: 'error', error: String(error?.message ?? error) })
          }
        })()
        return () => { cancelled = true }
      }, [bytes.state.phase, bytes.state.buffer])
      if (state.phase === 'error') return e(OfficeTextView, { file, onCtl, reason: '渲染失败' })
      if (bytes.state.phase !== 'ready') {
        return e(LoadState, { file, state: bytes.state, capBytes: DOCX_MAX_BYTES, onLoad: bytes.load, onCancel: bytes.cancel })
      }
      return e('div', { className: 'svn-viewbody', style: { overflow: 'auto' } },
        e('div', { className: 'svn-docx', ref: hostRef }))
    }

    function sheetRows(sheet) {
      const data = window.XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, raw: false })
      const width = data.reduce((max, row) => Math.max(max, row.length), 0)
      return { data, width }
    }

    const CJK = /[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7ff\u3000-\u303f\uff00-\uffef]/
    const colLetter = (index) => {
      let name = ''
      let n = index
      do { name = String.fromCharCode(65 + (n % 26)) + name; n = Math.floor(n / 26) - 1 } while (n >= 0)
      return name
    }
    const unitLength = (text) => {
      let total = 0
      for (const ch of String(text ?? '')) total += CJK.test(ch) ? 2 : 1
      return total
    }

    /**
     * 工作表 → 可渲染矩阵。还原 !merges 的 rowspan/colspan，识别“跨列标题行”，
     * 用纵向合并的层数推断表头行数，并按内容算列宽上限。
     * 拍平模式（flat）仍然走 sheet_to_json，作为逃生口。
     */
    function buildSheetModel(sheet, XLSXLib) {
      const ref = sheet['!ref']
      if (!ref || !XLSXLib) return null
      const range = XLSXLib.utils.decode_range(ref)
      const rowTotal = range.e.r - range.s.r + 1
      const colTotal = range.e.c - range.s.c + 1
      if (rowTotal < 1 || colTotal < 1) return null
      const valueAt = (r, c) => {
        const cell = sheet[XLSXLib.utils.encode_cell({ r, c })]
        if (!cell) return ''
        const text = cell.w ?? cell.v
        return text === undefined || text === null ? '' : String(text)
      }
      const raw = []
      for (let r = 0; r < rowTotal; r += 1) {
        const line = []
        for (let c = 0; c < colTotal; c += 1) line.push(valueAt(range.s.r + r, range.s.c + c))
        raw.push(line)
      }
      const colHasValue = (c) => raw.some((line) => String(line[c] ?? '').trim() !== '')
      let firstCol = 0
      let lastCol = colTotal - 1
      while (firstCol < lastCol && !colHasValue(firstCol)) firstCol += 1
      while (lastCol > firstCol && !colHasValue(lastCol)) lastCol -= 1
      const cells = raw.map((line) => line.slice(firstCol, lastCol + 1))
      const colCount = lastCol - firstCol + 1
      const firstLine = cells[0] ?? []
      const filled = firstLine.filter((cell) => String(cell).trim() !== '').length
      const titleSpan = (sheet['!merges'] ?? []).some((m) => m.s.r === range.s.r && m.e.c > m.s.c)
      const titleText = firstLine.find((cell) => String(cell).trim() !== '') ?? ''
      const title = filled === 1 && (titleSpan || String(titleText).length >= 8) ? String(titleText) : null
      const headerStart = title ? 1 : 0
      let headerRows = 1
      for (const m of sheet['!merges'] ?? []) {
        if (m.s.r !== range.s.r + headerStart) continue
        headerRows = Math.max(headerRows, m.e.r - m.s.r + 1)
      }
      headerRows = Math.max(1, Math.min(headerRows, cells.length - headerStart - 1 || 1))
      const merges = (sheet['!merges'] ?? [])
        .map((m) => ({
          r1: m.s.r - range.s.r,
          c1: m.s.c - range.s.c - firstCol,
          r2: m.e.r - range.s.r,
          c2: m.e.c - range.s.c - firstCol,
        }))
        .filter((m) => m.r2 >= 0 && m.r1 < cells.length && m.c2 >= 0 && m.c1 < colCount)
        .map((m) => ({
          r1: Math.max(0, m.r1), c1: Math.max(0, m.c1),
          r2: Math.min(cells.length - 1, m.r2), c2: Math.min(colCount - 1, m.c2),
        }))
      const covered = new Set()
      for (const m of merges) {
        for (let r = m.r1; r <= m.r2; r += 1) {
          for (let c = m.c1; c <= m.c2; c += 1) if (r !== m.r1 || c !== m.c1) covered.add(`${r}:${c}`)
        }
      }
      const spanOf = (r, c) => {
        const m = merges.find((item) => item.r1 === r && item.c1 === c)
        return m ? { rowSpan: m.r2 - r + 1, colSpan: m.c2 - c + 1 } : { rowSpan: 1, colSpan: 1 }
      }
      const widths = Array.from({ length: colCount }, (unused, c) => {
        let max = 4
        for (let r = 0; r < cells.length; r += 1) max = Math.max(max, unitLength(cells[r][c]))
        return Math.round(Math.max(74, Math.min(300, 30 + max * 6.2)))
      })
      return {
        title, headerStart, headerRows, cells, colCount, rowStart: range.s.r, colStart: range.s.c + firstCol,
        covered, spanOf, widths, merges,
      }
    }

    function TableView({ file, onCtl, onProgress }) {
      const bytes = useBytes(file, SHEET_MAX_BYTES)
      const [state, setState] = useState({ phase: 'loading', error: null, book: null, active: 0, limit: 300 })
      const [wrap, setWrap] = useState(true)
      const [flat, setFlat] = useState(false)
      const [pop, setPop] = useState(null)
      const gridRef = useRef(null)
      useViewProgress(onProgress, bytes)
      useEffect(() => { setFlat(false); setPop(null) }, [file.rawUrl])
      useEffect(() => {
        if (!pop) return undefined
        const close = () => setPop(null)
        window.addEventListener('mousedown', close)
        window.addEventListener('keydown', close)
        return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close) }
      }, [pop])
      useEffect(() => {
        if (bytes.state.phase !== 'ready' || !bytes.state.buffer) return undefined
        let cancelled = false
        ;(async () => {
          try {
            const buffer = bytes.state.buffer
            await ensureXlsxLib()
            if (cancelled) return
            const book = window.XLSX.read(buffer, { type: 'array' })
            setState({ phase: 'ready', error: null, book, active: 0, limit: 400 })
          } catch (error) {
            if (!cancelled) setState({ phase: 'error', error: String(error?.message ?? error), book: null, active: 0, limit: 300 })
          }
        })()
        return () => { cancelled = true }
      }, [bytes.state.phase, bytes.state.buffer])
      const sheet = state.book ? state.book.Sheets[state.book.SheetNames[state.active]] : null
      const model = useMemo(
        () => (state.phase === 'ready' && sheet ? buildSheetModel(sheet, window.XLSX) : null),
        [state.phase, sheet],
      )
      const flatData = useMemo(
        () => (flat && state.phase === 'ready' && sheet ? sheetRows(sheet) : null),
        [flat, state.phase, sheet],
      )
      const rowCount = model ? model.cells.length : 0
      const colCount = model ? model.colCount : 0
      useEffect(() => {
        if (!onCtl) return undefined
        const parts = []
        if (rowCount) parts.push(`${rowCount} 行 × ${colCount} 列`)
        if (model && model.merges.length) parts.push(`合并 ${model.merges.length} 处${flat ? '（已拍平）' : ''}`)
        if (bytes.state.fromCache) parts.push('缓存命中')
        onCtl({
          status: { dot: bytes.state.fromCache ? 'ok' : model ? 'ok' : null, text: parts.join(' · ') || '表格' },
          controls: e(React.Fragment, null,
            e('button', {
              type: 'button', className: `svn-vbtn${wrap ? ' on' : ''}`, 'aria-pressed': wrap,
              title: '单元格长文本换行显示', onClick: () => setWrap((prev) => !prev),
            }, '换行'),
            e('button', {
              type: 'button', className: `svn-vbtn${flat ? ' on' : ''}`, 'aria-pressed': flat,
              title: '按原表拍平：不还原合并单元格', onClick: () => setFlat((prev) => !prev),
            }, '拍平')),
        })
        return () => onCtl(null)
      }, [onCtl, wrap, flat, rowCount, colCount, model, bytes.state.fromCache])

      if (state.phase === 'error') return e(OfficeTextView, { file, onCtl, reason: '表格解析失败' })
      if (bytes.state.phase !== 'ready') {
        return e(LoadState, { file, state: bytes.state, capBytes: SHEET_MAX_BYTES, onLoad: bytes.load, onCancel: bytes.cancel })
      }
      if (!model) return e('div', { className: 'svn-fallback' }, e('span', { className: 'svn-tip' }, '正在解析表格…'))
      const names = state.book.SheetNames
      const headerEnd = model.headerStart + model.headerRows
      const limit = Math.max(state.limit, headerEnd + 1)
      const bodyEnd = Math.min(model.cells.length, limit)
      const cellNode = (r, c, tag) => {
        const span = model.spanOf(r, c)
        const text = model.cells[r]?.[c] ?? ''
        const spans = span.rowSpan > 1 || span.colSpan > 1
        const isNote = span.colSpan >= Math.max(3, colCount - 1) && /\n/.test(text)
        const props = {
          key: `${r}:${c}`,
          rowSpan: span.rowSpan > 1 ? span.rowSpan : undefined,
          colSpan: span.colSpan > 1 ? span.colSpan : undefined,
          className: isNote ? 'note' : spans ? 'grp' : undefined,
          title: text || undefined,
        }
        if (tag === 'td' && text && !isNote) {
          props.onClick = (event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            setPop({
              addr: `${colLetter(model.colStart + c)}${model.rowStart + r + 1}`,
              text,
              x: Math.min(window.innerWidth - 300, Math.max(12, rect.left)),
              y: rect.bottom + 8,
            })
          }
        }
        return e(tag, props, tag === 'th' ? text : e('div', { className: 'svn-cl2' }, text))
      }
      const headerRows = []
      for (let r = model.headerStart; r < headerEnd; r += 1) {
        const cells = []
        if (r === model.headerStart) cells.push(e('th', { key: 'rn', className: 'rn', rowSpan: model.headerRows }))
        for (let c = 0; c < colCount; c += 1) {
          if (model.covered.has(`${r}:${c}`)) continue
          cells.push(cellNode(r, c, 'th'))
        }
        headerRows.push(e('tr', { key: `h${r}` }, cells))
      }
      const bodyRows = []
      for (let r = headerEnd; r < bodyEnd; r += 1) {
        const cells = [e('th', { key: 'rn', className: 'rn' }, String(model.rowStart + r + 1))]
        for (let c = 0; c < colCount; c += 1) {
          if (model.covered.has(`${r}:${c}`)) continue
          cells.push(cellNode(r, c, 'td'))
        }
        bodyRows.push(e('tr', { key: `r${r}` }, cells))
      }
      const totalWidth = model.widths.reduce((sum, width) => sum + width, 0) + 46
      return e('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 } },
        e('div', { className: 'svn-sheetbar' },
          names.map((name, index) => e('button', {
            key: name, type: 'button',
            className: `svn-sheet${index === state.active ? ' on' : ''}`,
            title: name,
            onClick: () => setState((prev) => ({ ...prev, active: index, limit: 400 })),
          }, name))),
        e('div', {
          className: `svn-gridwrap${wrap ? '' : ' nowrap'}`,
          ref: gridRef,
        },
        model.title ? e('div', { className: 'svn-sheettitle' }, model.title) : null,
        flat && flatData
          ? e('div', { className: 'svn-viewbody', style: { overflow: 'auto' } },
            e('table', { className: 'svn-grid' },
              e('tbody', null, flatData.data.slice(0, limit).map((line, rowIndex) => e('tr', { key: rowIndex },
                e('td', { className: 'rownum' }, String(rowIndex + 1)),
                Array.from({ length: flatData.width }, (unused, colIndex) => e('td', { key: colIndex }, line[colIndex] === undefined ? '' : String(line[colIndex]))))))))
          : e('table', { className: 'svn-grid2', style: { minWidth: `${totalWidth}px` } },
            e('colgroup', null,
              e('col', { key: 'rn', style: { width: '46px' } }),
              model.widths.map((width, index) => e('col', { key: index, style: { width: `${width}px` } }))),
            e('thead', null, headerRows),
            e('tbody', null, bodyRows)),
        model.cells.length > bodyEnd
          ? e('div', { className: 'svn-more' }, e('button', {
            className: 'svn-btn act',
            onClick: () => setState((prev) => ({ ...prev, limit: prev.limit + 400 })),
          }, `加载更多（剩余 ${model.cells.length - bodyEnd} 行）`))
          : null),
        pop ? e('div', {
          className: 'svn-pop',
          style: { left: pop.x, top: pop.y },
          onMouseDown: (event) => event.stopPropagation(),
        },
        e('div', { className: 'ph' }, e('b', null, `单元格 ${pop.addr}`)),
        e('div', { className: 'pv' }, pop.text)) : null)
    }

    const PDF_MAX_BYTES = 100 * 1024 * 1024
    const IMAGE_MAX_BYTES = 100 * 1024 * 1024

    function PdfView({ file, onCtl, onProgress }) {
      const big = (file.size ?? 0) >= CACHE_GATE_BYTES
      const bytes = useBytes(file, PDF_MAX_BYTES, big)
      const [blobUrl, setBlobUrl] = useState('')
      useViewProgress(onProgress, bytes)
      useEffect(() => {
        if (!big || bytes.state.phase !== 'ready' || !bytes.state.buffer) return undefined
        const url = URL.createObjectURL(new Blob([bytes.state.buffer], { type: 'application/pdf' }))
        setBlobUrl(url)
        return () => URL.revokeObjectURL(url)
      }, [big, bytes.state.phase, bytes.state.buffer])
      const base = big ? blobUrl : file.rawUrl
      const src = `${base}#toolbar=1&navpanes=0&statusbar=0&view=FitH`
      useEffect(() => {
        if (!onCtl) return undefined
        onCtl({
          status: {
            dot: bytes.state.fromCache ? 'ok' : null,
            text: ['PDF · 浏览器内置阅读器', bytes.state.fromCache ? '缓存命中' : null].filter(Boolean).join(' · '),
          },
          controls: e('button', {
            type: 'button', className: 'svn-vbtn',
            onClick: () => window.open(base || file.rawUrl, '_blank'),
          }, '新标签打开'),
        })
        return () => onCtl(null)
      }, [onCtl, base, bytes.state.fromCache, file.rawUrl])
      if (big && bytes.state.phase !== 'ready') {
        return e(LoadState, { file, state: bytes.state, capBytes: PDF_MAX_BYTES, onLoad: bytes.load, onCancel: bytes.cancel })
      }
      return base ? e('iframe', { className: 'svn-frame', src, title: file.name, style: { flex: 1 } }) : null
    }
    function ImageView({ file, onCtl, onProgress }) {
      const [zoom, setZoom] = useState(1)
      const [offset, setOffset] = useState({ x: 0, y: 0 })
      const drag = useRef(null)
      const wrapRef = useRef(null)
      const fitRef = useRef(1)
      useEffect(() => {
        setZoom(1)
        setOffset({ x: 0, y: 0 })
        fitRef.current = 1
      }, [file.rawUrl])
      // Fit the picture into the pane once its natural size and the pane box are known.
      const computeFit = (apply) => {
        const wrap = wrapRef.current
        const img = wrap ? wrap.querySelector('img') : null
        if (!wrap || !img || !img.naturalWidth || !img.naturalHeight) return
        const rect = wrap.getBoundingClientRect()
        if (!rect.width || !rect.height) return
        const value = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight, 1)
        fitRef.current = value
        if (apply) setZoom(value)
      }
      useEffect(() => {
        const wrap = wrapRef.current
        if (!wrap || typeof ResizeObserver !== 'function') return undefined
        const observer = new ResizeObserver(() => computeFit(true))
        observer.observe(wrap)
        return () => observer.disconnect()
      }, [])
      const [bgChoice, setBgChoice] = useState(() => { try { return localStorage.getItem(STORAGE_IMG_BG) || 'auto' } catch { return 'auto' } })
      const [autoDark, setAutoDark] = useState(false)
      const bg = bgChoice !== 'auto' ? bgChoice : (autoDark ? 'dark' : 'checker')
      const pickBg = useCallback((key) => {
        setBgChoice(key)
        try { localStorage.setItem(STORAGE_IMG_BG, key) } catch { /* ignore */ }
      }, [])
      const sampleLuma = (img) => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = 64
          canvas.height = 64
          const g = canvas.getContext('2d')
          g.drawImage(img, 0, 0, 64, 64)
          const data = g.getImageData(0, 0, 64, 64).data
          let opaque = 0
          let sum = 0
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 8) continue
            opaque += 1
            sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
          }
          return opaque ? sum / opaque : null
        } catch { return null }
      }
      const clampZoom = (value) => Math.min(8, Math.max(0.05, value))
      const onWheel = (event) => {
        event.preventDefault()
        setZoom((prev) => clampZoom(prev * (event.deltaY > 0 ? 0.9 : 1.1)))
      }
      const onDown = (event) => {
        drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }
        event.currentTarget.classList.add('drag')
      }
      const onMove = (event) => {
        if (!drag.current) return
        setOffset({ x: drag.current.ox + (event.clientX - drag.current.x), y: drag.current.oy + (event.clientY - drag.current.y) })
      }
      const onUp = (event) => {
        drag.current = null
        event.currentTarget.classList.remove('drag')
      }
      const reset = useCallback(() => { setZoom(fitRef.current); setOffset({ x: 0, y: 0 }) }, [])
      const big = (file.size ?? 0) >= CACHE_GATE_BYTES
      const bytes = useBytes(file, IMAGE_MAX_BYTES, big)
      const [blobUrl, setBlobUrl] = useState('')
      useViewProgress(onProgress, bytes)
      useEffect(() => {
        if (!big || bytes.state.phase !== 'ready' || !bytes.state.buffer) return undefined
        const url = URL.createObjectURL(new Blob([bytes.state.buffer], { type: 'image/png' }))
        setBlobUrl(url)
        return () => URL.revokeObjectURL(url)
      }, [big, bytes.state.phase, bytes.state.buffer])
      useEffect(() => {
        if (!onCtl) return undefined
        onCtl({
          status: {
            dot: bytes.state.fromCache ? 'ok' : null,
            text: [`${Math.round(zoom * 100)}%`, bytes.state.fromCache ? '缓存命中' : null].filter(Boolean).join(' · '),
          },
          controls: e(React.Fragment, null,
            e('button', { type: 'button', className: 'svn-vico', title: '缩小', onClick: () => setZoom((prev) => clampZoom(prev * 0.8)) }, '−'),
            e('span', { style: { minWidth: '38px', textAlign: 'center', fontFamily: 'var(--svn-mono)', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } }, `${Math.round(zoom * 100)}%`),
            e('button', { type: 'button', className: 'svn-vico', title: '放大', onClick: () => setZoom((prev) => clampZoom(prev * 1.25)) }, '+'),
            e('button', { type: 'button', className: 'svn-vbtn', title: '滚轮缩放 · 拖拽平移 · 双击复位', onClick: reset }, '复位'),
            e('select', {
              className: 'svn-vsel', value: bgChoice, title: '预览底色：白底透明图建议切黑/深灰',
              onChange: (event) => pickBg(event.target.value),
            }, [['auto', '自动'], ['checker', '棋盘'], ['white', '白'], ['black', '黑'], ['dark', '深灰']].map(([key, label]) => e('option', { key, value: key }, label)))),
        })
        return () => onCtl(null)
      }, [onCtl, zoom, bgChoice, bytes.state.fromCache, reset, pickBg])
      if (big && bytes.state.phase !== 'ready') {
        return e(LoadState, { file, state: bytes.state, capBytes: IMAGE_MAX_BYTES, onLoad: bytes.load, onCancel: bytes.cancel })
      }
      const imgSrc = big ? blobUrl : file.rawUrl
      return e('div', {
        className: `svn-imgview bg-${bg}`,
        ref: wrapRef,
        onWheel,
        onMouseDown: onDown,
        onMouseMove: onMove,
        onMouseUp: onUp,
        onMouseLeave: onUp,
        onDoubleClick: reset,
      },
      imgSrc ? e('img', {
        src: imgSrc, alt: file.name, draggable: false,
        onLoad: (event) => {
          computeFit(true)
          const luma = sampleLuma(event.currentTarget)
          setAutoDark(luma !== null && luma > 200)
        },
        style: { transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${zoom})` },
      }) : null)
    }

    const VIDEO_MAX_BYTES = 100 * 1024 * 1024

    function VideoView({ file, onCtl, onProgress }) {
      const [failed, setFailed] = useState(false)
      const [buffered, setBuffered] = useState(0)
      const bytes = useBytes(file, VIDEO_MAX_BYTES, false)
      useViewProgress(onProgress, bytes)
      const [blobUrl, setBlobUrl] = useState('')
      const ext = String(file.name).split('.').pop()?.toLowerCase() ?? ''
      const overCap = (file.size ?? 0) > VIDEO_MAX_BYTES
      useEffect(() => { setFailed(false); setBuffered(0) }, [file.rawUrl])
      useEffect(() => {
        if (bytes.state.phase !== 'ready' || !bytes.state.buffer) return undefined
        const url = URL.createObjectURL(new Blob([bytes.state.buffer], { type: 'video/mp4' }))
        setBlobUrl(url)
        return () => URL.revokeObjectURL(url)
      }, [bytes.state.phase, bytes.state.buffer])
      useEffect(() => {
        if (!onCtl) return undefined
        onCtl({
          status: {
            dot: bytes.state.fromCache ? 'ok' : null,
            text: [`视频${ext ? ` · ${ext}` : ''}`, !overCap ? `缓冲 ${buffered}%` : null, bytes.state.fromCache ? '缓存命中' : null].filter(Boolean).join(' · '),
          },
          controls: e('button', { type: 'button', className: 'svn-vbtn', onClick: () => window.open(file.rawUrl, '_blank') }, '新标签打开'),
        })
        return () => onCtl(null)
      }, [onCtl, buffered, overCap, ext, bytes.state.fromCache, file.rawUrl])
      if (overCap && bytes.state.phase !== 'ready') {
        return e(LoadState, { file, state: bytes.state, capBytes: VIDEO_MAX_BYTES, onLoad: bytes.load, onCancel: bytes.cancel })
      }
      if (failed) {
        return e('div', { className: 'svn-empty' },
          e('div', null, '该视频编码不受当前浏览器支持'),
          e('div', { className: 'svn-note' }, '常见于 HEVC/H.265、老 WMV/AVI；请下载后用本地播放器观看'))
      }
      const src = overCap ? blobUrl : file.rawUrl
      return e('div', { className: 'svn-video' },
        e('video', {
          key: src || file.rawUrl,
          controls: true,
          preload: 'metadata',
          src,
          onError: () => setFailed(true),
          onProgress: (event) => {
            const el = event.currentTarget
            const dur = el.duration
            if (!dur || !Number.isFinite(dur)) return
            let end = 0
            for (let i = 0; i < el.buffered.length; i += 1) end = Math.max(end, el.buffered.end(i))
            setBuffered(Math.min(100, Math.round((end / dur) * 100)))
          },
        }, '您的浏览器不支持内嵌视频播放'),
      )
    }
    function SlidesView({ file, reason }) {
      const raw = String(file.content ?? '')
      const parts = raw.split(/^--- 第 \d+ 页 ---$/m).map((part) => part.trim()).filter(Boolean)
      return e('div', null,
        e('div', { className: 'svn-split' }, `共 ${parts.length} 页 · 仅文本，版式未还原${reason ? `（${reason}）` : ''}`),
        e('div', { className: 'svn-slides' }, parts.map((part, index) => e('div', { className: 'svn-slide', key: index },
          e('div', { className: 'no' }, `第 ${index + 1} 页`),
          e('div', { className: 'body' }, part)))))
    }

    const PPTX_MAX_BYTES = 80 * 1024 * 1024

    function PptxView({ file, onCtl, onProgress }) {
      const hostRef = useRef(null)
      const bodyRef = useRef(null)
      const bytes = useBytes(file, PPTX_MAX_BYTES)
      const [state, setState] = useState({ phase: 'loading', error: null, slides: 0 })
      const [page, setPage] = useState(1)
      const [outline, setOutline] = useState(false)
      useViewProgress(onProgress, bytes)
      useEffect(() => { setPage(1); setOutline(false) }, [file.rawUrl])
      // 尺寸按“宽高都装得下”算：单页铺满面板，多页每屏一页，不再留大片空白
      const fitRef = useRef(0)
      const pageRef = useRef(1)
      const slidesRef = useRef(0)
      pageRef.current = page
      slidesRef.current = state.slides
      const measureWidth = () => {
        const box = bodyRef.current
        const availW = Math.max(320, (box?.clientWidth || 960) - 28)
        const availH = Math.max(240, (box?.clientHeight || 640) - 28)
        return Math.round(Math.max(560, Math.min(1280, Math.min(availW, (availH * 16) / 9))))
      }
      const renderPpt = useCallback(async (buffer) => {
        if (!hostRef.current || !window.pptxPreview) return
        // 等一帧：标签行、看板、目录树宽度都落定后再量尺寸
        await new Promise((resolve) => {
          if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(() => resolve())
          else setTimeout(resolve, 16)
        })
        if (!hostRef.current) return
        const width = measureWidth()
        fitRef.current = width
        hostRef.current.innerHTML = ''
        const app = window.pptxPreview.init(hostRef.current, { width, height: Math.round((width * 9) / 16), mode: 'preview' })
        await app.preview(buffer)
      }, [])
      useEffect(() => {
        if (bytes.state.phase !== 'ready' || !bytes.state.buffer) return undefined
        let cancelled = false
        const timer = setTimeout(() => {
          if (!cancelled) setState((prev) => (prev.phase === 'loading' ? { phase: 'fallback', error: '渲染超时（15 s）', slides: 0 } : prev))
        }, 15000)
        ;(async () => {
          try {
            const buffer = bytes.state.buffer
            if (!window.pptxPreview) await loadScript(`${ASSET_BASE}pptx-preview.umd.js`)
            if (!window.pptxPreview || typeof window.pptxPreview.init !== 'function') throw new Error('pptx-preview-unavailable')
            if (cancelled) return
            await renderPpt(buffer)
            if (cancelled || !hostRef.current) return
            const slides = hostRef.current.children.length || hostRef.current.querySelectorAll('[class*="slide"]').length
            setState((prev) => (prev.phase === 'loading' ? { phase: 'ready', error: null, slides } : prev))
            scrollToPage(pageRef.current, 'auto')
          } catch (error) {
            if (!cancelled) setState((prev) => (prev.phase === 'loading' ? { phase: 'fallback', error: String(error?.message ?? error), slides: 0 } : prev))
          } finally {
            clearTimeout(timer)
          }
        })()
        return () => { cancelled = true; clearTimeout(timer) }
      }, [bytes.state.phase, bytes.state.buffer, renderPpt])
      // 面板/树宽变化后重新按新尺寸渲染（去抖，只在差距 >5% 时重排）
      useEffect(() => {
        if (state.phase !== 'ready' || typeof ResizeObserver !== 'function') return undefined
        const box = bodyRef.current
        if (!box) return undefined
        let timer = null
        const observer = new ResizeObserver(() => {
          clearTimeout(timer)
          timer = setTimeout(() => {
            const buffer = bytes.state.buffer
            if (!buffer) return
            const next = measureWidth()
            if (!fitRef.current || Math.abs(next - fitRef.current) / fitRef.current < 0.05) return
            renderPpt(buffer)
              .then(() => scrollToPage(pageRef.current, 'auto'))
              .catch(() => {})
          }, 420)
        })
        observer.observe(box)
        return () => { clearTimeout(timer); observer.disconnect() }
      }, [state.phase, bytes.state.buffer, renderPpt])
      const ready = state.phase === 'ready'
      const total = state.slides || 0
      const scrollToPage = (index, behavior = 'smooth') => {
        const host = hostRef.current
        const scroller = bodyRef.current
        const target = Math.min(Math.max(1, index), Math.max(1, slidesRef.current || 1))
        const slide = host && host.children[target - 1]
        if (!host || !scroller || !slide) return
        const box = scroller.getBoundingClientRect()
        const rect = slide.getBoundingClientRect()
        scroller.scrollTo({ top: scroller.scrollTop + (rect.top - box.top), behavior })
      }
      const go = (next) => {
        const target = Math.min(Math.max(1, next), Math.max(1, total))
        setPage(target)
        scrollToPage(target)
      }
      useEffect(() => {
        if (!onCtl) return undefined
        onCtl({
          status: {
            dot: bytes.state.fromCache ? 'ok' : null,
            text: ['PPT 版式', ready ? `共 ${total} 页` : null, bytes.state.fromCache ? '缓存命中' : null].filter(Boolean).join(' · '),
          },
          controls: e(React.Fragment, null,
            ready ? e('div', { className: 'svn-pg' },
              e('button', { type: 'button', title: '上一页', disabled: page <= 1, onClick: () => go(page - 1) }, '‹'),
              e('span', null, `${page} / ${total || 1}`),
              e('button', { type: 'button', title: '下一页', disabled: page >= total, onClick: () => go(page + 1) }, '›')) : null,
            e('button', {
              type: 'button', className: `svn-vbtn${outline ? ' on' : ''}`, 'aria-pressed': outline,
              title: '只看文字，不还原版式', onClick: () => setOutline((prev) => !prev),
            }, '文字大纲')),
        })
        return () => onCtl(null)
      }, [onCtl, ready, total, page, outline, bytes.state.fromCache])
      if (bytes.state.phase !== 'ready') {
        return e(LoadState, { file, state: bytes.state, capBytes: PPTX_MAX_BYTES, onLoad: bytes.load, onCancel: bytes.cancel })
      }
      const showOutline = outline || state.phase === 'fallback'
      return e('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 } },
        e('div', {
          ref: bodyRef,
          className: 'svn-viewbody',
          style: {
            overflow: 'auto',
            background: 'var(--dsw-alias-bg-layer-2)',
            display: showOutline ? 'none' : 'flex',
            justifyContent: ready && total === 1 ? 'center' : 'flex-start',
          },
        },
        state.phase === 'loading' ? e('div', { className: 'svn-fallback' }, e('span', { className: 'svn-tip' }, '正在渲染幻灯片…')) : null,
        e('div', { className: 'svn-pptx', ref: hostRef })),
        showOutline
          ? e('div', { className: 'svn-viewbody', style: { overflow: 'auto' } },
            e(SlidesView, { file, reason: state.phase === 'fallback' ? state.error : '文字大纲' }))
          : null)
    }
    function codeLines(text, from = 1) {
      const lines = String(text ?? '').split('\n')
      return lines.map((line, index) => e('div', { className: 'svn-ln', key: from + index },
        e('span', { className: 'g' }, String(from + index)),
        e('span', null, line === '' ? ' ' : line),
      ))
    }

    const TAB_TITLES = {
      content: '文件内容预览',
      history: '提交历史',
      blame: '逐行归属（blame）',
      diff: '与上一修订的逐行 +/- 差异；仅文本文件，二进制文件不支持',
    }
    const TABS = [['content', '内容'], ['history', '历史'], ['blame', '归属'], ['diff', '对比']]

    const svgLine = (attrs, children) => e('svg', {
      viewBox: '0 0 24 24', width: 15, height: 15, fill: 'none', stroke: 'currentColor',
      strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, ...attrs,
    }, children)

    const ICON_RELOAD = svgLine({}, [e('path', { key: 'a', d: 'M19 12a7 7 0 1 1-2.05-4.95' }), e('path', { key: 'b', d: 'M19 4v4h-4' })])
    const ICON_CLOSE = svgLine({}, [e('path', { key: 'a', d: 'M6 6l12 12M18 6L6 18' })])
    const ICON_COPY = svgLine({}, [
      e('rect', { key: 'a', x: 8.5, y: 8.5, width: 11, height: 11, rx: 2.2 }),
      e('path', { key: 'b', d: 'M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5' }),
    ])
    const ICON_MORE = e('svg', { viewBox: '0 0 24 24', width: 15, height: 15, fill: 'currentColor', 'aria-hidden': true },
      e('circle', { cx: 5.5, cy: 12, r: 1.6 }), e('circle', { cx: 12, cy: 12, r: 1.6 }), e('circle', { cx: 18.5, cy: 12, r: 1.6 }))
    const ICON_OPEN = svgLine({}, [
      e('path', { key: 'a', d: 'M14 4h6v6' }),
      e('path', { key: 'b', d: 'M20 4l-9 9' }),
      e('path', { key: 'c', d: 'M19 14v4.5A1.5 1.5 0 0 1 17.5 20h-11A1.5 1.5 0 0 1 5 18.5v-11A1.5 1.5 0 0 1 6.5 6H11' }),
    ])
    const ICON_LINK = svgLine({}, [
      e('path', { key: 'a', d: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5' }),
      e('path', { key: 'b', d: 'M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5' }),
    ])
    const ICON_CHEVRON = svgLine({ width: 15, height: 15, strokeWidth: 2.4 }, [
      e('path', { key: 'a', d: 'M6 9.5l6 6 6-6' }),
    ])
    const ICON_CHEVRON_S = svgLine({ width: 12, height: 12, strokeWidth: 2.4 }, [
      e('path', { key: 'a', d: 'M6 9.5l6 6 6-6' }),
    ])
    const ICON_FOLDER = svgLine({}, [
      e('path', { key: 'a', d: 'M3.6 7A1.6 1.6 0 0 1 5.2 5.4h3.6l1.8 2h8.2A1.6 1.6 0 0 1 20.4 9v8.4a1.6 1.6 0 0 1-1.6 1.6H5.2a1.6 1.6 0 0 1-1.6-1.6Z' }),
    ])
    const ICON_REL = svgLine({}, [
      e('path', { key: 'a', d: 'M9.5 4.5 7.6 19.5' }),
      e('path', { key: 'b', d: 'M16.4 4.5 14.5 19.5' }),
      e('path', { key: 'c', d: 'M4.5 9.5h15' }),
      e('path', { key: 'd', d: 'M4 15h15' }),
    ])
    const ICON_DOWN = svgLine({ width: 11, height: 11, strokeWidth: 2.3 }, [
      e('path', { key: 'a', d: 'M12 4v11' }), e('path', { key: 'b', d: 'M8 11l4 4 4-4' }), e('path', { key: 'c', d: 'M5 20h14' }),
    ])
    const ICON_EYE = svgLine({ width: 12, height: 12 }, [
      e('path', { key: 'a', d: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z' }), e('circle', { key: 'b', cx: 12, cy: 12, r: 2.5 }),
    ])
    const ICON_PANEL = svgLine({ width: 14, height: 14 }, [
      e('rect', { key: 'a', x: 3, y: 4, width: 18, height: 16, rx: 2 }), e('path', { key: 'b', d: 'M15 4v16' }),
    ])
    const ICON_CHECK = svgLine({ width: 11, height: 11, strokeWidth: 2.6 }, [e('path', { key: 'a', d: 'M4 12l5 5L20 7' })])
    const ICON_WARN = svgLine({ width: 11, height: 11, strokeWidth: 2.4 }, [
      e('path', { key: 'a', d: 'M12 4v9' }), e('path', { key: 'b', d: 'M12 17.5v.5' }),
    ])
    const ICON_CHEVRON_U = svgLine({ width: 11, height: 11, strokeWidth: 2.4 }, [e('path', { key: 'a', d: 'M6 14l6-6 6 6' })])
    const ICON_CHEVRON_R = svgLine({ width: 12, height: 12, strokeWidth: 2.4 }, [e('path', { key: 'a', d: 'M9 6l6 6-6 6' })])
    const ICON_CLOCK = svgLine({ width: 16, height: 16 }, [
      e('circle', { key: 'a', cx: 12, cy: 12, r: 8.5 }), e('path', { key: 'b', d: 'M12 7.5v4.5l3 2' }),
    ])
    const ICON_SIDEBAR_CLOSE = svgLine({ width: 14, height: 14 }, [
      e('rect', { key: 'a', x: 3, y: 4, width: 18, height: 16, rx: 2 }), e('path', { key: 'b', d: 'M15 4v16' }), e('path', { key: 'c', d: 'M11 9.5 8.5 12l2.5 2.5' }),
    ])
    const ICON_SIDEBAR_OPEN = svgLine({ width: 14, height: 14 }, [
      e('rect', { key: 'a', x: 3, y: 4, width: 18, height: 16, rx: 2 }), e('path', { key: 'b', d: 'M15 4v16' }), e('path', { key: 'c', d: 'M8.5 9.5 11 12l-2.5 2.5' }),
    ])

    /** 预览面板：两行身份 + 页签行（右侧视图控件区）+ 内容区。 */
    function Preview({ file, tab, meta, log, diff, diffError, blame, rev, onTab, onOpenRev, onOpenDir, onDownload, onCopy, copied, onClose, onReloadFile, dlState, onRetryDiff, railOpen, onToggleRail }) {
      const [ctl, setCtl] = useState(null)
      const [prog, setProg] = useState(null)
      const [pop, setPop] = useState(null)
      const popRef = useRef(null)

      // 换文件或换页签时只收起浮层；视图控件/进度由子组件的注册/注销负责清空。
      useEffect(() => { setPop(null) }, [file?.path, tab])

      useEffect(() => {
        if (!pop) return undefined
        const onDown = (event) => { if (!popRef.current || !popRef.current.contains(event.target)) setPop(null) }
        document.addEventListener('mousedown', onDown)
        return () => document.removeEventListener('mousedown', onDown)
      }, [pop])

      // Esc 依次关浮层、关预览。
      useEffect(() => {
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          if (pop) { setPop(null); return }
          onClose()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [pop, onClose])

      if (!file) {
        return e('div', { className: 'svn-empty' },
          e('div', { className: 'svn-logo' }, 'SVN'),
          e('div', null, '选择左侧目录中的文件查看内容'),
          e('div', { className: 'svn-note' }, '支持 Word/Excel/PPT 版式预览、PDF、图片与文本；渲染失败自动回文字大纲'),
        )
      }

      const segs = String(file.path ?? '').split('/').slice(0, -1)
      const viewedRev = rev ?? meta?.rev ?? null
      const metaBits = [
        file.size ? fmtSize(file.size) : null,
        viewedRev ? `r${viewedRev}` : null,
        meta?.author || null,
        meta?.date ? fmtDate(meta.date) : null,
      ].filter(Boolean)

      const openMenu = (event, kind) => {
        event.stopPropagation()
        const rect = event.currentTarget.getBoundingClientRect()
        setPop({ kind, x: Math.max(12, rect.right - 200), y: rect.bottom + 6 })
      }

      const bytesLoading = prog && prog.phase === 'loading'
      const bytesFailed = prog && prog.phase === 'failed'
      const pct = prog && prog.total ? Math.min(100, Math.round((prog.received / prog.total) * 100)) : 0

      const dlClassName = dlState === 'done' ? 'svn-btn ok' : dlState === 'fail' ? 'svn-btn danger' : 'svn-btn primary'
      const dlLabel = dlState === 'working' ? '下载中…' : dlState === 'done' ? '已下载 ✓' : dlState === 'fail' ? '下载失败' : '下载'

      const menuItems = pop?.kind === 'more'
        ? [
            ['在浏览器打开原始文件', () => { try { window.open(file.rawUrl, '_blank') } catch { /* ignore */ } }, !file.rawUrl, ICON_OPEN, '↗'],
            ['复制文件链接', () => { copyText(file.rawUrl).catch(() => {}) }, !file.rawUrl, ICON_LINK, ''],
            ['下载当前修订', () => onDownload(), false, ICON_DOWN, viewedRev ? `r${viewedRev}` : ''],
          ]
        : [
            ['复制文件路径', () => onCopy('file'), false, ICON_COPY, ''],
            ['复制目录路径', () => onCopy('dir'), false, ICON_FOLDER, ''],
            ['复制相对路径', () => onCopy('rel'), false, ICON_REL, ''],
          ]

      return e('div', { className: 'svn-preview' },
        e('div', { className: 'svn-fhd' },
          e(TypeIcon, { name: file.name, size: 22 }),
          e('div', { className: 'fid' },
            e('b', { title: file.name }, file.name),
            e('small', null,
              segs.length ? e(React.Fragment, null,
                e('span', { className: 'svn-crumbwrap' }, segs.map((seg, i) => e(React.Fragment, { key: i },
                  i ? e('span', { className: 'sep' }, '/') : null,
                  e('button', {
                    className: 'svn-crumbseg', title: `跳到 ${segs.slice(0, i + 1).join('/')}`,
                    onClick: () => onOpenDir(segs.slice(0, i + 1).join('/')),
                  }, seg)))),
                e('span', { className: 'sep' }, '·')) : null,
              metaBits.length
                ? metaBits.map((bit, index) => e(React.Fragment, { key: index }, index ? e('span', { className: 'sep' }, '·') : null, e('span', null, bit)))
                : e('span', null, '—')),
          ),
          e('div', { className: 'svn-fa' },
            bytesLoading ? e('div', { className: 'svn-dlprog', title: '正在读取文件内容，读取完成后自动渲染' },
              e('span', null, prog.total ? `${pct}%` : '读取中'),
              prog.total ? e('span', { style: { fontFamily: 'var(--svn-mono)', fontSize: '10.5px' } }, `${fmtSize(prog.received)} / ${fmtSize(prog.total)}`) : null,
              e('span', { className: prog.total ? 'track' : 'track indet' }, e('i', { style: prog.total ? { width: `${pct}%` } : null })),
              e('button', { className: 'x', title: '取消读取', onClick: () => { if (prog.cancel) prog.cancel() } }, '✕')) : null,
            bytesFailed ? e('div', { className: 'svn-dlprog fail' },
              e('span', null, '读取失败'),
              e('button', { className: 'x', title: '重试读取', onClick: () => { if (prog.retry) prog.retry() } }, '重试'),
              e('button', { className: 'x', title: '收起', onClick: () => setProg(null) }, '✕')) : null,
            e('button', {
              className: dlClassName, style: { height: '28px', padding: '0 12px' },
              disabled: dlState === 'working', onClick: onDownload, title: '下载文件到本地',
            }, dlLabel,
            dlState === 'done' || dlState === 'fail' ? null : e('span', { className: 'svn-nest' }, ICON_DOWN)),
            copied && ['file', 'dir', 'rel'].includes(copied.key)
              ? e('span', { className: copied.ok ? 'svn-copied' : 'svn-copied bad' }, copied.ok ? '已复制 ✓' : '复制失败')
              : null,
            e('button', { className: 'svn-ibtn', title: '复制路径', 'aria-label': '复制路径', onClick: (event) => openMenu(event, 'copy') }, ICON_COPY),
            e('button', { className: 'svn-ibtn', title: '更多', 'aria-label': '更多', onClick: (event) => openMenu(event, 'more') }, ICON_MORE),
            e('button', { className: 'svn-ibtn close', title: '关闭预览（Esc）', 'aria-label': '关闭预览（Esc）', onClick: onClose }, ICON_CLOSE),
          ),
        ),
        e('div', { className: 'svn-tabbar', role: 'tablist' },
          TABS.map(([key, label]) => e('button', {
            key, type: 'button', role: 'tab',
            className: `svn-tab${tab === key ? ' on' : ''}`,
            'aria-selected': tab === key, title: TAB_TITLES[key],
            onClick: () => onTab(key),
          }, label)),
          e('span', { className: 'sp' }),
          tab === 'content' && ctl ? e('div', { className: 'svn-vctl' },
            ctl.status ? e('span', { className: 'svn-vstat' },
              ctl.status.dot ? e('i', { className: `dot ${ctl.status.dot}` }) : null,
              ctl.status.text) : null,
            ctl.controls ?? null) : null,
          e('button', {
            className: 'svn-vico', title: railOpen ? '收起上下文栏' : '打开上下文栏（最近修订 / 同目录）',
            'aria-label': railOpen ? '收起上下文栏' : '打开上下文栏（最近修订 / 同目录）',
            'aria-pressed': !!railOpen, onClick: onToggleRail,
          }, ICON_PANEL),
          e('button', {
            className: 'svn-vico',
            title: '重新加载此文件（绕过缓存）',
            'aria-label': '重新加载此文件（绕过缓存）',
            onClick: () => { if (prog && prog.reload) prog.reload(); else onReloadFile() },
          }, ICON_RELOAD),
        ),
        tab === 'content' ? e('div', { className: 'svn-pv-body' }, contentView(file, onReloadFile, { setCtl, setProg })) : null,
        tab === 'history' ? e('div', { className: 'svn-pv-body' }, historyView(log, onOpenRev)) : null,
        tab === 'blame' ? e('div', { className: 'svn-pv-body' }, blameView(blame, onOpenRev)) : null,
        tab === 'diff' ? e('div', { className: 'svn-pv-body' }, e(diffView, { diff, diffError, file, onRetry: onRetryDiff })) : null,
        pop ? e('div', { className: 'svn-pop svn-menu', ref: popRef, style: { left: pop.x, top: pop.y } },
          menuItems.map(([label, action, disabled, icon, hint]) => e('button', {
            key: label, type: 'button', disabled: !!disabled,
            onClick: () => { setPop(null); action() },
          }, icon ?? null, label, hint ? e('span', { className: 'hint' }, hint) : null))) : null,
      )
    }

    function contentView(file, onReloadFile, io) {
      const ctl = io ? io.setCtl : null
      const progress = io ? io.setProg : null
      if (file.view === 'docx') return e(DocxView, { key: file.path, file, onCtl: ctl, onProgress: progress })
      if (file.view === 'spreadsheet') return e(TableView, { key: file.path, file, onCtl: ctl, onProgress: progress })
      if (file.view === 'pptx') return e(PptxView, { key: file.path, file, onCtl: ctl, onProgress: progress })
      if (file.view === 'pdf') return e(PdfView, { key: file.path, file, onCtl: ctl, onProgress: progress })
      if (file.view === 'image') return e(ImageView, { key: file.path, file, onCtl: ctl, onProgress: progress })
      if (file.view === 'video') return e(VideoView, { key: file.path, file, onCtl: ctl, onProgress: progress })
      if (file.view === 'text') return e(TextView, { key: file.path, file, onCtl: ctl })
      if (file.view === 'office-text') {
        return e(OfficeTextView, {
          key: file.path, file, onCtl: ctl,
          reason: `提取自 ${String(file.officeKind ?? 'office').toUpperCase()}${file.truncated ? ' · 已截断' : ''} · 仅文本，版式不保留`,
        })
      }
      const messages = {
        office: 'Office 文档暂不内嵌渲染，可下载后用本地应用或 DSH 的 Office 预览打开。',
        archive: '压缩包不在查看器内展开，下载后查看。',
        binary: '二进制文件，不提供内容预览。',
        'too-large': '文件超过预览上限（2 MB），下载后查看。',
      }
      return e('div', { className: 'svn-empty' },
        e('div', { className: 'svn-logo' }, e(TypeIcon, { name: file.name, size: 28 })),
        e('div', null, messages[file.view] ?? '该类型暂不支持预览'),
        e('div', { className: 'svn-note' }, `${file.name} · ${fmtSize(file.size)}`),
      )
    }

    /** 文本预览：显示设置（换行/行号/字号/原始文件）收进一个浮层，状态走页签行右侧。 */
    function TextView({ file, onCtl }) {
      const lines = useMemo(() => String(file.content ?? '').split('\n'), [file.content])
      const [wrap, setWrap] = useState(false)
      const [showLn, setShowLn] = useState(true)
      const [fs, setFs] = useState(12)
      const [setPop, setSetPop] = useState(null)
      useEffect(() => {
        if (!setPop) return undefined
        const onDown = (event) => { if (!event.target.closest || !event.target.closest('.svn-setpop, .svn-setbtn')) setSetPop(null) }
        document.addEventListener('mousedown', onDown)
        return () => document.removeEventListener('mousedown', onDown)
      }, [setPop])
      useEffect(() => {
        if (!onCtl) return undefined
        onCtl({
          status: {
            dot: file.fromCache ? 'ok' : null,
            text: [file.encoding, `共 ${lines.length} 行`, file.fromCache ? '缓存' : null].filter(Boolean).join(' · '),
          },
          controls: e('button', {
            className: 'svn-vbtn svn-setbtn', 'aria-expanded': !!setPop,
            onClick: (event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              setSetPop(setPop ? null : { x: Math.max(12, rect.right - 220), y: rect.bottom + 6 })
            },
          }, '显示设置'),
        })
        return () => onCtl(null)
      }, [onCtl, file.encoding, file.fromCache, lines.length, setPop])
      const shown = lines.slice(0, TEXT_RENDER_LIMIT)
      return e('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 } },
        e('div', { className: 'svn-viewbody', style: { overflow: 'auto' } },
          e('div', { className: 'svn-code', style: { fontSize: `${fs}px`, whiteSpace: wrap ? 'pre-wrap' : 'pre', overflowWrap: wrap ? 'anywhere' : 'normal' } },
            shown.map((line, index) => e('div', { className: 'svn-ln', key: index, style: showLn ? null : { gridTemplateColumns: '1fr' } },
              showLn ? e('span', { className: 'g' }, String(index + 1)) : null,
              e('span', null, line === '' ? ' ' : line))),
            file.truncated ? e('div', { className: 'svn-note', style: { padding: '8px 0' } }, '文件较大，仅显示前 2 MB') : null,
            lines.length > TEXT_RENDER_LIMIT ? e('div', { className: 'svn-note', style: { padding: '8px 0' } }, `仅渲染前 ${TEXT_RENDER_LIMIT} 行，共 ${lines.length} 行`) : null)),
        setPop ? e('div', { className: 'svn-pop svn-setpop', style: { left: setPop.x, top: setPop.y } },
          e('div', { className: 'row' }, e('label', null, e('input', { type: 'checkbox', checked: wrap, onChange: (event) => setWrap(event.target.checked) }), '自动换行')),
          e('div', { className: 'row' }, e('label', null, e('input', { type: 'checkbox', checked: showLn, onChange: (event) => setShowLn(event.target.checked) }), '行号')),
          e('div', { className: 'row' }, e('span', { style: { flex: 1 } }, '字号'),
            e('select', { value: fs, 'aria-label': '字号', onChange: (event) => setFs(Number(event.target.value)) },
              [11, 12, 13, 14].map((n) => e('option', { key: n, value: n }, `${n}px`)))),
          e('div', { className: 'row' }, e('button', {
            className: 'svn-vbtn', disabled: !file.rawUrl,
            onClick: () => { try { window.open(file.rawUrl, '_blank') } catch { /* ignore */ } },
          }, '打开原始文件'))) : null)
    }

    function historyView(log, onOpenRev) {
      if (!log) return e('div', { className: 'svn-empty' }, '正在加载历史…')
      if (!log.entries.length) return e('div', { className: 'svn-empty' }, '没有历史记录')
      return e('div', null, log.entries.map((entry) => e('div', {
        key: entry.rev, className: 'svn-hist', style: { cursor: 'pointer' }, onClick: () => onOpenRev(entry.rev),
        role: 'button', tabIndex: 0, 'aria-label': `r${entry.rev} ${entry.message || '(无提交信息)'}`,
        onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpenRev(entry.rev) } },
      },
      e('div', { className: 'l1' },
        e('span', { className: 'no' }, `r${entry.rev}`),
        e('span', { className: 'au' }, entry.author || '—'),
        e('span', { className: 'tm' }, fmtDate(entry.date)),
      ),
      e('div', { className: 'msg' }, entry.message || '(无提交信息)'),
      entry.paths.length ? e('div', { className: 'meta' }, entry.paths.slice(0, 3).map((item, index) => e('span', { key: index }, `${item.action ?? ''} ${item.text}`))) : null,
      )))
    }

    function diffView({ diff, diffError, file, onRetry }) {
      const [jump, setJump] = useState(0)
      const [side, setSide] = useState(false)
      const bodyRef = useRef(null)
      // 0.3.16：兜底剥离原始头（旧宿主仍可能回 Index:/==== 行），无变更走白话空态。
      const lines = useMemo(() => (diff?.lines ?? []).filter((l) => l.kind !== 'file' && l.kind !== 'meta'), [diff])
      const hunks = useMemo(() => {
        if (!diff || diff.binary || !lines.length) return []
        const out = []
        let cur = null
        lines.forEach((ln, i) => {
          if (ln.kind === 'add' || ln.kind === 'del') {
            if (!cur) { cur = { start: i, end: i }; out.push(cur) } else cur.end = i
          } else cur = null
        })
        return out
      }, [diff])
      useEffect(() => { setJump(0) }, [diff])
      const goto = (i) => {
        const h = hunks[i]
        if (!h) return
        setJump(i)
        const el = bodyRef.current?.querySelector(`[data-hunk="${i}"]`)
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' })
      }
      if (!diff && diffError) {
        return e('div', { className: 'svn-empty' },
          e('div', null, `差异加载失败：${diffError}`),
          e('button', { className: 'svn-btn act', onClick: onRetry, title: '重新请求差异' }, '重试'),
          e('div', { className: 'svn-note' }, '对比展示该修订相对上一修订的逐行 +/- 差异，仅支持文本文件'),
        )
      }
      if (!diff) return e('div', { className: 'svn-skel' },
        e('div', { className: 'box' },
          e('div', { className: 't1' }, '正在加载差异…'),
          e('div', { className: 'bar indet' }, e('i'))))
      if (diff.binary) {
        return e('div', { className: 'svn-empty' },
          e('div', null, '二进制文件不做逐行对比'),
          e('div', { className: 'svn-note' }, `「${file.name}」属于视频/图片/Office/压缩包等二进制格式；对比仅对文本文件显示逐行 +/- 差异，可在「内容」页签查看预览或直接下载`),
        )
      }
      if (!lines.length || (diff.stat.add === 0 && diff.stat.del === 0 && lines.every((l) => !(l.text || '').trim()))) return e('div', { className: 'svn-empty' }, diff.note === 'no-previous' ? '该修订为初始版本，没有上一修订可对比' : '该修订没有差异')
      const hunkAt = (index) => hunks.findIndex((h) => h.start === index)
      const inJump = (index) => { const h = hunks[jump]; return !!h && index >= h.start && index <= h.end }
      const inline = e('div', { className: 'svn-code' }, lines.map((line, index) => {
        const hi = hunkAt(index)
        return e('div', {
          key: index, className: `svn-ln ${line.kind}${inJump(index) ? ' jump' : ''}`,
          ...(hi >= 0 ? { 'data-hunk': hi } : null),
        }, e('span', { className: 'g' }, line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''), e('span', null, line.text || ' '))
      }))
      let split = null
      if (side) {
        const rows = []
        let i = 0
        let hi = -1
        while (i < lines.length) {
          const ln = lines[i]
          if (ln.kind === 'add' || ln.kind === 'del') {
            hi += 1
            const dels = []
            const adds = []
            while (i < lines.length && (lines[i].kind === 'add' || lines[i].kind === 'del')) {
              (lines[i].kind === 'del' ? dels : adds).push(lines[i].text)
              i += 1
            }
            const n = Math.max(dels.length, adds.length)
            for (let k = 0; k < n; k++) rows.push({ l: dels[k] ?? null, r: adds[k] ?? null, h: k === 0 ? hi : -1, j: hi === jump })
          } else {
            rows.push({ l: ln.text, r: ln.text, h: -1, j: false })
            i += 1
          }
        }
        const col = (key) => e('div', { className: 'col' }, rows.map((row, index) => e('div', {
          key: index, className: `svn-ln ${row[key] === null ? '' : key === 'l' ? 'del' : 'add'}${row.j ? ' jump' : ''}`,
          ...(row.h >= 0 ? { 'data-hunk': row.h } : null),
        }, e('span', { className: 'g' }, row[key] === null ? '' : key === 'l' ? '−' : '+'), e('span', null, row[key] === null ? ' ' : row[key] || ' '))))
        split = e('div', { className: 'svn-diffsplit' }, col('l'), col('r'))
      }
      return e('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 } },
        e('div', { className: 'svn-split' }, `对比 r${diff.rev ?? '工作副本'} · +${diff.stat.add} / -${diff.stat.del}`),
        hunks.length ? e('div', { className: 'svn-jumpbar' },
          e('button', { className: 'svn-vbtn', disabled: jump <= 0, onClick: () => goto(jump - 1) }, '上一处'),
          e('button', { className: 'svn-vbtn', disabled: jump >= hunks.length - 1, onClick: () => goto(jump + 1) }, '下一处'),
          e('span', { className: 'cnt' }, `${jump + 1}/${hunks.length}`),
          e('span', { className: 'sp' }),
          e('span', { className: 'svn-seg', role: 'group', 'aria-label': '对比视图' },
            e('button', { className: side ? '' : 'on', onClick: () => setSide(false) }, '行内'),
            e('button', { className: side ? 'on' : '', onClick: () => setSide(true) }, '并排'))) : null,
        e('div', { className: 'svn-viewbody', ref: bodyRef, style: { overflow: 'auto' } }, side ? split : inline),
      )
    }

    function blameView(blame, onOpenRev) {
      if (!blame) return e('div', { className: 'svn-empty' }, '正在加载逐行归属…')
      if (!blame.lines.length) return e('div', { className: 'svn-empty' }, '该文件不支持逐行归属')
      return e('div', { className: 'svn-code' },
        blame.lines.map((line) => e('div', { className: 'svn-ln', key: line.line },
          e('span', {
            className: 'g', style: { cursor: 'pointer' }, title: `${line.author || '—'} r${line.rev}`, onClick: () => onOpenRev(line.rev),
            role: 'button', tabIndex: 0, 'aria-label': `第 ${line.line} 行归属 r${line.rev}`,
            onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpenRev(line.rev) } },
          }, `r${line.rev}`),
          e('span', null, ` ${line.text || ' '}`),
        )),
      )
    }
    function TreeNode({ node, depth, state, onOpenDir, onOpenFile, onToggleDir, onKeyNav, pathPrefix }) {
      const full = pathPrefix ? `${pathPrefix}/${node.name}` : node.name
      const isDir = node.kind === 'dir'
      const match = state.match
      const children = state.dirCache[full]
      // 过滤态：只留命中节点及其祖先目录，命中目录自动展开。
      const kids = match && children ? children.filter((child) => match.has(`${full}/${child.name}`)) : children
      if (match && !match.has(full) && !(kids && kids.length)) return null
      const open = match ? !!(kids && kids.length) : !!state.expanded[full]
      return e(React.Fragment, null,
        e('div', {
          className: `svn-row${state.selected === full ? ' sel' : ''}`,
          style: { paddingLeft: `${4 + depth * 14}px` },
          onClick: () => (isDir ? onOpenDir(full) : onOpenFile(full, null, { size: node.size ?? null, entry: node })),
          title: full,
          role: 'treeitem', 'aria-selected': state.selected === full, 'aria-expanded': isDir ? open : undefined,
          'aria-label': `${node.name}${isDir ? '，目录' : '，文件'}`,
          tabIndex: state.focus === full ? 0 : -1, 'data-tree-path': full,
          onKeyDown: (event) => onKeyNav(event, full, isDir, open, node),
        },
        isDir
          ? e(Caret, { open, onClick: () => onToggleDir(full) })
          : e('span', { className: 'svn-caret leaf' }),
        e(TypeIcon, { name: node.name, dir: isDir, open }),
        e('span', { className: 'nm' }, node.name),
        node.status ? e(StatusDot, { status: node.status }) : null,
        state.previewing === full ? e('span', { className: 'pv', title: '预览中' }, ICON_EYE, '预览中') : null,
        isDir && kids ? e('span', { className: 'n' }, String(kids.length)) : null,
        ),
        isDir && open && kids ? kids.map((child) => e(TreeNode, {
          key: `${full}/${child.name}`, node: child, depth: depth + 1, state,
          onOpenDir, onOpenFile, onToggleDir, onKeyNav, pathPrefix: full,
        })) : null,
      )
    }

    /* ----------------------------------------------------------------- app */

    // Panel switches unmount <App/>; this module-level snapshot survives and rehydrates instantly.
    const uiSnapshot = { root: '', currentPath: '', selected: '', expanded: null, dirCache: null, file: null, tab: 'content', rev: null, dockCollapsed: false, secsOpen: null }
    const lsGet = (key) => { try { return localStorage.getItem(key) } catch { return null } }

    function App() {
      const [rootInput, setRootInput] = useState(() => {
        try { return localStorage.getItem(STORAGE_ROOT) ?? '' } catch { return '' }
      })
      const [root, setRoot] = useState('')
      const [kind, setKind] = useState('wc')
      const [info, setInfo] = useState(null)
      const [dirCache, setDirCache] = useState(() => uiSnapshot.dirCache ?? {})
      const [expanded, setExpanded] = useState(() => {
        if (uiSnapshot.expanded) return uiSnapshot.expanded
        const saved = lsGet(STORAGE_EXPANDED)
        if (saved) { try { return JSON.parse(saved) } catch { /* fall through */ } }
        return { '': true }
      })
      const [currentPath, setCurrentPath] = useState(() => uiSnapshot.currentPath || lsGet(STORAGE_PATH) || '')
      const [entries, setEntries] = useState([])
      const [statusMap, setStatusMap] = useState({})
      const [selected, setSelected] = useState(() => uiSnapshot.selected || lsGet(STORAGE_SELECTED) || '')
      const [file, setFile] = useState(() => uiSnapshot.file ?? null)
      const [rev, setRev] = useState(() => uiSnapshot.rev ?? null)
      const [tab, setTab] = useState(() => uiSnapshot.tab || 'content')
      const [log, setLog] = useState(null)
      const [diff, setDiff] = useState(null)
      const [diffError, setDiffError] = useState(null)
      const [blame, setBlame] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [sparse, setSparse] = useState(false)
      const [discovered, setDiscovered] = useState([])
      const [query, setQuery] = useState('')
      const savedSearch = (() => {
        try { return JSON.parse(localStorage.getItem(STORAGE_SEARCH) ?? '{}') ?? {} } catch { return {} }
      })()
      const [searchMode, setSearchMode] = useState(savedSearch.mode === 'content' ? 'content' : 'name')
      const [searchScope, setSearchScope] = useState(savedSearch.scope === 'dir' ? 'dir' : 'repo')
      const [searchReturn, setSearchReturn] = useState(null)
      const [picker, setPicker] = useState(null)
      const [searchVisible, setSearchVisible] = useState(100)
      const [search, setSearch] = useState(null)
      const [searching, setSearching] = useState(false)
      const [modeOpen, setModeOpen] = useState(false)
      const [treeFilter, setTreeFilter] = useState('')
      const [fileMeta, setFileMeta] = useState(null)
      // Keep at least RIGHT_MIN px for the right pane no matter how wide the viewport is.
      const maxTreeWidth = () => Math.max(TREE_WIDTH_MIN, Math.min(TREE_WIDTH_MAX, window.innerWidth - RIGHT_MIN_PX))
      const [treeWidth, setTreeWidth] = useState(() => {
        try {
          const saved = Number(localStorage.getItem(STORAGE_TREE_WIDTH))
          if (Number.isFinite(saved) && saved > 0) return Math.min(maxTreeWidth(), Math.max(TREE_WIDTH_MIN, saved))
        } catch { /* ignore */ }
        return Math.min(TREE_WIDTH_DEFAULT, maxTreeWidth())
      })
      const [dragging, setDragging] = useState(false)
      const [copied, setCopied] = useState(null)
      const [dlState, setDlState] = useState('idle')
      const dlTimer = useRef(null)
      // 0.3.13：toast 层（内联✓的补充）、读屏播报、导出进度、上下文栏/图例/树焦点/索引状态
      const [toasts, setToasts] = useState([])
      const toastSeq = useRef(0)
      const toastTimers = useRef(new Map())
      const toastKinds = useRef(new Map())
      const [announce, setAnnounce] = useState('')
      const [exportProg, setExportProg] = useState(null)
      const exportCtrl = useRef(null)
      const [railOpen, setRailOpen] = useState(() => lsGet(STORAGE_RAIL) === '1')
      const [legendOpen, setLegendOpen] = useState(true)
      const [treeFocus, setTreeFocus] = useState('')
      const [indexInfo, setIndexInfo] = useState({ indexed: false, indexing: false, entries: null })
      const [lastRefresh, setLastRefresh] = useState(0)
      const [idxOpen, setIdxOpen] = useState(false)
      // 0.3.20 V4：最近访问、目录栏收起态、浮层。
      const [recent, setRecent] = useState(() => {
        // 0.3.25：最近只记文件；旧版目录条目（无 kind）迁移时丢弃。
        try { return (JSON.parse(lsGet(STORAGE_RECENT) ?? '[]') ?? []).filter((it) => it && it.kind === 'file') } catch { return [] }
      })
      const [dockCollapsed, setDockCollapsed] = useState(() => uiSnapshot.dockCollapsed || lsGet(STORAGE_TREE_RAIL) === '1')
      // 0.3.22：最近/全部目录 两段 VS Code 式折叠面板；折叠态持久化。
      const [secsOpen, setSecsOpen] = useState(() => {
        if (uiSnapshot.secsOpen) return uiSnapshot.secsOpen
        try { return { recent: true, all: true, ...JSON.parse(lsGet(STORAGE_SECS) ?? '{}') } } catch { return { recent: true, all: true } }
      })
      const toggleSec = (id) => setSecsOpen((prev) => {
        const next = { ...prev, [id]: !prev[id] }
        uiSnapshot.secsOpen = next
        try { localStorage.setItem(STORAGE_SECS, JSON.stringify(next)) } catch { /* ignore */ }
        return next
      })
      const [flyout, setFlyout] = useState(null) // null | 'tree' | 'recent'
      const [flyPos, setFlyPos] = useState({ left: 0, top: 0, maxHeight: 420 })
      const flyRef = useRef(null)
      const railRef = useRef(null)
      const railTreeBtnRef = useRef(null)
      const railRecentBtnRef = useRef(null)
      const flyFocusRef = useRef(false)
      const flyoutRef = useRef(null)
      flyoutRef.current = flyout
      const hoverTimers = useRef({ open: null, close: null })
      const dropToast = useCallback((id) => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
        const tm = toastTimers.current.get(id)
        if (tm) { clearTimeout(tm); toastTimers.current.delete(id) }
        toastKinds.current.delete(id)
      }, [])
      const pushToast = useCallback((t) => {
        const id = ++toastSeq.current
        const item = { id, kind: t.kind || 'ok', msg: t.msg, sub: t.sub || null, retry: t.retry || null }
        toastKinds.current.set(id, item.kind)
        setToasts((prev) => [...prev.slice(-3), item])
        if (item.kind === 'ok') toastTimers.current.set(id, setTimeout(() => dropToast(id), 3500))
        return id
      }, [dropToast])
      const pauseToast = useCallback((id, on) => {
        const tm = toastTimers.current.get(id)
        if (on) { if (tm) { clearTimeout(tm); toastTimers.current.delete(id) } }
        else if (toastKinds.current.get(id) === 'ok' && !toastTimers.current.has(id)) {
          toastTimers.current.set(id, setTimeout(() => dropToast(id), 1600))
        }
      }, [dropToast])
      useEffect(() => () => { for (const tm of toastTimers.current.values()) clearTimeout(tm) }, [])
      useEffect(() => { try { localStorage.setItem(STORAGE_RAIL, railOpen ? '1' : '0') } catch { /* ignore */ } }, [railOpen])
      useEffect(() => { try { localStorage.setItem(STORAGE_TREE_RAIL, dockCollapsed ? '1' : '0') } catch { /* ignore */ } }, [dockCollapsed])
      // 目录栏收起时树在浮层里，焦点查询改为全文档（同一时刻只渲染面板树或浮层树之一）。
      const focusTreeRow = useCallback((path) => {
        setTreeFocus(path)
        raf(() => {
          const rows = document.querySelectorAll('[data-tree-path]')
          for (const el of rows) if (el.getAttribute('data-tree-path') === path) { el.focus(); break }
        })
      }, [])
      const [roots, setRoots] = useState(() => {
        try { return JSON.parse(localStorage.getItem(STORAGE_ROOTS) ?? '[]') } catch { return [] }
      })
      const [rootsOpen, setRootsOpen] = useState(false)
      const searchRef = useRef(null)
      const searchPollRef = useRef(null)
      useEffect(() => {
        try { localStorage.setItem(STORAGE_SEARCH, JSON.stringify({ mode: searchMode, scope: searchScope })) } catch { /* ignore */ }
      }, [searchMode, searchScope])
      const openPicker = useCallback(async (targetPath) => {
        setPicker({ loading: true, path: targetPath ?? '', parent: null, entries: [], error: null, mode: 'dirs' })
        try {
          const payload = await api('/fs', targetPath ? { path: targetPath } : {})
          setPicker({ loading: false, path: payload.path ?? '', parent: payload.parent ?? null, entries: payload.entries ?? [], error: null, mode: payload.mode ?? 'dirs' })
        } catch (error) {
          setPicker({ loading: false, path: targetPath ?? '', parent: null, entries: [], error: error.message, mode: 'dirs' })
        }
      }, [])
      const closePicker = useCallback(() => setPicker(null), [])
      // 0.3.18：picker 的 Esc 层级与焦点陷阱。capture 监听先于 Preview 的 bubble 监听收到 Esc，
      // stopImmediatePropagation 阻断穿透，Esc 只关 picker；打开时聚焦浮层内第一个可聚焦元素，Tab 循环。
      const pickerOpen = picker !== null
      useEffect(() => {
        if (!pickerOpen) return undefined
        const focusables = () => {
          const overlay = document.querySelector('.svn-picker-overlay')
          return overlay ? [...overlay.querySelectorAll('button:not([disabled]),input,select,[tabindex="0"]')] : []
        }
        const id = raf(() => { const list = focusables(); if (list.length) list[0].focus() })
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.stopImmediatePropagation()
            closePicker()
            return
          }
          if (event.key !== 'Tab') return
          const list = focusables()
          if (!list.length) return
          const first = list[0]
          const last = list[list.length - 1]
          const active = document.activeElement
          if (event.shiftKey) {
            if (active === first || !list.includes(active)) { event.preventDefault(); last.focus() }
          } else if (active === last || !list.includes(active)) { event.preventDefault(); first.focus() }
        }
        document.addEventListener('keydown', onKey, true)
        return () => { caf(id); document.removeEventListener('keydown', onKey, true) }
      }, [pickerOpen, closePicker])
      const runSearchRef = useRef(null)
      const searchTokenRef = useRef({ aborted: true })
      const navRef = useRef('')
      const treeScrollRef = useRef(null)
      const copiedTimer = useRef(null)
      const stateRef = useRef({})
      stateRef.current = { root, kind, dirCache, expanded, currentPath, selected, rev, file, log }

      const treeMatch = useMemo(() => {
        const q = treeFilter.trim().toLowerCase()
        if (!q) return null
        const set = new Set()
        let count = 0
        for (const [dirPath, list] of Object.entries(dirCache)) {
          for (const entry of list ?? []) {
            if (!String(entry.name).toLowerCase().includes(q)) continue
            const full = dirPath ? `${dirPath}/${entry.name}` : entry.name
            set.add(full)
            count += 1
            let parent = dirPath
            while (parent) {
              set.add(parent)
              const cut = parent.lastIndexOf('/')
              parent = cut < 0 ? '' : parent.slice(0, cut)
            }
          }
        }
        return { set, count }
      }, [treeFilter, dirCache])

      const treeState = useMemo(
        () => ({ dirCache, expanded, selected, match: treeMatch ? treeMatch.set : null, previewing: file ? selected : null, focus: treeFocus }),
        [dirCache, expanded, selected, treeMatch, file, treeFocus],
      )

      // 键盘导航用的可见行序列：根级平铺直接 walk（过滤态与展开态一致）。
      const treeRows = useMemo(() => {
        const out = []
        const walk = (list, prefix) => {
          for (const node of list ?? []) {
            const full = prefix ? `${prefix}/${node.name}` : node.name
            if (treeMatch && !treeMatch.set.has(full)) continue
            out.push({ path: full, dir: node.kind === 'dir' })
            const kids = dirCache[full]
            const open = treeMatch ? !!(kids && kids.length) : !!expanded[full]
            if (node.kind === 'dir' && open) walk(kids, full)
          }
        }
        walk(dirCache[''] ?? [], '')
        return out
      }, [dirCache, expanded, treeMatch])
      useEffect(() => {
        if (treeRows.length && !treeRows.some((r) => r.path === treeFocus)) setTreeFocus(treeRows[0].path)
      }, [treeRows, treeFocus])
      // 切换预览文件时把树行滚入视野（A7）。
      useEffect(() => {
        if (!file || !selected) return undefined
        const id = raf(() => {
          const rows = document.querySelectorAll('[data-tree-path]')
          for (const el of rows) if (el.getAttribute('data-tree-path') === selected) { if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); break }
        })
        return () => caf(id)
      }, [selected, file])
      const onTreeKey = (event, full, isDir, open, node) => {
        const idx = treeRows.findIndex((r) => r.path === full)
        const move = (i) => { const t = treeRows[Math.max(0, Math.min(treeRows.length - 1, i))]; if (t) focusTreeRow(t.path) }
        const parent = full.includes('/') ? full.slice(0, full.lastIndexOf('/')) : ''
        if (event.key === 'ArrowDown') { event.preventDefault(); move(idx + 1) }
        else if (event.key === 'ArrowUp') { event.preventDefault(); move(idx - 1) }
        else if (event.key === 'ArrowRight') { event.preventDefault(); if (isDir && !open) toggleDir(full); else if (isDir) move(idx + 1) }
        else if (event.key === 'ArrowLeft') { event.preventDefault(); if (isDir && open) toggleDir(full); else if (full.includes('/')) focusTreeRow(parent) }
        else if (event.key === 'Home') { event.preventDefault(); move(0) }
        else if (event.key === 'End') { event.preventDefault(); move(treeRows.length - 1) }
        else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          if (isDir) pickDir(full)
          else openFile(full, null, { size: node.size ?? null, entry: node })
        }
      }
      const rowKey = (action) => (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action() }
      }

      // 0.3.18：失败原因白话化——常见 SVN/HTTP 错误码映射成一句可操作提示，未识别的原样保留。
      const plainError = (msg) => {
        const s = String(msg)
        if (/E170001|Authentication failed|authorization failed/i.test(s)) return 'SVN 认证失败：请检查凭据或网络后重试'
        if (/E195002/.test(s)) return '远程仓库不支持该操作（已自动改用最后变更修订重试）'
        if (/\b404\b|http-404|not-found/i.test(s)) return '路径或路由不存在（404）：请确认地址与目录'
        if (/timeout|timed out|ETIMEDOUT/i.test(s)) return '请求超时：网络或仓库响应慢，可重试'
        if (/E200009|ENOENT/i.test(s)) return '本地路径不存在：请确认工作副本目录'
        return s
      }
      const setErr = (message) => setError(message ? plainError(message) : null)

      const loadDir = useCallback(async (targetPath) => {
        const current = stateRef.current
        if (!current.root) return
        setBusy(true)
        try {
          const payload = await api('/list', { root: current.root, path: targetPath, rev: current.rev })
          setDirCache((prev) => ({ ...prev, [targetPath]: payload.entries }))
          if (targetPath === current.currentPath) setEntries(payload.entries)
          setErr(null)
          setLastRefresh(Date.now())
        } catch (err) {
          setErr(err.message)
        } finally {
          setBusy(false)
        }
      }, [])

      const loadStatus = useCallback(async (targetRoot, targetKind) => {
        if (targetKind !== 'wc') return
        try {
          const payload = await api('/status', { root: targetRoot })
          setStatusMap(payload.entries ?? {})
        } catch { /* status is optional */ }
      }, [])

      const pushRoot = useCallback((value, kind) => {
        try {
          const list = JSON.parse(localStorage.getItem(STORAGE_ROOTS) ?? '[]')
          const next = [{ root: value, kind, at: Date.now() }, ...list.filter((item) => item.root !== value)].slice(0, 12)
          localStorage.setItem(STORAGE_ROOTS, JSON.stringify(next))
          setRoots(next)
        } catch { /* ignore */ }
      }, [])

      const removeRoot = useCallback((value) => {
        try {
          const list = JSON.parse(localStorage.getItem(STORAGE_ROOTS) ?? '[]')
          const next = list.filter((item) => item.root !== value)
          localStorage.setItem(STORAGE_ROOTS, JSON.stringify(next))
          setRoots(next)
        } catch { /* ignore */ }
      }, [])

      const connect = useCallback(async (rawRoot, opts = {}) => {
        const value = String(rawRoot ?? '').trim()
        if (!value) { setErr('请输入工作副本路径或仓库 URL'); return }
        setBusy(true)
        setErr(null)
        setSearch(null)
        try {
          const payload = await api('/info', { root: value })
          // Publish the resolved root synchronously so a boot-time loadDir/openFile
          // (called right after connect resolves, before React re-renders) can see it.
          stateRef.current = { ...stateRef.current, root: payload.root, kind: payload.kind }
          if (!opts.restore) {
            setDirCache({})
            setExpanded({ '': true })
            setCurrentPath('')
            setSelected('')
            setFile(null)
            setRev(null)
            setLog(null)
            setDiff(null)
          }
          setRoot(payload.root)
          setKind(payload.kind)
          setInfo(payload.info)
          setRootInput(payload.root)
          pushRoot(payload.root, payload.kind)
          try { localStorage.setItem(STORAGE_ROOT, payload.root) } catch { /* ignore */ }
          const listing = await api('/list', { root: payload.root, path: '' })
          setDirCache((prev) => (opts.restore ? { ...prev, '': listing.entries } : { '': listing.entries }))
          setEntries(listing.entries)
          setSparse(listing.note === 'sparse-working-copy')
          setLastRefresh(Date.now())
          setBusy(false)
          loadStatus(payload.root, payload.kind)
        } catch (err) {
          setBusy(false)
          setErr(err.message)
        }
      }, [loadStatus, pushRoot])

      useEffect(() => {
        const onKey = (event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
            event.preventDefault()
            if (searchRef.current) searchRef.current.focus()
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [])

      useEffect(() => {
        const onResize = () => setTreeWidth((prev) => Math.min(prev, maxTreeWidth()))
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      // 0.3.20 V4：浮层 fixed 定位锚定图标条右侧；resize 重定位不关闭；浮层内滚动不触发关闭。
      const placeFlyout = useCallback(() => {
        const rail = railRef.current
        const btn = flyoutRef.current === 'recent' ? railRecentBtnRef.current : railTreeBtnRef.current
        if (!rail || !btn) return
        const r = btn.getBoundingClientRect()
        const top = Math.max(8, Math.round(rail.getBoundingClientRect().top))
        const left = Math.round(r.right + 6)
        const maxHeight = Math.max(200, Math.round((window.innerHeight || 600) - top - 37))
        setFlyPos({ left, top, maxHeight })
      }, [])
      const openFly = useCallback((kind, viaClick) => {
        flyFocusRef.current = !!viaClick
        setFlyout(kind)
      }, [])
      const closeFly = useCallback(() => {
        clearTimeout(hoverTimers.current.open)
        clearTimeout(hoverTimers.current.close)
        setFlyout(null)
      }, [])
      // 悬停打开不抢焦点；仅点击打开聚焦首可见行。
      const hoverOpen = (kind) => {
        clearTimeout(hoverTimers.current.close)
        clearTimeout(hoverTimers.current.open)
        hoverTimers.current.open = setTimeout(() => { openFly(kind, false) }, 160)
      }
      const scheduleHoverClose = () => {
        clearTimeout(hoverTimers.current.open)
        clearTimeout(hoverTimers.current.close)
        hoverTimers.current.close = setTimeout(() => {
          const fly = flyRef.current
          if (fly && fly.contains(document.activeElement)) return // 焦点在浮层内不自动关
          setFlyout(null)
        }, 240)
      }
      useEffect(() => {
        if (!flyout) return undefined
        placeFlyout()
        if (flyFocusRef.current) {
          flyFocusRef.current = false
          raf(() => {
            const el = flyRef.current?.querySelector('.svn-row[tabindex="0"], .svn-recent-row')
            if (el) el.focus()
          })
        }
        const onResize = () => placeFlyout()
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [flyout, placeFlyout])
      // Esc 关浮层：capture 层阻断穿透（不关预览）；过滤框有字时先清空过滤。
      useEffect(() => {
        if (!flyout) return undefined
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          const filterInput = flyRef.current?.querySelector('.svn-treefilter input')
          // 过滤框有字：先清空过滤（同样阻断穿透，避免误关预览），再按一次才收浮层。
          if (filterInput && document.activeElement === filterInput && filterInput.value) {
            event.stopImmediatePropagation()
            setTreeFilter('')
            return
          }
          event.stopImmediatePropagation()
          const btn = flyout === 'recent' ? railRecentBtnRef.current : railTreeBtnRef.current
          closeFly()
          if (btn) btn.focus()
        }
        document.addEventListener('keydown', onKey, true)
        return () => document.removeEventListener('keydown', onKey, true)
      }, [flyout, closeFly])
      useEffect(() => () => { clearTimeout(hoverTimers.current.open); clearTimeout(hoverTimers.current.close) }, [])

      // Keep the module snapshot (panel-switch restore) and localStorage (reload restore) in sync.
      useEffect(() => {
        const keep = Object.keys(dirCache).slice(-24)
        const pruned = {}
        for (const key of keep) pruned[key] = dirCache[key]
        let small = null
        try { if (file && JSON.stringify(file).length < 2 * 1024 * 1024) small = file } catch { small = null }
        Object.assign(uiSnapshot, { root, currentPath, selected, expanded, dirCache: pruned, file: small, tab, rev, dockCollapsed })
        try {
          localStorage.setItem(STORAGE_PATH, currentPath)
          localStorage.setItem(STORAGE_SELECTED, selected)
          const keepExp = Object.keys(expanded).slice(-200)
          const exp = {}
          for (const key of keepExp) exp[key] = expanded[key]
          localStorage.setItem(STORAGE_EXPANDED, JSON.stringify(exp))
        } catch { /* ignore */ }
      }, [root, currentPath, selected, expanded, dirCache, file, tab, rev, dockCollapsed])

      const toggleDir = useCallback(async (targetPath) => {
        const current = stateRef.current
        const nextOpen = !current.expanded[targetPath]
        setExpanded((prev) => ({ ...prev, [targetPath]: nextOpen }))
        if (nextOpen && current.root && !current.dirCache[targetPath]) {
          try {
            const payload = await api('/list', { root: current.root, path: targetPath, rev: current.rev })
            setDirCache((prev) => ({ ...prev, [targetPath]: payload.entries }))
          } catch (err) {
            setErr(err.message)
          }
        }
      }, [])

      const openDir = useCallback(async (targetPath) => {
        navRef.current = targetPath
        setSelected(targetPath)
        setCurrentPath(targetPath)
        setSearch(null)
        setFile(null)
        setExpanded((prev) => ({ ...prev, [targetPath]: true }))
        const cached = stateRef.current.dirCache[targetPath]
        if (cached) setEntries(cached)
        setBusy(true)
        try {
          const payload = await api('/list', { root: stateRef.current.root, path: targetPath, rev: stateRef.current.rev })
          setDirCache((prev) => ({ ...prev, [targetPath]: payload.entries }))
          if (navRef.current === targetPath) setEntries(payload.entries)
          setError(null)
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy(false)
        }
      }, [])

      // Tree row click on a directory: always expand it and show its list on the right.
      // Collapsing is the caret's job (toggleDir), so a second click on the row does not fold it away.
      const pickDir = useCallback(async (targetPath) => {
        const current = stateRef.current
        const wasOpen = !!current.expanded[targetPath]
        if (!wasOpen) setExpanded((prev) => ({ ...prev, [targetPath]: true }))
        if (current.root && !current.dirCache[targetPath]) {
          try {
            const payload = await api('/list', { root: current.root, path: targetPath, rev: current.rev })
            setDirCache((prev) => ({ ...prev, [targetPath]: payload.entries }))
          } catch (err) {
            setErr(err.message)
          }
        }
        navRef.current = targetPath
        setSelected(targetPath)
        setCurrentPath(targetPath)
        setSearch(null)
        setFile(null)
        const cached = stateRef.current.dirCache[targetPath]
        if (cached) setEntries(cached)
        setBusy(true)
        try {
          const payload = await api('/list', { root: stateRef.current.root, path: targetPath, rev: stateRef.current.rev })
          setDirCache((prev) => ({ ...prev, [targetPath]: payload.entries }))
          if (navRef.current === targetPath) setEntries(payload.entries)
          setError(null)
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy(false)
        }
      }, [])

      // 0.3.25：最近访问事实源＝localStorage，只记打开过的文件（上限 12、root+path 去重、淘汰最旧）。
      const pushRecent = useCallback((targetRoot, targetPath) => {
        if (!targetRoot || !targetPath) return
        try {
          const list = (JSON.parse(localStorage.getItem(STORAGE_RECENT) ?? '[]') ?? []).filter((it) => it && it.kind === 'file')
          const next = [{ root: targetRoot, path: targetPath, at: Date.now(), kind: 'file' }, ...list.filter((it) => !(it.root === targetRoot && it.path === targetPath))].slice(0, RECENT_MAX)
          localStorage.setItem(STORAGE_RECENT, JSON.stringify(next))
          setRecent(next)
        } catch { /* ignore */ }
      }, [])
      const clearRecent = useCallback(() => {
        const currentRoot = stateRef.current.root
        setRecent((prev) => {
          const next = prev.filter((it) => it.root !== currentRoot)
          try { localStorage.setItem(STORAGE_RECENT, JSON.stringify(next)) } catch { /* ignore */ }
          return next
        })
      }, [])
      const collapseAll = useCallback(() => {
        setExpanded({})
        if (treeScrollRef.current) treeScrollRef.current.scrollTop = 0
      }, [])

      const copyText = async (text) => {
        try {
          await navigator.clipboard.writeText(text)
          return true
        } catch {
          try {
            const area = document.createElement('textarea')
            area.value = text
            area.style.position = 'fixed'
            area.style.opacity = '0'
            document.body.appendChild(area)
            area.select()
            const ok = document.execCommand('copy')
            area.remove()
            return !!ok
          } catch {
            return false
          }
        }
      }

      const copyPath = useCallback(async (which) => {
        const current = stateRef.current
        if (!current.root) return
        if (which === 'rel') {
          const target = current.selected || current.currentPath || ''
          const ok = await copyText(target)
          setCopied({ key: 'rel', ok })
          setAnnounce(ok ? '已复制相对路径' : '复制失败')
          clearTimeout(copiedTimer.current)
          copiedTimer.current = setTimeout(() => setCopied(null), 1500)
          return
        }
        const rel = which === 'file' ? current.selected : current.currentPath
        if (which === 'file' && !current.selected) return
        const full = `${String(current.root).replace(/\/+$/, '')}${rel ? `/${rel}` : ''}`
        const ok = await copyText(full)
        setCopied({ key: which, ok })
        setAnnounce(ok ? `已复制${which === 'file' ? '文件' : '目录'}路径` : '复制失败')
        clearTimeout(copiedTimer.current)
        copiedTimer.current = setTimeout(() => setCopied(null), 1500)
      }, [])

      const persistTreeWidth = (value) => {
        try { localStorage.setItem(STORAGE_TREE_WIDTH, String(value)) } catch { /* ignore */ }
      }

      const onSplitDown = (event) => {
        event.preventDefault()
        const startX = event.clientX
        const startWidth = treeWidth
        setDragging(true)
        let last = startWidth
        const move = (moveEvent) => {
          last = Math.min(maxTreeWidth(), Math.max(TREE_WIDTH_MIN, startWidth + (moveEvent.clientX - startX)))
          setTreeWidth(last)
        }
        const up = () => {
          document.removeEventListener('mousemove', move)
          document.removeEventListener('mouseup', up)
          setDragging(false)
          persistTreeWidth(last)
        }
        document.addEventListener('mousemove', move)
        document.addEventListener('mouseup', up)
      }

      const fileUrls = (root, targetPath, targetRev) => {
        const revPart = targetRev ? `&rev=${targetRev}` : ''
        const base = `/dsh-svn/`
        const query = `root=${encodeURIComponent(root)}&path=${encodeURIComponent(targetPath)}${revPart}`
        return { rawUrl: `${base}raw?${query}`, fileUrl: `${base}file?${query}`, streamUrl: `${base}stream?${query}` }
      }

      const [pending, setPending] = useState(null)
      const openCtrl = useRef(null)
      const openFile = useCallback(async (targetPath, targetRev, meta = {}) => {
        const current = stateRef.current
        if (!current.root) return
        setSelected(targetPath)
        setBusy(true)
        setError(null)
        setDiff(null)
        setDiffError(null)
        setBlame(null)
        // 目录行/树节点/搜索命中都带着 rev/author/date，文件头第二行直接用它，不再多打一次 /list。
        const entry = meta.entry ?? null
        setFileMeta(entry ? {
          rev: targetRev ?? entry.rev ?? null,
          author: entry.author || '',
          date: entry.date || '',
        } : (targetRev ? { rev: targetRev, author: '', date: '' } : null))
        const controller = new AbortController()
        openCtrl.current = controller
        const size = meta.size ?? null
        // Loading overview while the host reads/extracts: card instead of a bare top bar.
        if (size !== null && size >= CACHE_GATE_BYTES) {
          setPending({ name: targetPath.split('/').pop() ?? targetPath, size, rev: targetRev ?? current.rev, path: targetPath })
        }
        const payloadKey = `${current.root}|${targetPath}|${targetRev ?? current.rev ?? ''}`
        try {
          let next = null
          if (!meta.skipCache) {
            const hit = await payloadCacheGet(payloadKey)
            if (hit && !controller.signal.aborted) next = { ...hit.value, fromCache: hit.from }
          }
          if (!next) {
            const payload = await api('/file', { root: current.root, path: targetPath, rev: targetRev ?? current.rev })
            if (controller.signal.aborted) return
            Object.assign(payload, fileUrls(current.root, targetPath, targetRev ?? current.rev ?? null))
            next = payload
            if (payload.view === 'office') {
              try {
                const enriched = await officePreviewFallback(payload, current.root, targetRev ?? current.rev)
                if (enriched && !controller.signal.aborted) next = enriched
              } catch { /* keep the plain office view */ }
            }
            payloadCachePut(payloadKey, next)
          }
          if (meta.skipCache) next.skipCache = true
          setFile(next)
          setTab('content')
          pushRecent(current.root, targetPath)
          setDiff(null)
          setBlame(null)
          const history = await api('/log', { root: current.root, path: targetPath, limit: 30 })
          if (!controller.signal.aborted) {
            setLog(history)
            // 0.3.16 元数据单一事实源：点击路径/搜索命中没带作者/日期时回退 log（与右栏同源），避免文件头「—」与 rail 同屏矛盾。
            setFileMeta((prev) => {
              if (prev && (prev.author || prev.date)) return prev
              const entries = history.entries ?? []
              const want = targetRev ?? current.rev
              const hit = entries.find((x) => String(x.rev) === String(want)) ?? entries[0]
              return hit ? { rev: hit.rev ?? want ?? null, author: hit.author || '', date: hit.date || '' } : prev
            })
          }
        } catch (err) {
          if (!controller.signal.aborted) setErr(err.message)
        } finally {
          if (openCtrl.current === controller) {
            setBusy(false)
            setPending(null)
          }
        }
      }, [])
      // 0.3.25：点最近条＝展开祖先链后 openFile 直达预览（最近只记文件）。
      const openRecent = useCallback((targetPath) => {
        const segs = String(targetPath).split('/')
        setExpanded((prev) => {
          const next = { ...prev }
          let acc = ''
          for (const s of segs) { acc = acc ? `${acc}/${s}` : s; next[acc] = true }
          return next
        })
        openFile(targetPath)
      }, [openFile])
      const cancelPending = useCallback(() => {
        try { openCtrl.current?.abort() } catch { /* ignore */ }
        setPending(null)
        setBusy(false)
      }, [])
      const reloadFile = useCallback(() => {
        const current = stateRef.current
        if (!current.selected) return
        openFile(current.selected, current.rev, { skipCache: true, size: current.file?.size ?? null })
      }, [openFile])

      // First run: restore the last root (and the snapshot UI state), otherwise fall back to the process cwd.
      // Placed after openFile so the dependency array does not hit its temporal dead zone.
      useEffect(() => {
        const boot = async (target) => {
          await connect(target, { restore: true })
          if (uiSnapshot.currentPath) loadDir(uiSnapshot.currentPath)
          if (uiSnapshot.selected && uiSnapshot.selected !== uiSnapshot.currentPath && !uiSnapshot.file) openFile(uiSnapshot.selected, null)
        }
        const saved = lsGet(STORAGE_ROOT)
        if (saved) { boot(saved); return }
        if (DEFAULT_ROOT) { setRootInput(DEFAULT_ROOT); boot(DEFAULT_ROOT); return }
        api('/context').then((payload) => {
          const repos = payload.repos ?? []
          if (repos.length === 1) { setRootInput(repos[0].path); boot(repos[0].path); return }
          if (repos.length > 1) { setRootInput(repos[0].path); setDiscovered(repos); return }
          if (payload.cwd) setRootInput(payload.cwd)
        }).catch(() => {})
      }, [connect, loadDir, openFile])

      const openRev = useCallback(async (targetRev) => {
        const current = stateRef.current
        if (!current.selected) return
        setRev(targetRev)
        setDiff(null)
        setDiffError(null)
        setBlame(null)
        try {
          const payload = await api('/file', { root: current.root, path: current.selected, rev: targetRev })
          Object.assign(payload, fileUrls(current.root, current.selected, targetRev))
          let next = payload
          if (payload.view === 'office') {
            try {
              const enriched = await officePreviewFallback(payload, current.root, targetRev)
              if (enriched) next = enriched
            } catch { /* keep the plain office view */ }
          }
          setFile(next)
          setTab('content')
          const entry = (stateRef.current.log?.entries ?? []).find((x) => String(x.rev) === String(targetRev))
          setFileMeta(entry ? { rev: entry.rev, author: entry.author || '', date: entry.date || '' } : { rev: targetRev, author: '', date: '' })
        } catch (err) {
          setErr(err.message)
        }
      }, [])

      const showDiff = useCallback(async () => {
        const current = stateRef.current
        if (!current.selected) return
        setTab('diff')
        setDiff(null)
        setDiffError(null)
        try {
          const payload = await api('/diff', { root: current.root, path: current.selected, rev: current.rev ?? undefined })
          setDiff(payload)
        } catch (err) {
          setDiffError(err.message)
        }
      }, [])

      // 索引只存路径：命中后按父目录补一次 /list（并发 6，最多 24 个目录），把大小/修订/作者/时间填回结果行
      const enrichHits = useCallback(async (hits, token) => {
        const current = stateRef.current
        if (!current.root || !hits.length) return hits
        const dirs = [...new Set(hits.map((hit) => hit.path.split('/').slice(0, -1).join('/')))]
        const targets = dirs.slice(0, 24)
        const maps = new Map()
        for (let i = 0; i < targets.length; i += 6) {
          const batch = targets.slice(i, i + 6)
          const loaded = await Promise.all(batch.map(async (dir) => {
            const cached = stateRef.current.dirCache[dir]
            if (cached) return [dir, cached]
            try {
              const payload = await api('/list', { root: current.root, path: dir || undefined, rev: stateRef.current.rev })
              return [dir, payload.entries ?? []]
            } catch {
              return [dir, []]
            }
          }))
          for (const [dir, entries] of loaded) maps.set(dir, new Map((entries ?? []).map((entry) => [entry.name, entry])))
        }
        if (token && token.aborted) return hits
        return hits.map((hit) => {
          if (hit.size || hit.rev || hit.date) return hit
          const dir = hit.path.split('/').slice(0, -1).join('/')
          const found = maps.get(dir)?.get(hit.name)
          if (!found) return hit
          return { ...hit, size: found.size ?? 0, rev: found.rev ?? null, author: found.author ?? null, date: found.date ?? null, kind: found.kind ?? hit.kind }
        })
      }, [])

      const runSearch = useCallback(async (options = {}) => {
        const current = stateRef.current
        const value = query.trim()
        if (!options.keepTimer && searchPollRef.current) { clearTimeout(searchPollRef.current); searchPollRef.current = null }
        if (!current.root || !value) { setSearch(null); return }
        const scoped = searchScope === 'dir' && !!current.currentPath
        if (!options.keepTimer) { setSearchVisible(100); setSearchReturn(null) }
        setBusy(true)
        setSearching(true)
        try {
          let payload = await api('/search', { root: current.root, q: value, mode: searchMode, limit: 200, path: scoped ? current.currentPath : undefined })
          if (searchMode === 'name' && payload.deep === undefined) {
            // Older hosts return files only and no deep flag: merge directory hits so folder search works.
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), current.currentPath ? 15000 : 6000)
            try {
              const tree = await api('/tree', { root: current.root, path: current.currentPath || undefined }, { signal: controller.signal })
              const terms = value.toLowerCase().split(/\s+/).filter(Boolean)
              const known = new Set(payload.files.map((hit) => hit.path))
              const dirs = (tree.entries ?? [])
                .filter((entry) => entry.kind === 'dir' && terms.every((term) => entry.name.toLowerCase().includes(term)))
                .slice(0, 40)
                .filter((entry) => !known.has(entry.name))
                .map((entry) => ({ path: entry.name, name: entry.name.split('/').pop(), kind: 'dir', size: 0, rev: entry.rev, author: entry.author, date: entry.date, count: 1 }))
              if (dirs.length) {
                const merged = [...dirs, ...payload.files]
                payload = { ...payload, files: merged, total: merged.length }
              }
            } catch {
              payload = { ...payload, note: '目录检索未完成（宿主版本较旧）；重启 dsh web 后支持全仓库搜索' }
            } finally {
              clearTimeout(timer)
            }
          }
          setSearch(payload)
          setError(null)
          setIndexInfo({ indexed: !!payload.indexed, indexing: !!payload.indexing, entries: payload.indexedEntries ?? null })
          if (payload.indexing) {
            searchPollRef.current = setTimeout(() => { runSearchRef.current?.({ keepTimer: true }) }, 1600)
          } else if (payload.indexed && payload.files?.length) {
            // 先出行，再把大小/修订/时间补进来（索引只有路径）
            const token = { aborted: false }
            const currentToken = searchTokenRef.current = token
            enrichHits(payload.files, token).then((files) => {
              if (currentToken.aborted || searchTokenRef.current !== token) return
              setSearch((prev) => (prev && !prev.indexing ? { ...prev, files } : prev))
            }).catch(() => {})
          }
        } catch (err) {
          setErr(err.message)
          setSearch(null)
        } finally {
          setBusy(false)
          setSearching(false)
        }
      }, [query, searchMode, searchScope])
      runSearchRef.current = runSearch

      const showBlame = useCallback(async () => {
        const current = stateRef.current
        if (!current.selected) return
        setBlame(null)
        try {
          const payload = await api('/blame', { root: current.root, path: current.selected, rev: current.rev ?? undefined })
          setBlame(payload)
        } catch (err) {
          setErr(err.message)
        }
      }, [])

      const selectTab = (key) => {
        setTab(key)
        if (key === 'diff' && !diff) showDiff()
        if (key === 'blame' && !blame) showBlame()
      }

      const downloadBlob = (blob, fileName) => {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = fileName
        document.body.appendChild(link)
        link.click()
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 5000)
      }

      const exportDir = async () => {
        if (!root || exportProg) return
        const params = new URLSearchParams({ root, path: currentPath || '' })
        if (rev) params.set('rev', String(rev))
        const segment = (currentPath || 'root').split('/').filter(Boolean).pop() ?? 'root'
        const fileName = `${segment}-${rev ? `r${rev}` : 'working'}.zip`
        const controller = new AbortController()
        exportCtrl.current = controller
        setExportProg({ received: 0, total: 0 })
        setBusy(true)
        setError(null)
        try {
          const response = await fetch(`/dsh-svn/export?${params.toString()}`, { signal: controller.signal })
          if (response.ok) {
            const total = Number(response.headers.get('content-length')) || 0
            let blob
            if (response.body && response.body.getReader) {
              const reader = response.body.getReader()
              const chunks = []
              let received = 0
              for (;;) {
                const { done, value } = await reader.read()
                if (done) break
                chunks.push(value)
                received += value.length
                setExportProg({ received, total })
              }
              blob = new Blob(chunks)
            } else {
              blob = await response.blob()
            }
            downloadBlob(blob, fileName)
            pushToast({ kind: 'ok', msg: '导出完成', sub: fileName })
            setAnnounce(`导出完成 ${fileName}`)
            return
          }
          if (response.status !== 404) {
            let detail = `HTTP ${response.status}`
            try {
              const body = await response.json()
              detail = body.detail || body.error || detail
            } catch { /* keep the status text */ }
            pushToast({ kind: 'fail', msg: '导出失败', sub: plainError(detail), retry: exportDir })
            setAnnounce(`导出失败：${detail}`)
            return
          }
          // No /export route (older host): zip in the browser instead.
          const blob = await exportInBrowser(root, currentPath || '', rev, (n) => setExportProg({ received: n, total: 0, files: true }))
          downloadBlob(blob, fileName)
          pushToast({ kind: 'ok', msg: '已用浏览器端导出', sub: '每次最多 300 个文件 / 60 MB' })
          setAnnounce('已用浏览器端导出')
        } catch (error) {
          if (controller.signal.aborted) {
            pushToast({ kind: 'ok', msg: '已取消导出' })
            setAnnounce('已取消导出')
          } else {
            const detail = String(error?.message ?? error)
            pushToast({ kind: 'fail', msg: '导出失败', sub: plainError(detail), retry: exportDir })
            setAnnounce(`导出失败：${detail}`)
          }
        } finally {
          setExportProg(null)
          exportCtrl.current = null
          setBusy(false)
        }
      }

      const download = async () => {
        const f = file
        if (!f) return
        setDlState('working')
        try {
          await triggerFileDownload(f)
          setDlState('done')
          setAnnounce('下载完成')
        } catch (error) {
          setDlState('fail')
          const detail = String(error?.message ?? error)
          pushToast({ kind: 'fail', msg: '下载失败', sub: `${plainError(detail)}；已尝试在新标签打开原始文件`, retry: download })
          setAnnounce(`下载失败：${detail}`)
          try { window.open(f.rawUrl, '_blank') } catch { /* ignore */ }
        }
        clearTimeout(dlTimer.current)
        dlTimer.current = setTimeout(() => setDlState('idle'), 1600)
      }

      const rootEntries = dirCache[''] ?? []
      const currentEntries = search ? [] : (dirCache[currentPath] ?? entries)
      const sorted = [...currentEntries].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
      const isConnected = !!root

      const dirRows = sorted.map((entry) => {
        const relative = currentPath ? `${currentPath}/${entry.name}` : entry.name
        const status = entry.status ?? statusMap[relative]
        const meta = [entry.rev ? `r${entry.rev}` : null, entry.author || null, fmtDate(entry.date) || null].filter(Boolean).join(' · ') || '—'
        return e('div', {
          key: entry.name,
          className: `svn-tr${selected === relative ? ' sel' : ''}`,
          onClick: () => (entry.kind === 'dir' ? openDir(relative) : openFile(relative, null, { size: entry.size ?? null, entry })),
          role: 'button', tabIndex: 0, 'aria-label': `${entry.name}${entry.kind === 'dir' ? '，目录' : '，文件'}`,
          onKeyDown: rowKey(() => (entry.kind === 'dir' ? openDir(relative) : openFile(relative, null, { size: entry.size ?? null, entry }))),
        },
        e('div', { className: 'nm' },
          e(TypeIcon, { name: entry.name, dir: entry.kind === 'dir' }),
          e('div', null,
            e('div', { className: 't' }, entry.name),
            e('div', { className: 's' }, meta),
          ),
        ),
        e('span', { className: 'c' }, entry.kind === 'dir' ? '—' : fmtSize(entry.size)),
        e(StatusDot, { status }),
        )
      })

      const emptyDir = e('div', { className: 'svn-empty' },
        e('div', { className: 'svn-logo' }, 'SVN'),
        e('div', null, isConnected ? '目录为空' : '连接一个工作副本或仓库开始浏览'),
        e('div', { className: 'svn-note' }, isConnected ? '' : '支持本地工作副本路径与 svn:// 地址'),
        !isConnected && discovered.length ? e('div', { style: { marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' } },
          e('div', { className: 'svn-note' }, '发现的工作副本'),
          e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center' } },
            discovered.map((repo) => e('button', {
              key: repo.path, className: 'svn-btn', title: repo.url,
              onClick: () => { setRootInput(repo.path); connect(repo.path) },
            }, repo.path.replace(/^.*[\\/]/, '')))),
        ) : null,
      )

      const dirPanel = e('div', { className: 'svn-table' },
        e('div', { className: 'svn-th' },
          e('span', null, '名称'), e('span', null, '大小'), e('span', null, '')),
        e('div', { className: 'svn-scroll' }, sorted.length ? dirRows : emptyDir),
      )

      const shownHits = (search ? search.files : []).slice(0, searchVisible)
      const hiddenHits = Math.max(0, (search ? search.files.length : 0) - shownHits.length)
      const searchRows = shownHits.map((hit) => {
        const isDir = hit.kind === 'dir'
        return e('div', {
          key: hit.path,
          className: 'svn-hit',
          role: 'button', tabIndex: 0, 'aria-label': hit.path,
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.click(); return }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const els = [...event.currentTarget.parentElement.querySelectorAll('.svn-hit')]
              const i = els.indexOf(event.currentTarget)
              const next = els[i + (event.key === 'ArrowDown' ? 1 : -1)]
              if (next) next.focus()
            }
          },
          onClick: () => {
            setSearch(null)
            if (isDir) {
              setSearchReturn(null)
              openDir(hit.path)
            } else {
              setSearchReturn(search)
              openFile(hit.path, null, { size: hit.size || null, entry: hit })
            }
          },
        },
        e('div', { className: 'h1' },
          e(TypeIcon, { name: hit.name, dir: isDir }),
          e('div', { className: 'p' }, hit.path),
          e('span', { className: 'cnt' }, isDir ? '目录' : (hit.size ? fmtSize(hit.size) : '—')),
        ),
        hit.matches && hit.matches.length
          ? e('div', { className: 'snip' }, hit.matches.slice(0, 2).map((match, index) => e('span', { key: index }, `${index ? '   ' : ''}${match.line}: ${match.text}`)))
          : e('div', { className: 'snip' }, isDir
            ? '进入该目录'
            : e('span', { className: 'meta' },
              hit.author ? e('b', null, hit.author) : null,
              hit.author && (hit.rev || hit.date) ? e('span', { className: 'dot' }, '·') : null,
              hit.rev ? e('span', null, `r${hit.rev}`) : null,
              hit.rev && hit.date ? e('span', { className: 'dot' }, '·') : null,
              hit.date ? e('span', null, fmtDate(hit.date)) : null,
              !hit.author && !hit.rev && !hit.date ? e('span', null, `${hit.path.split('/').slice(0, -1).join(' / ') || '根目录'}`) : null)),
        )
      })

      const cancelSearch = () => {
        if (searchPollRef.current) { clearTimeout(searchPollRef.current); searchPollRef.current = null }
        const current = stateRef.current
        setSearch(null)
        if (current.root) api('/search', { root: current.root, q: query.trim() || '-', mode: 'name', cancel: 1 }).catch(() => {})
      }
      const searchPanel = !search ? null : e('div', { className: 'svn-table' },
        e('div', { className: 'svn-split' },
          e('span', null, search.indexing
            ? `建立文件名索引 · 已扫描 ${fmtCount(search.scanned)} 项`
            : `命中 ${search.files.length} 项（${search.mode === 'content' ? '全文' : '文件名'}）`),
          e('span', { className: 'svn-seg', role: 'group', 'aria-label': '搜索范围' },
            e('button', {
              className: searchScope === 'repo' ? 'on' : '',
              onClick: () => { setSearchScope('repo'); setTimeout(() => runSearchRef.current?.(), 0) },
            }, kind === 'wc' ? '全副本' : '全仓'),
            e('button', {
              className: searchScope === 'dir' ? 'on' : '', disabled: !currentPath,
              title: currentPath ? `只搜 ${currentPath} 及其子目录` : '进入某个目录后可用',
              onClick: () => { setSearchScope('dir'); setTimeout(() => runSearchRef.current?.(), 0) },
            }, '当前目录')),
          !search.indexing && search.indexedEntries
            ? e('span', { className: 'svn-note', title: '索引覆盖的路径条数' }, `索引 ${fmtCount(search.indexedEntries)} 项`)
            : null,
          search.truncated ? e('span', { className: 'svn-chip', title: '仓库条目过多，结果可能不完整' }, '结果可能不完整') : null,
          search.note ? e('span', { className: 'svn-chip', title: search.note }, '目录检索未完成') : null,
          !search.indexing && search.elapsedMs ? e('span', { className: 'svn-note' }, `${search.elapsedMs} ms`) : null,
          e('span', { style: { flex: 1 } }),
          search.indexing
            ? null
            : e('button', { className: 'svn-btn act', onClick: () => { setSearch(null); setQuery('') } }, '清除'),
        ),
        search.indexing ? e('div', { className: 'svn-idxcard' },
          e('div', { className: 'r1' },
            e('b', null, '正在建立文件名索引'),
            e('span', { className: 'svn-note' }, `已扫描 ${fmtCount(search.scanned)} 项`),
            e('span', { className: 'sp' }),
            e('button', { className: 'svn-btn', onClick: cancelSearch }, '取消')),
          e('div', { className: 'track indet' }, e('i')),
          e('div', { className: 'note' }, '远程仓库要把全部路径遍历一遍（大仓库约需 1 分钟）；建好后每次搜索只需几秒。等不及可切「当前目录」范围，秒出。')) : null,
        e('div', { className: 'svn-scroll' },
          search.indexing
            ? e('div', { className: 'svn-empty' },
              e('div', null, '索引建好后结果会自动出现'),
              e('div', { className: 'svn-note' }, '索引按 revision 缓存在本机，下次搜索不再等待'))
            : (search.files.length
              ? e(React.Fragment, null, searchRows,
                hiddenHits > 0
                  ? e('div', { className: 'loadmore' },
                    e('button', {
                      className: 'svn-btn', onClick: () => setSearchVisible((prev) => prev + 50),
                    }, `加载更多（${Math.min(50, hiddenHits)} 项）`),
                    e('span', { className: 'svn-note' }, `已显示 ${shownHits.length} / ${fmtCount(search.files.length)}`))
                  : (search.total > search.files.length
                    ? e('div', { className: 'loadmore' },
                      e('span', { className: 'svn-note' }, `共匹配 ${fmtCount(search.total)} 项，最多显示前 ${fmtCount(search.files.length)} 项；缩小关键词更精确`))
                    : null))
              : e('div', { className: 'svn-empty' },
                e('div', null, '没有命中'),
                e('div', { className: 'svn-note' }, search.mode === 'content'
                  ? '全文只搜文本与 Office 正文（txt / md / json / csv / log 及常见代码后缀，加 docx / xlsx / pptx）；PDF、图片、压缩包不参与，请用「文件名」模式找它们'
                  : (search.scope ? `只搜了当前目录（${search.scope}）的 ${fmtCount(search.scanned)} 项` : '试试更短的关键词')),
                search.scope && search.mode === 'name'
                  ? e('button', {
                    className: 'svn-btn act', style: { marginTop: '10px' },
                    onClick: () => { setSearchScope('repo'); setTimeout(() => runSearchRef.current?.(), 0) },
                  }, '在整个仓库中搜索')
                  : null))),
      )

      const previewPanel = selected && file ? e(Preview, {
        file, tab, meta: fileMeta, log, diff, diffError, blame, rev,
        onTab: selectTab,
        onOpenRev: openRev,
        onOpenDir: openDir,
        railOpen, onToggleRail: () => setRailOpen((v) => !v),
        onDownload: download,
        onCopy: copyPath,
        copied,
        onClose: () => {
          setFile(null)
          if (searchReturn) {
            const restore = searchReturn
            setSearchReturn(null)
            setSearch(restore)
          }
        },
        onReloadFile: reloadFile,
        dlState,
        onRetryDiff: showDiff,
      }) : null

      // 主机侧读取中：同样的两行身份 + 骨架，进度与取消都在文件头/骨架里。
      const pendingPanel = pending ? e('div', { className: 'svn-preview' },
        e('div', { className: 'svn-fhd' },
          e(TypeIcon, { name: pending.name, size: 22 }),
          e('div', { className: 'fid' },
            e('b', null, pending.name),
            e('small', null,
              e('span', { className: 'path' }, String(pending.path ?? '').split('/').slice(0, -1).join(' / ') || '根目录'),
              e('span', { className: 'sep' }, '·'),
              e('span', null, fmtSize(pending.size)),
              pending.rev ? e(React.Fragment, null, e('span', { className: 'sep' }, '·'), e('span', null, `r${pending.rev}`)) : null)),
          e('div', { className: 'svn-fa' },
            e('button', { className: 'svn-btn', onClick: cancelPending, title: '取消本次读取' }, '取消'))),
        e('div', { className: 'svn-pv-body' },
          e(LoadState, {
            file: { name: pending.name, size: pending.size, rev: pending.rev, rawUrl: '' },
            state: { phase: 'loading', received: 0, total: 0, rate: 0 },
            capBytes: 0,
            indeterminate: true,
            note: '主机读取中…（文本提取与编码在服务端完成）',
            onCancel: cancelPending,
          }))) : null

      const showConnect = !isConnected || String(rootInput ?? '').trim() !== String(root ?? '').trim()
      const showCrumb = !file && !pending && !search
      const joinPathText = (base, name) => (base ? `${base.replace(/[\\/]+$/, '')}\\${name}` : name)
      const pickerModal = !picker ? null : e('div', { className: 'svn-picker-overlay', onClick: closePicker },
        e('div', { className: 'svn-picker', onClick: (event) => event.stopPropagation() },
          e('div', { className: 'svn-picker-hd' },
            e('b', null, '选择本地工作副本目录'),
            e('span', { className: 'svn-note' }, picker.mode === 'drives' ? '先选一个磁盘，再逐层进入' : '选到工作副本根目录（含 .svn 的那一层）')),
          e('div', { className: 'svn-picker-path' },
            e('button', {
              className: 'svn-btn', disabled: picker.loading || picker.mode === 'drives',
              onClick: () => openPicker(picker.parent ?? ''),
            }, '上一级'),
            e('span', { className: 'p', title: picker.path }, picker.path || '此电脑')),
          e('div', { className: 'svn-picker-list' },
            picker.loading
              ? e('div', { className: 'svn-note', style: { padding: '10px' } }, '读取中…')
              : picker.error
                ? e('div', { className: 'svn-err', style: { margin: '8px 10px' } }, picker.error)
                : picker.entries.length
                  ? picker.entries.map((entry) => e('button', {
                    key: entry.path ?? entry.name, className: 'svn-picker-item', title: entry.path ?? entry.name,
                    onClick: () => openPicker(entry.path ?? joinPathText(picker.path, entry.name)),
                  }, e('span', { className: 'ico' }), e('span', { className: 'nm' }, entry.name)))
                  : e('div', { className: 'svn-note', style: { padding: '10px' } }, '没有子目录')),
          e('div', { className: 'svn-picker-ft' },
            e('button', { className: 'svn-btn', onClick: closePicker }, '取消'),
            e('button', {
              className: 'svn-btn primary', disabled: picker.loading || picker.mode === 'drives' || !picker.path,
              onClick: () => {
                const target = picker.path
                closePicker()
                setRootInput(target)
                connect(target)
              },
            }, '连接此目录'))),
      )
      const content = search ? searchPanel : (previewPanel ?? pendingPanel ?? dirPanel)

      // 0.3.20 V4：面板树与浮层树共用同一批构件（同一时刻只渲染其一）。
      const recentForRoot = recent.filter((it) => it.root === root)
      const filterBox = e('div', { className: 'svn-treefilter' },
        e('span', { className: 'mag' }, e('svg', { viewBox: '0 0 24 24', width: 12, height: 12, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }, e('circle', { cx: 11, cy: 11, r: 6.5 }), e('path', { d: 'M16 16l4.5 4.5' }))),
        e('input', {
          value: treeFilter, spellCheck: false, placeholder: '过滤目录与文件',
          title: '只过滤左栏已加载的目录与文件，不发请求；Esc 清空',
          onChange: (event) => setTreeFilter(event.target.value),
          onKeyDown: (event) => { if (event.key === 'Escape') setTreeFilter('') },
        }),
      )
      const treeCount = e('span', { className: `svn-treecount${treeMatch ? ' svn-treehit' : ''}` }, treeMatch ? `${treeMatch.count}` : String(rootEntries.length))
      const collapseAllBtn = e('button', {
        className: 'svn-ibtn', style: { width: '24px', height: '24px' }, title: '全部收起', 'aria-label': '全部收起',
        onClick: collapseAll,
      }, e('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }, e('path', { d: 'M8 14l4-4 4 4' }), e('path', { d: 'M8 20l4-4 4 4' })))
      const treePanel = e('div', { className: 'svn-scroll', ref: treeScrollRef, role: 'tree', 'aria-label': '目录树' },
        !isConnected ? e('div', { className: 'svn-note', style: { padding: '12px' } }, '未连接仓库') : null,
        isConnected && rootEntries.length ? rootEntries.map((entry) => e(TreeNode, {
          key: entry.name, node: entry, depth: 0, state: treeState,
          onOpenDir: pickDir, onOpenFile: openFile, onToggleDir: toggleDir, onKeyNav: onTreeKey, pathPrefix: '',
        })) : null,
        isConnected && !rootEntries.length && !busy ? e('div', { className: 'svn-note', style: { padding: '12px' } }, '目录为空') : null,
      )
      const recentRow = (it) => e('button', {
        key: `${it.root}|${it.path}`, className: 'svn-recent-row', title: it.path,
        onClick: () => openRecent(it.path),
      }, e(TypeIcon, { name: it.path.split('/').pop(), dir: false }),
        e('span', { className: 'nm' }, it.path),
        e('span', { className: 'tm' }, fmtRel(it.at)))
      const recentClearBtn = recentForRoot.length
        ? e('button', { className: 'svn-sec-clear', title: '清空当前仓库的最近访问', 'aria-label': '清空最近访问', onClick: clearRecent }, '清空')
        : null
      const secChev = () => e('svg', { className: 'chev', viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true }, e('path', { d: 'M6 9l6 6 6-6', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }))
      const recentSection = e(React.Fragment, null,
        e('div', { className: 'svn-sec-hd' },
          e('button', {
            type: 'button', className: 'svn-sec-toggle', 'aria-expanded': secsOpen.recent, 'aria-controls': 'svn-sec-recent',
            onClick: () => toggleSec('recent'),
          }, secChev(), e('b', null, '最近'), e('span', { className: 'cnt' }, String(recentForRoot.length))),
          recentClearBtn),
        e('div', { id: 'svn-sec-recent', className: 'svn-sec-recent', hidden: !secsOpen.recent },
          recentForRoot.length
            ? recentForRoot.map(recentRow)
            : e('div', { className: 'svn-note svn-recent-empty' }, '暂无最近文件，预览文件后自动记录')),
      )
      const dockRail = e('nav', { className: 'svn-dockrail', ref: railRef, 'aria-label': '目录栏（收起态）' },
        e('button', {
          type: 'button', ref: railTreeBtnRef, 'aria-expanded': flyout === 'tree',
          title: '目录：展开浮层树', 'aria-label': '目录：展开浮层树',
          onClick: () => { closeFly(); setDockCollapsed(false) },
          onPointerEnter: () => hoverOpen('tree'), onPointerLeave: scheduleHoverClose,
        }, ICON_PANEL, e('span', null, '目录')),
        e('button', {
          type: 'button', ref: railRecentBtnRef, 'aria-expanded': flyout === 'recent',
          title: '最近：展开最近访问浮层', 'aria-label': '最近：展开最近访问浮层',
          onClick: () => { closeFly(); setDockCollapsed(false) },
          onPointerEnter: () => hoverOpen('recent'), onPointerLeave: scheduleHoverClose,
        }, ICON_CLOCK, e('span', null, '最近')),
      )
      const flyoutPanel = dockCollapsed && flyout ? e(React.Fragment, null,
        e('div', { style: { position: 'fixed', top: 0, bottom: 0, right: 0, left: Math.max(0, flyPos.left - 6), zIndex: 49 }, onClick: closeFly }),
        e('div', {
          ref: flyRef, className: 'svn-flyout', role: 'dialog',
          'aria-label': flyout === 'tree' ? '目录浮层树' : '最近访问浮层',
          style: { left: flyPos.left, top: flyPos.top, maxHeight: flyPos.maxHeight },
          onPointerEnter: () => clearTimeout(hoverTimers.current.close),
          onPointerLeave: scheduleHoverClose,
        },
        e('div', { className: 'svn-flyout-hd' },
          e('b', null, flyout === 'tree' ? '目录' : '最近访问'),
          e('span', { className: 'cnt' }, flyout === 'tree' ? String(rootEntries.length) : String(recentForRoot.length)),
          e('span', { className: 'sp' }),
          flyout === 'tree' ? e('button', {
            className: 'svn-ibtn neutral', title: '展开为固定面板', 'aria-label': '展开为固定面板',
            onClick: () => { closeFly(); setDockCollapsed(false) },
          }, ICON_SIDEBAR_OPEN) : null,
          e('button', {
            className: 'svn-ibtn neutral', title: '关闭浮层', 'aria-label': '关闭浮层',
            onClick: () => { const btn = flyout === 'recent' ? railRecentBtnRef.current : railTreeBtnRef.current; closeFly(); if (btn) btn.focus() },
          }, ICON_CLOSE),
        ),
        flyout === 'tree'
          ? e(React.Fragment, null, e('div', { className: 'svn-treehd' }, filterBox, treeCount, collapseAllBtn), treePanel)
          : e('div', { className: 'svn-scroll', style: { padding: '4px 0 8px' } },
            e('div', { className: 'svn-sec-hd' }, e('b', null, '最近'), e('span', { className: 'cnt' }, String(recentForRoot.length)), recentClearBtn),
            recentForRoot.length ? recentForRoot.map(recentRow) : e('div', { className: 'svn-note svn-recent-empty' }, '暂无最近文件，预览文件后自动记录')),
        ),
      ) : null

      return e('div', { className: dragging ? 'svn-app drag' : 'svn-app' },
        e(IconSprite),
        busy ? e('div', { className: 'svn-loading' }) : null,
        e('div', { className: 'svn-top' },
          e('div', { className: 'svn-brand' }, 'SVN', e('span', null, '查看器')),
          e('div', { className: 'svn-rootbox', style: { flex: '0 1 360px' } },
            e('div', { className: 'svn-input', style: { flex: 1 } },
              e('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontFamily: 'var(--svn-mono)', fontSize: '12px' } }, '#'),
              e('input', {
                value: rootInput, spellCheck: false, placeholder: '工作副本路径或 svn:// URL',
                onChange: (event) => setRootInput(event.target.value),
                onKeyDown: (event) => { if (event.key === 'Enter') connect(rootInput); if (event.key === 'Escape') setRootsOpen(false) },
              }),
            ),
            e('button', {
              className: 'svn-rootcaret', title: '连接历史与选择', 'aria-label': '连接历史与选择',
              onClick: () => setRootsOpen((prev) => !prev),
            }, ICON_CHEVRON),
            rootsOpen ? e(React.Fragment, null,
              e('div', { style: { position: 'fixed', inset: 0, zIndex: 39 }, onClick: () => setRootsOpen(false) }),
              e('div', { className: 'svn-roots' },
                e('div', { className: 'hd' },
                  e('b', null, '连接历史'),
                  e('span', { className: 'cnt' }, roots.length ? `最近 ${Math.min(roots.length, 12)} 条` : '连接成功后自动记录')),
                roots.length ? roots.map((item) => e('div', {
                  key: item.root, tabIndex: 0,
                  className: `it${item.root === root ? ' cur' : ''}`,
                  title: item.root,
                  onClick: () => { setRootsOpen(false); setRootInput(item.root); connect(item.root) },
                  onKeyDown: (event) => {
                    if (event.key !== 'Enter') return
                    setRootsOpen(false)
                    setRootInput(item.root)
                    connect(item.root)
                  },
                },
                e('span', { className: 'p' }, item.root),
                e('span', { className: 't' }, item.kind === 'wc' ? '工作副本' : 'URL'),
                e('span', { className: 'tm' }, fmtRel(item.at)),
                e('button', {
                  className: 'rm', title: '从历史中移除', tabIndex: -1,
                  onClick: (event) => { event.stopPropagation(); removeRoot(item.root) },
                }, '×'),
                )) : e('div', { className: 'hd' }, '暂无历史，连接成功后自动记录'),
              ),
            ) : null,
          ),
          e('button', {
            className: 'svn-ibtn', style: { width: '30px', height: '30px' }, title: '选择本地目录（工作副本）',
            'aria-label': '选择本地目录（工作副本）',
            onClick: () => openPicker(kind === 'wc' && root ? root : ''),
          }, ICON_FOLDER),
          // 「连接」只在未连接或地址被改动后出现；已连接且地址未改时不占主按钮位。
          showConnect ? e('button', {
            className: 'svn-btn cta', style: { height: '30px' }, onClick: () => connect(rootInput),
          }, '连接',
          e('span', { className: 'svn-nest' }, e('svg', { viewBox: '0 0 24 24', width: 12, height: 12, fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }, e('path', { d: 'M5 12h12M13 7l5 5-5 5' })))) : null,
          e('div', { className: isConnected ? 'svn-repometa live' : 'svn-repometa', title: '仓库身份与状态' },
            e('i', { className: 'dot' }),
            e('span', null, isConnected ? (kind === 'wc' ? '工作副本' : '远程仓库') : '未连接'),
            isConnected && info ? e('b', null, `r${rev ?? info.revision}`) : null,
            isConnected && sparse ? e('span', { className: 'svn-chip', style: { fontSize: '10px', padding: '1px 7px' } }, '稀疏检出') : null,
          ),
          e('span', { style: { flex: 1 } }),
          e('div', { className: 'svn-search', style: { flex: '0 1 320px', minWidth: '200px' } },
            e('button', {
              className: 'svn-mode',
              title: '切换搜索模式与范围',
              onClick: () => setModeOpen((prev) => !prev),
            }, searchMode === 'content' ? '全文' : (searchScope === 'repo' ? (kind === 'wc' ? '名称·全副本' : '名称·全仓') : '名称'),
            e('span', { style: { display: 'grid', placeItems: 'center', color: 'var(--dsw-alias-label-secondary)' } }, ICON_CHEVRON_S)),
            e('input', {
              ref: searchRef, value: query, spellCheck: false,
              placeholder: searchMode === 'content' ? '搜索文件内容（工作副本）' : (kind === 'url' ? '搜索文件名或目录名' : '搜索文件名或内容'),
              title: '在仓库里搜索（范围与模式由左侧 ▾ 决定）：回车搜索，Esc 清空',
              onChange: (event) => setQuery(event.target.value),
              onKeyDown: (event) => { if (event.key === 'Enter') runSearch(); if (event.key === 'Escape') { setQuery(''); setSearch(null) } },
            }),
            e('kbd', { className: 'svn-kbd' }, 'Ctrl P'),
            modeOpen ? e(React.Fragment, null,
              e('div', { style: { position: 'fixed', inset: 0, zIndex: 59 }, onClick: () => setModeOpen(false) }),
              e('div', { className: 'svn-mode-menu' },
                e('button', {
                  className: searchMode === 'name' && searchScope === 'repo' ? 'on' : '',
                  onClick: () => { setSearchMode('name'); setSearchScope('repo'); setModeOpen(false) },
                }, kind === 'wc' ? '文件名 · 整个工作副本' : '文件名 · 整个仓库', e('small', null, kind === 'wc' ? '本地遍历，秒出' : '首次建立索引（大仓库约 1 分钟）')),
                e('button', {
                  className: searchMode === 'name' && searchScope === 'dir' ? 'on' : '',
                  onClick: () => { setSearchMode('name'); setSearchScope('dir'); setModeOpen(false) },
                }, '文件名 · 当前目录', e('small', null, '含子目录，秒出')),
                e('button', {
                  className: searchMode === 'content' ? 'on' : '', disabled: kind === 'url',
                  title: kind === 'url' ? '全文搜索读的是磁盘上的工作副本；当前连的是远程地址，换成 checkout 目录后可用' : '在本地工作副本里匹配文件内容',
                  onClick: () => { setSearchMode('content'); setSearchScope('dir'); setModeOpen(false) },
                }, '全文', e('small', null, kind === 'url' ? '需本地工作副本' : '匹配文件内容')),
                kind === 'url'
                  ? e(React.Fragment, null,
                    (roots || []).some((item) => item.kind === 'wc')
                      ? e('button', {
                        className: 'svn-mode-switch', title: '切换到本地工作副本并用全文搜索',
                        onClick: () => {
                          const wc = (roots || []).filter((item) => item.kind === 'wc').sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0]
                          if (!wc) return
                          setSearchMode('content')
                          setSearchScope('dir')
                          setModeOpen(false)
                          setRootInput(wc.root)
                          connect(wc.root)
                          setTimeout(() => searchRef.current?.focus(), 150)
                        },
                      }, '全文 · 用本地工作副本', e('small', null, (roots || []).filter((item) => item.kind === 'wc').sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0].root))
                      : null,
                    e('div', { className: 'svn-mode-note' }, '全文搜索读本地工作副本里的文本文件与 Office 正文（文本 ≤ 1 MB、Office ≤ 8 MB，最多 200 个 Office 文件）。远程地址没有本地文件可读，切到工作副本才可用。'))
                  : null,
              ),
            ) : null,
          ),
          e('button', { className: 'svn-btn', style: { height: '30px' }, disabled: searching, onClick: runSearch }, searching ? '搜索中' : '搜索'),
          e('button', {
            className: 'svn-ibtn', disabled: !isConnected, title: '刷新当前目录', 'aria-label': '刷新当前目录',
            onClick: () => { loadDir(currentPath); loadStatus(root, kind) },
          }, e('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }, e('path', { d: 'M19 12a7 7 0 1 1-2.05-4.95' }), e('path', { d: 'M19 4v4h-4' }))),
        ),
        error ? e('div', { className: 'svn-err' }, error) : null,
        e('div', { className: 'svn-body' },
          dockCollapsed ? dockRail : e(React.Fragment, null,
            e('aside', { className: 'svn-tree', style: { flex: `0 0 ${treeWidth}px` } },
            e('div', { className: 'svn-treehd' },
              filterBox, treeCount,
              e('button', {
                className: 'svn-ibtn', style: { width: '24px', height: '24px' }, title: '收起目录栏', 'aria-label': '收起目录栏', 'aria-expanded': true,
                onClick: () => { closeFly(); setDockCollapsed(true) },
              }, ICON_SIDEBAR_CLOSE),
            ),
            kind === 'wc' && isConnected ? (legendOpen ? e('div', { className: 'svn-legend' },
              e('div', { className: 'l1' },
                [['word', '文档'], ['excel', '表格'], ['pdf', 'PDF'], ['image', '图片'], ['archive', '压缩包']].map(([k, label]) => e('span', { className: 'it', key: k },
                  e('i', { className: 'sw', style: { background: `var(--svn-icon-${k})` } }), label)),
                e('button', { className: 'fold', title: '折叠图例', onClick: () => setLegendOpen(false) }, ICON_CHEVRON_U)),
              e('div', { className: 'l1' },
                [['modified', '修改'], ['added', '新增'], ['deleted', '删除'], ['unversioned', '未版本化']].map(([k, label]) => e('span', { className: 'it', key: k },
                  e('span', {
                    className: 'stag',
                    style: {
                      background: `color-mix(in srgb, ${STATUS_COLOR[k]} 16%, var(--svn-surface))`,
                      color: `color-mix(in srgb, ${STATUS_COLOR[k]} 55%, var(--dsw-alias-label-primary))`,
                    },
                  }, STATUS_LABEL[k]), label))))
              : e('div', { className: 'svn-legend', style: { flexDirection: 'row', alignItems: 'center' } },
                e('span', null, '类型与状态图例'),
                e('button', { className: 'fold', title: '展开图例', onClick: () => setLegendOpen(true) }, ICON_CHEVRON_S))) : null,
            recentSection,
            e('div', { className: 'svn-sec-sep' }),
            e('div', { className: 'svn-sec-hd' },
              e('button', {
                type: 'button', className: 'svn-sec-toggle', 'aria-expanded': secsOpen.all, 'aria-controls': 'svn-sec-all',
                onClick: () => toggleSec('all'),
              }, secChev(), e('b', null, '全部目录'), e('span', { className: 'cnt' }, String(rootEntries.length))),
              collapseAllBtn),
            e('div', { id: 'svn-sec-all', className: 'svn-sec-all', hidden: !secsOpen.all },
              treePanel),
            ),
            e('div', {
              className: dragging ? 'svn-splitbar on' : 'svn-splitbar',
              title: '拖拽调整目录树宽度（220–560px）· 双击复位',
              onMouseDown: onSplitDown,
              onDoubleClick: () => { const value = Math.min(TREE_WIDTH_DEFAULT, maxTreeWidth()); setTreeWidth(value); persistTreeWidth(value) },
            }),
          ),
          e('section', { className: 'svn-main' },
            showCrumb ? e('div', { className: 'svn-dirtools' },
              e('button', {
                className: 'svn-vbtn',
                onClick: () => { setCurrentPath(''); setSearch(null); setSelected(''); setFile(null) },
              }, '根目录'),
              currentPath ? e('span', { className: 'svn-crumbwrap' }, currentPath.split('/').map((seg, i, arr) => e(React.Fragment, { key: i },
                e('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, '/'),
                e('button', {
                  className: `svn-crumbseg${i === arr.length - 1 ? ' cur' : ''}`,
                  title: `回到 ${arr.slice(0, i + 1).join('/')}`,
                  onClick: () => openDir(arr.slice(0, i + 1).join('/')),
                }, seg)))) : null,
              rev ? e('span', { className: 'svn-chip blue', style: { marginLeft: '6px' } }, `r${rev}`) : null,
              e('span', { style: { flex: 1 } }),
              rev ? e('button', {
                className: 'svn-vbtn',
                onClick: () => { setRev(null); if (selected) openFile(selected, null, { size: file?.size ?? null }) },
              }, '回到最新') : null,
              e('button', {
                className: 'svn-vbtn', disabled: !isConnected, title: '复制当前目录完整路径',
                onClick: () => copyPath('dir'),
              }, copied && copied.key === 'dir' ? (copied.ok ? '已复制 ✓' : '复制失败') : '复制目录路径'),
              exportProg ? e('div', { className: 'svn-dlprog', title: '正在打包并下载目录 zip' },
                e('span', null, exportProg.files ? `${exportProg.received} 文件` : (exportProg.total ? `${Math.min(100, Math.round((exportProg.received / exportProg.total) * 100))}%` : '打包中')),
                e('span', { className: exportProg.total ? 'track' : 'track indet' }, e('i', { style: exportProg.total ? { width: `${Math.min(100, Math.round((exportProg.received / exportProg.total) * 100))}%` } : null })),
                e('button', { className: 'x', title: '取消导出', onClick: () => { if (exportCtrl.current) exportCtrl.current.abort() } }, '✕'))
                : e('button', { className: 'svn-vbtn', disabled: !isConnected, title: '导出当前目录为 zip', onClick: exportDir }, '导出'),
              e('button', {
                className: 'svn-vbtn', 'aria-pressed': railOpen,
                title: railOpen ? '收起上下文栏' : '打开上下文栏（目录信息 / 最近修订 / 同目录）',
                onClick: () => setRailOpen((v) => !v),
              }, '上下文'),
            ) : null,
            content,
          ),
          railOpen ? (() => {
            const railParent = file ? String(file.path ?? '').split('/').slice(0, -1).join('/') : currentPath
            const sibs = (dirCache[railParent] ?? []).filter((n) => !file || n.name !== file.name).slice(0, 6)
            return e('aside', { className: 'svn-rail', 'aria-label': '上下文栏' },
              e('div', { className: 'sec' },
                e('h3', null, file ? '文件' : '目录',
                  e('button', {
                    className: 'svn-ibtn', style: { marginLeft: 'auto', width: '22px', height: '22px' },
                    title: '收起上下文栏', onClick: () => setRailOpen(false),
                  }, ICON_CHEVRON_R)),
                file
                  ? e('div', { className: 'idcard' }, e(TypeIcon, { name: file.name, size: 22 }),
                    e('span', null, e('b', null, file.name),
                      e('span', { className: 'sub' }, `${railParent || '根目录'} · ${fmtSize(file.size)}${file.encoding ? ` · ${file.encoding}` : ''}`)))
                  : e('div', { className: 'idcard' }, e(TypeIcon, { name: currentPath || 'root', dir: true, size: 22 }),
                    e('span', null, e('b', null, currentPath || '根目录'),
                      e('span', { className: 'sub' }, `${sorted.length} 项 · r${rev ?? info?.revision ?? '—'} · ${kind === 'wc' ? '工作副本' : '远程仓库'} · 只读`)))),
              e('div', { className: 'sec' }, e('h3', null, '动作'),
                e('div', { className: 'acts' },
                  file ? e('button', { className: 'svn-btn ok', onClick: download }, '下载') : null,
                  e('button', { className: 'svn-btn', disabled: !isConnected, onClick: exportDir }, '导出目录'),
                  e('button', { className: 'svn-btn', onClick: () => copyPath(file ? 'file' : 'dir') }, '复制路径'),
                  file && file.rawUrl ? e('button', { className: 'svn-btn', onClick: () => { try { window.open(file.rawUrl, '_blank') } catch { /* ignore */ } } }, '原始文件') : null)),
              file && log && log.entries.length ? e('div', { className: 'sec' },
                e('h3', null, '最近修订', e('span', { className: 'x' }, '点选切换')),
                log.entries.slice(0, 5).map((entry) => e('button', {
                  key: entry.rev, className: `revmini${(rev ?? fileMeta?.rev) === entry.rev ? ' cur' : ''}`,
                  onClick: () => openRev(entry.rev),
                }, e('span', { className: 'rn2' }, `r${entry.rev}`),
                  e('span', { className: 'rm2' }, e('p', null, entry.message || '(无提交信息)'),
                    e('small', null, `${entry.author || '—'} · ${fmtDate(entry.date)}`))))) : null,
              e('div', { className: 'sec' }, e('h3', null, '同目录'),
                sibs.length ? sibs.map((n) => e('button', {
                  key: n.name, className: 'sib', title: n.name,
                  onClick: () => (n.kind === 'dir' ? openDir(railParent ? `${railParent}/${n.name}` : n.name) : openFile(railParent ? `${railParent}/${n.name}` : n.name, null, { size: n.size ?? null, entry: n })),
                }, e(TypeIcon, { name: n.name, dir: n.kind === 'dir', size: 13 }),
                  e('span', { className: 'nm2' }, n.name),
                  e('span', { className: 'sz' }, n.kind === 'dir' ? '' : fmtSize(n.size))))
                  : e('div', { className: 'svn-note' }, '没有其它条目')),
              file ? e('div', { className: 'foot' },
                e('button', { className: 'svn-btn act', style: { width: '100%' }, onClick: () => selectTab('history') }, '查看完整历史')) : null)
          })() : null,
        ),
        flyoutPanel,
        e('div', { className: 'svn-statusbar' },
          e('span', { className: 'seg' }, e('i', { className: isConnected ? 'dot' : 'dot off' }), isConnected ? '只读连接' : '未连接'),
          isConnected ? e('span', { className: 'seg' }, '仓库 HEAD', e('b', { className: 'mono' }, `r${rev ?? info?.revision ?? '—'}`)) : null,
          isConnected ? e('button', {
            className: 'seg click', onClick: () => setIdxOpen((v) => !v), title: '索引状态',
            'aria-expanded': idxOpen,
          }, '本地索引：', indexInfo.indexing ? '建立中' : (indexInfo.indexed ? `就绪 · ${fmtCount(indexInfo.entries)} 项` : '未建立')) : null,
          e('span', { className: 'sp' }),
          lastRefresh ? e('span', { className: 'seg' }, '最近刷新', e('span', { className: 'mono' }, new Date(lastRefresh).toTimeString().slice(0, 5))) : null,
          e('span', { className: 'seg mono' }, kind === 'wc' ? 'SVN WC' : 'SVN CLI')),
        idxOpen ? e(React.Fragment, null,
          e('div', { style: { position: 'fixed', inset: 0, zIndex: 79 }, onClick: () => setIdxOpen(false) }),
          e('div', { className: 'svn-pop', style: { position: 'fixed', left: 14, bottom: 36, zIndex: 80, minWidth: 260 } },
            e('div', { className: 'ph' }, e('b', null, '本地索引')),
            e('div', { className: 'pv' }, indexInfo.indexing
              ? '正在建立索引：远程仓库首次搜索时遍历全部路径，建好后按 revision 缓存在本机。'
              : indexInfo.indexed
                ? `就绪 · 覆盖 ${fmtCount(indexInfo.entries)} 条路径。仓库更新到新 revision 后会自动重建。`
                : '尚未建立：发起一次全仓文件名搜索即开始建立。'),
            e('div', { className: 'acts' }, e('button', { className: 'svn-btn', onClick: () => setIdxOpen(false) }, '关闭')))) : null,
        e('div', { className: 'svn-toasts' }, toasts.map((t) => e('div', {
          key: t.id, className: `svn-toast ${t.kind}`, role: t.kind === 'fail' ? 'alert' : 'status',
          onMouseEnter: () => pauseToast(t.id, true), onMouseLeave: () => pauseToast(t.id, false),
          onFocus: () => pauseToast(t.id, true), onBlur: () => pauseToast(t.id, false),
        },
          e('span', { className: 'sign', 'aria-hidden': true }, t.kind === 'fail' ? ICON_WARN : ICON_CHECK),
          e('div', { className: 'tbody' },
            e('div', { className: 'msg' }, t.msg),
            t.sub ? e('div', { className: 'sub' }, t.sub) : null,
            t.retry ? e('div', { className: 'acts' }, e('button', { onClick: () => { dropToast(t.id); t.retry() } }, '重试')) : null),
          e('button', { className: 'x', title: '关闭', onClick: () => dropToast(t.id) }, '✕')))),
        e('div', { className: 'svn-sr', 'aria-live': 'polite' }, announce),
        pickerModal,
      )
    }

    /* ------------------------------------------------------------- plugin */

    function PanelIcon({ size = 20, active }) {
      return e('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true,
        style: { display: 'block' },
      },
      e('path', {
        d: 'M12 2.6 20.2 7v10L12 21.4 3.8 17V7L12 2.6Z',
        stroke: active ? 'currentColor' : 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round',
        fill: active ? 'currentColor' : 'none', fillOpacity: active ? 0.16 : 0,
      }),
      e('path', { d: 'M12 8.2v7.6M8.6 10.4l3.4-2.2 3.4 2.2', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 40, label: () => 'SVN',
        }, PanelIcon)), 'svn-viewer: sidebar entry')
        ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: PANEL_ID,
        }, App)), 'svn-viewer: main panel')
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.dshPlugin = PANEL_ID
          style.textContent = CSS
          document.head.appendChild(style)
          return () => { try { style.remove() } catch { /* ignore */ } }
        }, 'svn-viewer: styles')
      },
    }
  },
})
