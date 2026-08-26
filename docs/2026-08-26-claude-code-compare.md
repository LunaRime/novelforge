# NovelForge × Claude Code 源码对比学习报告（2026-08-26）

> 背景：外部评审（Codex）对 NovelForge（`src/` + `electron/`，~7 万行 TS）与 Claude Code 源码（`D:\Code\Claude-code-2.1.188-源码学习\Claude-Code-main\src`，~47 万行，sourcemap 反推重建，`999.0.0-restored`）做了差距评审。本报告对其**逐条源码核验**，并补充其遗漏的学习点与 NF 自身强弱项。
>
> 方法：人工核验 Codex 引用的全部关键文件（toolResultStorage / compact / hooks / permissions / skillSearch / agent-engine / tool-registry / skill-registry / context-builder / prompt-cache / token-budget / safe-path）+ 3 个探索代理深扫（CC 工具层与主循环、NF 未覆盖子系统、CC 全景）。

## 一、Codex 评审复核结论

**事实层全部属实**，仅数据口径差异：

Codex 断言|核验结果|
---|---|
CC `toolResultStorage.ts` / `compact/`（14 文件）/ `hooks.ts` / `permissions.ts` / `skillSearch/` 存在|✅|
NF `agent-engine.ts:10` 注明参考 query.ts/QueryEngine|✅ 原文属实|
NF 工具结果 800 token 截断（`TOOL_RESULT_MAX_TOKENS`）、无 hooks、布尔 `requiresConfirmation`、skill 启动全载（`loadAll`）|✅|
NF context-builder L0/L1/M1/M2（各段预算、超限降级序 M1→M2→L1→Tool）、prompt-cache `structureForCache`/`calculateCost`、token-budget gpt-tokenizer + CJK 启发式、safe-path 手动 resolve|✅|
NF 测试文件 64 / CC 0 个测试 / 源码 380 vs 2039|⚠️ 实测 NF **68** 个测试（含 .tsx/.spec，口径差异）；CC 0 个；387 vs 1987 文件（接近）|

总体：评审方向正确、落地顺序合理。盲区 = 「说浅了」（P0-1/P0-2 机制比其描述的更精密）+「完全漏了」（CC 工具层纪律、NF 已有强项、NF 真实缺口）。

## 二、Codex 说浅了：P0-1/P0-2 源码级补全

### P0-1 工具结果落盘（`toolResultStorage.ts`）——3 个遗漏机制

1. **空结果注入**：`(${toolName} completed with no output)` 填充空 tool_result——防模型把空结果当回合边界停止生成（事故 inc-4586：capybara 模型对空结果误判 `\n\nHuman:` 停止序列）
2. **决策冻结保缓存前缀**：`ContentReplacementState`（seenIds + replacements）——替换决策一旦做出，之后每轮**重放同一字符串（byte-identical）**，绝不二次决定；替换记录（ContentReplacementRecord）写 transcript，resume 时 `reconstructContentReplacementState` 重建。一切为保 prompt cache 前缀稳定
3. **`wx` 标志写盘防重**（微压缩重放旧消息不重复写）+ Read 工具 `Infinity` 硬豁免（落盘结果让模型自己 Read 是循环）+ persist 失败回退原内容

### P0-2 自适应压缩（`compact/autoCompact.ts`）——2 个遗漏细节

1. **四级阈值渐进**：warning（-20k）→ error（-20k）→ autoCompact（-13k）→ blocking limit（-3k），各档缓冲不同
2. **连续失败熔断**：`MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`（遥测支撑：1279 会话单次 50+ 连续失败、浪费 ~250K API 调用/天）+ 输出空间预留 `MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000`（按摘要输出 p99.99 = 17.4k 推算）+ 按模型窗口动态计算（NF 是固定 `MESSAGE_BUDGET_TOKENS = 16_000`）

## 三、Codex 完全遗漏的学习点（按 NF 性价比排序）

### 🟢 1. 工具错误隔离 + 唯一循环出口（CC `toolExecution.ts` + `query.ts`）

