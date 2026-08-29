# Claude Code 对比报告剩余落地项实施计划（CC 后续计划）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（每档独立窗口，档 1 可并行/连续执行）。Steps use checkbox（`- [ ]`）syntax for tracking。

**Goal:** 将 `docs/2026-08-26-claude-code-compare.md`（commit 0b2837b）§三.3/4/5/7/8/9 + §五.1/2/3/4 的未实施落地项按性价比分档排期，每档产出独立 SDD 计划。

**Architecture:** 已完成的基线（P0-1/P0-2 于 2026-08-29 D6/D7 落地；§三.1/2/6 与 §三.9 的 offset/limit 部分于 H 计划 + D 档落地）。剩余项按「档 1 低成本快赢 → 档 2 中等改造 → 档 3 大项独立设计」三档，档 3 各项先产出设计文档再拆任务（同 D6/D7 流程）。

**Tech Stack:** TypeScript + Zustand + vitest + Electron + better-sqlite3 + LanceDB

**Spec:** `docs/2026-08-26-claude-code-compare.md` §三.3/4/5/7/8/9 + §五.1/2/3/4（本计划为这些条目的唯一落地者；§六落地顺序为排序依据）

## Global Constraints

- ESLint strict（--max-warnings 0）、TypeScript strict（noUnusedLocals/Parameters）
- 所有用户可见文本走 `t()`——三语（zh-CN / en-US / ru-RU）
- 提交规范：`fix:`/`feat:`/`docs:` 前缀、一个提交一件事
- 行为兼容优先：不改变既有成功路径
- 引擎（agent-engine.ts / tool 层）保持无 electron 依赖——外部 IO 走依赖注入
- DB 变更遵循 `db-migration-standard` skill（幂等/回滚/哨兵）
- 新增 IPC 通道必须在 preload 白名单注册前缀 + `src/shared/ipc-channels.ts` 类型定义

---

## 档 1：低成本快赢（每项独立窗口，可连续执行；发版后启动）

### Task C1: 两段式 token 估算 + 行区间流式读取（§三.9 剩余）

**现状**：`src/services/agent/token-budget.ts` 单函数 `estimateTokens`；read_file 已有 offset/limit 分页（H3），但无「粗估（按文件类型）> 阈值才精确计数」与「流式行读取（窗外行仅计数）」。
**范围**：
- `estimateTokens` 前加粗估判定（按文本类型：CJK 占比/英文单词密度 → 粗估系数；粗估 > maxTokens/4 才走精确编码）——`token-budget.ts` 纯函数扩展
- read_file 超大文件路径：行区间流式读取（只累计窗口内行内容，窗外行仅计数）——`read-file.tool.ts` 扩展（已有 offset/limit 契约，读 100GB 文件首行不爆 RSS）
- 测试：粗估/精确两段触发、流式行读取窗口外仅计数、100GB 模拟文件（Mock 文件系统层）
**裁决点**：粗估系数表（按扩展名/内容类型）；与 D7-1 的 gptEncoder 缺失低估问题联动（见 deferred）。

### Task C2: 编辑工具三层防线 + 文风归一化链（§三.3）

**现状**：`src/services/agent/tools/write-file.tool.ts` 仅路径归一化 + forbidden 前缀检查——匹配是精确 `includes`，无降级链。
**范围**（对齐 CC FileEditTool/utils.ts）：
- 匹配降级链：精确 includes → 反脱敏表（`&lt;fnr&gt;` → `&lt;function_results&gt;` 等，new_string 同步反脱敏）→ **引号归一化匹配并回映文件真实子串**
- `preserveQuoteStyle`：文件用弯引号时模型直引号自动回填弯引号；上下文启发式区分开/闭引号与缩写撇号
- 附带：`.md` 不剥尾随空格（硬换行）、删除连带尾换行、多编辑链「前序 new_string 不能是后序 old_string 子串」碰撞防护、diff 上下文 8KB 上限 + 换行处截断
- 测试：降级链三态、弯/直引号互转回映、碰撞防护、上下文截断
**裁决点**：反脱敏映射表具体条目（对照 LLM 工具输出实际形态）；NF 小说正文场景的引号风格（中文弯引号「」""——与 CC 英文场景差异，需按中文排版语义调整）。

