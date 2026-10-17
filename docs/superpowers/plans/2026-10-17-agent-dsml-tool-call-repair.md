# Agent 对话 DSML 工具调用泄漏修复（2026-10-17）

> **起因**：用户 `pnpm run dev` 真机 AGENT 对话测试仍报问题。取 2026-10-17 18:43 的
> 真实会话归档与主/渲染日志复现，根因不是 UI 接线，而是 **DeepSeek V4.1 把原生工具调用
> 以 DSML 文本泄漏进 assistant content，旧引擎只认 `<tool_call>` XML，导致原文上屏 +
> 工具不执行 + ReAct 循环提前收尾**。
>
> **状态**：✅ 根因已定位（含真实归档证据）→ ✅ 方案定稿 → ✅ 已执行（A/B/C 三线并行 + D 独立核查，
> 核查反例 A/G/C 复盘修复后二次门禁全绿；真机 LLM 对话端到端待用户复测，见 §六）

---

## 一、证据链（先证伪「UI 问题」假设）

### 证据 1 — 真实会话归档（决定性）

`C:\Users\0\.novelforge\agent-archive\e4232e0c-6544-4095-bef3-b6cfd5f8e245.json`
（标题「审查1到11章节」，项目 `斗罗大陆虚界之痕`，模型 `deepseek-flash`，写入时间 18:45:49）。
assistant 正文末尾逐字符为（`｜` = U+FF5C 全角竖线）：

```
我先摸清项目现状与审阅方法，再逐章过一遍。……（正文）
<｜｜DSML｜｜ calls>
<｜｜DSML｜｜ invoke name="read_file">
<｜｜DSML｜｜ parameter name="file_path" string="true">C:\Users\0\.novelforge\agent-results\3252294d1e4f.txt</｜｜DSML｜｜ parameter>
<｜｜DSML｜｜ parameter name="offset" string="false">440</｜｜DSML｜｜ parameter>
<｜｜DSML｜｜ parameter name="limit" string="false">2000</｜｜DSML｜｜ parameter>
</｜｜DSML｜｜ invoke>
</｜｜DSML｜｜ calls>
```

同一条消息的 `toolCalls` 只有前 5 个已执行调用（list_chapters / skill / read_architecture /
read_drafts / read_file 全量首段），**这个带 offset 的 read_file 没有进 toolCalls** ——
泄漏块没有被解析，循环把它当最终文本 `onDone` 了。

### 证据 2 — 开发日志时间线

`~/.novelforge/logs/dev/vela-dev-2026-10-17.log`：18:43:07 打开项目库；18:43:50—18:44:13
跑定稿工作流（与 Agent 无关）；18:53:08 最后一次 dev 启动。归档 18:45:49 正好落在本段
dev 运行内，确认是用户本轮对话测试。

### 证据 3 — 上游行为已定性

- **deepseek-ai/DeepSeek-V3 issue #1678**：`deepseek-flash`（含 `deepseek-v4-flash`）在
  OpenAI 兼容端点 `/chat/completions` 上，**当历史带工具调用痕迹而当前请求省略 `tools`
  数组时**，会把内部 `<｜DSML｜ …>` 信封当正文返回：`finish_reason: "stop"`、
  `tool_calls: null`。同一 messages 重发 `tools` 则恢复结构化 `tool_calls`。
- **vLLM `parser/deepseek_v32`**：给出 V3.2/V4 的 DSML 输出格式（V3.2 外层
  `function_calls`、V4 外层 `tool_calls`）。
- **amrita_plugin_deepseek**：给出三代格式差异 —— V3/R1 `<｜DSML｜function_calls>`、
  V4 `<｜｜DSML｜｜tool_calls>`、**V4.1 `<｜｜DSML｜｜ calls>`（`calls` 前有空格）**。
  本次真实样本正是 V4.1 形态。

### 证据 4 — 代码断点（修复前）

