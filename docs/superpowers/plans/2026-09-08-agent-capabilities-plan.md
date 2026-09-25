# Agent 能力升级：评审 + 排期（A/B/C/D 四档）

> **Purpose:** 评审 NovelForge Agent 能力的升级提议，输出价值/成本/风险评审 + 分档排期，作为后续细化实现计划（SDD）的起点。
> **Status:** 规划草案（2026-09-08）。用户裁定：DSH 插件**移植完整（拉源码学习并自建）**、**全部排期**、**写入本规划文档**。
> **2026-09-25 合并**：并入 **Denova 源码研究**（`D:\Code\denova`，Apache-2.0，克隆快照 2026-09-18）——
> 用户见「有人用同类项目写小说赚钱」，要求取其精华去其糟粕后与本档合并为一份（见 **§7**，排期修订见 **§3.1 / §7.3**）。
> 至此本档有两个外来参照：DSH 生态插件（§4）+ Denova（§7）。
>
> **执行状态（2026-09-13 审计）：⏸️ 未实施。** 本档只交付了评审与排期（`af90a2d`、`f648afd`），**A/B/C 三档无任何实现提交**：
> A 档——`src/services/llm/model-router.ts:44` 的 `PURPOSE_TIER_MAP` 仍为静态 purpose→tier，无 `/models` 自动拉取、无多模型 UI；B 档——`src/services/agent/tools/` 30 个文件中无 refine 工具、无 context 一卡；C 档——全库 `subAgent|hindsight|knowledgePage` **0 命中**。
> **2026-09-25 更正一处**：A 档③「自动拉取 provider `/models`」**已被后来的工作覆盖**（模型供应商账户，`llm:list-provider-models` 等 4 通道，`87678b4`）→ A 档实际只剩 ①路由动态决定 ②每层多模型 UI（另见 §3.1 新增的③④）。
> 计划 §8 指定的下一步（**A 档细化为 SDD 计划**）尚未产出。**本档没有 checkbox；若日后回填，须注意它描述的是「评审/排期」动作，不代表各档已实现。**
> **基线:** master @ `f0c2949`（L2 checkpoint 迁 DB 完成）；Denova 研究部分基线 = NovelForge master @ `536ec72`（2026-09-25）。

## 1. NovelForge Agent 现状矩阵

| 能力 | 现状 | 说明 |
|---|---|---|
| Agent 循环 | **单 agent**（`agent-engine`）循环 + 工具调用 | tool-registry + 20+ 工具 |
| 工具 | 23 个（read/write/edit-file、start-workflow、search-knowledge、read-drafts/blueprint/characters、embed-text、compare-texts、update-config 等） | `RefineParagraphsCommand` 在 **workflow 层**（editor 气泡「润色」用），**未暴露为 agent tool** |
| 记忆 | preferences 表（用户替换偏好）+ 知识库 RAG（向量检索）+ CCR 会话压缩 | **无**跨会话「会学习」长期记忆（hindsight 式：自动保存/召回/知识页/反思/按仓库隔离） |
| 上下文 | context-builder / context-usage / ccr-summary（构建 + token 用量 + 压缩） | **无**可视化 context 面板（分类/演进/压缩事件） |
| 工作流 | workflow-store（DAG 流水线，多任务并发，stepByStep 确认） | 输出到「任务面板」+ M2 输出文件 |
| 模型路由 | 三层预设（`PURPOSE_TIER_MAP` purpose→tier 静态映射 + 用户可配每层模型列表） | 静态路由，非「主 agent 动态决定」 |
| **工具审批** | `requiresConfirmation` 是**工具级静态标志**（7 个工具：`call-external-api` / `edit-file` / `index-content` / `open-editor` / `start-workflow` / `update-config` / `write-file`），由 `ConfirmCard` 弹一次性批准 | **无**批准记忆（全仓无 `alwaysAllow`/`approvedTools` 类结构）→ 同一工具每次都要再问；**无**参数语义判断；**无**危险操作分类（硬拒绝或区分展示都没有） |
| **技能** | SKILL.md 三来源（builtin / `~/.novelforge/skills/` / 项目级），兼容 Cursor 生态，带 `allowedTools` 白名单与 `whenToUse` | 只有**两个注入面**：提示词列清单（`agent-store.ts:203`）+ `/命令` 时**全量注入**正文（`:416-422`）。**缺**「模型自主按名懒加载」的工具面 —— 清单里 23 个工具没有 `skill` 工具 |
| **记忆驻留策略** | 作品记忆三级 markdown（章节/分卷/全书）+ 知识库向量检索 + 偏好表 | **无**「常驻 vs 按需」的显式分层：哪些设定必须每轮进上下文、哪些走检索，目前没有可编辑的载体 |
| **自动化触发** | workflow-store 的 DAG 流水线（9 类工作流），**由人工或 agent 显式启动** | **无**触发器（定时 / 每 N 章 / 语义判定），**无**产物审批收件箱 |

