# Agent 循环加固实施计划（零成本小改三项，compare 报告 §三.1/2/9）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 参照 Claude Code 工具层纪律，加固 NovelForge agent 循环的三处薄弱点：① 工具调用解析错误的逐条反馈（部分失败不再静默）② read_file 读去重（file_unchanged 桩，省 token）③ read_file 读前 token 约束 + offset/limit 分页（大文件不全量注入）。

**Architecture:** 纯 agent 层加固，不动数据模型：① agent-engine 的 parseErrors 反馈条件从「全失败才注入」放宽为「逐条失败注入」② read-file.tool.ts 模块级读状态 Map（会话级清理钩子）③ read_file schema 加 offset/limit + 注入上限。三任务相互独立。

**Tech Stack:** TypeScript + vitest

**Spec:** `docs/2026-08-26-claude-code-compare.md` §三.1/2/9（对照源：CC `toolExecution.ts` / `FileReadTool` / `readFileInRange.ts`）

## Global Constraints

- ESLint strict（--max-warnings 0）、TypeScript strict（noUnusedLocals/Parameters）
- 所有用户可见文本走 `t()`——新增键集中在 `agent.*`/`tool.*`，三语
- 提交规范：`fix:`/`feat:` 前缀、一个提交一件事、`git commit -F - <<'EOF'` 消息文件
- **行为兼容优先**：不改变既有工具执行的成功路径；桩/截断仅作用于「重复读」「超大文件」两个新分支
- 测试用 vitest，无 @testing-library/react——用 createRoot + act 模式

---

### Task H1: 工具调用解析错误逐条反馈（加固）

**Files:**
- Modify: `src/services/agent/agent-engine.ts`（parseErrors 反馈逻辑，:177-188）
- Test: `src/services/agent/agent-engine.test.ts`（若不存在则新建，参照既有测试模式）

**Interfaces:**
- Consumes: `parseToolCalls` 的 `parseErrors: ToolParseError[]`（:333-340 已有类型）+ `formatParseErrorsForLLM`（已有）
- Produces: 无新接口——行为变化：`parseErrors.length > 0` 时无论 toolCalls 是否为空，失败项诊断都注入 observation

**现状（已核实）**：未知工具（:238-244）、用户拒绝（:255-261）、执行异常（:286-291）均已转 `<\tool_result error="true">` 回上下文 ✓；**但** `parseErrors` 只在 `parseErrors.length > 0 && toolCalls.length === 0`（全失败）时注入自检反馈（:179）——**部分成功 + 部分解析失败时失败项被静默丢弃**，LLM 不知情（CC 对每个解析失败都回 `<\tool_use_error>` 带 tool_use_id）。

- [ ] **Step 1: 写失败测试（部分失败场景）**

```ts
// src/services/agent/agent-engine.test.ts（或追加）
describe('agent-engine 工具解析错误反馈', () => {
  it('部分成功 + 部分解析失败：失败项诊断注入 observation（不再静默）', async () => {
    // mock LLM 返回：正常文本 + 一个合法 tool_call（成功执行）+ 一个格式损坏的 tool_call（解析失败）
    // 断言：最终 messages 中存在含「解析失败」诊断文本的 user observation（格式诊断 + rawContent 截断 + suggestion）
  })

  it('全失败场景保持既有行为（诊断注入）', async () => {
    // mock 返回仅损坏的 tool_call → 断言注入诊断（回归保护）
  })

  it('无解析失败不注入诊断', async () => {
    // mock 正常回复 → 断言无诊断注入
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm run test:watch src/services/agent/agent-engine.test.ts`
Expected: FAIL（部分失败场景无诊断注入）。

- [ ] **Step 3: 实现**

`agent-engine.ts` :177-188 的逻辑改为：

