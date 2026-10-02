# 命令审查（线①）实施计划：本地直出退场 + start_workflow 区间

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **执行状态（2026-10-02 回填）：✅ 已全部执行。** Task 1 `f8bf031`（直出退场）/ Task 2 `39df86e`（区间扩展）/ Task 3 `2529417`（收尾）；另有终审修复 pass `026459b`+`ff069f9`（C1 启动即回执等）与 I2 裁决落地 `043458e`（区间分键记忆）。门禁三绿 **2561/2561**。**真机四用例档已出、用户拍板「暂不跑」**（`docs/2026-10-02-command-review-real-machine-test-plan.md`）。本档 **checkbox 未回填**（执行以提交链为准）。

**Goal:** 按方案 B 让本地正则直出退场——自然语言不再绕过审查直接启动工作流，全部经 ReAct → `start_workflow` 工具（确认）→ 执行；并为该工具补上多章区间能力（D1 拍板）。

**Architecture:** `handleWritingIntent`（agent-store）中 `chapter_creation / refine / architecture` 三类的执行分支退役（统一返回 `status:'none'` 落 ReAct），仅保留无动作产出（`ambiguous` 澄清、`character` 增强）；配套死码（动态 import / `makeStartedMsg` / `WorkflowStartError` catch）一并移除。`start_workflow` 工具新增可选 `chapter_end`，一次调用串行启动闭区间各章（一次确认）。

**Tech Stack:** React 19 + TypeScript strict + zustand + Vitest（jsdom）+ Tailwind/i18n（三语）。

**Spec:** `docs/superpowers/specs/2026-10-02-command-review-design.md`（拆分自 `docs/2026-10-01-agent-command-review-design.md`）

## Global Constraints

- **只改这些文件**：`src/stores/agent-store.ts`、`src/services/agent/writing-intent.ts`、`src/stores/agent-store.test.ts`、`src/services/agent/tools/start-workflow.tool.ts`、`src/services/agent/tools/start-workflow.tool.test.ts`、`src/shared/locale-data/tool.ts`。不动其余目录。
- **必须保留**：`ambiguous` 澄清（`intentClarifyChapter`/`intentClarifyGeneric` 两分支）、`character` 增强（恰 1 次原文）、`/` 命令体系与 `/status` 穿透、`@` 提及守卫、工具层 `WorkflowStartError` → 文案映射（现有测试不得破坏）。
- **行号基线**：2026-10-02 实测（引用文件自 10-01 未改动）；动手前按行号复核一次。
- **i18n**：新增键必须三语齐全（zh-CN / en-US / ru-RU），加进 `src/shared/locale-data/tool.ts`（i18n-key-guard 单向检查）。
- **门禁**：每个任务收尾跑相关测试；批次收尾跑全量 `pnpm run typecheck`、`pnpm run lint`、`pnpm run test`（三绿）。⚠️ 本机沙箱禁子进程：跑 `pnpm` 命令时 Bash 工具需 `dangerouslyDisableSandbox: true`。
- **提交留本地**（不 push）；提交信息照仓库风格（feat/fix/refactor + 中文描述）。

## Review Focus

1. 「润色一下」（无章号）**落 ReAct**（本地澄清退场是拍板后的有意行为，不是回归）——Task 1 测试钉住。
2. `character` 增强仍**恰 1 次原文**（防三重复接线被本次改动破坏）——既有测试保持（`agent-store.test.ts` 「character 命中」用例）。
3. 区间循环**中途失败**：已启动章节不回滚、错误按既有映射返回（`ERR_NO_DRAFT` 等）——Task 2 测试钉住。
4. `chapter_end` 与**非章节工作流**（blueprint/architecture）组合：忽略而非报错——Task 2 测试钉住。
5. `/status 写第三章` 与 `@` 提及输入**不受新逻辑影响**（守卫保持）——既有测试保持（`:534` / `writing-intent.ts:42`）。

---

### Task 1: 直出分支退役（agent-store.ts + writing-intent.ts）

**Files:**
- Modify: `src/stores/agent-store.ts`（`:587-589` 注释 / `:601-605` catch 注释 / `handleWritingIntent` `:1166-1297` 整体重写）
- Modify: `src/services/agent/writing-intent.ts`（`:1-13` 头部与类型注释）
- Test: `src/stores/agent-store.test.ts`（`:460-484` 用例反转 + 新增两类用例）