## 2. 提议评审

### 提议 1：AI 改写自动调用 RefineParagraphs 等编辑工具
- **现状**：「润色/扩写/精简/风格/冲突」走 editor 气泡方案 = 纯 LLM 流式 + `RefineParagraphsCommand`（段落差异）。不走 agent 工具。
- **价值**：高——AI 改写可控（可读上下文/项目数据）、与 agent 工具链统一、可复用编辑能力。
- **成本/风险**：中高——需 agent↔编辑器**在位归档通道**（agent 结果回写到编辑器 CM 实例）+ 工具封装 + undo/并发语义。
- **技术要点**：分两步（见排期 B 档）——① 把 RefineParagraphs 封装为 agent tool（读选区/段落 + 生成改写 + 返回 diff，低成本）；② 在位编辑流（agent 工具改编辑器内容，复用 L1 inline-accept 的 CM 通道思想，中高成本需设计）。

### 提议 2：Agent 输出样式学习主流 AGENT 工具 + hindsight 长期记忆
- **Agent 输出样式**：NovelForge 已有 XML tool_call/tool_result 协议；可借鉴 DSH 主流 agent 样式（思考/工具/进度分节清晰、终止语义）。低-中成本。
- **hindsight 长期记忆**（@vectorize-io/hindsight-coding-agents v0.5.1）：
  - **行为契约**（运行环境第一手）：知识页（curated 持续更新的项目知识）+ 记忆 bank（git 决策/会话/摄入原始记忆）+ 按仓库隔离 + 自动召回/保存 + 深度反思（过去决策/规则）+ 捕获 initiative（捕获变更中的计划）。
  - **NovelForge 映射**：复用已有 **LanceDB 向量库 + RAG 检索**做记忆存储；新增 knowledge-page 模型（curated 项目知识）；接入 agent context（检索召回注入）；会话完成/提交时自动摄入；反思（跨会话检索）。
  - **移植成本**：**高**——需记忆 bank schema + 知识页模型 + 自动摄入接点 + 检索注入 agent context + 反思触发 + 知识页编辑 UI。DSH 的 hindsight 深度耦合 harness（会话捕获/gitlog/工具注入），NovelForge 需自建这些接点。
  - **风险**：中——记忆质量/漂移（陈旧记忆需纠正机制）、隐私（用户本地即可，NovelForge 本地优先符合）、体积。

### 提议 3：多 AGENT 并发 + 主 AGENT 拆分派发 + 用量统计改 dsh-context 面板
- **多 agent 并发/拆分派发**：
  - NovelForge **当前无**（单 agent + workflow 多任务并发）。要加「主 agent 拆分任务 → 派发子 agent → 回收结果」的编排层（AgentTeams 式）。
  - **行为**：子 agent 生命周期、上下文隔离、独立结果、汇合/评审、失败回收。
  - **成本**：**高**——编排层（任务 DAG 生成、子 agent 调度、结果汇合、评审）、子 agent 上下文管理、并发/取消语义。
  - **风险**：中高——子 agent 质量、上下文成本、结果一致性。
