import http from 'node:http'
import path from 'node:path'
import { apply } from '../lib/index.js'

import { fixture } from './fixture.mjs'

const OPTIONS = { cleanup: !process.argv[2] }
const ROOT = process.argv[2] ?? fixture.wc
const routes = []
apply({ webServer: { register(route) { routes.push(route) } } })
const server = http.createServer((req, res) => {
  for (const route of routes) {
    if (req.url.startsWith(route.path)) return route.handler(req, res)
  }
  res.statusCode = 404
  res.end('no-route')
})
await new Promise((resolve) => server.listen(7799, '127.0.0.1', resolve))

function get(path, headers = {}) {
  return new Promise((resolve) => {
    const started = Date.now()
    http.get(`http://127.0.0.1:7799${path}`, { headers }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const buffer = Buffer.concat(chunks)
        let json = null
        try { json = JSON.parse(buffer.toString('utf8')) } catch { /* binary */ }
        resolve({ status: res.statusCode, ms: Date.now() - started, json, bytes: buffer.length, headers: res.headers, text: buffer.toString('utf8') })
      })
    }).on('error', (error) => resolve({ status: 0, ms: Date.now() - started, json: null, bytes: 0, error: String(error) }))
  })
}

const q = (value) => encodeURIComponent(value)
const rows = []
function check(label, ok, detail) {
  rows.push(`${ok ? 'PASS' : 'FAIL'} | ${label} | ${detail}`)
}

const health = await get('/dsh-svn/health')
check('health', health.status === 200 && health.json?.ok, `${health.ms}ms svn=${health.json?.svn}`)

const rootQ = q(ROOT)
const info = await get(`/dsh-svn/info?root=${rootQ}`)
check('info', info.status === 200 && info.json?.info?.revision >= 1, `rev=${info.json?.info?.revision} kind=${info.json?.kind}`)

const list = await get(`/dsh-svn/list?root=${rootQ}`)
const names = (list.json?.entries ?? []).map((entry) => entry.name)
check('list root', list.status === 200 && names.length >= 5, `${list.ms}ms ${names.join(',')}`)

const status = await get(`/dsh-svn/status?root=${rootQ}`)
const statusKeys = Object.keys(status.json?.entries ?? {})
check('status', statusKeys.some((key) => key.includes('app.js')) && statusKeys.some((key) => key.includes('untracked')), `${status.ms}ms ${JSON.stringify(status.json?.entries)}`)

const md = await get(`/dsh-svn/file?root=${rootQ}&path=${q('docs/设计说明.md')}`)
check('file md', md.json?.view === 'text' && md.json?.content?.includes('停线预警'), `${md.ms}ms enc=${md.json?.encoding} lines=${md.json?.content?.split('\n').length}`)

const js = await get(`/dsh-svn/file?root=${rootQ}&path=${q('src/app.js')}`)
check('file js', js.json?.view === 'text' && js.json?.content?.includes('本地修改'), `${js.ms}ms lang=${js.json?.language}`)

const png = await get(`/dsh-svn/file?root=${rootQ}&path=${q('img/pixel.png')}`)
check('file png', png.json?.view === 'image', `${png.ms}ms size=${png.json?.size}`)

const bin = await get(`/dsh-svn/file?root=${rootQ}&path=${q('binary.bin')}`)
check('file binary', bin.json?.view === 'binary', `${bin.ms}ms`)

const empty = await get(`/dsh-svn/file?root=${rootQ}&path=${q('empty.txt')}`)
check('file empty', empty.status === 200 && empty.json?.view === 'text' && true, `${empty.ms}ms`)

const raw = await get(`/dsh-svn/raw?root=${rootQ}&path=${q('img/pixel.png')}`)
check('raw png', raw.status === 200 && raw.bytes > 50, `${raw.ms}ms bytes=${raw.bytes}`)

const mp4File = await get(`/dsh-svn/file?root=${rootQ}&path=${q('img/clip.mp4')}`)
check('file mp4 view', mp4File.json?.view === 'video' && mp4File.json?.size === 20, `${mp4File.ms}ms view=${mp4File.json?.view} size=${mp4File.json?.size}`)