| 环节 | 位置 | 实况 |
|---|---|---|
| 工具协议 | `locale-data/workflow.ts` `engine.toolSystemBody` | 系统提示要求模型输出 `<tool_call>{"name","arguments"}</tool_call>` 文本块 |
| 解析器 | `agent-engine.ts:parseToolCalls` | 只匹配 `<tool_call>…</tool_call>`，对 DSML 零识别 |
| 流式上屏 | `agent-store.ts` onTextChunk / `subagent/runner.ts` stripToolTags | 只清 XML 标签，DSML 原样进正文 |
| 恢复净化 | `conversation-recovery.ts` cleanupMessageText | 只清 XML/think 残片 → 旧归档重启后仍显示 DSML |
| 兜底 | 引擎「无 tool_call → onDone」 | 泄漏文本被当最终回复，任务静默半途而废 |

---

## 二、参考实现对比（用户指定的三个参考项目）

| 项目 | 工具调用链路 | 对本修复的含义 |
|---|---|---|
| `D:\Code\deepseek-harness` | DeepSeek **Messages API**（`https://api.deepseek.com/anthropic` 风格），工具以结构化 content block 发送/接收（`tool-call` / `tool_result`），适配器不写提示词散文（见 `packages/llm/llm-deepseek/README.zh.md`） | 根本解是原生工具协议，**不存在文本泄漏**；但迁移成本高（请求/流式/IPC/引擎全部改），本轮不做，列入后续架构项 |
| `D:\Code\denova` | OpenAI Chat Completions 协议 + `RepairTextToolCalls` 兼容层：`internal/compat/polyfill.go` 把供应商塞进正文的 `<tool_call><invoke name=…><parameter …>` 文本**提升为结构化 ToolCall**，流式用 `textToolCallStreamRepair` 做跨 chunk 修复 | 直接印证「文本工具调用 repair 层」是可行且成熟的工程做法；本修复采用同思路，但格式换成 DeepSeek DSML |
| `D:\Code\Claude-code-2.1.188-源码学习` | Anthropic 原生 `tool_use`/`tool_result` content block + 流式 `input_json_delta` 组装 | 同 DSH：结构化协议是正解；NF 现有文本协议属历史债 |

**本轮取舍**：不迁移原生工具协议（会同时改动 LLM provider、IPC 签名、引擎、提示词与
全部既有测试），先加一层**只读 repair**：DSML → 既有 `ParsedToolCall`，语义与 XML 协议
完全同构，失败时走既有 `parseDiagnosis` 自修正。这符合仓库「不改公开接口 / 最小 diff」
的既有约束，也把上游行为差异关在单个纯函数模块里。

---

## 三、修复设计（四线并行，写域互斥）

### A. 核心解析器（新增纯模块）

`src/services/agent/dsml-tool-calls.ts`，导出：

```ts
export interface DsmlToolCall { name: string; arguments: Record<string, unknown> }
export interface DsmlParseError { rawContent: string; reason: string; suggestion: string }
export function containsDsmlMarkup(text: string): boolean
export function parseDsmlToolCalls(text: string): { textParts: string[]; toolCalls: DsmlToolCall[]; parseErrors: DsmlParseError[] }
export function stripDsmlMarkup(text: string): string
export function buildUnparsedDsmlError(rawContent: string): DsmlParseError
export function createDsmlStreamFilter(): { push(chunk: string): string; flush(): string }
```

覆盖三代 token：`<｜DSML｜` / `<｜｜DSML｜｜`；外层 `function_calls` / `tool_calls` /
` calls`；wrapper 可缺失；多 wrapper / 多 invoke；`string="true|false"` 参数类型
（`false` 按 JSON literal 解析，失败回退字符串）。

### B. 表层清理（旧档案 / 子 agent / 落盘）

- `conversation-recovery.cleanupMessageText`：追加 `stripDsmlMarkup` → 旧归档恢复时自动净化
  （`archive-codec.parseArchive` 消费 `sanitizeMessageList`，无需改持久化格式）。
- `subagent/runner.stripToolTags`：子 agent 转录不再出现 DSML。
- `agent-store` onTextChunk / onDone：父会话流式与最终落盘防线。

### C. 引擎接线（Lead 执行）

1. `parseToolCalls` 拆为内部 `parseXmlToolCalls` + 对外统一入口：**无 DSML 走快路径逐字
   兼容**；命中 DSML 时先摘块收集调用，再对剩余正文跑 XML 解析合并。
