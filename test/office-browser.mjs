/**
 * 验证客户端自带的 Office 正文提取（浏览器端 zip 解包 + XML 剥标签），
 * 用真实的 OOXML 样本跑，和宿主侧提取结果对照。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { fixture } from './fixture.mjs'

const pathJoin = path.join

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('/* --- browser fallbacks')
const end = source.indexOf('/* --- end browser fallbacks --- */')
if (start < 0 || end < 0) throw new Error('helper markers not found in client.js')
const block = source.slice(start, end) + '\nglobalThis.__extractOffice = extractOfficeInBrowser\nglobalThis.__buildZip = buildZip\n'

const sandbox = {
  TextDecoder,
  TextEncoder,
  Blob,
  Response,
  DecompressionStream,
  Uint8Array,
  DataView,
  fetch: async () => { throw new Error('network disabled in this test') },
}
sandbox.globalThis = sandbox
vm.runInNewContext(block, sandbox, { filename: 'client-office-helpers.js' })
const extract = sandbox.__extractOffice

const checks = []
function check(name, ok, detail) {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`)
}

async function run(file, marker, label) {
  const bytes = readFileSync(file)
  const result = await extract(file.split(/[\\/]/).pop(), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  check(label, Boolean(result && result.text.includes(marker)), result ? `${result.kind} chars=${result.text.length} sample=${JSON.stringify(result.text.slice(0, 40))}` : 'null')
}

await run(fixture.office.docx, '停线预警通知', 'browser docx text')
await run(fixture.office.xlsx, '停线预警', 'browser xlsx text')
await run(fixture.office.pptx, '验收标准', 'browser pptx text')

// 浏览器端 zip：打包两个真实文件，用 bsdtar 解回来逐字节比对
const zipDir = mkdtempSync(pathJoin(tmpdir(), 'zip-check-'))
const zipPath = pathJoin(zipDir, 'bundle.zip')
const zipBlob = await sandbox.__buildZip([
  { name: 'docs/停线预警设计.docx', bytes: readFileSync(fixture.office.docx) },
  { name: 'docs/停线预警统计.xlsx', bytes: readFileSync(fixture.office.xlsx) },
])
writeFileSync(zipPath, Buffer.from(await zipBlob.arrayBuffer()))
const listing = execFileSync('tar', ['-tf', zipPath], { encoding: 'utf8' }).trim().split(/\r?\n/).sort()
check('browser zip listing', listing.length === 2, listing.length + ' entries')
const unpacked = pathJoin(zipDir, 'out')
mkdirSync(unpacked, { recursive: true })
execFileSync('tar', ['-xf', zipPath, '-C', unpacked], { stdio: 'ignore' })
const roundTrip = readFileSync(pathJoin(unpacked, 'docs', '停线预警设计.docx'))
check('browser zip round-trip', roundTrip.equals(readFileSync(fixture.office.docx)), `${roundTrip.length} bytes`)
rmSync(zipDir, { recursive: true, force: true })

fixture.cleanup()
const failed = checks.filter((item) => !item.ok).length
console.log(`\n${checks.length - failed}/${checks.length} passed`)
process.exit(failed ? 1 : 0)