```ts
// ★ 工具调用解析失败诊断（逐条反馈，不静默）：
//    部分成功 + 部分解析失败时，失败项也注入 observation，让 LLM 知道哪些调用没被理解
if (parseErrors.length > 0) {
  const errorFeedback = formatParseErrorsForLLM(parseErrors)
  if (toolCalls.length === 0) {
    // 全失败：独立 user 消息触发自我修正（既有行为）
    messages.push({ role: 'assistant', content: llmResponse })
    messages.push({
      role: 'user',
      content: t('engine.parseDiagnosis').replace('{feedback}', errorFeedback),
    })
    console.warn('[AgentEngine] 注入解析错误反馈给 LLM，触发自我修正')
    continue
  }
  // 部分失败：解析诊断追加到本轮 observation 头部（toolCalls 继续正常执行）
  // 诊断段延迟到 observation 组装时注入——此处仅保存，避免重复 push
  parseFeedbackForObservation = errorFeedback
}
```

  在 observation 组装处（:294-297）前置诊断段：

```ts
const observationParts = parseFeedbackForObservation
  ? [`${t('engine.parsePartialDiagnosis')}\n${parseFeedbackForObservation}`, ...observationParts]
  : observationParts
```

  `parseFeedbackForObservation` 为循环级变量（每轮重置为 undefined）。新增 i18n 键 `engine.parsePartialDiagnosis`（三语：「以下工具调用未能解析，已忽略」/ "Some tool calls could not be parsed and were ignored" / "Некоторые вызовы инструментов не удалось разобрать и они проигнорированы"）。

- [ ] **Step 4: 运行确认通过 + 全量回归**

Run: `pnpm run test && pnpm run typecheck && pnpm run lint`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add src/services/agent/agent-engine.ts src/services/agent/agent-engine.test.ts src/shared/locale-data.ts
git commit -F - <<'EOF'
fix: 工具解析失败逐条反馈（部分成功场景不再静默丢弃失败项）
EOF
```

---

### Task H2: read_file 读去重（file_unchanged 桩）

**Files:**
- Modify: `src/services/agent/tools/read-file.tool.ts`（模块级读状态 Map + 桩返回）
- Modify: `src/services/agent/tools/index.ts`（导出 clearReadState）——或由 read-file.tool.ts 直接导出
- Modify: `src/stores/agent-store.ts`（会话切换/新建/清空时调用 clearReadState）
- Test: `src/services/agent/tools/read-file.tool.test.ts`（新建）

**Interfaces:**
- Produces: `readState` 模块级 Map + `clearReadState(): void`（导出，供 agent-store 调用）；桩消息常量 `FILE_UNCHANGED_STUB`
- Consumes: 现有 `ipc.invoke('fs:read-file' | 'fs:read-external-file')`

**背景（对照 CC FileReadTool 读去重）**：CC 实测约 18% Read 是同一文件重复读，重复全量注入每轮烧 cache_creation token。NF 的 read_file 无状态，多轮 ReAct 中 LLM 重复读同一文件时全文重复注入（引擎层 truncateResult 800 兜底但仍白读全文件）。

**v1 范围决策**：只做「同路径重复读 → 桩」，**不做**「先读后写硬拒」（write_file 有创建新文件场景，硬拒破坏工作流）与「Windows mtime 内容回退」（需 execute 签名带 context，改动面大）——二者记 deferred。

- [ ] **Step 1: 写失败测试**

```ts
// src/services/agent/tools/read-file.tool.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileTool, clearReadState } from './read-file.tool'

