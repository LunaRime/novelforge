# Agent 意图预路由实施计划（对话即生成小说，阶段 A）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 输入「写第三章」「润色第2章」「生成大纲」等自然语言时，本地意图识别（零 LLM 成本）确定性触发创作工作流，未命中/弱命中回落 ReAct 循环或澄清追问。

**Architecture:** 三件套——① 新 `writing-intent.ts`（模式库纯函数，本地正则+实体提取）② 新 `workflow-starter.ts`（从 start-workflow.tool.ts 提取工作流构建逻辑，统一 throw 错误 key）③ `sendMessage` 接线（/命令、@提及未命中后插入意图预路由，强命中直接触发、弱命中澄清、未命中原样 ReAct）。

**Tech Stack:** TypeScript + Zustand + vitest + 现有 workflow-store / ipc 通道

**Spec:** `docs/superpowers/specs/2026-08-26-agent-conversation-upgrade-design.md` §4

## Global Constraints

- ESLint strict（--max-warnings 0）、TypeScript strict（noUnusedLocals/Parameters）
- 所有用户可见文本走 `t()`——新增键集中在 `agent.*`，先查 locale-data.ts 是否已有可用键（tool.workflowStarted 已存在，复用）
- 提交规范：`feat:`/`fix:` 前缀、一个提交一件事、`git commit -F - <<'EOF'` 消息文件
- 不引入新依赖（纯本地正则路由，禁止加 LLM 调用）
- 测试用 vitest，仓库无 @testing-library/react——用 createRoot + act 模式（参照 AgentMessage.test.tsx）

---

### Task A1: writing-intent.ts 模式库

**Files:**
- Create: `src/services/agent/writing-intent.ts`
- Test: `src/services/agent/writing-intent.test.ts`

**Interfaces:**
- Produces: `WritingIntent` 判别联合 + `detectWritingIntent(input: string): WritingIntent`（纯同步函数，零 I/O）

**设计**（与 spec §4.2 一致，判定原则 = 执行成本/破坏性；查询类不预路由）：

```ts
export type WritingIntent =
  | { kind: 'chapter_creation'; chapter: number | { from: number; to: number } | null }
  | { kind: 'refine'; chapter: number | null }
  | { kind: 'character'; name: string; action: 'create' | 'update' }
  | { kind: 'architecture'; target: 'blueprint' | 'architecture' }
  | { kind: 'ambiguous'; hint: string }
  | { kind: 'none' }
```

- [ ] **Step 1: 写失败测试（命中表）**

