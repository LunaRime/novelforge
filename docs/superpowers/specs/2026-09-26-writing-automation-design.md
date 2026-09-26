# 写作自动化（D 档）设计

> **Status**: 设计已获批准（2026-09-26 用户确认三态全做、应用内执行、四类触发器全做），待实施。
> **依据**: `docs/superpowers/plans/2026-09-08-agent-capabilities-plan.md`（§3.1 D 档新增 / §7.1-D 条目 D1-D3 / §8 第 2 条）
> **参照实现**: Denova `internal/automation/`、`internal/app/automation/`、`web/src/features/automations/`（源码级调研已完成，关键发现见 §2 决策记录）

## 1. 目标与非目标

### 1.1 目标

让 NovelForge 从「人工触发的创作工具」变成「能持续产出」的流水线：用户定义**自动化任务**（跑什么 + 何时跑 + 产出如何处置），应用在运行时自动触发、执行、并把产物送进**收件箱**等待确认或直接落库。

首落地的三个真实场景：

1. **每 3 章定稿 → 自动跑后处理管线**（剧情提取 / 角色更新 / 伏笔扫描）—— 不需要每次手动点
2. **每晚检查 → 提醒"该更新了 / 有伏笔长期未回收"**（`notify_only`）
3. **批量产出**：触发一次「写下一章」的 Agent 任务或章节创作工作流，产物入箱逐条确认

### 1.2 非目标（明确不做）

- **主进程后台执行**：本次执行宿主 = 渲染进程（应用开着才跑）。但执行层抽象为可替换接口，为将来搬迁留口子（用户决策）
- **`purpose=write_confirmation`（产出写入前的二次确认）**：Denova 这条链路只有消费方没有生产方（残缺），NF 的信息架构里"确认运行"已覆盖主场景，不做
- **跨项目自动化**：任务归属于单个项目（与 checkpoint「每项目一库」的语义一致），跨项目编排不在本次范围
- **触发器条件的自由脚本**：不支持用户写 JS 表达式，四类触发器是唯一的表达方式

## 2. 决策记录

### 2.1 用户拍板的三条

| # | 决策 | 理由与影响 |
|---|---|---|
| D1 | **执行对象两选一**：触发器定义时选「跑某个工作流」或「发起某个 Agent 任务」 | Denova 只跑 Agent 会话（其工作流引擎弱）；NF 反过来，DAG 工作流是核心资产 → 两者都要，设计面翻倍但能力最全 |
| D2 | **执行宿主 = 应用内**，执行层抽可替换接口 | 工作流执行器（15 个命令）全在渲染层，搬主进程是架构级改造，不应混进本次范围 |
| D3 | **四类触发器全做**（manual / schedule / chapter_batch / semantic） | semantic 要多一次 LLM 调用链（有界上下文 + 证据校验 + 阈值），成本换"自然语言条件"的表达力 |

### 2.2 两处刻意偏离 Denova

| # | Denova 的做法 | 我们的做法 | 理由 |
|---|---|---|---|
| X1 | `EffectiveActionPolicy` **恒为 `auto_run`**（`trigger_config.go:127-129` 写死，触发器级 action_policy 在归一化时被清零）→ `confirm`/`notify_only` 只剩读旧数据的兼容路径，**收件箱的"确认运行"按钮在正常流程中永不出现** | **三态真做**：`auto_run` / `confirm` / `notify_only` 都是可配置且完整实现的状态 | 用户明确要收件箱的价值；照抄这个收敛会让整套审批 UI 变成死代码 |
| X2 | `purpose=write_confirmation` 只有消费方没有生产方 | **不做该 purpose** | 不移植残缺链路（§1.2 非目标） |

### 2.3 从 Denova 学到的三个具体设计

1. **schedule 用区间回溯而非"下次触发时间"**（`schedule.go:84-151`）：只持久化 `last_checked_at`，每次 tick 判断 `(last_checked, now]` 区间内是否有命中点 → 停机期间错过的触发点在启动后一次补齐
2. **chapter_batch 只看非空章节、取最后一个完整批**（`trigger_evaluation.go:53-115`）：`batchNumber = floor(非空章节数 / N)`，指纹 = 批号 + 该批章节标识列表（**不含字数/时间戳**，同批内容后续编辑不重复触发）
3. **触发器评估是 claimed → decided → completed 的可恢复状态机**：NF 用 SQLite 事务简化（见 §5.3），无需 Denova 的文件租约

