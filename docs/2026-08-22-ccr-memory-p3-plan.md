# CCR 增强（P3）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** P3 增强三项——跨会话记忆复用（SharedContext）、跨项目 token 聚合、记忆查看器 AI 面板入口。

**Architecture:** ① SharedContext：项目级 `{project}/.vela/memory/shared.md`（frontmatter `type: shared` + 事实条目列表，上限 50 条去重）——会话压缩时在既有 `generateConversationSummary` 的同一 LLM 调用中附带提取「可复用事实」（prompt 追加一行要求，**零额外调用成本**）→ 解析 facts 数组 → 合并 shared.md（按文本去重）→ M2 注入节选包含 shared 段。② 跨项目 token 聚合：复用 activity-repository 的 recentProjects 逐项目只读聚合模式（activity-repository.ts:40-50）——逐项目只读打开 vela.db 聚合 llm_calls（含 v16 cached_tokens）→ 全局统计视图（P2 Task 6 面板的全局维度扩展）。③ 查看器 AI 面板入口：AgentHeader 工具栏加「记忆」按钮 → AI 面板内记忆子视图（复用 MemoryGroup 的数据逻辑，AgentConversation 视图切换模式）。

**Tech Stack:** Electron 41 + React 19 + TypeScript 6。复用：`generateConversationSummary`/`buildCcrSummaryPrompt`（ccr-summary.ts）、M2 节选（context-builder.ts）、`getRecentProjectPaths`（activity-repository.ts）、`MemoryGroup` 数据逻辑、`memory:*` 通道。

**Spec:** [docs/2026-08-21-ccr-memory-design.md](2026-08-21-ccr-memory-design.md) §6（P2 方向）+ §5（记忆子系统）；P3 为设计 §6 与 P2 计划「范围外」项的执行化

## Global Constraints

- SharedContext 提取：**并入既有压缩摘要 LLM 调用**（prompt 追加「另输出 3-5 条可跨会话复用的用户偏好/项目事实」——零额外调用；解析失败降级跳过，不阻断压缩）
- shared.md：项目级（作品事实随项目）；去重按条目文本（精确匹配，上限 50 条，超出丢最旧）；编辑复用 P2 Task 5 的编辑模式
- M2 注入：shared 段在节选预算内（book/volume/chapters/shared 按序累计，shared 优先级最低——先保证作品记忆）
- 跨项目聚合：只读连接（activity-repository 同款：`new Database(path, readonly)` + WAL -shm 容错——项目记忆踩坑：只读连接依赖 -shm，主连接未开/崩溃残留时失败，需容错）；无项目打开时全局视图显示"打开项目后可聚合"提示
- 质量门禁：tsc 零错误 / lint 零警告 / 测试全过（基线 614/614 无豁免）；每任务独立 commit

---

### Task 1: 跨会话记忆复用（SharedContext）

**Files:**
- Modify: `src/services/agent/ccr-summary.ts`（prompt 扩展 + facts 解析 + shared 合并）
- Create: `src/services/memory/shared-memory.ts`（shared.md 编解码/合并/读取纯函数）
- Test: `src/services/memory/shared-memory.test.ts`、`src/services/agent/ccr-summary.test.ts`（追加）
- Modify: `src/services/agent/context-builder.ts`（M2 节选含 shared 段）

**Interfaces:**
- Produces:
  - `export function parseSharedFacts(summaryText: string): string[]`（从压缩摘要输出解析「可复用事实」段——prompt 约束格式 `[可复用事实]` 标记后逐行）
  - `export function mergeSharedFacts(existing: string[], facts: string[]): string[]`（按文本去重 + 上限 50 条丢最旧）
  - `export function buildSharedFile(facts: string[]): string`（frontmatter `type: shared` + 条目列表）
  - `export function parseSharedFile(raw: string): string[]`（损坏兼容）
  - `export async function upsertSharedFacts(facts: string[]): Promise<boolean>`（memory:read shared.md → merge → memory:write；文件不存在则新建）

