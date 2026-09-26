# 写作自动化（D 档）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 NovelForge 能按触发器（每 N 章 / 定时 / 语义条件 / 手动）自动执行工作流或 Agent 任务，产出可进收件箱等待确认、或直接执行、或仅提醒。

**Architecture:** 新增 `src/services/automation/` 子系统：纯函数触发器评估层 → 渲染进程调度器（60s tick + 区间回溯）→ 可替换的执行宿主接口（两实现：workflow / agent）→ 三态收件箱。数据落项目库三张新表（schema v18），指纹去重 + SQLite 事务保证"不重复触发、不丢产物"。

**Tech Stack:** TypeScript（strict）/ better-sqlite3 / Zustand / React 19 / vitest

**Spec:** `docs/superpowers/specs/2026-09-26-writing-automation-design.md`

## Global Constraints

- TypeScript strict（`noUnusedLocals` / `noUnusedParameters`），`tsc --noEmit` 零错误
- ESLint `--max-warnings 0`
- **所有用户可见文本必须 i18n**（zh-CN / en-US / ru-RU 三语，扁平 key 内联在 `src/shared/locale-data/*.ts`）
- 颜色一律用 CSS 变量（`var(--color-*)`），禁止硬编码色值
- 新增 IPC 通道必须三处同步：`src/shared/ipc-channels.ts` 类型、`src/shared/ipc-policy.ts` 权限项、`electron/controllers/*` 的 `guardedHandle` 注册（通道用 `db:` 前缀，已在 preload 白名单内，无需改 preload）
- DB 迁移必须幂等（`CREATE TABLE/INDEX IF NOT EXISTS`），`user_version` 递增，符合 `db-migration-standard`
- 测试命令：`npx vitest run <file>`；全量 `npx vitest run`
- **不引入主进程定时器**（执行宿主 = 渲染进程，spec §2.1 D2）

## Review Focus

- **指纹的稳定性**：`chapter_batch` 的指纹**不得**包含字数/时间戳（否则用户改一个字就再触发一次收件箱）；`schedule` 的指纹必须含命中点时间戳（否则同一触发点被反复吞掉）
- **事务原子性**：`trigger_state` 指纹推进与收件箱/run 落库必须在**同一事务**；只在内存推进指纹会导致重启后重复入箱，只在 DB 落库不推进指纹会导致同一批无限重复
- **semantic 的证据越界**：模型可能引用上下文里不存在的 ref（幻觉）—— 必须整条丢弃，**不得**降级为"无证据也触发"
- **headless 不得改变既有语义**：`startWorkflow({ headless: true })` 只跳过"打开面板"，checkpoint/事件/状态流转必须一字不动（改错会波及所有现有工作流）
- **收件箱的 `notify_only` 不得渲染执行按钮**：这是三态里唯一"只读"的策略，UI 误加按钮等于绕过用户的策略选择
- **调度器重入**：单次 tick 未完成时下一个 tick 必须直接返回（`setInterval` 不等人）；否则长评估期间并发写入会撞唯一索引

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/services/automation/types.ts` | 全部类型与常量 | 新建 |
| `src/services/automation/triggers.ts` | schedule / chapter_batch 评估 + manual 构造 | 新建 |
| `src/services/automation/semantic-trigger.ts` | semantic 上下文 / 提示词 / 解析校验 | 新建 |
| `src/services/automation/store.ts` | DB 读写（含事务化 `applyTriggerOutcome`） | 新建 |
| `src/services/automation/scheduler.ts` | tick 循环 + 重入保护 | 新建 |
| `src/services/automation/executor.ts` | `AutomationExecutor` 接口 + workflow/agent 两实现 | 新建 |
| `src/stores/automation-store.ts` | Zustand：任务 CRUD、收件箱视图、调度器生命周期 | 新建 |
| `electron/database.ts` | schema v18 迁移 | 修改 |
| `electron/repositories/automation-repository.ts` | 三表读写（better-sqlite3） | 新建 |
| `electron/controllers/db-controller.ts` | 新 IPC 通道 | 修改 |
| `src/stores/workflow-store.ts` | `startWorkflow` 增 `headless` 选项 | 修改 |
| `src/components/panels/BottomPanel.tsx` | 新增 `inbox` tab | 修改 |
| `src/components/panels/automation/InboxPanel.tsx` + `InboxItemCard.tsx` | 收件箱 UI | 新建 |
| `src/components/settings/AutomationSection.tsx` | 设置页自动化配置 | 新建 |

---

### Task 1: 类型 + schema v18 迁移 + repository 骨架

**Files:**
- Create: `src/services/automation/types.ts`
- Create: `electron/repositories/automation-repository.ts`
- Modify: `electron/database.ts`（迁移）
- Test: `electron/repositories/automation-repository.test.ts`

**Interfaces:**
- Produces: `TriggerType` / `ActionPolicy` / `TriggerDefinition` / `Schedule` / `TriggerEvidence` / `TriggerMatch` / `TriggerContext` / `AutomationTask` / `InboxItem` / `AutomationRun` / `TriggerStateMap`（types.ts）；`createAutomationRepository(db)`（repository）

- [ ] **Step 1: 写类型文件**

按 spec §4.1 逐字实现 `types.ts`，并补三个实体：

```ts
export interface AutomationTask {
  id: string
  name: string
  enabled: boolean
  targetType: 'workflow' | 'agent'
  /** workflow: 工作流类型；agent: 提示词 */
  targetRef: string
  sessionStrategy: 'per_run' | 'per_task'
  /** per_task 复用的会话 id */
  sessionId?: string | null
  triggers: TriggerDefinition[]
  defaultActionPolicy: ActionPolicy
  createdAt: number
  updatedAt: number
}

