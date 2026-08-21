# CCR 上下文压缩 P0 实施计划（对话持久化 + 滚动摘要 + 压缩卡片 + 预算条）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Agent 对话的丢弃式硬截断升级为 CCR 滚动摘要，会话持久化到 `~/.vela/agent-archive/`，对话面板展示压缩卡片与上下文预算条。

**Architecture:** 会话层：`AgentConversation` 增加 `compressed`/`rollingSummary`/项目快照字段，通过主进程专用通道持久化到 `~/.vela/agent-archive/<id>.json`（唯一持久化层）。压缩层：`sendMessage` 历史窗口超 `HISTORY_MAX_TOKENS`(4000) 时，用 LLM（budget 路由 `getModelForPurpose('summarize')`，purpose 落库 `ccr_summary`）将最旧消息批迭代压缩进 `rollingSummary`（输入 = 旧摘要 + 新批，输出覆盖），原文保留 2-3 代于 `compressed` 供展开恢复；失败降级回硬截断。注入层：`context-builder` 拆分 `buildAgentSystemSegments`，M1 会话摘要节注入 system 尾部（预算 300 tokens，语言指令保持最末尾）。展示层：消息流插压缩卡片 + 底部预算条（基础段/记忆段/历史/当前 vs 当前模型 maxTokens，无双计）。

**Tech Stack:** Electron 41 + React 19 + TypeScript 6 + Zustand + Vitest（jsdom）。复用现有 `estimateTokens`（token-budget.ts）、`fs:` 前缀 IPC、`db:log-llm-call`。

**Spec:** [docs/2026-08-21-ccr-memory-design.md](2026-08-21-ccr-memory-design.md)（P0 章节 + §3 注入顺序 + §8 风险表）

## Global Constraints

- Token 口径全链路 `estimateTokens`（token-budget.ts），不另起估算
- 压缩调用：`getModelForPurpose('summarize')` 路由（budget 档）+ `temperature: 0.2` + 落库 `purpose: 'ccr_summary'`（区别于 'agent'）
- 压缩失败 → 降级硬截断，绝不阻断对话主流程
- `rollingSummary` 迭代：输入 = 旧摘要 + 新压缩批原文，输出覆盖；`compressed[].summary` 独立存卡片展示，与 rollingSummary 解耦
- tool observation 不进入 store 消息（store 层天然只有 user/assistant/system，无需额外过滤；压缩批次跳过 system）
- `projectPath`/`projectName` 快照仅用于展示与恢复提示（P0 不做按快照项目注入 L0）
- archive 写盘 UTF-8；`deleteConversation`/`clearAll` 必须同步删 archive 文件；恢复走 loadSeq 防竞态
- 预算条分段：基础段（身份+L0+L1+Tool）+ 记忆段（M1）+ 历史 + 当前，**记忆段独立、不得双计**
- 质量门禁：`pnpm run typecheck` 零错误 / `pnpm run lint` 零警告 / `pnpm run test` 全过；每任务独立 commit

---

### Task 1: archive 编解码 + 压缩批次选择纯函数

**Files:**
- Create: `src/services/agent/archive-codec.ts`
- Test: `src/services/agent/archive-codec.test.ts`

**Interfaces:**
- Produces（后续任务依赖）:
  - `export interface CompressedBatch { batch: number; original: AgentMessage[]; summary: string; compressedAt: number; originalTokens: number }`
  - `export function selectCompressionBatch(messages: AgentMessage[], budgetTokens: number): { batch: AgentMessage[]; rest: AgentMessage[] }`
  - `export function serializeArchive(conv: AgentConversation): string`
  - `export function parseArchive(raw: string): AgentConversation | null`

- [ ] **Step 1: 写失败测试**

```ts
// src/services/agent/archive-codec.test.ts
import { describe, it, expect } from 'vitest'
import { selectCompressionBatch, serializeArchive, parseArchive } from './archive-codec'
import type { AgentMessage, AgentConversation } from '../../stores/agent-store'

const makeMsg = (id: string, role: 'user' | 'assistant' | 'system', content: string): AgentMessage => ({
  id, role, content, createdAt: 0,
})

const msgs = (n: number): AgentMessage[] =>
  Array.from({ length: n }, (_, i) => makeMsg(`m${i}`, i % 2 === 0 ? 'user' : 'assistant', `第${i}条消息内容`.repeat(20)))

describe('selectCompressionBatch', () => {
  it('总 token 在预算内时 batch 为空', () => {
    const { batch, rest } = selectCompressionBatch(msgs(2), 100_000)
    expect(batch).toHaveLength(0)
    expect(rest).toHaveLength(2)
  })

  it('超预算时最旧消息进入 batch，rest 保留最新消息', () => {
    const { batch, rest } = selectCompressionBatch(msgs(10), 800)
    expect(batch.length).toBeGreaterThan(0)
    expect(rest.length).toBeGreaterThan(0)
    // 顺序保持：batch 在前、rest 在后，拼接回原序
    expect([...batch, ...rest].map(m => m.id)).toEqual(msgs(10).map(m => m.id))
  })

  it('rest 至少保留 1 条最新消息', () => {
    const { rest } = selectCompressionBatch(msgs(10), 1)
    expect(rest.length).toBeGreaterThanOrEqual(1)
  })

  it('跳过 system 消息（不压缩 system，始终留在 rest 尾部）', () => {
    const withSys = [makeMsg('s1', 'system', '系统指令'), ...msgs(10)]
    const { batch } = selectCompressionBatch(withSys, 800)
    expect(batch.some(m => m.role === 'system')).toBe(false)
  })
})

describe('archive 序列化', () => {
  it('round-trip 保持会话完整（含 compressed/rollingSummary）', () => {
    const conv: AgentConversation = {
      id: 'c1', title: '测试会话', messages: msgs(3),
      createdAt: 0, updatedAt: 1, mode: 'balanced', modelId: 'm',
      projectPath: 'E:/p', projectName: 'P',
      compressed: [{ batch: 1, original: [msgs(3)[0]], summary: '摘要', compressedAt: 1, originalTokens: 100 }],
      rollingSummary: '滚动摘要',
    }
    const parsed = parseArchive(serializeArchive(conv))
    expect(parsed).toEqual(conv)
  })

  it('损坏 JSON 返回 null（不抛错）', () => {
    expect(parseArchive('{bad json')).toBeNull()
  })

  it('缺字段降级：messages/compressed/rollingSummary 缺省', () => {
    const parsed = parseArchive('{"id":"c1","title":"T","createdAt":0,"updatedAt":0,"mode":"balanced","modelId":null}')
    expect(parsed).not.toBeNull()
    expect(parsed!.messages).toEqual([])
    expect(parsed!.compressed).toEqual([])
    expect(parsed!.rollingSummary).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/agent/archive-codec.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// src/services/agent/archive-codec.ts
import type { AgentMessage, AgentConversation } from '../../stores/agent-store'
import { estimateTokens } from './token-budget'

export interface CompressedBatch {
  batch: number
  original: AgentMessage[]
  summary: string
  compressedAt: number
  originalTokens: number
}

/**
 * CCR 压缩批次选择：从最旧消息累积进 batch，rest 保留最新消息直到预算。
 * 保证：顺序不变（batch 在前 rest 在后拼接 = 原序）；rest 至少 1 条；
 * system 消息永不进入 batch。
 */
export function selectCompressionBatch(
  messages: AgentMessage[],
  budgetTokens: number,
): { batch: AgentMessage[]; rest: AgentMessage[] } {
  const rest: AgentMessage[] = []
  let used = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'system') {
      rest.unshift(m)
      continue
    }
    const t = estimateTokens(m.content)
    if (rest.length > 0 && used + t > budgetTokens) break
    rest.unshift(m)
    used += t
  }
  const batch = messages.slice(0, messages.length - rest.length)
  return { batch, rest }
}

/** 序列化为 JSON 字符串（UTF-8 写盘由调用方保证） */
export function serializeArchive(conv: AgentConversation): string {
  return JSON.stringify(conv, null, 2)
}

/** 解析 archive 文件；损坏 JSON 返回 null；缺字段降级默认 */
export function parseArchive(raw: string): AgentConversation | null {
  try {
    const data = JSON.parse(raw) as Partial<AgentConversation>
    if (!data || typeof data.id !== 'string' || typeof data.title !== 'string') return null
    return {
      ...data,
      messages: Array.isArray(data.messages) ? data.messages : [],
      compressed: Array.isArray(data.compressed) ? data.compressed : [],
    } as AgentConversation
  } catch {
    return null
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/services/agent/archive-codec.test.ts`
Expected: PASS（6 条）