- **dsh-context 上下文洞察面板**（v0.38.5）：
  - **行为**：Context 仪表盘 + /context 命令 + Context 浏览器（分类组成/内容详情/演进趋势/压缩注入事件/统计）。
  - **NovelForge 映射**：复用现有 context-builder / context-usage / ccr-summary 数据（context 分类、token 用量、压缩事件）→ 可视化面板 + 命令。
  - **移植成本**：**中**——面板 UI + 数据聚合（数据已有）；DSH 的 context 面板深度耦合 harness（Session/Service），NovelForge 用现有数据自建面板。
- **「任务 vs 工作流输出」展示归属**：需明确 agent 产物（对话/工具结果）与 workflow 产物（步骤执行/输出文件）的展示边界——见 §5。

### 提议 4：模型路由由主 AGENT 决定 + 多模型 + 自动拉取
- **现状**：三层预设静态路由（elite/standard/budget + purpose→tier 映射，用户可配每层模型列表）。
- **提议**：① 路由策略（可选）改「主 agent 根据任务类型/复杂度动态决定 tier/model」——比静态目的映射更智能；② 用户可添加多模型（已支持模型配置，可能需要 UI 增强加多 model per tier）；③ **自动拉取模型**（从 provider /models 接口拉取的可用模型列表，更新默认模型/候选）。
- **价值**：高（路由智能化 + 模型自动更新，相对独立）。
- **成本**：**中**（相对独立，改动 model-router + 模型配置 UI + provider /models 拉取）。
- **风险**：低——需模型兼容性考量（provider 返回模型可能与 NovelForge 不兼容，需白名单/校验）。

## 3. 排期（档 A/B/C；**D 档与修订见 §3.1**）

### A 档（Quick，独立快速，优先做）
- **提议 4**：模型路由主 agent 决定（可选策略）+ 用户多模型 + 自动拉取/更新默认模型。
- **工作量**：中（model-router 扩展 + provider /models + 设置 UI）。
- **价值**：高；**风险**：低；**依赖**：无（独立）。
- **建议**：最先做（成本低价值高）。可细化为 SDD A 档计划。

### B 档（中，需设计）
- **提议 1 第一步**：RefineParagraphs 封装为 agent tool（读选区 + 生成改写 diff + 返回）。低成本。
- **提议 3 第一步（context 面板低成本路径）**：只做「Current Context 构成」一卡（基于现有 context-builder + usage-store 直构）+ /context 命令。**约 3-5 人日**（dsh-context 全量事件流 25-40 人日留 C 档，见 §4）。
- **「任务 vs 工作流输出」展示归属设计**（§5）。
- **工作量**：中高（B 档主体 = 工具化 + 一卡面板 + 展示归属）；**风险**：中；**依赖**：A 档后的 agent 基建。

### C 档（重，架构级）
- **提议 3 多 agent 拆分派发**：编排层（主 agent 拆任务 → 子 agent → 汇合/评审）。高成本。
- **提议 1 在位编辑流**：agent 工具改编辑器内容（复用 L1 inline-accept CM 通道思想）。中高成本。
- **提议 2 hindsight 长期记忆**：retention/consolidation 引擎 15-25 人日 + harness 接点 3-5 人日（总 ~18-28 人日；关键难点 = 自建「LLM 事实提取→知识页合成」引擎 + 按 project 隔离 + 会话/提交摄入接点）。
- **dsh-context 全量**（若做）：自建规范化会话事件流 + 投影管道 + 9 卡 UI（~25-40 人日；**关键依赖** = 可审计的 NovelForge 规范化会话/文本书写事件流）。
- **Agent 输出样式**（DSH 主流样式）：低-中成本，可穿插 C 档。
- **工作量**：高；**风险**：中高；**依赖**：B 档后的 agent/context 基建。

### 依赖/里程碑
```
A 档（模型路由+自动拉取） ──→ B 档（工具化 + context 面板 + 展示归属）
                                     └──→ C 档（多 agent 拆分 + 在位编辑流 + hindsight 记忆）
```
- A 档独立先行；B 档依赖 A 的 agent 基建成熟；C 档最重最后。

### 3.1 2026-09-25 修订（并入 Denova 研究后的排期）

> 逐条依据与证据在 **§7**；这里只给结论。**原 A/B/C 三档保留**，改动如下：

