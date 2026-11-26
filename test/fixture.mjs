import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(tmpdir(), 'dsh-svn-fixture-'))
const fixtures = path.join(root, 'fixtures')
const repo = path.join(root, 'repo')
const wc = path.join(root, 'wc')

function file(relative, content) {
  const target = path.join(fixtures, relative)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content, 'utf8')
}

file('README.md', '# 示例仓库\n\n用于 dsh-svn-viewer 的测试仓库。\n')
file('src/app.js', "export function stopLine(level) {\n  const levels = ['提示', '警告', '停机']\n  return levels.includes(level) ? `停线预警: ${level}` : '未知等级'\n}\n")
file('docs/设计说明.md', '# 设计说明\n\n停线预警分三级：提示、警告、停机。\n')
file('data.csv', 'id,name,level\n1,PQC-001,提示\n2,PQC-002,警告\n')
file('empty.txt', '')
file('docs/深层/一/二/三/四/五/六/深层说明.md', '# 深层说明\n\n深层停线预警记录：提示、警告、停机。\n')
mkdirSync(path.join(fixtures, 'img'), { recursive: true })
writeFileSync(path.join(fixtures, 'img', 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
writeFileSync(path.join(fixtures, 'binary.bin'), Buffer.from([0, 1, 2, 3, 0, 255, 254, 0, 65, 66]))
writeFileSync(path.join(fixtures, 'img', 'clip.mp4'), Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 0, 0, 0, 0]))
// 超过远程 svn cat 旧 16 MB 缓冲上限，用于回归「截杀子进程 → 500」
writeFileSync(path.join(fixtures, 'img', 'big.bin'), Buffer.alloc(17 * 1024 * 1024, 7))

function packZip(srcDir, entry, target) {
  const temp = `${target}.zip`
  execFileSync('tar', ['-a', '-cf', temp, '-C', srcDir, entry], { stdio: 'ignore' })
  try { rmSync(target, { force: true }) } catch { /* ignore */ }
  renameSync(temp, target)
}
const repoUrl = `file:///${repo.replace(/\\/g, '/')}`
// 构造一个最小 docx（OOXML 就是 zip），用于验证 Office 正文提取
const docxSrc = path.join(root, 'docx-src')
mkdirSync(path.join(docxSrc, 'word'), { recursive: true })
writeFileSync(
  path.join(docxSrc, 'word', 'document.xml'),
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>停线预警通知</w:t></w:r></w:p><w:p><w:r><w:t>预警等级分为提示、警告、停机三级。</w:t></w:r></w:p></w:body></w:document>',
  'utf8',
)
packZip(docxSrc, 'word', path.join(fixtures, 'docs', '停线预警设计.docx'))

// 最小 xlsx：共享字符串 + 一张表
const xlsxSrc = path.join(root, 'xlsx-src')
mkdirSync(path.join(xlsxSrc, 'xl', 'worksheets'), { recursive: true })
writeFileSync(
  path.join(xlsxSrc, 'xl', 'sharedStrings.xml'),
  '<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>等级</t></si><si><t>停线预警</t></si></sst>',
  'utf8',
)
writeFileSync(
  path.join(xlsxSrc, 'xl', 'worksheets', 'sheet1.xml'),
  '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2"><v>3</v></c><c r="B2" t="inlineStr"><is><t>停机</t></is></c></row></sheetData></worksheet>',
  'utf8',
)
packZip(xlsxSrc, 'xl', path.join(fixtures, 'docs', '停线预警统计.xlsx'))

// 最小 pptx：两页
const pptxSrc = path.join(root, 'pptx-src')
mkdirSync(path.join(pptxSrc, 'ppt', 'slides'), { recursive: true })
writeFileSync(
  path.join(pptxSrc, 'ppt', 'slides', 'slide1.xml'),
  '<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>停线预警方案</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
  'utf8',
)
writeFileSync(
  path.join(pptxSrc, 'ppt', 'slides', 'slide2.xml'),
  '<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>验收标准</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
  'utf8',
)
packZip(pptxSrc, 'ppt', path.join(fixtures, 'docs', '停线预警汇报.pptx'))

execFileSync('svnadmin', ['create', repo], { stdio: 'ignore' })
execFileSync('svn', ['import', fixtures, repoUrl, '-m', '初始化测试仓库', '--non-interactive'], { stdio: 'ignore' })
execFileSync('svn', ['checkout', repoUrl, wc, '--non-interactive'], { stdio: 'ignore' })
writeFileSync(path.join(wc, 'src', 'app.js'), "export function stopLine(level) {\n  const levels = ['提示', '警告', '停机']\n  return levels.includes(level) ? `停线预警: ${level}` : '未知等级'\n}\n// 本地修改\n", 'utf8')
writeFileSync(path.join(wc, 'untracked.txt'), '未版本化文件\n', 'utf8')

export const fixture = {
  root,
  wc,
  repoUrl,
  office: {
    docx: path.join(fixtures, 'docs', '停线预警设计.docx'),
    xlsx: path.join(fixtures, 'docs', '停线预警统计.xlsx'),
    pptx: path.join(fixtures, 'docs', '停线预警汇报.pptx'),
  },
  cleanup() {
    try { rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ }
  },
}