```ts
// src/services/agent/writing-intent.test.ts
import { describe, it, expect } from 'vitest'
import { detectWritingIntent } from './writing-intent'

describe('detectWritingIntent 命中表', () => {
  it('写第三章 → chapter_creation(3)', () => {
    expect(detectWritingIntent('帮我写第三章')).toEqual({ kind: 'chapter_creation', chapter: 3 })
  })
  it('创作 5-8 章 → chapter_creation(range)', () => {
    expect(detectWritingIntent('创作 5-8 章')).toEqual({ kind: 'chapter_creation', chapter: { from: 5, to: 8 } })
  })
  it('写 → ambiguous（缺章号，hint 提示）', () => {
    const r = detectWritingIntent('帮我写')
    expect(r.kind).toBe('ambiguous')
  })
  it('润色第2章 → refine(2)', () => {
    expect(detectWritingIntent('把第2章润色一下')).toEqual({ kind: 'refine', chapter: 2 })
  })
  it('修改这段 → refine(null)', () => {
    expect(detectWritingIntent('修改这段文字')).toEqual({ kind: 'refine', chapter: null })
  })
  it('创建一个叫苏晚晴的角色 → character(苏晚晴, create)', () => {
    expect(detectWritingIntent('创建一个叫苏晚晴的角色')).toEqual({ kind: 'character', name: '苏晚晴', action: 'create' })
  })
  it('修改苏晚晴的角色设定 → character(苏晚晴, update)', () => {
    expect(detectWritingIntent('修改苏晚晴的角色设定')).toEqual({ kind: 'character', name: '苏晚晴', action: 'update' })
  })
  it('生成大纲 → architecture(blueprint)', () => {
    expect(detectWritingIntent('生成大纲')).toEqual({ kind: 'architecture', target: 'blueprint' })
  })
  it('重新规划剧情 → architecture(architecture)', () => {
    expect(detectWritingIntent('重新规划剧情')).toEqual({ kind: 'architecture', target: 'architecture' })
  })
  it('纯聊天 → none（查询类不预路由）', () => {
    expect(detectWritingIntent('苏晚晴的性格是什么')).toEqual({ kind: 'none' })
  })
  it('带 @提及的消息 → none（@由既有链路处理，预路由不抢）', () => {
    expect(detectWritingIntent('@故事架构 帮我看看')).toEqual({ kind: 'none' })
  })
  it('第二十章 → chapter_creation(20)；二十章 → 20（十位组合，评审覆盖缺口修订）', () => {
    expect(detectWritingIntent('帮我写第二十章')).toEqual({ kind: 'chapter_creation', chapter: 20 })
    expect(detectWritingIntent('写二十章')).toEqual({ kind: 'chapter_creation', chapter: 20 })
  })
  it('「第 3 章」带空格 → chapter_creation(3)（空格容忍，评审覆盖缺口修订）', () => {
    expect(detectWritingIntent('帮我写第 3 章')).toEqual({ kind: 'chapter_creation', chapter: 3 })
  })
  it('「创建角色」无名字 → ambiguous（澄清而非静默 none，评审覆盖缺口修订）', () => {
    expect(detectWritingIntent('创建角色')).toMatchObject({ kind: 'ambiguous' })
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm run test:watch src/services/agent/writing-intent.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// src/services/agent/writing-intent.ts
/**
 * 意图预路由（阶段 A）——本地零 LLM 成本的自然语言意图识别。
 * 判定原则：只拦截「执行成本/破坏性」高的意图（写稿/修稿/角色/大纲——都会触发工作流或写库）；
 * 查询类（文风/设定/聊天）不预路由，留给 ReAct 兜底。
 */

export type WritingIntent =
  | { kind: 'chapter_creation'; chapter: number | { from: number; to: number } | null }
  | { kind: 'refine'; chapter: number | null }
  | { kind: 'character'; name: string; action: 'create' | 'update' }
  | { kind: 'architecture'; target: 'blueprint' | 'architecture' }
  | { kind: 'ambiguous'; hint: string }
  | { kind: 'none' }

/** 章节号：阿拉伯/中文数字「第3章」「第三章」；支持 1-99（十位组合——评审覆盖缺口修订：原 1-10 与十一~十九，10-99 全缺） */
const CN_DIGIT: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const CN_TENS: Record<string, number> = { 十: 10, 二十: 20, 三十: 30, 四十: 40, 五十: 50, 六十: 60, 七十: 70, 八十: 80, 九十: 90 }
function parseChapterNum(s: string): number | null {
  const a = parseInt(s, 10)
  if (!Number.isNaN(a) && a > 0) return a
  if (s in CN_DIGIT) return CN_DIGIT[s]               // 一~九
  if (s in CN_TENS) return CN_TENS[s]                 // 十/二十~九十
  const m = s.match(/^([一二三四五六七八九]?)(十)([一二三四五六七八九]?)$/)
  if (m) {
    const tens = m[1] ? CN_DIGIT[m[1]] : 0            // 十一~十九（无十位）→ 10 + 个位；二十一~九十九 → 十位×10 + 个位
    return (tens ? tens * 10 : 10) + (m[3] ? CN_DIGIT[m[3]] : 0)
  }
  return null
}

export function detectWritingIntent(input: string): WritingIntent {
  // @提及由既有链路处理（parseMentions），预路由不抢
  if (input.includes('@')) return { kind: 'none' }

  // ==== 角色（先判定——角色名可能与写稿动词共现） ====
  // 评审覆盖缺口修订：「创建角色」无名字（原名捕获组需 1-10 字）→ ambiguous 澄清，不再静默 none
  const charCreate = input.match(/(?:创建|新建|添加|新增)(?:一个|一位|个)?(?:叫|名为|叫做)?\s*([^\s，。！？；：、（）《》【】·—""'']{1,10})\s*(?:的)?角色/)
  if (charCreate) return { kind: 'character', name: charCreate[1].trim(), action: 'create' }
  if (/(?:创建|新建|添加|新增).{0,4}角色/.test(input)) return { kind: 'ambiguous', hint: 'character' }
  const charUpdate = input.match(/(?:修改|更新|改一下|调整)(?:下)?\s*([^\s，。！？；：、（）《》【】·—""'']{1,10})\s*(?:的)?(?:角色|人设|设定)/)
  if (charUpdate) return { kind: 'character', name: charUpdate[1].trim(), action: 'update' }

  // ==== 大纲/架构 ====
  if (/(?:生成|重新|创建|帮我)?\s*(?:大纲|蓝图)/.test(input)) return { kind: 'architecture', target: 'blueprint' }
  if (/(?:重新)?\s*(?:规划|设计|搭建|写)\s*(?:剧情|架构|世界观|剧情架构)/.test(input)) return { kind: 'architecture', target: 'architecture' }

  // ==== 修稿 ====
  // 第 与 数字 之间允许空格（评审覆盖缺口修订：「润色第 2 章」此前退化成 refine(null)）
  const refineM = input.match(/(?:润色|修改|改写|打磨|优化|修(?:一下|改)?)(?:第?\s*(\d+|[一二三四五六七八九十]+)\s*章?|这段|这段文字|这一段)?/)
  if (/(?:润色|修改|改写|打磨|优化|修(?:一下|改)?)/.test(input)) {
    const chap = refineM?.[1] ? parseChapterNum(refineM[1]) : null
    return { kind: 'refine', chapter: chap }
  }

  // ==== 写稿（最后判定——「写」是最宽动词） ====
  const writeVerb = /(?:写|创作|生成|起草|接着写|继续写|产出)/
  if (writeVerb.test(input)) {
    const range = input.match(/(\d+)\s*[-–至到]\s*(\d+)\s*章/)
    if (range) {
      const from = parseInt(range[1], 10), to = parseInt(range[2], 10)
      if (from > 0 && to >= from) return { kind: 'chapter_creation', chapter: { from, to } }
    }
    // \s* 支持「第 3 章」带空格（评审覆盖缺口修订：`第?(\d+)` 后无空格容忍时「第 3 章」匹配失败）
    const single = input.match(/第?\s*(\d+|[一二三四五六七八九十]+)\s*章/)
    if (single) {
      const n = parseChapterNum(single[1])
      if (n !== null) return { kind: 'chapter_creation', chapter: n }
    }
    return { kind: 'ambiguous', hint: 'chapter' }
  }

  return { kind: 'none' }
}
```

  注：正则优先级（角色 → 架构 → 修稿 → 写稿）保证「修改苏晚晴的角色设定」不被 refine 抢走；「润色第2章」先命中 refine。