| 档 | 变动 | 内容 |
|---|---|---|
| **A** | ③ 划掉 · **+2 项** | ③「自动拉取 `/models`」**已由供应商账户实现**；新增 **③′ 工具审批语义规则 + workspace 级批准记忆**、**④′ 危险操作硬拒绝清单**（两者都是 NF 真空白、成本低、§7.1-A） |
| **B** | **+3 项** | ⑤′ 技能第三面（模型自主 `skill` 工具懒加载 + 有界引用）；⑥′ 压缩**可证明性**（真实请求重算 + `Degraded` 标记 + 原文永不删可重生成）+ 稳定前缀认证 + 副作用回执（protected receipt）；⑦′ context 明细弹层按 Denova 分区补齐（轮次分组 / 单段来源与字节 / 复制 / 移除当前压缩） |
| **C** | **降本 + 换路线** | 多 agent 拆分派发**有完整参照设计**（`task` 工具 + mailbox 汇合 + untrusted 标注 + 子 Session 权威 + 幂等 TaskRef）→ 成本从「高」降为「中高」；长期记忆**先从 lore 式 `resident/on_demand` 分层起步**（§7.1-C），hindsight 引擎（18-28 人日）降为可选 |
| **D（新增）** | **独立一档** | **写作流水线自动化：触发器（每 N 章 / 定时 / 语义判定）+ 审批收件箱（证据链 + confirm/dismiss）+ 跑批会话**。价值最高（直接对应「批量产出」——用户见到的「靠它赚钱」很可能就是这条），成本中高，与 A/B/C 无依赖 |
| — | **待裁决（不排期）** | **外部执行引擎**（Denova 支持 Native / Codex CLI / Claude Code CLI 三选，复用本机登录）—— 这是产品定位级决策，动它意味着 NF 成为他人 agent 的前端；需你拍板 |

**建议执行序**：A（含新增两项）→ D（自动化，价值最高）→ B → C。
理由：A 的新增两项便宜且直接补安全空白；D 是「用它能持续产出」的关键且与 A 无依赖；B 是上下文工程质量账；C 最重。

## 4. DSH 插件移植评估（源码级细化，来自源码分析）

> 已拉取 hindsight（v0.5.1）/ dsh-context（v0.46.0）源码到 `.superpowers/sdd/plugin-source-study/` 分析。二者都不是「复制代码能落地」，核心在自建引擎/事件流。

### hindsight-coding-agents（长期记忆）—— 中等难度，约 18-28 人日
- **架构**：client→server 记忆系统，接入层不存记忆，调 HTTP（cloud/self-hosted/daemon 后端）。NovelForge 二选一：①内嵌 server/daemon；②把 retain/recall/reflect **重写到自己的 LanceDB + LLM 路由**（推荐，本地优先，成本低）。
- **harness 适配层极小**（3-5 人日）：`ChatReader`(读会话) + `HarnessAdapter.createRuntime`(绑 hook)。DSH 只绑 4 事件：session-start→seed、pre-step→recall+注入、turn-stopping→写回、ctx.tools→注册 `hindsight_*`。NovelForge 等价接点 = 打开项目(seed) / context-builder 组装 system prompt(recall+注入) / 对话完成保存点(写回) / agent 工具注册。
- **真正成本**（15-25 人日）：LLM 事实提取→归纳→知识页合成 的 **retention/consolidation 引擎**（NovelForge 目前只有 LanceDB 检索 + LLM 路由，需自建）。
- **bank 隔离**：`coding-agent::{gitProject}`（harness 中立、worktree-aware）→ NovelForge 改按 project 隔离。
- **需自建**：记忆 bank schema、知识页模型、自动摄入接点（会话/提交捕获）、recall/reflect 重写到 LanceDB+LLM、知识页编辑 UI、注入 agent context。