## 3. 数据模型

### 3.1 DDL（项目库，schema v18）

```sql
-- 自动化任务定义（项目级）
CREATE TABLE IF NOT EXISTS automations (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  enabled               INTEGER NOT NULL DEFAULT 1,
  -- 执行目标（两选一；D1 决策）
  target_type           TEXT NOT NULL CHECK (target_type IN ('workflow', 'agent')),
  -- workflow: 工作流类型标识（如 'post_process'）；agent: 任务提示词（Markdown 文本）
  target_ref            TEXT NOT NULL,
  -- 可选的 Agent 会话策略（target_type='agent' 时生效）
  session_strategy      TEXT NOT NULL DEFAULT 'per_run' CHECK (session_strategy IN ('per_run', 'per_task')),
  -- per_task 策略复用的会话 id（首次运行时创建并写回；per_run 时恒为 NULL）
  session_id            TEXT,
  -- TriggerDefinition[] 的 JSON
  triggers              TEXT NOT NULL DEFAULT '[]',
  default_action_policy TEXT NOT NULL DEFAULT 'confirm'
                        CHECK (default_action_policy IN ('auto_run', 'confirm', 'notify_only')),
  -- per-trigger 去重状态（JSON：{ [triggerId]: { lastCheckedAt, lastFingerprint } }）
  trigger_state         TEXT NOT NULL DEFAULT '{}',
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

-- 收件箱（产出待审 / 仅通知）
CREATE TABLE IF NOT EXISTS automation_inbox (
  id            TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  trigger_id    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'confirmed', 'dismissed', 'auto_run')),
  action_policy TEXT NOT NULL CHECK (action_policy IN ('auto_run', 'confirm', 'notify_only')),
  title         TEXT NOT NULL,
  summary       TEXT NOT NULL,
  -- TriggerEvidence[] 的 JSON：[{ source, title, ref, snippet }]
  evidence      TEXT NOT NULL DEFAULT '[]',
  -- 触发身份（去重键；同一指纹只入箱一次）
  fingerprint   TEXT NOT NULL,
  -- 关联的执行（confirm 后写入；auto_run 时直接写）
  run_id        TEXT,
  -- 执行失败原因（不静默：用户要在卡片上看到）
  action_error  TEXT,
  created_at    INTEGER NOT NULL,
  read_at       INTEGER,
  handled_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_automation_inbox_status ON automation_inbox(status, created_at DESC);
-- 同一触发指纹只入箱一次（§7.1；DB 层兜底，防止调度竞态产生重复条目）
CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_inbox_fingerprint
  ON automation_inbox(automation_id, fingerprint);

-- 运行记录
CREATE TABLE IF NOT EXISTS automation_runs (
  id            TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  trigger_type  TEXT NOT NULL CHECK (trigger_type IN ('manual', 'schedule', 'chapter_batch', 'semantic')),
  target_type   TEXT NOT NULL CHECK (target_type IN ('workflow', 'agent')),
  -- 可追踪引用：workflow → workflow runId；agent → conversationId
  ref_id        TEXT,
  status        TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed', 'aborted')),
  summary       TEXT,
  error         TEXT,
  evidence      TEXT NOT NULL DEFAULT '[]',
  started_at    INTEGER NOT NULL,
  finished_at   INTEGER,
  -- 恢复用：应用重启时若 run 仍 running 且对应执行已不存在，需按此判断
  recovery_state TEXT
);
CREATE INDEX IF NOT EXISTS idx_automation_runs_task ON automation_runs(automation_id, started_at DESC);
```

时间戳统一 `INTEGER`（毫秒，与 `workflow_checkpoints` 的 `unixepoch()*1000` 一致）。

### 3.2 迁移

`electron/database.ts` 的 `user_version` 递增至 **v18**，迁移内容为上述三个 `CREATE TABLE IF NOT EXISTS` + 索引（幂等，符合 `db-migration-standard`）。迁移失败不阻断应用启动（与既有迁移一致），但需在日志中可见。