2. 正文清洗追加 `stripDsmlMarkup`（半截/残留标记兜底）。
3. 每轮 `createDsmlStreamFilter()` 包住 `onTextChunk`，生成结束 `flush` 残余 —— 用户不再
   看到流式闪现的原始标记。
4. 兜底：DSML 存在但零调用且零解析错误时，注入**一次** `engine.parseDiagnosis`
   （`buildUnparsedDsmlError`）继续一轮，禁止当最终回复收尾（一次性防烧轮次）。
5. `console.warn` 留诊断日志，真机再次出现时可在日志追踪。

### D. 独立核查

真实归档样本回放 + `git diff` 逻辑审查 + 全量门禁复跑，按「证伪」口径逐条给 HOLDS/反例。

---

## 四、明确不做

| 项 | 理由 |
|---|---|
| 迁移 DeepSeek Messages API / 原生 tools | 需改 provider 请求体、流式协议、IPC 通道签名、引擎回调契约与全部相关测试；本轮按用户「还是有问题」的现场修复优先，列为后续架构项 |
| 给系统提示追加「禁止 DSML」 | 模型原生格式偏好不可靠靠提示词压制（issue #1678 复现温度 0）；解析 repair 才是确定性防线。提示词保持现状，避免引入新 token 漂移 |
| 在 `sanitizeObservation` 剥离 DSML | 工具结果可能是用户正文（read_file/edit_file 往返），剥离会污染数据；DSML 只可能来自模型回复，解析入口足够 |
| 新增 UI 提示/i18n 用户文案 | 修复对用户透明；新增两条 i18n 仅用于回喂 LLM 的诊断（`engine.parseReasonDsml` / `engine.parseSuggestionDsml`，三语齐备） |

---

## 五、验证清单

自动化：

1. `npx vitest run src/services/agent/dsml-tool-calls.test.ts`（核心格式矩阵）
2. `npx vitest run src/services/agent/agent-engine.dsml.test.ts`（真实样本 → 执行 → 不上屏 → 诊断兜底）
3. `npx vitest run src/services/agent/conversation-recovery.test.ts src/services/agent/subagent/runner.test.ts src/stores/agent-store.test.ts`
4. `npx tsc --noEmit` / `npx eslint . --ext ts,tsx --max-warnings 0` / `npx vitest run`（全量）

真机（修复后用户复测 / Lead 复核）：

5. 发一条会触发多轮工具的消息（如「审查 1-11 章节」）→ 不再出现 `<｜｜DSML｜｜` 原文；
   工具卡片正常出现并继续到最终回复。
6. 打开旧会话「审查1到11章节」→ 归档恢复后正文不含 DSML 残片。
7. 断开重进 / 重启应用 → 修复后的会话仍干净。

---

## 六、执行记录（2026-10-17）

**已执行完毕**：A（核心解析器）/ B（表层清理）/ C（引擎接线）三线并行，D 独立核查后对
3 个反例做复盘修复，二次门禁全绿。

### 实际改动清单

| 文件 | 改动 | 测试 |
|---|---|---|
| `src/services/agent/dsml-tool-calls.ts` | 新增 ~500 行纯模块：`containsDsmlMarkup` / `parseDsmlToolCalls` / `stripDsmlMarkup` / `stripDsmlTokens` / `buildUnparsedDsmlError` / `createDsmlStreamFilter` | `dsml-tool-calls.test.ts` **41 例** |
| `src/services/agent/agent-engine.ts` | `parseToolCalls` 拆内部 XML + DSML 合并入口；正文 `stripDsmlMarkup`；每轮流式过滤；一次性 DSML 诊断兜底；`sanitizeObservation` 增 `stripDsmlTokens` | `agent-engine.dsml.test.ts` **8 例**（真实样本执行/不上屏/混排/兜底/注入面） |
| `src/services/agent/archive-codec.ts` | `parseArchive` 对 `subSessions[].result` 走 `stripDsmlMarkup`（核查反例 G） | `archive-codec.test.ts` +1 |
| `src/services/agent/conversation-recovery.ts` | `cleanupMessageText` 追加 `stripDsmlMarkup`（旧档案恢复净化） | `conversation-recovery.test.ts` +3 |
| `src/services/agent/subagent/runner.ts` | `stripToolTags` 追加 DSML 清洗；`onDone` 的 `session.result` 改用清洗后全文 | `runner.test.ts` +2 |
| `src/stores/agent-store.ts` | onTextChunk / onDone 落盘防线追加 DSML 清洗 | `agent-store.test.ts` +1 |
| `src/shared/locale-data/workflow.ts` | +2 条三语 key（`engine.parseReasonDsml` / `engine.parseSuggestionDsml`，仅回喂 LLM 诊断） | i18n 唯一性由既有守卫覆盖 |