**Interfaces:**
- Consumes: 无（本任务自包含）
- Produces: `handleWritingIntent` 新契约——`chapter_creation / refine / architecture` 一律返回 `{ status: 'none' }`；`ambiguous` 返回 `{ status: 'handled' }`（先 append 转录）；`character` 返回 `{ status: 'none', enhancedContent }`（签名不变，`AgentState.handleWritingIntent` 类型零改动）

- [ ] **Step 1: 反转/新增测试（先红）**

把 `agent-store.test.ts` 的 `it('强命中写稿意图：不调 runAgentLoop，注入开始消息 + workflow_started 产物', ...)`（`:460-484`）整段替换为：

```ts
  it('方案 B：强命中写稿意图不再本地启动——落 ReAct，无 workflow_started 产物', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ defaultModelId: 'test-model' })
    mockDetect.mockReturnValue({ kind: 'chapter_creation', chapter: 3 })

    await useAgentStore.getState().sendMessage('写第3章')

    const after = useAgentStore.getState().conversations.find(c => c.id === conv.id)!
    // 直出退场（方案 B）：不经本地工作流启动；由模型经 start_workflow 工具（确认后）处理
    expect(mockStartChapter).not.toHaveBeenCalled()
    expect(after.messages.some(m => m.artifacts?.some(a => a.type === 'workflow_started'))).toBe(false)
    // 原文恰好 1 次（ReAct 主流程 append）+ 首条标题合同保持
    const userMsgs = after.messages.filter(m => m.role === 'user')
    expect(userMsgs).toHaveLength(1)
    expect(userMsgs[0].content).toBe('写第3章')
    expect(after.title).toBe('写第3章')
    expect(mockRunAgentLoop).toHaveBeenCalledTimes(1)
  })
```

在该 describe 内、上述用例之后追加：

```ts
  it('方案 B：refine 强命中（含无章号）落 ReAct——本地澄清一并退场', async () => {
    // 有章号
    useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ defaultModelId: 'test-model' })
    mockDetect.mockReturnValue({ kind: 'refine', chapter: 2 })
    await useAgentStore.getState().sendMessage('润色第2章')
    expect(mockStartChapter).not.toHaveBeenCalled()
    expect(mockRunAgentLoop).toHaveBeenCalledTimes(1)

    // 无章号：不再本地回 intentClarifyRefine（拍板 2026-10-02），同样落 ReAct
    useAgentStore.getState().createConversation({ title: 'T' })
    mockDetect.mockReturnValue({ kind: 'refine', chapter: null })
    await useAgentStore.getState().sendMessage('润色一下')
    expect(mockRunAgentLoop).toHaveBeenCalledTimes(2)
  })

  it('方案 B：architecture 强命中落 ReAct（不再本地启动蓝图/架构工作流）', async () => {
    useAgentStore.getState().createConversation({ title: 'T' })
    useLLMStore.setState({ defaultModelId: 'test-model' })
    mockDetect.mockReturnValue({ kind: 'architecture', target: 'blueprint' })

    await useAgentStore.getState().sendMessage('生成大纲')

    expect(mockStartChapter).not.toHaveBeenCalled()
    expect(mockRunAgentLoop).toHaveBeenCalledTimes(1)
    const after = useAgentStore.getState().conversations.find(c => c.title === 'T')!
    expect(after.messages.some(m => m.artifacts?.some(a => a.type === 'workflow_started'))).toBe(false)
  })
```

- [ ] **Step 2: 运行确认失败（红）**

Run: `pnpm run test -- agent-store`
Expected: FAIL——「不再本地启动」类断言失败（现状仍启动工作流 / 注入「已开始」消息）。

- [ ] **Step 3: 实现——重写 `handleWritingIntent`**

把 `agent-store.ts:1166-1297` 的 `handleWritingIntent` 整体替换为：

