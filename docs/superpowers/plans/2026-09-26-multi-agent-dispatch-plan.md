# 多 agent 拆分派发（C 档第二轮）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 主 agent 能把可独立的子任务派给子 agent（独立上下文 / 独立转录 / 可回放），结果回父时显式标注 untrusted；子 agent 的写操作一律过父方审批。

**Architecture:** 新增 `task` 工具作为唯一派发通道 → `agent-store.runSubAgentTask` 装配依赖（generate / prompt / confirm / signal / onUpdate）→ `runSubAgent` 调既有 `runAgentLoop`（该引擎**不碰任何 store**，这是可以不改控制面的支点）→ 子转录写进 `conversation.subSessions`（随归档落盘）→ 父端只拿到一段标注 untrusted 的结论（超 1200 tokens 截断 + `task(task_id)` 回放）。子 agent 的工具面由引擎级 `allowedTools` **fail-closed** 白名单约束。

**Tech Stack:** Electron 主进程无关（纯渲染层 + 既有 IPC），React 19 + Zustand + TypeScript 6 + vitest；沿用 CJS / strict TS / ESLint `--max-warnings 0`。

**Spec:** `docs/superpowers/specs/2026-09-26-multi-agent-dispatch-design.md`（用户 2026-09-26 已批准：范围 = 子会话 + 回收 + untrusted（顺序执行）；写权限 = 只读直跑 + 写操作转父方审批；§7.1-C2 不带）

## ⚠️ 对 spec 的一处实现修正（写计划时发现）

**子会话 `id` 直接取 `taskId`（12 位十六进制），不再另造 8 位短 id。** spec §3.7 写了 `id`（8 位）+ `taskId` 两个字段——但会话内 `taskId → 会话` 本就是一对一（幂等语义），再截 8 位只会制造「两个不同任务撞同一个 id」的可能，而 id 是 UI 卡片与回放的引用键。取 `id === taskId` 后：无碰撞故事、回放参数与卡片引用同一把钥匙。若你更想要短 id，评审时说一声（改 `task.tool.ts` 与卡片各一处）。

## Global Constraints

- **不新增 IPC 通道**：子 agent 全程走既有 `llm:generate-stream` / `memory:*` / `db:*`；`src/shared/ipc-channel-parity.test.ts` 不应有任何改动。
- 所有用户可见文案**三语齐全**（zh-CN / en-US / ru-RU），一律经 `t()`；新增 key 必须三语齐全（`i18n-key-guard` + `locale.test` 双向校验）。
- 颜色只用 `var(--color-*)` 令牌；窄面板（264px）内新控件走既有 `ui/` 组件刻度。
- TS strict（`noUnusedLocals` / `noUnusedParameters`）；ESLint `--max-warnings 0`。
- 门禁命令用项目自身形式：`npx tsc --noEmit && npx eslint . --ext ts,tsx --max-warnings 0 && npx vitest run`（裸 `npx eslint .` 会纳入 `public/*.js` 而报既有错）。
- **提交纪律**：改动跨 `src/` 与 `electron/` 时在**仓库根** `git add -A`（或列全路径）——C 档第一轮曾因 `git add -A src/` 漏掉 `electron/` 文件导致 CI 三平台全红。每任务末 `git status --short --untracked-files=all` 必须为空。
- 攒够本次工作单元（7 笔）再推；**推送后必须核三平台 CI**。

## Review Focus

以下输入/失败模式 spec 未明说或容易漏测，每个都在**拥有该代码的任务**里补了测试：

1. **白名单里出现不存在的工具名**（模型幻觉 / 提示词过时）—— 期望：单个名字被忽略，白名单**其余部分照常生效**（绝不能因一个坏名字退化成「全量放行」）。
2. **子 agent 的 generateFn 抛错**（模型不可用 / Key 失效）—— 期望：子会话 `failed` + 父收到失败结果，父的 ReAct 循环不被中断。
3. **父被取消时子 agent 正卡在审批卡上**—— 期望：确认卡消失、子会话 `cancelled`、不留下悬挂的 promise。
4. **无人场（headless 自动化）里的写操作**—— 期望：`SUBAGENT_CONFIRM_TIMEOUT_MS` 到点自动拒绝，绝不无限等待。
5. **归档里 `subSessions` 形状损坏 / 条数超限**（手改或旧档）—— 期望：坏条目过滤、超限裁剪，不因一条坏数据丢整个会话。
6. **同一 description 重复派发**（模型在 ReAct 循环里重试）—— 期望：命中原会话并在结果里带 `task_id`，不重复烧 token。
7. **子 agent 转录里的 tool_call / thinking 残片**（崩溃残片）—— 期望：与父同口径净化。

---

### Task 1: 引擎级委派白名单 + 工具提示词子集

**Files:**
- Modify: `src/services/agent/agent-engine.ts`（`AgentEngineOptions.allowedTools` + 预扫描守卫 + 拒绝/未知两条观察文案）
- Modify: `src/services/agent/tool-registry.ts`（`generateToolPrompt(tools?)` 可选子集）
- Modify: `src/services/agent/tool-registry.test.ts`（补子集用例；文件不存在则新建）
- Modify: `src/services/agent/agent-engine.test.ts`（补白名单用例）
- Modify: `src/shared/locale-data/agent.ts`（新增 `engine.toolNotDelegated`，三语）

**Interfaces:**
- Produces:
  - `AgentEngineOptions.allowedTools?: string[]`（缺省 `undefined` = 全量，与现状逐字一致）
  - `toolRegistry.generateToolPrompt(tools?: AgentTool[]): string`（缺省 `listAll()`）
  - i18n `engine.toolNotDelegated`（"该工具不在本次委派的白名单内：{name}\n本次可用的工具：{tools}"）

- [ ] **Step 1: 写失败测试**

`src/services/agent/agent-engine.test.ts` 追加（沿用该文件既有的 mock 生成器与 `runAgentLoop` 调用范式；若既有文件用 `registerBuiltinTools()` 注册真表，则白名单直接引用真名）：

```ts
describe('委派白名单（C 档第二轮 T1）', () => {
  it('白名单外的工具不执行，观察文案点名白名单（fail-closed）', async () => {
    registerBuiltinTools()
    const calls: string[] = []
    const generate = vi.fn(async (messages: { role: string; content: string }[]) => {
      const last = messages[messages.length - 1].content
      // 第一轮：请求白名单外的 write_file；第二轮：请求白名单内的 read_file
      if (!last.includes('<tool_result')) return '<tool_call>{"name":"write_file","arguments":{"file_path":"x.md","content":"y"}}</tool_call>'
      return 'done'
    })
    const seen: string[] = []
    await runAgentLoop('sys', [], 'go', 'm', generate as never, {
      onTextChunk: () => {},
      onToolCallStart: tc => seen.push(tc.toolName),
      onToolCallComplete: tc => calls.push(`${tc.toolName}:${tc.status}`),
      onToolCallConfirmRequired: async () => true,
      onDone: () => {},
      onError: () => {},
    }, undefined, { allowedTools: ['read_file'] })
    expect(calls).toContain('write_file:failed')                    // 被拒且标记失败
    const observation = (generate.mock.calls[1][0] as { content: string }[]).slice(-1)[0].content
    expect(observation).toContain('白名单')                          // 文案点明原因
    expect(observation).toContain('read_file')                       // 且给出可用集合
    expect(observation).not.toContain('write_file,')                 // 不把不可用的工具当成可用项列出
  })

  it('缺省 allowedTools：行为与现状一致（write_file 走确认而非被拒）', async () => {
    registerBuiltinTools()
    const statuses: string[] = []
    const generate = vi.fn(async (messages: { role: string; content: string }[]) => {
      const last = messages[messages.length - 1].content
      if (!last.includes('<tool_result')) return '<tool_call>{"name":"read_file","arguments":{"file_path":"x.md"}}</tool_call>'
      return 'done'
    })
    await runAgentLoop('sys', [], 'go', 'm', generate as never, {
      onTextChunk: () => {}, onToolCallStart: () => {},
      onToolCallComplete: tc => statuses.push(tc.status),
      onToolCallConfirmRequired: async () => true,
      onDone: () => {}, onError: () => {},
    })
    expect(statuses.some(s => s === 'completed' || s === 'failed')).toBe(true)   // 走到真实执行路径（不是被白名单拒）
  })
})
```

`src/services/agent/tool-registry.test.ts`（或新建）追加：

```ts
describe('generateToolPrompt 子集（C 档第二轮 T1）', () => {
  it('只列给定工具；缺省列全量', () => {
    toolRegistry.clear()
    const mk = (name: string) => ({ name, description: `d-${name}`, source: 'builtin' as const,
      inputSchema: { type: 'object' as const, properties: {} }, requiresConfirmation: false, isReadOnly: true,
      execute: async () => ({ success: true, content: '' }) })
    toolRegistry.registerAll([mk('a_tool'), mk('b_tool')])
    const subset = toolRegistry.generateToolPrompt([toolRegistry.get('a_tool')!])
    expect(subset).toContain('a_tool')
    expect(subset).not.toContain('b_tool')
    expect(toolRegistry.generateToolPrompt()).toContain('b_tool')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/services/agent/agent-engine.test.ts src/services/agent/tool-registry.test.ts`
Expected: FAIL —— 白名单参数未生效（write_file 会被执行/走确认）、`generateToolPrompt` 忽略入参

- [ ] **Step 3: 实现**

`tool-registry.ts`：

```ts
  generateToolPrompt(tools: AgentTool[] = this.listAll()): string {
    if (tools.length === 0) return ''
    // …函数体其余不变，只把原 `const tools = this.listAll()` 换成入参
```

`agent-engine.ts`：

```ts
export interface AgentEngineOptions {
  /** 模型上下文窗口（tokens，来自 `ModelProfile.contextWindow`）；用于动态压缩预算（Task D7-1 消费） */
  modelContextWindow?: number
  /**
   * 委派白名单（C 档第二轮）：给定后**只允许**名单内的工具执行（fail-closed）。
   * 缺省 undefined = 全量（父 agent 行为与现状逐字一致）。
   */
  allowedTools?: string[]
}
```

预扫描处（`agent-engine.ts:308-319`）改为：

```ts
    const allowed = options?.allowedTools
    const jobs: ToolCallJob[] = toolCalls.map(tc => {
      const info: ToolCallInfo = { id: crypto.randomUUID(), toolName: tc.name, arguments: tc.arguments, status: 'pending' }
      allToolCalls.push(info)
      const registered = toolRegistry.get(tc.name)
      // 白名单 fail-closed：名单外的工具当作「不可用」处理（不执行、走拒绝观察）
      const permitted = !allowed || allowed.includes(tc.name)
      const tool = permitted ? registered : undefined
      if (tool) info.source = tool.source
      return { tc, tool, deniedByAllowlist: Boolean(registered) && !permitted, info }
    })
```