### dsh-context（context 面板）—— 高难度（全量约 25-40 人日）
- **深度耦合 DSH**：运行时依赖全是 harness 注入 peer（cordis / dsh-session / dsh-settings / dsh-client-ui-primitives / dsh-token-meter 投影）——NovelForge 全无，需自建整套。
- **关键依赖**：一个可审计的「**NovelForge 规范化会话/文本书写事件流**」（user/assistant/tool/request/header/step/compaction/plan·mode）→ 投影注册表+折叠+推送 → token 构成拆分。
- **自建**：规范化会话事件日志、投影注册表/折叠/推送、token 构成拆分；UI 面板 9 卡（Composition/History/Trend/Browser/Events/File Activity/Agent Network 等）。
- **低成本路径**（3-5 人日）：只做「**Current Context 构成**」一卡，基于现有 context-builder + usage-store 直构（不带事件流）。

## 5. 「任务 vs 工作流输出」展示归属（设计原则）

- **区分**：Agent（agent-store 对话，单 agent 循环，工具调用产物）vs Workflow（workflow-store DAG 流水线，步骤执行 + 输出文件）。
- **归属原则**：
  - **Agent 任务**：诊断/分析/跨数据问答/代码/创意建议等「对话式」产物 → Agent 面板（agent-store 会话流）。
  - **Workflow 输出**：确定性多步流水线（写稿/修稿/审稿/定稿/后处理）→ 任务面板 + 输出文件（workflow-output / M2）。
  - **边界**：agent 触发 workflow（start-workflow tool）→ agent 对话显示「已启动 workflow」，执行细节归任务面板；工具结果摘要归 agent，全量归 workflow 输出。
- **待定**：具体哪些字段显示在哪（agent 工具结果折叠 / workflow 步骤详情）由 B 档展示归属任务细化。
- **Denova 的对照（2026-09-25 补，见 §7.1-D3/E1）**：它把**自动化产物收进独立收件箱**（证据链 + confirm/dismiss + 一键拉起对应会话），
  agent 产物则一律是**会话内卡片**（执行折叠块 + 工具调用树 + 文件变更摘要卡）—— 与我们的「AI 输出面板 / 底部任务面板」是两种切法。
  **可借的是它「产物 → 证据 → 打开会话」的三段式**，而不是它的面板划分（它的自动化是独立顶层 mode，我们的是 DAG 任务面板）。

## 6. 非目标 / 风险 / 已知限制

- **非目标**：NovelForge 不直接 npm 安装 DSH harness 插件（耦合 Cordis）；移植 = 自建同能力。
- **风险**：
  - hindsight 记忆漂移（陈旧/错误记忆）→ 需纠正机制（「Correction」文档 + 新事覆盖旧事）。
  - 多 agent 拆分质量/上下文成本 → 需评审/汇合 + 子 agent 上下文预算。
  - 自动拉取模型兼容性 → provider /models 白名单 + 校验。
  - 在位编辑流 undo 语义 → 复用 L1 CM 通道（显式 time/undo 逐级）。
  - **无人值守跑批（D 档，2026-09-25 补）** → token 会自己烧：必须 `ActionPolicy=confirm/notify_only` 为默认、
    每轮跑批有预算上限、且产物进收件箱要人确认才落库（Denova 的做法正是这三条，见 §7.1-D2/D3）。
  - **外部执行引擎（§3.1 待裁决项 / §8 第 4 条）** → 一旦引入他人 CLI 作为执行体，NF 的「模型路由 / 上下文装配 / 记忆注入」全链路绕不过去，
    产品边界与排障责任都会变；这是定位决策，不是工程量决策。
- **已知限制**：A 档模型路由「主 agent 决定」是可选策略，需设计「agent 如何决定 tier」（提示词/规则），避免每次调转成本。

## 7. Denova 源码研究（2026-09-25 合并）

> **为什么看它**：用户见「有人用同类项目写小说赚钱」，拉取源码要求**取其精华、去其糟粕**，并与本档合并为一份。
> **对象**：`D:\Code\denova`（作者 `alfredxw`）——**Apache-2.0**（借鉴无许可障碍），**v0.4.5** 已发布 + `Unreleased` 在途；
> Go 后端 **1506** 文件 / Web 前端 **904** ts·tsx；测试 **436（Go）+ 127（前端）**。克隆快照 **2026-09-18**。
> **形态**：目录即数据模型（`chapters/<卷>/*.md` + `setting/{outline,progress,character-states,lore}`）；单 agent 内核
> + `task` 工具派子 agent + Skills(SKILL.md) + 自动化触发器 + 裸 git 快照版本管理 + 图像/互动分支。
> **调查方式**：四路并行**只读**源码调查（内核与上下文 / 多 agent 与权限技能 / 写作域与自动化 / 前端 UX），
> 结论均带 `文件:行`。⚠️ **实现前逐条复核** —— 本项目既有教训是「审计清单不能照单全改」（批次 3/4 共拦下 7 处失实）。