### 质量门禁（最终，复盘修复后）

| 门禁 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 0 错误 |
| `npx eslint . --ext ts,tsx --max-warnings 0` | ✅ 0 错误 0 警告 |
| `npx vitest run` | ✅ **240 文件 / 2900 测试全过**（本轮新增 57 例） |
| `npx vite build` | ✅ 主进程 / preload / 渲染层三产物构建通过 |
| 真实归档 `parseArchive` 回归 | ✅ 临时用例直读事故归档 → assistant 正文无 DSML、正文逐字保留（跑后删除，不入库） |
| `pnpm run dev` 启动冒烟 | ✅ 主进程「NovelForge 启动完成」+ 渲染层「HTML→JS 模块加载耗时 486ms」<br>注：本会话 shell 带 `ELECTRON_RUN_AS_NODE=1`（会让 Electron 以纯 Node 跑而报 `electron.app undefined`），清掉该环境变量后启动正常——环境变量问题，非代码回归 |

### 独立核查结论（verifier，证伪式）

- **主链全部 HOLDS**：真实归档逐字节样本 parse/strip/流式（含全部 485 个二切分点、400 组
  随机分块）；引擎端到端（执行/无泄漏/无双推/取消无状态泄漏）；恢复链路
  `restoreArchives → parseArchive → sanitizeMessageList`；user/system 逐字保留；
  `session.result` 唯一消费点；无正则回溯/状态机死循环（200k 字符畸形文本 parse 7–12ms）。
- **反例 A（安全面，已修 + 二次加固）**：`sanitizeObservation` 原只剥 `<tool_call>` 不剥 DSML token，
  不可信工具结果被模型回吐后可执行成真实调用。→ 新增 `stripDsmlTokens`（只剥 token、不删块
  内容，避免污染 read_file 正文）+ 引擎级注入回归。**二次复核 A3**：单趟 `replace` 可在删除接缝
  「删出新 token」（`<｜<｜DSML｜DSML｜` → `<｜DSML｜`）→ 已改为循环到不动点（长度严格递减必终止）
  + 构造输入用例；既有 XML `sanitizeObservation` 同病属历史遗留（未扩大现状，本轮不扩大写域）。
- **反例 G（旧档边缘，已修）**：旧版 runner 泄漏的 DSML 可能落在 `subSessions[].result`，
  幂等重放会塞回父上下文。→ `parseArchive` 恢复时净化 result + 用例。
- **缺口 C（已补）**：新兜底分支原无测试（现有用例实际走 parseErrors 路径）。→ 新增
  「无完整标签 token（0 calls/0 parseErrors）命中一次性兜底」用例（console.warn 断言分支）。
- **反例 B（已降级为已知限制）**：同回合 XML+DSML 混排时执行顺序 = DSML 在前，不保证与正文
  出现顺序一致；已在 `parseToolCalls` 注释写明，不改代码（真实场景极罕见）。
- **NIT（已修）**：`conversation-recovery.ts` 头注释「零运行时依赖」过时。
- **顺带发现、与本修复无关的旧 bug（未混入本轮）**：`subagent.resultFooter` 有两个 `{id}`
  占位符而 `formatSubAgentResult` 只 `replace` 第一个 → 输出残留字面 `{id}`，建议另开 issue。

### 仍未完成 / 真机待测（诚实收尾）

1. **真实 LLM 对话端到端未在本会话复跑**：需要用户本机的 DeepSeek 凭据与 UI 交互。
   已完成的替代证据：真实事故归档逐字节驱动 parse/strip/流式/引擎循环 + 归档恢复回归 +
   `pnpm run dev` 启动冒烟。请用户按 §五 第 5–7 条复测。
2. 流式单测仅覆盖 V4.1 形态；V3/V4 的流式由核查员独立探针验证可用（未入仓）。