`ToolCallJob` 增字段（`agent-engine.ts:412` 附近）：

```ts
interface ToolCallJob {
  tc: ParsedToolCall
  /** 未注册 或 被白名单拒绝 → undefined（走拒绝/未知观察） */
  tool: AgentTool | undefined
  /** 存在于注册表但被白名单拒绝（文案与「未知工具」区分） */
  deniedByAllowlist?: boolean
  info: ToolCallInfo
}
```

`executeToolJob` 的两条拒绝文案（`agent-engine.ts:443-452`）：

```ts
  const availableNames = (): string => (deps?.allowedTools ?? toolRegistry.listAll().map(x => x.name)).join(', ')
  if (!tool) {
    info.status = 'failed'
    info.error = job.deniedByAllowlist
      ? t('engine.toolNotDelegated').replace('{name}', tc.name).replace('{tools}', availableNames())
      : t('agent.unknownTool').replace('{name}', tc.name)
    callbacks.onToolCallComplete(info)
    return {
      observation: `<tool_result name="${tc.name}" error="true">\n${
        job.deniedByAllowlist
          ? t('engine.toolNotDelegated').replace('{name}', tc.name).replace('{tools}', availableNames())
          : t('engine.unknownToolAvailable').replace('{name}', tc.name).replace('{tools}', availableNames())
      }\n</tool_result>`,
      artifacts,
    }
  }
```

`AgentEngineDeps` 增 `allowedTools?: string[]`（与 options 同源，供文案用）：

```ts
export interface AgentEngineDeps {
  writeResult?: (content: string) => Promise<{ success: boolean; path?: string; error?: string }>
  /** 与 AgentEngineOptions.allowedTools 同源：仅供「未知/被拒工具」文案列出可用集合 */
  allowedTools?: string[]
}
```

⚠️ 运行循环里把 `options.allowedTools` 透传进 `executeToolJob` 的调用点（`agent-engine.ts` 中调用 `executeToolJob(...)` 处补 `{ ...deps, allowedTools: options?.allowedTools }`）。

`src/shared/locale-data/agent.ts` 追加：

```ts
  'engine.toolNotDelegated': { 'zh-CN': '该工具不在本次委派的白名单内：{name}\n本次可用的工具：{tools}', 'en-US': 'This tool is not in the delegation allowlist: {name}\nAvailable here: {tools}', 'ru-RU': 'Инструмент не входит в белый список делегирования: {name}\nДоступно здесь: {tools}' },
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/services/agent/agent-engine.test.ts src/services/agent/tool-registry.test.ts`
Expected: PASS（新增用例 + 既有引擎用例全绿——缺省路径不变）

- [ ] **Step 5: 全量门禁**

Run: `npx tsc --noEmit && npx eslint . --ext ts,tsx --max-warnings 0 && npx vitest run`
Expected: 三条全绿

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -F /tmp/commit-s1.txt   # feat: 引擎级委派白名单 + 工具提示词子集（C 档第二轮 T1）
git status --short --untracked-files=all   # 必须为空
```

---

### Task 2: 子 agent 类型 / 幂等 TaskRef / scoped 提示词装配

**Files:**
- Create: `src/services/agent/subagent/types.ts`
- Create: `src/services/agent/subagent/taskref.ts`
- Create: `src/services/agent/subagent/prompt.ts`
- Create: `src/services/agent/subagent/taskref.test.ts`
- Create: `src/services/agent/subagent/prompt.test.ts`
- Modify: `src/services/agent/context-builder.ts`（抽出 `collectMemoryLayers()`，父装配改用它）
- Modify: `src/shared/locale-data/agent.ts`（子 agent 身份与装配文案，三语）

**Interfaces:**
- Consumes: T1 的 `generateToolPrompt(tools?)`
- Produces:
  - `SubAgentStatus = 'running' | 'completed' | 'failed' | 'cancelled'`
  - `SubAgentTask = { taskId: string; description: string; prompt: string; allowedTools: string[]; modelId: string }`
  - `SubAgentSession`（见下）
  - `subAgentReadOnlyTools(): string[]`、`SUBAGENT_WRITE_TOOLS`、`resolveSubAgentTools(requested?: string[]): string[]`
  - `computeSubAgentTaskRef(conversationId: string, description: string, tools: string[]): string`
  - `buildSubAgentPrompt(task: SubAgentTask): Promise<string>`
  - `SUBAGENT_PROMPT_BUDGET_TOKENS = 3000`

- [ ] **Step 1: 写失败测试**（`taskref.test.ts`）

```ts
import { describe, it, expect } from 'vitest'
import { computeSubAgentTaskRef } from './taskref'
import { resolveSubAgentTools, SUBAGENT_WRITE_TOOLS, subAgentReadOnlyTools } from './taskref'
import { registerBuiltinTools } from '../tools'

describe('computeSubAgentTaskRef（幂等指纹）', () => {
  it('同输入同值；会话 / 描述 / 工具集任一变化即不同', () => {
    const a = computeSubAgentTaskRef('c1', '查玉佩伏笔', ['read_drafts'])
    expect(computeSubAgentTaskRef('c1', '查玉佩伏笔', ['read_drafts'])).toBe(a)
    expect(computeSubAgentTaskRef('c2', '查玉佩伏笔', ['read_drafts'])).not.toBe(a)
    expect(computeSubAgentTaskRef('c1', '查玉佩伏笔（重跑）', ['read_drafts'])).not.toBe(a)
    expect(computeSubAgentTaskRef('c1', '查玉佩伏笔', ['read_drafts', 'read_memory'])).not.toBe(a)
  })
  it('工具顺序无关（集合语义）', () => {
    expect(computeSubAgentTaskRef('c1', 'x', ['b', 'a'])).toBe(computeSubAgentTaskRef('c1', 'x', ['a', 'b']))
  })
})

describe('resolveSubAgentTools（白名单构造）', () => {
  registerBuiltinTools()
  it('只读段 = 内置只读工具（排除 task / skill / 写工具 / MCP）', () => {
    const list = subAgentReadOnlyTools()
    expect(list).toContain('read_drafts')
    expect(list).not.toContain('task')
    expect(list).not.toContain('skill')
    for (const w of SUBAGENT_WRITE_TOOLS) expect(list).not.toContain(w)
  })
  it('tools 参数取交集；未知名字忽略且**不破坏其余白名单**（Review Focus 1）', () => {
    const list = resolveSubAgentTools(['read_drafts', '不存在的工具', 'write_file'])
    expect(list).toContain('read_drafts')
    expect(list).toContain('write_file')            // 写工具恒在（执行时过审批，T6）
    expect(list).not.toContain('不存在的工具')
    expect(list.length).toBeGreaterThan(1)          // 不因坏名字退化成空/全量
  })
  it('缺省 = 全部内置只读 + 写工具', () => {
    const list = resolveSubAgentTools(undefined)
    expect(list).toContain('read_drafts')
    expect(list).toContain('write_file')
  })
  it('tools 参数只选只读子集时不带写工具？—— 不带：写工具恒在（语义见 spec §3.4）', () => {
    expect(resolveSubAgentTools(['read_drafts'])).toContain('write_file')
  })
})
```

`prompt.test.ts`：

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildSubAgentPrompt } from './prompt'
import { registerBuiltinTools } from '../tools'

beforeEach(() => {
  registerBuiltinTools()
  Object.defineProperty(window, 'velaAPI', {
    value: { invoke: vi.fn(async (ch: string) => {
      if (ch === 'memory:list') return [{ file: 'book-state.md', kind: 'book', loadMode: 'resident', brief: '主角是苏晚晴', stale: false, mtime: 1 }]
      if (ch === 'memory:read') return '---\nload_mode: resident\n---\n主角是苏晚晴'
      return null
    }) },
    configurable: true,
  })
})

describe('buildSubAgentPrompt（scoped 装配）', () => {
  const task = { taskId: 't1', description: '查玉佩伏笔', prompt: '查清前 29 章里玉佩相关伏笔', allowedTools: ['read_drafts', 'read_memory'], modelId: 'm' }

  it('含子 agent 身份 + 任务说明 + L0/记忆 + 白名单内工具契约', async () => {
    const p = await buildSubAgentPrompt(task)
    expect(p).toContain('查玉佩伏笔')
    expect(p).toContain('read_drafts')
    expect(p).toContain('read_memory')
    expect(p).toContain('主角是苏晚晴')        // 常驻记忆段复用父逻辑
  })

  it('**不含**白名单外的工具契约（子 agent 不该看到它调不了的工具）', async () => {
    const p = await buildSubAgentPrompt(task)
    expect(p).not.toContain('write_file')
    expect(p).not.toContain('search_knowledge')
  })

  it('**不含**父专属段：技能目录 / 会话摘要 / 编辑器上下文', async () => {
    const p = await buildSubAgentPrompt(task)
    expect(p).not.toContain('## 可用技能')
    expect(p).not.toContain('会话摘要')
    expect(p).not.toContain('编辑器状态')
  })

  it('超预算按 常驻 → 目录 → 工具描述 顺序降级，最终 ≤ 3000 tokens', async () => {
    const bigTask = { ...task, prompt: '详'.repeat(4000) }
    const p = await buildSubAgentPrompt(bigTask)
    expect(estimateTokens(p)).toBeLessThanOrEqual(3000)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/services/agent/subagent/taskref.test.ts src/services/agent/subagent/prompt.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现**

`types.ts`：

```ts
/**
 * 子 agent 派发（C 档第二轮）——类型定义。
 * 设计依据：docs/superpowers/specs/2026-09-26-multi-agent-dispatch-design.md
 */
import type { AgentMessage } from '../../../stores/agent-store'
import type { ToolArtifact, ToolCallInfo } from '../tool-registry'

export type SubAgentStatus = 'running' | 'completed' | 'failed' | 'cancelled'

/** 派发请求（工具参数归一化后的形状） */
export interface SubAgentTask {
  /** 幂等指纹（= 会话 id，见计划头的实现修正） */
  taskId: string
  description: string
  prompt: string
  allowedTools: string[]
  modelId: string
}

/** 子会话（挂在 conversation.subSessions，随归档落盘） */
export interface SubAgentSession {
  id: string
  taskId: string
  description: string
  prompt: string
  allowedTools: string[]
  status: SubAgentStatus
  messages: AgentMessage[]
  toolCalls: ToolCallInfo[]
  artifacts: ToolArtifact[]
  /** 完整结论（未截断；注入父端的版本另经截断，见 runner 的 formatSubAgentResult） */
  result: string
  error?: string
  startedAt: number
  endedAt?: number
}

