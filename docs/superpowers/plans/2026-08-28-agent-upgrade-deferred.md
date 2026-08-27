# Agent 升级 spec 遗留收尾实施计划（deferred 汇总 + 档 1 小批 + 档 2 大项）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 汇总 2026-08-26~28 Agent 对话升级全链（C 群 / 零成本小改 H / .novelforge 改名 V / 意图预路由 A / fork-rewind B）评审与执行中记录的 deferred 项，按「档 1 小批收尾（低成本高卫生）」与「档 2 大项（P0-1/P0-2，需独立设计）」分档执行。

**Architecture:** 档 1 = 分散的小修复（store 守卫 / UI 细节 / 注释清理 / 测试补强），各任务独立可并行；档 2 = P0-1/P0-2 压缩优化（对照 CC 报告，需先设计再实施）。

**Tech Stack:** TypeScript + Zustand + vitest + Electron

**Spec:** `docs/2026-08-26-claude-code-compare.md` §三.4/6（P0-1 工具结果落盘引用 / P0-2 自适应压缩）+ 各计划 ledger deferred 记录

## Global Constraints

- ESLint strict（--max-warnings 0）、TypeScript strict（noUnusedLocals/Parameters）
- 所有用户可见文本走 `t()`——三语
- 提交规范：`fix:`/`feat:`/`docs:` 前缀、一个提交一件事
- 行为兼容优先：不改变既有成功路径
- 测试用 vitest

---

## 档 1：小批收尾（每个任务独立 commit，可并行窗口）

### Task D1: restoreRewound 生成期间守卫 + 末条 rewind UI（B 计划 deferred）

**Files:**
- Modify: `src/stores/agent-store.ts`（restoreRewound 加 `if (get().generating) return false`——与 rewindToMessage 的 F3 守卫对称）
- Modify: `src/components/panels/agent/AgentConversation.tsx`（末条消息 rewind 按钮 disabled 或 toast——F6 后末条 rewind 是静默 no-op）
- Test: agent-store.test.ts / AgentConversation.test.tsx 追加

**背景**：B 计划 final review follow-up 的 Out-of-Scope 两条：① restoreRewound 无生成期间守卫（generating 中 restore 把归档 append 进流式会话）② 末条 rewind UI 入口仍可点（静默 no-op 缺反馈）。

### Task D2: A1 模式库覆盖扩展（A 计划 deferred 批）

**Files:**
- Modify: `src/services/agent/writing-intent.ts` + `writing-intent.test.ts`

**范围（评审 deferred，逐项小改）**：
- M3 无名字角色操作落点一致：`修改/更新/调整/改 + 角色/人设/设定` 无名字 → `ambiguous('character')`（与「创建角色」一致——当前落 refine(null) 会触发润色工作流）
- M6 refine 空格不对称：「润色 第2章」（动词后空格）→ refine(null)——refine 正则动词后容忍空格
- M7 中文范围退化：「五到八章」「第五到八章」→ 中文数字 range（当前仅阿拉伯数字 `-`/`至` 形式）
- M8 character 标题截断：generateTitle 对增强全文（「更新角色：苏晚晴\n\n原文」）截取增强句首
- I3 护栏边界：「帮我写个邮件」类短查询仍 ambiguous——负向白名单加邮件/报告/文案等非小说写作目标形态（**需先评估误伤面**——写稿意图的「写个邮件」是否该拦截？裁决：邮件/代码/文案等目标词 → none）

### Task D3: 注释与测试卫生（跨计划 cleanup）

**Files:**
- Modify: ~20 文件 `.vela` 陈旧注释（V 计划 deferred——llm-store/agent-store/CharacterEditor/多个 controller/repository/rule.md 4 处）→ `.novelforge`（纯注释，无行为变化）
- Modify: `src/stores/agent-store.ts`（B1 注释行号——已在 F1 修正 ✓ 关闭；检查其他过期行号引用）
- Modify: H/A/B 测试补强：H1 zh-CN 字面量注释说明 / H3 分页 test 2 精确 toBe / H2 外部去重次数断言 / B2 rewind 回调 + 用户气泡变体 / B1 restore 无效索引

### Task D4: V 计划残余（mcp_config.json 特例 + activity 测试环境依赖）

**Files:**
- Modify: `electron/utils/config-utils.ts`（mcp_config.json 根级文件特例——`isAutoCreatedHome` 对「根级仅 mcp_config.json 文件」的判定：迁移失败 + 用户保存过 MCP 配置 → 清理会删用户数据 vs 不删迁移搁浅。**裁决方向**：不扩展白名单（安全优先），改为「迁移重试时若 mcp_config.json 存在则先移出到临时名再 rename、rename 成功后合并回」或保持现状记录——**执行时二选一，倾向保持现状 + 注释**）
- Modify: `electron/repositories/activity-repository.test.ts`（mock 全局配置路径——clean CI 无 ~/.novelforge/config.json 时基线红的环境依赖）

### Task D5: UX 语义评估（强命中用户消息零 append）

**范围**：A 计划 final review 记录的既有设计取舍——强命中路径用户消息零 append（P0-4），用户原文不出现在会话历史/存档中（「已开始」消息含显示名+章号可恢复）。**评估**：是否在强命中时也 append 用户原文（转录形式）以保历史完整性——v1 取舍 vs 用户可感知差异。

---

## 档 2：P0-1/P0-2 压缩优化（大项，需独立设计）

> 对照 `docs/2026-08-26-claude-code-compare.md` §三.4（任务输出落盘 + 可见性驱动轮询）与 §三.6（withhold-then-recover 恢复阶梯）。设计前置：产出独立设计文档后再拆任务。

### Task D6: P0-1 工具结果落盘引用（候选）

**方向**：长工具结果（大文件读取/检索输出）写盘引用而非全文注入——`<tool_result>` 含路径/摘要，LLM 按需再读。与 H3（注入上限 + offset/limit）衔接：H3 已限注入，P0-1 进一步避免 I/O 重复。

### Task D7: P0-2 自适应压缩（候选）

**方向**：`compressMessagesToBudget` 从纯预算截断升级为阶梯恢复（withhold-then-recover：排空 → 自适应压缩 → max_tokens 升级重试 → meta 消息注入 → 才放行错误）+ 连续失败熔断 + 决策冻结保缓存前缀（CC 报告 §三.6 细节）。

---

## Self-Review 记录

**范围**：档 1 全部为评审已记录的 deferred 项（可追溯至各计划 ledger）；档 2 为 compare 报告 §三.4/6 的落地候选（需设计）。
**占位符**：D2 的 I3 扩展与 D4 的裁决方向为显式决策点（均有默认路径）；D5 为评估任务（产出裁决记录）。
**顺序**：档 1 各任务独立（可并行窗口），建议 D1 → D2 → D3 → D4 → D5；档 2 独立窗口（设计前置）。
