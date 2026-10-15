# Agent 上下文链加固建议（观测面闭环 / 压缩保真 / 结构演进）

> **状态**：**已执行（2026-10-15）**——P0-1/P0-2/P0-3、P1-1/P1-2/P1-3、P2-3、P2-4 已落地（批 1–5）；P2-1/P2-2 按 §3 裁决为「评估项」暂缓（理由见 §3 与自学习压缩审阅 §6）。
> 压缩部分按用户要求引入**自学习式压缩**（TACO 式本地规则引擎，默认关闭、设置页可开关；引入审阅与取舍见 `docs/superpowers/specs/2026-10-15-self-learning-compression-design.md`）。
> **日期**：2026-10-14 ｜ **行号基线**：master `HEAD 6e66e75`（与 `docs/frontend-design-review.md:174` 同基线；动手前按行号复核一次）
> **依据**：本轮只读调研（上下文装配 / CCR 压缩 / 恢复阶梯 / 记忆分层 / 子 agent 全链路）+ 一次临时 vitest 实测（见附录 A，用例跑完已删）
> **参照**：`docs/superpowers/specs/2026-09-26-context-engineering-design.md`（B 档第二轮）、`docs/2026-08-21-ccr-memory-design.md`（CCR 初版）、`docs/superpowers/specs/2026-08-29-agent-tool-result-compression-design.md`（D6/D7）

## 0. 结论摘要

现状**不缺机制，缺观测与验证**：

| 维度 | 现状 | 判断 |
|---|---|---|
| 基础注入量 | base ≈ **2150 tokens**（zh，tiktoken；启发式 2634），占设计上限 4700 的 **46%** | 不贵，不是问题 |
| 基础注入质量 | 分段独立预算 + 确定性降级链 + 签名补偿，工程成熟 | 好，但**工具段是瓶颈**（契约 3612 → 硬截 1200） |
| 压缩 | 可逆（分卷原文永不丢）、可证明（降幅断言）、可解释（卡片 before→after） | 好，但**只有 token 断言，没有信息保真断言** |
| 退化处置 | 只有人工开关（`/clear`、rewind、fork、移除压缩） | **无语义层退化检测，无自动回滚**；信号只覆盖"格式写错" |
| 观测面 | 面板支持"面板 vs 实发"与前缀行，**但没接线**；E3 漂移检测未实现 | **最薄的一环** |

因此本建议的排序原则是：**先把已有事实接到眼睛前（P0），再补压缩的保真度（P1），最后才动结构（P2）**。任何"加更多 token / 换更强模型"的做法都排在最后——本轮实测不支持先做那个。

---

## 1. P0：观测面闭环（低风险、零新机制）

### P0-1 面板接上"实发口径"与"前缀状态"

**问题**：`ContextBudgetBar` 已支持 `historySentTokens` 与 `prefix`（`src/components/panels/agent/ContextBudgetBar.tsx:127-145`），但唯一真实调用方 `src/components/panels/agent/AgentConversation.tsx:309-320` **两个参数都没传**，注释自认「P0 近似：history 用当前 messages 估算，非实际发送副本」（`:298`）。→ 设计文档自列的「五个无护栏点」第 3 点（`2026-09-26-context-engineering-design.md:31`）**至今未闭环**：用户在预算条上看到的永远是估算值，"面板 ≠ 实发"这件事在 UI 上不可见。

**建议**：
1. `agent-store` 在 `sendMessage` 装配完成后，把**本次实发**的历史 token 与前缀比较结果写入会话级观测字段（例：`lastSendUsage: { historySentTokens, prefix: { changed, sharedChars }, at }`；随会话持久化则需评估 archive 体积，建议**仅内存态 + 切换会话时清空**）。
2. `AgentConversation` 读取该字段并传入 `computeContextUsage`；无记录（未发送过）时保持现状不渲染该行。
3. 前缀行已有数据源：`agent-store.ts:951-956` 已算 `prefixFingerprint` / `comparePrefix`，只是没外抛。