/** 单会话子会话数上限（超出丢最旧） */
export const MAX_SUB_SESSIONS = 20
/** 单子会话转录消息数上限 */
export const MAX_SUBAGENT_MESSAGES = 60
/** 注入父端的结果截断上限 */
export const SUBAGENT_RESULT_MAX_TOKENS = 1200
/** 子 agent 系统提示词预算 */
export const SUBAGENT_PROMPT_BUDGET_TOKENS = 3000
/** 单次派发墙钟上限（超时中断 → failed） */
export const SUBAGENT_MAX_MS = 300_000
/** 父方审批卡超时（到点自动拒绝，无人场不悬挂） */
export const SUBAGENT_CONFIRM_TIMEOUT_MS = 120_000
```

`taskref.ts`：

```ts
/**
 * 幂等 TaskRef 与白名单构造（C 档第二轮）。
 * 指纹复用 prefix-accounting 的 FNV-1a 双拼接（同步零依赖，强度足够——只是去重键）。
 */
import { computePrefixFingerprint } from '../prefix-accounting'
import { toolRegistry } from '../tool-registry'

/** 子 agent 可请求的写工具（恒在名单内；每次调用过父方审批，spec §3.4/§3.5） */
export const SUBAGENT_WRITE_TOOLS: readonly string[] = [
  'write_file', 'edit_file', 'open_editor', 'start_workflow', 'update_config', 'index_content', 'call_external_api',
]

/** 子 agent 结构性不可见的内置工具（禁止递归派发 / 省预算 / 来源不可控） */
const SUBAGENT_EXCLUDED_TOOLS: readonly string[] = ['task', 'skill']

/** 工具集排序归一（集合语义：顺序不同的同一集合 = 同一指纹） */
const normalizeTools = (tools: string[]): string[] => [...new Set(tools)].sort()

export function computeSubAgentTaskRef(conversationId: string, description: string, tools: string[]): string {
  return computePrefixFingerprint(`${conversationId}\u0000${description}\u0000${normalizeTools(tools).join(',')}`)
}

/** 内置只读工具（排除结构性排除项与写工具；MCP / skill 来源不进子 agent 白名单） */
export function subAgentReadOnlyTools(): string[] {
  return toolRegistry.listAll()
    .filter(t => t.source === 'builtin' && t.isReadOnly)
    .map(t => t.name)
    .filter(n => !SUBAGENT_WRITE_TOOLS.includes(n) && !SUBAGENT_EXCLUDED_TOOLS.includes(n))
}

/**
 * 子 agent 白名单 = 内置只读（∩ 请求子集）+ 写工具恒在。
 * 未知名字**忽略但不影响其余**（Review Focus 1：一个坏名字绝不能让白名单退化成全量）。
 */
export function resolveSubAgentTools(requested?: string[]): string[] {
  const readOnly = subAgentReadOnlyTools()
  const picked = requested && requested.length > 0
    ? readOnly.filter(n => requested.includes(n))
    : readOnly
  return normalizeTools([...picked, ...SUBAGENT_WRITE_TOOLS])
}
```

`prompt.ts`：

```ts
/**
 * 子 agent 的系统提示词装配（scoped）——身份 + L0 + 常驻记忆 + 记忆目录 + 白名单工具。
 * 复用父的记忆分层装配（collectMemoryLayers），避免复制粘贴漂移。
 */
import { t } from '../../../shared/locale'
import { toolRegistry } from '../tool-registry'
import { estimateTokens, truncateToTokenBudget } from '../token-budget'
import { buildL0ProjectContext, collectMemoryLayers } from '../context-builder'
import { SUBAGENT_PROMPT_BUDGET_TOKENS, type SubAgentTask } from './types'

export async function buildSubAgentPrompt(task: SubAgentTask): Promise<string> {
  const { resident, catalog } = await collectMemoryLayers('')
  const tools = task.allowedTools
    .map(n => toolRegistry.get(n))
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
  const parts = [
    t('subagent.identity').replace('{description}', task.description),
    t('subagent.taskHeader').replace('{prompt}', task.prompt),
    buildL0ProjectContext() ?? '',
    resident,
    catalog,
    toolRegistry.generateToolPrompt(tools),
  ].filter(Boolean)
  const full = parts.join('\n\n---\n\n')
  if (estimateTokens(full) <= SUBAGENT_PROMPT_BUDGET_TOKENS) return full
  // 降级顺序：常驻 → 目录 → 工具描述（身份与任务说明永不裁——裁了子 agent 就不知道自己要干什么）
  const dropResident = [parts[0], parts[1], parts[2], parts[4], parts[5]].filter(Boolean)
  const noResident = dropResident.join('\n\n---\n\n')
  if (estimateTokens(noResident) <= SUBAGENT_PROMPT_BUDGET_TOKENS) return noResident
  const noCatalog = [parts[0], parts[1], parts[2], parts[5]].filter(Boolean).join('\n\n---\n\n')
  if (estimateTokens(noCatalog) <= SUBAGENT_PROMPT_BUDGET_TOKENS) return noCatalog
  return truncateToTokenBudget([parts[0], parts[1], parts[2]].filter(Boolean).join('\n\n---\n\n'), SUBAGENT_PROMPT_BUDGET_TOKENS)
}
```

`context-builder.ts` 抽出（父装配改为调用它，行为不变）：

```ts
/** 记忆分层装配（父/子共用）：常驻段 + 目录段 + 本轮 manual 正文（C 档第二轮抽取） */
export async function collectMemoryLayers(userMessage: string): Promise<{
  resident: string
  catalog: string
  manual: string
  segments: ContextSegment[]
}>
```

抽取口径（逐项对应现 `buildAgentSystemSegmentsAsync`，**零行为变化**）：

| 现在 | 抽取后 |
|---|---|
| `memory:list` + stale/F9 过滤 + `entries` 构造 | `collectMemoryLayers` 内部（原样） |
| 段 1 常驻（读盘 → `buildResidentSection` → push `memory-resident` 段 + warn） | 同名逻辑；产出 `resident`（= 原 `residentText`） |
| 段 2 目录（`buildMemoryCatalog` → push `memory-catalog` 段） | 产出 `catalog`（= 原 `parts[0]`，即目录文本） |
| 段 2 manual（`matchMentionedManuals` + `buildManualMentionSection` → push `memory-manual` 段） | 产出 `manual`（= 原 `manualText`） |
| `m2 = injectedHeader + parts.join(...)` | 留在 `buildAgentSystemSegmentsAsync`（父的拼装口径不变） |
| `segments`（含 base 段与三段记忆段） | 返回的 `segments` **只含记忆三段**；父处 `segments = [...baseSegments, ...memorySegments]` |

⚠️ 抽取后必须保持：既有 37 条 `context-builder.test.ts` 用例**逐条不变通过**（这是本次重构的唯一验收标准）。

并把 `buildL0ProjectContext` 加 `export`。

`src/shared/locale-data/agent.ts` 追加（三语）：`subagent.identity`（"你是被派来执行**单一子任务**的执行者……你没有对话历史；不要请求派发新任务；需要写操作时直接调用（父端会确认）"）、`subagent.taskHeader`（"## 你的任务\n{description}\n\n{prompt}"）、`subagent.resultHeader`、`subagent.resultFooter`、`subagent.untrustedNotice`、`subagent.cardTitle`、`subagent.confirmTitle`、`subagent.confirmHint`、`subagent.cancelled`、`subagent.timeout`、`subagent.replayHint`、`subagent.idempotentHint`、`subagent.duplicateRunning`（T5/T6/T7 用；本任务先落身份与任务两键，其余随任务落地）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/services/agent/subagent/ src/services/agent/context-builder.test.ts`
Expected: PASS（含父装配既有 37 条——抽取重构零行为变化）

- [ ] **Step 5: 全量门禁 + 提交**

```bash
npx tsc --noEmit && npx eslint . --ext ts,tsx --max-warnings 0 && npx vitest run
git add -A && git commit -F /tmp/commit-s2.txt   # feat: 子 agent 类型/TaskRef/scoped 提示词装配（C 档第二轮 T2）
git status --short --untracked-files=all
```

---

### Task 3: `runSubAgent` 运行体（转录 / 取消 / 超时 / untrusted 回收）

**Files:**
- Create: `src/services/agent/subagent/runner.ts`
- Create: `src/services/agent/subagent/runner.test.ts`
- Modify: `src/shared/locale-data/agent.ts`（结果回收文案，三语）

**Interfaces:**
- Consumes: T2 的 `SubAgentTask` / `SubAgentSession` / 常量；引擎的 `runAgentLoop` / `LLMGenerateFn` / `AgentEngineCallbacks`
- Produces:
  - `runSubAgent(task: SubAgentTask, deps: SubAgentDeps): Promise<SubAgentSession>`
  - `formatSubAgentResult(session: SubAgentSession): string`（注入父端的 untrusted 文本）
  - `formatSubAgentTranscript(session: SubAgentSession): string`（`task(task_id)` 回放用：全文转录 + 同样的 untrusted 标注）
  - `SubAgentDeps = { generate: LLMGenerateFn; buildPrompt: (task) => Promise<string>; confirm: (tc: ToolCallInfo) => Promise<boolean>; signal?: AbortSignal; onUpdate?: (s: SubAgentSession) => void; now?: () => number }`

- [ ] **Step 1: 写失败测试**（`runner.test.ts`）

