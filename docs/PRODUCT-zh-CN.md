# 产品

<!-- impeccable:product-schema 1 -->

## 平台

web

## 用户

需要在 SVN 仓库或工作副本中定位并查看文件的开发人员、交付团队与维护者。

## 产品目标

面向 DeepSeek Harness 的 SVN 只读文件查看器。成功的判定标准是：用户无需离开查看器，就能找到仓库中的文件，并查看其内容或变更上下文。

## 能力与约束

### 功能清单

- 连接本地工作副本与 SVN 仓库 URL（`svn://`、`http(s)://`、`file://`），自动识别类型与最新修订号。地址栏右侧的文件夹按钮可以不手输路径选目录（先选盘符再逐层进入，选中后直接连接）。
- 目录树：懒加载；点整行即展开并把右栏切成该目录的文件列表（收起交给三角，点整行不会折叠）；文件夹图标；工作副本状态点（M/A/D/?/!）；树头即过滤框（只过滤已加载节点，不发请求）；稀疏检出目录按需从仓库读取。根级平铺，无模块分组（0.3.21 移除）。
- 侧栏两段：**最近**（只记打开过的文件，上限 12 条，4 行高区域内滚，清空钮）与**全部目录**（平铺树，段头可折叠；段头右侧动作＝全部收起）。树顶工具行＝过滤框 / 计数 / 收起目录栏按钮。
- 收起态：44px 图标条（目录 / 最近）。悬停图标出锚定浮层，悬停期间持续显示；点击图标展开侧栏；无底部展开钮。Esc 关浮层不关预览。
- 文件列表：大小、最后修改修订、作者、时间。
- 预览：文本/代码（行号）、Markdown 原文、图片、PDF；docx/xlsx/pptx 版式渲染（xlsx 按 `!merges` 还原合并单元格与双层吸顶表头，长文本 2 行截断、点单元格看全文，另有「拍平」开关回退到逐单元格输出）；压缩包给出下载入口。
- 历史：任意文件或目录的提交记录，点任意修订按该版本查看。
- 归属：文本文件逐行给出修订与作者，点修订号跳到该版本。
- 对比：`svn diff` 分级着色，行内/并排视图与上一处/下一处变更跳转；无修订时对比工作副本与 BASE。
- 搜索：文件名（默认整个仓库，可切当前目录）与全文（仅本地工作副本）两种模式，详见下文。
- 导出：当前目录或文件导出为 zip，带进度、可取消；单文件可直接下载。
- 只读：不提供提交、更新、删除入口。
- 全局状态栏（保留）：只读连接 / 仓库 HEAD / 本地索引 / 最近刷新 / WC·CLI。
- 双主题：跟随宿主明暗令牌。
- 键盘：目录树 roving tabindex 漫游（↑↓←→/Home/End/Enter/Space）、Ctrl+P 聚焦搜索、Esc 分层关闭；快捷键表见根 `README.md`。

### 宿主路由（`lib/index.js`，前缀 `/dsh-svn`）

| 路由 | 用途 |
| --- | --- |
| `GET /health` | svn 版本与可用性 |
| `GET /context` | 进程 cwd、发现的工作副本（含 URL 与修订号） |
| `GET /info?root=` | 仓库或工作副本信息 |
| `GET /list?root=&path=&rev=` | 目录列表，含修订、作者、工作副本状态 |
| `GET /file?root=&path=&rev=` | 按类型分派的内容与元信息（docx/spreadsheet/pptx/pdf/image/text…；`&text=1` 强制正文提取） |
| `GET /raw?root=&path=&rev=` | 原始字节（图片、PDF、下载），支持 Range（206）、inline、accept-ranges |
| `GET /assets/*` | 前端预览库白名单（docx-preview、JSZip、SheetJS、pptx-preview） |
| `GET /log?root=&path=&limit=` | 提交历史 |
| `GET /diff?root=&path=&rev=` | 差异（分级着色数据） |
| `GET /blame?root=&path=` | 逐行归属 |
| `GET /status?root=` | 工作副本状态映射 |
| `GET /tree?root=&path=` | 用于搜索的平铺清单（本地走磁盘，远程走 `svn list -R` 或限深遍历） |
| `GET /fs?path=` | 目录选择器的只读目录列举（不带 path 返回盘符，带路径只返回子目录与绝对路径） |
| `GET /search?root=&q=&mode=name\|content&path=&cancel=1` | 文件名与全文搜索；不带 `path` 走整个仓库索引（首次回 `indexing:true`，客户端轮询；`cancel=1` 取消建索引），带 `path` 时按该目录过滤 |
| `GET /export?root=&path=` | 目录/文件 zip 导出 |

### svn 封装（`lib/svn.js`）与宿主护栏

- `lib/svn.js` 封装 `svn` 命令行（调用处带 `--non-interactive --xml`）：单次超时与字节上限、UTF-8 解码（GBK/GB18030 回退，适配中文 Windows）、XML 解析（list/log/info/status）、文件类型判定、限制在根内的路径拼接。
- `lib/index.js` 另加并发上限 4 个 svn 进程、内存 TTL 缓存、SVN 错误码 → HTTP 映射（认证 401、未找到 404、不可达 502、超时 504…）。
- `TEXT_LIMIT = 2 MB`：文本预览超出截断。

### 客户端槽位（`lib/client.js`）

- 注册 `sidebar.panellist` 入口（标签「SVN」，order 40）与 `main` 面板（键 `dsh-svn-viewer`）。
- `lib/client.js` 顶部的 `DEFAULT_ROOT` 常量决定首次打开连接的地址（默认公开示例仓库 `https://svn.apache.org/repos/asf/poi/trunk`），按需修改。
- UI 状态持久化到 localStorage：连接根 + 地址历史、树宽（220–560px，默认 320，拖分隔条调整、双击复位）、当前路径/选中/展开态、搜索模式与范围、上下文栏开关、最近文件、目录栏收起态（`treerail` 键，与上下文栏 `rail` 键分开）、段头折叠态（`secs` 键）。