- [ ] **Step 4: 运行确认通过 + typecheck + lint**

Run: `pnpm run test src/services/agent/writing-intent.test.ts && pnpm run typecheck && pnpm run lint`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add src/services/agent/writing-intent.ts src/services/agent/writing-intent.test.ts
git commit -F - <<'EOF'
feat: 意图预路由模式库（writing-intent.ts 本地正则路由：写稿/修稿/角色/大纲，零 LLM 成本）
EOF
```

---

### Task A2: workflow-starter.ts 提取 + 错误语义统一

**Files:**
- Create: `src/services/workflows/workflow-starter.ts`
- Modify: `src/services/agent/tools/start-workflow.tool.ts`（改为调用 starter）
- Test: `src/services/workflows/workflow-starter.test.ts`

**Interfaces:**
- Produces: `WorkflowStartError`（带 `code: 'ERR_GUARD' | 'ERR_NO_DRAFT' | 'ERR_NO_BLUEPRINT'`）+ `startChapterWorkflow(workflow, chapterNumber)` + `startBlueprintWorkflow()` + `startArchitectureWorkflow()`——全部 throw 错误 key，成功返回 `{ runId: string; displayName: string; chapterTag: string }`
- ⚠️ **P0-3 错误归因（核验事实修正）**：buildDraftWorkflow **从不返回 null**（guard 失败 :209 throw、蓝图缺失 :214 throw）——评审原声称的「generate_draft 的 null 统一转 ERR_NO_DRAFT 误报」场景不存在；真实缺陷是 :214 蓝图缺失的 throw 会被 starter 统一 catch 转成 **ERR_GUARD**（「前置条件未满足」而非「请先生成蓝图」，归因错误）。修订：迁移时把 :214 改为 `throw new WorkflowStartError('ERR_NO_BLUEPRINT', t('tool.wfBlueprintDataMissing')...)`（catch 透传）；ERR_NO_DRAFT 只由 review/refine/finalize 的 null（:224/:238/:266）产生
- Consumes: 从 start-workflow.tool.ts 迁移的 buildXxxWorkflow 逻辑（:204-275）与辅助（:134-201）

**背景**：现状失败语义不统一——buildDraftWorkflow guard 失败 **throw**（:209）、buildReviewWorkflow 无草稿 **返回 null**（:224）。预路由需要单路 catch，必须统一。

- [ ] **Step 1: 写失败测试（错误语义 + 正常触发）**

```ts
// src/services/workflows/workflow-starter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WorkflowStartError, startChapterWorkflow } from './workflow-starter'

// mock ipc：蓝图存在 / 草稿存在 / 审稿报告存在
vi.mock('../../services/ipc-client', () => ({
  ipc: { invoke: vi.fn() },
}))