**验收**：真实 UI 预算条明细里出现「历史：面板 X · 实发 Y」（两者不等时才显示）与「前缀：稳定 / 已变化（共享 N 字符）」；切换会话后不串数据。

**测试**：`ContextBudgetBar` 渲染用例已存在；补一条 store→props 集成用例（发送后 `lastSendUsage` 被写入、`/clear` 与切会话后被清空）。

**代价/风险**：小（无 IPC、无迁移、无新 LLM 调用）。风险点是字段生命周期，需与 `/clear`（`agent-store.ts:523-539`）和 fork/rewind 一起清。

---

### P0-2 硬截断兜底必须留痕

**问题**：压缩被跳过时有 `ccr.compressionSkipped` + `renderLog('warn')`（`agent-store.ts:822-827`），但**真正丢消息的那一步是静默的**——`agent-store.ts:897-911` 构造 historyMessages 时按预算 `break`，无日志、无计数、无会话内标记。用户在"压缩失败 / 无收益被跳过 / 压缩不足以降到预算下"这三种情形下都不知道这轮少了几条历史。

**建议**：在裁剪循环里累计被丢弃的条数与 tokens，非零时 `renderLog('warn', 'Agent', t('ccr.historyTruncated').replace('{n}', …).replace('{tokens}', …))`，并复用压缩跳过在会话内的标记位做轻量提示。新增 1 个 i18n key（三语）。

**验收**：构造"压缩跳过 + 历史仍超预算"的用例 → LogsView 出现丢弃条数与 token 数；正常路径无新增日志噪音。

**测试**：`agent-store.test.ts` 加一条（沿用现有 `configResponse` 覆写范式，`minimumChangeTokens` 调高触发跳过后再断言裁剪留痕）。

---

### P0-3 工具段预算与工具数挂钩（当前最实际的注入质量损失）

**问题**：`context-builder.ts:112-133` 把工具提示词硬截到 **1200 tokens**。本轮实测：**26 个内置工具**的完整契约是 **3612 tokens**（启发式口径 6059），实测段值 1178/1200 且 `truncated: true` —— 即**约 1/3 的契约文本可读**，后面的工具只剩"名字 + 签名"。代码注释自述更极端的历史数据：「30 个工具时提示词共 5435 tokens、1200 的截断落在第 2 个工具内部」（`:119-122`）。签名补偿保证了"可调用"，但**语义、参数含义、使用时机对靠后的工具是缺失的**。

**建议**（三选一，按性价比排序）：
- **A（推荐）**：预算改为与工具数挂钩的公式（例：`min(900 + 110 × N, 3000)`），并同步重估 `TOTAL_BUDGET_TOKENS`（`context-builder.ts:38`）与降级链顺序——因为工具段在 base 内，它的膨胀会挤压 L1 而不是先丢记忆段。
- **B**：按轮次相关性注入工具子集（读类常驻、写/工作流类按意图注入），把省下的额度还给 L0/记忆。
- **C**：只加护栏不改预算——新增回归测试「注册 N 个真实内置工具 → 断言截断点覆盖到的工具数」并在工具数增长时**红**。任何方案都应包含这条测试。

**验收**：`truncated` 不再常态为真；新增工具时该测试能提示"契约被挤出"。

**测试**：`context-builder.test.ts` 新增用例：注册全部 `builtinTools` → 断言（a）段 tokens ≤ 新预算、（b）被截断时签名清单包含全部工具名、（c）记录"仍有 prose 描述的工具数"下界。

**代价/风险**：A 会让 system 提示词净增 1–1.5k tokens/轮（成本上升，但换回工具正确性）；需一并复测降级链（`context-builder.ts:198-238`）与现有 4 条降级用例。

---

## 2. P1：压缩保真度（"可逆、可证明、不可验证"→ 补最后一环）