```ts
import { describe, it, expect, vi } from 'vitest'
import { runSubAgent, formatSubAgentResult, formatSubAgentTranscript } from './runner'
import { SUBAGENT_RESULT_MAX_TOKENS, type SubAgentDeps, type SubAgentTask } from './types'
import { estimateTokens } from '../token-budget'

const task = (over: Partial<SubAgentTask> = {}): SubAgentTask =>
  ({ taskId: 'abc123', description: '查玉佩伏笔', prompt: '查清玉佩伏笔', allowedTools: ['read_drafts'], modelId: 'm', ...over })

/** 显式类型（不用 as never：那会掩盖注入签名的漂移） */
const baseDeps = (over: Partial<SubAgentDeps> = {}): SubAgentDeps => ({
  generate: async () => 'ok',
  buildPrompt: async () => 'SUBPROMPT',
  confirm: async () => true,
  ...over,
})

describe('runSubAgent', () => {
  it('正常完成：结论进 result、转录含 user 提示与 assistant 回复、状态 completed', async () => {
    const generate = vi.fn(async () => '玉佩在第 3 章首次出现。')
    const s = await runSubAgent(task(), baseDeps({ generate }))
    expect(s.status).toBe('completed')
    expect(s.result).toContain('玉佩在第 3 章首次出现。')
    expect(s.messages[0]).toMatchObject({ role: 'user', content: '查清玉佩伏笔' })
    expect(s.messages.some(m => m.role === 'assistant' && m.content.includes('玉佩'))).toBe(true)
    expect(s.endedAt).toBeGreaterThanOrEqual(s.startedAt)
  })

  it('空白起步：historyMessages 为空（隔离）且 systemPrompt 用注入的装配结果', async () => {
    const generate = vi.fn(async () => 'ok')
    await runSubAgent(task(), baseDeps({ generate }))
    const firstCall = generate.mock.calls[0][0] as { role: string; content: string }[]
    expect(firstCall[0]).toMatchObject({ role: 'system', content: 'SUBPROMPT' })
    expect(firstCall.filter(m => m.role !== 'system')).toHaveLength(1)   // 只有本轮 user，无父历史
  })

  it('generateFn 抛错 → failed + 原因，不向上抛（Review Focus 2）', async () => {
    const generate = vi.fn(async () => { throw new Error('model down') })
    const s = await runSubAgent(task(), baseDeps({ generate }))
    expect(s.status).toBe('failed')
    expect(s.error).toContain('model down')
  })

  it('父 signal 取消 → cancelled，转录保留', async () => {
    const ac = new AbortController()
    const generate = vi.fn(async (_m: unknown, _id: string, onChunk?: (c: string) => void) => {
      ac.abort()                                  // 模拟「生成中途被取消」
      onChunk?.('半截')
      return '半截'
    })
    const s = await runSubAgent(task(), baseDeps({ generate, signal: ac.signal }))
    expect(s.status).toBe('cancelled')
  })

  it('墙钟超时 → failed + 超时原因（SUBAGENT_MAX_MS 用注入的 now 驱动，测试不等待真实时间）', async () => {
    let clock = 0
    const generate = vi.fn(async () => { clock += 400_000; return 'ok' })
    const s = await runSubAgent(task(), baseDeps({ generate, now: () => clock }))
    expect(s.status).toBe('failed')
    expect(s.error).toBeTruthy()
  })

  it('工具调用进转录（toolCalls 与 assistant 消息的 toolCalls 同源）', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce('<tool_call>{"name":"read_drafts","arguments":{"chapter":3}}</tool_call>')
      .mockResolvedValueOnce('结论：玉佩在第 3 章。')
    const s = await runSubAgent(task(), baseDeps({ generate }))
    expect(s.toolCalls.map(c => c.toolName)).toContain('read_drafts')
    expect(s.artifacts).toEqual([])
  })

  it('onUpdate 被调用（父端据此流式写回 store）', async () => {
    const generate = vi.fn(async () => 'ok')
    const onUpdate = vi.fn()
    await runSubAgent(task(), baseDeps({ generate, onUpdate }))
    expect(onUpdate).toHaveBeenCalled()
    const last = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0]
    expect(last.status).toBe('completed')
  })
})

describe('formatSubAgentResult（untrusted 回收，Review Focus 5/6）', () => {
  const mk = (result: string, over = {}) => ({
    id: 'abc123', taskId: 'abc123', description: '查玉佩伏笔', prompt: '', allowedTools: [],
    status: 'completed' as const, messages: [], toolCalls: [], artifacts: [], result, startedAt: 0, endedAt: 1000, ...over,
  })

  it('含 untrusted 标注 + task_id + 回放提示', () => {
    const text = formatSubAgentResult(mk('结论'))
    expect(text).toContain('结论')
    expect(text).toContain('untrusted')
    expect(text).toContain('abc123')
    expect(text).toMatch(/task\(/)
  })

  it('超 1200 tokens 截断（Review Focus 5）', () => {
    const text = formatSubAgentResult(mk('详'.repeat(3000)))
    expect(estimateTokens(text)).toBeLessThanOrEqual(SUBAGENT_RESULT_MAX_TOKENS + 120)  // 头部标注另计
  })

  it('失败不静默：状态与原因都在文本里（Review Focus 2）', () => {
    const text = formatSubAgentResult(mk('', { status: 'failed', error: 'model down' }))
    expect(text).toContain('model down')
  })

  it('回放（formatSubAgentTranscript）给全文转录 + 同样标 untrusted（截断只作用于「回收」，不作用于回放）', () => {
    const long = { ...mk('详'.repeat(3000)), messages: [
      { id: 'm1', role: 'user' as const, content: '查玉佩', createdAt: 0 },
      { id: 'm2', role: 'assistant' as const, content: '详'.repeat(3000), createdAt: 1 },
    ] }
    const text = formatSubAgentTranscript(long)
    expect(text).toContain('untrusted')
    expect(text.length).toBeGreaterThan(3000)          // 未被截断
    expect(text).toContain('查玉佩')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/services/agent/subagent/runner.test.ts`
Expected: FAIL —— `Failed to resolve import "./runner"`

- [ ] **Step 3: 实现 `runner.ts`**

```ts
/**
 * 子 agent 运行体（C 档第二轮）。
 *
 * 支点：runAgentLoop 不碰任何 store（agent-engine.ts:130-140），故子 agent 只需再调一次它，
 * 用自己的 callbacks 写自己的转录——父的单例（AbortController / pendingConfirmations / 前缀记账）
 * 只在「取消传播」与「审批路由」两处被显式接线（见 agent-store）。
 */
import { t } from '../../../shared/locale'
import { runAgentLoop, type AgentEngineCallbacks, type LLMGenerateFn } from '../agent-engine'
import { estimateTokens, truncateToTokenBudget } from '../token-budget'
import type { ToolCallInfo } from '../tool-registry'
import {
  MAX_SUBAGENT_MESSAGES, SUBAGENT_MAX_MS, SUBAGENT_RESULT_MAX_TOKENS,
  type SubAgentSession, type SubAgentTask,
} from './types'

export interface SubAgentDeps {
  generate: LLMGenerateFn
  /** 系统提示词装配（注入以便单测；真实实现 = buildSubAgentPrompt） */
  buildPrompt: (task: SubAgentTask) => Promise<string>
  /** 写操作审批（注入以便单测；真实实现 = 父方审批卡） */
  confirm: (toolCall: ToolCallInfo) => Promise<boolean>
  /** 父的取消信号（子 signal 由本函数派生，父取消 → 子取消） */
  signal?: AbortSignal
  /** 转录/状态回写（父端 50ms 缓冲 flush） */
  onUpdate?: (session: SubAgentSession) => void
  /** 时钟注入（超时判定可测，不依赖真实时间） */
  now?: () => number
}

/** 转录尾部追加文本（沿用父的 50ms 缓冲口径由调用方实现，此处只做形状维护） */
function appendText(session: SubAgentSession, text: string): void {
  const last = session.messages[session.messages.length - 1]
  if (last?.role === 'assistant' && last.streaming) {
    last.content += text
    return
  }
  session.messages.push({ id: `sa-${session.messages.length}`, role: 'assistant', content: text, createdAt: Date.now(), streaming: true, toolCalls: [] })
}

export async function runSubAgent(task: SubAgentTask, deps: SubAgentDeps): Promise<SubAgentSession> {
  const now = deps.now ?? (() => Date.now())
  const startedAt = now()
  const session: SubAgentSession = {
    id: task.taskId, taskId: task.taskId, description: task.description, prompt: task.prompt,
    allowedTools: task.allowedTools, status: 'running', messages: [], toolCalls: [], artifacts: [],
    result: '', startedAt,
  }
  const emit = (): void => deps.onUpdate?.(session)

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, SUBAGENT_MAX_MS)
  const onParentAbort = (): void => controller.abort()
  deps.signal?.addEventListener('abort', onParentAbort, { once: true })
  emit()

  const callbacks: AgentEngineCallbacks = {
    onTextChunk: (chunk) => { appendText(session, chunk); emit() },
    onToolCallStart: (tc) => { upsertToolCall(session, tc); emit() },
    onToolCallComplete: (tc) => { upsertToolCall(session, tc); emit() },
    onToolCallConfirmRequired: (tc) => deps.confirm(tc),
    onDone: (fullText, toolCalls, artifacts) => {
      session.result = fullText
      session.toolCalls = toolCalls
      session.artifacts = artifacts
      session.messages = session.messages.map(m => ({ ...m, streaming: false })).slice(-MAX_SUBAGENT_MESSAGES)
    },
    onError: (error) => { session.error = error },
  }

  try {
    const systemPrompt = await deps.buildPrompt(task)
    await runAgentLoop(systemPrompt, [], task.prompt, task.modelId, deps.generate, callbacks, controller.signal, {
      allowedTools: task.allowedTools,
    }, { allowedTools: task.allowedTools })
    if (controller.signal.aborted) {
      session.status = 'cancelled'
      session.error = timedOut ? t('subagent.timeout') : t('subagent.cancelled')
    } else if (session.error) {
      session.status = 'failed'
    } else {
      session.status = 'completed'
    }
  } catch (e) {
    session.status = controller.signal.aborted ? 'cancelled' : 'failed'
    session.error = String(e)
  } finally {
    clearTimeout(timer)
    deps.signal?.removeEventListener('abort', onParentAbort)
    session.endedAt = now()
    session.messages = session.messages.map(m => ({ ...m, streaming: false }))
    emit()
  }
  return session
}

export function formatSubAgentResult(session: SubAgentSession): string {
  const header = t('subagent.resultHeader').replace('{description}', session.description)
  const notice = t('subagent.untrustedNotice')
  const body = session.status === 'completed'
    ? truncateToTokenBudget(session.result || t('subagent.emptyResult'), SUBAGENT_RESULT_MAX_TOKENS)
    : `${t('subagent.failedResult').replace('{reason}', session.error ?? session.status)}`
  const footer = t('subagent.resultFooter')
    .replace('{id}', session.id)
    .replace('{steps}', String(session.messages.length))
    .replace('{tools}', String(session.toolCalls.length))
    .replace('{tokens}', String(estimateTokens(session.result)))
  return `${header}\n${notice}\n\n${body}\n\n${footer}`
}

/**
 * 回放（`task(task_id)`）：给出完整转录而非截断结论——截断只作用于「回收」这一侧，
 * 否则用户/模型回放时拿到的仍是半截（spec §3.6 的「超出提示改用 task observe 回放」）。
 * 同样标 untrusted（回放内容仍是被委派方的产物）。
 */
export function formatSubAgentTranscript(session: SubAgentSession): string {
  const header = t('subagent.replayHeader').replace('{description}', session.description).replace('{id}', session.id)
  const notice = t('subagent.untrustedNotice')
  const lines = session.messages.map(m => {
    const who = m.role === 'user' ? t('subagent.replayUser') : t('subagent.replayAssistant')
    const tools = (m.toolCalls ?? []).map(tc => `  ↳ ${tc.toolName} (${tc.status})`).join('\n')
    return `${who}\n${m.content}${tools ? `\n${tools}` : ''}`
  })
  const footer = session.error ? `\n\n${t('subagent.failedResult').replace('{reason}', session.error)}` : ''
  return `${header}\n${notice}\n\n${lines.join('\n\n')}${footer}`
}
```