describe('workflow-starter', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('guard 失败 → throw WorkflowStartError ERR_GUARD', async () => {
    // mock guardChapterWriting 失败（通过 ipc 链路 mock 蓝图缺失触发 guard）
    await expect(startChapterWorkflow('generate_draft', 1)).rejects.toMatchObject({ code: 'ERR_GUARD' })
  })

  it('无草稿 → throw ERR_NO_DRAFT（不再返回 null）', async () => {
    // mock db:draft-list 返回 []
    await expect(startChapterWorkflow('review', 1)).rejects.toMatchObject({ code: 'ERR_NO_DRAFT' })
  })

  it('正常触发 → 返回 runId + displayName + chapterTag', async () => {
    // mock 蓝图/草稿齐备 → 返回 { runId, displayName, chapterTag }
    const r = await startChapterWorkflow('generate_draft', 3)
    expect(r.runId).toBeTruthy()
    expect(r.displayName).toBeTruthy()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm run test:watch src/services/workflows/workflow-starter.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 workflow-starter.ts**

把 `start-workflow.tool.ts` 的以下部分**原样迁移**到 `src/services/workflows/workflow-starter.ts`：
- `getWorkflowDisplayName`（:15-25）
- `getChapterInfoFromBlueprint`（:134-154）、`getLatestDraft`（:157-180）、`getLatestReview`（:183-201）
- `buildDraftWorkflow`（:204-219）、`buildReviewWorkflow`（:222-233）、`buildRefineWorkflow`（:236-261）、`buildFinalizeWorkflow`（:264-275）

统一错误语义——**所有失败路径 throw `WorkflowStartError`**：

```ts
export class WorkflowStartError extends Error {
  readonly code: 'ERR_GUARD' | 'ERR_NO_DRAFT' | 'ERR_NO_BLUEPRINT'
  constructor(code: 'ERR_GUARD' | 'ERR_NO_DRAFT' | 'ERR_NO_BLUEPRINT', message: string) {
    super(message)
    this.name = 'WorkflowStartError'
    this.code = code
  }
}

/** 失败语义统一：所有异常路径 throw WorkflowStartError（原 review/refine/finalize 的 return null 改为 throw ERR_NO_DRAFT） */
export async function startChapterWorkflow(
  workflow: 'generate_draft' | 'review' | 'refine' | 'finalize',
  chapterNumber: number,
): Promise<{ runId: string; displayName: string; chapterTag: string }> {
  const displayName = getWorkflowDisplayName(workflow)
  const chapterTag = t('tool.chapterTag').replace('{n}', String(chapterNumber))
  let definition
  try {
    switch (workflow) {
      case 'generate_draft': definition = await buildDraftWorkflow(chapterNumber); break
      case 'review': definition = await buildReviewWorkflow(chapterNumber); break
      case 'refine': definition = await buildRefineWorkflow(chapterNumber); break
      case 'finalize': definition = await buildFinalizeWorkflow(chapterNumber); break
    }
  } catch (e) {
    // P0-3 语义归类：WorkflowStartError 透传（ERR_NO_BLUEPRINT 由 buildDraftWorkflow :214 内 throw）；
    // guard 失败（:209）与其他异常 → ERR_GUARD
    throw e instanceof WorkflowStartError ? e : new WorkflowStartError('ERR_GUARD', e instanceof Error ? e.message : String(e))
  }
  // 仅 review/refine/finalize 可达（generate_draft 从不返回 null——蓝图缺失已在 buildDraftWorkflow 内 throw ERR_NO_BLUEPRINT）
  if (!definition) throw new WorkflowStartError('ERR_NO_DRAFT', t('tool.wfNoReviewDraft').replace('{chapter}', String(chapterNumber)))
  const runId = await useWorkflowStore.getState().startWorkflow(definition)
  return { runId, displayName, chapterTag }
}

export async function startBlueprintWorkflow(): Promise<{ runId: string; displayName: string }> { /* createDirectoryWorkflow + guardDirectoryGeneration，guard 失败 throw ERR_GUARD */ }
export async function startArchitectureWorkflow(): Promise<{ runId: string; displayName: string }> { /* createArchitectureWorkflow + guardArchitectureGeneration */ }
```

  内部各 build 函数改造：
  - `buildReviewWorkflow`/`buildRefineWorkflow`/`buildFinalizeWorkflow` 的 `return null` **保留**（由 startChapterWorkflow 统一转 ERR_NO_DRAFT，最小 diff）
  - `buildDraftWorkflow`：guard 失败 :209 的 throw 保留（catch 转 ERR_GUARD）；**:214 蓝图缺失的 throw 改为 `throw new WorkflowStartError('ERR_NO_BLUEPRINT', t('tool.wfBlueprintDataMissing').replace('{chapter}', String(chapterNumber)))`**（P0-3：防止被 catch 误归 ERR_GUARD）
  - ⚠️ 顺带修正 start-workflow.tool.ts:208 与实码相反的注释（写「guard 失败时返回 null」实为 throw）
  - **`tool.wfNoDraft` 键不存在**（核验确认；locale-data 现为 `tool.wfNoReviewDraft` :2428 / `tool.wfNoRefineDraft` :2429 / `tool.wfNoFinalizeDraft` :2430 三细分键）——**错误码统一、文案保留细分**：startChapterWorkflow 不返回文案，由调用方（工具层 Step 4 / 预路由 A3）按 workflow 映射回三键，**零用户可见变化**；不新增 wfNoDraft（评审偏差 1 落地）

- [ ] **Step 4: 改造 start-workflow.tool.ts 调用 starter**

工具层 execute 改为：

```ts
import { startChapterWorkflow, startBlueprintWorkflow, startArchitectureWorkflow, WorkflowStartError } from '../../workflows/workflow-starter'

// switch 分支全部替换为：
try {
  const result = await startChapterWorkflow('generate_draft', chapterNumber!)
  return { success: true, content: t('tool.workflowStarted').replace('{name}', result.displayName).replace('{chapter}', result.chapterTag), artifacts: [{ type: 'workflow_started', name: `${result.displayName} ${result.chapterTag}` }] }
} catch (e) {
  if (e instanceof WorkflowStartError) {
    // P0-3 修订：ERR_NO_DRAFT 按 workflow 映射回三细分键（wfNoDraft 键不存在，零用户可见变化）；
    // ERR_NO_BLUEPRINT 用 e.message（buildDraftWorkflow 内已带 wfBlueprintDataMissing 文案）
    const msg = e.code === 'ERR_GUARD' ? t('error.prereqNotMet')
      : e.code === 'ERR_NO_DRAFT'
        ? (workflow === 'review' ? t('tool.wfNoReviewDraft')
          : workflow === 'refine' ? t('tool.wfNoRefineDraft')
          : t('tool.wfNoFinalizeDraft')).replace('{chapter}', String(chapterNumber))
      : e.message
    return { success: false, content: '', error: msg }
  }
  throw e
}
```

  行为等价性（P0-3/评审偏差 1 修订）：guard 失败文案与原来一致（error.prereqNotMet）；「无草稿」按 workflow 映射回原三键（wfNoReviewDraft/wfNoRefineDraft/wfNoFinalizeDraft）——**零用户可见变化**；蓝图缺失：原来走 :126 `tool.wfStartFailed` 兜底（错误信息被通用文案包裹），现在直接 `wfBlueprintDataMissing` 文案——唯一用户可见变化，属修订目标（归因精准化）。

- [ ] **Step 5: 全量回归（重点 start-workflow 相关与 workflow 测试）**

Run: `pnpm run test && pnpm run typecheck && pnpm run lint`
Expected: 全绿（原有 700 + 新增）。

- [ ] **Step 6: Commit**

```bash
git add src/services/workflows/workflow-starter.ts src/services/workflows/workflow-starter.test.ts src/services/agent/tools/start-workflow.tool.ts
git commit -F - <<'EOF'
feat: 工作流启动提取为 workflow-starter（统一 throw 错误 key，工具层与预路由共用）
EOF
```

---

### Task A3: sendMessage 意图预路由接线

**Files:**
- Modify: `src/stores/agent-store.ts`（sendMessage，:300 起）
- Modify: `src/stores/agent-store.ts`（store 接口新增意图处理 action）
- Test: `src/stores/agent-store.test.ts`（追加 describe）

**Interfaces:**
- Consumes: `detectWritingIntent`（A1）+ `startChapterWorkflow`/`startBlueprintWorkflow`/`startArchitectureWorkflow`/`WorkflowStartError`（A2）
- Produces: `handleWritingIntent(intent, rawContent): Promise<{ status: 'handled' | 'none'; enhancedContent?: string }>`——内部 action：强命中/弱命中处理完返回 `{ status: 'handled' }`；character 分支返回 `{ status: 'none', enhancedContent }`（**不 append 任何消息**——P0-4）；未命中返回 `{ status: 'none' }`

**接线位置（核验修订——评审偏差 2）**：实际时序 = RAG 注入（:455-468，进 systemPrompt）**在前**、parseMentions/@ 预取（:473-512，进 enrichedUserMessage）**在后**——计划初稿声称的「@ 解析在 RAG 注入前」不实（接线位置结论不受影响）。预路由插入点：**`/` 命令拦截（:306-363）结束之后、userMsg 构建（:373）之前**——此时 convId/content 已就绪、消息尚未 append；A1 内部已排除含 `@` 的消息（`input.includes('@')` → none），预路由在前不与 @ 链路冲突；RAG 与 @ 预取保持在预路由之后原样执行（预路由短路 return 时二者自然跳过）。

- [ ] **Step 1: 写失败测试（接线行为）**

```ts
// agent-store.test.ts 追加 describe
describe('sendMessage 意图预路由', () => {
  it('强命中写稿意图：不调 runAgentLoop，注入开始消息 + workflow_started 产物', async () => {
    // mock detectWritingIntent 返回 { kind: 'chapter_creation', chapter: 3 }
    // mock startChapterWorkflow 返回 { runId, displayName, chapterTag }
    // 调用 sendMessage('写第三章')
    // 断言：assistant 消息 content 含「已开始」；artifacts 含 workflow_started；runAgentLoop 未被调用（generating 复位）
  })

  it('弱命中：注入澄清消息（不触发工作流）', async () => {
    // mock detectWritingIntent 返回 { kind: 'ambiguous', hint: 'chapter' }
    // 断言：assistant 消息为澄清模板；runAgentLoop 未被调用
  })

  it('未命中：原样走 ReAct（行为不变）', async () => {
    // mock detectWritingIntent 返回 { kind: 'none' }
    // 断言：runAgentLoop 被调用
  })

  it('character 命中：userMsg.content 为增强内容（原文不重复出现），走 ReAct（P0-4 回归）', async () => {
    // mock detectWritingIntent 返回 { kind: 'character', name: '苏晚晴', action: 'create' }
    // 调用 sendMessage('创建角色苏晚晴')
    // 断言：会话 messages 中 role:'user' 恰 1 条，且 content 以「创建角色：苏晚晴」前缀开头（无重复原文）
    // 断言：runAgentLoop 被调用（增强后内容入 ReAct）
  })
})
```

  注：agent-store.test.ts 的既有 mock 模式（window.velaAPI.invoke 通道路由）沿用；runAgentLoop 通过 vi.mock agent-engine 模块 stub。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm run test:watch src/stores/agent-store.test.ts`
Expected: FAIL（无预路由逻辑）。

- [ ] **Step 3: 实现接线**

```ts
// store 接口新增：
/** 意图预路由处理（内部）：强命中直接触发工作流并注入汇报消息；弱命中注入澄清；
 *  character 分支返回 { status: 'none', enhancedContent }（不 append 消息，由主流程在 userMsg
 *  构建时替换 content——P0-4）；未命中返回 { status: 'none' } */
handleWritingIntent: (intent: WritingIntent, rawContent: string) => Promise<{ status: 'handled' | 'none'; enhancedContent?: string }>

// sendMessage 中 / 命令拦截（:306-363）结束之后、userMsg 构建（:373）之前插入：
// ===== 意图预路由（阶段 A）：/命令与@未命中后，本地意图识别 → 确定性触发 or 澄清 or 兜底 =====
const intent = detectWritingIntent(trimmedContent)
let enhancedContent: string | undefined
if (intent.kind !== 'none') {
  const res = await get().handleWritingIntent(intent, trimmedContent)
  if (res.status === 'handled') return
  enhancedContent = res.enhancedContent
}
// 未命中继续走原有 ReAct 链路——userMsg 构建（:373）处 content 取 enhancedContent ?? content.trim()
```

```ts
// handleWritingIntent 实现（P0-4 修订：返回 { status, enhancedContent }，不重复 append 用户消息）：
handleWritingIntent: async (intent, rawContent) => {
  const conv = get().getActiveConversation()
  if (!conv) return { status: 'none' }
  const { t } = await import('../shared/locale')
  const { startChapterWorkflow, startBlueprintWorkflow, startArchitectureWorkflow, WorkflowStartError } = await import('../services/workflows/workflow-starter')
  const genId = () => crypto.randomUUID()

  // ⚠️ P0-4 修订：**不在此 append 用户消息**——用户消息由 sendMessage 主流程统一构建/append（唯一入口）；
  //    原实现「这里 append 原文 + character 分支 append 增强 + 主流程再 append 原文」= 用户原文 2 次 + 增强 1 次，三重复
  const appendMsg = (msg: AgentMessage) => {
    set(state => ({
      conversations: state.conversations.map(c =>
        c.id === conv.id ? { ...c, messages: [...c.messages, msg], updatedAt: Date.now() } : c
      ),
    }))
    get().persistCurrent(conv.id)
  }

  const makeStartedMsg = (displayName: string, chapterTag: string): AgentMessage => ({
    id: genId(), role: 'assistant',
    content: t('agent.intentStarted').replace('{name}', displayName).replace('{chapter}', chapterTag),
    createdAt: Date.now(),
    artifacts: [{ type: 'workflow_started', name: `${displayName} ${chapterTag}`.trim() }],
  })

  try {
    switch (intent.kind) {
      case 'chapter_creation': {
        const chapter = intent.chapter
        if (chapter === null) {  // 「写」无章号
          appendMsg({ id: genId(), role: 'assistant', content: t('agent.intentClarifyChapter'), createdAt: Date.now() })
          return { status: 'handled' }
        }
        if (typeof chapter === 'object') {
          // 批量：逐章触发（v1 串行）
          for (let n = chapter.from; n <= chapter.to; n++) {
            const r = await startChapterWorkflow('generate_draft', n)
            appendMsg(makeStartedMsg(r.displayName, r.chapterTag))
          }
        } else {
          const r = await startChapterWorkflow('generate_draft', chapter)
          appendMsg(makeStartedMsg(r.displayName, r.chapterTag))
        }
        return { status: 'handled' }
      }
      case 'refine': {
        const chap = intent.chapter
        if (chap === null) {  // 无定位 → 澄清
          appendMsg({ id: genId(), role: 'assistant', content: t('agent.intentClarifyRefine'), createdAt: Date.now() })
          return { status: 'handled' }
        }
        const r = await startChapterWorkflow('refine', chap)
        appendMsg(makeStartedMsg(r.displayName, r.chapterTag))
        return { status: 'handled' }
      }
      case 'architecture': {
        const r = intent.target === 'blueprint'
          ? await startBlueprintWorkflow()
          : await startArchitectureWorkflow()
        appendMsg({ id: genId(), role: 'assistant', content: t('agent.intentStartedNoChapter').replace('{name}', r.displayName), createdAt: Date.now(), artifacts: [{ type: 'workflow_started', name: r.displayName }] })
        return { status: 'handled' }
      }
      case 'character': {
        // v1：角色无现成工作流 → 参数提取 + 增强内容返回主流程（P0-4：不 append 任何消息，
        // 主流程在 userMsg 构建时替换 content——用户历史中为增强后的完整请求，原文仅出现 1 次）
        const op = intent.action === 'create' ? t('agent.intentCharCreate') : t('agent.intentCharUpdate')
        return { status: 'none', enhancedContent: `${op}：${intent.name}\n\n${rawContent}` }
      }
      case 'ambiguous':
        appendMsg({ id: genId(), role: 'assistant', content: t('agent.intentClarifyGeneric'), createdAt: Date.now() })
        return { status: 'handled' }
      case 'none':
        return { status: 'none' }
    }
  } catch (e) {
    if (e instanceof WorkflowStartError) {
      // P0-3：ERR_NO_BLUEPRINT 用 e.message（buildDraftWorkflow 内已带 wfBlueprintDataMissing 文案，归因精准）；
      // ERR_GUARD 用意图层文案
      const msg = e.code === 'ERR_GUARD' ? t('agent.intentGuardFail') : e.message
      appendMsg({ id: genId(), role: 'assistant', content: msg, createdAt: Date.now() })
      return { status: 'handled' }
    }
    throw e
  }
}
```

  ⚠️ character 分支语义（P0-4 修订后确定）：返回 `{ status: 'none', enhancedContent }`，**不 append 任何消息**；主流程在 userMsg 构建（:373）处用 enhancedContent 替换 content（:396 append 的 userMsg 即增强后的完整请求，用户历史可见 1 次）；后续 RAG（:455）/@ 预取（:473）基于增强后文本执行。核验确认：原「主流程 append 时替换」方案可行——预路由调用点在 :373 之前（/ 拦截后立即），增强内容在 userMsg 构建前已就绪。

- [ ] **Step 4: 运行确认通过 + 全量回归**

Run: `pnpm run test && pnpm run typecheck && pnpm run lint`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add src/stores/agent-store.ts src/stores/agent-store.test.ts
git commit -F - <<'EOF'
feat: sendMessage 意图预路由接线（强命中直接触发工作流、弱命中澄清、character 增强消息走 ReAct）
EOF
```

---

### Task A4: i18n 键 + 收尾

**Files:**
- Modify: `src/shared/locale-data.ts`（新增键，三语）
- Modify: `src/stores/agent-store.ts`（如有硬编码文本收口）

**Interfaces:**
- Consumes: A3 引用的全部 `agent.*` / `tool.*` 键
- Produces: 三语键齐备

- [ ] **Step 1: 核查并新增 i18n 键**

先查 locale-data.ts 已有键（`agent.*`、`tool.*` 区），缺失的新增（三语 zh-CN / en-US / ru-RU）：

| 键 | zh-CN | en-US | ru-RU |
|---|---|---|---|
| `agent.intentStarted` | 已开始{name}{chapter} | Started {name} {chapter} | Начато: {name} {chapter} |
| `agent.intentStartedNoChapter` | 已开始{name} | Started {name} | Начато: {name} |
| `agent.intentClarifyChapter` | 你想写第几章？请指定章节号 | Which chapter should I write? Please specify | Какую главу написать? Укажите номер |
| `agent.intentClarifyRefine` | 你想修改哪一章/哪段？请指定范围 | Which chapter or passage should I refine? | Какую главу/отрывок отредактировать? |
| `agent.intentClarifyGeneric` | 我理解你的意图，但需要更多信息才能开始。请补充细节 | I understand your intent, but need more details to start | Я понял(а) вашу цель, но нужны детали |
| `agent.intentGuardFail` | 前置条件未满足，无法开始。请检查项目配置 | Prerequisites not met. Check project setup | Предусловия не выполнены. Проверьте проект |
| `agent.intentCharCreate` | 创建角色 | Create character | Создать персонажа |
| `agent.intentCharUpdate` | 更新角色 | Update character | Обновить персонажа |

  **无 `tool.wfNoDraft`**（评审偏差 1 核验确认：该键不存在）——A2/A3 复用现有三细分键 `tool.wfNoReviewDraft`（locale-data :2428）/`tool.wfNoRefineDraft`（:2429）/`tool.wfNoFinalizeDraft`（:2430），按 workflow 映射，**零新增零变化**；ERR_NO_BLUEPRINT 复用 `tool.wfBlueprintDataMissing`（:2433 已有）。

- [ ] **Step 2: i18n 残留扫描**

Run: `pnpm run gen:tokens`（或项目 i18n-standard 的残留扫描方式），确认无硬编码新增文本。

- [ ] **Step 3: 全量回归 + Commit**

Run: `pnpm run test && pnpm run typecheck && pnpm run lint`
Expected: 全绿。

```bash
git add src/shared/locale-data.ts
git commit -F - <<'EOF'
feat: 意图预路由 i18n 键（三语：intentStarted/Clarify/CharRoute；复用 wfNoReviewDraft 系与 wfBlueprintDataMissing）
EOF
```

---

## Self-Review 记录

**Spec 覆盖**：§4.1 架构（接线）→ A3；§4.2 模式库（4 类 + 单章/批量 + 角色新建/修改 + 弱命中）→ A1；§4.3 直接触发 + workflow-starter + 统一错误语义 + 步进复用 → A2/A3；§4.4 预载 → A3（复用现有 systemPrompt + RAG 链路，character 增强消息即预载增值）；§7 i18n → A4。D1（直接触发）→ A3；D4（4 类范围）→ A1。

**占位符扫描**：无 TBD；「实现时确认 parseMentions 调用点」与「实现时二选一（增强消息注入方式）」为显式决策点，均有默认路径。

**类型一致性**：`WritingIntent` 判别联合在 A1 定义、A3 消费一致；`WorkflowStartError` 在 A2 定义、A2/A3 消费一致；`startChapterWorkflow` 返回签名三处一致。

## 评审修订记录（2026-08-27 外部评审 + 代码核验）

**🔴 P0-3｜错误归因（核验修正了评审的原始描述）**：评审声称「buildDraftWorkflow 蓝图缺失时也返回 null → 统一转 ERR_NO_DRAFT 误报」——核验发现 buildDraftWorkflow **从不返回 null**（guard 失败 :209、蓝图缺失 :214 都 throw；:75 的 `!definition` 分支不可达死代码）。**真实缺陷**：:214 蓝图缺失 throw 会被 starter 统一 catch 转成 ERR_GUARD（「前置条件未满足」），归因错误。
**修订（已落地）**：:214 改为 throw `WorkflowStartError('ERR_NO_BLUEPRINT', wfBlueprintDataMissing 文案)`（catch 透传）；ERR_NO_DRAFT 仅由 review/refine/finalize 的 null 产生；顺带修正 :208 与实码相反的注释。

**🔴 P0-4｜character 分支消息三重复**：原实现「handleWritingIntent 开头 appendMsg(userMsg) + character 分支 append 增强消息 + return 'none' 后主流程再 append 原文」= 用户原文 2 次 + 增强 1 次。
**修订（已落地）**：返回 `{ status: 'handled' | 'none'; enhancedContent?: string }`；character 分支不 append 任何消息；主流程在 userMsg 构建（:373）时用 enhancedContent 替换 content。核验确认：预路由插入点必须在 :363（/ 拦截结束）与 :373 之间——计划初稿的「@ 解析之后」（:473）在 append 之后，无法替换。

**🟡 重要｜A1 模式库覆盖缺口（全部已修订）**：① parseChapterNum 支持 1-99（十位组合「二十」~「九十九」，原 1-10 + 十一~十九）；② 「创建角色」无名字 → ambiguous('character') 澄清；③ 「第 3 章」带空格——`第?(\d+)` 后加 `\s*`（refine 与写稿单章两处正则）。

**偏差 1（已落地）**：`tool.wfNoDraft` 键不存在——改为 ERR_NO_DRAFT 码统一 + 文案按 workflow 映射回 wfNoReviewDraft/wfNoRefineDraft/wfNoFinalizeDraft（零用户可见变化）。
**偏差 2（已修正）**：实际时序 RAG 注入（:455-468）在前、parseMentions（:473-512）在后——接线位置改为 :363-373 之间，结论不受影响。

**核验补充事实**：startWorkflow 仅 generate_draft 分支捕获 runId（其余丢弃——starter 统一返回 runId 后天然修复）；agent-store.test.ts :10-28 已有 window.velaAPI.invoke 通道路由 mock（:59 注入）可扩展；:358 skill 分支改写 content（/ 命令已 return，预路由在其后取到的是未改写文本 ✓）。