## 4. 触发器评估

### 4.1 类型与统一签名

```ts
// src/services/automation/types.ts
export type TriggerType = 'manual' | 'schedule' | 'chapter_batch' | 'semantic'
export type ActionPolicy = 'auto_run' | 'confirm' | 'notify_only'

export interface TriggerDefinition {
  id: string
  type: TriggerType
  enabled: boolean
  name?: string
  /** 触发器级策略；缺省时用任务的 default_action_policy */
  actionPolicy?: ActionPolicy
  /** type='schedule' 时必填 */
  schedule?: Schedule
  /** type='semantic' 时必填：自然语言条件，如「未回收伏笔超过 20 条」 */
  semanticCondition?: string
  /** type='chapter_batch'：批次大小，缺省 3，下限 1 */
  chapterBatchSize?: number
}

export interface Schedule {
  kind: 'daily' | 'weekly' | 'monthly' | 'hourly'
  hour?: number
  minute?: number
  weekday?: number
  dayOfMonth?: number
  everyHours?: number
}

export interface TriggerEvidence {
  source: string   // 'chapter' | 'foreshadowing' | 'character' | ...
  title: string
  ref?: string     // 章节号 / id
  snippet?: string
}

export interface TriggerMatch {
  triggerId: string
  title: string
  summary: string
  evidence: TriggerEvidence[]
  /** 触发身份指纹：同指纹只处置一次 */
  fingerprint: string
}

/** 评估上下文：所有外部事实由调用方注入（纯函数可测） */
export interface TriggerContext {
  now: number
  /** 定稿章节（含字数为 0 的占位章节，评估时过滤） */
  chapters: Array<{ number: number; title: string; wordCount: number }>
  /** 停机区间回溯的下界（上次检查时间）；首次为 undefined */
  lastCheckedAt?: number
  /** semantic 专用：模型调用（注入以便测试 mock） */
  callModel?: (prompt: string) => Promise<string>
}
```

评估函数签名（除 semantic 外全为同步纯函数）：

```ts
export function evaluateSchedule(trigger: TriggerDefinition, ctx: TriggerContext): TriggerMatch | null
export function evaluateChapterBatch(trigger: TriggerDefinition, ctx: TriggerContext): TriggerMatch | null
export async function evaluateSemantic(trigger: TriggerDefinition, ctx: TriggerContext): Promise<TriggerMatch | null>
// manual 不参与自动评估（由「立即运行」按钮直接构造 TriggerMatch）
```

### 4.2 schedule（区间回溯）

**不持久化"下次触发时间"**。每次评估：

1. 取 `ctx.lastCheckedAt`（无则用 `ctx.now - 60_000`，即首次只回溯一分钟，避免首次运行刷出历史全部触发点）
2. 计算区间 `(lastCheckedAt, now]` 内是否存在命中点（按 `kind` 展开：hourly 每 N 小时 / daily 每日某时刻 / weekly 每周几 / monthly 每月几号）
3. 有命中点 → 产出 `TriggerMatch`，`fingerprint = schedule:<triggerId>:<命中点时间戳>`
4. 无 → null

这样停机 3 天后启动，一次评估会**一次性补出** 3 天内错过的所有触发点吗？—— **不**。首次评估只取**区间内最近的一个命中点**（取 `max`），避免启动瞬间刷出几十条收件箱。补出的这一条足以让用户知道"错过的该跑了"，其余不追溯。

### 4.3 chapter_batch（指纹去重）

算法（对齐 Denova `trigger_evaluation.go:53-115`）：

1. 过滤 `wordCount > 0` 的章节 → `nonEmpty`
2. `batchSize = trigger.chapterBatchSize ?? 3`（下限 1）
3. `if (nonEmpty.length < batchSize) return null` —— 不足一批不触发
4. `batchNumber = floor(nonEmpty.length / batchSize)`；取该批 `[batchEnd - batchSize, batchEnd)` 的章节
5. `fingerprint = chapter_batch:<triggerId>:<batchNumber>:<章节号列表 join ','>`
6. 与 `trigger_state[triggerId].lastFingerprint` 相同 → `return null`（同批不重复）

