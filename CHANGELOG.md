# Changelog

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