### 7.1 精华 —— 建议采纳（判定基准：**NovelForge 缺它**；已有等价物的不列）

**A. 安全与协作（→ A 档新增，成本低）**

| # | 条目 | Denova 做法（证据） | NF 现状 |
|---|---|---|---|
| A1 | **审批规则的参数语义边界** | `internal/agents/toolapproval/rule_proposal.go`：shell 命令解析后**仅「单一静态调用 + 已知命令族」可固化为规则**；管道/变量/未知可执行文件一律一次性授权 | 只有工具级静态标志 → 粒度粗（`update-config` 与 `start-workflow` 同级） |
| A2 | **批准记忆的 scope = 仅 workspace 持久** | `config/agent_approval.go` 明注 *deliberately the only persisted scope*；绑 ProjectID、`RuleID=approval-<sha16>`、`ApprovedArgsHash` 审计 | **全无**（同一工具每次都要再问） |
| A3 | **危险操作硬拒绝** | `toolapproval/critical.go` 正则黑名单（`rm -rf /`、fork bomb、`mkfs`、`dd` 写块设备、改 `/etc/passwd`）→ **fail-closed 直接 block**，不是二次确认 | 无危险分类 |

**B. 上下文工程（→ B 档新增）**

| # | 条目 | Denova 做法（证据） | NF 现状 |
|---|---|---|---|
| B1 | **技能第三面：模型自主懒加载** | `internal/agents/skillassembly/assembly.go Bucket`：①提示词只放目录 ②`skill` 工具按名懒加载全文 ③`skill://` 有界引用；三 scope 覆盖 builtin<user<workspace | 只有①②的前半 —— 有清单 + `/命令` 全量注入，**没有 `skill` 工具** |
| B2 | **压缩的可证明性** | `agent/definition_compaction.go:392 validateCompactionProjection`：用**真实请求重算**，no-progress 报错 + `MinimumChangeTokens` + `RecoveryBand=0.8` + `Degraded` 标记 | CCR 压完即信，**无「确实降下来了」的证明** |
| B3 | **原文永不删 + 摘要可重生成** | `agent/compaction/standard.go:114-121`：超限时退回全量原文重生成；投影替换 `effectiveCompactionMessages` | 保留 2-3 代后丢弃 |
| B4 | **稳定前缀认证** | `agent/model_loop.go:264 authenticatedStablePrefixMessages`：middleware 改动了前缀字节 → 缓存命中回退 0 | 有 CacheAligner，但无「前缀未被污染」的认证 |
| B5 | **副作用回执随压缩保留** | `agent/compaction_receipts.go`：失败/副作用类工具的「参数+结论+artifact 路径」≤32 条/32KB 并入 checkpoint，未决优先 → 防重放 | 无 |
| B6 | **context 明细的分区形态** | 弹窗 5 格指标 → System Prompt parts → Final Messages **按轮次分组**；每段可展开看 `source·kind·tool_name·chars/bytes` 并**单段/整组复制**；压缩段显示 `tokens_before→after` + **「移除当前压缩」**；另有 TokenUsage 两层（请求→调用 + 缓存命中率 + `requested→after tools`） | 有占用环 + 明细弹层，缺轮次分组/复制/移除压缩/调用级用量 |
| B7 | **压缩/清理类历史依赖的失效语义** | `agent/canonical_messages.go:77-101`：前缀 hash 失配 → **作废 compaction/clear 等历史依赖 capability** | 只有 `stale` 标记 |

**C. 记忆分层（→ C 档，作为 hindsight 的轻量先行项）**