export interface InboxItem {
  id: string
  automationId: string
  triggerId: string
  status: 'pending' | 'confirmed' | 'dismissed' | 'auto_run'
  actionPolicy: ActionPolicy
  title: string
  summary: string
  evidence: TriggerEvidence[]
  fingerprint: string
  runId?: string | null
  actionError?: string | null
  createdAt: number
  readAt?: number | null
  handledAt?: number | null
}

export interface AutomationRun {
  id: string
  automationId: string
  triggerType: TriggerType
  targetType: 'workflow' | 'agent'
  refId?: string | null
  status: 'running' | 'success' | 'failed' | 'aborted'
  summary?: string
  error?: string
  evidence: TriggerEvidence[]
  startedAt: number
  finishedAt?: number | null
  recoveryState?: string | null
}

/** per-trigger 去重状态（automations.trigger_state 的解析形态） */
export type TriggerStateMap = Record<string, {
  lastCheckedAt?: number
  lastFingerprint?: string
}>
```

- [ ] **Step 2: 写迁移测试（失败）**

```ts
// electron/repositories/automation-repository.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createAutomationRepository } from './automation-repository'
import { runMigrations } from '../database'   // 按 database.ts 实际的迁移导出名调整

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
})

describe('schema v18 迁移（幂等）', () => {
  it('三张表与索引存在；重复迁移不报错', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    const names = tables.map(t => t.name)
    expect(names).toContain('automations')
    expect(names).toContain('automation_inbox')
    expect(names).toContain('automation_runs')
    expect(() => runMigrations(db)).not.toThrow()
  })

  it('user_version 达到 18', () => {
    expect(db.pragma('user_version', { simple: true })).toBe(18)
  })
})

const TASK: AutomationTask = {
  id: 'a1', name: '每3章后处理', enabled: true, targetType: 'workflow', targetRef: 'post_process',
  sessionStrategy: 'per_run',
  triggers: [{ id: 't1', type: 'chapter_batch', enabled: true, chapterBatchSize: 3 }],
  defaultActionPolicy: 'confirm', createdAt: 1, updatedAt: 1,
}
const INBOX: InboxItem = {
  id: 'i1', automationId: 'a1', triggerId: 't1', status: 'pending', actionPolicy: 'confirm',
  title: '第 1-3 章已成批', summary: '可运行后处理管线', evidence: [], fingerprint: 'fp1', createdAt: 1,
}