```ts
  handleWritingIntent: async (intent, rawContent) => {
    const conv = get().getActiveConversation()
    if (!conv) return { status: 'none' }

    const appendMsg = (msg: AgentMessage) => {
      set(state => ({
        conversations: state.conversations.map(c =>
          c.id === conv.id ? { ...c, messages: [...c.messages, msg], updatedAt: Date.now() } : c
        ),
      }))
      get().persistCurrent(conv.id)
    }

    // ⚠️ D5 修订（转录形态）：澄清路径 append 用户原文 1 次——P0-4 修复后主流程在 handled 时
    //    直接 return，用户原文曾零出现（对话断链、标题停「新对话」、CCR batch 无原文、fork 无源节点）。
    //    防三重复接线：仅 ambiguous 在此 append；character 由主流程 append 增强形态（恰 1 次）；
    //    强命中直出已随方案 B（2026-10-02）退场——那些输入落 ReAct，由主流程正常 append 原文。
    if (intent.kind === 'ambiguous') {
      const userMsg: AgentMessage = { id: genId(), role: 'user', content: rawContent, createdAt: Date.now() }
      set(state => ({
        conversations: state.conversations.map(c =>
          c.id === conv.id
            ? {
                ...c,
                // 首条用户消息标题合同（与主流程 generateTitle 一致）：补齐澄清会话「新对话」不可区分缺陷
                title: c.messages.length === 0 ? generateTitle(rawContent) : c.title,
                messages: [...c.messages, userMsg],
                updatedAt: Date.now(),
              }
            : c
        ),
      }))
      get().persistCurrent(conv.id)
    }

    switch (intent.kind) {
      // 方案 B（2026-10-02）：本地直出退场——不再启动任何工作流。
      // 全部自然语言交 ReAct，由模型经 start_workflow 工具（requiresConfirmation + A 档审批）→ 确认 → 执行；
      // 判据收敛为两套：/ 命令与模型。意图解析保留（供澄清/增强与未来复用），执行已退役。
      case 'chapter_creation':
      case 'refine':
      case 'architecture':
        return { status: 'none' }
      case 'character': {
        // v1：角色无现成工作流 → 参数提取 + 增强内容返回主流程（P0-4：不 append 任何消息，
        // 主流程在 userMsg 构建时替换 content——用户历史中为增强后的完整请求，原文仅出现 1 次）
        const op = intent.action === 'create' ? t('agent.intentCharCreate') : t('agent.intentCharUpdate')
        return { status: 'none', enhancedContent: `${op}：${intent.name}\n\n${rawContent}` }
      }
      case 'ambiguous':
        // 评审修复（M2）：按 hint 映射澄清文案——hint='chapter'（「帮我写」等缺章号写稿祈使）用
        // intentClarifyChapter（此前该键不可达，用户收到通用模糊句）；character 与其他 hint 用通用澄清
        appendMsg({
          id: genId(), role: 'assistant',
          content: intent.hint === 'character'
            ? t('agent.intentClarifyGeneric')
            : intent.hint === 'chapter'
              ? t('agent.intentClarifyChapter')
              : t('agent.intentClarifyGeneric'),
          createdAt: Date.now(),
        })
        return { status: 'handled' }
      case 'none':
        return { status: 'none' }
    }
  },
```

要点：随直出分支一并**删除**——`:1170` 动态 import `workflow-starter`（含 `WorkflowStartError`）、`makeStartedMsg`（`:1207-1212`）、包裹 switch 的 try/catch（`:1214` / `:1278-1297`，其唯一用途是 `WorkflowStartError` 映射；其余异常原本就 rethrow 给 `sendMessage` 兜底，语义不变）。**保留** `appendMsg` helper（ambiguous 用）。

- [ ] **Step 4: 更新两处既有注释**

`agent-store.ts:587-589` 替换为：

```ts
    // ===== 意图预路由（阶段 A）：本地识别 → 澄清 / 增强 / 交 ReAct（方案 B 2026-10-02）=====
    // 守卫：/ 前缀输入（/status 穿透分支、未知/自定义 skill 命令改写分支——皆未 return 到达此处）
    // 方案 B：本地分类不再执行任何东西（直出退场）——仅保留无动作产出：ambiguous→澄清、character→增强；
    // 其余 kind 一律返回 none 落 ReAct，由模型经 start_workflow 工具（确认后）执行
```

`agent-store.ts:602-605` 的 catch 注释替换为：

```ts
      // 兜底（沿用 I2 评审结论；方案 B 2026-10-02 后直出已退场，handleWritingIntent 对异常一律 rethrow）：
      // 注入 `发生异常` 文案（与下方 ReAct try/catch 的既有形态一致）并 return——不让 sendMessage reject，
      // 会话保持可继续对话
```

- [ ] **Step 5: `writing-intent.ts` 语义注释（无行为变化）**