**关键性质**：指纹只跟批号与章节标识走，不跟字数/时间戳 —— 用户在第 3 批的章节里继续改稿不会再次触发；第 4 章定稿使 `batchNumber` 变 2 时才触发新批。

`summary` 用本地模板生成（不调 LLM）：`第 4-6 章已成批（3 章 / 8,412 字），可运行后处理管线`；`evidence` 为逐章 `{ source: 'chapter', title, ref: 章节号, snippet: 章节标题 }`。

### 4.4 semantic（唯一异步 + 唯一有 LLM 成本）

流程（对齐 Denova 的安全边界）：

1. **有界上下文**：取**最新**的非空章节（倒序，上限 20 章 —— 最近的内容才反映当前状态），每章正文截断至 **1200 字符**，总预算 **64KiB**（Denova 是 256KiB，NF 侧收紧）；evidence 候选上限 **64 条**
2. **调用模型**：`ctx.callModel`（由调度器注入；模型固定走**三层路由的 budget 层** —— `getModelForPurpose('classify')`，理由：判定是轻量分类任务）
3. **指令约束**（写死在提示词里）：证据不足必须 `matched=false`；`confidence < 0.55` 不触发；`evidence_refs` 只能引用上下文里出现过的 ref/title；只输出 JSON
4. **解析与校验**：`{ matched, confidence, reason, title, evidence_refs[] }`；校验 confidence ∈ [0,1]、refs ⊆ 上下文集合（越界即整条丢弃并记日志 —— "编造证据"必须拦下）
5. `matched && confidence >= 0.55` → 产出 `TriggerMatch`，`fingerprint = semantic:<triggerId>:<hash(condition + 章节指纹)>`

**失败降级**：模型调用失败或 JSON 解析失败 → 返回 `null` 并记 `renderLog('warn', ...)`，**不阻断**其他触发器的评估。

### 4.5 manual

不参与自动评估。UI 的「立即运行」按钮直接构造 `TriggerMatch`（`fingerprint = manual:<triggerId>:<now>`），走同一条执行链 —— 保证手动与自动执行路径完全一致。

## 5. 调度器

### 5.1 位置与生命周期

`src/services/automation/scheduler.ts` —— **渲染进程内**，遵循 D2 决策：

- 应用启动后（项目打开时）启动，`setInterval` **60_000ms**
- 项目切换时重启（评估上下文与项目绑定）
- 项目关闭时停止
- **不注册主进程定时器**

### 5.2 单次 tick 流程

```
tick(now):
  1. 若已有 tick 在执行 → 直接返回（单 worker 合并，对齐 Denova trigger_coordinator 的 dirty 合并）
  2. 取当前项目 + enabled 的 automations
  3. 对每个任务：
     a. 构造 TriggerContext（定稿章节列表、lastCheckedAt 来自 trigger_state、callModel 注入）
     b. 逐触发器评估（semantic 串行 await，其余同步）
     c. 对每个 TriggerMatch：
        - 指纹 === trigger_state[triggerId].lastFingerprint → 跳过
        - 否则按策略分流（§7.1）
     d. 事务内写入：更新 trigger_state + 入箱/建 run
  4. 记录 tick 结果到 renderLog（debug 级）
```

### 5.3 恢复语义（对 Denova 状态机的 SQLite 简化）

Denova 用 claimed → decided → completed 三阶段 + 文件租约保证"评估被中断后可恢复且不重复"。NF 的等价保证来自 **SQLite 事务**：

- 「写 trigger_state 指纹」与「建收件箱条目 / 建 run」**在同一事务内完成** → 不存在"指纹已更新但产物没落库"的中间态
- 若在事务提交前应用退出 → 本次评估整体丢失，下次 tick 重新评估（`lastCheckedAt` 未推进）→ **语义上是"重试"而非"重复"**
- 应用重启后对 `automation_runs` 中 `status='running'` 的记录：检查 `ref_id` 对应的执行是否仍存在（workflow runId 在 workflow-store / agent 会话在 agent-store）；不存在 → 标记 `aborted` 并把 `recovery_state='interrupted'`，供 UI 提示

