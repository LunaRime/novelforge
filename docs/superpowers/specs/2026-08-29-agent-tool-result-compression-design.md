# Agent 工具结果落盘 + 自适应压缩设计（D6/D7，2026-08-29）

> 对应实施计划：`docs/superpowers/plans/2026-08-28-agent-upgrade-deferred.md` 档 2（P0-1/P0-2）
> 设计依据：`docs/2026-08-26-claude-code-compare.md` §二（P0-1 三个遗漏机制 / P0-2 两个遗漏细节）+ §三.4（任务输出落盘 + 可见性驱动轮询）+ §三.6（withhold-then-recover + 显式 transition 状态机）

## 1. 背景与目标

Agent 引擎（`src/services/agent/agent-engine.ts`，单文件 ReAct 循环）存在两个与 Claude Code 对照发现的缺口：

- **P0-1（D6）工具结果处理粗糙**：所有工具结果一视同仁截断到 800 tokens 注入上下文——长结果信息损失（LLM 只见截断前缀）；成功但空结果注入空壳 `<tool_result>`（模型可能把空结果当回合边界提前停止生成，CC 事故 inc-4586）；无写盘引用机制。
- **P0-2（D7）压缩无恢复能力**：`MESSAGE_BUDGET_TOKENS = 16_000` 固定预算不随模型窗口伸缩；LLM 调用失败（如上下文超限）直接 `onError` 吐给外部，无 withhold-then-recover 恢复阶梯、无连续失败熔断。

目标：在不改变既有成功路径的前提下，① 长工具结果落盘引用（上下文只进摘要、全文按需再读），② 空结果填充占位（防回合边界误判），③ 压缩预算按模型窗口动态化，④ 可恢复错误先恢复后放行（阶梯 + 熔断）。行为兼容优先（Global Constraints）。

## 2. 现状分析（代码锚点）

| 锚点 | 现状 |
|---|---|
| `agent-engine.ts:278-301` | 工具执行 → `truncateResult(content, TOOL_RESULT_MAX_TOKENS=800)` → `sanitizeObservation` → `<tool_result name="{x}">\n{content}\n</tool_result>` → observationParts → :308 组装 observation（user role） |
| `agent-engine.ts:36` | `MESSAGE_BUDGET_TOKENS = 16_000` 固定 |
| `agent-engine.ts:135` | 每轮调用前 `compressMessagesToBudget(messages, MESSAGE_BUDGET_TOKENS)` |
| `agent-engine.ts:143-151` | generateFn throw → `onError(t('agent.llmCallFailed'))` 直接放行 |
| `agent-engine.ts:542-600` | compressMessagesToBudget：system 恒留 + 末尾 user 保留（超预算截断） + 尾部轮次对保留；纯函数、确定性 |
| `tools/read-file.tool.ts:40` | `READ_MAX_CHARS = 440`（按引擎 800 token 截断线校准，中文峰值 660+ 提示 ≤ 800）——**read_file 结果天然 ≤ 800 tokens** |
| `tools/read-file.tool.ts:97-116` | 绝对路径分支 → `fs:read-external-file`（无沙箱、扩展名白名单含 txt、1MB 上限）——落盘文件再读入口已存在 |
| `src/shared/provider-presets.ts` / `ModelProfile` | 模型 `maxTokens` 可得（128k/64k/32k/4k 等）——动态预算数据源 |
| `ipc-channels.ts fs:*` | `fs:write-file` / `fs:write-json` 等通道存在；`fs:agent-archive-*` 提供"专用通道"先例 |

关键认知：
1. **注入内容前缀天然稳定**：truncateResult 在注入时一次完成，压缩（compressMessagesToBudget）不重算已注入内容（保留原消息对象、从尾部丢弃）→ 决策冻结的"重放同一字符串"在 NF 现状已成立。D6 只需保证**新增的落盘决策（哈希命名 + 摘要截断）也确定性**。
2. **read_file 天然豁免写盘**：工具自身按引擎截断线校准（440 字符），其结果永不触发 800 token 落盘线——与 CC"Read 工具落盘是循环"的豁免一致，无需额外分支。
3. **NF 是调用前主动压缩，CC 是调用后按 API 返回码恢复**：D7 的恢复阶梯触发点 = generateFn throw（错误消息分类），不是 CC 的四级阈值渐进（warning → error → autoCompact → blocking 是 API 层遥测概念）。NF 简化为「多档压缩预算 + 可恢复错误重试」。