- [ ] **Step 5: 提交**

```bash
git add src/services/agent/archive-codec.ts src/services/agent/archive-codec.test.ts
git commit -m "feat: CCR archive 编解码与压缩批次选择纯函数"
```

---

### Task 2: 主进程 agent-archive 通道

**Files:**
- Modify: `electron/controllers/fs-controller.ts`（文件末尾 `registerFSController` 内追加 4 个 handler）
- Modify: `src/shared/ipc-channels.ts`（InvokeChannels 追加 4 通道）

**Interfaces:**
- Consumes: 无（独立）
- Produces:
  - `'fs:agent-archive-list': { args: []; return: { id: string; title: string; updatedAt: number }[] }`
  - `'fs:agent-archive-read': { args: [id: string]; return: string | null }`
  - `'fs:agent-archive-write': { args: [id: string, content: string]; return: { success: boolean } }`
  - `'fs:agent-archive-delete': { args: [id: string]; return: { success: boolean } }`

- [ ] **Step 1: 类型定义（先写契约）**

在 `src/shared/ipc-channels.ts` 的 InvokeChannels 中、现有 `'fs:write-json'` 通道之后追加：

```ts
  'fs:agent-archive-list': {
    args: [];
    return: { id: string; title: string; updatedAt: number }[];
  },
  'fs:agent-archive-read': {
    args: [id: string];
    return: string | null;
  },
  'fs:agent-archive-write': {
    args: [id: string, content: string];
    return: { success: boolean };
  },
  'fs:agent-archive-delete': {
    args: [id: string];
    return: { success: boolean };
  },
```

- [ ] **Step 2: 主进程实现**

在 `electron/controllers/fs-controller.ts` 顶部 import 区补 `import path from 'path'`（若已存在则跳过），`registerFSController()` 内、现有 handler 之后追加：

```ts
  // ===== Agent 会话归档（~/.vela/agent-archive/<id>.json，CCR 持久化层） =====
  // 渲染进程不持有 VELA_HOME 路径，归档目录由主进程统一定位（同模板/技能/日志惯例）
  const archivePath = (id: string): string => {
    const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, '') // uuid 防御性清洗，防路径穿越
    return path.join(VELA_HOME, 'agent-archive', `${safe}.json`)
  }

  ipcMain.handle('fs:agent-archive-list', async (): Promise<{ id: string; title: string; updatedAt: number }[]> => {
    const dir = path.join(VELA_HOME, 'agent-archive')
    try {
      await fsPromises.mkdir(dir, { recursive: true })
      const entries = await fsPromises.readdir(dir, { withFileTypes: true })
      const out: { id: string; title: string; updatedAt: number }[] = []
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue
        const id = entry.name.slice(0, -5)
        try {
          const raw = await fsPromises.readFile(path.join(dir, entry.name), 'utf-8')
          const data = JSON.parse(raw) as { title?: string; updatedAt?: number }
          out.push({ id, title: data.title ?? id, updatedAt: data.updatedAt ?? 0 })
        } catch {
          // 损坏归档跳过（列表仍可用，读取时再降级）
        }
      }
      return out.sort((a, b) => b.updatedAt - a.updatedAt)
    } catch {
      return []
    }
  })

  ipcMain.handle('fs:agent-archive-read', async (_e, id: string): Promise<string | null> => {
    try {
      return await fsPromises.readFile(archivePath(id), 'utf-8')
    } catch {
      return null
    }
  })

  ipcMain.handle('fs:agent-archive-write', async (_e, id: string, content: string): Promise<{ success: boolean }> => {
    try {
      const dir = path.join(VELA_HOME, 'agent-archive')
      await fsPromises.mkdir(dir, { recursive: true })
      const target = archivePath(id)
      const temp = `${target}.tmp`
      await fsPromises.writeFile(temp, content, 'utf-8')
      await fsPromises.rename(temp, target)
      return { success: true }
    } catch {
      return { success: false }
    }
  })

  ipcMain.handle('fs:agent-archive-delete', async (_e, id: string): Promise<{ success: boolean }> => {
    try {
      await fsPromises.unlink(archivePath(id))
      return { success: true }
    } catch {
      return { success: false } // 文件不存在视为成功语义（幂等删除）
    }
  })
```

- [ ] **Step 3: 验证类型与门禁**

Run: `pnpm run typecheck && pnpm run lint`
Expected: 零错误零警告（preload 白名单 `'fs:'` 前缀已覆盖新通道，无需改 preload）

- [ ] **Step 4: 提交**