describe('automation-repository CRUD', () => {
  it('保存后可读回（triggers JSON 往返一致）', () => {
    const repo = createAutomationRepository(db)
    repo.saveTask(TASK)
    const list = repo.listTasks()
    expect(list).toHaveLength(1)
    expect(list[0].triggers[0].chapterBatchSize).toBe(3)
  })

  it('同一 (automation_id, fingerprint) 的收件箱条目只能插一次（UNIQUE 兜底）', () => {
    const repo = createAutomationRepository(db)
    repo.saveTask(TASK)
    repo.appendInboxItem(INBOX)
    expect(() => repo.appendInboxItem({ ...INBOX, id: 'i2' })).toThrow()
  })

  it('删除任务级联删除其收件箱与运行记录', () => {
    const repo = createAutomationRepository(db)
    repo.saveTask(TASK)
    repo.appendInboxItem(INBOX)
    repo.appendRun({ id: 'r1', automationId: 'a1', triggerType: 'manual', targetType: 'workflow',
      status: 'running', evidence: [], startedAt: 1 })
    repo.deleteTask('a1')
    expect(repo.listInbox().filter(i => i.automationId === 'a1')).toHaveLength(0)
    expect(repo.getRunningRuns()).toHaveLength(0)
  })
})
```

- [ ] **Step 3: 运行确认失败**

Run: `npx vitest run electron/repositories/automation-repository.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 4: 实现迁移与 repository**

- `electron/database.ts`：`user_version` 判断加 v18 分支，执行 spec §3.1 的完整 DDL（三个 `CREATE TABLE IF NOT EXISTS` + 两个索引，其中收件箱的指纹索引为 `UNIQUE`）
- `electron/repositories/automation-repository.ts`：`createAutomationRepository(db)` 返回 `{ saveTask, listTasks, getTask, deleteTask, setEnabled, updateTriggerState, appendInboxItem, listInbox, updateInboxStatus, appendRun, updateRun, getRunningRuns }`
- JSON 字段（`triggers` / `trigger_state` / `evidence`）在读写边界做 `JSON.parse` / `JSON.stringify`，解析失败一律回落默认值（fail-safe）

Run: `npx vitest run electron/repositories/automation-repository.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/services/automation/types.ts electron/repositories/automation-repository.ts electron/repositories/automation-repository.test.ts electron/database.ts
git commit -m "feat(automation): 类型与 schema v18（三表 + repository）"
```

---

### Task 2: IPC 通道

**Files:**
- Modify: `src/shared/ipc-channels.ts`、`src/shared/ipc-policy.ts`、`electron/controllers/db-controller.ts`
- Test: 由 Task 1 的 repository 测试 + 全量回归覆盖（IPC 是薄转发）

**Interfaces:**
- Produces: 通道 `db:automation-list` / `db:automation-save` / `db:automation-delete` / `db:automation-set-enabled` / `db:automation-apply-outcome` / `db:automation-inbox-list` / `db:automation-inbox-update` / `db:automation-run-append` / `db:automation-run-update` / `db:automation-running-runs`

- [ ] **Step 1: 三处同步注册**

- `ipc-channels.ts`：为每个通道加 invokes 类型签名（参数与返回用 Task 1 的类型）
- `ipc-policy.ts`：加权限项（`db:` 前缀的既有分类下）
- `db-controller.ts`：`guardedHandle` 注册，转发到 repository

> ⚠️ `db:automation-apply-outcome` 是**事务通道**：一次调用内完成「更新 trigger_state + 写入一条或多条收件箱条目 +（auto_run 时）写入 run 记录」，实现为 `db.transaction(...)`。

- [ ] **Step 2: 验证**

Run: `npx tsc --noEmit && npx vitest run electron/`
Expected: 零错误、既有测试全绿

- [ ] **Step 3: 提交**