### P1-1 摘要生成长度硬约束 + 注入端按分节裁剪

**问题**：摘要 prompt 只要求"简洁"（`src/shared/locale-data/agent.ts:355`），**无 token/字数上限**；而注入端是 `truncateToTokenBudget(summary, 300)`（`context-builder.ts:150`），`truncateToTokenBudget` 优先在**段落边界保头截断**（`token-budget.ts:200-221`）→ 摘要尾部（模型习惯放"未完成任务 / 最新决策"的位置）会被整段吃掉。作者已知此风险，所以副作用回执改为**头插**（`agent-store.ts:810-815`）。这是压缩链上最直接的信息损失来源。

**建议**：
1. 摘要 prompt 增加**硬上限与固定分节**：`## 关键事实 / ## 用户指令 / ## 未完成任务 / ## 已确认决策`，并给"总长 ≤ 250 tokens（约 400 中文字）"的显式约束（比注入上限 300 留余量）。
2. 注入端不再"保头截断"，改为**按分节裁剪**：保住"未完成任务 + 已确认决策"（对下一轮最有用），细节分节可砍；被裁时加一行"（部分分节已省略）"提示，避免模型以为摘要完整。
3. 兼容旧摘要（无分节标记）→ 回落到现有保头截断，行为不劣化。

**验收**：超长摘要输入 → 注入结果不出现被砍半的句子/分节；"未完成任务"分节恒在。

**测试**：`context-builder.test.ts` 补 3 条（超长有分节 / 超长无分节回落 / 正常长度零改动）。

---

### P1-2 零成本"保真检查"：实体保留率

**问题**：可证明性只证"省了 token"（`agent-store.ts:817-828` 的 `changeTokens`），**没有任何信息保真断言**。摘要是由 **budget 档模型**生成（`ccr-summary.ts:35`，成本优先），且是**迭代合并**（第 N 次输入 = 旧摘要 + 新批），漂移只能靠"保留原文 + 手动重生成"兜底，而重生成入口尚未实现（见 P1-3）。

**建议**：压缩后做一次**纯字符串**核对（零 LLM 成本）：从被压缩批次里抽取高价值实体（角色名 / 章节号 / 工具写入目标 / 用户显式编号的指令），检查是否出现在新摘要文本中，计算保留率；低于阈值（如 60%）时：
- `renderLog('warn')` 留痕 + 压缩卡片标注"本次摘要可能丢失细节"；
- **不阻断**替换（阻断会造成"为了完美而丢更多"的反效果——与 B2 的取舍一致）。

**验收**：构造"摘要漏掉批内主角名"的用例 → 卡片出现告警且历史仍按降幅判定正常替换。

**测试**：新增 `ccr-fidelity.test.ts`（纯函数：实体抽取 + 保留率 + 阈值分支），`agent-store.test.ts` 补一条留痕断言。

**代价/风险**：小（纯计算）。风险是误报（别名/代词导致漏检）——阈值宜保守，且只做告警不做拦截。

---

### P1-3 补上 `regenerateBatchSummary`（设计已承诺、代码缺失）

**问题**：设计承诺「分卷存在即可用原文重新生成摘要（本轮提供 `regenerateBatchSummary(convId, batch)` store 动作 + 卡片按钮）」（`2026-09-26-context-engineering-design.md:73`、`:143,156`），**现码没有实现**：全仓无该动作，卡片只有「展开恢复 / 移除该压缩」（`CompressedBatchCard.tsx:88-97`）。而 `removeCompaction` 的走向是"摘要**不再拼接**、标记需重生成"（`agent-store.ts:1560-1564`），注释里那句"用户可经分卷原文重生成"是**尚未兑现的意图**——一旦用户移除某批压缩，**该会话在下次压缩前没有会话记忆注入**。

