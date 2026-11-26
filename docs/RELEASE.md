# 发版流水线（dsh-svn-viewer）

适用：以本地 `file:` 依赖安装进 DSH web profile 的本插件。包名 `@local/dsh-svn-viewer`，tgz 产物在 `dist/`（当前 0.3.26）。

## 流水线（每次发版按序执行）

1. **回归**：逐条跑自检（命令与计数见 [PRODUCT-zh-CN.md 的自检节](PRODUCT-zh-CN.md)）：suite / dom / render / smoke / office-browser 全绿；再对运行中的宿主跑 `node scripts/check-live.mjs`。
2. **版本 bump + CHANGELOG**：改 `package.json` 版本（默认只递增 patch，规则见下），并在 `docs/CHANGELOG.md` 顶部补一条——改了什么都记，不只是版本号。
3. **打包**：在仓库目录执行 `pnpm pack` → `dist/local-dsh-svn-viewer-<版本>.tgz`。`files` 已含 `lib`、`assets`、`docs`、`README.md` 等，`docs/CHANGELOG.md` 随包发出。（`files` 里遗留的根 `CHANGELOG.md` 条目已无对应文件，pack 会忽略；下次改 `package.json` 时可顺手清理。）
4. **同步 profile**：把 web profile `package.json` 里本插件的 `file:` 依赖改指新 tgz——文件名含版本号，必须手改，pnpm 不会自动追新；然后在 profile 目录执行 `pnpm install`。profile 路径形如 `%USERPROFILE%\.dsh\profiles\web\package.json`（依赖键 `@local/dsh-svn-viewer`，值形如 `file:<仓库绝对路径>/dist/local-dsh-svn-viewer-<版本>.tgz`）。
5. **复查安装副本**：在 profile 的 `node_modules` 里找到本插件安装目录，核实两点：
   - `Get-Item <安装目录> | Select-Object FullName, LinkType` → `LinkType` 必须为空（说明是 tgz 拷贝安装，而非 link/junction）；
   - 安装副本 `package.json` 的 `version` 必须等于新版本。
6. **删旧包**：删除旧版本 tgz，`dist/` 只留最新一个。
7. **热更**：`plugin_manager` `action=set_plugin target=include:svn-viewer`，先 `enabled=false` 再 `enabled=true`，客户端内存热更，无需重启。
8. **宿主半改动需重启**：`lib/index.js`（路由/宿主逻辑）改动必须重启 `dsh web` 才生效；只改 `lib/client.js` 刷新页面即可。未重启前 check-live 的「宿主版本」项会 FAIL，Office 提取与导出走浏览器端兜底仍应通过。

## 版本规则（2026-11-20 用户明确）

- **默认只递增 patch**（0.3.25 → 0.3.26 …）。即使这次改动是新增能力或宿主接口变化，也仍然只递增 patch，只在条目末尾标注「新能力」或「（需重启 dsh web）」。
- **minor 仅在用户明确要求时**才动（例如「升到 0.4.0」）；不擅自改中间位。
- 每次交付仍然是**唯一版本号**：本地安装链（profile `file:` + pnpm 缓存）用版本号当缓存键，同名 tgz 不可靠，所以同一版本不重复发包。
- 每次发包都补一条变更记录（现位于 `docs/CHANGELOG.md`）。

## 验证口径

- **headless 截图**：Chrome 必须带 `--run-all-compositor-stages-before-draw`，且逐条命令跑（不合并执行），保证合成器完成后再取帧。
- **真 390 窄屏**：用 CDP `Emulation.setDeviceMetricsOverride` 设真实 390 视口，不要只缩窗口；验收 sw=cw、无横向溢出。
- **深色量测**：对比度与自动聚焦必须在**激活 tab + 禁 CSS transition** 后量测——后台 tab 会冻结 transition 与 rAF，造成误报（0.3.18 曾因此误报，0.3.19 起记入 CHANGELOG）。
- **真机优先 bsk 借 tab**（browser-skill borrow 用户已登录的 GUI tab）；CDP 仅作兜底（bsk 不可用时）。本机 CDP 的 HTTP `/json` 端点返回 404，只能走 WS：端口与 WS 路径读 `%LOCALAPPDATA%\Google\Chrome\User Data\DevToolsActivePort`，连 `ws://127.0.0.1:<port>/devtools/browser/<id>`。
- **check-live**：对运行中的 dsh web 真机自检，不需要 GUI token；若路由会话鉴权 401 失效，改用 CDP 页内验证（0.3.13 曾遇）。