### 搜索与索引缓存

- 文件名搜索默认搜整个仓库。远程仓库首次会建一份本机索引（`svn list -R` → gz 缓存）：大仓库实测百万级条目 / 分钟级 / 数十 MB gz；按 HEAD revision 失效；7 天未用重建。缓存位于系统临时目录的 `dsh-svn-viewer-index/`（`DSH_SVN_INDEX_DIR` 可改），只保留最近一份。
- 建索引期间：置顶进度卡（扫描数 + 不确定进度条 + 唯一取消钮）。建好后每次几秒出结果；「当前目录」范围秒出、可随时取消。
- 全文搜索需要本地工作副本：文本单文件 ≤ 1 MB、Office（docx/xlsx/pptx）正文 ≤ 8 MB 且最多 200 个 Office 文件；PDF/图片不参与。远程仓库根只能按文件名搜；旧宿主会用 `/tree` 兜底目录检索。

### Office 管线

- 宿主有提取能力时用宿主结果（`lib/office.js`）；旧宿主由浏览器端解包提取 docx/xlsx/pptx 正文。
- 客户端版式渲染：docx-preview（docx）、SheetJS（xlsx 系，`!merges` 还原）、pptx-preview（pptx）；预览库经 `/assets/*` 白名单从 `assets/` 提供（含第三方许可证）。
- 渲染失败自动回退到提取出的文字大纲。

### 导出上限

- 新版宿主：目录导出上限 800 个文件 / 120 MB（打包前先做计划检查）。
- 旧宿主或浏览器端兜底：300 个文件 / 60 MB，在页面里打 zip（JSZip），进度按文件数计。
- 单文件导出直接下载；原始传输上限 100 MB（`MAX_RAW`）。

### 边界与已知限制

- 需要本机可执行 `svn`（TortoiseSVN 命令行工具或 SlikSVN），凭据取自 `%APPDATA%\Subversion`。
- 文本预览上限 2 MB，超出截断。
- 全文搜索只在本地工作副本根下可用（上限见上）；远程仓库根只能按文件名搜。
- 远程仓库目录按需读取（约 0.4 s/次）；全仓库文件名搜索靠索引，索引建好前只能按目录范围搜。
- 宿主代码改动（`lib/index.js`）需要重启 `dsh web` 才生效；客户端改动刷新页面即生效。
- Ctrl+P 被用作搜索聚焦，会覆盖浏览器打印快捷键（已知取舍，产品决策开放项）。

### 自检矩阵与命令

计数为 0.3.25（2026-11-25）实测：

| 命令 | 范围 | 结果 |
| --- | --- | --- |
| `node test/suite.mjs` | 离线接口测试：自建 fixture 仓库 | 60/60 |
| `node test/dom.mjs` | jsdom 全链路（连接→目录→文件→预览→历史）+ UI 回归 | 174/174 |
| `node test/render.mjs` | react-dom/server 渲染面板 | 8/8 |
| `node test/client-smoke.mjs` | 客户端槽位注册 | 9/9 |
| `node test/office-browser.mjs` | 浏览器端 Office 提取 + zip 打包 | 5/5 |
| `node scripts/check-live.mjs` | 对运行中的 dsh web 真机自检（不需要 GUI token） | 真机探针 |

`check-live.mjs` 只打运行中宿主的 `/dsh-svn/*`（默认 `http://127.0.0.1:3080`，`DSH_SVN_BASE` 可改），检查宿主健康、宿主版本（`/context.repos` 字段）、真实仓库信息/列表、按名搜索、docx 正文提取与单文件导出。旧宿主（重启前）会自动改用浏览器端兜底：Office 正文在页面里解包提取、导出在页面里打 zip，因此这两项仍应通过，只有「宿主版本」一项会是 FAIL。宿主代码更新后必须先重启 `dsh web`。

### 结构说明

- `lib/index.js`：宿主半，注册 `/dsh-svn` 前缀路由。
- `lib/svn.js`：`svn` 命令行封装 + XML 解析 + 类型判定。
- `lib/office.js`：宿主侧 Office 正文提取。
- `lib/client.js`：客户端半，侧栏入口 + main 面板（React）。
- `assets/`：预览库白名单文件及其许可证。
- `docs/`：产品文档（本文件）、英文产品 doc、发版流水线、变更记录、方案图绘制纪律。
- `test/`、`scripts/`：自检套件与真机探针。

## 现有依据

- 功能清单与产品约束：本文档（合并自原根 `PRODUCT.md` 与根 `README.md`）。
- 带截图的使用指南：根 `README.md`。
- 逐版本历史与验证记录：`docs/CHANGELOG.md`。
- UI 评审与落地证据（0.3.13 → 0.3.25）：工作区 `outputs/svn-viewer-ui-review/20261124-critique-v8/report.html` 第 12–17 节。
- 0.3.25 复跑测试计数：suite 60/60、dom 174/174、render 8/8、smoke 9/9、office-browser 5/5。

## 产品原则

- 让仓库位置与修订上下文便于快速查看。
- 把导航与文件查看保持在同一个工作区内。
- 清楚呈现只读操作与搜索限制。

## 发版与记录（Release & logs）

- 发版流水线、版本规则与验证口径：[`RELEASE.md`](RELEASE.md)（docs/RELEASE.md）。
- 逐版本变更记录（完整历史）：[`CHANGELOG.md`](CHANGELOG.md)（docs/CHANGELOG.md）。