const mp4Raw = await get(`/dsh-svn/raw?root=${rootQ}&path=${q('img/clip.mp4')}`, { range: 'bytes=0-7' })
check('raw mp4 mime + range', mp4Raw.status === 206 && String(mp4Raw.headers?.['content-type'] ?? '').startsWith('video/mp4'), `${mp4Raw.ms}ms status=${mp4Raw.status} type=${mp4Raw.headers?.['content-type']} range=${mp4Raw.headers?.['content-range']}`)

// 远程分支（svn cat）超过旧 16 MB 缓冲上限不得截杀子进程
const repoQ = q(fixture.repoUrl)
const bigRaw = await get(`/dsh-svn/raw?root=${repoQ}&path=${q('img/big.bin')}`)
check('raw remote over 16MB not killed', bigRaw.status === 200 && bigRaw.bytes === 17 * 1024 * 1024, `${bigRaw.ms}ms status=${bigRaw.status} bytes=${bigRaw.bytes}`)

// 流式分支：不缓冲、边下边发，content-length 来自 probeSize
const wcStream = await get(`/dsh-svn/stream?root=${rootQ}&path=${q('img/big.bin')}`)
check('stream wc pipes full bytes with length', wcStream.status === 200 && wcStream.bytes === 17 * 1024 * 1024 && String(wcStream.headers?.['content-length']) === String(17 * 1024 * 1024), `${wcStream.ms}ms status=${wcStream.status} bytes=${wcStream.bytes} len=${wcStream.headers?.['content-length']}`)

const mp4Stream = await get(`/dsh-svn/stream?root=${rootQ}&path=${q('img/clip.mp4')}`)
check('stream wc mime + length', mp4Stream.status === 200 && mp4Stream.bytes === 20 && String(mp4Stream.headers?.['content-type'] ?? '').startsWith('video/mp4'), `${mp4Stream.ms}ms status=${mp4Stream.status} type=${mp4Stream.headers?.['content-type']} len=${mp4Stream.headers?.['content-length']}`)

const remoteStream = await get(`/dsh-svn/stream?root=${repoQ}&path=${q('img/big.bin')}`)
check('stream remote svn cat pipes full bytes', remoteStream.status === 200 && remoteStream.bytes === 17 * 1024 * 1024 && String(remoteStream.headers?.['content-length']) === String(17 * 1024 * 1024), `${remoteStream.ms}ms status=${remoteStream.status} bytes=${remoteStream.bytes} len=${remoteStream.headers?.['content-length']}`)

const streamMissing = await get(`/dsh-svn/stream?root=${rootQ}&path=${q('nope.txt')}`)
check('stream missing 404', streamMissing.status === 404, `${streamMissing.ms}ms status=${streamMissing.status}`)

const log = await get(`/dsh-svn/log?root=${rootQ}&path=${q('src/app.js')}&limit=5`)
check('log', log.json?.entries?.length === 1 && log.json.entries[0].rev === 1, `${log.ms}ms ${log.json?.entries?.map((entry) => entry.rev)}`)

const diff = await get(`/dsh-svn/diff?root=${rootQ}&path=${q('src/app.js')}&rev=1`)
check('diff r1', diff.json?.stat && diff.json.lines.length > 0, `${diff.ms}ms stat=${JSON.stringify(diff.json?.stat)}`)

const blame = await get(`/dsh-svn/blame?root=${rootQ}&path=${q('src/app.js')}`)
check('blame', blame.json?.lines?.length > 0, `${blame.ms}ms lines=${blame.json?.lines?.length}`)

const atRev = await get(`/dsh-svn/file?root=${rootQ}&path=${q('src/app.js')}&rev=1`)
check('file@rev', atRev.json?.content?.includes('本地修改') === false, `${atRev.ms}ms rev=${atRev.json?.rev}`)

const nameSearch = await get(`/dsh-svn/search?root=${rootQ}&q=${q('设计')}&mode=name`)
check('search name', nameSearch.json?.files?.some((hit) => hit.path.includes('设计说明')), `${nameSearch.ms}ms total=${nameSearch.json?.total}`)

