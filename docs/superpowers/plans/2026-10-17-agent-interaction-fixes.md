# Agent 交互四项修复（添加模型 / 工具步骤语义 / 对话排版 / 设置文案，2026-10-17）

> **用户反馈**（原话要点）：
> 1. 「你那个添加模型哪里还没有改」；
> 2. 「AGENT 对话怎么能限制 AI 每一轮调用工具次数，不应该是同一步内最多同时运行多少个可并行的调用工具吗？」
>    并要求参考 `D:\Code\deepseek-harness` 看清「一轮」与「一步」；
> 3. 「AGENT 对话输出排版怎么这么乱，参考 D:\Code\deepseek-harness」；
> 4. 「上下文与压缩」设置项文案（历史预算 / 最小有效降幅 / 保留最新批数）有歧义。
>
> **状态**：✅ 已实现并合并；门禁全绿（tsc / eslint / 全量 vitest）。

---

## 一、添加模型：百万时代默认窗口 + 300K/600K/1M 快捷挡位

**根因**：新增模型时窗口回落链是 `maxTokens`（131072）——这是单次**输出**上限，不是窗口；
「其他」卡手填模型清空窗口也会被回填 131072，与上一批的 300K/600K/1M 上下文档位脱节。

**改动**
- `provider-presets.ts`：新增 `DEFAULT_CONTEXT_WINDOW_TOKENS = 1_000_000`；
  `presetModelDefaults` 窗口回落 = 手写 → pi-ai 规格 → **生成模型 1M**（向量模型仍回 `maxTokens`，不编造窗口）；
  `maxTokens` 回落保持 131072（NF 全局输出上限）。
- `ModelForm.tsx`：窗口留空/非法回填 1M；输入框下新增原生按钮快捷挡位 **300K / 600K / 1M**（300000/600000/1000000）；
  `tokenSpec()` 无预设窗口时回落 1M。
- 测试：`provider-presets.test.ts` +4、新增 `ModelForm.test.tsx` +7。

## 二、工具调用语义：对齐 DSH 的 turn / step 与并行上限

### DSH 的定义（`packages/core/agent-loop/README.zh.md`、`lib/index.js`）

| 概念 | 含义 |
|---|---|
| **turn（轮次）** | 一条用户输入（或排队的跟进输入）驱动的整个过程；可包含多个 step，直到 agent 停下 |
| **step（步骤）** | **一次模型请求 + 该次回复里的全部工具调用执行与结果回填**；步与步之间按模型顺序串行 |
| **一步内** | 可以有**多个工具调用**；并行安全（parallel-safe）调用共享一个滚动池，上限 `maxParallelToolCalls`（默认 **10**，可配置）；独占（exclusive）调用是排序屏障，单独执行 |
| **轮次预算** | DSH **没有内置轮次/步数预算**；失控轮次由生命周期扩展点取消 |

### NF 原实现的问题

- 引擎其实**已经支持**一步多个 `<tool_call>`（M1 分批：连续只读 Promise.all，写/确认串行），
  也不存在「每步调用个数」上限；
- 但系统提示词写着「**每次回复最多放一个** `<tool_call>`」——模型被要求一次只调一个，
  用户看到的“每次只调一个”正是提示词造成的；
- 文案把「轮次 / 步数 / 调用次数」混叫（`MAX_TOOL_ROUNDS = 8`、`maxToolRoundsReached` 说成「最大工具调用次数」）。

### 改动

- 新增 `src/services/agent/tool-scheduling.ts`：`MAX_PARALLEL_READ_TOOLS = 10` 唯一来源
  （只读批内并发；写/需确认工具串行）。`agent-engine` 改 import，`tool-registry.generateToolPrompt`
  用 `{maxParallel}` 注入实际值。
- 引擎常量/注释/文案统一为 **步骤（step）** 语义：`MAX_TOOL_ROUNDS → MAX_STEPS`（仍为 8，NF 的运行时安全上限；
  DSH 无此上限，差异见 §七）；`agent.maxToolRoundsReached → agent.maxStepsReached`，
  文案走 `{maxSteps}` 占位符（不在 locale 里硬编码 8）。
- `engine.toolSystemBody` 三语规则重写：
  1. **同一步（同一条回复）可以放多个** `<tool_call>`，互不依赖的调用放同一步；
  2. 只读工具同一步内自动**并行**（同一批最多 `{maxParallel}` 个），写/需确认工具**串行**；
  3. 保留结果回传、收到结果继续推理、不复述标签、写工具需确认；
  4. 有先后依赖的调用不要同批（等上一批结果）。
- 测试：`tool-registry.test.ts` 锁定三语语义 + 两个占位符注入 + 旧「最多一个」口径清零。

## 三、对话排版：文本与工具调用按步骤交错（参考 DSH）

**根因**：引擎把多步文本累加进同一条 assistant 消息，`toolCalls` 是扁平数组；`AgentMessage` 旧渲染顺序是
「**全部正文先渲染 → 全部工具卡堆底部**」——工具与它对应的正文步完全错位，多步任务看起来就是
「一坨文字 + 一坨工具」。DSH 的 chat 是按 step 顺序交错：正文段 → 工具行/过程组 → 下一段正文。