## 3. D6 设计：工具结果落盘引用 + 空结果注入 + 决策冻结

### 3.1 空结果注入（CC §二 P0-1-1）

- **规则**：工具执行成功（`result.success === true`）且 `result.content` 去空白后为空 → 注入占位文本 `(${toolName} completed with no output)`（i18n key `engine.emptyToolResult`，三语；`{toolName}` 占位）。
- **失败路径**已有 `error="true"` + 错误信息，无空壳问题，不处理。
- **动机**：防模型把空 `<tool_result>` 当回合边界（inc-4586：capybara 对空结果误判 `\n\nHuman:` 停止序列）；空壳 observation 对 LLM 无信息量。
- **行为变化**：既有测试若断言空结果注入形态需同步（agent-engine.test.ts 检查）。

### 3.2 长结果写盘引用（CC §二 P0-1-3 + §三.4 适配）

#### 3.2.1 触发与阈值

- 工具执行成功后 `estimateTokens(result.content) > TOOL_RESULT_MAX_TOKENS(800)` → 写盘引用路径；否则现状原样注入。
- **写盘内容上限 512 KB**：超过 → 回退现状截断注入（防 1MB+ 大文件撑爆磁盘/read_file 再读的 fs:read-external-file 1MB 限制）。
- read_file 工具豁免（3.1 已述，注释说明原因）。

#### 3.2.2 落盘格式与注入格式

- 目录：`~/.novelforge/agent-results/`（homedir 沙箱内；agent-archive 同属全局会话产物，跨项目一致）。
- 文件名：内容确定性哈希 `{sha1-12}.txt`——同内容永远同文件（防重复写 + 决策冻结）。
- 注入格式（i18n key `engine.resultSpilledToDisk`，三语）：

```
<tool_result name="{toolName}">
[结果过长: {total} tokens，全文已写入 {path}，如需全文用 read_file 读取]
{摘要：truncateToTokenBudget(content, 200) 从头保留}
</tool_result>
```

- 摘要确定性：`truncateToTokenBudget(content, 200)` 固定参数（语义边界截断，从头保留）。
- 总量控制：路径 + 摘要 ≈ ≤ 250 tokens/条，远小于 800 token 截断注入。

#### 3.2.3 写盘通道与依赖注入

- **新 IPC 通道 `fs:agent-result-write`**（实现于 `electron/controllers/fs-controller.ts` agent-archive 段后，仿 `fs:agent-archive-*` 先例——**用 `fs:` 前缀复用既有白名单**，无需新增 preload 前缀）：
  - 入参 `content: string`，白名单目录 `~/.novelforge/agent-results/`（主进程 VELA_HOME 定位，渲染进程不持有路径）；
  - **主进程计算哈希**：`sha1(content).slice(0, 12)` → 文件名 `{hash}.txt`（node:crypto 同步可靠，渲染进程无需 Web Crypto）；
  - **wx 写盘防重**：`fsPromises.writeFile(target, text, { flag: 'wx' })`——EEXIST = 同内容已落盘（同哈希）→ 幂等成功；
  - 失败返回 `{ success: false, error }`（引擎回退截断注入）。
- **引擎依赖注入**：`runAgentLoop` 新增可选参数 `deps?: AgentEngineDeps`，其中 `writeResult?: (content: string) => Promise<{ success: boolean; path?: string; error?: string }>`——**agent-engine 保持无 electron 依赖可单测**（agent-store 调用时注入真实 IPC 实现；测试注入 mock/拒绝实现）。默认 `undefined` = 全部走截断注入（降级兼容，测试与降级路径共用）。
- 渲染进程工具集不直接感知（写盘发生在引擎层，非工具层）。

