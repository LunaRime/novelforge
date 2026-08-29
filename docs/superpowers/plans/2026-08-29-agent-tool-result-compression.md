# Agent 工具结果落盘 + 自适应压缩实施计划（D6/D7）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 长工具结果落盘引用（上下文只进摘要）+ 空结果占位注入 + 压缩预算按模型窗口动态化 + 可恢复错误 withhold-then-recover 恢复阶梯（降档压缩 → meta 注入 → 熔断放行）。

**Architecture:** 全部改动集中于 `src/services/agent/agent-engine.ts`（引擎层）+ 一个新主进程写盘通道（`fs:agent-result-write`，fs-controller.ts）+ 调用方 agent-store 注入依赖与模型窗口。引擎保持无 electron 依赖（依赖注入 `AgentEngineDeps`），恢复阶梯为单次调用生命周期的简化状态机。

**Tech Stack:** TypeScript + Zustand + vitest + Electron + better-sqlite3（不受影响）

**Spec:** `docs/superpowers/specs/2026-08-29-agent-tool-result-compression-design.md`（§3=D6、§4=D7、§6=测试计划、§8=决策记录）

## Global Constraints

- ESLint strict（--max-warnings 0）、TypeScript strict（noUnusedLocals/Parameters）
- 所有用户可见文本走 `t()`——三语（zh-CN / en-US / ru-RU），i18n key 随任务分发
- 提交规范：`fix:`/`feat:`/`docs:` 前缀、一个提交一件事
- 行为兼容优先：不改变既有成功路径（正常路径零改动）
- 测试用 vitest；`pnpm run typecheck` / `pnpm run lint` 必须零错误零警告
- 引擎（agent-engine.ts）保持无 electron 依赖——所有外部 IO 走依赖注入
- 设计裁决（详见 spec §8）：写盘阈值 = `TOOL_RESULT_MAX_TOKENS`(800) + 512KB 字符上限；目录 `~/.novelforge/agent-results/`；sha1-12 文件名 + wx 防重；写盘失败回退截断注入；read_file 天然豁免（自身按 800 token 校准）；动态预算 `min(window-4000, 32000)`（窗口 <16k 不适用）；恢复阶梯 3 次封顶；错误白名单收紧

---

### Task D6-1: 空结果占位注入 + 注入确定性锁定

**Files:**
- Modify: `src/services/agent/agent-engine.ts:290-294`（success 分支）
- Modify: `src/shared/locale-data.ts`（engine.* 段，2478 行附近，加 1 个 key）
- Test: `src/services/agent/agent-engine.test.ts`

**Interfaces:**
- Consumes: 既有 `ToolResult` / `truncateResult` / `sanitizeObservation` / `t()`
- Produces: i18n key `engine.emptyToolResult`（`{toolName}` 占位，三语）——Task D6-2 复用同段

- [ ] **Step 1: 在 locale-data.ts 加三语 key**

在 `src/shared/locale-data.ts` 的 engine.* 段（`'engine.modeMax'` 之前）插入：

```ts
  'engine.emptyToolResult': { 'zh-CN': '（{toolName} 已完成，无输出）', 'en-US': '({toolName} completed with no output)', 'ru-RU': '({toolName} завершено без вывода)' },
```

- [ ] **Step 2: 写失败测试（agent-engine.test.ts）**

在 agent-engine.test.ts 的「工具执行与 observation」describe 内追加（参照既有 `runLoopWithResponses` 辅助——responses 按序作为每次 LLM 生成返回值，messagesLog 收集 generateFn 收到的消息副本）：

```ts
describe('空结果占位注入（D6-1）', () => {
  it('成功但内容为空的工具 → observation 注入占位文本而非空壳', async () => {
    const { messagesLog, callbacks } = await runLoopWithResponses([
      `<tool_call>{"name":"empty_tool","arguments":{}}</tool_call>`,
      '最终回复',
    ])
    const lastUser = messagesLog[messagesLog.length - 1].filter(m => m.role === 'user').at(-1)
    expect(lastUser?.content).toContain('empty_tool 已完成，无输出')
    expect(lastUser?.content).not.toContain('<tool_result name="empty_tool">\n\n</tool_result>')
    expect(callbacks.onDone).toHaveBeenCalled()
  })

  it('纯空白内容（含换行/空格）同样注入占位', async () => {
    // 需要一个返回纯空白 content 的工具：用 fake tool 或直接 mock toolRegistry——若 runLoopWithResponses
    // 不支持自定义工具返回，则此用例改为：观察 truncateResult 路径下 trim() === '' 的判定（见实现步骤）
    const { messagesLog } = await runLoopWithResponses([
      `<tool_call>{"name":"empty_tool","arguments":{}}</tool_call>`,
      '最终回复',
    ])
    const lastUser = messagesLog[messagesLog.length - 1].filter(m => m.role === 'user').at(-1)
    expect(lastUser?.content).toContain('已完成，无输出')
  })
})
```

