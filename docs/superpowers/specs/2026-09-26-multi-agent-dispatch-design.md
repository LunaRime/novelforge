# 多 agent 拆分派发（C 档第二轮）设计

> **Status**: 设计阶段（用户 2026-09-26 已拍板三条：范围 = 子会话 + 回收 + untrusted（顺序执行）；子 agent 写权限 = 只读 + 写操作转父方审批；§7.1-C2 不带）
> **依据**: `docs/superpowers/plans/2026-09-08-agent-capabilities-plan.md` §7.1-C 多 agent / §7.1-E1（子 agent UI）/ §7.1-E5（untrusted 标注）/ §7.2#10（只借「委派白名单」）/ §7.3（Denova 式路线）
> **参照**: Denova `internal/agents/`（`task` 工具 + mailbox 汇合 + 子 Session 权威 + 幂等 TaskRef）+ `agent/tools/task_local_completion.go`（TASK_RESULT 标 untrusted 并截断）

## 1. 目标与非目标

### 1.1 目标

让主 agent 能把**可独立完成的子任务**派给子 agent：子 agent 有自己的上下文与工作循环、自己的转录（用户可见、可回放），结果回到主 agent 时**显式标注为不可信委派产物**。

用途（真实场景）：主 agent 在写第 30 章前，把「查清前 29 章里所有与玉佩相关的伏笔」派给子 agent——子 agent 用 `read_memory` / `search_knowledge` / `read_drafts` 翻找并汇总，主 agent 只拿到一段结论，而不是把 29 章的检索过程全部塞进自己的对话历史。

### 1.2 非目标（本轮明确不做，理由随列）

| 不做 | 理由 |
|---|---|
| **并行派发**（一次派 N 个） | 用户已拍板顺序执行。并行要先把控制面按任务分桶（`activeAbortController` / `activeStreamRequestId` / `generationSeq` / `pendingConfirmations` / 前缀记账），风险与工作量翻倍；本轮先把单任务链路做扎实 |
| **子会话开成工作台 Tab**（`parentTabId`） | 同上（E1 的完整形态）。本轮子会话在**父时间线内**可展开查看 |
| **子 agent 继承父的对话历史** | 派发的价值就在上下文隔离；继承会让 token 成本与父相等（Denova 也是空白起步） |
| **子 agent 不经审批的写盘** | 用户拍板「写操作转父方审批」（§3.5）：写工具在白名单内，但每次调用都过父方确认卡（命中 workspace 规则才放行） |
| **按 tier 自动给子 agent 换便宜模型** | 省钱但可能降质，需实测数据支撑；本轮**继承父会话模型**，tier 路由留待后续（与 A 档动态策略解耦） |
| **§7.1-C2 配置四层覆盖 + Checkpoint 保留偏好** | 用户拍板另开一轮 |
| **递归派发**（子 agent 再派子 agent） | 深度爆炸 + 确认链复杂；`task` 工具不进子 agent 的白名单（结构性禁止，不靠提示词约束，§3.4） |
| **MCP 工具对子 agent 开放** | 来源不可控（第三方服务器），子 agent 的自动执行面不该扩到那里，留待后续轮次显式授权 |

## 2. 参照实现的关键事实与取舍

| # | Denova 事实（证据） | 我们的取舍 |
|---|---|---|
| 1 | `task` 工具派子 agent；结果以 **UserMessage** 注入父端，显式标 `untrusted delegated output` 并**截断**（超出提示改用 `task observe` 回放） | 抄（§3.6） |
| 2 | **mailbox 汇合**：子 agent 的产物/结论经 mailbox 回父 | 抄语义，实现走「工具返回值 + 子会话转录」（NF 没有独立 mailbox 进程，工具结果就是汇合点） |
| 3 | **子 Session 权威**：子转录独立存储，父只拿结论 | 抄（§3.7 落盘在会话 `subSessions`） |
| 4 | **幂等 TaskRef**：同一任务重复派发返回同一运行 | 抄（§3.8，按「本轮 + 任务指纹」去重） |
| 5 | **委派白名单**（§7.2#10：NF 只借这一条 + context slot 分层） | 抄：引擎侧 **fail-closed** 白名单（§3.4），不是靠提示词 |
| 6 | ⚠️ `context: fork`（子 agent 复用父上下文的分支） | **不抄** —— Denova 自己都没实现（`types.go:26` 定义、零消费者） |
| 7 | 子 agent 的结果**不自动回写**用户数据（写入走父） | 抄（与用户「写操作转父审批」的拍板一致） |

