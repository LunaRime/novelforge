# 设计文档：CCR 上下文压缩进阶 + 历史记忆文件化 + 上下文占用可视化

日期：2026-08-21
状态：设计定稿（经多轮代码核实与评审拍板）

## 1. 背景与目标

NovelForge 的 Agent 对话系统当前对上下文采用**丢弃式硬截断**：会话历史超预算即丢最早消息，无摘要、无恢复、无占用可见性。本设计借鉴 headroom 的 CCR（Compress-Cache-Retrieve，可逆压缩）机制思想，将其落地为三件事：

1. **对话上下文压缩进阶**：把「丢消息」升级为「滚动摘要」（自研轻量 CCR），压缩后可展开恢复原文
2. **历史记忆文件化**：会话记忆（M1）+ 作品记忆（M2，章节/分卷/全书三级摘要 .md）双记忆层，UI 可查看 AI 历史记忆
3. **上下文占用可视化**：对话面板预算条 + 压缩事件卡片

**决策边界（已拍板）**：
- 不接入 headroom-ai npm 包（需本地 proxy 进程，等于重构直连式 LLM 调用链；且其压缩模型英文为主）——自研轻量 CCR，压缩模型复用用户配置的 LLM
- 「历史记忆」拆两层：会话记忆回答「对话到哪、用户要什么」，作品记忆回答「故事里发生了什么」，系统提示词内**分节注入、分预算**，防止 token 双计挤压
- 作品记忆聚合粒度：章节级摘要 → 分卷级摘要 → 全书状态；「十几章一个文件」是聚合产物粒度（存储主档仍是 chapter 级 DB 行 + volumes 分卷表）
- 上下文占用可视化：对话面板内（预算条 + 压缩卡片），数字统一走 `estimateTokens`

## 2. 现状盘点（事实核查）

| # | 现状 | 位置 | 结论 |
|---|------|------|------|
| 1 | 直连式 ReAct，无 HTTP proxy | `agent-engine.ts:135` 直接 `generateFn` | headroom 代理不可行 |
| 2 | 4000-token 滚动窗口硬丢弃 | `agent-store.ts:456-469`（`HISTORY_MAX_TOKENS = 4000`） | 升级为滚动摘要 |
| 3 | 每轮 16K 预算压缩（丢弃式） | `agent-engine.ts:36,530` `compressMessagesToBudget` | 保留为最后防线 |
| 4 | 三级注入挂载点 | `context-builder.ts:28-81`（身份 400/L0 800/L1 600/Tool 1200，总上限 3500） | 扩展 M1/M2 记忆层 |
| 5 | 对话纯内存态（无 persist/无 DB 表） | `agent-store.ts` 无持久化 | **P0 必须补持久化** |
| 6 | 模型上限 | `provider-presets.ts` 各模型 `maxTokens`（主流 131072） | 预算条数据源，按当前会话模型动态取 |
| 7 | llm_calls 表 usage 统计 | `database.ts:379`：prompt/completion/total/cost | **无 cached_tokens 列**——缓存命中率无法事后统计 |
| 8 | 精确 token 计数 | `token-budget.ts` `estimateTokens`（gpt-tokenizer + CJK 启发式） | 统一口径 |

## 3. 总体架构

```
AgentConversation (agent-store, 内存态)
  └── 持久化层: ~/.vela/agent-archive/<conv-id>.json   (P0, M1 会话记忆)
        ├── messages        当前活跃消息
        ├── compressed      已压缩批次（保留 2-3 代原文，可展开恢复）
        └── rollingSummary  滚动摘要（M1）

作品记忆 (P1, M2): {project}/.vela/memory/*.md
  ├── chapters-NNN-NNN.md   章节级摘要（15 章滚动，按分卷边界对齐）
  ├── volume-{n}.md         分卷级摘要（分卷定稿/检查点重建）
  └── book-state.md         全书状态（低频重建）

系统提示词注入（修正后顺序）:
  身份(400) → L0 项目(800) → L1 编辑器(600) → Tool(1200)
  → M2 作品记忆(≈800) → M1 会话摘要(≈300)    [总上限 ~4700]
```