```bash
git add electron/controllers/fs-controller.ts src/shared/ipc-channels.ts
git commit -m "feat: agent-archive 主进程通道（list/read/write/delete，~/.vela/agent-archive）"
```

---

### Task 3: CCR 摘要生成模块

**Files:**
- Create: `src/services/agent/ccr-summary.ts`
- Test: `src/services/agent/ccr-summary.test.ts`

**Interfaces:**
- Consumes: `getModelForPurpose('summarize')`（llm-store，budget 路由已存在 `model-router.ts:59`）、`db:log-llm-call`（ipc-channels.ts:436）、`AgentMessage`（agent-store）
- Produces:
  - `export function buildCcrSummaryPrompt(oldSummary: string, batchText: string): string`
  - `export async function generateConversationSummary(opts: { oldSummary: string; batch: AgentMessage[]; modelId: string }): Promise<string>`

- [ ] **Step 1: 写失败测试（prompt 组装 + 落库参数）**

```ts
// src/services/agent/ccr-summary.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildCcrSummaryPrompt } from './ccr-summary'

describe('buildCcrSummaryPrompt', () => {
  it('含旧摘要时以「旧摘要 + 新批」迭代输入', () => {
    const p = buildCcrSummaryPrompt('旧摘要内容', '新批内容')
    expect(p).toContain('旧摘要内容')
    expect(p).toContain('新批内容')
    // 旧摘要标记与新批标记分离
    expect(p.indexOf('旧摘要内容')).toBeLessThan(p.indexOf('新批内容'))
  })

  it('无旧摘要（首次压缩）时不含旧摘要标记', () => {
    const p = buildCcrSummaryPrompt('', '新批内容')
    expect(p).not.toContain('旧摘要')
    expect(p).toContain('新批内容')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/agent/ccr-summary.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// src/services/agent/ccr-summary.ts
import type { AgentMessage } from '../../stores/agent-store'
import { useLLMStore } from '../../stores/llm-store'
import { t } from '../../shared/locale'
import { ipc } from '../ipc-client'

/** 组装 CCR 摘要 prompt：第 N 次压缩输入 = 旧 rollingSummary + 新压缩批原文（迭代规则见设计 §4.2） */
export function buildCcrSummaryPrompt(oldSummary: string, batchText: string): string {
  const parts = [t('ccr.summaryPrompt')]
  if (oldSummary) {
    parts.push(`${t('ccr.oldSummaryLabel')}\n${oldSummary}`)
  }
  parts.push(`${t('ccr.batchLabel')}\n${batchText}`)
  return parts.join('\n\n')
}

/** 生成对话摘要（budget 路由 + purpose 'ccr_summary' 落库）；失败 throw 由调用方降级硬截断 */
export async function generateConversationSummary(opts: {
  oldSummary: string
  batch: AgentMessage[]
  modelId: string
}): Promise<string> {
  const batchText = opts.batch
    .map(m => `${m.role === 'user' ? t('ccr.roleUser') : t('ccr.roleAssistant')}: ${m.content}`)
    .join('\n\n')
  const prompt = buildCcrSummaryPrompt(opts.oldSummary, batchText)

  const startTime = Date.now()
  const response = await useLLMStore.getState().generate(
    [{ role: 'user', content: prompt }],
    opts.modelId,
    { temperature: 0.2, priority: 12 },
  )
  const duration = Date.now() - startTime

  // 落库 purpose 'ccr_summary'（区别于 agent 面板调用，P2 缓存命中/成本统计可区分）
  try {
    await ipc.invoke('db:log-llm-call', {
      model_id: opts.modelId,
      model_name: useLLMStore.getState().models.find(m => m.id === opts.modelId)?.name ?? '',
      purpose: 'ccr_summary',
      prompt_tokens: (response as unknown as { usage?: { promptTokens?: number } }).usage?.promptTokens ?? 0,
      completion_tokens: (response as unknown as { usage?: { completionTokens?: number } }).usage?.completionTokens ?? 0,
      total_tokens: (response as unknown as { usage?: { totalTokens?: number } }).usage?.totalTokens ?? 0,
      duration_ms: duration,
      success: 1,
      error_message: '',
      cost: 0,
    })
  } catch {
    // 日志失败不影响压缩主流程
  }

  return response.content
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/services/agent/ccr-summary.test.ts`
Expected: PASS（2 条）

- [ ] **Step 5: 提交**

```bash
git add src/services/agent/ccr-summary.ts src/services/agent/ccr-summary.test.ts
git commit -m "feat: CCR 对话摘要生成（budget 路由 + purpose ccr_summary 落库）"
```

---

### Task 4: agent-store 模型扩展 + 持久化接入

**Files:**
- Modify: `src/stores/agent-store.ts`
- Test: `src/stores/agent-store.test.ts`（新建，jsdom）

**Interfaces:**
- Consumes: Task 1 `serializeArchive`/`parseArchive`/`CompressedBatch`、Task 2 的 4 个 `fs:agent-archive-*` 通道
- Produces:
  - `AgentConversation` 新增字段：`compressed?: CompressedBatch[]`、`rollingSummary?: string`、`projectPath?: string`、`projectName?: string`
  - `AgentState.restoreArchives: () => Promise<void>`（启动调用）
  - `AgentState.persistCurrent: () => Promise<void>`（内部，防抖 500ms）

- [ ] **Step 1: 写失败测试（jsdom store 行为）**

```ts
// src/stores/agent-store.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAgentStore } from './agent-store'

// mock IPC（fs:agent-archive-* 通道）
const archiveFiles = new Map<string, string>()
let deleteCalls: string[] = []
const mockInvoke = vi.fn(async (ch: string, ...args: unknown[]) => {
  switch (ch) {
    case 'fs:agent-archive-list':
      return [...archiveFiles.keys()].map(id => ({ id, title: '会话', updatedAt: 1 }))
    case 'fs:agent-archive-read':
      return archiveFiles.get(String(args[0])) ?? null
    case 'fs:agent-archive-write': {
      archiveFiles.set(String(args[0]), String(args[1]))
      return { success: true }
    }
    case 'fs:agent-archive-delete': {
      deleteCalls.push(String(args[0]))
      archiveFiles.delete(String(args[0]))
      return { success: true }
    }
    default:
      return null
  }
})

beforeEach(() => {
  archiveFiles.clear()
  deleteCalls = []
  useAgentStore.setState({ conversations: [], activeConversationId: null })
  Object.defineProperty(window, 'velaAPI', { value: { invoke: mockInvoke }, configurable: true })
})

describe('agent-store 持久化', () => {
  it('createConversation 写入项目快照并落盘', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    expect(conv.projectPath).toBeDefined()
    expect(conv.projectName).toBeDefined()
    await vi.waitFor(() => {
      expect(archiveFiles.has(conv.id)).toBe(true)
    })
  })

  it('deleteConversation 同步删除 archive 文件', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useAgentStore.getState().deleteConversation(conv.id)
    await vi.waitFor(() => {
      expect(deleteCalls).toContain(conv.id)
    })
  })

  it('restoreArchives 从 archive 恢复会话列表', async () => {
    const conv = useAgentStore.getState().createConversation({ title: '旧会话' })
    useAgentStore.getState().clearAll()
    await useAgentStore.getState().restoreArchives()
    const restored = useAgentStore.getState().conversations.find(c => c.id === conv.id)
    expect(restored).toBeDefined()
    expect(restored!.title).toBe('旧会话')
  })

  it('损坏 archive 跳过不崩溃', async () => {
    archiveFiles.set('bad', '{bad json')
    await useAgentStore.getState().restoreArchives()
    expect(useAgentStore.getState().conversations).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/stores/agent-store.test.ts`