## 3. 设计

### 3.1 模型侧通道：`task` 工具

单个内置工具（**不用** `action` 枚举 —— 参数形状本身就区分语义，省工具提示词预算）：

```ts
task({ description, prompt?, tools?, task_id? }) → string
```

| 入参 | 行为 |
|---|---|
| `description`（必填） | 子任务的一句话说明（也是 UI 卡片标题、幂等指纹的一部分） |
| `prompt`（可选） | 给子 agent 的详细指令；缺省 = `description` |
| `tools`（可选） | 请求的工具名子集（只读白名单内的交集）；缺省 = 全部只读工具 |
| `task_id`（可选，**给了就忽略其余参数**） | 回放已完成的子会话转录（`task observe` 的 NF 形态） |

- `requiresConfirmation: false` / `isReadOnly: true`：**派发本身不需要确认**（子 agent 的写操作各自走父方审批卡，§3.5）
- 返回形状（正文见 §3.6）：`## 子 agent 结果（untrusted delegated output）` + 结论 + 截断提示（`task(task_id)` 回放）
- 工具描述里写明边界：**子 agent 看不到当前对话历史**，故 prompt 必须自带上下文交代

### 3.2 子 agent 运行体

新建 `src/services/agent/subagent/`（本轮 4 个文件）：

| 文件 | 职责 |
|---|---|
| `types.ts` | `SubAgentSession` / `SubAgentTask` / `SubAgentStatus` / `SubAgentOutcome` |
| `runner.ts` | `runSubAgent(opts)`：装配 scoped system prompt → 调 `runAgentLoop` → 收集转录与产物 |
| `prompt.ts` | 子 agent 身份提示词 + scoped 装配（L0 + 常驻记忆 + 记忆目录 + 白名单工具） |
| `taskref.ts` | 幂等 TaskRef：任务指纹与查重 |

**关键事实（已核验）**：`runAgentLoop(systemPrompt, history, userMessage, modelId, generateFn, callbacks, abortSignal, options, deps)` 是纯函数式引擎，**不碰任何 store**（`agent-engine.ts:130-140`）。故子 agent 只需再调一次它，用自己的 callbacks 写自己的转录 —— 这正是「不改控制面就能加子 agent」的支点。

子 agent 的固定参数：
- `historyMessages: []`（空白起步，隔离）
- `modelId`：继承父会话（§1.2）
- `abortSignal`：父的 signal 的**子 signal**（父取消 → 子取消，§3.9）
- `options.allowedTools`：白名单（§3.4）
- callbacks：写入子会话转录；`onToolCallConfirmRequired` 转父方审批（§3.5）
- 轮数上限：复用引擎 `MAX_TOOL_ROUNDS = 8`（子任务不需要比父更长）

### 3.3 scoped system prompt

子 agent 的系统提示词 = **子 agent 身份** + **项目 L0** + **常驻记忆段** + **记忆目录段** + **白名单工具提示词**。

- 身份：`prompt.ts` 内的专用短提示词（不是父的 `buildIdentityPrompt`，也不走 mode 六档）——明确「你是被派来执行单一子任务的执行者；你没有对话历史；不要派发新任务；需要写操作时明确说明并等待」。
- L0 / 常驻记忆 / 记忆目录：**复用父的既有逻辑**（C 档第一轮成果）。做法是把 `context-builder.ts` 里的记忆分层装配抽成可复用函数（`collectMemoryLayers()`），父装配与子装配共用，避免复制粘贴漂移。
- 工具提示词：`toolRegistry.generateToolPrompt()` 增可选入参（工具子集），子 agent 只看到白名单内的工具契约。
- **预算**：子 agent 系统提示词独立预算（`SUBAGENT_PROMPT_BUDGET_TOKENS = 3000`），超限按「常驻 → 目录 → 工具描述」顺序降级；缺省不带 L1（编辑器上下文与子任务无关）。
- 子 agent **不注入**：技能目录、会话滚动摘要（M1）、RAG 自动检索、manual 的 `@` 注入（那是父轮次语义）。