#### 3.2.4 文件生命周期

- **保留策略**：不主动删除（rewind/fork/会话存档重放需要引用文件仍存在——M 级设计取舍，对齐 D5 的会话持久化语义）。
- **孤儿清理**：启动时清理 >7 天的孤儿文件（deferred 至后续窗口，设计不实现；风险 = 长闲置会话存档恢复时引用缺失——read_file 读缺失文件返回错误，LLM 可见错误并降级，不崩溃）。

#### 3.2.5 与 H3 衔接

- H3 已限注入（offset/limit 分页）；D6 进一步：>800 token 结果不进上下文（只进 ≤250 token 摘要）→ 长工具输出多轮不反复占用预算；LLM 按需再读。

### 3.3 决策冻结保缓存前缀（CC §二 P0-1-2）

- **注入决策确定性**：同一内容 → 同一注入字符串（截断 = 固定参数纯函数；写盘 = 确定性哈希文件名 + 固定摘要）。
- **压缩决策确定性**：compressMessagesToBudget 保持纯函数（同输入 + 同预算 → 同输出），压缩从尾部丢弃、不重算已保留消息——现状已满足，**补充测试锁定**（byte-identical 重放断言）。
- 不做 CC 的 ContentReplacementState 持久化重建（NF 无 resume 重放场景——会话存档走 archive-codec 全文序列化，注入内容原样在 messages 里）。

## 4. D7 设计：自适应压缩 + withhold-then-recover 恢复阶梯

### 4.1 按模型窗口动态预算（CC §二 P0-2-2）

- **数据源**：`ModelProfile.maxTokens`（agent-store 调用时从 `useLLMStore.getState().models` 按 modelId 查得，随模型配置变化）。
- **接口**：`runAgentLoop` 新增可选参数 `options?: { modelContextWindow?: number }`。
- **公式**（保守裁决）：

```
budget = modelContextWindow && modelContextWindow >= 16_000
  ? Math.min(modelContextWindow - 4_000, 32_000)   // 输出空间预留 4k；工程上限 32k
  : 16_000                                          // 无信息/小窗口模型保持现状
```

| 窗口 | 预算 | 说明 |
|---|---|---|
| undefined | 16_000 | 现状不变 |
| 8_000（llama3.3 等） | 16_000 | 窗口 < 16k 不适用动态（压缩是成本控制非防超窗；超窗由错误恢复兜底） |
| 32_000 | 28_000 | 提升 75% |
| 131_072 | 32_000 | 工程上限（成本/延迟裁决；缓存命中抵消部分成本） |

- **MIN 档**（恢复阶梯用）：`minBudget = Math.max(8_000, Math.floor(budget / 2))`——降档压缩至少保留 8k（对话质量底线）。

### 4.2 可恢复错误识别（withhold-then-recover 的触发条件）

- 纯函数 `isRecoverableError(message: string): boolean`（agent-engine 内导出，可单测）：
  - 正则白名单（**收紧**，防误判烧钱）：`context length` / `maximum context` / `context window` / `too many tokens` / `token limit` / `context_length_exceeded` / `413` / `Request Entity Too Large` / `上下文长度` / `超(出|过).{0,4}(上限|限制|长度)` / `长度.{0,4}(超|超过)`。
  - 不匹配 → 直接 onError（现状路径不变）。
- 分类依据：这些错误**压缩后重试真实有效**（上下文超限的恢复 = 减小 prompt），其他错误（网络/鉴权/模型故障）重试无效。

### 4.3 withhold-then-recover 阶梯（CC §三.6 简化）

- **状态**：`recovery = { consecutiveFailures: number; stage: 'none' | 'compacting' | 'meta-injected' }`（runAgentLoop 内局部，单次调用生命周期；不做跨调用持久化——v1 裁决）。
- **流程**（generateFn throw 且 `isRecoverableError`）：