| # | 条目 | Denova 做法（证据） | NF 现状 |
|---|---|---|---|
| C1 | **`load_mode = resident / on_demand`** | `lore/types.go` + `lore/index.go`：条目带 `type/importance/tags/keywords/load_mode`，`resident` **常驻上下文**，其余走索引渐进披露 | 无可编辑的驻留策略（角色/设定要么全量读、要么全走检索） |
| C2 | **分层覆盖 + Checkpoint 保留偏好** | `features/agents/AgentsView.tsx` 按 layer（default/global/user/workspace）覆盖；`AgentCheckpointSection.tsx` 的保留偏好**只影响未来压缩、不回改历史** | 无 |

**D. 写作自动化（→ 新 D 档，价值最高）**

| # | 条目 | Denova 做法（证据） | NF 现状 |
|---|---|---|---|
| D1 | **写作特有触发器** | `internal/automation/types.go` + `internal/app/automation/trigger_evaluation.go`：`manual` / `schedule`（每天·周·月·每 N 小时）/ **`chapter_batch`（每 N 章非空章节成批，默认 5，指纹去重）** / **`semantic`（LLM 判定 + 证据校验 + 确定性幂等）** | workflow 只能人工或 agent 显式启动 |
| D2 | **审批策略与持久化 run** | `ActionPolicy`（auto_run / confirm / notify_only）+ `RunRecord`（durable run + 义务路径）+ 内置模板（续写章节 / 自动 Review） | 无 |
| D3 | **产物收件箱（证据链）** | `AutomationInboxPanel.tsx`：条目卡含用途/状态、summary、**evidence 列表（source/title/ref/snippet）**、操作（已读/确认运行/确认写入/忽略/查看时间线），`openRun()` **直接拉起对应 Agent 会话** | 底部任务面板无审批卡与证据链 |

**E. 交互与呈现（→ B/C 档落地时参照）**

| # | 条目 | Denova 做法（证据） |
|---|---|---|
| E1 | **子 agent 的 UI** | 父时间线内 `SubAgentSessionCard`（"Output from {name}" + 状态 + 打开），打开则成为**工作台 Tab**（带 `parentTabId`），兜底右侧滑板；轨迹层有 parent Run 返回 + children 折叠列表 |
| E2 | **评论锚点 + 批量回灌下一轮** | `ChangeReviewWorkspace.tsx` 锚点评论（utf8-bytes + revision + quote/prefix/suffix，失配标 `outdated`）+ `ReviewFeedbackTray.tsx` 把选中评论**暂存为下一轮 Agent 输入** |
| E3 | **context 漂移检测** | `features/trajectory/trajectory-content.ts`：逐请求重建模型可见消息，检测 prefix 漂移（shared_prefix/前后条数/reason）与 system/tools 变更 —— 可并入现有明细弹层，不必做整套三泳道 |
| E4 | **审批卡三态** | `Chat/ToolApprovalCard.tsx`：allow-once / allow-workspace / deny（与 A2 的 scope 呼应） |
| E5 | **子 agent 结果标 untrusted** | `agent/tools/task_local_completion.go`：父端以 UserMessage 注入 `TASK_RESULT`，**显式标注 untrusted delegated output** 并截断（超出提示改用 `task observe` 回放）→ 提示注入防护，成本极低 |

### 7.2 糟粕 / 不采纳（附理由，防重复讨论）