**建议**：实现 store 动作 `regenerateBatchSummary(batch)`：读分卷原文 → 以**当前 `rollingSummary` 为空**的语义重建（注意：移除批次后剩余批次的迭代链已断，重建时明确"以该批原文为唯一输入"）→ 复用 `generateConversationSummary` → 清除 `rollingSummaryInvalidated`；卡片加按钮（复用现有按钮规范）。

**验收**：移除压缩 → 摘要标失效 → 点"重生成"→ 摘要恢复注入（面板明细 M1 段重新出现）。

**测试**：`agent-store.test.ts`（重建调用参数含分卷原文、成功后 `rollingSummaryInvalidated` 归假、分卷缺失时给出可读错误）+ 组件用例（按钮触发与禁用态）。

---

## 3. P2：结构演进与收尾（评估项，勿直接动手）

### P2-1 E3「context 漂移检测」：落地轻量版或正式标 won't-do

`2026-09-08-agent-capabilities-plan.md:207` 的 E3（逐请求重建"模型可见消息"、检测 prefix 漂移与 system/tools 变更）**未实现**，只落地了 B4 前缀记账（只记不拦，`prefix-accounting.ts:1-11` 自述）。建议二选一，别悬着：**轻量版** = 复用 `computePrefixFingerprint` 对"模型可见消息序列"取指纹并随 `llm_calls` 落库（现有 `prefix_fingerprint` 列可扩一列），使"工具集/系统段何时变过"事后可查；**或**显式写入 backlog 并标注放弃理由。

### P2-2 摘要移出 system 前缀区（评估，不实施）

`rollingSummary` 注在 system 尾部 → **每次压缩都改写前缀、缓存命中归零**；设计明确把"上下文分层重构"列为非目标（`2026-09-26-context-engineering-design.md:21-22`）。建议先**用已有数据量化**再决定：`llm_calls` 已有 `prefix_fingerprint` / `prefix_shared_chars` 与 `cached_tokens`，可按会话统计"压缩后下一轮的缓存命中损失"，若损失显著再立项。

### P2-3 RAG 注入链补单测

`rag-context-provider.ts:49-54,99-104,124-128,148-156`（0.6 阈值 / FTS 豁免 / ±10 章 / 800 预算 / 句子边界截断）目前**无直接单测**，只有 kb 层的 FTS 豁免断言。这是上下文链上测试最薄的一段，建议补 5 条纯函数用例（可 mock `kb:search*`）。

### P2-4 文档漂移修正（三处，建议随任一 P0 一并提交）

| # | 位置 | 漂移 |
|---|---|---|
| 1 | `docs/superpowers/specs/2026-08-29-agent-tool-result-compression-design.md:100-104` | 公式写 `min(window-4000, 32000)`；现码为 `clamp(窗口×80%, 16000, 64000)`（`agent-engine.ts:764-768`，`compaction-prefs.ts:64` 记 2026-10-14 调整） |
| 2 | `src/services/memory/shared-memory.ts:6` | 注释仍写「kind=shared 独立段，150 tokens 保底配额」；现码 shared 只进名字目录、正文不再自动注入（`context-builder.test.ts:141`） |
| 3 | `docs/superpowers/plans/2026-09-26-memory-layering-plan.md:25-35` | 自述行为变更（升级后 auto 记忆默认不再自动注入正文）未在用户可见处说明，建议在记忆面板给一行"正文不自动注入，可用 @ 或 read_memory"的提示文案 |

---

## 4. 明确不建议做的事

1. **不要引入 LLM-as-judge 的自动质量回滚**（检测到退化就重跑/回退会话）：成本随轮次线性上升，判据不稳，且 NF 无 resume 重放语义；在没有真实事故样本前属过度工程。P1-2 的纯字符串保真检查已能覆盖大部分"摘要丢事实"的场景。
2. **不要简单调大 `TOTAL_BUDGET_TOKENS`**：实测 base 仅占 4700 的 46%，总预算不是瓶颈；调大只会掩盖 P0-3 的工具段截断。
3. **不要为了摘要质量直接换成 elite 模型**：先由 P1-2 给出"是否真丢事实"的证据再谈成本。
4. **不要给落盘文件加激进 GC**：现设计"不主动删除"是 rewind/fork/存档重放的正确性前提（`2026-08-29-…-design.md:79`），只增不减是**可接受代价**，若要清理必须与引用可达性一起设计。