```
失败 1 → stage='compacting'：以 minBudget 重新压缩 → 重试
失败 2 → stage='meta-injected'：追加 meta 消息（engine.resumeDirectly 三语，
         "请直接从上次中断处继续，无需道歉或复述"）→ 以 minBudget 压缩 → 重试
失败 3 → 熔断：onError 放行（原文案 agent.llmCallFailed）
```

- **meta 消息位置**：追加在 messages 尾部（当前末尾 observation 之后，user role，保持 role 交替）；meta 消息**不计入**压缩丢弃（压缩从尾部保留 user 的既有逻辑天然保留它）。
- **每步日志**：`console.warn('[AgentEngine] 恢复重试 {stage}（失败 {n}/3）：{error}')`——命名原因，可观测。
- **成功即清零**：任一次重试成功后 `consecutiveFailures = 0`（同轮后续工具调用不受影响）。
- **非 recoverable 错误**：不进入阶梯，直接 onError（无额外调用 = 无额外费用）。
- **中止优先级**：abortSignal 检查保持现状（重试前也检查——用户取消不重试）。

### 4.4 连续失败熔断（CC §二 P0-2-2 简化）

- 单次 runAgentLoop 内 `consecutiveFailures >= 3` → 后续 recoverable 错误直接放行（不再重试）。
- **不做跨会话/模块级熔断**（CC 是全局遥测驱动，NF 单会话内 2 次额外调用 ×3 轮上限 = 单轮最多 6 次额外调用，费用可控；跨会话熔断 v1 不引入——防误伤，deferred）。

### 4.5 决策冻结保缓存前缀（D7 侧）

- 重试不修改 messages 内容（错误信息不追加进 messages，只走控制流）；压缩降档只改变尾部截断深度（丢弃集合前缀稳定）。
- 测试锁定：同输入不同预算两次压缩 → 前部保留集合一致（前缀稳定性断言）。

### 4.6 显式 transition（CC §三.6 简化）

- `stage` 三态枚举 + 命名原因日志（4.3）；不暴露 UI（onProgress 阶段展示 v1 不做，deferred——对话场景恢复是瞬时的）。

## 5. 影响面与风险

| 项 | 风险 | 缓解 |
|---|---|---|
| D6 空结果注入 | 既有测试锚点（空结果形态）变化 | 全量测试跑 + 锚点同步 |
| D6 写盘 | 新 IPC 通道 + 主进程 controller；磁盘写失败 | 依赖注入 mock 可测；失败回退截断注入（降级路径存在） |
| D6 写盘 | 哈希碰撞（sha1-12 理论可忽略） | 12 hex（48 bit）足够；碰撞 = 同内容不同文件（只影响写入侧 EEXIST 视为成功——内容实际相同，无害） |
| D7 重试 | 额外 LLM 费用（最多每轮 2 次额外调用） | 错误白名单收紧（仅上下文类）+ 熔断 3 次封顶 |
| D7 动态预算 | 128k 模型预算 ×2 → token 成本上升 | 工程上限 32k + 缓存命中（前缀稳定）抵消；可后续加配置（deferred） |
| D7 meta 注入 | 非上下文错误误判为可恢复 → 白浪费 | 正则白名单 + 测试正反例 |
| 行为兼容 | 全部改动只作用于超长/失败路径，正常路径不变 | 既有测试全绿 + 新增路径独立测试 |

## 6. 测试计划

- **D6**：
  - 空结果注入：成功空结果 → 占位文本；纯空白结果 → 占位；失败空结果不受影响（3 条）
  - 写盘引用：>800 token 触发写盘 + 摘要注入（mock writeResult 记录调用）；≤800 原样；写盘失败回退截断注入；512KB 上限回退；同内容两次 → 同 hash 同注入（byte-identical，决策冻结）（5-6 条）
  - read_file 豁免：工具结果 ≤800 不触发（注释锚定，1 条）
