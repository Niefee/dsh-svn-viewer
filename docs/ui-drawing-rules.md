# 方案图绘制纪律（0.1.17 起）

背景：v5 方案图凭记忆画控件形态（页签画成带框分段、关闭钮画成宽按钮），与 0.1.16 真实界面不符，审阅时产生歧义。自 v6 起执行以下纪律：

1. **先截真实界面**：任何 UI 方案图先取当前版本真实截图（或按真实截图 1:1 复刻的 HTML 模板）为底图。
2. **只标要改的元素**：未改动区域保持复刻原样；改动/新增元素用橙色虚线框 + 编号标出。
3. **图例三要素**：每个编号在图例中写清「改什么 + 何时出现 + 何时不出现」。
4. **控件形态以代码为准**：按钮/页签/chip 的几何与配色对照 `lib/client.js` 内 CSS（`.svn-btn`、`.svn-tabs`、`.svn-chip` 等），不凭印象画。
5. **状态色统一**：蓝描边=动作（`.svn-btn.act`）、蓝实=主 CTA（`.svn-btn.primary`）、绿=成功瞬态/缓存命中（`.svn-btn.ok` / `.svn-vstat .dot.ok`）、红只留给失败与重试（`.svn-btn.danger`）；关闭预览是幽灵图标（`.svn-ibtn.close`），不再用红色。**注意：当前 DSH 主题的 `--dsw-alias-brand-primary` 实为黑灰（`--dsw-static-neutral-bluish-1000`）**，插件动作蓝一律用自置 `--svn-act`（亮=`--dsw-static-blue-600`、暗=`--dsw-static-blue-400`，见 `lib/client.js` CSS），不得再引 brand-primary 当蓝色；绿/红继续用 `state-success/error-primary`（主题中为真绿/真红）。
6. **头部行几何（0.2.0 起）**：文件头 `.svn-fhd` 58px 两行身份，右侧动作 28px（下载按钮高 28、图标按钮 28×28、圆角 7）；页签行 `.svn-tabbar` 38px，右侧视图控件区 24px 高（`.svn-vbtn` / `.svn-vico` / `.svn-pg`）；按钮与输入统一 8px 圆角（`--svn-r1`），只有状态 chip 保持胶囊；内容区不再自带工具条（0.1.x 的 `.svn-viewbar` 已并入页签行）。
7. **浮层（0.2.2 起）**：下拉面板与菜单统一用 `--svn-surface`（白 / 暗 `#20252c`）+ `--svn-pop-shadow`（1px 描边 + 2px 贴边阴影 + 36px 扩散）+ 圆角 12；行悬停用 `--svn-hover`（品牌蓝 7%），当前项 `--svn-hover-on` + 2px 左蓝条；元信息 chip 只做浅底文字，不再用灰色填充；行内删除只在悬停/聚焦出现。不要再给浮层用 `--dsw-alias-bg-overlay`（本主题里它是 #E9ECF2 的灰面，会和内容只差一档明度）。