Expected: FAIL（restoreArchives 不存在）

- [ ] **Step 3: 实现**

在 `src/stores/agent-store.ts`：

a) import 区追加：
```ts
import { serializeArchive, parseArchive, type CompressedBatch } from '../services/agent/archive-codec'
import { ipc } from '../services/ipc-client'
import { useProjectStore } from './project-store'
```

b) `AgentConversation` 接口追加字段（`agent-store.ts:38-51`）：
```ts
  /** CCR：已压缩批次（保留 2-3 代原文，供压缩卡片展开恢复） */
  compressed?: CompressedBatch[]
  /** CCR：滚动摘要（M1，注入 system 尾部标注节） */
  rollingSummary?: string
  /** 创建时项目快照（仅展示与恢复提示，P0 不做按快照注入） */
  projectPath?: string
  projectName?: string
```

c) `AgentState` 追加：
```ts
  /** 启动恢复：扫描 ~/.vela/agent-archive 重建会话列表（loadSeq 防竞态） */
  restoreArchives: () => Promise<void>
  /** 持久化当前会话（防抖 500ms，fire-and-forget） */
  persistCurrent: () => Promise<void>
```

d) 模块级新增：
```ts
/** archive 恢复请求序号 — 快速启动/重复调用时旧请求晚到不覆盖新状态 */
let archiveLoadSeq = 0
let persistTimer: ReturnType<typeof setTimeout> | null = null
```

e) `createConversation`（`agent-store.ts:177-198`）newConv 增加快照并落盘：
```ts
    const project = useProjectStore.getState().currentProject
    const newConv: AgentConversation = {
      id: genId(),
      title: opts?.title ?? t('agent.newConversation'),
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      mode: get().defaultMode,
      modelId: llmStore.defaultModelId,
      roleplayCharacter: opts?.roleplayCharacter,
      projectPath: project?.path,
      projectName: project?.name,
    }
    set(state => ({
      conversations: [newConv, ...state.conversations],
      activeConversationId: newConv.id,
      showHistory: false,
    }))
    get().persistCurrent()
    return newConv
```

f) `deleteConversation`（`agent-store.ts:204-213`）追加删文件：
```ts
  deleteConversation: (id) => {
    set(state => {
      const filtered = state.conversations.filter(c => c.id !== id)
      const nextId = state.activeConversationId === id
        ? (filtered[0]?.id ?? null)
        : state.activeConversationId
      return { conversations: filtered, activeConversationId: nextId }
    })
    // 同步删除归档文件（主进程幂等删除；fire-and-forget）
    ipc.invoke('fs:agent-archive-delete', id).catch(() => {})
  },
```

g) `clearAll`（`agent-store.ts:215-217`）删除全部归档：
```ts
  clearAll: () => {
    const ids = get().conversations.map(c => c.id)
    set({ conversations: [], activeConversationId: null })
    for (const id of ids) {
      ipc.invoke('fs:agent-archive-delete', id).catch(() => {})
    }
  },
```

h) store 末尾追加两个 action（`resolveToolConfirmation` 之后）：
```ts
  restoreArchives: async () => {
    const mySeq = ++archiveLoadSeq
    try {
      const list = (await ipc.invoke('fs:agent-archive-list')) as { id: string; title: string; updatedAt: number }[]
      const restored: AgentConversation[] = []
      for (const meta of list) {
        const raw = await ipc.invoke('fs:agent-archive-read', meta.id) as string | null
        if (!raw) continue
        const conv = parseArchive(raw)
        if (conv) restored.push(conv)
      }
      if (mySeq !== archiveLoadSeq) return // 旧请求晚到不覆盖
      set(state => ({
        conversations: [...restored, ...state.conversations],
      }))
    } catch {
      // 恢复失败静默（首次启动无归档目录属正常）
    }
  },

  persistCurrent: () => {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      const conv = get().getActiveConversation()
      if (!conv || conv.messages.length === 0) return
      ipc.invoke('fs:agent-archive-write', conv.id, serializeArchive(conv)).catch(() => {
        console.warn('[Agent] 会话归档写盘失败:', conv.id)
      })
    }, 500)
  },
```

i) `main.tsx:12`（`installRendererErrorCapture()` 之后）接入启动恢复：
```ts
// 恢复 Agent 会话归档（~/.vela/agent-archive）——CCR 持久化层
useAgentStore.getState().restoreArchives().catch(() => {})
```
（main.tsx 需 import `useAgentStore`；已在 `main.tsx` 顶部 import 区追加）

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/stores/agent-store.test.ts`
Expected: PASS（4 条）

- [ ] **Step 5: 门禁 + 提交**

Run: `pnpm run typecheck && pnpm run lint`
Expected: 零错误零警告

```bash
git add src/stores/agent-store.ts src/stores/agent-store.test.ts src/main.tsx
git commit -m "feat: Agent 会话持久化（archive 快照/恢复/删除同步 + 防抖写盘）"
```

---

### Task 5: sendMessage CCR 压缩集成

**Files:**
- Modify: `src/stores/agent-store.ts`（`sendMessage` 内 456-469 历史消息构造）
- Test: `src/stores/agent-store.test.ts`（追加用例）

**Interfaces:**
- Consumes: Task 1 `selectCompressionBatch`、Task 3 `generateConversationSummary`、Task 4 `compressed`/`rollingSummary` 字段
- Produces: 压缩流程行为——超 `HISTORY_MAX_TOKENS` 时：最旧批移入 `compressed`（保留 2-3 代）、`rollingSummary` 增量覆盖、`messages` 只剩 rest；失败降级硬截断

- [ ] **Step 1: 写失败测试（压缩触发与降级）**

在 `agent-store.test.ts` 追加（`describe('CCR 压缩集成')`，mock `useLLMStore.generate` 返回固定摘要；构造超预算会话后调用 `sendMessage`，断言 store 状态）：

```ts
import { useLLMStore } from './llm-store'