**注入顺序原则（CacheAligner）**：稳定内容前置。Tool 描述稳定（~1200 tokens）必须在记忆层之前；M2 比 M1 稳定（仅定稿/检查点变），故 M2 在 M1 前——M1 压缩更新时不会把 M2 拖失效。压缩事件发生时历史物理删除、前缀本来失效，这是 CCR 固有代价；缓存收益只存在于**两次压缩之间**。

## 4. P0：对话持久化 + CCR 滚动摘要 + 压缩卡片 + 预算条

### 4.1 会话持久化层（P0 最重要补项）

`~/.vela/agent-archive/<conv-id>.json` **是会话的唯一持久化层**（不是 store 之外另开缓存）。AgentConversation 无 projectId（`agent-store.ts:38`），会话天然跨项目，放全局目录与数据模型一致；`~/.vela` 是既有 VELA_HOME 约定（templates/skills/mcp_config 同处）。

```json
{
  "id": "conv-id",
  "title": "会话标题",
  "mode": "balanced",
  "modelId": null,
  "roleplayCharacter": null,
  "projectPath": "E:/projects/xxx",
  "projectName": "xxx",
  "createdAt": 1755780000000,
  "updatedAt": 1755780123000,
  "messages": [ { "id": "m1", "role": "user", "content": "...", "createdAt": 0 } ],
  "compressed": [
    { "batch": 1, "original": [ /* 被压缩的原始消息 */ ], "summary": "…", "compressedAt": 0 }
  ],
  "rollingSummary": "…"
}
```

- **元数据快照**：`projectPath`/`projectName`/`roleplayCharacter` 在会话创建时快照。**P0 仅用于展示与提示**：恢复会话时若当前打开项目与快照不一致，提示「此会话基于项目 X，当前打开项目 Y」（不静默改用快照项目）；会话级项目上下文注入（恢复后按快照项目构建 L0）放 P2 跨会话复用，避免 P0 范围膨胀
- **写盘时机**：消息追加/压缩完成后写盘（防抖，遵循 `save-feedback-standard`：成功/失败日志 + toast 区分手动/自动）
- **恢复**：应用启动扫描 archive 目录，加载会话列表（消息惰性加载）；存档文件走主进程 fs 通道（UTF-8）
- **删除同步**：`deleteConversation` 同步删除对应 archive 文件（主进程 fs 通道 + loadSeq 保护），防止 archive 越删越多
- **压缩批保留策略**：`compressed` 保留最近 2-3 批原始消息（防摘要漂移），更早批次仅存 summary 摘要

### 4.2 CCR 滚动摘要（agent-store 升级点）

替换 `agent-store.ts:456` 的 4000-token 硬丢弃：

1. **触发**：构造 historyMessages 时超 `HISTORY_MAX_TOKENS`（4000）才压缩——阈值触发，非每轮
2. **批次选择**：从最旧消息起，累积 token 到超预算的那批（**过滤 tool observation**——一次性中间产物，不进入持久历史；也过滤 system）
3. **摘要生成**：调用用户配置 LLM（走 budget 路由档，温度 0.2）生成「对话摘要」：关键事实/用户指令/未完成任务/已确认决策。**rollingSummary 迭代规则**：第 N 次压缩的输入 = 旧 rollingSummary + 新压缩批原文，输出**覆盖** rollingSummary（增量式：防漂移且控成本，第 N 次成本与第 1 次相当而非随历史增长）；压缩批自身的摘要单独存 `compressed[].summary` 供压缩卡片展示，与 rollingSummary 解耦
4. **摘要注入**：**注入 system prompt 尾部标注节**「会话摘要（自动生成，非用户输入）」——不注入历史消息数组（user 角色消息会被模型当成用户输入，破坏轮替语义，多 provider 有结构风险）；与 M2 注入方式统一
5. **原文保留**：压缩批移入 `compressed`（保留 2-3 代），第 2-3 次压缩后才物理丢弃——防摘要漂移
6. **失败降级**：LLM 压缩失败 → 回退硬截断（headroom 同款 stash 失败 fallback 语义），不阻断对话
7. **费用审计**：压缩调用计入 llm_calls（usage 落库）

### 4.3 系统提示词注入（context-builder 扩展）

