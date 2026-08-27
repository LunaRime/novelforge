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
- Produces: `readState` 模块级 Map + `clearReadState(pathKey?: string): void`（导出：无参全清——agent-store 会话切换；带参单键清除——write_file 成功后失效，P0-2）；桩消息常量 `FILE_UNCHANGED_STUB`
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

/** 清空读去重状态：无参全清（会话切换/清空）；带 pathKey 单键清除（write_file 成功后失效，P0-2） */
export function clearReadState(pathKey?: string): void {
  if (pathKey) readState.delete(pathKey)
  else readState.clear()
}

/** 桩消息：文件未变化，不重发全文（省重复注入的 token） */
const FILE_UNCHANGED_STUB = (path: string, len: number): string =>
  `<persisted-output>\n[file_unchanged] ${path} 内容与上次读取一致（${len} 字符），未重新注入全文。若文件已被修改，请先使用 write_file 写入后再读取以获取最新内容。\n</persisted-output>`
```

  execute 中两个读取分支（项目内 :56 / 外部 :43）成功后各加：

```ts
// 读去重：记录状态；重复读同一路径返回桩（不重发全文）
readState.set(pathKey, { content: String(result.content ?? '') })
return { success: true, content: String(result.content ?? '') }
```

  execute 开头（路径解析后）加去重短路：

```ts
// 读去重：同路径已全量读过且内容未变化 → 桩（省重复注入）。
// ⚠️ 仅「无 offset/limit 的全量读」短路（P0-1 修订）：分页/区间读必须真实读文件——
//    桩不含文件内容，若分页读也被短路，LLM 带 offset 重读永远拿不到数据；
//    而 read_file 是只读工具、LLM 无任何途径"先保存后重试"→ 死循环。
//    豁免条件 = !args.offset && !args.limit（H3 的 offset/limit 解析必须先于此处执行）
const state = readState.get(pathKey)
if (state && !args.offset && !args.limit) {
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

- [ ] **Step 5: write_file 成功路径失效缓存（P0-2 修订）**

  write-file.tool.ts 成功返回前加单键清除（write_file 与 read-file.tool 同目录，import 无障碍）：

```ts
// write-file.tool.ts
import { clearReadState } from './read-file.tool'
// ...
const result = await ipc.invoke('fs:write-file', pathCheck.fullPath, content)
if (!result.success) {
  return { success: false, content: '', error: result.error ?? t('tool.writeFileFailed') }
}
// ⚠️ 写盘成功后失效读去重缓存（P0-2）：LLM「写盘 → 重读验证」是 ReAct 常见模式，
//    不清除则重读仍命中桩，LLM 无法确认写入结果
clearReadState(pathCheck.fullPath)  // key 与 read_file 项目内分支的 pathKey（validatePath.fullPath）一致
return { success: true, ... }
```

  测试：`read-file.tool.test.ts` 追加——write 后重复读返回全文（缓存已失效）；write_file 只接受相对路径（validatePath），无外部绝对路径 key，外部分支无需处理。

- [ ] **Step 6: 运行确认通过 + 全量回归**

Run: `pnpm run test && pnpm run typecheck && pnpm run lint`
Expected: 全绿。

- [ ] **Step 7: Commit**

```bash
git add src/services/agent/tools/read-file.tool.ts src/services/agent/tools/read-file.tool.test.ts src/services/agent/tools/write-file.tool.ts src/stores/agent-store.ts src/shared/locale-data.ts
git commit -F - <<'EOF'
feat: read_file 读去重（同路径重复读返回 file_unchanged 桩；offset/limit 分页豁免短路；write_file 成功后失效缓存）
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
- Produces: read_file 新参数 `offset?: number`、`limit?: number`；常量 `READ_MAX_CHARS`（注入上限——⚠️ 数值口径修正（评审）：中文 1 字符 ≈ 0.6-1 token，8000 字符实际 ≈ 5000-8000 token，**非计划初稿声称的 2000-4000**；且引擎侧 `truncateResult(result.content, TOOL_RESULT_MAX_TOKENS)` 800 token 兜底（agent-engine.ts:272）**先于** 8000 字符截断生效——工具层上限必须 ≤ 800 token 量级，截断提示（含 total/分页建议）才能到达 LLM。**取 `READ_MAX_CHARS = 1200` 字符初值**（≈1200 token，截断提示置 content 开头防被引擎截断吞掉），实现时用 `estimateTokens` 实测校准）

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

// 常量：单次注入上限（字符量口径：中文 1 字符 ≈ 0.6-1 token；初值 1200 ≈ 1200 token，
// 必须 ≤ 引擎 800 token 截断线附近——否则截断提示被引擎二次截断吞掉（agent-engine.ts:272）；
// 实现时用 estimateTokens 实测校准）
const READ_MAX_CHARS = 1200

// execute 内（offset/limit 解析在去重短路判断之前——P0-1：短路豁免依赖这两个值）：
const offset = typeof args.offset === 'number' && args.offset > 0 ? Math.floor(args.offset) : 0
const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : READ_MAX_CHARS

// 读取成功后（去重记录之前）：
const full = String(result.content ?? '')
const truncated = full.length > limit ? full.slice(offset, offset + limit) : full.slice(offset)
const truncatedNotice = full.length > offset + limit
  ? `${t('tool.readFileTruncated').replace('{total}', String(full.length)).replace('{offset}', String(offset + limit))}\n\n`
  : offset > full.length
    ? `${t('tool.readFileOffsetBeyond')}\n\n`
    : ''
// ⚠️ 截断提示置于 content 开头（前缀）——truncateToTokenBudget 从头保留，
//    防止引擎 800 token 截断把尾部的分页建议吞掉
const content = truncatedNotice + truncated
```

  ⚠️ 注意与 H2 读去重的交互（**P0-1 闭环**——评审发现原计划只约定了写侧「分页读取不覆盖 readState」，漏了读侧短路豁免，导致分页重读被桩挡住形成死循环。实现顺序 H2 → H3 时必须同时落地）：
  ① offset/limit 读取**不被去重短路命中**——H2 的短路条件必须是 `state && !args.offset && !args.limit`（仅无参全量读短路），offset/limit 解析先于短路判断；
  ② offset/limit 读取**不覆盖** readState（分页读取不改变「全量已读」语义）；
  ③ 全量读（无 offset/limit）才写 readState；
  ④ 若 H2 未实现、H3 单独落地：短路豁免无对象，无影响——但两条契约都属于「去重」行为，建议按 H2 → H3 顺序实现，H2 commit 内含豁免条件（见 H2 Step 3 修订）。

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

**占位符扫描**：无 TBD；`READ_MAX_CHARS = 1200` 为初值（评审口径修正后，实现时用 estimateTokens 实测校准）。

**类型一致性**：`clearReadState` 在 H2 定义、agent-store 消费一致；`FILE_UNCHANGED_STUB`/`READ_MAX_CHARS` 单任务内使用；offset/limit 在 H3 schema 与 execute 内一致。

**deferred 记录**（随 ledger）：先读后写硬拒（write 新建场景破坏风险）、Windows mtime 内容回退（需 execute context 签名改造）、readState 会话 id 化（当前模块级 Map + 会话清理钩子，单活跃会话场景足够）。

## 评审修订记录（2026-08-27 外部评审，代码事实核验 16/16 属实）

**🔴 P0-1｜H2+H3 组合缺陷（桩永久化，LLM 无法绕过）**：H3 的 offset/limit 读取同样命中去重短路（原计划只约定写侧「分页读取不覆盖 readState」，漏了读侧豁免）→ LLM 被桩挡住后无论怎么带 offset 重读都返回桩，而 read_file 是只读工具、LLM 没有任何途径触发"保存"→ 死循环。
**修订（已落地）**：短路条件加 `!args.offset && !args.limit`（仅无参全量读短路）；offset/limit 解析先于短路判断；桩消息文案改为「请先使用 write_file 写入后再读取」（配合 P0-2 闭环）。

**🔴 P0-2｜H2 与 write_file 零交互**：write_file 写入成功后 readState 不清除 → LLM 写盘后重读验证（ReAct 常见模式）仍命中桩，无法确认写入结果。
**修订（已落地）**：`clearReadState(pathKey?)` 支持带参单键清除；write-file.tool.ts 成功路径（IPC 成功后、返回前）调用 `clearReadState(pathCheck.fullPath)`（key 与 read_file 项目内分支一致；write_file 仅相对路径，无外部分支 key）。

**🟡 轻微｜READ_MAX_CHARS 数值口径**：8000 字符对中文实际 ≈ 5000-8000 token（非声称的 2000-4000），且引擎 800 token 截断（agent-engine.ts:272）先于工具层 8000 字符截断生效——截断提示（total/分页建议）永远到不了 LLM。
**修订（已落地）**：READ_MAX_CHARS 初值 8000 → **1200**（≈1200 token，≤ 引擎截断线附近）；截断提示改**前缀**（content 开头）防被引擎二次截断吞掉；实现时用 estimateTokens 实测校准。

**核验补充事实**（实施时参照）：read-file.tool.ts 无状态、schema 仅 file_path、execute 签名 `(args) => ...`（tool-registry.ts:91 接口固定，无 context——模块级 Map 是唯一可行态）；agent-store 三挂钩点 createConversation(:203)/selectConversation(:231)/clearAll(:250) 存在；agent-engine.test.ts 不存在（新建）；tools/ 已有两个 `.tool.test.ts` 先例可照抄基建。