## 6. 执行层

### 6.1 接口（可替换宿主，D2 决策）

```ts
// src/services/automation/executor.ts
export interface ExecutionHandle {
  refId: string          // workflow runId 或 conversationId
  kind: 'workflow' | 'agent'
}

export interface AutomationExecutor {
  /** 启动执行（不等待完成）；返回可追踪引用 */
  start(task: AutomationTask, match: TriggerMatch): Promise<ExecutionHandle>
  /** 查询执行是否仍存活（用于恢复判定） */
  isAlive(handle: ExecutionHandle): Promise<boolean>
}
```

将来搬主进程只替换 `AutomationExecutor` 的实现，调用方零改动。

### 6.2 workflow 目标

调 `workflow-starter` 的对应入口启动工作流。**需要一处配套改造**：

- `workflow-store.startWorkflow` 增加可选参数 `options?: { headless?: boolean }`
- `headless: true` 时**跳过** `:426-429` 的强制开面板逻辑（底栏 + AIOutputPanel），其余行为不变（checkpoint、事件、状态流转全保留）
- 自动触发一律传 `headless: true`；用户手动点按钮保持现状

`refId` = `startWorkflow` 返回的 runId。完成/失败通过订阅 `WORKFLOW_COMPLETE` 事件回写 `automation_runs`。

### 6.3 agent 目标

调 agent-store 起一轮会话：

- `session_strategy='per_run'`：每次新会话，标题 `[自动化] <任务名>`；`refId` = 新 conversationId
- `session_strategy='per_task'`：复用 `automations.session_id` 绑定的会话（首次运行时创建并写回该列）
- 注入的用户消息 = 任务 `target_ref`（提示词）+ 触发来源摘要 + 证据列表（NF 侧实现为 `buildAutomationUserMessage(task, match)`）

`refId` = conversationId；完成通过 agent-store 的生成结束回写。

## 7. 收件箱与三态策略

### 7.1 状态流转（X1 决策：三态真做）

| ActionPolicy | 触发时行为 | 收件箱条目 | 可执行操作 |
|---|---|---|---|
| `auto_run` | **立即执行**（§6） | 写入一条 `status='auto_run'` 的记录（已处理态，仅作历史） | 查看产出 |
| `confirm` | **不执行**，入箱等确认 | `status='pending'` | 确认运行 / 忽略 / 查看证据 |
| `notify_only` | **不执行也不提供执行** | `status='pending'` | 标记已读 / 忽略（**无确认运行按钮**） |

- 「确认运行」→ 调执行层启动 → `status='confirmed'` + 写 `run_id` + `handled_at`
- 执行失败 → `action_error` 写入条目（**卡片上可见**，不静默；对齐 Denova `automation_inbox` 的 `action_error` 字段）
- 「忽略」→ `status='dismissed'` + `handled_at`（**不删除**，保留证据链供回溯）
- 同一 `fingerprint` 只入箱一次（DB 层 UNIQUE 索引兜底：`CREATE UNIQUE INDEX ... ON automation_inbox(automation_id, fingerprint)`）

### 7.2 UI

**入口**：底部面板新增 `inbox` tab（与现有 `tasks` / `log` 并列，`BottomPanel.tsx:18-21` 的 Tab 定义处扩展）。未处理条目数显示为徽章。

**条目卡**（对齐 Denova `AutomationInboxPanel.tsx` 的信息密度，但按 NF 的 UI 标准实现）：

- 标题行：状态点（未读亮度区分）+ 任务名 + 时间
- 摘要正文（`summary`）
- **证据列表**：默认显示前 3 条，每条 `source · title · ref`，snippet 两行截断；超过 3 条显示"还有 N 条"可展开
- 操作行：按 §7.1 的表格决定渲染哪些按钮；`notify_only` 条目显式标注"仅提醒"
- 失败条目：`action_error` 以 error 色展示

**自动化配置入口**：设置页新增「自动化」分区（列表 + 新建/编辑/启停/删除 + 「立即运行」）。触发器编辑用表单（类型选择 → 各自的必填项），不做自由 JSON 编辑。