### 3.4 委派白名单（引擎侧 fail-closed）

`AgentEngineOptions` 增 `allowedTools?: string[]`：

- `agent-engine.ts:316`（`toolRegistry.get(tc.name)`）前加守卫：**不在白名单 → 不执行**，直接注入失败观察（含白名单集合，便于模型改道）。
- `agent-engine.ts:449` 的「未知工具」观察文案：在子 agent 上下文里列**白名单**而不是全量注册表（否则等于告诉模型去调它不能调的工具）。
- 白名单缺省（父）为 `undefined` = 全量，行为与现状逐字一致。

**子 agent 的白名单构成**（两段，语义不同）：

| 段 | 内容 | 是否广告给模型 | 执行语义 |
|---|---|---|---|
| 只读段 | 只读工具 ∩ `task` 工具的 `tools` 参数（未知名字丢弃）；缺省 = 全部只读工具 | ✅ 进子 agent 的工具提示词 | 直跑（§3.5） |
| 写段 | 固定集合：`write_file` / `edit_file` / `open_editor` / `start_workflow` / `update_config` / `index_content` / `call_external_api` | ✅ 同样广告（模型需要知道「可以请求写」） | **每次调用必过父方审批卡**（§3.5），命中 workspace 规则才放行 |

- **结构性排除**：`task` 自身不在白名单（禁止递归派发）、`skill` 元工具不在（子任务不需要加载技能，省预算）、MCP 工具不在（来源不可控，留待后续轮次显式授权）。
- 白名单是**引擎级 fail-closed**：不在名单里的工具（含模型幻觉出的名字）不执行，观察文案给出白名单集合。

### 3.5 子 agent 的写操作 → 父方审批

复用 A 档的决策层（`src/services/agent/approval/`），判定顺序与父一致，只有「转人工」的目的地不同：

| 判定 | 子 agent 行为 |
|---|---|
| `matchCritical` 命中（危险路径 / 越界 / 外发凭据） | **硬拒绝**（沿用 A 档），子 agent 收到失败观察 |
| 只读工具 | 直跑（不打扰） |
| workspace 规则命中（用户此前「始终允许」过该工具） | 放行（**沿用用户自己的常驻批准**，不重复打扰——这是 A 档批准记忆的本意） |
| 其余（未覆盖的写操作） | **转父方审批卡**：`agent-store` 增 `pendingSubAgentConfirmation: { sessionId, toolCall, resolve } \| null`；UI 在输入框上方渲染带来源标签的确认卡（「子 agent『查玉佩伏笔』请求执行 write_file：drafts/c30.md」+ 允许 / 拒绝）；allow-once 生效，不固化 |
| 子 agent 请求 `always` | 卡片**不提供**「始终允许」——子 agent 的批准不写 workspace 规则（避免委派路径放大用户的常驻授权） |

父方无人在场（例如自动化触发器 headless 运行）→ 未覆盖的写操作**超时即拒绝**（fail-closed，`SUBAGENT_CONFIRM_TIMEOUT_MS = 120_000`），并把拒绝原因写进子会话转录。

### 3.6 结果回收与 untrusted 标注

工具返回值（即父端收到的 `tool_result`）：

```
## 子 agent 结果（untrusted delegated output — 引用前请自行核验）
<子 agent 的结论，最多 SUBAGENT_RESULT_MAX_TOKENS = 1200 tokens>

子会话 3a7f1c（12 步 · 5 次工具调用 · 4.2k tokens）——用 task(task_id="3a7f1c") 回放完整转录。
```

