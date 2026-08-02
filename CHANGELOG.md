# Changelog

## [0.1.2] — 2026-08-03

### ✨ 新功能
- 项目工作台：点击左侧项目方块 → 打开项目并进入聚焦「章节蓝图 / 草稿箱 / 正式稿」的工作台
- 左侧活动栏项目方块列表（彩色方块 + 首字识别，悬停三行提示，最多 5 个滚动）
- 设置新增「技能库」：导入 .md 技能文件到 ~/.vela/skills（管理/删除）
- 设置新增「MCP 服务器」：添加/删除服务器、连接/断开、状态指示
- 进入工作台前置检查：故事架构未填充完成时弹窗提示（可跳转填充或关闭）

### 🐛 修复
- LLM 缓存命中误报：改为解析 API 真实 cachedTokens（此前启用缓存即算命中，费用与统计不真实）
- Gemini JSON 约束失效（缺 responseMimeType）——结构化输出幻觉缓解补齐
- 工作台草稿无法定稿：改用 vela://draft/{真实id} 路径（parseDraftMeta 可解析）
- 切换项目竞态：openProject 异步期间用户切走的视图不再被覆盖
- 角色编辑区残留：角色 Tab 与视图绑定（切走自动关闭）
- 自动打开配置 Tab 导致关闭不了（移除）
- i18n 残留修复（角色列表标签/默认参数/日志/toast/Invalid Date 时间戳保护）
- 安装程序：完成按钮卡死修复（runAfterFinish: false）+ NSIS 3.08 界面清晰化 + DPI 感知

### ⚡ 优化
- LLM 静态上下文（架构）移入 system 前缀：同项目连续调用缓存命中率提升
- 渲染测试基础设施（jsdom）：工作台/方块列表/历史项目 12 个新测试

## [0.1.1] — 2026-08-02

### ✨ 新功能
- 每日活动热力图（GitHub 风格）：跨项目聚合 + 费用统计 + 项目维度切换
- 下拉控件现代化（Radix Select：圆角/阴影/动画/选中态），修复 Modal 内下拉无法打开
- 国际化全面完成：组件层/数据层/工作流/错误提示/主进程对话框全部 t() 化（~215 处），语言切换即时生效（含主进程）

### 🐛 修复
- 活动数据查询兼容旧库 cost 列缺失（活动面板加载失败）
- 时间/月份格式化跟随当前语言（原固定 zh-CN）
- 项目 UI 层级残留中文国际化（章节蓝图/写作第N章/字数单位等 9 处）
- 提示词模板显示层数据/显示分离（语言切换即时更新）
- 工作流/确认弹窗/toast 错误提示国际化（46 处）

## [0.1.0] — 2026-07-27

### 🚀 初始发布
- 版本号从 `2.5.2` 重置为 `0.1.0`，遵循 SemVer 2.0.0 0.y.z 约定
- 首个对外可用发布版，后续按语义化版本规则递增

## [2.3.0] — 2026-07-17

### 🔴 严重 Bug 修复
- 🐛 修复伏笔保存/加载键名不匹配导致跨章追踪完全失效（`foreshadowingAll`→`pendingForeshadowing`）
- 🐛 修复角色声音分析 upsert 时用空字符串覆写角色 role/appearance/personality 等字段
- 🐛 `DraftRepository.updateContent()` 添加事务保护，防止正文与字数不一致
- 🐛 伏笔 ID 碰撞修复：`Date.now()` 改为内容哈希 + 去重

### 🔒 安全
- 🔒 Prompt 变量插值添加 `=== USER_INPUT_START/END ===` 指令边界分隔符
- 🔒 `.npmrc` 移除 `onlyBuiltDependencies=*`，改用 `package.json` 白名单
- 🔒 Electron BrowserWindow 添加 CSP（通过 session API）
- 🔒 `electron-env.d.ts` 修复 `Window.ipcRenderer`→`Window.velaAPI`

### 🛠️ 架构改进
- ⚡ 12 个数据库索引添加（drafts/revisions/reviews/post_process_steps/llm_calls）
- ⚡ Schema 迁移失败回滚（失败时不递增 `user_version`）
- ⚡ `updateContent` 事务保护、配置原子写入（temp+rename）
- ⚡ LLM Provider 429/503 检测
- ⚡ 大文件导入 50MB 守卫
- ⚡ 渲染进程崩溃自动重载（`render-process-gone`）

### 🌍 国际化
- 🌐 创建 `src/shared/locale.ts` 集中管理 `DEFAULT_LOCALE`
- 🌐 消除 27 处 `'zh-CN'` 硬编码
- 🌐 新增 `formatLocaleDate/Time/DateTime` 工具函数

### 🧹 工程改进
- 🧹 移除未使用的 `diff-match-patch` 和 `experimentalDecorators`
- 🧹 CI 切换为 `pnpm` + 添加 lint 步骤，重命名为 `build.yml`
- 🧹 新增 `typecheck`/`build:vite` 分步脚本
- 🧹 10+ 处空 catch 块添加错误日志
- 🧹 魔法数字 3000 提取为 `DEFAULT_WORDS_PER_CHAPTER` 常量
- 🧹 删除孤立 `package-lock.json`，清理 dist-electron 旧构建产物
- 🧹 `.eslintrc.cjs` 添加 `electron/` Node.js override + `no-explicit-any`
- 🧹 新增 `.vscode/launch.json` 调试配置
- 📝 `rule.md` 技术栈版本号更新
- 📝 新增 `CHANGELOG.md` 和 `src/shared/constants.ts`

### 汇总
- 六轮代码审查共发现 ~130 项可改进点，累计修复 48 项
- 累计修改文件 40+，新增文件 6 个，删除文件 2 个

---

## [2.2.0] — 2026-07

### 安全
- 🔒 Electron BrowserWindow 添加 Content-Security-Policy（通过 session API）
- 🔒 Prompt 变量插值添加指令边界分隔符，防御 prompt 注入攻击
- 🔒 `.npmrc` 移除 `onlyBuiltDependencies=*` 通配符，改用 `package.json` 白名单

### 修复
- 🐛 空 catch 块添加错误日志，避免静默吞错（6 文件 10 处）
- 🐛 `toDraftMeta()` 等废弃函数添加更清晰的迁移提示
- 🐛 Schema 迁移失败时不再递增 `user_version`，防止数据库永久不一致
- 🐛 配置文件改为原子写入（临时文件 + rename），防止并发写竞态
- 🐛 LLM Provider 添加 HTTP 429/503 状态码检测和可操作的错误消息
- 🐛 大文件导入添加 50MB 大小守卫，防止 OOM

### 改进
- ⚡ `drafts`/`revisions`/`reviews`/`post_process_steps` 表添加 10 个缺失索引
- ⚡ `3000` 等魔法数字提取为 `DEFAULT_WORDS_PER_CHAPTER` 共享常量
- ⚡ 渲染进程崩溃时自动提示重载
- 📝 `rule.md` 更新技术栈版本号
- 🧹 清理 `dist-electron/` 旧构建产物
- 🧹 删除孤立 `package-lock.json`

---

## [2.1.1] — 2026-06

### 修复
- 修复 Windows 安装程序兼容性问题
- 修复构建产物路径问题