### Task C3: 输出风格目录（§三.7）——写作风格 .md 零代码注册

**现状**：无写作风格系统（voice_analysis 是人物声音档案，非输出风格）。
**范围**：
- 新 `src/services/agent/style-registry.ts`：文件名=风格名、frontmatter=描述、正文=prompt
- 双层加载：项目级 `{project}/.novelforge/styles/*.md` + 用户级 `~/.novelforge/styles/*.md`，项目覆盖用户
- 注册点：写稿/修稿 prompt 构建时按激活风格注入（style 选择 UI 可在后续窗口，v1 仅注册 + 默认风格）
- 测试：双层覆盖、frontmatter 解析、非法文件跳过
**裁决点**：UI 入口（v1 设置页下拉 vs deferred）；与 LLM prompt 的注入位置（staticContext vs 风格段）。

### Task C4: 会话恢复净化（§三.8）

**现状**：`src/services/agent/archive-codec.ts` parseArchive 有 JSON.parse + 防御过滤，但无「净化」语义。
**范围**（对齐 CC conversationRecovery.ts）：
- 恢复净化流水线：滤无配对 tool_use → 滤孤立 thinking → 滤纯空白消息 → 归一化 → 一致性校验 → 恢复外部工件（rewind 归档、readFileState 无关）
- 应用于：归档读取路径（parseArchive）+ checkpoint 恢复路径（workflow-store）
- 测试：崩溃残片四类输入 → 净化后结构合法；正常归档零改动（行为兼容）
**裁决点**：tool_use 配对判定（assistant tool_call ↔ 后续 user observation 的邻接规则）；thinking 形态（`[THINKING]` 块 vs 折叠标记）。

## 档 2：中等改造（每项独立设计小窗 + SDD）

### Task M1: 工具分批并发（§三.5）

**现状**：`agent-engine.ts:236-301` for 循环串行执行全部 tool_call。
**范围**（对齐 CC toolOrchestration.ts）：
- 一次 LLM 调用 N 个工具：**连续只读归批并行（上限 10）**、写工具逐个串行、requiresConfirmation 工具保持确认交互
- 工具分类：`tool.source === 'builtin'` 只读清单（read_file/search_knowledge/read_architecture/read_characters/count_characters/query_foreshadowing/setting_sampler 等）vs 写工具（write_file/update_config）
- 观察注入顺序与并行执行结果一致（按 tool_call 出现顺序拼接 observation）
- 测试：只读批并行（并发数断言）、写串行、混合批、并行中单工具失败不影响其他
**裁决点**：只读白名单清单；并行上限 10 vs 模型窗口预算（与 D6 写盘引用协同——并行大结果汇总溢出处理）。

### Task M2: 任务输出落盘 + 可见性驱动轮询（§三.4）

**现状**：workflow-store appendText 共享限频调度器（IPC 流式推送）；无文件落盘。
**范围**（对齐 CC diskOutput.ts + TaskOutput.ts）：
- 长任务（写章/批量生成）输出经 fd 直写文件（**'w' 标志——libuv 'a' 标志 MSYS2/Cygwin 探测坑**），UI 1s 轮询 tail 4KB + CircularBuffer 最近 1000 行
- **React 组件挂载才轮询**（不可见任务不轮询）；崩溃恢复（文件还在）
- 替代现有 IPC 流式风暴的通道（保留内存流式作为兼容路径？裁决）
- 测试：写文件/轮询 tail/挂载门控/崩溃恢复
**裁决点**：与现有 workflow-store 流式的关系（替换 vs 双轨）；文件生命周期（任务级清理）。

## 档 3：大项（独立设计文档 → 拆任务 → SDD；每项一个窗口）

### Task L1: 编辑器集成——AI 改稿选区 inline 接受（§五.1，报告判定的 NF 最大用户可感知代差）