const dirSearch = await get(`/dsh-svn/search?root=${rootQ}&q=${q('docs')}&mode=name`)
check('search name includes dirs', dirSearch.json?.files?.some((hit) => hit.kind === 'dir' && hit.path === 'docs'), `${dirSearch.ms}ms total=${dirSearch.json?.total} ${JSON.stringify((dirSearch.json?.files ?? []).slice(0, 3).map((hit) => `${hit.kind}:${hit.path}`))}`)

// 文件名索引：URL 根 → 首次回 indexing，轮询后命中深层文件；索引缓存复用
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
process.env.DSH_SVN_INDEX_DIR = path.join(fixture.root, 'name-index')
const repoRootQ = q(fixture.repoUrl)
let indexed = await get(`/dsh-svn/search?root=${repoRootQ}&q=${q('设计说明')}&mode=name`)
check('repo-wide name search starts indexing', indexed.json?.indexing === true, `${indexed.ms}ms scanned=${indexed.json?.scanned}`)
let indexPolls = 0
while (indexed.json?.indexing && indexPolls < 60) {
  await sleep(150)
  indexPolls += 1
  indexed = await get(`/dsh-svn/search?root=${repoRootQ}&q=${q('设计说明')}&mode=name`)
}
check('index becomes ready and answers', indexed.json?.indexed === true && indexed.json?.total >= 1, `${indexed.ms}ms polls=${indexPolls} total=${indexed.json?.total} scanned=${indexed.json?.scanned}`)
check('indexed search finds a deep file', (indexed.json?.files ?? []).some((hit) => hit.path === 'docs/设计说明.md'), JSON.stringify((indexed.json?.files ?? []).map((hit) => hit.path).slice(0, 4)))
const indexedDirs = await get(`/dsh-svn/search?root=${repoRootQ}&q=${q('docs')}&mode=name`)
check('indexed search returns directories', (indexedDirs.json?.files ?? []).some((hit) => hit.kind === 'dir' && hit.path === 'docs'), JSON.stringify((indexedDirs.json?.files ?? []).map((hit) => `${hit.kind}:${hit.path}`).slice(0, 4)))
const indexedAgain = await get(`/dsh-svn/search?root=${repoRootQ}&q=${q('设计说明')}&mode=name`)
check('second search reuses the index', indexedAgain.json?.indexed === true && !indexedAgain.json?.indexing && indexedAgain.error === undefined, `${indexedAgain.ms}ms`)
const indexedScoped = await get(`/dsh-svn/search?root=${repoRootQ}&q=${q('设计')}&mode=name&path=${q('docs')}`)
check('indexed search honors scope', (indexedScoped.json?.files ?? []).length > 0 && (indexedScoped.json?.files ?? []).every((hit) => hit.path === 'docs' || hit.path.startsWith('docs/')), JSON.stringify((indexedScoped.json?.files ?? []).map((hit) => hit.path)))
const indexCancel = await get(`/dsh-svn/search?root=${repoRootQ}&q=${q('设计')}&mode=name&cancel=1`)
check('index cancel is a no-op when idle', indexCancel.json?.ok === true && indexCancel.json?.cancelled === false, JSON.stringify(indexCancel.json))

const contentSearch = await get(`/dsh-svn/search?root=${rootQ}&q=${q('停线预警')}&mode=content`)
check('search content', contentSearch.json?.files?.length > 0, `${contentSearch.ms}ms total=${contentSearch.json?.total} scanned=${contentSearch.json?.scanned}`)
check('content search reaches deep local files', (contentSearch.json?.files ?? []).some((hit) => hit.path.includes('深层说明.md')), JSON.stringify((contentSearch.json?.files ?? []).map((hit) => hit.path).slice(0, 6)))
check('content search covers office documents', (contentSearch.json?.files ?? []).some((hit) => hit.path.endsWith('.docx')), JSON.stringify((contentSearch.json?.files ?? []).map((hit) => hit.path).slice(0, 6)))
const deepName = await get(`/dsh-svn/search?root=${rootQ}&q=${q('深层说明')}&mode=name`)
check('name search reaches deep local dirs', (deepName.json?.files ?? []).some((hit) => hit.path.includes('深层说明.md')), `${deepName.ms}ms scanned=${deepName.json?.scanned}`)