// mock：ipc 通道路由 + project-store 当前项目
describe('read_file 读去重', () => {
  beforeEach(() => { clearReadState(); vi.clearAllMocks() })

  it('同一路径重复读：第二次返回 file_unchanged 桩（不重发全文）', async () => {
    // mock fs:read-file 返回「长文本内容」
    const r1 = await readFileTool.execute({ file_path: 'chap1.md' })
    expect(r1.success).toBe(true)
    const r2 = await readFileTool.execute({ file_path: 'chap1.md' })
    expect(r2.success).toBe(true)
    expect(r2.content).toContain('file_unchanged')  // 桩标记
    expect(r2.content).not.toContain('长文本内容')   // 不重发全文
    // 断言 ipc.invoke 仅被调用 1 次（fs:read-file）
  })

  it('不同路径不受影响', async () => {
    // 读 a.md → 读 b.md → 两次都返回全文
  })

  it('clearReadState 后重复读恢复全文', async () => {
    // 读 → 桩 → clearReadState() → 读 → 全文
  })

  it('外部文件（绝对路径）同样去重', async () => {
    // mock fs:read-external-file → 重复读 → 桩
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm run test:watch src/services/agent/tools/read-file.tool.test.ts`
Expected: FAIL（无去重）。

- [ ] **Step 3: 实现**

```ts
// read-file.tool.ts 顶部追加
/** 读去重状态（模块级，会话无关）；agent-store 会话切换/新建/清空时调用 clearReadState 清理 */
const readState = new Map<string, { content: string }>()

export function clearReadState(): void {
  readState.clear()
}

/** 桩消息：文件未变化，不重发全文（省重复注入的 token） */
const FILE_UNCHANGED_STUB = (path: string, len: number): string =>
  `<persisted-output>\n[file_unchanged] ${path} 内容与上次读取一致（${len} 字符），未重新注入全文。如需要最新内容请先保存后重试。\n</persisted-output>`
```

  execute 中两个读取分支（项目内 :56 / 外部 :43）成功后各加：

```ts
// 读去重：记录状态；重复读同一路径返回桩（不重发全文）
readState.set(pathKey, { content: String(result.content ?? '') })
return { success: true, content: String(result.content ?? '') }
```

  execute 开头（路径解析后）加去重短路：

```ts
// 读去重：同路径已读过且内容未变化 → 桩（省重复注入）
const state = readState.get(pathKey)
if (state) {
  return { success: true, content: FILE_UNCHANGED_STUB(pathKey, state.content.length) }
}
```

  `pathKey`：项目内用 `pathCheck.fullPath`，外部用绝对路径（两者不冲突，天然按路径区分）。
  ⚠️ 桩内容含 i18n 提示——桩文本是给 LLM 看的（非用户 UI），但按 i18n 铁律仍走 `t()`：`tool.fileUnchangedStub` 键（三语）。

- [ ] **Step 4: agent-store 会话生命周期清理**

```ts
// agent-store.ts import { clearReadState } from '../services/agent/tools/read-file.tool'
// createConversation / selectConversation / clearAll 三处 set 后调用 clearReadState()
//（切换会话后新会话的重复读应重新全量注入——上下文不同）
```

  测试：`src/stores/agent-store.test.ts` 追加——切换会话后 read_file 重复读返回全文（clearReadState 生效）。

- [ ] **Step 5: 运行确认通过 + 全量回归**

Run: `pnpm run test && pnpm run typecheck && pnpm run lint`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add src/services/agent/tools/read-file.tool.ts src/services/agent/tools/read-file.tool.test.ts src/stores/agent-store.ts src/shared/locale-data.ts
git commit -F - <<'EOF'
feat: read_file 读去重（同路径重复读返回 file_unchanged 桩，省重复注入 token；会话切换清理）
EOF
```

---

### Task H3: read_file token 约束 + offset/limit 分页

**Files:**
- Modify: `src/services/agent/tools/read-file.tool.ts`（schema 加 offset/limit + 注入上限）
- Modify: `src/shared/locale-data.ts`（`tool.readFileTruncated` 等键）
- Test: `src/services/agent/tools/read-file.tool.test.ts`（追加用例）

**Interfaces:**
- Consumes: `estimateTokens`（token-budget.ts，已有）
- Produces: read_file 新参数 `offset?: number`、`limit?: number`；常量 `READ_MAX_CHARS`（注入上限，约 8000 字符 ≈ 2000-4000 token，取项目实际值）

**背景（对照 CC 两段式估算 + readFileInRange）**：NF 现状 read_file 全量返回 → 引擎层 truncateResult 800 token 截断——**I/O 与 IPC 传全文后丢弃**。CC 读前估算 + 超限抛错教模型用 offset/limit。NF v1：读全量但**注入限制**（省的是上下文注入与截断损耗）+ offset/limit 分页（大文件分段读）。

- [ ] **Step 1: 写失败测试（追加）**

```ts
// read-file.tool.test.ts 追加 describe
describe('read_file token 约束与分页', () => {
  it('超大文件：注入前 READ_MAX_CHARS 截断 + 截断提示（含总长度与分页建议）', async () => {
    // mock fs:read-file 返回 50000 字符 → 断言 content 长度 ≤ READ_MAX_CHARS + 含「截断」提示
  })

  it('offset/limit 生效：offset=1000&limit=500 只返回该区间', async () => {
    // mock 返回 3000 字符 → execute({ file_path, offset: 1000, limit: 500 })
    // 断言 content 为 [1000, 1500) 区间
  })

  it('offset 超出文件长度：返回空 + 提示', async () => {
    // mock 返回 100 字符 → offset 1000 → 断言提示「已超出文件长度」
  })

  it('正常小文件不受影响（无截断无提示）', async () => {
    // mock 返回 500 字符 → 断言原样返回
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm run test:watch src/services/agent/tools/read-file.tool.test.ts`
Expected: FAIL（无约束/无分页）。

- [ ] **Step 3: 实现**

```ts
// schema properties 追加：
offset: { type: 'number', description: t('tool.readFileOffset') },
limit: { type: 'number', description: t('tool.readFileLimit') },

// 常量：单次注入上限（约 2000 token 的字符量，防止大文件全量进上下文）
const READ_MAX_CHARS = 8000

// execute 内（去重短路之后、读取之前）：
const offset = typeof args.offset === 'number' && args.offset > 0 ? Math.floor(args.offset) : 0
const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : READ_MAX_CHARS

// 读取成功后（去重记录之前）：
const full = String(result.content ?? '')
const truncated = full.length > limit ? full.slice(offset, offset + limit) : full.slice(offset)
const truncatedNotice = full.length > offset + limit
  ? `\n\n${t('tool.readFileTruncated').replace('{total}', String(full.length)).replace('{offset}', String(offset + limit))}`
  : offset > full.length
    ? `\n\n${t('tool.readFileOffsetBeyond')}`
    : ''
const content = truncated + truncatedNotice
```

  ⚠️ 注意与 H2 读去重的交互：offset/limit 读取**不覆盖** readState（分页读取不改变「全量已读」语义）；全量读（无 offset/limit）才写 readState。若 H2 已先实现，此处保持该契约；实现顺序 H2 → H3 时注意。

- [ ] **Step 4: 运行确认通过 + 全量回归**

Run: `pnpm run test && pnpm run typecheck && pnpm run lint`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add src/services/agent/tools/read-file.tool.ts src/services/agent/tools/read-file.tool.test.ts src/shared/locale-data.ts
git commit -F - <<'EOF'
feat: read_file 注入上限 + offset/limit 分页（大文件不全量进上下文）
EOF
```

---

## Self-Review 记录

**Spec 覆盖**：compare 报告 §三.1 → H1（诚实标注：NF 已有未知工具/异常/拒绝的错误隔离骨架，H1 补的是**部分解析失败静默**这一真实缺口）；§三.2 readFileState 三合一 → H2（v1 范围收缩：只做读去重；先读后写/Windows mtime 回退记 deferred，理由：execute 无 context 签名、write 有新建文件场景）；§三.9 两段式估算 → H3（NF 的 estimateTokens 已本地近似，价值点在注入上限 + 分页而非精确计数）。

**占位符扫描**：无 TBD；`READ_MAX_CHARS = 8000` 为初值，实现时可调（注释说明依据）。

**类型一致性**：`clearReadState` 在 H2 定义、agent-store 消费一致；`FILE_UNCHANGED_STUB`/`READ_MAX_CHARS` 单任务内使用；offset/limit 在 H3 schema 与 execute 内一致。

**deferred 记录**（随 ledger）：先读后写硬拒（write 新建场景破坏风险）、Windows mtime 内容回退（需 execute context 签名改造）、readState 会话 id 化（当前模块级 Map + 会话清理钩子，单活跃会话场景足够）。