```bash
git add src/shared/ipc-channels.ts src/shared/ipc-policy.ts electron/controllers/db-controller.ts
git commit -m "feat(automation): IPC 通道（含事务化的 apply-outcome）"
```

---

### Task 3: 确定性触发器（schedule + chapter_batch + manual）

**Files:**
- Create: `src/services/automation/triggers.ts`
- Test: `src/services/automation/triggers.test.ts`

**Interfaces:**
- Consumes: `types.ts`（Task 1）
- Produces: `evaluateSchedule(trigger, ctx): TriggerMatch | null`；`evaluateChapterBatch(trigger, ctx): TriggerMatch | null`；`buildManualMatch(trigger, ctx): TriggerMatch`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { evaluateChapterBatch, evaluateSchedule, buildManualMatch } from './triggers'
import type { TriggerContext, TriggerDefinition } from './types'

const DAY = 86_400_000
function ctx(over: Partial<TriggerContext> = {}): TriggerContext {
  return { now: 10 * DAY, chapters: [], ...over }
}
const trigger = (over: Partial<TriggerDefinition> = {}): TriggerDefinition =>
  ({ id: 't1', type: 'chapter_batch', enabled: true, ...over })

describe('evaluateChapterBatch', () => {
  const chapters = (n: number) => Array.from({ length: n }, (_, i) =>
    ({ number: i + 1, title: `第${i + 1}章`, wordCount: 3000 }))

  it('不足一批不触发', () => {
    expect(evaluateChapterBatch(trigger({ chapterBatchSize: 3 }), ctx({ chapters: chapters(2) }))).toBeNull()
  })

  it('刚好一批 → 触发，指纹含批号与该批章节号', () => {
    const m = evaluateChapterBatch(trigger({ chapterBatchSize: 3 }), ctx({ chapters: chapters(3) }))!
    expect(m.fingerprint).toBe('chapter_batch:t1:1:1,2,3')
    expect(m.summary).toContain('第 1-3 章')
  })

  it('字数 0 的章节不计入批次', () => {
    const ch = [...chapters(3), { number: 4, title: '空章', wordCount: 0 }]
    expect(evaluateChapterBatch(trigger({ chapterBatchSize: 3 }), ctx({ chapters: ch }))!.fingerprint)
      .toBe('chapter_batch:t1:1:1,2,3')
  })

  it('指纹不含字数/标题变化（同批改稿不重复触发）', () => {
    const a = evaluateChapterBatch(trigger({ chapterBatchSize: 3 }), ctx({ chapters: chapters(3) }))!
    const edited = chapters(3).map(c => ({ ...c, wordCount: 9999, title: '改了' }))
    const b = evaluateChapterBatch(trigger({ chapterBatchSize: 3 }), ctx({ chapters: edited }))!
    expect(b.fingerprint).toBe(a.fingerprint)
  })

  it('第 4 章定稿 → 批号推进（新指纹）', () => {
    const m = evaluateChapterBatch(trigger({ chapterBatchSize: 3 }), ctx({ chapters: chapters(4) }))!
    expect(m.fingerprint).toBe('chapter_batch:t1:1:1,2,3')   // 仍取最后一个完整批
  })

  it('第 4-6 章成批 → 指纹变化到批 2', () => {
    const m = evaluateChapterBatch(trigger({ chapterBatchSize: 3 }), ctx({ chapters: chapters(6) }))!
    expect(m.fingerprint).toBe('chapter_batch:t1:2:4,5,6')
  })

  it('chapterBatchSize 缺省为 3，非法值回落', () => {
    expect(evaluateChapterBatch(trigger(), ctx({ chapters: chapters(3) }))).not.toBeNull()
    expect(evaluateChapterBatch(trigger({ chapterBatchSize: 0 }), ctx({ chapters: chapters(3) }))).not.toBeNull()
  })
})