---

## 5. 排期建议与依赖

| 批次 | 内容 | 依赖 | 风险 |
|---|---|---|---|
| 批 1 | P0-1 + P0-2 + P2-4（文档漂移） | 无 | 低 |
| 批 2 | P0-3（推荐方案 A）+ 回归测试 | 需重估 4700 与降级链 | 中（改动集中、影响面是每轮请求） |
| 批 3 | P1-1 + P1-3 | 批 1 的面板（验收需要看 M1 段） | 中 |
| 批 4 | P1-2 + P2-3 | 无 | 低 |
| 评估 | P2-1 / P2-2 | 依赖 `llm_calls` 已有列做数据回算 | — |

**Global Constraints（沿用仓库既有约束）**：TypeScript strict + ESLint `--max-warnings 0`；所有用户可见文本走 `t()` 且三语齐备（新增 key 至少 3 个：`ccr.historyTruncated`、`ccr.summaryPartial`、`ccr.fidelityWarn`）；颜色用 CSS 变量；不动 IPC 通道的不必碰 preload 白名单；无 DB 迁移（本建议全部落在渲染层与纯函数）。

**Quality Gate**：`pnpm run typecheck` / `pnpm run lint` / `pnpm run test` 三绿；提交后 `gh run list` 确认真绿（本地绿 ≠ CI 绿）。

---

## 附录 A：基础注入提示词实测（2026-10-14）

**方法**：临时 vitest 用例（`@vitest-environment jsdom`），zh-CN 界面 + 模拟项目（玄幻 300 章 / 3 个编辑 Tab / 已有滚动摘要）+ `registerBuiltinTools()`（26 个工具），分别用 tiktoken(cl100k) 与 CJK 启发式计数；**用例跑完已删，仓库无残留**。记忆三层（常驻/目录/manual）因未打桩 `memory:list/read` **未纳入实测**，其数字均来自代码硬上限。

| 段 | 预算 | 实测(tiktoken) | 实测(启发式) | 截断 |
|---|---|---|---|---|
| identity | ~400（设计） | 243 | 423 | 否 |
| L0 项目上下文 | 800 | 147 | 217 | 否 |
| L1 编辑器感知 | 600 | 201 | 250 | 否 |
| 工具系统 | 1200 | **1178** | 1321 | **是**（原文 3612 / 6059） |
| 技能目录 | 400 | **374** | 414 | 否（顶格） |
| **base 合计** | 4700（含记忆） | **2150** | 2634 | — |
| M1 会话摘要 | 300 | 44 | 79 | 否 |

三语：zh 2150 / en 2152 / ru 2296（tiktoken）；启发式 zh 2634 / en 2159 / **ru 3559**（俄语高估约 55%——`gpt-tokenizer` 加载失败时预算会被提前打满）。

**占比换算**：占设计上限 4700 的 46%；占 128k 窗口 1.6%、32k 窗口 6.7%、16k 小窗口 13%；占默认 16k 消息预算 13%、64k 上限 3.4%。可选层最坏叠加（常驻 4000 + 目录 800 + M1 300 + manual 4000）后 system ≈ 11.3k tokens（≈128k 窗口 8.6%，不含 RAG 800 与 @预取 1200）。

> ⚠️ 分段 token 数**不可加**（分隔符与 tokenizer 边界效应，`subagent/prompt.ts:50` 有同款注释）；复测请以整段 `estimateTokens(full)` 为准。

---

## 附录 B：实施后评审修复（2026-10-15）