- `description` 与 `task_id` 一并给出，便于父端引用与回放
- **untrusted 标注是硬要求**（§7.1-E5 的理由：委派产物可能被检索到的文本污染 → 提示注入面）；文案里点明「引用前自行核验」
- 子 agent 的产物（`ToolArtifact[]`）与**副作用回执**（B 档第二轮的 `extractSideEffectReceipts`）合并进父消息的 artifacts，父端压缩时回执照常随摘要保留
- 子会话失败/超时：返回 `success: false` + 失败原因 + 已完成的转录摘要（不静默）

### 3.7 子会话数据模型与落盘

```ts
interface SubAgentSession {
  id: string                      // 短 id（8 位，任务卡与回放引用）
  taskId: string                  // 幂等指纹（§3.8）
  description: string
  prompt: string
  allowedTools: string[]
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  messages: AgentMessage[]        // 子转录（与父同形状，复用既有渲染）
  toolCalls: ToolCallInfo[]
  artifacts: ToolArtifact[]
  result: string                  // 最终结论（= 注入父端的那段，未截断）
  error?: string
  startedAt: number
  endedAt?: number
  tokensIn?: number
}
```

- 挂在 `AgentConversation.subSessions?: SubAgentSession[]`（与 `compressed` / `rewound` 同层），随归档一起落盘
- 上限：单会话 `MAX_SUB_SESSIONS = 20`（超出丢最旧）、单子会话转录 `MAX_SUBAGENT_MESSAGES = 60`
- 归档 codec（`archive-codec.ts`）：解析时防御式处理（形状损坏 → 过滤该条，同 `compressed` / `rewound` 的口径），并做**净化**（子转录里的 tool_call/thinking 残片走既有 `sanitize` 路径）
- `/clear` 一并清空 `subSessions`（与 `compressed` 同处置）

### 3.8 幂等 TaskRef

- `taskId = hash(conversationId + description + allowedTools.join(','))` 前 8 位（纯函数，可单测）
- **同一会话内**：该 taskId 已有 `running` 会话 → 直接返回「该子任务正在执行」（不重复派发）；已有 `completed`/`failed` 会话 → 返回既有结果 + 提示可用 `task_id` 回放；没有 → 新建
- 语义边界：指纹只含**任务形状**，不含时间 —— 用户改了 prompt 再派发会命中同一指纹（这是刻意的：避免模型在 ReAct 循环里反复派同一任务烧 token；需要重跑则用不同的 description）

### 3.9 取消与预算

- **取消传播**：父的 `AbortController` 取消 → 子 runner 的 signal（`AbortSignal.any`/派生的子 controller）一并 abort → 子会话置 `cancelled`、转录保留（可见「为什么中断」）
- **执行预算**：`SUBAGENT_MAX_MS = 300_000`（5 分钟）超时中断 → `failed` + 原因
- **token 预算**：子 agent 的生成调用计入既有 `llm_calls` 日志（`purpose: 'subagent'`），父端 usage 面板可见成本；子会话记录 `tokensIn`
- 子 agent **不阻塞父的其它能力**：父在本轮 `await` 子 agent 完成（顺序执行的必然结果），期间父的 UI 显示子会话卡为 `running`

### 3.10 UI：`SubAgentSessionCard`

- **位置**：父时间线内，挂在触发了 `task` 调用的助手消息下（与 `CompressedBatchCard` 同族，在 `AgentConversation` 的消息列表里按 `messageId` 关联）
- **形态**：状态图标 + `description` + 步数/工具数/tokens + 可展开转录（复用 `AgentMessage` 渲染子消息）+ 失败时显示原因
- **不打开工作台 Tab**（本轮非目标）；展开即看全文
- 运行中卡片显示 spinner 与「取消」入口：**只中止该子 agent**（子会话置 `cancelled`、父收到「已取消」的工具结果并继续自己的循环），**不**取消父生成——与「停止全部」是两个不同动作（父的取消按钮仍停父，且会连带中止所有子 agent，§3.9）
- 确认卡（§3.5）渲染在输入框上方（与既有确认卡同区）