| # | 不采纳 | 理由 |
|---|---|---|
| 1 | **目录即数据模型**（`chapters/<卷>/*.md` + 文件名解析 + `chapter_statuses.json`） | NF 的 SQLite（`volumes`/`contents`/`drafts` + `vela://` 内容寻址 + `user_version` 迁移）更强；回退到文件名解析会丢掉事务、索引、迁移与并发安全。**只借两条**：回滚前先建备份版本；`.git` 不落进用户内容目录 |
| 2 | **无内联 diff 采纳** | Denova 只有全宽 diff 工作台 + 选区引用；NF 的 inline accept（L1）**更强**，不降级 |
| 3 | **lore 无关系图**（仅 tags/keywords） | NF 有结构化 `relations` + 关系图谱 |
| 4 | **互动/角色扮演**（多分支、回合版本、Director 模块） | NF 是小说创作 IDE，不是 RP 平台 |
| 5 | **plugins 目录** | 只是编译期 Toolset、**无热插拔无沙箱**，价值仅「统一 ToolDescriptor 契约」；NF 工具注册已等价，扩展面走 MCP |
| 6 | **goja 脚本工具** | 进程内 JS 沙箱与 NF 的 Electron 沙箱模型冲突（主进程是特权层）→ 引入即新增一个权限面，v1 不做 |
| 7 | **`context: fork`** | **Denova 自己都没实现**（`types.go:26` 定义、零消费者）。不抄未验证的设计 |
| 8 | `agent/context` Assembler 的 Fragment/Placement 体系、`agent/state` 文件管理 | Go 架构专属；NF 侧由 `context-builder` + SQLite 承担 |
| 9 | **canonical 提交通道**（Identity + ExpectedRevision + 同事务 checkpoint） | 概念好（产品库为唯一真源），但 NF 的 IPC + better-sqlite3 事务边界已提供等价原子性。**只借 B7 的失效语义** |
| 10 | Agent Profiles 的模型/工具覆盖 | NF 已有等价物（模型 `purposes` + 每层模型列表）。**只借两条**：委派白名单、context slot（stable/session/turn）分层 |
| 11 | 定时快照版本管理（每 10 分钟 / 保留 100） | NF 有 `revisions` 表；且 NF 项目目录不是纯文本工作区，裸 git 快照收益低 |

### 7.3 同一能力的路线取舍（DSH vs Denova）

| 能力 | DSH 路线 | Denova 路线 | 采纳 |
|---|---|---|---|
| 长期记忆 | hindsight 引擎：LLM 事实提取→知识页合成，**18-28 人日** | lore 式分层：`resident/on_demand` + 重要度，复用现有向量检索 | **先 Denova 式**；hindsight 降为可选（仍留 §4 的评估） |
| 上下文面板 | dsh-context 全量 9 卡，**25-40 人日**，且需先自建规范化事件流 | 补在现有明细弹层上：轮次分组 / 复制 / 移除压缩 / 调用级用量 | **Denova 式**；「9 卡全量」不再作为目标 |
| 多 Agent | 无参照（§4 未涉及） | `task` 工具 + mailbox + 子 Session 权威（完整设计） | **Denova 式** |
| 写作自动化 | 无 | 触发器四类 + 策略 + 收件箱证据链 | **Denova 式**（新 D 档） |
| 工具结果落盘 | 无 | artifact + head/tail 预览 + `SupersessionKey` | 部分等价（NF 已有落盘 D6-2）；可补 supersession |

---

## 8. 下一步

1. **A 档细化为 SDD 计划**（本档一直缺的那一步）：model-router 动态路由策略 + 每层多模型 UI + **§7.1-A 的两项审批能力**（A1/A2/A3 可独立成一个小任务，成本低、纯补空白）。
2. **D 档（写作自动化）单独立项**：先出设计（触发器模型 + 审批收件箱 + 与 workflow-store / 任务面板的边界），再排 SDD。**它是本档里唯一直接提升「产出」的档** —— 若「别人靠这类工具赚钱」的机制是批量产出，答案大概率在这条。
3. **B / C 档**在 A 之后按 §3.1 的修订细化；C 档多 agent 落地时以 §7.1-E1 的 UI 形态为参照，长期记忆走 §7.3 的 Denova 式路线。
4. **待用户裁决（本档不排期）**：外部执行引擎（Native / Codex CLI / Claude Code CLI 三选）是否纳入产品方向 —— 这是定位级决策。
5. **参照物位置**：DSH 逐文件分析 `.superpowers/sdd/plugin-source-study/`（含 `plugin-study-report.md`）；Denova 源码 `D:\Code\denova`（快照 2026-09-18，落后上游约一周，需要最新版时先 `git pull`）。

---
*评审 + 排期草案，2026-09-25 与 Denova 源码研究合并。用户已裁定方向（移植完整 / 全部排期 / 写文档 / 取其精华去其糟粕）。*