describe('CCR 压缩集成', () => {
  it('历史超预算时最旧批移入 compressed 且 rollingSummary 迭代更新', async () => {
    // 构造超预算会话（12 条 × 每条约 60+ tokens）
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    const longMsgs = Array.from({ length: 12 }, (_, i) => ({
      id: `m${i}`, role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: '这里是历史消息内容占位。'.repeat(30), createdAt: i,
    }))
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? { ...c, messages: longMsgs } : c),
    }))

    // mock 摘要生成
    const generateMock = vi.fn(async () => ({ content: '迭代摘要 v1', usage: undefined }))
    useLLMStore.setState({ generate: generateMock as never })

    await useAgentStore.getState().sendMessage('新消息')

    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    expect(after.rollingSummary).toBe('迭代摘要 v1')
    expect(after.compressed).toHaveLength(1)
    expect(after.messages.length).toBeLessThan(longMsgs.length)
  })

  it('摘要生成失败时降级硬截断（不阻断对话，rollingSummary 不变）', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    const longMsgs = Array.from({ length: 12 }, (_, i) => ({
      id: `m${i}`, role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: '这里是历史消息内容占位。'.repeat(30), createdAt: i,
    }))
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? { ...c, messages: longMsgs } : c),
    }))
    useLLMStore.setState({ generate: vi.fn(async () => { throw new Error('LLM 失败') }) as never })

    await useAgentStore.getState().sendMessage('新消息')

    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    expect(after.rollingSummary).toBeUndefined() // 压缩失败未污染摘要
    expect(after.compressed).toHaveLength(0)
    // 对话仍完成（assistant 回复生成中/完成，generating 已复位）
    expect(useAgentStore.getState().generating).toBe(false)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/stores/agent-store.test.ts`
Expected: 新用例 FAIL（rollingSummary 未更新）

- [ ] **Step 3: 实现——替换 `agent-store.ts:456-469` 历史消息构造**

将原「构造历史消息（Token 感知窗口：最多 4000 tokens）」块替换为：

```ts
      // ===== CCR 压缩检查（替换原 4000-token 硬丢弃）：超预算时先压缩最旧批 =====
      // 压缩后 messages 剩 rest（最新轮次），压缩批移入 compressed 保留原文（2-3 代）
      const HISTORY_MAX_TOKENS = 4000 // 常量随块上移（原 456-457 行块内 const）
      const preCompressMessages = currentConv.messages.filter(m => !m.streaming && m.role !== 'system')
      const totalHistoryTokens = preCompressMessages.reduce(
        (sum, m) => sum + estimateTokens(m.content), 0,
      )
      if (totalHistoryTokens > HISTORY_MAX_TOKENS) {
        try {
          const { batch, rest } = selectCompressionBatch(currentConv.messages, HISTORY_MAX_TOKENS)
          if (batch.length > 0) {
            const summary = await generateConversationSummary({
              oldSummary: currentConv.rollingSummary ?? '',
              batch,
              modelId,
            })
            const batchNum = (currentConv.compressed?.length ?? 0) + 1
            const newBatch: CompressedBatch = {
              batch: batchNum,
              original: batch,
              summary,
              compressedAt: Date.now(),
              originalTokens: batch.reduce((sum, m) => sum + estimateTokens(m.content), 0),
            }
            // 保留 2-3 代原文防摘要漂移：超过 3 代时丢弃最旧一代的 original（仅留摘要）
            const compressed = [...(currentConv.compressed ?? []), newBatch]
            if (compressed.length > 3) {
              compressed[0] = { ...compressed[0], original: [] }
            }
            set(state => ({
              conversations: state.conversations.map(c =>
                c.id === convId
                  ? { ...c, messages: rest, compressed, rollingSummary: summary, updatedAt: Date.now() }
                  : c
              ),
            }))
            get().persistCurrent()
          }
        } catch {
          // 摘要失败降级：不压缩，走下方硬截断（历史行为，不阻断对话）
          console.warn('[Agent] CCR 摘要生成失败，降级硬截断')
        }
      }

      // 构造历史消息（Token 感知窗口：最多 4000 tokens；CCR 压缩后剩余消息通常已达标）
      const afterCompress = get().conversations.find(c => c.id === convId)!
      const candidateMessages = afterCompress.messages
        .filter(m => !m.streaming && m.role !== 'system')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
        .reverse() // 从最新到最旧
      const historyMessages: LLMMessage[] = []
      let historyTokens = 0
      for (const msg of candidateMessages) {
        const msgTokens = estimateTokens(msg.content)
        if (historyTokens + msgTokens > HISTORY_MAX_TOKENS) break
        historyMessages.unshift(msg) // 还原为正序
        historyTokens += msgTokens
      }
```

（`HISTORY_MAX_TOKENS` 常量上移到压缩块可见处；`CompressedBatch` 类型已由 Task 4 import）

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/stores/agent-store.test.ts`
Expected: 全部 PASS（含新增 2 条）

- [ ] **Step 5: 门禁 + 提交**

Run: `pnpm run typecheck && pnpm run lint`

```bash
git add src/stores/agent-store.ts src/stores/agent-store.test.ts
git commit -m "feat: CCR 压缩集成 — 超预算滚动摘要 + 2-3 代原文保留 + 失败降级硬截断"
```

---

### Task 6: context-builder M1 会话摘要注入

**Files:**
- Modify: `src/services/agent/context-builder.ts`
- Test: `src/services/agent/context-builder.test.ts`（追加）

**Interfaces:**
- Consumes: `useAgentStore`（读 `getActiveConversation().rollingSummary`）
- Produces:
  - `export function buildAgentSystemSegments(mode: AgentMode): { base: string; memory: string }`
  - `buildAgentSystemPrompt(mode)` 签名不变（内部 = base + memory + 语言指令，语言指令保持最末尾）

- [ ] **Step 1: 写失败测试**

在 `context-builder.test.ts` 追加：