循环永不因工具崩溃：所有工具失败（zod 校验失败、执行抛异常、未知工具）一律转成带相同 tool_use_id 的 `<\tool_use_error>` tool_result 回上下文；循环出口只看"流式是否出现过 tool_use 块"（`stop_reason === 'tool_use'` 不可靠）。
→ NF：agent-engine 是单文件 ReAct 循环，直接可改；顺手解决手写正则解析 `<tool_call>` 的脆弱性。

### 🟢 2. readFileState：一个 Map 服务三机制（`FileReadTool` + `FileEditTool`）

`Map<path, {content, 地板化 mtime, offset, isPartialView}>`：同 range 同 mtime 返回 `file_unchanged` 桩（实测约 18% Read 是重复读，省 cache_creation token）／Edit/Write"未读先拒"／Windows 假性 mtime 变化用内容比较兜底。
→ NF：write-file.tool 无"先读后写"强制。

### 🟢 3. 编辑工具三层防线 + 文风归一化链（`FileEditTool/utils.ts`）

匹配降级链：精确 `includes` → 反脱敏表（`&lt;fnr&gt;`→`&lt;function_results&gt;` 等 10 映射，new_string 同步反脱敏）→ **引号归一化匹配并回映文件真实子串**。`preserveQuoteStyle`：文件用弯引号时模型直引号自动回填弯引号，上下文启发式区分开/闭引号与缩写撇号。附带：`.md` 不剥尾随空格（硬换行）、删除连带尾换行、多编辑链"前序 new_string 不能是后序 old_string 子串"碰撞防护、diff 上下文 8KB 上限 + 换行处截断。
→ NF 场景：中文/英文小说正文的排版风格保护（写完不破坏文档引号风格）。

### 🟢 4. 任务输出落盘 + 可见性驱动轮询（`diskOutput.ts` + `TaskOutput.ts`）

stdout/stderr 经 fd 直接进文件**完全不进 JS**；UI 1s 轮询 tail 4KB + CircularBuffer 最近 1000 行；**React 组件挂载才轮询**（不可见任务不轮询）。自带崩溃恢复（文件还在）。Windows 血泪：libuv `'a'` 标志触发 MSYS2/Cygwin 探测失败静默丢全部输出，必须 `'w'`。
→ NF：写章等长任务的进度通道，替代 IPC 流式风暴。

### 🟢 5. 工具分批并发（`toolOrchestration.ts`）

一次 LLM 调用 N 个工具：连续只读归批并行（上限 10）、写工具逐个串行、contextModifier 延后批尾统一按序应用。
→ NF：查设定/检索 KB/读角色卡并行，写章节串行。

### 🟢 6. withhold-then-recover + 显式 transition 状态机（`query.ts`）

可恢复错误（413 上下文超限、max_output_tokens）**先不吐给外部**，阶梯恢复：排空 → reactive compact → max_tokens 8k→64k 升级重试 → 3 次注入 "Resume directly, no apology, no recap" meta 消息 → 才放行错误。循环转移带命名原因（`max_output_tokens_recovery` 等），测试断言 transition。
→ NF：`compressMessagesToBudget` 是纯预算截断，无恢复阶梯。

### 🟢 7. 输出风格 = 目录里的 .md（`loadOutputStylesDir.ts`）— 零代码注册

文件名=风格名、frontmatter=描述、正文=prompt；项目级+用户级两层、项目覆盖用户。
→ NF：写作风格库（叙事视角/对话风格/节奏预设），用户扔 .md 即扩展。

### 🟡 8. 会话恢复语义修复（`conversationRecovery.ts`）

恢复不是重放是**净化**：滤无配对 tool_use → 滤孤立 thinking → 滤纯空白消息 → 归一化 → 一致性校验 → 恢复外部工件（plan/fileHistory/记忆）。
→ NF：checkpoint/archive 重启同样面对"崩溃残片"，这是最容易埋坑、事后极难查的方向。

### 🟡 9. 两段式 token 估算 + 行区间流式读取（`FileReadTool` + `readFileInRange.ts`）