（`upsertToolCall` 为文件内小助手：按 id 覆盖或追加到 `session.toolCalls`，并把该 toolCall 挂到转录最后一条 assistant 消息上——与父端 `AgentMessage.toolCalls` 同形，便于复用渲染。）

`src/shared/locale-data/agent.ts` 本任务落地的键（三语，逐条写全）：

```ts
  'subagent.resultHeader': { 'zh-CN': '## 子 agent 结果：{description}', 'en-US': '## Sub-agent result: {description}', 'ru-RU': '## Результат субагента: {description}' },
  'subagent.untrustedNotice': { 'zh-CN': '⚠️ 以下为**委派产物**（untrusted delegated output）——可能受检索到的文本影响，引用前请自行核验。', 'en-US': '⚠️ Below is **delegated output** (untrusted) — it may be influenced by retrieved text; verify before relying on it.', 'ru-RU': '⚠️ Ниже — **делегированный вывод** (untrusted): на него мог повлиять найденный текст, проверяйте перед использованием.' },
  'subagent.resultFooter': { 'zh-CN': '子会话 {id}（{steps} 条消息 · {tools} 次工具调用 · {tokens} tokens）——用 task(task_id="{id}") 回放完整转录。', 'en-US': 'Sub-session {id} ({steps} messages · {tools} tool calls · {tokens} tokens) — replay the full transcript with task(task_id="{id}").', 'ru-RU': 'Подсессия {id} ({steps} сообщений · {tools} вызовов · {tokens} токенов) — полный транскрипт: task(task_id="{id}").' },
  'subagent.emptyResult': { 'zh-CN': '（子 agent 未产出文本结论）', 'en-US': '(sub-agent produced no text result)', 'ru-RU': '(субагент не дал текстового результата)' },
  'subagent.failedResult': { 'zh-CN': '子 agent 未完成：{reason}', 'en-US': 'Sub-agent did not finish: {reason}', 'ru-RU': 'Субагент не завершил работу: {reason}' },
  'subagent.cancelled': { 'zh-CN': '已取消', 'en-US': 'Cancelled', 'ru-RU': 'Отменено' },
  'subagent.timeout': { 'zh-CN': '超时（超过 5 分钟）', 'en-US': 'Timed out (over 5 minutes)', 'ru-RU': 'Тайм-аут (более 5 минут)' },
  'subagent.replayHeader': { 'zh-CN': '## 子会话转录：{description}（{id}）', 'en-US': '## Sub-session transcript: {description} ({id})', 'ru-RU': '## Транскрипт подсессии: {description} ({id})' },
  'subagent.replayUser': { 'zh-CN': '【任务】', 'en-US': '[Task]', 'ru-RU': '[Задача]' },
  'subagent.replayAssistant': { 'zh-CN': '【子 agent】', 'en-US': '[Sub-agent]', 'ru-RU': '[Субагент]' },
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/services/agent/subagent/runner.test.ts`
Expected: PASS（8 条）

- [ ] **Step 5: 全量门禁 + 提交**

```bash
npx tsc --noEmit && npx eslint . --ext ts,tsx --max-warnings 0 && npx vitest run
git add -A && git commit -F /tmp/commit-s3.txt   # feat: runSubAgent 运行体（转录/取消/超时/untrusted 回收）（C 档第二轮 T3）
git status --short --untracked-files=all
```

---

### Task 4: 子会话落盘（会话字段 + 归档 codec + `/clear`）

**Files:**
- Modify: `src/stores/agent-store.ts`（`AgentConversation.subSessions?: SubAgentSession[]`）
- Modify: `src/services/agent/archive-codec.ts`（序列化 / 防御式解析 / 净化 / 上限裁剪）
- Modify: `src/services/agent/archive-codec.test.ts`

**Interfaces:**
- Consumes: T2 的 `SubAgentSession` / `MAX_SUB_SESSIONS` / `MAX_SUBAGENT_MESSAGES`
- Produces: `parseArchive` 往返保 `subSessions`；形状坏条目过滤；超限裁剪

- [ ] **Step 1: 写失败测试**（追加到 `archive-codec.test.ts`）

```ts
describe('归档 subSessions（C 档第二轮 T4）', () => {
  const sess = (over: Partial<SubAgentSession> = {}): SubAgentSession => ({
    id: 'abc123', taskId: 'abc123', description: '查玉佩伏笔', prompt: 'p', allowedTools: ['read_drafts'],
    status: 'completed', messages: [{ id: 'm1', role: 'user', content: '查玉佩', createdAt: 0 }],
    toolCalls: [], artifacts: [], result: '结论', startedAt: 1, endedAt: 2, ...over,
  })

  it('round-trip 保持 subSessions', () => {
    const conv = { ...baseConv(), subSessions: [sess()] }
    expect(parseArchive(serializeArchive(conv))!.subSessions).toEqual([sess()])
  })

  it('缺字段降级为 []（旧档兼容）', () => {
    const parsed = parseArchive('{"id":"c1","title":"T","createdAt":0,"updatedAt":0,"mode":"quick","modelId":null}')
    expect(parsed!.subSessions).toEqual([])
  })

  it('坏条目过滤：非对象 / 缺 id / messages 非数组（Review Focus 5：一条坏数据不毁整档）', () => {
    const raw = JSON.stringify({
      id: 'c1', title: 'T', createdAt: 0, updatedAt: 0, mode: 'quick', modelId: null,
      subSessions: [sess(), '不是对象', { description: '缺 id' }, { ...sess({ id: 'ok2' }), messages: '不是数组' }],
    })
    const parsed = parseArchive(raw)!
    expect(parsed.subSessions!.map(s => s.id)).toEqual(['abc123'])   // 只留形状完整的
  })

  it('超 MAX_SUB_SESSIONS 裁剪为最新 N 条；单条超 MAX_SUBAGENT_MESSAGES 裁剪消息', () => {
    const many = Array.from({ length: 30 }, (_, i) => sess({ id: `s${i}`, startedAt: i }))
    const parsed = parseArchive(serializeArchive({ ...baseConv(), subSessions: many }))!
    expect(parsed.subSessions!).toHaveLength(MAX_SUB_SESSIONS)
    const long = sess({ messages: Array.from({ length: 100 }, (_, i) => ({ id: `m${i}`, role: 'assistant', content: 'x', createdAt: i })) })
    expect(parseArchive(serializeArchive({ ...baseConv(), subSessions: [long] }))!.subSessions![0].messages).toHaveLength(MAX_SUBAGENT_MESSAGES)
  })

  it('子转录净化：崩溃残片（无配对 tool_call / thinking）与父同口径', () => {
    const dirty = sess({ messages: [
      { id: 'a1', role: 'assistant', content: '<tool_call>{"name":"x","arguments":{}}</tool_call>', createdAt: 0 },
      { id: 'a2', role: 'assistant', content: '正文<think>残片', createdAt: 1 },
    ] })
    const parsed = parseArchive(serializeArchive({ ...baseConv(), subSessions: [dirty] }))!
    expect(parsed.subSessions![0].messages.map(m => m.id)).toEqual(['a2'])
  })
})
```

（`baseConv()` 为该测试文件内既有的会话工厂；无则就地写一个最小会话字面量。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/services/agent/archive-codec.test.ts`
Expected: FAIL —— `subSessions` 未序列化（undefined）

- [ ] **Step 3: 实现**

`agent-store.ts` 的 `AgentConversation` 增：

```ts
  /** C 档第二轮：子 agent 会话（派发转录；随归档落盘，/clear 一并清空） */
  subSessions?: SubAgentSession[]
```

`archive-codec.ts`：`serializeArchive` 已是整体 `JSON.stringify(conv)`（无需改）；`parseArchive` 的返回对象增：

```ts
    const subSessions: SubAgentSession[] = Array.isArray(data.subSessions)
      ? (data.subSessions as unknown as SubAgentSession[])
        .filter(s => Boolean(s) && typeof s === 'object')
        .filter(s => typeof (s as SubAgentSession).id === 'string' && Array.isArray((s as SubAgentSession).messages))
        .map(s => ({
          ...s,
          messages: sanitizeMessageList(s.messages).slice(-MAX_SUBAGENT_MESSAGES),
          toolCalls: Array.isArray(s.toolCalls) ? s.toolCalls : [],
          artifacts: Array.isArray(s.artifacts) ? s.artifacts : [],
          allowedTools: Array.isArray(s.allowedTools) ? s.allowedTools : [],
          result: typeof s.result === 'string' ? s.result : '',
        }))
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, MAX_SUB_SESSIONS)
      : []
```
并在返回对象里加 `subSessions,`（与 `compressed` / `rewound` 并列）。

`agent-store.ts` 的 `/clear` 分支增 `subSessions: undefined`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/services/agent/archive-codec.test.ts src/stores/agent-store.test.ts`
Expected: PASS

- [ ] **Step 5: 全量门禁 + 提交**

```bash
npx tsc --noEmit && npx eslint . --ext ts,tsx --max-warnings 0 && npx vitest run
git add -A && git commit -F /tmp/commit-s4.txt   # feat: 子会话落盘与归档防御式解析（C 档第二轮 T4）
git status --short --untracked-files=all
```

---

### Task 5: `task` 工具 + agent-store 接线（幂等 / 状态 / 流式 / 取消）

**Files:**
- Create: `src/services/agent/tools/task.tool.ts`
- Create: `src/services/agent/tools/task.tool.test.ts`
- Modify: `src/services/agent/tools/index.ts`（注册）
- Modify: `src/stores/agent-store.ts`（`runSubAgentTask` / `cancelSubAgent` / 子会话写入与流式 flush / 取消传播 / `activeSubAgents`）
- Modify: `src/shared/locale-data/tool.ts`（`tool.task*`，三语）

**Interfaces:**
- Consumes: T1-T4 全部
- Produces:
  - 工具 `task({ description, prompt?, tools?, task_id? })`
  - store 动作 `runSubAgentTask(input: { description: string; prompt?: string; tools?: string[]; taskId?: string }): Promise<string>`（返回注入父端的文本）
  - store 动作 `cancelSubAgent(sessionId: string): void`
  - store 动作 `replaySubAgent(sessionId: string): string | null`

- [ ] **Step 1: 写失败测试**（`task.tool.test.ts`）

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { taskTool } from './task.tool'
import { useAgentStore } from '../../../stores/agent-store'

const spied = (impl: (input: never) => Promise<string>) =>
  vi.spyOn(useAgentStore.getState(), 'runSubAgentTask' as never).mockImplementation(impl as never)

beforeEach(() => {
  useAgentStore.setState({ conversations: [], activeConversationId: null } as never)
})