## 4. 测试策略

| 层 | 用例 |
|---|---|
| 白名单（引擎） | 白名单内 → 执行；白名单外 → 拒绝且观察含白名单集合；缺省（undefined）→ 行为与现状逐字一致；未知工具文案在子上下文里只列白名单 |
| TaskRef | 指纹稳定（同输入同值）；同会话内 running → 不重复派发；completed → 返回既有结果 |
| runner | 空白起步（子 system prompt 不含父历史）；scoped 提示词含 L0/常驻/目录且**不含**技能目录/M1；独立 signal 可取消；超时 → failed；预算超限 → 按序降级 |
| 写操作审批 | critical → 硬拒绝（无卡）；只读 → 直跑；规则命中 → 放行无卡；未覆盖 → 出卡且**无**「始终允许」；拒绝 → 子 agent 收到失败观察；超时 → 拒绝 |
| 结果回收 | TASK_RESULT 含 untrusted 标注 + task_id；超 1200 tokens 截断 + 回放提示；产物/回执并入父消息；失败不静默 |
| 落盘 | 归档 round-trip 保 `subSessions`；形状损坏 → 过滤；子转录净化；`/clear` 清空；上限裁剪 |
| UI | 卡片渲染状态/计数；展开显示子转录；运行中有取消入口；确认卡带来源标签 |

## 5. 文件结构

| 文件 | 动作 |
|---|---|
| `src/services/agent/subagent/types.ts` | 新建：子会话与任务类型 |
| `src/services/agent/subagent/prompt.ts` | 新建：子 agent 身份 + scoped 装配 |
| `src/services/agent/subagent/runner.ts` | 新建：`runSubAgent` |
| `src/services/agent/subagent/taskref.ts` | 新建：幂等指纹 |
| `src/services/agent/tools/task.tool.ts` | 新建：`task` 工具 |
| `src/services/agent/tools/index.ts` | 注册（靠前，契约须在提示词截断线内） |
| `src/services/agent/agent-engine.ts` | `AgentEngineOptions.allowedTools` + 两处守卫（工具解析 / 未知工具文案） |
| `src/services/agent/context-builder.ts` | 抽出 `collectMemoryLayers()`（父/子共用）+ `generateToolPrompt(subset)` 支持 |
| `src/services/agent/tool-registry.ts` | `generateToolPrompt(tools?: AgentTool[])` 可选入参 |
| `src/services/agent/archive-codec.ts` | `subSessions` 序列化 / 防御式解析 / 净化 |
| `src/stores/agent-store.ts` | `subSessions` 状态与动作、`task` 工具接线（runner 注入依赖）、子 agent 审批卡状态、取消传播、`/clear` |
| `src/components/panels/agent/SubAgentSessionCard.tsx` | 新建：子会话卡 |
| `src/components/panels/agent/SubAgentConfirmCard.tsx` | 新建：带来源标签的确认卡 |
| `src/components/panels/agent/AgentConversation.tsx` | 渲染子会话卡 + 确认卡 |
| `src/shared/locale-data/*` | 三语文案 |

## 6. 风险

| 风险 | 处置 |
|---|---|
| 子 agent 烧 token（模型派发过滥） | 幂等 TaskRef + 单会话 20 个子会话上限 + `purpose: 'subagent'` 用量可见；派发本身不受限（模型自主），但可见可查 |
| 委派产物污染父上下文 | untrusted 标注 + 截断 + 回放（§3.6）；写入一律过父审批（§3.5） |
| 控制面单例被绕开 | 子 runner **不经** `agent-store.sendMessage`，自持状态；父单例只在「取消传播」与「确认路由」两处被显式接线（要测） |
| 归档膨胀 | 单子会话消息数上限 + 单会话子会话数上限；归档体积在 `MAX_SUB_SESSIONS × MAX_SUBAGENT_MESSAGES` 内有界 |
| 与自动化触发器（D 档）叠加 | headless 运行的子 agent 无人审批 → 超时拒绝（§3.5），D 档无需改动 |