## 8. 错误处理

| 场景 | 行为 |
|---|---|
| 触发器评估抛错 | 捕获并记 `renderLog('error')`，**该触发器跳过**，同任务的其余触发器继续 |
| semantic 模型调用失败 / JSON 非法 / 证据越界 | 返回 null + warn 日志（不阻断，见 §4.4） |
| 执行启动失败（如无默认模型） | 收件箱写 `action_error`；`auto_run` 策略下则记 run `status='failed'` + error |
| 执行中途失败 | 由 workflow/agent 自身的失败语义承担；`WORKFLOW_COMPLETE` 回写 run 状态 |
| 应用重启时有 running run | §5.3 的恢复判定 → 存活则继续跟随，不存在则标 `aborted` |
| 项目未打开 | 调度器不运行（自动化是项目级概念） |

## 9. 测试策略

| 层 | 方式 |
|---|---|
| 触发器评估（§4） | **纯函数全量单测**：时间注入（`ctx.now`/`lastCheckedAt`），覆盖"停机跨越多个触发点只补一个""同批章节编辑后不重复触发""章节数刚好是 N 的倍数""semantic 证据越界被丢弃""confidence 低于阈值不触发" |
| 调度器（§5） | 注入时钟 + mock 评估函数，验证：单 worker 合并、指纹跳过、事务原子性（模拟写入失败 → 状态不推进） |
| 执行层（§6） | mock `workflow-starter` 与 agent-store，验证两个目标的 refId 与完成回写；`headless` 选项单测（不触发面板） |
| 收件箱（§7） | DB 层测试（三态流转、fingerprint 唯一约束、级联删除）+ 组件测试（按 policy 渲染正确的按钮集） |
| 端到端 | 不写自动化 E2E（渲染进程 + 定时器难稳定），由各层单测 + 手动验收覆盖 |

## 10. 与现有系统的边界

| 现有系统 | 关系 |
|---|---|
| `workflow-store` | 被 `workflow` 目标调用（新增 `headless` 选项）；**不改其执行语义**（checkpoint、事件、续跑全部保留） |
| `agent-store` | 被 `agent` 目标调用（复用会话与生成链路）；**不改其对话语义** |
| 工具审批层（A 档） | **无交集**：自动化是用户预先授权的任务（定义时即授权），不在每次工具调用上再走 `requiresConfirmation`。但 `start_workflow` 工具的 `requiresConfirmation` 保持不变 —— 那是 **Agent 主动调用**的场景，与自动化触发是两条路径 |
| 底部面板 | 新增 `inbox` tab（与 `tasks` 并列），不改 `tasks` 的行为 |
| `post_process` 工作流 | 可被自动化触发（"每 3 章"的主场景）；其原本的"定稿时自动跑"行为**保持不变**，自动化是额外的触发源 |

## 11. 文件结构（实施时的落点）

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/services/automation/types.ts` | 全部类型 | 新建 |
| `src/services/automation/triggers.ts` | 四类触发器评估 | 新建 |
| `src/services/automation/semantic-trigger.ts` | semantic 的上下文构建 + 提示词 + 校验 | 新建 |
| `src/services/automation/scheduler.ts` | tick 循环 + 事务写入 | 新建 |
| `src/services/automation/executor.ts` | `AutomationExecutor` 接口 + 两实现 | 新建 |
| `src/services/automation/store.ts` | DB 读写（automations / inbox / runs） | 新建 |
| `src/stores/automation-store.ts` | Zustand：任务列表、收件箱、调度器开关 | 新建 |
| `electron/database.ts` | schema v18 迁移 | 修改 |
| `electron/controllers/db-controller.ts` | 新 IPC 通道（automation CRUD / inbox 操作） | 修改 |
| `src/stores/workflow-store.ts` | `startWorkflow` 增 `headless` 选项 | 修改 |
| `src/components/panels/BottomPanel.tsx` | 新增 `inbox` tab | 修改 |
| `src/components/panels/automation/*` | 收件箱条目卡等 | 新建 |
| `src/components/settings/*` | 自动化配置分区 | 新建/修改 |
| `src/shared/locale-data/*` | 三语文案 | 修改 |