describe('task 工具（模型侧通道）', () => {
  it('只读、免确认（派发本身不打扰用户）', () => {
    expect(taskTool.requiresConfirmation).toBe(false)
    expect(taskTool.isReadOnly).toBe(true)
  })

  it('description 必填：缺省 → 失败并说明', async () => {
    const res = await taskTool.execute({})
    expect(res.success).toBe(false)
    expect(res.error).toContain('description')
  })

  it('给 task_id → 回放（不派发）', async () => {
    useAgentStore.setState({ conversations: [{
      id: 'c1', title: 'T', messages: [], createdAt: 0, updatedAt: 0, mode: 'quick', modelId: null,
      subSessions: [{ id: 'abc123', taskId: 'abc123', description: '查玉佩', prompt: 'p', allowedTools: [], status: 'completed',
        messages: [{ id: 'm1', role: 'assistant', content: '玉佩结论', createdAt: 0 }], toolCalls: [], artifacts: [], result: '玉佩结论', startedAt: 0 }],
    }], activeConversationId: 'c1' } as never)
    const res = await taskTool.execute({ task_id: 'abc123' })
    expect(res.success).toBe(true)
    expect(res.content).toContain('玉佩结论')
    expect(res.content).toContain('untrusted')      // 回放同样标注不可信
  })

  it('未知 task_id → 失败 + 可用子会话清单', async () => {
    useAgentStore.setState({ conversations: [{ id: 'c1', title: 'T', messages: [], createdAt: 0, updatedAt: 0, mode: 'quick', modelId: null, subSessions: [] }], activeConversationId: 'c1' } as never)
    const res = await taskTool.execute({ task_id: 'nope' })
    expect(res.success).toBe(false)
    expect(res.error).toContain('nope')
  })

  it('正常派发：tools 是**逗号分隔字符串**（ToolInputSchema 不支持数组）→ 拆成数组交给 store', async () => {
    const spy = spied(async () => 'RESULT_TEXT')
    useAgentStore.setState({ conversations: [{ id: 'c1', title: 'T', messages: [], createdAt: 0, updatedAt: 0, mode: 'quick', modelId: null }], activeConversationId: 'c1' } as never)
    const res = await taskTool.execute({ description: '查玉佩', prompt: '细节', tools: 'read_drafts, read_memory' })
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ description: '查玉佩', prompt: '细节', tools: ['read_drafts', 'read_memory'] }))
    expect(res.content).toBe('RESULT_TEXT')
    spy.mockRestore()
  })

  it('tools 缺省 / 空串 → undefined（交给 store 用默认白名单）', async () => {
    const spy = spied(async () => 'R')
    useAgentStore.setState({ conversations: [{ id: 'c1', title: 'T', messages: [], createdAt: 0, updatedAt: 0, mode: 'quick', modelId: null }], activeConversationId: 'c1' } as never)
    await taskTool.execute({ description: 'x', tools: '  ' })
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ tools: undefined }))
    spy.mockRestore()
  })

  it('无活跃会话 → 失败（不静默）', async () => {
    const res = await taskTool.execute({ description: 'x' })
    expect(res.success).toBe(false)
  })
})
```

`agent-store.test.ts` 追加（用模块 mock 把 runner 换成假实现，只测 store 的编排）：

```ts
// 顶部（与其他 mock 并列）——只替换 runSubAgent，其余真实导出保留
vi.mock('../services/agent/subagent/runner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/agent/subagent/runner')>()
  return { ...actual, runSubAgent: vi.fn() }
})
import { runSubAgent } from '../services/agent/subagent/runner'
const runMock = vi.mocked(runSubAgent)

const fakeSession = (over: Partial<SubAgentSession> = {}): SubAgentSession => ({
  id: 't1', taskId: 't1', description: '查玉佩', prompt: '查玉佩', allowedTools: [],
  status: 'completed', messages: [], toolCalls: [], artifacts: [], result: '结论', startedAt: 0, endedAt: 1, ...over,
})