> 若 `runLoopWithResponses` 辅助不支持返回空 content 的工具，实施时在测试顶部自建一个 `{ name: 'empty_tool', execute: async () => ({ success: true, content: '' }) }` 并 `vi.mocked(toolRegistry.get).mockImplementation(...)`（参照本文件既有 mock 手法）。两个用例须都验证「无输出」占位出现。

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm vitest run src/services/agent/agent-engine.test.ts`
Expected: FAIL——observation 仍是空壳，占位文案不存在。

- [ ] **Step 4: 实现空结果占位（agent-engine.ts:290-294）**

```ts
        if (result.success) {
          // 空结果占位（P0-1）：成功但无内容（或纯空白）→ 注入占位文本，防模型把空 <tool_result>
          // 当回合边界停止生成（CC 事故 inc-4586：capybara 对空结果误判 \n\nHuman: 停止序列）
          const content = truncatedContent.trim() === ''
            ? t('engine.emptyToolResult').replace('{toolName}', tc.name)
            : sanitizeObservation(truncatedContent)
          observationParts.push(`<tool_result name="${tc.name}">\n${content}\n</tool_result>`)
        } else {
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm vitest run src/services/agent/agent-engine.test.ts`
Expected: PASS（新增 2 条 + 既有全绿）

- [ ] **Step 6: 门禁 + 提交**

```bash
pnpm run typecheck && pnpm run lint
git add src/services/agent/agent-engine.ts src/services/agent/agent-engine.test.ts src/shared/locale-data.ts
git commit -m "feat: 工具空结果注入占位文本（防模型把空 tool_result 当回合边界停止生成，D6-1）"
```

---

### Task D6-2: 长工具结果写盘引用（fs:agent-result-write 通道 + 引擎依赖注入）

**Files:**
- Modify: `src/services/agent/agent-engine.ts`（常量区 + 类型区 + success 分支 + runAgentLoop 签名）
- Create: `electron/controllers/fs-controller.ts` agent-archive 段后追加通道处理（同文件 Modify）
- Modify: `src/shared/ipc-channels.ts`（fs:* 通道类型定义区）
- Modify: `src/stores/agent-store.ts:756` 调用点（注入 deps）
- Modify: `src/shared/locale-data.ts`（+1 key）
- Test: `src/services/agent/agent-engine.test.ts`

**Interfaces:**
- Consumes: Task D6-1 的 success 分支结构
- Produces:
  - `AgentEngineDeps` 接口：`{ writeResult?: (content: string) => Promise<{ success: boolean; path?: string; error?: string }> }`
  - `AgentEngineOptions` 接口：`{ modelContextWindow?: number }`（本任务仅定义与签名占位，Task D7-1 消费）
  - `runAgentLoop` 新签名尾参：`abortSignal?: AbortSignal, options?: AgentEngineOptions, deps?: AgentEngineDeps`
  - IPC 通道 `fs:agent-result-write`：`invoke('fs:agent-result-write', content: string) → { success: boolean; path?: string; error?: string }`
  - i18n key `engine.resultSpilledToDisk`（`{total}`/`{path}` 占位，三语）

- [ ] **Step 1: locale-data.ts 加 key**

engine.* 段插入：

```ts
  'engine.resultSpilledToDisk': { 'zh-CN': '结果过长: {total} tokens，全文已写入 {path}，如需全文用 read_file 读取', 'en-US': 'Result too long: {total} tokens, full text written to {path}; use read_file to read it if needed', 'ru-RU': 'Результат слишком длинный: {total} токенов, полный текст сохранён в {path}; при необходимости прочитайте его через read_file' },
```

- [ ] **Step 2: ipc-channels.ts 加通道类型**

在 `src/shared/ipc-channels.ts` 的 fs:* 通道定义区（`fs:agent-archive-delete` 附近）追加：

```ts
  /** Agent 长工具结果落盘（P0-1 写盘引用）：主进程 sha1-12 哈希命名 + wx 防重；返回落盘绝对路径 */
  'fs:agent-result-write': {
    request: [content: string]
    response: { success: boolean; path?: string; error?: string }
  },
```

（通道对象的具体字段名对照本文件既有 fs:* 条目的结构——request/response 或类似命名，以既有条目为准）

- [ ] **Step 3: fs-controller.ts 实现通道**

在 `electron/controllers/fs-controller.ts` 的 agent-archive 段（`fs:agent-archive-delete` 之后、函数收尾 `}` 之前）追加：

```ts
  // ===== Agent 长工具结果落盘（~/.novelforge/agent-results/<sha1-12>.txt，P0-1 写盘引用） =====
  // 同内容同哈希同文件（确定性命名 + wx 防重 = 决策冻结）；文件保留（rewind/fork/存档重放需引用仍在）
  ipcMain.handle('fs:agent-result-write', async (_e, content: unknown): Promise<{ success: boolean; path?: string; error?: string }> => {
    try {
      const text = typeof content === 'string' ? content : String(content ?? '')
      const dir = path.join(VELA_HOME, 'agent-results')
      await fsPromises.mkdir(dir, { recursive: true })
      const hash = createHash('sha1').update(text).digest('hex').slice(0, 12)
      const target = path.join(dir, `${hash}.txt`)
      try {
        await fsPromises.writeFile(target, text, { encoding: 'utf-8', flag: 'wx' })
      } catch (error) {
        // EEXIST = 同内容已落盘（同哈希）→ 幂等成功；其他错误上抛
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
      return { success: true, path: target }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })
```

文件头部 import 补 `createHash`（`node:crypto`）：`import { createHash } from 'node:crypto'`（检查既有 import 是否已有 node:crypto，有则合并）。

- [ ] **Step 4: 引擎常量 + 类型 + 签名（agent-engine.ts）**

常量区（`TOOL_RESULT_MAX_TOKENS` 之后）追加：

```ts
/** 写盘引用摘要上限（tokens）——路径+摘要合计 ≤ ~250 tokens，远小于 800 截断注入 */
const RESULT_SUMMARY_MAX_TOKENS = 200
/** 写盘内容上限（字符）——超出回退截断注入（read_file 再读受 fs:read-external-file 1MB 限制） */
const MAX_SPILL_CHARS = 512 * 1024
```

类型区（`AgentEngineCallbacks` 之后）追加：

```ts
/** 引擎依赖注入（保持 agent-engine 无 electron 依赖可单测；agent-store 注入真实 IPC 实现） */
export interface AgentEngineDeps {
  /** 长工具结果写盘（>800 tokens 落盘引用；失败返回 success:false 时引擎回退截断注入） */
  writeResult?: (content: string) => Promise<{ success: boolean; path?: string; error?: string }>
}

/** Agent 引擎选项（D6/D7：动态压缩预算等） */
export interface AgentEngineOptions {
  /** 模型上下文窗口（tokens，来自 ModelProfile.maxTokens）；用于动态压缩预算（Task D7-1 消费） */
  modelContextWindow?: number
}
```

`runAgentLoop` 签名（:98-106）追加尾参：

```ts
export async function runAgentLoop(
  systemPrompt: string,
  historyMessages: LLMMessage[],
  userMessage: string,
  modelId: string,
  generateFn: LLMGenerateFn,
  callbacks: AgentEngineCallbacks,
  abortSignal?: AbortSignal,
  options?: AgentEngineOptions,
  deps?: AgentEngineDeps,
): Promise<void> {
```

- [ ] **Step 5: 引擎 success 分支接写盘（替换 Task D6-1 的 success 分支）**

```ts
        if (result.success) {
          // 长结果写盘引用（P0-1）：原始内容 > 注入上限且 ≤ 512KB → 全文落盘，
          // 上下文只进「路径 + 摘要」，LLM 按需用 read_file 再读（绝对路径分支）。
          // read_file 工具天然豁免：自身按引擎截断线校准（READ_MAX_CHARS=440），结果永不超限。
          const rawContent = result.content ?? ''
          const shouldSpill = estimateTokens(rawContent) > TOOL_RESULT_MAX_TOKENS && rawContent.length <= MAX_SPILL_CHARS
          if (shouldSpill && deps?.writeResult) {
            const writeRes = await deps.writeResult(rawContent)
            if (writeRes.success && writeRes.path) {
              const summary = truncateToTokenBudget(rawContent, RESULT_SUMMARY_MAX_TOKENS)
              observationParts.push(`<tool_result name="${tc.name}">\n${t('engine.resultSpilledToDisk').replace('{total}', String(estimateTokens(rawContent))).replace('{path}', writeRes.path)}\n\n${sanitizeObservation(summary)}\n</tool_result>`)
            } else {
              observationParts.push(`<tool_result name="${tc.name}">\n${sanitizeObservation(truncatedContent)}\n</tool_result>`)
            }
          } else {
            const content = truncatedContent.trim() === ''
              ? t('engine.emptyToolResult').replace('{toolName}', tc.name)
              : sanitizeObservation(truncatedContent)
            observationParts.push(`<tool_result name="${tc.name}">\n${content}\n</tool_result>`)
          }
        } else {
```

import 补 `truncateToTokenBudget`（token-budget 既有 import `estimateTokens, truncateToTokenBudget`——检查 :18 是否已含，未含则追加）。

- [ ] **Step 6: agent-store.ts 调用点注入 deps**

`src/stores/agent-store.ts:756` 的 `runAgentLoop(...)` 调用：

```ts
      // 引擎依赖注入（P0-1 写盘引用）：真实 IPC 实现；失败回退由引擎降级（截断注入）
      const agentDeps: AgentEngineDeps = {
        writeResult: async (content) => {
          try {
            const res = await (window as unknown as { velaAPI: { invoke: (ch: string, ...args: unknown[]) => Promise<{ success: boolean; path?: string; error?: string }> } }).velaAPI.invoke('fs:agent-result-write', content)
            return res
          } catch {
            return { success: false, error: 'fs:agent-result-write unavailable' }
          }
        },
      }
      await runAgentLoop(
        systemPrompt,
        historyMessages,
        enrichedUserMessage,
        modelId,
        generateFn,
        { /* 既有 callbacks 对象原样 */ },
        abortController.signal,
        undefined, // options：Task D7-1 接入 modelContextWindow
        agentDeps,
      )
```

import 补 `type AgentEngineDeps`（agent-store.ts:5 既有 `runAgentLoop` import 处合并）。

- [ ] **Step 7: 写失败测试（agent-engine.test.ts，D6-2 describe）**

```ts
describe('长结果写盘引用（D6-2）', () => {
  const longContent = '中'.repeat(1200) // 中文 1.5 token/字 ≈ 1800 tokens > 800
  const writeResultMock = vi.fn(async (content: string) => ({ success: true, path: `C:\\Users\\test\\.novelforge\\agent-results\\abc123.txt` }))

  it('>800 token 结果 → 写盘 + 注入路径/摘要/总数', async () => {
    const { messagesLog } = await runLoopWithResponses(
      [`<tool_call>{"name":"long_tool","arguments":{}}</tool_call>`, '最终回复'],
      { writeResult: writeResultMock }, // runLoopWithResponses 需扩展支持第三参 deps——实施时修改辅助签名
    )
    expect(writeResultMock).toHaveBeenCalledWith(longContent)
    const lastUser = messagesLog[messagesLog.length - 1].filter(m => m.role === 'user').at(-1)
    expect(lastUser?.content).toContain('已写入') // engine.resultSpilledToDisk 中文文案
    expect(lastUser?.content).toContain('abc123.txt')
    expect(lastUser?.content).not.toContain(longContent.slice(0, 500)) // 全文不进上下文
  })

  it('≤800 token 结果 → 不写盘，原样注入', async () => {
    const spy = vi.fn(async () => ({ success: false }))
    const { messagesLog } = await runLoopWithResponses(
      [`<tool_call>{"name":"short_tool","arguments":{}}</tool_call>`, '最终回复'],
      { writeResult: spy },
    )
    expect(spy).not.toHaveBeenCalled()
    const lastUser = messagesLog[messagesLog.length - 1].filter(m => m.role === 'user').at(-1)
    expect(lastUser?.content).toContain('short_tool')
  })

  it('写盘失败 → 回退截断注入（降级路径）', async () => {
    const failMock = vi.fn(async () => ({ success: false, error: 'disk full' }))
    const { messagesLog } = await runLoopWithResponses(
      [`<tool_call>{"name":"long_tool","arguments":{}}</tool_call>`, '最终回复'],
      { writeResult: failMock },
    )
    const lastUser = messagesLog[messagesLog.length - 1].filter(m => m.role === 'user').at(-1)
    expect(lastUser?.content).toContain('<tool_result') // 截断注入形态
  })

  it('未注入 deps → 行为兼容（截断注入）', async () => {
    const { messagesLog } = await runLoopWithResponses(
      [`<tool_call>{"name":"long_tool","arguments":{}}</tool_call>`, '最终回复'],
    )
    const lastUser = messagesLog[messagesLog.length - 1].filter(m => m.role === 'user').at(-1)
    expect(lastUser?.content).toContain('<tool_result')
  })

  it('同内容两次 → 写盘调用 content 相同（决策冻结确定性）', async () => {
    // 独立 spy：避免共享 writeResultMock 的调用计数被同 describe 其他用例污染
    const spy = vi.fn(async (content: string) => ({ success: true, path: 'C:\\Users\\test\\.novelforge\\agent-results\\abc123.txt' }))
    const { messagesLog } = await runLoopWithResponses(
      [
        `<tool_call>{"name":"long_tool","arguments":{}}</tool_call>`,
        `<tool_call>{"name":"long_tool","arguments":{}}</tool_call>`,
        '最终回复',
      ],
      { writeResult: spy },
    )
    expect(spy).toHaveBeenCalledTimes(2)
    const [first, second] = spy.mock.calls.map(c => c[0])
    expect(first).toBe(second)
  })
})
```

> 辅助 `runLoopWithResponses` 需扩展第三参 `deps` 传入 `runAgentLoop`（既有辅助只传 6 参——实施时补 `undefined, deps`）。长工具需注册（顶部自建 `{ name: 'long_tool', execute: async () => ({ success: true, content: longContent }) }`，mock toolRegistry.get）。文案断言用中文「已写入」即可（t() 默认 zh-CN；如测试环境 locale 非 zh 则改断言 key 相关英文——以本文件既有断言风格为准）。

- [ ] **Step 8: 运行测试确认失败 → 实现 → 确认通过**

Run: `pnpm vitest run src/services/agent/agent-engine.test.ts`
Expected: 先 FAIL（辅助不支持 deps）→ 按 Step 7 说明补齐辅助与 mock → PASS

- [ ] **Step 9: 门禁 + 提交**

```bash
pnpm run typecheck && pnpm run lint && pnpm run test
git add src/services/agent/agent-engine.ts src/services/agent/agent-engine.test.ts src/shared/ipc-channels.ts src/shared/locale-data.ts electron/controllers/fs-controller.ts src/stores/agent-store.ts
git commit -m "feat: 长工具结果写盘引用——fs:agent-result-write 通道 + 引擎依赖注入（P0-1，D6-2）"
```

---

### Task D7-1: 动态压缩预算 + isRecoverableError + withhold-then-recover 恢复阶梯

**Files:**
- Modify: `src/services/agent/agent-engine.ts`（常量区 + 工具函数区 + runAgentLoop 循环内）
- Modify: `src/stores/agent-store.ts:756` 调用点（传 options）
- Modify: `src/shared/locale-data.ts`（+1 key）
- Test: `src/services/agent/agent-engine.test.ts`

**Interfaces:**
- Consumes: Task D6-2 的 `AgentEngineOptions.modelContextWindow`、`runAgentLoop` 签名、`compressMessagesToBudget`
- Produces:
  - `computeMessageBudget(modelContextWindow?: number): number`（导出纯函数）
  - `isRecoverableError(message: string): boolean`（导出纯函数）
  - i18n key `engine.resumeDirectly`（三语）

- [ ] **Step 1: locale-data.ts 加 key**

engine.* 段插入：

```ts
  'engine.resumeDirectly': { 'zh-CN': '请直接从上次中断处继续，无需道歉或复述。', 'en-US': 'Resume directly from where you left off. No apology, no recap.', 'ru-RU': 'Продолжайте сразу с того места, где остановились. Без извинений и повторений.' },
```

- [ ] **Step 2: 常量改造（agent-engine.ts）**

删除 `const MESSAGE_BUDGET_TOKENS = 16_000`（:36），替换为：

```ts
/** 默认消息压缩预算（无模型窗口信息 / 小窗口模型）——与既有行为一致 */
const DEFAULT_MESSAGE_BUDGET_TOKENS = 16_000
/** 动态预算工程上限（128k 窗口模型也不无限放大——成本/延迟裁决） */
const MAX_MESSAGE_BUDGET_TOKENS = 32_000
/** 动态预算输出空间预留（对话单次输出通常 <2k，4k 保守） */
const OUTPUT_RESERVE_TOKENS = 4_000
/** 启用动态预算的最小模型窗口（小窗口模型压缩语义不变——压缩是成本控制非防超窗） */
const MIN_DYNAMIC_WINDOW_TOKENS = 16_000
/** 恢复阶梯降档预算下限（对话质量底线） */
const MIN_RECOVERY_BUDGET_TOKENS = 8_000
/** 连续可恢复失败熔断阈值（CC 遥测 MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES=3 简化） */
const MAX_CONSECUTIVE_RECOVERY_FAILURES = 3
```

- [ ] **Step 3: 两个纯函数（agent-engine.ts 工具函数区，compressMessagesToBudget 之前）**

```ts
/**
 * 按模型窗口计算消息压缩预算（P0-2 动态化）：
 * 无窗口 / 窗口 < 16k → 默认 16_000（现状不变）；否则 min(窗口 - 4k 预留, 32k 工程上限)。
 */
export function computeMessageBudget(modelContextWindow?: number): number {
  if (!modelContextWindow || modelContextWindow < MIN_DYNAMIC_WINDOW_TOKENS) return DEFAULT_MESSAGE_BUDGET_TOKENS
  return Math.min(modelContextWindow - OUTPUT_RESERVE_TOKENS, MAX_MESSAGE_BUDGET_TOKENS)
}

/** 可恢复错误识别（上下文超限类——压缩后重试真实有效；白名单收紧防误判烧钱）。 */
const RECOVERABLE_ERROR_PATTERNS: RegExp[] = [
  /context length/i,
  /maximum context/i,
  /context window/i,
  /too many tokens/i,
  /token limit/i,
  /context_length_exceeded/i,
  /\b413\b/,
  /request entity too large/i,
  /上下文长度/,
  /超(出|过).{0,4}(上限|限制|长度)/,
  /长度.{0,4}(超|超过)/,
]

export function isRecoverableError(message: string): boolean {
  return RECOVERABLE_ERROR_PATTERNS.some(p => p.test(message))
}
```

- [ ] **Step 4: runAgentLoop 恢复阶梯状态 + 调用点改造**

循环前（`let rounds = 0` 附近）追加：

```ts
  // 恢复阶梯状态（withhold-then-recover，P0-2）：可恢复错误先恢复后放行；
  // 单次调用生命周期（跨调用持久化 deferred）；重试消耗 rounds 计数（最多 3 round，MAX=8 仍剩 5 轮工具循环）
  type RecoveryStage = 'none' | 'compacting' | 'meta-injected'
  let recoveryStage: RecoveryStage = 'none'
  let consecutiveRecoveryFailures = 0
  let currentBudget = computeMessageBudget(options?.modelContextWindow)
```

循环内 `:135` 替换：

```ts
    const budgetedMessages = compressMessagesToBudget(messages, currentBudget)
```
（改为 `const` → `let` 声明在调用点：`let budgetedMessages = compressMessagesToBudget(messages, currentBudget)`——保持每轮发送前按当前预算压缩）

generateFn 调用 + catch（:138-151）替换：

```ts
    try {
      llmResponse = await generateFn(budgetedMessages, modelId, (chunk) => {
        streamed = true
        callbacks.onTextChunk(chunk)
      })
      // 调用成功：恢复计数清零、预算复原（下次调用生效）
      consecutiveRecoveryFailures = 0
      recoveryStage = 'none'
      currentBudget = computeMessageBudget(options?.modelContextWindow)
    } catch (error) {
      // 取消导致的生成中断走"已停止"而不是错误提示
      if (abortSignal?.aborted) {
        callbacks.onDone(fullAssistantText + '\n\n_' + t('agent.stoppedGenerating') + '_', allToolCalls, allArtifacts)
        return
      }
      // 可恢复错误（上下文超限类）→ withhold-then-recover：降档压缩 → meta 注入 → 熔断放行。
      // 非可恢复错误直接放行（无额外调用 = 无额外费用）。
      const errText = String(error)
      if (isRecoverableError(errText) && consecutiveRecoveryFailures < MAX_CONSECUTIVE_RECOVERY_FAILURES) {
        consecutiveRecoveryFailures++
        if (recoveryStage === 'none') {
          recoveryStage = 'compacting'
          console.warn(`[AgentEngine] 恢复重试 compacting（失败 ${consecutiveRecoveryFailures}/${MAX_CONSECUTIVE_RECOVERY_FAILURES}）：${errText}`)
        } else if (recoveryStage === 'compacting') {
          recoveryStage = 'meta-injected'
          messages.push({ role: 'user', content: t('engine.resumeDirectly') })
          console.warn(`[AgentEngine] 恢复重试 meta-injected（失败 ${consecutiveRecoveryFailures}/${MAX_CONSECUTIVE_RECOVERY_FAILURES}）：${errText}`)
        }
        // 降档压缩重试（决策冻结：压缩只从尾部加深截断，前缀稳定）
        currentBudget = Math.max(MIN_RECOVERY_BUDGET_TOKENS, Math.floor(currentBudget / 2))
        budgetedMessages = compressMessagesToBudget(messages, currentBudget)
        continue
      }
      callbacks.onError(t('agent.llmCallFailed').replace('{error}', errText))
      return
    }
```

- [ ] **Step 5: agent-store.ts 传 options**

`runAgentLoop` 调用（Task D6-2 已传 `undefined, agentDeps`）改 `undefined` 为：

```ts
        { modelContextWindow: llmStore.models.find(m => m.id === modelId)?.maxTokens },
```

> `llmStore` 引用方式以 agent-store.ts 既有用法为准（:686 已有 `llmStore.models.find(...)` 同款）。

- [ ] **Step 6: 写失败测试（agent-engine.test.ts，D7-1 describe）**

```ts
describe('动态预算与恢复阶梯（D7-1）', () => {
  it('computeMessageBudget：窗口 32000 → 28000', () => {
    expect(computeMessageBudget(32_000)).toBe(28_000)
  })
  it('computeMessageBudget：窗口 131072 → 32000（工程上限）', () => {
    expect(computeMessageBudget(131_072)).toBe(32_000)
  })
  it('computeMessageBudget：窗口 8000（小窗口）→ 默认 16000', () => {
    expect(computeMessageBudget(8_000)).toBe(16_000)
  })
  it('computeMessageBudget：undefined → 默认 16000', () => {
    expect(computeMessageBudget(undefined)).toBe(16_000)
  })
  it('isRecoverableError：英文上下文类 → true', () => {
    expect(isRecoverableError('This model\'s maximum context length is 32768 tokens')).toBe(true)
    expect(isRecoverableError('Request failed with status code 413')).toBe(true)
  })
  it('isRecoverableError：中文上下文类 → true', () => {
    expect(isRecoverableError('上下文长度超出限制')).toBe(true)
    expect(isRecoverableError('输入超过模型长度上限')).toBe(true)
  })
  it('isRecoverableError：非上下文错误 → false', () => {
    expect(isRecoverableError('Invalid API key provided')).toBe(false)
    expect(isRecoverableError('Connection refused')).toBe(false)
    expect(isRecoverableError('429 Too Many Requests')).toBe(false)
  })

  it('失败 1 次（上下文错误）→ 降档压缩重试成功，共调用 2 次', async () => {
    let calls = 0
    const generateFn = vi.fn(async (messages: LLMMessage[]): Promise<string> => {
      calls++
      if (calls === 1) throw new Error('maximum context length exceeded')
      return '最终回复'
    })
    const callbacks = createCallbacks() // 复用既有辅助
    await runAgentLoop('system', [], '用户消息', 'test-model', generateFn, callbacks, undefined, { modelContextWindow: 32_000 })
    expect(generateFn).toHaveBeenCalledTimes(2)
    expect(callbacks.onError).not.toHaveBeenCalled()
    // 第二次调用的消息预算 ≤ 降档预算（min(28000/2=14000, 8000 下限)=14000）——断言第二次调用消息 token 总和 < 第一次
    const t1 = sumTokens(generateFn.mock.calls[0][0])
    const t2 = sumTokens(generateFn.mock.calls[1][0])
    expect(t2).toBeLessThanOrEqual(t1)
  })

  it('失败 2 次 → meta 消息注入后成功（调用 3 次，第 3 次含 resumeDirectly 文案）', async () => {
    let calls = 0
    const generateFn = vi.fn(async (): Promise<string> => {
      calls++
      if (calls <= 2) throw new Error('too many tokens')
      return '最终回复'
    })
    const callbacks = createCallbacks()
    await runAgentLoop('system', [], '用户消息', 'test-model', generateFn, callbacks, undefined, { modelContextWindow: 32_000 })
    expect(generateFn).toHaveBeenCalledTimes(3)
    const third = generateFn.mock.calls[2][0]
    expect(third.some(m => m.role === 'user' && m.content.includes('请直接从上次中断处继续'))).toBe(true)
  })

  it('失败 3 次 → 熔断放行 onError（调用 3 次不再重试）', async () => {
    const generateFn = vi.fn(async (): Promise<string> => {
      throw new Error('context window exceeded')
    })
    const callbacks = createCallbacks()
    await runAgentLoop('system', [], '用户消息', 'test-model', generateFn, callbacks, undefined, { modelContextWindow: 32_000 })
    expect(generateFn).toHaveBeenCalledTimes(3) // 初始 1 + 重试 2，第 3 次失败后熔断
    expect(callbacks.onError).toHaveBeenCalledTimes(1)
  })

  it('非可恢复错误 → 直接放行，不重试', async () => {
    const generateFn = vi.fn(async (): Promise<string> => {
      throw new Error('Invalid API key')
    })
    const callbacks = createCallbacks()
    await runAgentLoop('system', [], '用户消息', 'test-model', generateFn, callbacks, undefined, { modelContextWindow: 32_000 })
    expect(generateFn).toHaveBeenCalledTimes(1)
    expect(callbacks.onError).toHaveBeenCalledTimes(1)
  })
})
```

> 辅助：`sumTokens = (msgs: LLMMessage[]) => msgs.reduce((s, m) => s + estimateTokens(m.content), 0)`（import 自 token-budget）；`createCallbacks` 若不存在于既有辅助则自建（onTextChunk/onToolCallStart/onToolCallComplete/onToolCallConfirmRequired/onDone/onError 全 vi.fn）。恢复阶梯测试需保证循环在 tool-less 回复处正常结束（'最终回复' 无 tool_call → onDone）。

- [ ] **Step 7: 运行测试确认失败 → 实现 → 确认通过**

Run: `pnpm vitest run src/services/agent/agent-engine.test.ts`
Expected: 先 FAIL（computeMessageBudget/isRecoverableError 未导出、阶梯未实现）→ PASS

- [ ] **Step 8: 全量回归 + 门禁 + 提交**

```bash
pnpm run typecheck && pnpm run lint && pnpm run test
git add src/services/agent/agent-engine.ts src/services/agent/agent-engine.test.ts src/shared/locale-data.ts src/stores/agent-store.ts
git commit -m "feat: 压缩预算按模型窗口动态化 + 可恢复错误 withhold-then-recover 恢复阶梯（P0-2，D7-1）"
```

---

### Task D7-2: 全量门禁 + 测试补强收尾

**Files:**
- Test: 全量测试（含 agent-engine.test.ts 回归）
- 若门禁发现缺口（如 D6-2 512KB 上限路径未测、read_file 豁免注释缺失）→ 补小用例/注释
- Docs: `.superpowers/sdd/2026-08-29-agent-tool-result-compression/progress.md`（ledger 创建或由 SDD 流程处理）

**Interfaces:**
- Consumes: D6-1/D6-2/D7-1 全部交付

- [ ] **Step 1: 全量门禁**

```bash
pnpm run typecheck && pnpm run lint && pnpm run test
```

Expected: 零错误零警告，全量测试绿（现状 826 基线 + 新增）。

- [ ] **Step 2: 补强检查（三选一，按实际情况）**

- 若 D6-2 的 512KB 超限回退路径未覆盖 → 补 1 条用例（content length > 524288 的假内容走 mock——用 `'x'.repeat(524_289)`）
- 若 read_file 豁免无注释 → 在 agent-engine.ts shouldSpill 判定处补注释（计划代码已含，确认在）
- 若「压缩确定性（不同预算前部一致）」未覆盖 → 补 1 条纯函数测试：`compressMessagesToBudget`（导出或经 computeMessageBudget 间接触发）同输入不同预算 → 前部保留集合一致

- [ ] **Step 3: 提交（若有代码变更）**

```bash
git add <变更文件>
git commit -m "test: D6/D7 测试补强（512KB 上限回退/压缩确定性）"
```

无变更则跳过本步。

## Self-Review 记录

**Spec 覆盖检查**：
- §3.1 空结果注入 → D6-1 ✓
- §3.2 写盘引用（阈值/格式/目录/通道/依赖注入/生命周期/豁免/512KB 上限）→ D6-2（生命周期「不删除」是常量注释层面的设计，无代码；孤儿清理 deferred 明确不实现）✓
- §3.3 决策冻结 → D6-2 测试「同内容两次 → 相同 content」+ D7-1 恢复阶梯注释（前缀稳定）✓
- §4.1 动态预算 → D7-1（公式/下限/上限/小窗口不变，4 条测试）✓
- §4.2 错误识别 → D7-1（isRecoverableError + 正反测试）✓
- §4.3 恢复阶梯 → D7-1（降档 → meta → 熔断，3 条路径测试）✓
- §4.4 熔断 → D7-1 ✓
- §4.6 显式 transition → D7-1（stage 三态 + 命名日志）✓
- §6 测试计划 → 全部映射（D6 空结果 2 条、写盘 5 条、D7 预算 4 条、错误识别 7 条、阶梯 4 条）✓
- 行为兼容：既有测试全量回归在 D7-1 Step 8 / D7-2 Step 1 ✓

**Placeholder 扫描**：无 TBD/TODO；所有测试与实现代码均给出。测试辅助的适配说明以「实施时」措辞标注——属真实变体说明（runLoopWithResponses 既有签名以本文件现状为准），非占位符。

**类型一致性**：`AgentEngineDeps.writeResult(content) → { success, path?, error? }` 在 D6-2 Step 4/5/6 与测试 Step 7 一致；`AgentEngineOptions.modelContextWindow` 在 D6-2 定义、D7-1 Step 5 消费；`computeMessageBudget`/`isRecoverableError` 导出名在实现与测试一致；i18n key 三处命名（emptyToolResult/resultSpilledToDisk/resumeDirectly）与 spec §3.1/§3.2.2/§4.3 一致。runAgentLoop 签名 9 参（6 必选 + abortSignal/options/deps 3 可选）在 D6-2 一次到位，D7-1 只消费不改签名 ✓。