const fsDrives = await get('/dsh-svn/fs')
check('fs lists drives', fsDrives.json?.mode === 'drives' && (fsDrives.json?.entries ?? []).length > 0, JSON.stringify((fsDrives.json?.entries ?? []).map((entry) => entry.name).slice(0, 4)))
const fsDir = await get(`/dsh-svn/fs?path=${q(fixture.wc)}`)
check('fs lists subdirectories with absolute paths', fsDir.json?.mode === 'dirs' && (fsDir.json?.entries ?? []).some((entry) => entry.name === 'docs' && String(entry.path).includes('docs')), JSON.stringify((fsDir.json?.entries ?? []).map((entry) => entry.name).slice(0, 5)))
const fsParent = await get(`/dsh-svn/fs?path=${q(fixture.wc + path.sep + 'docs')}`)
check('fs returns the parent directory', String(fsParent.json?.parent ?? '').length > 0 && fsParent.json?.path?.endsWith('docs'), fsParent.json?.parent)
const fsFile = await get(`/dsh-svn/fs?path=${q(fixture.wc + path.sep + 'README.md')}`)
check('fs rejects files', fsFile.status === 400, 'status=' + fsFile.status)
const fsMissing = await get('/dsh-svn/fs?path=' + q('D:' + path.sep + 'definitely-missing-dir-xyz'))
check('fs reports missing dirs', fsMissing.status === 404, 'status=' + fsMissing.status)
const tree = await get(`/dsh-svn/tree?root=${rootQ}`)
check('tree', tree.json?.count >= 5, `${tree.ms}ms count=${tree.json?.count} truncated=${tree.json?.truncated}`)

const docx = await get(`/dsh-svn/file?root=${rootQ}&path=${q('docs/停线预警设计.docx')}`)
check('file docx view', docx.json?.view === 'docx', `${docx.ms}ms view=${docx.json?.view}`)

const docxText = await get(`/dsh-svn/file?root=${rootQ}&path=${q('docs/停线预警设计.docx')}&text=1`)
check('file docx text fallback', docxText.json?.view === 'office-text' && String(docxText.json?.content ?? '').includes('停线预警'), `${docxText.ms}ms kind=${docxText.json?.officeKind} chars=${String(docxText.json?.content ?? '').length}`)

const xlsx = await get(`/dsh-svn/file?root=${rootQ}&path=${q('docs/停线预警统计.xlsx')}`)
check('file xlsx view', xlsx.json?.view === 'spreadsheet', `${xlsx.ms}ms view=${xlsx.json?.view}`)

const xlsxText = await get(`/dsh-svn/file?root=${rootQ}&path=${q('docs/停线预警统计.xlsx')}&text=1`)
check('file xlsx text fallback', xlsxText.json?.view === 'office-text' && String(xlsxText.json?.content ?? '').includes('停线预警'), `${xlsxText.ms}ms kind=${xlsxText.json?.officeKind}`)

const pptx = await get(`/dsh-svn/file?root=${rootQ}&path=${q('docs/停线预警汇报.pptx')}`)
check('file pptx text', pptx.json?.view === 'pptx' && String(pptx.json?.content ?? '').includes('停线预警'), `${pptx.ms}ms kind=${pptx.json?.officeKind} content=${JSON.stringify(String(pptx.json?.content ?? '').slice(0, 60))}`)

const exported = await get(`/dsh-svn/export?root=${rootQ}&path=${q('src')}`)
check('export zip', exported.status === 200 && exported.bytes > 100, `${exported.ms}ms bytes=${exported.bytes}`)

const asset = await get('/dsh-svn/assets/docx-preview.min.js')
check('asset docx-preview', asset.status === 200 && asset.bytes > 50000, `${asset.ms}ms bytes=${asset.bytes} type=${asset.headers?.['content-type']}`)