**改动**
- `ToolCallInfo` 新增可选 `contentOffset`（= 该调用被解析时 `fullAssistantText.length`；同一步多个调用相同）。
  追加可选字段，**archive 必填形状不变**，旧归档无该字段。
- `AgentMessage.tsx`：有 offset 时构建交错时间线（按 offset 分批，正文段后插工具批；≥2 个连续调用沿用
  `ProcessGroup`，单个走 `ToolCallBlock`）；offset clamp 到正文长度；旧归档回落旧布局；流式光标只跟最后正文段，
  末段是工具批时补在时间线尾部；正文段/工具批统一 8px 节奏、空正文段不占间距。
- 参考 DSH：`packages/client/ui-chat/src/client/chat/`（AssistantNodeView / MessageItem / ChatView.module.css /
  AssistantMarkdown.module.css / message-chrome）、`packages/client/ui-tool/src/`（ToolRow / ToolCallTree）。
  只对齐信息层级与节奏，不搬配色/组件库。
- 测试：`agent-engine.test.ts` 锁定 offset 单调/同轮相同/等于当轮正文累计；`AgentMessage.test.tsx` +6 例
  （正文段→工具卡→正文段 DOM 顺序、旧数据回落、offset 越界、光标只出现一次等）。

## 四、设置文案去歧义（上下文与压缩）

- `settings.compactionHistory` →「无窗口信息时的历史预算（tokens）」；desc 明确**只有模型未填窗口才用**，
  有窗口时改用「窗口 × 百分比」并受自动挡位约束（<600K→300K、600K–1M→600K、≥1M→1M）。
- `settings.compactionPercentDesc`：公式写清 `预算 = min(自动挡位, 模型窗口 × 百分比)`。
- `settings.compactionMinChange` →「压缩最小有效降幅（tokens）」；desc 说明「减少量低于它就不值得重写摘要，跳过本轮」。
- `settings.compactionKeep` →「保留最近压缩批数」；desc 说明「只保留最近 N 批卡片与分卷原文，更旧的释放；0 = 全部保留」。
- 顶部长说明同步新口径；`form.contextWindowHint` 补「常见 300K / 600K / 1M」。

## 五、验证

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 0 错误 |
| `npx eslint . --ext ts,tsx --max-warnings 0` | ✅ 0 错误 0 警告 |
| 全量 `npx vitest run` | ✅ **241 文件 / 2931 测试全过**（本轮新增 28 例：ModelForm 7 + 模型默认 4 + 工具语义 5 + 交错排版 6 + 引擎 offset/术语 6） |
| 关键测试 | `ModelForm.test.tsx` / `provider-presets.test.ts` / `tool-registry.test.ts` / `AgentMessage.test.tsx` / `agent-engine.test.ts` 全过 |

## 六、改动文件

| 文件 | 说明 |
|---|---|
| `src/shared/provider-presets.ts` (+test) | 1M 默认窗口；生成/向量分流 |
| `src/components/settings/ModelForm.tsx` (+新 test) | 1M 回填 + 300K/600K/1M 快捷挡位 |
| `src/services/agent/tool-scheduling.ts`（新增） | `MAX_PARALLEL_READ_TOOLS = 10` 唯一来源 |
| `src/services/agent/tool-registry.ts` (+test) | `{maxParallel}` 注入 |
| `src/services/agent/agent-engine.ts` (+test) | `MAX_STEPS` 术语、`contentOffset`、`{maxSteps}` 注入、import 调度常量 |
| `src/components/panels/agent/AgentMessage.tsx` (+test) | 交错时间线渲染 |
| `src/components/panels/agent/ProgressLabel.tsx` | `MAX_STEPS` 注释 |
| `src/shared/locale-data/workflow.ts` / `agent.ts` | 工具规则三语、步骤上限文案 |
| `src/shared/locale-data/ui.ts` | 上下文与压缩文案去歧义（三语） |

## 七、已知差异 / 后续

1. **并行安全判定**：NF 用 `isReadOnly && !requiresConfirmation` 作为可并行条件；DSH 用工具声明的
   `executionMode`（parallel / exclusive）并在启动前可重分类。若要更精细（如“只读但内部有共享状态”的工具），
   需给 `AgentTool` 增加显式调度声明，另批处理。
2. **步数上限**：NF 保留 `MAX_STEPS = 8`（防死循环的安全上限）；DSH 无内置预算（靠 turn-stopping 扩展点）。
   用户可继续发消息续跑；若希望可配置/取消上限，可另加设置项。
3. **子 agent 预算**：子 agent 仍不传 `modelContextWindow`（走引擎 16K 默认消息预算），与父 agent 的挡位不一致；
   如需继承父策略，应在 `SubAgentDeps` 增加 engineOptions，另批立项。
4. **存量模型窗口**：内置默认值与新增流程已改；已手动保存的 `models.json` 条目仍以用户值为准
   （如旧 `deepseek-flash` 仍可能是 131072，需要用户改窗口或做一次性迁移）。