`:1-5` 文件头替换为：

```ts
/**
 * 意图预路由（阶段 A）——本地零 LLM 成本的自然语言意图识别。
 * 判定原则：只识别「执行成本/破坏性」高的意图（写稿/修稿/角色/大纲）。
 * ⚠️ 方案 B（2026-10-02 拍板）：本模块**不再直接触发任何执行**——chapter_creation / refine /
 *    architecture 三类仅作解析（执行已退役，落 ReAct，由模型经 start_workflow 工具 + 确认执行）；
 *    本地保留的无动作产出只有两类：ambiguous → 澄清、character → 内容增强。
 * 查询类（文风/设定/聊天）不预路由，留给 ReAct 兜底。
 */
```

`:7` 类型定义前加一行注释：

```ts
// kind 保留完整分类：三类执行意图的解析仍会返回（当前消费方将其落回 ReAct；留作澄清/提示/未来复用）
```

- [ ] **Step 6: 运行测试（绿）**

Run: `pnpm run test -- agent-store` 与 `pnpm run test -- writing-intent`
Expected: PASS（含既有澄清/增强//status 守卫用例）。

- [ ] **Step 7: Commit**

```bash
git add src/stores/agent-store.ts src/services/agent/writing-intent.ts src/stores/agent-store.test.ts
git commit -m "refactor(agent): 本地直出退场（方案 B）——意图预路由仅保留澄清/增强，执行统一走 ReAct + start_workflow 确认"
```

---

### Task 2: `start_workflow` 工具区间扩展（`chapter_end`）

**Files:**
- Modify: `src/services/agent/tools/start-workflow.tool.ts`（inputSchema `:30-39` / execute `:42-111`）
- Modify: `src/shared/locale-data/tool.ts`（`:68` 后 + `:250` 后各加一键）
- Test: `src/services/agent/tools/start-workflow.tool.test.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 1 无依赖（独立）
- Produces: `start_workflow` 新可选入参 `chapter_end: number`——与 `chapter_number` 组成闭区间 `[chapter_number, chapter_end]` 串行启动各章；返回 `content` 为逐章 `tool.workflowStarted` 文案以 `\n` 连接、`artifacts` 为逐章 `workflow_started`

- [ ] **Step 1: 追加测试（先红）**

在 `start-workflow.tool.test.ts` 末尾追加：

```ts
describe('start_workflow 区间（chapter_end，2026-10-02 方案 B 配套）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('闭区间：串行启动每一章，逐章返回文案与产物', async () => {
    mockStartChapter.mockImplementation(async (_wf, n) => ({
      runId: `run-${n}`,
      displayName: t('tool.wfDraft'),
      chapterTag: t('tool.chapterTag').replace('{n}', String(n)),
    }))

    const r = await startWorkflowTool.execute({ workflow: 'generate_draft', chapter_number: 5, chapter_end: 7 })

    expect(r.success).toBe(true)
    expect(mockStartChapter).toHaveBeenCalledTimes(3)
    expect(mockStartChapter.mock.calls.map(c => c[1])).toEqual([5, 6, 7])
    expect(r.artifacts).toHaveLength(3)
    expect(r.content).toContain(t('tool.chapterTag').replace('{n}', '7'))
  })

  it('chapter_end < chapter_number → wfRangeInvalid（不启动任何工作流）', async () => {
    const r = await startWorkflowTool.execute({ workflow: 'generate_draft', chapter_number: 5, chapter_end: 3 })

    expect(r.success).toBe(false)
    expect(r.error).toBe(t('tool.wfRangeInvalid'))
    expect(mockStartChapter).not.toHaveBeenCalled()
  })

  it('chapter_end === chapter_number → 等价单章（一次调用一次启动）', async () => {
    mockStartChapter.mockResolvedValue({ runId: 'r', displayName: t('tool.wfDraft'), chapterTag: t('tool.chapterTag').replace('{n}', '5') })

    const r = await startWorkflowTool.execute({ workflow: 'generate_draft', chapter_number: 5, chapter_end: 5 })

    expect(r.success).toBe(true)
    expect(mockStartChapter).toHaveBeenCalledTimes(1)
    expect(r.artifacts).toHaveLength(1)
  })

  it('区间中途失败：错误按既有映射返回，已启动章节保留', async () => {
    mockStartChapter
      .mockResolvedValueOnce({ runId: 'r5', displayName: t('tool.wfReview'), chapterTag: t('tool.chapterTag').replace('{n}', '5') })
      .mockRejectedValueOnce(new WorkflowStartError('ERR_NO_DRAFT', t('tool.wfNoReviewDraft').replace('{chapter}', '6')))

    const r = await startWorkflowTool.execute({ workflow: 'review', chapter_number: 5, chapter_end: 7 })

    expect(r.success).toBe(false)
    expect(r.error).toBe(t('tool.wfNoReviewDraft').replace('{chapter}', '6'))
    expect(mockStartChapter).toHaveBeenCalledTimes(2) // 5 已启动、6 失败即止（7 未触达）
  })

  it('非章节工作流携带 chapter_end → 忽略（不报错，按原路径执行）', async () => {
    vi.mocked(startBlueprintWorkflow).mockResolvedValue({ runId: 'rb', displayName: t('tool.wfBlueprint') })

    const r = await startWorkflowTool.execute({ workflow: 'generate_blueprint', chapter_end: 9 })

    expect(r.success).toBe(true)
  })
})
```

并把测试文件头部 import 补上 `startBlueprintWorkflow`（`vi.mocked` 用）：

```ts
import { startChapterWorkflow, startBlueprintWorkflow, WorkflowStartError } from '../../workflows/workflow-starter'
```

（`startBlueprintWorkflow` 已在文件顶部 `vi.mock` 的返回对象中，仅需补 import 名。）

- [ ] **Step 2: 运行确认失败（红）**

Run: `pnpm run test -- start-workflow.tool`
Expected: FAIL——`chapter_end` 未被识别（逐章启动 / 校验缺失 / `wfRangeInvalid` 键不存在）。

- [ ] **Step 3: 加 i18n 键（三语）**

`src/shared/locale-data/tool.ts`：`:68`（`tool.startWorkflowChapter`）之后插入：

```ts
  'tool.startWorkflowChapterEnd': { 'zh-CN': '（可选）结束章号：与 chapter_number 组成闭区间，一次调用串行启动每一章（用户只需确认一次）；仅写稿/修稿/审稿/定稿有效', 'en-US': '(Optional) End chapter: forms an inclusive range with chapter_number; starts each chapter serially in one call (single confirmation). Only for draft/revise/review/finalize.', 'ru-RU': '(Необязательно) Конечная глава: вместе с chapter_number задаёт диапазон; последовательно запускает каждую главу за один вызов (одно подтверждение). Только для написания/правки/рецензии/финализации.' },