describe('evaluateSchedule（区间回溯）', () => {
  const daily = trigger({ type: 'schedule', schedule: { kind: 'daily', hour: 9, minute: 0 } })

  it('区间内无命中点 → null', () => {
    const now = new Date('2026-09-26T08:00:00').getTime()
    expect(evaluateSchedule(daily, ctx({ now, lastCheckedAt: now - 3600_000 }))).toBeNull()
  })

  it('区间跨过 09:00 → 触发，指纹含命中点时间戳', () => {
    const last = new Date('2026-09-26T08:50:00').getTime()
    const now = new Date('2026-09-26T09:10:00').getTime()
    const m = evaluateSchedule(daily, ctx({ now, lastCheckedAt: last }))!
    expect(m.fingerprint).toContain('schedule:t1:')
    expect(new Date(Number(m.fingerprint.split(':').pop())).getHours()).toBe(9)
  })

  it('首次评估只回溯一分钟（避免刷出历史触发点）', () => {
    const now = new Date('2026-09-26T09:00:30').getTime()
    expect(evaluateSchedule(daily, ctx({ now }))).not.toBeNull()      // 09:00 在 (09:00:00-60s, now] 内
    const later = new Date('2026-09-26T10:00:00').getTime()
    expect(evaluateSchedule(daily, ctx({ now: later }))).toBeNull()   // 09:00 已超出 1 分钟回溯窗
  })

  it('停机多天只补最近一个命中点（不刷屏）', () => {
    const last = new Date('2026-09-20T09:00:00').getTime()
    const now = new Date('2026-09-26T10:00:00').getTime()
    const m = evaluateSchedule(daily, ctx({ now, lastCheckedAt: last }))!
    expect(new Date(Number(m.fingerprint.split(':').pop())).getDate()).toBe(26)   // 最近的那个
  })
})