- [ ] **Step 1: 写失败测试（纯函数）**

```ts
// src/services/memory/shared-memory.test.ts
import { describe, it, expect } from 'vitest'
import { parseSharedFacts, mergeSharedFacts, buildSharedFile, parseSharedFile } from './shared-memory'

describe('parseSharedFacts', () => {
  it('从 [可复用事实] 标记后提取逐行事实', () => {
    const facts = parseSharedFacts('摘要内容\n\n[可复用事实]\n- 用户偏好爽文节奏\n- 主角名苏晚晴\n')
    expect(facts).toEqual(['用户偏好爽文节奏', '主角名苏晚晴'])
  })

  it('无标记 → 空数组', () => {
    expect(parseSharedFacts('纯摘要')).toEqual([])
  })
})

describe('mergeSharedFacts', () => {
  it('按文本去重 + 上限 50 丢最旧', () => {
    const merged = mergeSharedFacts(['旧事实'], ['旧事实', '新事实'])
    expect(merged).toEqual(['旧事实', '新事实'])
    const over = mergeSharedFacts(Array.from({ length: 50 }, (_, i) => `事实${i}`), ['溢出'])
    expect(over).toHaveLength(50)
    expect(over[0]).toBe('事实1') // 最旧（事实0）被丢
    expect(over[49]).toBe('溢出')
  })
})

describe('buildSharedFile / parseSharedFile', () => {
  it('round-trip', () => {
    const raw = buildSharedFile(['事实A'])
    expect(parseSharedFile(raw)).toEqual(['事实A'])
    expect(parseSharedFile('损坏')).toEqual([])
  })
})
```

- [ ] **Step 2: 实现**（shared-memory.ts 纯函数 + ccr-summary.ts 的 `buildCcrSummaryPrompt` 追加「另输出 3-5 条可跨会话复用的用户偏好/项目事实，格式：[可复用事实] 后每行一条 `- 事实`」+ `generateConversationSummary` 成功后 `parseSharedFacts(response.content)` → `upsertSharedFacts`（失败降级跳过不阻断）+ context-builder.ts M2 节选 picks 追加 shared（优先级最低，预算内））

- [ ] **Step 3: 门禁 + 提交**

```bash
git add src/services/memory/shared-memory.ts src/services/memory/shared-memory.test.ts src/services/agent/ccr-summary.ts src/services/agent/context-builder.ts
git commit -m "feat: 跨会话记忆复用（SharedContext——压缩摘要附带提取 + shared.md 去重 + M2 注入）"
```

---

### Task 2: 跨项目 token 聚合

**Files:**
- Modify: `electron/repositories/activity-repository.ts`（或新建 `electron/repositories/usage-repository.ts`——推荐新建，职责独立）
- Modify: `electron/controllers/db-controller.ts`（聚合通道）
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/components/settings/UsageStatsView.tsx`（P2 Task 6 面板扩展「全局」维度）

**Interfaces:**
- Consumes: `getRecentProjectPaths()`（activity-repository.ts:49-50 已存在）、llm_calls 表（含 v16 cached_tokens——P2 Task 2 后）
- Produces:
  - `'db:usage-stats-global': { args: []; return: { projects: { path: string; name: string; calls: number; promptTokens: number; completionTokens: number; cachedTokens: number; cost: number }[]; total: { calls: number; cost: number; cachedTokens: number } } }`
  - `export async function getGlobalUsageStats(): Promise<GlobalUsageStats>`（recentProjects → 逐项目只读 DB 聚合——`new Database(path, readonly)` + WAL -shm 容错，同 activity-repository 模式；无项目/只读失败项目跳过）

- [ ] **Step 1: 写失败测试（聚合纯逻辑——SQL 字符串/项目过滤）**

```ts
// electron/repositories/usage-repository.test.ts
import { describe, it, expect } from 'vitest'
import { buildGlobalAggregationQuery, filterAvailableProjects } from './usage-repository'