```

`:250`（`tool.wfUnsupported`）之后插入：

```ts
  'tool.wfRangeInvalid': { 'zh-CN': '区间无效：chapter_end 需不小于 chapter_number（且需同时提供 chapter_number）', 'en-US': 'Invalid range: chapter_end must be ≥ chapter_number (with chapter_number provided).', 'ru-RU': 'Неверный диапазон: chapter_end должен быть ≥ chapter_number (при указанном chapter_number).' },
```

- [ ] **Step 4: 实现工具扩展**

`start-workflow.tool.ts`：

（a）`inputSchema.properties` 在 `chapter_number` 之后追加：

```ts
      chapter_end: {
        type: 'number',
        description: t('tool.startWorkflowChapterEnd'),
      },
```

（b）`execute` 内、`chapterNumber` 提取之后追加：

```ts
    const chapterEnd = args.chapter_end as number | undefined
```

（c）在既有 `chapterWorkflows.includes(workflow) && chapterNumber === undefined` 校验之后、`useLayoutStore…openRightPanel` 之前追加：

```ts
    // 区间校验（2026-10-02）：仅章节工作流生效；chapter_end 必须与 chapter_number 组成合法闭区间
    if (chapterWorkflows.includes(workflow) && chapterEnd !== undefined
      && (!Number.isInteger(chapterEnd) || chapterEnd < chapterNumber!)) {
      return { success: false, content: '', error: t('tool.wfRangeInvalid') }
    }