粗估（按文件类型）> maxTokens/4 才调精确计数；流式行读取只累计窗口内行、窗外行仅计数——读 100GB 文件第一行不爆 RSS。grep 先截断再相对化（10k 行结果只保 30-100 行不白做逐行工作）。

### 其他低成本顺手点

- `withRetry.ts`：Retry-After 两档 + stale keep-alive 全局禁用 + 前台才重试 529（容量雪崩防网关放大）
- Bash 命令语义分类表（search/read/list/silent → UI 折叠摘要）；退出码语义查表（grep 1 = 无匹配非错误）
- `areFileEditsEquivalent` 双 apply 判等（"这趟调用是否重复上次"去重）
- sessionMemory 自动摘要（token 阈值 + 工具调用数触发，fork 低成本 agent）→ NF 可做"每章结束自动更新人物状态卡"
- plan 落盘为 word-slug markdown 工件（崩溃后从消息历史重建）→ NF 的"大纲即文档"

## 四、NF 已比 CC 强（无需学）

1. **质量闸门闭环**：post-process DAG（dependsOn 分层拓扑）+ `isAllCriticalPassed` 阻止定稿 + `workflow-guards` 烧 token 前校验配置完备性——CC 无"作品质量闸门"概念
2. **三评审者并行互评 + 加权合成 + 方差分歧标注**（spawn-reviewers / synthesize-scores / evaluation_scores）——成熟 LLM-as-judge 工程
3. **记忆 stale 生命周期 + 卷边界 diff 式失效**（book-memory / chapter-memory / memory-invalidation）——基于内容产品语义的缓存失效设计
4. **内嵌 MCP 客户端**（stdio/SSE、Claude Desktop 配置兼容、动态工具注册）——与 CC MCP 能力几乎等价

## 五、NF 真实缺口（Codex 也漏了）

1. **【最大代差】agent 与编辑器集成形态**：agent 只能 `open_editor` 打开文件；AI 改写 = 弹窗→整段替换；修稿走 diff 标签页 + 段落级三栏合并。无 hunk 级接受、无 agent 在位编辑流、无工具结果回写编辑器。已有 ThreeWayMerge DP 段落对齐，"AI 改稿接选区 inline 接受"是短路径
2. **工作流 checkpoint 挂 localStorage**：5MB 上限、非项目级、恢复后不能真续跑（executor 已销毁）。迁移 DB + 保存执行进度位即可真续跑
3. **中文检索天花板**：Tantivy FTS 建了不用（不支持中文分词），实际 DataFusion LIKE + 自研 n-gram 打分；无 reranker、无 RRF 融合（只取 max）、无查询改写
4. **IPC 权限粒度粗**：`db:` 前缀下 70 通道同一把钥匙、无 sender 校验、fs 沙箱含整个 homedir（黑名单式而非 cwd+项目根白名单式）

## 六、落地顺序（修正版）

Codex 顺序基本成立（P0-1 → P0-2 → P0-3+P1-1 → P1-2+P1-3 → 其余），两处修正：

1. **零成本小改穿插先行**（1-2 天）：工具错误隔离（三.1）→ readFileState 三合一（三.2）→ 两段式 token 估算（三.9）。三者都集中在 agent-engine/tool 层
2. **编辑器集成提级**：Codex 未覆盖的 NF 最大用户可感知代差（五.1）。与 P0-3 hooks 无耦合，P1 阶段独立做——先"AI 改稿选区 inline 接受"（复用 ThreeWayMerge），再考虑 agent 在位编辑流

## 七、关联项目 Skills

Skill|关联点|
---|---|
`llm-chain-optimization`|P0-1 决策冻结/缓存前缀 ↔ 其「缓存真实命中判定 / staticContext 前缀」纪律；P0-2 压缩 ↔ 其「格式漂移解析兜底 / 温度分派」|
`agent-tool-context`|三.1/三.2/三.3 工具层改进 ↔ 其「工具开发契约 / 参数归一化铁律 / 错误 observation 清洗」|
`db-migration-standard`|五.2 checkpoint 迁 DB 时必须遵循|
`save-feedback-standard` / `i18n-standard` / `git-submission-standard`|后续实现各改进的通用约束|