```
buildAgentSystemPrompt 新增：
  5. M2 作品记忆节（P1 生效，P0 空）      ~800 tokens
  6. M1 会话摘要节（标注「自动生成」）     ~300 tokens
总上限 3500 → ~4700（各节独立预算，超限裁剪 M1 → M2 → L1 → Tool 顺序降级）
```

### 4.4 压缩事件卡片（UI）

消息流中插入事件卡片：「已折叠 N 条历史，摘要如下」+ 摘要内容 + 「展开恢复」按钮——点击读回 `compressed` 对应批次原文（渲染为只读折叠区）。

- 这是 CCR 的**可解释性出口**：用户知道旧内容去哪了、压缩了什么
- 卡片同时显示该批压缩节省的 token（`原始 token - 摘要 token`）

### 4.5 上下文预算条（UI）

对话面板底部一条：

```
[基础 3.5k | 记忆 0.3k | 历史 4.0k | 当前 0.2k] 8.0k / 131k (6%)
```

- 分段：**基础段**（身份+L0+L1+Tool，**不含记忆**）+ **记忆段**（M1/M2）+ historyMessages + 当前消息 vs **当前会话模型 maxTokens**（`provider-presets` 动态取）。⚠️ 记忆注入在 system prompt 内，故 system 段定义为基础段、记忆单独成段，**不得双计**；P1 加 M2 后记忆段约 1.1k
- 数据源：`estimateTokens`（统一口径，不另起估算）；压缩时显示压缩前后对比

## 5. P1：作品记忆三级摘要 + 记忆查看器

### 5.1 文件结构（M2）

```
{project}/.vela/memory/
├── chapters-001-015.md   # 章节级摘要：15 章滚动，优先按分卷边界对齐（有分卷按分卷，无分卷按 N 章）
├── volume-1.md           # 分卷级摘要：分卷定稿/检查点重建，绝不在每轮对话生成
└── book-state.md         # 全书状态：每 3-5 分卷或手动重建
```

章节摘要模板字段：章节号/标题/关键事件/角色出场/伏笔埋设与回收/新设定元素/当前状态。

### 5.2 生成时机与失效规则

| 层级 | 生成时机 | 失效触发 |
|------|----------|----------|
| 章节级 | 定稿后处理 DAG 新增**非关键步骤**（try/catch 容错，同 `content_audit` 模式——非关键步骤失败不得拖垮 workflow） | 重定稿旧章；章节插入/删除；卷成员变更 → 受影响区间文件标记 `stale` 待重建 |
| 分卷级 | 分卷定稿/检查点（用户手动触发或定稿完成时） | 卷内章节摘要重建后联动 |
| 全书 | 每 3-5 分卷或手动 | 分卷摘要重建后联动 |

- **失效标记**：文件 frontmatter `status: stale` + 记忆查看器显示「待重建」；下次进入对话/手动触发时重建
- 章节增删改卷的**边界漂移**与重定稿共用同一条失效规则（受影响区间的文件统一标记）

### 5.3 M2 注入

- 注入 system 内分节（~800 tokens 预算内节选：book-state 精要 + 当前分卷摘要 + 最近章节摘要）
- 完整文件走现有 `read_file` 式工具按需读取（不每轮全量注入）
- M2 内容变化（定稿后）不破坏前缀缓存（M2 在 Tool 之后、前缀稳定段之外）

### 5.4 记忆查看器（UI）

「AI 历史记忆」查看窗口（入口：AI 面板工具栏 + 项目结构侧栏记忆组）：

- 作品记忆：memory/ 目录文件列表（章节/分卷/全书三级）+ 内容查看 + 手动重建按钮 + stale 徽标
- 会话记忆：archive 会话列表 + 滚动摘要查看 + 压缩批次展开
- 只读为主，手动重建是唯一写操作（P2 才开放手动编辑）

## 6. P2：增强（方向）

- 跨会话记忆复用（SharedContext 式：把高频事实沉淀进 M2 或偏好记忆）
- 全局 token 统计面板（跨会话用量，结合 llm_calls）
- 记忆手动编辑（记忆文件编辑器）
- CacheAligner 效果验证：需 **llm_calls 加 cached_tokens 列（v14 迁移）**——当前无此列，缓存命中率无法事后统计（`database.ts:379` 仅 prompt/completion/total/cost）

## 7. 关键技术点