describe('runSubAgentTask（C 档第二轮 T5）', () => {
  beforeEach(() => {
    runMock.mockReset()
    runMock.mockResolvedValue(fakeSession())
    useAgentStore.setState({
      conversations: [{ id: 'c1', title: 'T', messages: [], createdAt: 0, updatedAt: 0, mode: 'quick', modelId: 'm' }],
      activeConversationId: 'c1',
    } as never)
  })

  it('幂等：同 description 第二次不重复派发，复用既有结果并附 task_id（Review Focus 6）', async () => {
    const first = await useAgentStore.getState().runSubAgentTask({ description: '查玉佩' })
    const second = await useAgentStore.getState().runSubAgentTask({ description: '查玉佩' })
    expect(runMock).toHaveBeenCalledTimes(1)
    expect(first).toContain('t1')
    expect(second).toContain('t1')
  })

  it('running 中重复派发 → 返回「正在执行」提示，不新建', async () => {
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => ({ ...c, subSessions: [fakeSession({ status: 'running', endedAt: undefined })] })),
    }))
    const text = await useAgentStore.getState().runSubAgentTask({ description: '查玉佩' })
    expect(text).toContain('t1')
    expect(runMock).not.toHaveBeenCalled()
  })

  it('工具集归一后指纹稳定：tools 顺序不同 = 同一子会话（不重复派发）', async () => {
    await useAgentStore.getState().runSubAgentTask({ description: 'x', tools: ['read_drafts', 'read_memory'] })
    await useAgentStore.getState().runSubAgentTask({ description: 'x', tools: ['read_memory', 'read_drafts'] })
    expect(runMock).toHaveBeenCalledTimes(1)
  })

  it('取消传播：cancelSubAgent 中止该子 agent 的 signal（父保持生成）', async () => {
    const signals: AbortSignal[] = []
    runMock.mockImplementation(async (_t, deps) => {
      signals.push(deps.signal!)
      return new Promise<SubAgentSession>(resolve => { setTimeout(() => resolve(fakeSession()), 30) })
    })
    const p = useAgentStore.getState().runSubAgentTask({ description: 'x' })
    await new Promise(r => setTimeout(r, 5))
    const sessionId = useAgentStore.getState().getActiveConversation()!.subSessions![0].id
    useAgentStore.getState().cancelSubAgent(sessionId)
    expect(signals[0].aborted).toBe(true)
    await p
  })

  it('子会话写进 conversation.subSessions（流式 onUpdate 也被消费）', async () => {
    runMock.mockImplementation(async (_t, deps) => {
      deps.onUpdate?.(fakeSession())
      return fakeSession()
    })
    await useAgentStore.getState().runSubAgentTask({ description: 'x' })
    await new Promise(r => setTimeout(r, 80))   // 等 50ms 缓冲 flush
    expect(useAgentStore.getState().getActiveConversation()!.subSessions).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/services/agent/tools/task.tool.test.ts src/stores/agent-store.test.ts`
Expected: FAIL —— 模块/动作不存在

- [ ] **Step 3: 实现**

`task.tool.ts`（薄壳，逻辑全在 store，与 `read_project_state` 等既有工具同构）：

```ts
/**
 * task — 派发子 agent（C 档第二轮）。
 * 薄壳：参数归一化 + 校验，实际编排在 agent-store.runSubAgentTask（store 才能接触会话/取消/审批）。
 */
import { t } from '../../../shared/locale'
import { buildAgentTool } from '../tool-registry'
import { useAgentStore } from '../../../stores/agent-store'

export const taskTool = buildAgentTool({
  name: 'task',
  description: t('tool.taskDesc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      description: { type: 'string', description: t('tool.taskDescription') },
      prompt: { type: 'string', description: t('tool.taskPrompt') },
      tools: { type: 'string', description: t('tool.taskTools') },   // 逗号分隔（ToolInputSchema 不支持数组）
      task_id: { type: 'string', description: t('tool.taskId') },
    },
    required: ['description'],
  },
  requiresConfirmation: false,
  execute: async (args) => {
    const store = useAgentStore.getState()
    const taskId = (args.task_id as string | undefined)?.trim()
    if (taskId) {
      const replay = store.replaySubAgent(taskId)
      return replay === null
        ? { success: false, content: '', error: t('tool.taskUnknownId').replace('{id}', taskId).replace('{list}', store.listSubAgents()) }
        : { success: true, content: replay }
    }
    const description = (args.description as string | undefined)?.trim()
    if (!description) return { success: false, content: '', error: t('tool.taskNeedDescription') }
    if (!store.getActiveConversation()) return { success: false, content: '', error: t('error.noProject') }
    // ToolInputSchema 不支持数组 → 线上格式是逗号分隔字符串；空/全空白视为「未指定」（用默认白名单）
    const tools = ((args.tools as string | undefined) ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const text = await store.runSubAgentTask({
      description,
      prompt: (args.prompt as string | undefined)?.trim(),
      tools: tools.length > 0 ? tools : undefined,
    })
    return { success: true, content: text }
  },
})
```

`agent-store.ts` 关键实现（新增模块级状态 + 三个动作）：

```ts
/** 运行中的子 agent（sessionId → controller）：取消与父取消传播用 */
const activeSubAgents = new Map<string, AbortController>()

// —— AgentState 接口新增 ——
  /** 子 agent 派发（task 工具入口） */
  runSubAgentTask: (input: { description: string; prompt?: string; tools?: string[] }) => Promise<string>
  /** 取消某个子 agent（只中止它，不取消父） */
  cancelSubAgent: (sessionId: string) => void
  /** 回放子会话转录（null = 未找到） */
  replaySubAgent: (sessionId: string) => string | null
  /** 可用子会话清单（错误文案里给出） */
  listSubAgents: () => string
```

```ts
  runSubAgentTask: async ({ description, prompt, tools }) => {
    const conv = get().getActiveConversation()
    if (!conv) return t('error.noProject')
    const allowed = resolveSubAgentTools(tools)
    const taskId = computeSubAgentTaskRef(conv.id, description, allowed)
    const existing = (conv.subSessions ?? []).find(s => s.taskId === taskId)
    if (existing) {
      // 幂等（Review Focus 6）：running → 不重复派发；终态 → 复用结果并附带 task_id
      return existing.status === 'running'
        ? t('subagent.duplicateRunning').replace('{id}', existing.id)
        : formatSubAgentResult(existing) + `\n\n${t('subagent.idempotentHint').replace('{id}', existing.id)}`
    }
    const modelId = conv.modelId ?? useLLMStore.getState().defaultModelId ?? undefined
    if (!modelId) return t('subagent.noModel')
    const task: SubAgentTask = { taskId, description, prompt: prompt || description, allowedTools: allowed, modelId }
    const controller = new AbortController()
    activeSubAgents.set(taskId, controller)
    // 父取消 → 子取消（父的 controller 在 sendMessage 里创建；此处取模块级 activeAbortController）
    const unlink = linkParentAbort(controller)
    const upsert = (s: SubAgentSession) => set(state => ({ conversations: state.conversations.map(c => c.id === conv.id
      ? { ...c, subSessions: [s, ...(c.subSessions ?? []).filter(x => x.id !== s.id)].slice(0, MAX_SUB_SESSIONS) } : c) }))
    // 50ms 缓冲（与父 chunkBuffer 同口径，避免每 chunk 一次 setState）
    let pending: SubAgentSession | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const flush = () => { if (pending) { upsert(pending); pending = null } timer = null }
    try {
      const session = await runSubAgent(task, {
        generate: (messages, mid, onChunk) => generateForSubAgent(messages, mid, onChunk),
        buildPrompt: buildSubAgentPrompt,
        confirm: (tc) => get().requestSubAgentConfirmation(taskId, description, tc),   // T6
        signal: controller.signal,
        onUpdate: (s) => { pending = s; if (!timer) timer = setTimeout(flush, 50) },
      })
      flush()
      return formatSubAgentResult(session)
    } finally {
      if (timer) clearTimeout(timer)
      activeSubAgents.delete(taskId)
      unlink()
    }
  },
  cancelSubAgent: (sessionId) => { activeSubAgents.get(sessionId)?.abort() },
  replaySubAgent: (sessionId) => {
    const conv = get().getActiveConversation()
    const s = (conv?.subSessions ?? []).find(x => x.id === sessionId)
    return s ? formatSubAgentTranscript(s) : null
  },
  listSubAgents: () => (get().getActiveConversation()?.subSessions ?? []).map(s => `${s.id}（${s.description}）`).join('、'),
```

其它接线：
- `generateForSubAgent`：与父同路径但**不写前缀记账**、`db:log-llm-call` 用 `purpose: 'subagent'` 且不带 prefix 字段（子 agent 的首轮前缀与父无关，混进去会污染父的缓存命中读数）。
- `linkParentAbort(controller)`：若模块级 `activeAbortController` 存在则 `addEventListener('abort', () => controller.abort())`，返回解绑函数。
- `cancelGeneration`（父取消）末尾遍历 `activeSubAgents` 全部 abort（spec §3.9）。
- `/clear`：`subSessions: undefined` + `activeSubAgents.forEach(c => c.abort())`。
- 工具注册：`tools/index.ts` 在 `skillTool` 之后、`readFileTool` 之前插入 `taskTool`（派发是高频入口，契约须在提示词截断线内；截断通知已带签名，位置只影响 prose 可见性）。

`src/shared/locale-data/tool.ts` 追加 `tool.taskDesc` / `taskDescription` / `taskPrompt` / `taskTools` / `taskId` / `taskNeedDescription` / `taskUnknownId`（三语）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/services/agent/tools/task.tool.test.ts src/stores/agent-store.test.ts`
Expected: PASS

- [ ] **Step 5: 全量门禁 + 提交**

```bash
npx tsc --noEmit && npx eslint . --ext ts,tsx --max-warnings 0 && npx vitest run
git add -A && git commit -F /tmp/commit-s5.txt   # feat: task 工具与子 agent 派发接线（幂等/取消/流式）（C 档第二轮 T5）
git status --short --untracked-files=all
```

---

### Task 6: 子 agent 写操作 → 父方审批

**Files:**
- Modify: `src/stores/agent-store.ts`（`pendingSubAgentConfirmation` 状态 + `requestSubAgentConfirmation` + `resolveSubAgentConfirmation` + 超时）
- Modify: `src/services/agent/approval/policy.ts`（仅在需要时补一条「子 agent 写工具」判定入口——复用 `evaluateApproval`）
- Modify: `src/stores/agent-store.test.ts`

**Interfaces:**
- Consumes: T5 的 `runSubAgentTask`（confirm 注入点）、A 档 `evaluateApproval` / `loadApprovalRules`
- Produces:
  - store 状态 `pendingSubAgentConfirmation: { sessionId: string; description: string; toolCall: ToolCallInfo } | null`
  - store 动作 `resolveSubAgentConfirmation(allow: boolean): void`
  - store 动作 `requestSubAgentConfirmation(sessionId: string, description: string, toolCall: ToolCallInfo, signal?: AbortSignal): Promise<boolean>`
    - ⚠️ `signal` 显式入参（不读模块级 `activeAbortController`）：T5 传**子 agent 自己的** controller.signal，而该 signal 已由 `linkParentAbort` 与父的取消绑定——一层显式中转，换来可测性（父取消 → 子 signal abort → 卡消失，三跳都可见）

- [ ] **Step 1: 写失败测试**（`agent-store.test.ts` 追加；`approval` 层用模块 mock 注入规则，避免真实读盘）

```ts
vi.mock('../services/agent/approval', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/agent/approval')>()
  return { ...actual, loadApprovalRules: vi.fn(async () => []) }
})
import { loadApprovalRules } from '../services/agent/approval'
import { SUBAGENT_CONFIRM_TIMEOUT_MS } from '../services/agent/subagent/types'
import type { ToolCallInfo } from '../services/agent/tool-registry'

describe('子 agent 写操作审批（C 档第二轮 T6）', () => {
  const call = (name: string, args: Record<string, unknown> = {}, id = 'tc1'): ToolCallInfo =>
    ({ id, toolName: name, arguments: args, status: 'pending' })
  const ask = (tc: ToolCallInfo, signal?: AbortSignal) =>
    useAgentStore.getState().requestSubAgentConfirmation('s1', '查玉佩伏笔', tc, signal)

  beforeEach(() => {
    vi.mocked(loadApprovalRules).mockResolvedValue([])
    useAgentStore.setState({ pendingSubAgentConfirmation: null } as never)
  })

  it('只读工具 → 直接放行，不出卡', async () => {
    await expect(ask(call('read_drafts'))).resolves.toBe(true)
    expect(useAgentStore.getState().pendingSubAgentConfirmation).toBeNull()
  })

  it('critical 命中（危险路径）→ 硬拒绝且不出卡（沿用 A 档 fail-closed）', async () => {
    await expect(ask(call('write_file', { file_path: 'C:/Windows/System32/x.md' }))).resolves.toBe(false)
    expect(useAgentStore.getState().pendingSubAgentConfirmation).toBeNull()
  })

  it('workspace 规则命中 → 放行且不出卡（沿用用户自己的常驻批准）', async () => {
    vi.mocked(loadApprovalRules).mockResolvedValue([{
      id: 'r1', toolName: 'write_file', projectPath: '/mock/proj', approvedArgsHash: '', risk: 'write', createdAt: 0,
      // 形状以 approval/types.ts 的 ApprovalRule 为准（按实际字段补全）
    } as never])
    useProjectStore.setState({ currentProject: { path: '/mock/proj' } as never })
    await expect(ask(call('write_file', { file_path: 'drafts/c30.md' }))).resolves.toBe(true)
    expect(useAgentStore.getState().pendingSubAgentConfirmation).toBeNull()
  })

  it('未覆盖的写操作 → 出卡；允许/拒绝两态；**不写** workspace 规则', async () => {
    const allow = ask(call('write_file', { file_path: 'drafts/c30.md' }))
    const card = useAgentStore.getState().pendingSubAgentConfirmation
    expect(card?.toolCall.toolName).toBe('write_file')
    expect(card?.description).toBe('查玉佩伏笔')
    useAgentStore.getState().resolveSubAgentConfirmation(true)
    await expect(allow).resolves.toBe(true)
    expect(useAgentStore.getState().pendingSubAgentConfirmation).toBeNull()

    const deny = ask(call('edit_file', { file_path: 'drafts/c30.md' }, 'tc2'))
    useAgentStore.getState().resolveSubAgentConfirmation(false)
    await expect(deny).resolves.toBe(false)
  })

  it('超时 → 自动拒绝且卡消失（Review Focus 4：无人场不悬挂）', async () => {
    vi.useFakeTimers()
    const p = ask(call('write_file', { file_path: 'drafts/c30.md' }))
    vi.advanceTimersByTime(SUBAGENT_CONFIRM_TIMEOUT_MS + 1)
    await expect(p).resolves.toBe(false)
    expect(useAgentStore.getState().pendingSubAgentConfirmation).toBeNull()
    vi.useRealTimers()
  })

  it('父取消（signal abort）→ 卡消失且 promise 以拒绝收尾（Review Focus 3）', async () => {
    const ac = new AbortController()
    const p = ask(call('write_file', { file_path: 'drafts/c30.md' }), ac.signal)
    expect(useAgentStore.getState().pendingSubAgentConfirmation).not.toBeNull()
    ac.abort()
    await expect(p).resolves.toBe(false)
    expect(useAgentStore.getState().pendingSubAgentConfirmation).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/stores/agent-store.test.ts`
Expected: FAIL —— 动作/状态不存在

- [ ] **Step 3: 实现**

```ts
// —— 模块级（与 activeSubAgents 并列）——
/** 待审批卡当前挂起的 resolve（同一时刻至多一张卡：顺序执行 ⇒ 至多一个子 agent 在问） */
let pendingSubAgentResolve: ((allow: boolean) => void) | null = null

// —— AgentState 新增 ——
  /** 子 agent 的待审批请求（T6）：非 null 时输入框上方渲染确认卡 */
  pendingSubAgentConfirmation: { sessionId: string; description: string; toolCall: ToolCallInfo } | null
  requestSubAgentConfirmation: (sessionId: string, description: string, toolCall: ToolCallInfo, signal?: AbortSignal) => Promise<boolean>
  resolveSubAgentConfirmation: (allow: boolean) => void
```

```ts
  requestSubAgentConfirmation: async (sessionId, description, toolCall, signal) => {
    const projectPath = useProjectStore.getState().currentProject?.path ?? null
    const tool = toolRegistry.get(toolCall.toolName)
    const args = (toolCall.arguments ?? {}) as Record<string, unknown>
    const rules = projectPath ? await loadApprovalRules(projectPath) : []
    const decision = evaluateApproval({
      projectPath, toolName: toolCall.toolName, args,
      descriptor: { requiresConfirmation: tool?.requiresConfirmation ?? true, isReadOnly: tool?.isReadOnly ?? false },
      rules,
    })
    // critical → 硬拒绝；只读 → 直跑；规则命中 → 沿用用户的常驻批准；其余 → 转父方审批卡
    if (decision.action === 'deny') return false
    if (decision.action === 'allow') return true
    return new Promise<boolean>((resolve) => {
      let settled = false
      const timer = setTimeout(() => finish(false), SUBAGENT_CONFIRM_TIMEOUT_MS)   // 无人场不悬挂
      const onAbort = (): void => finish(false)                                     // 父取消 → 卡消失 + 拒绝
      function finish(allow: boolean): void {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        pendingSubAgentResolve = null
        set({ pendingSubAgentConfirmation: null })
        resolve(allow)
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      pendingSubAgentResolve = finish
      set({ pendingSubAgentConfirmation: { sessionId, description, toolCall } })
    })
  },
  resolveSubAgentConfirmation: (allow) => { pendingSubAgentResolve?.(allow) },
```

T5 的注入点相应改为 `confirm: (tc) => get().requestSubAgentConfirmation(taskId, description, tc, controller.signal)`。

- **卡不提供「始终允许」**（spec §3.5）：`SubAgentConfirmCard` 只有允许/拒绝两个动作，`appendApprovalRule` 不被调用（T7 的 UI 与之对应；本任务用测试钉住「resolve(true) 后未写规则」）。
- 与父确认卡并存：父卡走消息内渲染、子卡走输入框上方（两个渲染面，互不遮挡）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/stores/agent-store.test.ts`
Expected: PASS

- [ ] **Step 5: 全量门禁 + 提交**

```bash
npx tsc --noEmit && npx eslint . --ext ts,tsx --max-warnings 0 && npx vitest run
git add -A && git commit -F /tmp/commit-s6.txt   # feat: 子 agent 写操作转父方审批（含超时拒绝）（C 档第二轮 T6）
git status --short --untracked-files=all
```

---

### Task 7: UI（子会话卡 + 来源标签确认卡）

**Files:**
- Create: `src/components/panels/agent/SubAgentSessionCard.tsx`
- Create: `src/components/panels/agent/SubAgentConfirmCard.tsx`
- Modify: `src/components/panels/agent/AgentConversation.tsx`（父时间线内渲染子会话卡；输入框上方渲染子确认卡）
- Modify: `src/components/panels/agent/AgentConversation.test.tsx`
- Modify: `src/shared/locale-data/agent.ts`（卡片文案，三语）

**Interfaces:**
- Consumes: T4-T6 的 `subSessions` / `pendingSubAgentConfirmation` / `cancelSubAgent` / `resolveSubAgentConfirmation`

- [ ] **Step 1: 写失败测试**（`AgentConversation.test.tsx` 追加，沿用该文件既有的 `render` 助手与模型/velaAPI mock）

```tsx
describe('SubAgentSessionCard（C 档第二轮 T7）', () => {
  const session = (over: Partial<SubAgentSession> = {}): SubAgentSession => ({
    id: 's1', taskId: 's1', description: '查玉佩伏笔', prompt: 'p', allowedTools: ['read_drafts'],
    status: 'completed',
    messages: [
      { id: 'm1', role: 'user', content: '查玉佩伏笔', createdAt: 0 },
      { id: 'm2', role: 'assistant', content: '玉佩在第 3 章首次出现。', createdAt: 1 },
    ],
    toolCalls: [{ id: 'tc1', toolName: 'read_drafts', arguments: {}, status: 'completed' }],
    artifacts: [], result: '玉佩在第 3 章首次出现。', startedAt: 0, endedAt: 1000, ...over,
  })

  const withSession = (s: SubAgentSession) => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? {
        ...c, messages: [{ id: 'm1', role: 'user', content: '你好', createdAt: Date.now() }], subSessions: [s],
      } : c),
    }))
  }

  it('父时间线内渲染卡片：描述 + 状态 + 工具数；展开显示子转录（默认收起）', async () => {
    withSession(session())
    const { container, root } = render(<AgentConversation />)
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(container.textContent).toContain('查玉佩伏笔')
    expect(container.textContent).not.toContain('玉佩在第 3 章首次出现。')    // 收起态不渲染转录
    const show = [...container.querySelectorAll('button')].find(b => b.title === t('subagent.cardShow'))!
    act(() => { show.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(container.textContent).toContain('玉佩在第 3 章首次出现。')
    act(() => { root.unmount() })
  })

  it('运行中卡片有取消入口，点击调 cancelSubAgent（只中止该子 agent）', async () => {
    withSession(session({ status: 'running', endedAt: undefined }))
    const spy = vi.spyOn(useAgentStore.getState(), 'cancelSubAgent').mockImplementation(() => {})
    const { container, root } = render(<AgentConversation />)
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    const cancel = [...container.querySelectorAll('button')].find(b => b.title === t('subagent.cardCancel'))!
    act(() => { cancel.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(spy).toHaveBeenCalledWith('s1')
    spy.mockRestore()
    act(() => { root.unmount() })
  })

  it('失败卡片显示原因（不静默）', async () => {
    withSession(session({ status: 'failed', error: 'model down' }))
    const { container, root } = render(<AgentConversation />)
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(container.textContent).toContain('model down')
    act(() => { root.unmount() })
  })
})

describe('SubAgentConfirmCard（C 档第二轮 T7）', () => {
  beforeEach(() => {
    useAgentStore.setState({
      pendingSubAgentConfirmation: {
        sessionId: 's1', description: '查玉佩伏笔',
        toolCall: { id: 'tc1', toolName: 'write_file', arguments: { file_path: 'drafts/c30.md' }, status: 'waiting_confirm' },
      },
    } as never)
  })

  it('出卡显示来源标签（子 agent 描述 + 工具名 + 目标），按钮恰为 允许/拒绝（**无**「始终允许」）', async () => {
    const { container, root } = render(<AgentConversation />)
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(container.textContent).toContain('查玉佩伏笔')
    expect(container.textContent).toContain('write_file')
    expect(container.textContent).toContain('drafts/c30.md')
    expect(container.textContent).not.toContain(t('confirmCard.always'))
    const labels = [...container.querySelectorAll('button')].map(b => b.textContent?.trim())
    expect(labels).toContain(t('subagent.confirmAllow'))
    expect(labels).toContain(t('subagent.confirmDeny'))
    act(() => { root.unmount() })
  })

  it('点允许 → resolveSubAgentConfirmation(true)', async () => {
    const spy = vi.spyOn(useAgentStore.getState(), 'resolveSubAgentConfirmation').mockImplementation(() => {})
    const { container, root } = render(<AgentConversation />)
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    const allow = [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === t('subagent.confirmAllow'))!
    act(() => { allow.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(spy).toHaveBeenCalledWith(true)
    spy.mockRestore()
    act(() => { root.unmount() })
  })
})
```

> `t('confirmCard.always')` 的键名以 `ConfirmCard.tsx` 现用文案为准（实现时按实际 key 写；断言的是「这张卡**没有**那一档」）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/components/panels/agent/AgentConversation.test.tsx`
Expected: FAIL —— 卡片不存在

- [ ] **Step 3: 实现**

`SubAgentSessionCard.tsx`（形态参照既有 `CompressedBatchCard`）：

```tsx
/**
 * 子会话卡（C 档第二轮）——父时间线内展示派发结果。
 * 状态图标 + 描述 + 步数/工具数 + 可展开转录（复用 AgentMessage 渲染）+ 运行中可取消。
 */
export default function SubAgentSessionCard({ session }: { session: SubAgentSession }) {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation()
  const cancelSubAgent = useAgentStore(s => s.cancelSubAgent)
  // 头部：Bot 图标 + description + status 徽标 + 计数 + 展开/收起 + （running 时）取消
  // 展开体：session.messages.map(m => <AgentMessage key={m.id} message={m} />)
  // 失败：显示 session.error（--color-warning）
}
```

`SubAgentConfirmCard.tsx`：

```tsx
/** 子 agent 的写操作审批卡：来源标签 + 允许/拒绝（刻意**无**「始终允许」——委派路径不写 workspace 规则） */
export default function SubAgentConfirmCard() {
  const pending = useAgentStore(s => s.pendingSubAgentConfirmation)
  const resolve = useAgentStore(s => s.resolveSubAgentConfirmation)
  if (!pending) return null
  // 文案：subagent.confirmTitle.replace('{agent}', pending.description) + 工具名 + 目标路径（args.file_path ?? ''）
  // 两按钮：允许 → resolve(true)；拒绝 → resolve(false)
}
```

`AgentConversation.tsx`：
- 消息列表内，在触发了 `task` 工具调用的助手消息**之后**渲染其子会话卡：`(activeConv.subSessions ?? []).filter(s => msg.toolCalls?.some(tc => tc.toolName === 'task' && ...))` —— 关联方式：`SubAgentSession.taskId` 与工具调用的 `description` 指纹一致；实现上直接**按时间序**渲染（子会话在助手消息之后开始，`startedAt` 单调）即可，避免指纹反查的脆弱耦合。
- 输入框上方（既有确认卡区域）渲染 `<SubAgentConfirmCard />`。

`src/shared/locale-data/agent.ts` 追加 `subagent.cardStatusRunning` / `completed` / `failed` / `cancelled`、`subagent.cardSteps`、`subagent.cardTools`、`subagent.cardCancel`、`subagent.cardShow` / `cardHide`、`subagent.confirmTitle` / `confirmAllow` / `confirmDeny` / `confirmTarget`（三语）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/components/panels/agent/AgentConversation.test.tsx`
Expected: PASS

- [ ] **Step 5: 全量门禁**

Run: `npx tsc --noEmit && npx eslint . --ext ts,tsx --max-warnings 0 && npx vitest run`
Expected: 三条全绿

- [ ] **Step 6: 手动冒烟（推荐）**

`pnpm run dev` → 打开项目 → 在对话框输入「派一个子 agent 去查前 3 章的伏笔，然后总结」→ 观察：子会话卡出现（running → completed）、展开可见子转录、父回复引用子结论且带 untrusted 标注；再让子 agent 写一个文件 → 输入框上方出现带来源标签的确认卡（**无**「始终允许」）→ 拒绝后子 agent 收到拒绝并改道。

- [ ] **Step 7: 提交**

```bash
git add -A && git commit -F /tmp/commit-s7.txt   # feat: 子会话卡与来源标签确认卡（C 档第二轮 T7）
git status --short --untracked-files=all
```

---

## 收尾（不在任务内，由执行流程负责）

1. 全量门禁最后一次：`npx tsc --noEmit && npx eslint . --ext ts,tsx --max-warnings 0 && npx vitest run`
2. 独立评审（opus + 新上下文）覆盖 7 笔提交的整段 diff，带本计划的 **Review Focus** 与 ledger 的 `Ruling:` 行
3. 评审的 Critical/Important 走**一次**修复轮（每项先 RED 后 GREEN），Minor 记 ledger 并汇报
4. 修复轮绿后推送并核对三平台 CI：

```powershell
$tok = gh auth token
$env:GIT_TERMINAL_PROMPT='0'; $env:GIT_ASKPASS=''
git -c http.sslBackend=openssl push "https://x-access-token:$tok@github.com/LunaRime/novelforge.git" master:master
```
```bash
gh run list --repo LunaRime/novelforge --limit 2 && gh run view <id> --json status,conclusion,jobs
```

> ⚠️ **推送前自查**（C 档第一轮教训）：`git status --short --untracked-files=all` 必须为空；本次改动跨 `src/`（为主）与 `electron/`（`memory-codec` 若被 T2 的 `collectMemoryLayers` 抽取波及）——**用 `git add -A`（仓库根）**。