```ts
import { useAgentStore } from '../../stores/agent-store'

describe('buildAgentSystemSegments M1 会话摘要', () => {
  it('无滚动摘要时不注入记忆节', () => {
    useAgentStore.setState({ conversations: [], activeConversationId: null })
    const { base, memory } = buildAgentSystemSegments('quick')
    expect(memory).toBe('')
  })

  it('有滚动摘要时注入「自动生成」标注节', () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? { ...c, rollingSummary: '用户要求写甜文，已确认主角性格' } : c),
    }))
    const { base, memory } = buildAgentSystemSegments('quick')
    expect(memory).toContain('用户要求写甜文，已确认主角性格')
    expect(memory).toContain('自动生成') // 标注非用户输入
  })

  it('超 300 tokens 预算时记忆节被裁剪', () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? { ...c, rollingSummary: '长摘要'.repeat(400) } : c),
    }))
    const { memory } = buildAgentSystemSegments('quick')
    expect(memory.length).toBeLessThan(600)
  })

  it('语言指令保持在最终 prompt 最末尾（#30 语义不变）', () => {
    const prompt = buildAgentSystemPrompt('quick')
    expect(prompt.trim().endsWith('Do not respond in any other language.')).toBe(true)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/agent/context-builder.test.ts`
Expected: FAIL（buildAgentSystemSegments 不存在）

- [ ] **Step 3: 实现**

重构 `context-builder.ts`：将 `buildAgentSystemPrompt` 拆为 `buildAgentSystemSegments`（返回 base/memory 两段），原函数拼接两段 + 语言指令：

```ts
/**
 * 构建 Agent 系统提示词分段：
 * - base：身份 + L0 + L1 + Tool（稳定内容前置，缓存友好段）
 * - memory：M1 会话摘要（自动生成标注节，预算 300 tokens）+ 可扩展 M2 作品记忆（P1）
 * 语言指令由 buildAgentSystemPrompt 统一追加（保持最末尾，#30）
 */
export function buildAgentSystemSegments(mode: AgentMode): { base: string; memory: string } {
  const sections: string[] = []

  // 1. Agent 身份与行为指导 (~400 tokens)
  sections.push(buildIdentityPrompt(mode))

  // 2. L0 — 始终注入的项目上下文 (~800 tokens 预算)
  const l0 = buildL0ProjectContext()
  if (l0) sections.push(l0)

  // 3. L1 — 编辑器感知上下文 (~600 tokens 预算)
  const l1 = buildL1EditorContext()
  if (l1) sections.push(l1)

  // 4. Tool 系统提示词 (~1200 tokens 预算)
  const toolPrompt = toolRegistry.generateToolPrompt()
  if (toolPrompt) {
    const truncated = truncateToTokenBudget(toolPrompt, 1200)
    const isTruncated = truncated.length < toolPrompt.length
    sections.push(isTruncated
      ? `${truncated}\n\n${t('engine.toolTruncatedNotice').replace('{tools}', toolRegistry.listAll().map(tool => tool.name).join(', '))}`
      : truncated)
  }

  const base = sections.join('\n\n---\n\n')

  // ===== M1 会话摘要节（CCR 滚动摘要，自动生成非用户输入；M2 作品记忆 P1 追加于此） =====
  const memoryParts: string[] = []
  const activeConv = useAgentStore.getState().getActiveConversation()
  const summary = activeConv?.rollingSummary
  if (summary) {
    memoryParts.push(`${t('ccr.conversationSummaryHeader')}\n${t('ccr.autoGeneratedNotice')}\n\n${truncateToTokenBudget(summary, 300)}`)
  }
  return { base, memory: memoryParts.join('\n\n---\n\n') }
}

/** 兼容入口：base + memory + 语言指令（语言指令保持最末尾，优先于一切） */
export function buildAgentSystemPrompt(mode: AgentMode): string {
  const { base, memory } = buildAgentSystemSegments(mode)
  const parts = [base]
  if (memory) parts.push(memory)
  const full = parts.join('\n\n---\n\n')

  // 总上限 3500 → 3800（M1 记忆层 300；超限按 M1 → L1 → Tool 顺序降级）
  if (estimateTokens(full) > 3800) {
    console.warn(`[ContextBuilder] 系统提示词过大 (${estimateTokens(full)} tokens)，按优先级裁剪`)
    const l1Index = parts.findIndex(s => s.startsWith(t('engine.contextEditorHeader')))
    if (l1Index >= 0) {
      parts[l1Index] = `${t('engine.contextEditorHeader')}\n${t('engine.contextEditorOmitted')}`
    }
    const trimmed = parts.join('\n\n---\n\n')
    if (estimateTokens(trimmed) > 3800) {
      const toolIndex = parts.findIndex(s => s.startsWith(t('engine.toolSystemTitle')))
      if (toolIndex >= 0 && parts[toolIndex].length > 500) {
        parts[toolIndex] = parts[toolIndex].slice(0, 500) + '\n\n…' + t('engine.toolListTruncated')
      }
    }
    return appendOutputLanguage(parts.join('\n\n---\n\n'), getCurrentLocale())
  }
  return appendOutputLanguage(full, getCurrentLocale())
}
```

（原函数内从「身份」到「Tool」的构建逻辑原样保留，仅改返回值结构；`useAgentStore` 加入顶部 import）

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/services/agent/context-builder.test.ts`
Expected: PASS（原 1 条 + 新增 4 条）

- [ ] **Step 5: 门禁 + 提交**

Run: `pnpm run typecheck && pnpm run lint`

```bash
git add src/services/agent/context-builder.ts src/services/agent/context-builder.test.ts
git commit -m "feat: context-builder M1 会话摘要节注入（segments 拆分 + 300 tokens 预算）"
```

---

### Task 7: UI — 压缩卡片 + 上下文预算条

**Files:**
- Create: `src/components/panels/agent/CompressedBatchCard.tsx`
- Create: `src/components/panels/agent/ContextBudgetBar.tsx`
- Create: `src/services/agent/context-usage.ts`（预算条分段纯函数）
- Test: `src/services/agent/context-usage.test.ts`
- Modify: `src/components/panels/agent/AgentConversation.tsx`（消息流插卡片 + 底部挂预算条）

**Interfaces:**
- Consumes: Task 4 `compressed`/`rollingSummary` 字段、`estimateTokens`、`provider-presets`（模型 maxTokens）
- Produces:
  - `export interface ContextUsage { base: number; memory: number; history: number; current: number; modelMax: number; total: number }`
  - `export function computeContextUsage(opts: { base: string; memory: string; historyMessages: LLMMessage[]; currentContent: string; modelMax: number }): ContextUsage`

- [ ] **Step 1: 写失败测试（分段计算纯函数）**

```ts
// src/services/agent/context-usage.test.ts
import { describe, it, expect } from 'vitest'
import { computeContextUsage } from './context-usage'