describe('buildManualMatch', () => {
  it('手动触发指纹唯一（每次运行都可执行）', () => {
    const a = buildManualMatch(trigger({ type: 'manual' }), ctx())
    const b = buildManualMatch(trigger({ type: 'manual' }), ctx())
    expect(a.fingerprint).not.toBe(b.fingerprint)
    expect(a.fingerprint.startsWith('manual:t1:')).toBe(true)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/automation/triggers.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现 triggers.ts**

要点（按 spec §4.2 / §4.3 / §4.5）：
- `evaluateChapterBatch`：过滤 `wordCount > 0` → `batchSize = max(1, trigger.chapterBatchSize ?? 3)` → 不足批返回 null → `batchNumber = floor(len / batchSize)` → 取该批 → 指纹 `chapter_batch:<id>:<batchNumber>:<章节号 join ','>`（**不含字数/标题**）→ summary 用本地模板（含起止章号与总字数）
- `evaluateSchedule`：`from = lastCheckedAt ?? now - 60_000`；按 `kind` 展开命中点，取 `(from, now]` 内**最大的**一个；指纹 `schedule:<id>:<命中点时间戳>`
- `buildManualMatch`：指纹 `manual:<id>:<now>`，evidence 为空数组，summary 为本地文案

Run: `npx vitest run src/services/automation/triggers.test.ts`
Expected: PASS（14 例）

- [ ] **Step 4: 提交**

```bash
git add src/services/automation/triggers.ts src/services/automation/triggers.test.ts
git commit -m "feat(automation): 确定性触发器（schedule 区间回溯 / chapter_batch 指纹）"
```

---

### Task 4: semantic 触发器

**Files:**
- Create: `src/services/automation/semantic-trigger.ts`
- Test: `src/services/automation/semantic-trigger.test.ts`

**Interfaces:**
- Consumes: `types.ts`
- Produces: `buildSemanticContext(chapters, opts): { text: string; allowedRefs: Set<string> }`；`parseSemanticEvaluation(raw): SemanticEvaluation | null`；`evaluateSemantic(trigger, ctx)`（`ctx.callModel` 注入）

- [ ] **Step 1: 写失败测试**

覆盖以下行为（每条一个用例）：

```ts
it('置信度低于 0.55 → 不触发')
it('matched=false → 不触发')
it('证据引用上下文之外的 ref → 整条丢弃（不得降级为无证据触发）')
it('非法 JSON → 返回 null 且不抛')
it('匹配成功 → 指纹含条件哈希与章节指纹，evidence 只保留已校验的项')
it('上下文：取最新章节、单章截断 1200 字符、总预算 64KiB')
it('模型调用抛错 → 返回 null（不阻断其他触发器）')
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/automation/semantic-trigger.test.ts` → FAIL

- [ ] **Step 3: 实现**

要点（spec §4.4）：
- `buildSemanticContext`：章节倒序取最新 ≤20 章，逐章 `slice(0, 1200)`，累积到 64KiB 为止；`allowedRefs` = 每章 `String(number)` 与 `title`
- 提示词固定模板（含"证据不足必须 matched=false""confidence<0.55 不触发""evidence_refs 只能引用给定 ref/title""只输出 JSON"四条约束）
- `parseSemanticEvaluation`：容错提取 JSON（复用 `robustParseJSON` 或等价实现）→ 校验 `confidence ∈ [0,1]`、`evidence_refs ⊆ allowedRefs`
- `evaluateSemantic`：无 `ctx.callModel` 或条件为空 → null；调用失败/解析失败 → `renderLog('warn', ...)` + null

Run: `npx vitest run src/services/automation/semantic-trigger.test.ts` → PASS

- [ ] **Step 4: 提交**

```bash
git add src/services/automation/semantic-trigger.ts src/services/automation/semantic-trigger.test.ts
git commit -m "feat(automation): semantic 触发器（有界上下文 + 证据校验）"
```

---

### Task 5: 执行层（含 startWorkflow headless 改造）

**Files:**
- Create: `src/services/automation/executor.ts`
- Modify: `src/stores/workflow-store.ts:399-437`（加 `options`）；agent 目标复用既有的 `createConversation` + `sendMessage`（**不需要改 agent-store**）
- Test: `src/services/automation/executor.test.ts`、`src/stores/workflow-store.headless.test.ts`（新建）

**Interfaces:**
- Produces: `AutomationExecutor { start(task, match): Promise<ExecutionHandle>; isAlive(handle): Promise<boolean> }`；`createExecutor(deps)`（deps 注入 workflow-starter 与 agent 启动器，便于测试）

- [ ] **Step 1: 写 headless 测试（失败）**

```ts
// src/stores/workflow-store.headless.test.ts（沿用 workflow-store.file-output.test.ts 的 jsdom + velaAPI 桩）
it('headless: true 不打开底栏与右侧面板', async () => {
  useLayoutStore.setState({ bottomPanelOpen: false, aiPanelOpen: false })
  await useWorkflowStore.getState().startWorkflow(definition, false, { headless: true })
  expect(useLayoutStore.getState().bottomPanelOpen).toBe(false)
  expect(useLayoutStore.getState().aiPanelOpen).toBe(false)
})

it('headless: true 其余行为不变（步骤照跑、result 照写、输出镜像照发）', async () => {
  await useWorkflowStore.getState().startWorkflow(definition, false, { headless: true })
  const run = useWorkflowStore.getState().history.find(r => r.id === runId)!
  expect(run.steps[0].result).toBe('第一段正文第二段正文')      // 与 file-output 测试同语义
  expect(findCall('fs:workflow-output-append')).toBeTruthy()
})

it('不传 options 时行为与既有完全一致（打开面板）', async () => {
  useLayoutStore.setState({ bottomPanelOpen: false, aiPanelOpen: false })
  await useWorkflowStore.getState().startWorkflow(definition)
  expect(useLayoutStore.getState().bottomPanelOpen).toBe(true)
})
```

- [ ] **Step 2: 运行确认失败** → `npx vitest run src/stores/workflow-store.headless.test.ts`（FAIL：参数不存在）

- [ ] **Step 3: 实现**

- `workflow-store.startWorkflow` 增加第二参数 `options?: { headless?: boolean }`；`:426-429` 的开面板逻辑包进 `if (!options?.headless)`；其余一行不动
- `executor.ts`：`createExecutor({ startWorkflow, startAgentConversation })` 返回两个实现分支 —— `targetType==='workflow'` 走工作流（`refId` = runId）、`'agent'` 走会话（`per_run` 新建 / `per_task` 复用 `task.sessionId`，`refId` = conversationId）
- `isAlive`：workflow 查 `useWorkflowStore` 的 activeRuns/history；agent 查会话是否存在

Run: `npx vitest run src/stores/workflow-store.headless.test.ts src/services/automation/executor.test.ts` → PASS

- [ ] **Step 4: 提交**

```bash
git add src/stores/workflow-store.ts src/stores/workflow-store.headless.test.ts src/services/automation/executor.ts src/services/automation/executor.test.ts
git commit -m "feat(automation): 执行层（workflow/agent 双目标 + startWorkflow headless）"
```

---

### Task 6: 调度器

**Files:**
- Create: `src/services/automation/scheduler.ts`
- Test: `src/services/automation/scheduler.test.ts`

**Interfaces:**
- Consumes: Task 3/4 的评估函数、Task 5 的 executor、Task 1/2 的 store 与 IPC
- Produces: `createScheduler(deps): { start(projectPath): void; stop(): void; tick(now: number): Promise<TickResult> }`（`tick` 公开以便测试直接驱动）

- [ ] **Step 1: 写失败测试**

```ts
it('单次 tick 未完成时重入直接返回（不并发评估）')
it('指纹与 trigger_state 相同 → 跳过（不入箱）')
it('confirm 策略 → 只入箱不执行')
it('auto_run 策略 → 入箱记录 + 调用 executor.start')
it('notify_only 策略 → 入箱且不调用 executor')
it('评估抛错 → 该触发器跳过，其余触发器继续（同 tick 内）')
it('applyOutcome 单次调用（事务语义：状态与产物一起提交）')
```

- [ ] **Step 2: 运行确认失败** → FAIL

- [ ] **Step 3: 实现**

tick 流程（spec §5.2）：重入保护（模块级 `running` 标志）→ 取 enabled 任务 → 逐触发器评估（semantic 串行 await）→ 指纹比对 → 按策略构造产物 → **一次 `db:automation-apply-outcome` 提交**（含 trigger_state 推进）→ auto_run 分支在事务提交后调 `executor.start` 并回写 run。

`start(projectPath)` 用 `setInterval(60_000)`；`stop()` 清理。

Run: `npx vitest run src/services/automation/scheduler.test.ts` → PASS

- [ ] **Step 4: 提交**

```bash
git add src/services/automation/scheduler.ts src/services/automation/scheduler.test.ts
git commit -m "feat(automation): 调度器（60s tick + 重入保护 + 事务分流）"
```

---

### Task 7: 收件箱 store（三态流转）

**Files:**
- Create: `src/stores/automation-store.ts`
- Test: `src/stores/automation-store.test.ts`

**Interfaces:**
- Produces: `useAutomationStore`：`tasks` / `inbox` / `loadAll()` / `saveTask()` / `deleteTask()` / `setEnabled()` / `runNow(taskId)` / `confirmInboxItem(id)` / `dismissInboxItem(id)` / `markInboxRead(id)` / `startScheduler()` / `stopScheduler()`

- [ ] **Step 1: 写失败测试**

```ts
it('confirmInboxItem → 调 executor.start + 条目转 confirmed 且写 runId')
it('confirmInboxItem 失败 → 写 actionError，条目保持 pending（可重试）')
it('dismissInboxItem → 转 dismissed（不删除，保留证据链）')
it('runNow → 构造 manual match 并走同一执行链')
it('startScheduler/stopScheduler 幂等')
```

- [ ] **Step 2: 运行确认失败** → FAIL

- [ ] **Step 3: 实现**

Zustand store，IPC 走 `db:automation-*`；`startScheduler` 在 `currentProject` 变化时由 App 层调用（Task 8 接线）。

Run: `npx vitest run src/stores/automation-store.test.ts` → PASS

- [ ] **Step 4: 提交**

```bash
git add src/stores/automation-store.ts src/stores/automation-store.test.ts
git commit -m "feat(automation): 收件箱 store（三态流转 + 调度器生命周期）"
```

---

### Task 8: 收件箱 UI + 底部面板 tab + 调度器接线

**Files:**
- Modify: `src/components/panels/BottomPanel.tsx:18-21`（tab 定义）
- Create: `src/components/panels/automation/InboxPanel.tsx`、`InboxItemCard.tsx`
- Modify: `src/App.tsx`（项目切换时启停调度器）
- Modify: `src/shared/locale-data/*`（三语文案）
- Test: `src/components/panels/automation/InboxItemCard.test.tsx`

**Interfaces:**
- Consumes: `useAutomationStore`（Task 7）

- [ ] **Step 1: 写失败测试**

```tsx
it('confirm 条目 → 渲染「确认运行」与「忽略」')
it('notify_only 条目 → 只渲染「忽略」，不出现「确认运行」（策略选择不得被 UI 绕过）')
it('auto_run 条目 → 不渲染任何操作按钮')
it('证据超过 3 条 → 显示前 3 条 + "还有 N 条"')
it('actionError 存在 → 以 error 色展示')
```

- [ ] **Step 2: 运行确认失败** → FAIL

- [ ] **Step 3: 实现**

- `BottomPanel` 的 tab 列表加 `{ id: 'inbox', label: t('automation.inboxTab'), icon }`，未处理数显示徽章
- `InboxItemCard` 按 §7.2 渲染；颜色用 CSS 变量；`text-micro` 等既有令牌
- `App.tsx` 订阅 `currentProject?.path`，变化时 `stopScheduler()` + `startScheduler(path)`
- i18n 新增 key（`automation.*` 前缀，三语齐）

Run: `npx vitest run src/components/panels/automation/InboxItemCard.test.tsx` → PASS

- [ ] **Step 4: 提交**

```bash
git add src/components/panels/BottomPanel.tsx src/components/panels/automation/ src/App.tsx src/shared/locale-data/
git commit -m "feat(automation): 收件箱 UI 与调度器接线"
```

---

### Task 9: 设置页自动化配置

**Files:**
- Create: `src/components/settings/AutomationSection.tsx`
- Modify: `src/components/settings/SettingsModal.tsx`（挂载）、`src/shared/locale-data/settings.ts`
- Test: `src/components/settings/AutomationSection.test.tsx`

**Interfaces:**
- Consumes: `useAutomationStore`

- [ ] **Step 1: 写失败测试**

```tsx
it('新建：选目标类型 → 对应必填项出现（workflow 选工作流 / agent 填提示词）')
it('触发器表单：选 chapter_batch → 出现批次大小输入（默认 3）')
it('触发器表单：选 schedule → 出现频率与时刻输入')
it('触发器表单：选 semantic → 出现条件文本框')
it('保存 → 调 saveTask 且 triggers 数组形状正确')
it('启用开关 → 调 setEnabled')
```

- [ ] **Step 2: 运行确认失败** → FAIL

- [ ] **Step 3: 实现**

表单式配置（不做自由 JSON 编辑）；「立即运行」按钮调 `runNow`；沿用设置页既有卡片样式与 `Switch` 组件。

Run: `npx vitest run src/components/settings/AutomationSection.test.tsx` → PASS

- [ ] **Step 4: 全量门禁 + 提交**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run`（零错误 / 零 warning / 全绿）

```bash
git add src/components/settings/ src/shared/locale-data/settings.ts
git commit -m "feat(automation): 设置页自动化配置"
```

---

## 明确不做（本计划范围外）

- 主进程后台执行（执行层已抽接口，留待下一步）
- `write_confirmation` 二次确认 purpose（spec §1.2）
- 跨项目自动化编排
- 触发器条件的自由脚本表达