**范围**（对齐报告 §五.1 短路径）：
- 复用 ThreeWayMerge DP 段落对齐 →「AI 改稿接选区 inline 接受」：AI 输出 diff 定位到编辑器选区、hunk 级接受/拒绝
- 后续扩展：agent 在位编辑流（工具结果回写编辑器）
- **先设计**（docs/superpowers/specs/），裁决：hunk 粒度（词/句/段）、接受后 diff 状态清理、undo 集成（C3 已修 undo——新路径必须走 history 事务）
- 与 §三.4 无耦合；P1 优先级最高

### Task L2: 工作流 checkpoint 迁 DB（§五.2）

**范围**：
- `workflow-store.ts:8` CHECKPOINT_KEY localStorage → `{project}/.novelforge/vela.db` 新表（checkpoint_id/state JSON/updated_at）
- 迁移遵循 db-migration-standard（v17 迁移号——当前 v16）；恢复后真续跑（executor 生命周期问题——需设计）
- 旧 localStorage checkpoint 读回兜底（存量数据）
- 测试：迁移幂等、写读回、跨项目隔离、损坏 checkpoint 降级
- **先设计**：executor 续跑的可行性（当前 executor 实例销毁后如何重建——workflow-store 恢复路径现状需深查）

### Task L3: 中文检索升级（§五.3）

**现状**：LanceDB 向量 + 自研 n-gram 打分；Tantivy FTS 建了不用（无中文分词）；无 reranker/RRF/查询改写。
**范围**（三步渐进）：
1. FTS 启用（jieba/jieba-rs 分词索引）——与现有 FTS 阈值豁免（0.6）衔接
2. RRF 融合（替换 max 取并）+ 查询改写（角色名不稀释已做——扩展同义/缩写）
3. reranker（可选，成本敏感）
- 测试：中文分词检索命中、RRF 排序正确性、与现有混合检索的回归
- **先设计**：分词器选择（wasm/jieba）、索引重建策略、与 LanceDB 双通道一致性

### Task L4: IPC 权限粒度细化（§五.4，安全敏感）

**现状**：`db:` 前缀 70 通道同一把钥匙；无 sender 校验；fs 沙箱 SANDBOX_ROOTS = [VELA_HOME, homedir]（黑名单式）。
**范围**：
- sender 校验（`event.senderFrame` 校验渲染进程来源——防无上下文注入）
- fs 沙箱改 cwd+项目根白名单式（默认拒绝，显式授权项目/外部文件）
- db: 前缀拆细粒度（按 controller 分组前缀或通道级校验）
- 测试：未授权 sender 拒绝、白名单外路径拒绝、既有功能回归（对话框授权/外部文件链路）
- **先设计 + 安全评审**：破坏面评估（现有 70 通道调用点全量核对）

---

## 执行顺序建议

1. **0.1.6/0.2.0 发版先行**（release-prep R1-R6，独立窗口）
2. 档 1（C1 → C2 → C3 → C4，各独立窗口；C1 与 C2 无共享文件可并行）
3. 档 2（M1 → M2，M1 依赖 D6 写盘引用的协同裁决）
4. 档 3（**L1 优先**——最大用户可感知代差；L2/L3/L4 按需排期；每项先设计后执行）

## Self-Review 记录

- 覆盖检查：§三.3→C2 ✓、§三.4→M2 ✓、§三.5→M1 ✓、§三.7→C3 ✓、§三.8→C4 ✓、§三.9 剩余→C1 ✓、五.1→L1 ✓、五.2→L2 ✓、五.3→L3 ✓、五.4→L4 ✓；已落地项（P0-1/P0-2/三.1/三.2/三.6/三.9 分页部分）明确标注基线不重复 ✓
- 冲突检查：C1 与 D7-1 的 gptEncoder 低估问题联动（C1 修两段式时顺带缓解）；M1 与 D6 写盘引用共享 observation 组装（裁决点已列）；L2 迁移号 v17（当前 v16——执行时以 CURRENT_SCHEMA_VERSION 为准复核）；C2 与既有 update_config 无冲突（不同工具）
- 占位符扫描：各任务均给出范围/文件/裁决点；档 3 明确「先设计」——设计文档产出后再细化任务（与 D6/D7 同流程，非占位符）