const assetSheet = await get('/dsh-svn/assets/xlsx.core.min.js')
check('asset sheetjs', assetSheet.status === 200 && assetSheet.bytes > 300000, `${assetSheet.ms}ms bytes=${assetSheet.bytes}`)

const assetPptx = await get('/dsh-svn/assets/pptx-preview.umd.js')
check('asset pptx-preview', assetPptx.status === 200 && assetPptx.bytes > 1000000, `${assetPptx.ms}ms bytes=${assetPptx.bytes}`)

const assetMiss = await get('/dsh-svn/assets/nope.js')
check('asset 404', assetMiss.status === 404, `${assetMiss.ms}ms status=${assetMiss.status}`)

const rawRange = await get(`/dsh-svn/raw?root=${rootQ}&path=${q('src/app.js')}`, { range: 'bytes=0-9' })
check('raw range 206', rawRange.status === 206 && rawRange.bytes === 10 && String(rawRange.headers?.['content-range'] ?? '').startsWith('bytes 0-9/'), `${rawRange.ms}ms status=${rawRange.status} bytes=${rawRange.bytes} range=${rawRange.headers?.['content-range']}`)

const rawFull = await get(`/dsh-svn/raw?root=${rootQ}&path=${q('src/app.js')}`)
check('raw inline headers', rawFull.status === 200 && String(rawFull.headers?.['accept-ranges']) === 'bytes' && String(rawFull.headers?.['content-disposition'] ?? '').includes('inline'), `${rawFull.ms}ms disposition=${String(rawFull.headers?.['content-disposition'] ?? '').slice(0, 60)}`)

const urlRoot = encodeURIComponent(fixture.repoUrl)
const urlInfo = await get(`/dsh-svn/info?root=${urlRoot}`)
check('info url', urlInfo.status === 200 && urlInfo.json?.kind === 'url', `${urlInfo.ms}ms rev=${urlInfo.json?.info?.revision}`)

const urlList = await get(`/dsh-svn/list?root=${urlRoot}&path=src`)
check('list url', urlList.json?.entries?.some((entry) => entry.name === 'app.js'), `${urlList.ms}ms count=${urlList.json?.entries?.length}`)

const missing = await get(`/dsh-svn/file?root=${rootQ}&path=${q('nope.txt')}`)
check('missing file 404', missing.status === 404, `${missing.ms}ms status=${missing.status}`)

const escape = await get(`/dsh-svn/file?root=${rootQ}&path=${q('../outside.txt')}`)
check('path escape 400', escape.status === 400, `${escape.ms}ms status=${escape.status}`)

const badRoot = await get('/dsh-svn/info?root=' + q('D:\\definitely\\missing'))
check('missing root', badRoot.status === 400, `${badRoot.ms}ms status=${badRoot.status}`)

const diffBin = await get(`/dsh-svn/diff?root=${rootQ}&path=${q('img/clip.mp4')}`)
check('diff binary guard skips svn diff', diffBin.status === 200 && diffBin.json?.binary === true && diffBin.json?.lines?.length === 0, `${diffBin.ms}ms binary=${diffBin.json?.binary}`)

const diffWc = await get(`/dsh-svn/diff?root=${rootQ}&path=${q('src/app.js')}`)
check('diff wc without rev compares BASE', diffWc.status === 200 && (diffWc.json?.stat?.add + diffWc.json?.stat?.del) > 0, `${diffWc.ms}ms +${diffWc.json?.stat?.add}/-${diffWc.json?.stat?.del}`)

const diffUrl = await get(`/dsh-svn/diff?root=${urlRoot}&path=${q('src/app.js')}`)
check('diff url without rev resolves last-changed', diffUrl.status === 200 && diffUrl.json?.rev >= 1 && (diffUrl.json?.stat?.add + diffUrl.json?.stat?.del) > 0, `${diffUrl.ms}ms rev=${diffUrl.json?.rev}`)

for (const row of rows) console.log(row)
const failed = rows.filter((row) => row.startsWith('FAIL')).length
console.log(`\n${rows.length - failed}/${rows.length} passed`)
server.close()
if (OPTIONS.cleanup) fixture.cleanup()
process.exit(failed ? 1 : 0)