对落地结果做了一轮评审（含独立交叉核查 + 实跑门禁），确认计划项全部正确接线，随后修掉 6 处缺陷 + 补 12 条用例。**门禁实测：typecheck 0 错 / lint 0 警告 / 229 文件 2702 测试全绿。**

| # | 缺陷（严重度） | 修法 | 位置 |
|---|---|---|---|
| 1 | **前缀基线跨会话不重置**（中）：基线是模块级裸变量，只有写没有重置 → 新会话首轮的「前缀：已变化」与「缓存命中归零」是拿**上一个会话**的 system 段比较，面板与日志都在说谎 | 抽成 `src/services/agent/prefix-baseline.ts`（`resetPrefixBaseline` / `peekPrefixChange` / `updatePrefixBaseline`，唯一真源且可单测），在 createConversation / selectConversation / deleteConversation / clearAll 四处与 `clearReadState()` 同址重置；`/clear` **不重置**（同会话内 system 段确实变了，如实报告） | `prefix-baseline.ts`（新）、`agent-store.ts` 四处、`prefix-baseline.test.ts`（新，4 例） |
| 2 | **硬截断统计长期不落盘**（中）：`stats.truncations` 不计入 `changed`，而调用侧门是「attempted 或 dropped」→「只发生硬截断」的会话里计数每轮被推高又被丢弃，设置页「截断 N」永远停在旧值 | 截断计数纳入 `changed`（代价可控：仅上下文真的丢消息时写盘，健康会话零写），并更正文件头注释 | `compression-learning.ts`（统计判定 + 头注释）、`compression-learning.test.ts`（改写既有口径用例） |
| 3 | **设置页陈旧快照覆盖实时学习状态**（中）：mount 时读一次 + dirty 就整段写回；开关「开→关」不做值比较仍 dirty | 保存时按**用户意图**合并：点过重置 → 清零（保留开关值）；否则只在**盘上最新状态**之上覆盖「开关」一项（重读一次 `config:get`，失败回落快照） | `ContextCompactionSection.tsx` |
| 4 | **`version` 从不校验**（低-中，与 spec §3.6 字面不符） | 显式版本失配 → 整段回默认（不做部分解析）；缺 version 仍宽容解析 | `compression-learning.ts` |
| 5 | **重生成路径不带学习提示 + 失败无内联反馈**（中低） | `regenerateBatchSummary` 注入 `composeLearningHints`（与自动压缩同口径）；返回值改为 `Promise<string \| null>`（失败文案已 i18n），卡片内联展示 + 按钮 title 解释禁用态 | `agent-store.ts`、`CompressedBatchCard.tsx`、新 i18n 键 `ccr.regenerateBusy` / `ccr.regenerateNoBatch`（三语） |
| 6 | **回执拆段只按当前 locale 匹配**（中低）：摘要用**写入时** locale 生成 → 压缩后切语言，回执不再独立成段（静默退化） | 共享 `localeVariants()`（`locale.ts` 导出，context-builder 改用它）按**全语变体**匹配；顺带修掉新用例暴露的**既有渲染缺陷**：正文此前只跳过标题行 → 回执行在正文里重复出现，现从回执块之后起切 | `locale.ts`、`context-builder.ts`、`CompressedBatchCard.tsx` |

**测试卫生同步修复**：`mockInvoke` 全局 `mockClear()`（此前学习用例用 `.find()` 扫全历史，可能被前序用例假通过）；去掉依赖中文标点切分的断言（`split('：')` → 断言规则名/错误正文）；补 reverts/regenerations 积分、跨语言拆段、失败内联文案、基线重置、version 失配、截断落盘等 12 条用例。

**仍未做（P2，非阻塞）**：退役→复活的退避上限（`compression-learning.ts` 可 2/3 周期振荡）、设置页「重置学习数据」二次确认（同目录其他破坏性动作均有）、以及 P1-6 中「集成层阈值逐字等于用户值」的直接断言（当前由 `effectiveMinChangeTokens` 单测覆盖）。