- **D7**：
  - 动态预算：window=32000→28000；131072→32000；8000→16000；undefined→16000（4 条）
  - isRecoverableError：英文 3 例 / 中文 2 例 / 非上下文错误 3 例（8 条）
  - 恢复阶梯：失败 1 次重试成功（messages 用 minBudget 压缩、调用 2 次）；失败 2 次 meta 注入后成功（meta 内容断言）；失败 3 次熔断 onError（4 条）
  - 压缩确定性：同输入同预算 → 同输出；不同预算 → 前部一致（2 条）
- 门禁：typecheck / lint 零错误零警告；全量测试绿。

## 7. 任务拆分建议（供实施计划）

- **Task D6-1**：空结果注入 + 决策冻结测试锁定（agent-engine.ts 纯函数区 + `engine.emptyToolResult` 三语，小）
- **Task D6-2**：写盘引用（`fs:agent-result-write` 主进程通道 + 引擎依赖注入 `AgentEngineDeps` + 注入格式 + `engine.resultSpilledToDisk` 三语 + 测试）
- **Task D7-1**：动态预算（`AgentEngineOptions.modelContextWindow` + `computeMessageBudget`）+ `isRecoverableError` + 恢复阶梯 + 熔断（agent-engine.ts + agent-store 传窗口 + `engine.resumeDirectly` 三语 + 测试）
- **Task D7-2**：全量门禁（typecheck/lint/全量测试）+ ledger 收尾（每任务自带 i18n key，无集中 i18n 任务）
- 顺序：D6-1 → D6-2 → D7-1 → D7-2（每个独立 commit；agent-engine.ts 是唯一共享文件，按序执行无冲突）

## 7.5 既有测试锚点（改动前需核对）

- `agent-engine.test.ts` 中若存在对「成功空结果注入空壳」的断言 → D6-1 同步
- `agent-engine.test.ts` 中若引用 `MESSAGE_BUDGET_TOKENS` 常量 → D7-1 同步为 `computeMessageBudget` 语义

## 8. 决策记录（已裁决）

| # | 决策 | 理由 |
|---|---|---|
| 1 | 空结果占位用 `(${toolName} completed with no output)` 形态 | 对齐 CC；三语 i18n |
| 2 | 写盘阈值 = 引擎截断线 800 tokens；写盘内容上限 512KB | 阈值与现状衔接；防大文件 |
| 3 | 目录 `~/.novelforge/agent-results/`，sha1-12 文件名，wx 防重 | 全局会话产物；确定性 + 幂等 |
| 4 | 新通道 `fs:agent-result-write`（fs: 前缀复用白名单）+ 引擎依赖注入 `deps.writeResult(content) → { success, path? }`；主进程算 sha1 哈希 | 先例（fs:agent-archive-*）一致；可测性优先（agent-engine 无 electron 依赖） |
| 5 | 写盘失败回退截断注入 | 降级路径存在，行为兼容 |
| 6 | read_file 豁免（工具自身 440 字符校准） | 与 CC"Read 落盘是循环"一致；零代码 |
| 7 | 落盘文件不主动删除；孤儿清理 deferred | rewind/fork/存档重放需文件仍在 |
| 8 | 动态预算公式 `min(window-4000, 32000)`，窗口 <16k 不适用 | 成本/延迟工程上限；小窗口模型压缩语义不变 |
| 9 | 恢复阶梯 = 降档压缩 → meta 注入 → 熔断放行（3 次封顶）；重试消耗 rounds 计数（最多 3 round，MAX=8 仍剩 5 轮工具循环）；成功后恢复预算 | CC 简化；单次调用生命周期计数；行为可预期 |
| 10 | 错误白名单收紧（仅上下文类正则） | 防误判烧钱 |
| 11 | 不做 ContentReplacementState 持久化、不做跨会话熔断、不做 UI 阶段展示 | NF 无 resume 重放；v1 范围控制 |
| 12 | meta 消息不计入压缩丢弃 | 压缩尾部保留逻辑天然满足 |

## 9. Deferred 清单（不阻塞）

- 孤儿结果文件启动清理（>7 天）
- 动态预算可配置化（设置项）
- onProgress 恢复阶段展示（UI）
- read_file 绝对路径无授权检查（既有安全观察，另立窗口）