- **token 口径**：全链路 `estimateTokens`（gpt-tokenizer + CJK 启发式），不另起估算
- **压缩调用模型**：复用三层模型路由 budget 档（JSON 提取/摘要类任务），温度 0.2；llm_calls 落库 **purpose 独立为 `ccr_summary`**（区别于 agent 面板调用的 `agent`，P2 缓存命中/成本统计可区分，一行改动）
- **分卷定稿触发条件**（留实施计划确认）：建议 = 卷内章节全部定稿 或 用户手动检查点
- **文件写盘**：主进程 fs 通道 + UTF-8 强制（日志系统同款教训）
- **竞态防护**：跨项目/多会话并发写盘用模块级序号（loadSeq 模式，`character-data-standard`）
- **i18n**：记忆文件内容是用户作品数据保持原文；UI 文案（压缩卡片/预算条/查看器/摘要标注节）全部 t() 三语，新增 ~30 key

## 8. 风险与坑位

| 风险 | 应对 |
|------|------|
| 摘要漂移（早期事实失真） | `compressed` 保留 2-3 代原文 + 摘要文件版本化 |
| token 双计挤压 | M1/M2 分节分预算（M1 300 / M2 800），超限按 M1→M2→L1→Tool 顺序降级 |
| 重定稿旧章摘要过期 | 失效规则统一标记 stale 待重建（同 `4cfde8c` updatedAtChapter 回写事故教训） |
| **M2 文件边界漂移**（章节增删/卷成员变更） | 受影响区间统一标记 stale，与重定稿共用失效规则 |
| **~/.vela 卸载时整目录递归删除**（`update-controller.ts:131`） | M1 archive 放全局目录是**预期行为**（卸载清数据），写进文档避免误报 bug |
| 压缩 LLM 调用失败 | 降级硬截断，不阻断对话 |
| 压缩成本 | 阈值触发 + budget 路由 + 温度 0.2 |
| 跨项目/多会话写盘竞态 | loadSeq 模式 |
| 缓存命中（CacheAligner） | 稳定内容前置（Tool 在 M 层前）；压缩导致前缀失效是 CCR 固有代价，缓存收益只在两次压缩之间 |

## 9. 测试策略

- **P0 纯函数单测**：压缩批次选择（最旧累积、observation 过滤）、预算条各段计算、archive 序列化/反序列化（含旧格式/损坏兼容）、摘要节注入顺序与预算裁剪、压缩卡片节省 token 计算
- **P1 纯函数单测**：失效规则（重定稿/章节增删/卷变更 → 受影响区间）、章节摘要模板组装、M2 节选逻辑
- **迁移测试**：现有惯例是只测迁移 SQL 字符串逻辑、不建 DB 实例（`electron/database.test.ts`——better-sqlite3 与 vitest 的 Node ABI 不兼容）；v14 cached_tokens 加列拟引入 **node:sqlite 内存 DB** 实测（Node 23 支持，**本次提议、非项目惯例**），P2 实施前先单独验证一次可行性
- **组件测试（jsdom）**：压缩卡片渲染/展开、预算条分段、记忆查看器列表与 stale 徽标

## 10. 分期与验收标准

### P0：对话持久化 + CCR 滚动摘要 + 压缩卡片 + 预算条（独立可交付）

- [ ] archive 持久化：长会话刷新后完整恢复（消息 + 滚动摘要 + 压缩批次）
- [ ] 超 4000 tokens 自动生成摘要卡片，可展开恢复原文，显示节省 token
- [ ] 摘要注入 system 尾部标注节，不破坏 user/assistant 轮替
- [ ] 预算条实时准确（基础段/记忆段/历史/当前 vs 当前模型上限，无双计）
- [ ] 质量门禁：tsc 零错误 / eslint 零警告 / 测试全过

### P1：作品记忆三级摘要 + 记忆查看器

- [ ] 定稿后 chapters-NNN-NNN.md 自动生成/增量更新；分卷定稿生成 volume-N.md
- [ ] 失效规则生效（重定稿/章节增删/卷变更 → stale 标记）
- [ ] M2 注入 system（预算内节选 + 工具按需读全文）
- [ ] 记忆查看器可浏览三级记忆、查看 stale、手动重建

### P2：跨会话复用 / 全局统计 / 手动编辑 / v14 cached_tokens 迁移