```

（d）`case 'generate_draft' … 'finalize': {` 分支体首部（`const result = await startChapterWorkflow(...)` 之前）插入：

```ts
          // 区间（chapter_end，2026-10-02）：串行启动闭区间每一章——与旧直出行为对齐（v1 串行）；
          // 中途失败按既有错误映射返回（已启动的章节不回滚——工作流已入队列）
          if (chapterEnd !== undefined) {
            const started: { runId: string; displayName: string; chapterTag: string }[] = []
            for (let n = chapterNumber!; n <= chapterEnd; n++) {
              started.push(await startChapterWorkflow(workflow as 'generate_draft' | 'review' | 'refine' | 'finalize', n))
            }
            return {
              success: true,
              content: started.map(r =>
                t('tool.workflowStarted').replace('{name}', r.displayName).replace('{chapter}', r.chapterTag),
              ).join('\n'),
              artifacts: started.map(r => ({ type: 'workflow_started' as const, name: `${r.displayName} ${r.chapterTag}` })),
            }
          }
```

- [ ] **Step 5: 运行测试（绿）**

Run: `pnpm run test -- start-workflow.tool`
Expected: PASS（区间 5 例 + 既有错误映射 4 例）。

- [ ] **Step 6: Commit**

```bash
git add src/services/agent/tools/start-workflow.tool.ts src/services/agent/tools/start-workflow.tool.test.ts src/shared/locale-data/tool.ts
git commit -m "feat(agent): start_workflow 支持多章区间（chapter_end）——一次调用串行启动、一次确认（方案 B 配套）"
```

---

### Task 3: 收尾——死键登记 + 三门禁 + 文档回更

**Files:**
- Modify: `docs/superpowers/specs/2026-10-02-command-review-design.md`（状态与实施记录）
- Modify: `docs/2026-10-01-agent-command-review-design.md`（§4 线① 状态）

**Interfaces:**
- Consumes: Task 1 / Task 2 全部产物
- Produces: 三绿门禁 + spec 实施记录（含死键登记与 D1/D2 结论）

- [ ] **Step 1: 死键核查（登记，不删）**

```bash
git grep -n "agent.intentStarted\|agent.intentClarifyRefine" -- src
```

Expected: 仅剩 `src/shared/locale-data/agent.ts` 的定义（4 键：`intentStarted` / `intentStartedNoChapter` / `intentClarifyRefine` / `intentGuardFail`——实查比初稿多出第 4 键，随直出 catch 退役）。按仓库先例（`agent.comingSoon` 零引用键暂留字典）**不删**，登记进 spec 实施记录。

- [ ] **Step 2: 全量门禁（三绿）**

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
```

Expected: 全部 PASS（基线 2573 测试左右；以当前基线为准，零回归）。

- [ ] **Step 3: 文档回更**

`2026-10-02-command-review-design.md`：头部状态行改为「**✅ 已实施（2026-10-02，提交 …）**」；在文末追加「## 实施记录（2026-10-02）」小节：改动文件清单、Task 1/2 提交号、D1 结论（**扩展工具区间**，含用法）、D2 结论（**保留解析、退役执行**）、死键登记（3 键暂留）、真机验收（spec §6 四用例）**待跑**（按 computer-use 约束另立文档）。

`2026-10-01-agent-command-review-design.md` §4：线① 行补「✅ 已实施（2026-10-02，见该 spec 实施记录）」。

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-02-command-review-design.md docs/2026-10-01-agent-command-review-design.md
git commit -m "docs: 线① 实施记录回更（直出退场 + 区间扩展落地；死键登记；真机待跑）"
```

---

## Self-Review 记录

- **Spec 覆盖**：§4 改动清单 1/2/3 项 → Task 1；D1（区间）→ Task 2；D2（保留解析）→ Task 1 Step 5（注释级）；死键/门禁/文档 → Task 3；spec §6 真机四用例 → Task 3 登记为「待跑」（不在本计划，按 computer-use 约束另立文档）。
- **占位符扫描**：无 TBD / 无「类似上文」；所有步骤含完整代码与命令。
- **类型一致性**：`chapter_end`（工具）与 `chapter: { from, to }`（意图层）为两条独立链路（意图层区间不直连工具——模型自主决定是否用区间）；`started` 元素类型对齐 `startChapterWorkflow` 返回 `{ runId, displayName, chapterTag }`；`artifacts` 用 `as const` 满足 `ToolArtifact[]`。
- **Review Focus 落点**：①→Task 1 测试 2；②→Task 1 保留既有用例（Step 6 全跑）；③→Task 2 测试 4；④→Task 2 测试 5；⑤→Task 1 保留既有用例（`/status` 守卫、`@` 守卫）。