describe('跨项目聚合', () => {
  it('SQL 聚合三维度（purpose/模型/总量）', () => {
    const sql = buildGlobalAggregationQuery()
    expect(sql).toContain('GROUP BY purpose')
    expect(sql).toContain('SUM(prompt_tokens)')
    expect(sql).toContain('SUM(cached_tokens)')
  })

  it('项目过滤：仅存在路径', () => {
    expect(filterAvailableProjects([{ path: 'E:/不存在/x', name: 'x' }])).toEqual([])
  })
})
```

- [ ] **Step 2: 实现**（usage-repository：getGlobalUsageStats（getRecentProjectPaths → 逐项目 `new Database(path, { readonly: true })` 聚合 llm_calls——WAL 只读依赖 -shm 的容错同 activity-repository 既有处理；失败项目跳过）+ db-controller 新通道 + ipc-channels 类型 + UsageStatsView 全局 tab（P2 面板扩展——显示项目维度表 + 合计；无项目打开 → 提示文案））

- [ ] **Step 3: 门禁 + 提交**

```bash
git add electron/repositories/usage-repository.ts electron/repositories/usage-repository.test.ts electron/controllers/db-controller.ts src/shared/ipc-channels.ts src/components/settings/UsageStatsView.tsx src/shared/locale-data.ts
git commit -m "feat: 跨项目 token 聚合（recentProjects 逐项目只读 + 全局统计视图）"
```

---

### Task 3: 记忆查看器 AI 面板入口

**Files:**
- Modify: `src/components/panels/agent/AgentHeader.tsx`（工具栏「记忆」按钮）
- Modify: `src/components/panels/agent/AgentConversation.tsx`（或 AIPanel——记忆子视图切换）
- Create: `src/components/panels/agent/AgentMemoryView.tsx`（AI 面板内记忆视图——复用 MemoryGroup 数据逻辑，只读 + 展开 + 重建按钮）

**Interfaces:**
- Consumes: `useMemoryStore`（P1 Task 5 已建——load/refresh/files）、`memory:read`、卷级重建逻辑（P1）
- Produces: AgentHeader 新增「记忆」按钮（记忆图标 + `memory.menuTitle` i18n）→ 切换 AgentMemoryView（AI 面板内嵌：文件列表 + 查看 + 重建；关闭返回对话视图——参照 AgentHeader 的 skills/mcp 子视图模式）

- [ ] **Step 1: 实现**（AgentHeader 按钮 + 视图切换（setSubView('memory') 模式——参照既有 skills/mcp 子视图）+ AgentMemoryView 组件（复用 MemoryGroup 数据流，布局适配 AI 面板宽度）+ i18n 3 key：memory.menuTitle/back/rebuild 复用既有）

- [ ] **Step 2: 门禁 + 提交**

```bash
git add src/components/panels/agent/AgentHeader.tsx src/components/panels/agent/AgentConversation.tsx src/components/panels/agent/AgentMemoryView.tsx src/shared/locale-data.ts
git commit -m "feat: 记忆查看器 AI 面板入口（工具栏按钮 + 内嵌记忆视图）"
```

---

## 验收对照（设计 §6 P3 方向 + P2 范围外项）

| 验收项 | 对应任务 |
|--------|---------|
| 跨会话记忆复用（SharedContext：压缩附带提取 → shared.md → M2 注入） | Task 1 |
| 跨项目 token 聚合（recentProjects 逐项目只读，含 cached_tokens） | Task 2 |
| 记忆查看器 AI 面板入口（设计 §5.4 双入口第二入口） | Task 3 |

**范围外（后续候选）**：SharedContext 的语义去重/LLM 级合并（当前按文本精确去重）、全局统计的时间区间筛选、记忆查看器面板内编辑（P2 Task 5 编辑模式是侧栏入口）。
