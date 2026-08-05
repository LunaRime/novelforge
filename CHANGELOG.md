# Changelog

## [0.1.5-beta.1] — 2026-08-05（公测版）

### ✨ 新功能
- 模板多语言：内置 Prompt 模板英文版（19 个 content + 10 个系统约束 + 16 个角色定位）+ 俄语版（11 个可编辑模板 + 角色定位），语言切换即时生效（回退链：当前语言 → en-US → 中文）
- 输出语言约束：AI 输出语言与界面语言对齐（非中文语言设置下不再输出中文）
- 日志系统双环境流：开发（dev/内测）DEBUG 全量 → `logs/dev/`；发布（公测/正式）INFO 起 → `logs/`；渲染进程日志落盘 + 全局错误捕获
- 构建版本三分类：内测版跳过便携版 7z 压缩；产物四分类归位（alpha/beta/stable/historical）

### 🐛 修复
- 提示词模板编辑保存后回退内置中文（全局自定义加载链路断裂——加载函数从未被调用、保存后未置标志；含加载/保存竞态防护）（GitHub #19）
- 内置模板内容仍为中文（GitHub #18）
- Windows 控制台中文日志乱码（dev 脚本切换 UTF-8 代码页 + 非 TTY 去 ANSI 色）

## [0.1.4-20260804] — 2026-08-04（内测版）

### ✨ 新功能
- Agent 思考等级：六个独立等级（快速/迅捷/平衡/深思/深度/全力），六档温度计滑块选择器（大圆球头 + 填充深度绑定 + 端点贴合），引擎提示词六分支
- 状态栏水温控制：右下角温度计图标 + 0-2 滑块 + 严谨/平衡/创意预设（300ms 防抖写盘，作用于默认模型）
- 工作台草稿箱/正式稿可折叠；项目结构侧栏全部件卡片化（SidebarGroup）
- 知识库章节排序（导入时间/章节号/名称）；编辑区知识库视图优先（残留 Tab 不再抢占检索界面）

### 🐛 修复
- LLM 流式请求 120s 硬超时（超长文本生成被截断）——流式无超时，取消由 AbortController 管理
- Gemini provider 多 system 消息合并（systemRole 丢失 → 模型无角色约束）
- 批量蓝图/补缺口补传 staticContext（架构入 system 前缀，缓存命中 + 遵从度）
- 蓝图模板加输出纪律（章节范围/禁止架构外设定/输出长度锚）
- 生成方式由用户选择：单次生成（费用最低）/ 分批生成（每批 N 章，质量更稳）

## [0.1.4] — 2026-08-03

### ✨ 新功能
- 分卷模块：长篇小说按卷组织章节（卷列表/进度徽标/卷内章节导航），支持手动建卷、按卷数自动划分、按卷批量生成蓝图、蓝图编辑器卷归属徽标
- 写作增强：偏好记忆（记录用户对 AI 文本的替换，写稿时注入「用户偏好 X 而非 Y」）+ 迭代式自省终审（审计报告 → 终审 Agent 建议清单 → 主 AI 重写 → 再审计，最多 2 轮，重写稿另存新版本）
- 审计升级：词频审计升级为「水文与重复结构检测」（跨章基线频率 + 句子重复 + 句首模板），支持项目级白名单（words/patterns/sentences）
- 导入小说：角色图谱按角色分节生成（角色名标注 + 矛盾交织网），不再只有一句话
- 角色卡：定稿后标签/核心动机自动更新闭环（模板 → 解析 → 写库 → 存储格式统一 → UI 刷新）

### 🐛 修复
- 渲染性能：流式输出共享限频调度（定稿 7 路并发后处理不再卡顿，10fps 封顶）
- 悬浮弹窗统一：全局 title 拦截双保险（原生提示无出现窗口）
- 编辑器双弹窗清理：选中文字只显示一个 Bubble Menu（删除废弃 InlineAIToolbar）
- 角色图谱/角色卡标签不更新（7 断点全修）
- 工作台/项目结构运行链：摘要走主连接（只读连接 -shm 脆弱性）、跨项目切换竞态、编辑器保存后侧栏不刷新、工作流运行期间侧栏全树重渲染

### 🧹 其他
- 补测试：repository 内存 DB 集成（node:sqlite）+ 审计上下文降级路径，164 → 180

## [0.1.3] — 2026-08-03

### ✨ 新功能
- AI Agent 添加上下文：`@` 提及可添加项目内可读文件（搜索/路径预取）与项目外文件（系统对话框选择）
- AI Agent 输入框可视化添加上下文：`+` 菜单 → 文件选择器（搜索 + 外部文件）
- LLM 防缺陷工具模块：计算器 / 未回收伏笔注入 / 角色声音档案注入 / 冷门设定采样
- 生成后六类正文质量审计（重复词/衔接/术语/蓝图完成度/违禁词/时间线）
- 字数统计统一口径（汉字 + 英文词）与 `count_characters` 工具

### 🐛 修复
- 工作台草稿 Tab 名称缺失章节号；正式稿保存链断裂（伪协议路径误写磁盘）
- AI 对话 `+` 菜单点击无反应（useOutsideClick mousedown 抢先卸载菜单）
- @ 提及中文标点失效、空结果吞回车；外部文件沙箱拦截、含空格路径截断
- 悬浮弹窗旧样式根因（流式 appendText 缓冲节流）
- [VOICE:] 声音档案只写不更新（幂等合并）

### 🧹 其他
- 仓库清理：移除误跟踪的收款码/原始图/构建缓存/模板遗留文件

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