describe('computeContextUsage', () => {
  it('各段独立计数，记忆段不与基础段双计', () => {
    const usage = computeContextUsage({
      base: '身份L0L1Tool'.repeat(100),
      memory: '记忆内容'.repeat(20),
      historyMessages: [{ role: 'user', content: '历史' }],
      currentContent: '当前消息',
      modelMax: 131072,
    })
    expect(usage.base).toBeGreaterThan(0)
    expect(usage.memory).toBeGreaterThan(0)
    // total = 四段之和（无双计）
    expect(usage.total).toBe(usage.base + usage.memory + usage.history + usage.current)
    expect(usage.modelMax).toBe(131072)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/services/agent/context-usage.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// src/services/agent/context-usage.ts
import { estimateTokens } from './token-budget'
import type { LLMMessage } from './agent-engine' // LLMMessage 定义于 agent-engine.ts:71

export interface ContextUsage {
  base: number
  memory: number
  history: number
  current: number
  modelMax: number
  total: number
}

/** 预算条分段计算：基础段（身份+L0+L1+Tool）+ 记忆段（M1）+ 历史 + 当前，无双计 */
export function computeContextUsage(opts: {
  base: string
  memory: string
  historyMessages: LLMMessage[]
  currentContent: string
  modelMax: number
}): ContextUsage {
  const base = estimateTokens(opts.base)
  const memory = estimateTokens(opts.memory)
  const history = opts.historyMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
  const current = estimateTokens(opts.currentContent)
  return {
    base,
    memory,
    history,
    current,
    modelMax: opts.modelMax,
    total: base + memory + history + current,
  }
}
```

- [ ] **Step 4: 组件实现**

`CompressedBatchCard.tsx`（压缩事件卡片——CCR 可解释性出口）：

```tsx
import { useState } from 'react'
import type { CompressedBatch } from '../../../services/agent/archive-codec'
import { t } from '../../../shared/locale'

/** CCR 压缩事件卡片：摘要 + 展开恢复原文（设计 §4.4） */
export default function CompressedBatchCard({ batch }: { batch: CompressedBatch }) {
  const [expanded, setExpanded] = useState(false)
  const savedTokens = batch.originalTokens

  return (
    <div
      className="mx-2 my-2 rounded-lg px-3 py-2 text-xs"
      style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px dashed var(--color-border)' }}
    >
      <div className="flex items-center justify-between">
        <span style={{ color: 'var(--color-text-secondary)' }}>
          {t('ccr.compressedNotice').replace('{n}', String(batch.original.length))}
          {savedTokens > 0 && ` · ${t('ccr.savedTokens').replace('{n}', String(savedTokens))}`}
        </span>
        <button
          onClick={() => setExpanded(e => !e)}
          style={{ color: 'var(--color-accent)' }}
          className="hover:underline"
        >
          {expanded ? t('ccr.collapse') : t('ccr.expand')}
        </button>
      </div>
      <div className="mt-1 whitespace-pre-wrap">{batch.summary}</div>
      {expanded && batch.original.length > 0 && (
        <div
          className="mt-2 max-h-48 overflow-y-auto rounded px-2 py-1"
          style={{ backgroundColor: 'var(--color-bg-hover)' }}
        >
          {batch.original.map(m => (
            <div key={m.id} className="mb-1">
              <span style={{ color: 'var(--color-text-secondary)' }}>{m.role === 'user' ? t('ccr.roleUser') : t('ccr.roleAssistant')}: </span>
              {m.content}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

`ContextBudgetBar.tsx`（底部预算条）：

```tsx
import type { ContextUsage } from '../../../services/agent/context-usage'
import { t } from '../../../shared/locale'

/** 上下文占用预算条：基础/记忆/历史/当前 四段 vs 模型上限 */
export default function ContextBudgetBar({ usage }: { usage: ContextUsage | null }) {
  if (!usage || usage.modelMax <= 0) return null
  const pct = Math.min(100, Math.round((usage.total / usage.modelMax) * 100))

  return (
    <div className="px-3 pt-1 pb-0">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: 'var(--color-bg-hover)' }}>
        {[
          { label: t('ccr.segBase'), value: usage.base, color: 'var(--color-accent)' },
          { label: t('ccr.segMemory'), value: usage.memory, color: 'var(--color-info)' },
          { label: t('ccr.segHistory'), value: usage.history, color: 'var(--color-warning)' },
          { label: t('ccr.segCurrent'), value: usage.current, color: 'var(--color-success)' },
        ].map(seg => (
          <div
            key={seg.label}
            title={`${seg.label}: ${seg.value} tokens`}
            style={{
              width: `${Math.max(0, Math.min(100, (seg.value / usage.modelMax) * 100))}%`,
              backgroundColor: seg.color,
            }}
          />
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
        <span>{t('ccr.budgetLabel').replace('{base}', String(usage.base)).replace('{memory}', String(usage.memory)).replace('{history}', String(usage.history)).replace('{current}', String(usage.current))}</span>
        <span>{t('ccr.budgetTotal').replace('{total}', String(usage.total)).replace('{max}', String(usage.modelMax)).replace('{pct}', String(pct))}</span>
      </div>
    </div>
  )
}
```

`AgentConversation.tsx` 挂载（两处）：

a) 消息流插入压缩卡片——`AgentConversation.tsx:166` `<div className="flex flex-col">` 内、`activeConv.messages.filter(...).map(...)` 之前：

```tsx
          {/* CCR 压缩事件卡片：已折叠批次（按 batch 序，早的在前） */}
          {(activeConv.compressed ?? [])
            .slice()
            .sort((a, b) => a.batch - b.batch)
            .filter(b => b.summary)
            .map(b => (
              <CompressedBatchCard key={b.batch} batch={b} />
            ))}
```

c) 项目不一致提示条——会话激活且 `conv.projectPath` 与当前项目不符时显示（P0 仅提示，不静默切换；置于消息流顶部）：

```tsx
          {/* 恢复提示：会话基于快照项目，与当前打开项目不一致（P0 仅提示） */}
          {activeConv.projectName && currentProjectName && activeConv.projectName !== currentProjectName && (
            <div className="mx-2 my-2 rounded-lg px-3 py-1.5 text-xs" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
              {t('ccr.restoreProjectHint').replace('{name}', activeConv.projectName).replace('{current}', currentProjectName)}
            </div>
          )}
```

（`currentProjectName` 取自 `useProjectStore.getState().currentProject?.name`，在组件内读入）

d) 底部预算条——`AgentConversation.tsx:206` 底部工具栏 div 上方（滚动区之后）：

```tsx
      {/* 上下文占用预算条（基础/记忆/历史/当前 vs 模型上限） */}
      <ContextBudgetBar usage={contextUsage} />
```

（组件顶部计算 `contextUsage`：`const systemSegments = buildAgentSystemSegments(activeConv.mode)`；`modelMax` 取 `provider-presets` 当前会话模型 maxTokens（`useLLMStore.getState().models.find(m => m.id === modelId)?.maxTokens ?? 131072`）；history 段用当前 messages 估算；current 用输入框内容。import 对应组件与函数）

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run src/services/agent/context-usage.test.ts`
Expected: PASS

- [ ] **Step 6: 门禁 + 提交**

Run: `pnpm run typecheck && pnpm run lint`

```bash
git add src/components/panels/agent/CompressedBatchCard.tsx src/components/panels/agent/ContextBudgetBar.tsx src/services/agent/context-usage.ts src/services/agent/context-usage.test.ts src/components/panels/agent/AgentConversation.tsx
git commit -m "feat: 压缩事件卡片 + 上下文预算条（CCR 可解释性与占用可视化）"
```

---

### Task 8: i18n + 全量验证

**Files:**
- Modify: `src/shared/locale-data.ts`（`UI_TEXTS_DATA`，`locale.ts:10` import 已确认）

**Interfaces:**
- Consumes: 前 7 任务所有 t() 引用（`ccr.*` key 共 14 个）

- [ ] **Step 1: 新增 i18n key（三语）**

在 locale 数据中新增 `ccr` 命名空间（zh-CN / en-US / ru-RU 三语各一份）：

```
ccr.summaryPrompt          zh: 请将以下对话历史压缩为简洁的中文摘要，保留：关键事实、用户指令、未完成任务、已确认的决策。不要编造对话中未出现的信息。输出纯摘要文本。
                           en: Compress the following conversation history into a concise summary. Keep: key facts, user instructions, unfinished tasks, and confirmed decisions. Do not invent information absent from the conversation. Output only the summary text.
                           ru: Сожмите следующую историю диалога в краткую сводку. Сохраните: ключевые факты, указания пользователя, незавершённые задачи и принятые решения. Не выдумывайте информацию, отсутствующую в диалоге. Выведите только текст сводки.
ccr.oldSummaryLabel        zh: 已有摘要：/ en: Existing summary:/ ru: Существующая сводка:
ccr.batchLabel             zh: 本次新增对话历史：/ en: New conversation history:/ ru: Новые сообщения:
ccr.roleUser               zh: 用户 / en: User / ru: Пользователь
ccr.roleAssistant          zh: 助手 / en: Assistant / ru: Ассистент
ccr.conversationSummaryHeader  zh: ## 会话摘要 / en: ## Conversation Summary / ru: ## Сводка диалога
ccr.autoGeneratedNotice    zh: （自动生成，非用户输入） / en: (auto-generated, not user input) / ru: (создано автоматически, не ввод пользователя)
ccr.compressedNotice        zh: 已折叠 {n} 条历史 / en: {n} messages collapsed / ru: Свёрнуто сообщений: {n}
ccr.savedTokens             zh: 节省 {n} tokens / en: {n} tokens saved / ru: Экономлено токенов: {n}
ccr.expand                  zh: 展开恢复 / en: Expand / ru: Развернуть
ccr.collapse                zh: 收起 / en: Collapse / ru: Свернуть
ccr.segBase                 zh: 基础 / en: Base / ru: База
ccr.segMemory               zh: 记忆 / en: Memory / ru: Память
ccr.segHistory              zh: 历史 / en: History / ru: История
ccr.segCurrent              zh: 当前 / en: Current / ru: Текущее
ccr.budgetLabel             zh: 基础 {base} · 记忆 {memory} · 历史 {history} · 当前 {current}
                           en: Base {base} · Memory {memory} · History {history} · Current {current}
                           ru: База {base} · Память {memory} · История {history} · Текущее {current}
ccr.budgetTotal             zh: {total} / {max} ({pct}%) / en: {total} / {max} ({pct}%) / ru: {total} / {max} ({pct}%)
ccr.restoreProjectHint      zh: 此会话基于项目「{name}」，当前打开项目「{current}」 / en: This conversation was created in project "{name}", currently open: "{current}" / ru: Диалог создан в проекте «{name}», сейчас открыт: «{current}»
```

（locale 数据结构以现有 `locale-data.ts` 的嵌套对象/前缀风格为准，`t()` 调用方已统一为 `ccr.xxx` 路径）

- [ ] **Step 2: 残留扫描（i18n-standard 五步法）**

Run: `pnpm run gen:tokens`（token 报告）或手工 grep 确认 `ccr.` 引用全部有定义、无中文硬编码残留于新组件

- [ ] **Step 3: 全量质量门禁**

Run:
```bash
pnpm run typecheck
pnpm run lint
pnpm run test
```
Expected: tsc 零错误 / eslint 零警告 / **全部测试通过（含新增 ~14 条）**

- [ ] **Step 4: 冒烟验证**

Run: `pnpm run dev`
手动验证（对照设计 §10 P0 验收）：
1. 长对话（12+ 轮）触发压缩 → 消息流出现压缩卡片，可展开恢复原文，显示节省 token
2. 底部预算条四段显示，数字与 `estimateTokens` 一致，无双计
3. 刷新应用（F5）→ 会话从 archive 恢复，滚动摘要注入 system（日志/对话行为可见）
4. 删除会话 → `~/.vela/agent-archive/` 对应文件消失
5. `~/.vela/agent-archive/` 文件为 UTF-8 合法 JSON

- [ ] **Step 5: 提交**

```bash
git add src/shared/locale-data.ts
git commit -m "feat: CCR i18n（ccr.* 14 key 三语）+ 全量验证"
```

---

## 验收对照（设计 §10 P0）

| 设计验收项 | 对应任务 |
|-----------|---------|
| archive 持久化：长会话刷新后完整恢复（消息 + 滚动摘要 + 压缩批次） | Task 2/4 |
| 超 4000 tokens 自动生成摘要卡片，可展开恢复原文，显示节省 token | Task 1/5/7 |
| 摘要注入 system 尾部标注节，不破坏 user/assistant 轮替 | Task 6 |
| 预算条实时准确（基础段/记忆段/历史/当前 vs 当前模型上限，无双计） | Task 7 |
| 质量门禁：tsc / eslint / 测试全过 | Task 8 |

**范围外（后续计划）**：P1 作品记忆三级摘要 + 记忆查看器；P2 跨会话复用 / 全局统计 / 手动编辑 / v14 cached_tokens 迁移。
