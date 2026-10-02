# 命令审查（线①）：本地直出退场——方案 B 实施设计

> **日期**：2026-10-02（自 `docs/2026-10-01-agent-command-review-design.md` 拆分）
> **状态**：方向已拍板（方案 B，2026-10-01）——**待实施**；建议最先做（信任边界优先）。
> **拆分来源**：总纲 §3.1 / §3.2（内容已迁入本文，总纲不再保留副本）。
> **行号基线**：2026-10-02 实测（引用文件自 10-01 全未改动）；动手前按行号复核一次。

## 1. 目标不变量

**任何一句话都不会绕过审查变成动作。**

- `/` 命令体系 = 唯一「确定性直达」通道（已与 CC/dsh 同形，保留；后续可增量吸收 dsh 的别名 / 装饰思路）；
- 非 `/` 输入取消「本地分类 → 执行」。`writing-intent` 三种产出按总纲 §1.4 分别处置：直接执行分支移除（本线）；澄清 / 增强分支保留（无动作）；
- 判据收敛为两套：`/` 命令与模型——第三套本地正则**不再执行任何东西**。

## 2. 方案（已拍板：方案 B）

直出分支移除，全部自然语言 → ReAct → 模型调 `start_workflow` 工具 → 确认（`requiresConfirmation` + `approval/policy.ts`）→ 执行；**澄清 / 增强分支保留**（不产生动作）。代价是「说写第三章」多一轮模型往返（已接受）。

方案 A / C 留档备查（未选）：

- 方案 A（最小接线）：保留强命中，在 `startChapterWorkflow` 等调用前置 ConfirmCard 级确认；
- 方案 C（折中）：仅「整句恰为最严形态」（如 `^写第\d+章$` 全句匹配）保留直出并加确认，其余交模型。

确认环节的呈现随线②一并对齐 dsh（接管输入区的审批卡：拒绝 / 允许一次 + Enter/Esc）。若未来扩展 D 档自动化触发写作，审查语义应与 `ActionPolicy` 的 `confirm` 一致（`src/services/automation/types.ts:18`）。

## 3. 现状锚点（2026-10-02 实测）

| 位置 | 内容 |
|---|---|
| `src/stores/agent-store.ts:590-595` | 预路由分叉：`detectWritingIntent` → `handleWritingIntent` → `handled` 直接 return |
| `agent-store.ts:1166-1254` | **直出分支（移除对象）**：`chapter_creation` → `startChapterWorkflow('generate_draft', …)`（`:1225/1229`；区间「写五到八章」= 串行连发，`:1224-1227`）；`refine`（`:1240`）；`architecture` → `startBlueprintWorkflow()/startArchitectureWorkflow()`（`:1246-1247`）；启动后 append「已开始…」（`makeStartedMsg`） |
| `agent-store.ts:1256-1261` | **保留**：`character` 增强（返回 `status:'none'` + `enhancedContent`） |
| `agent-store.ts:1262-1274` | **保留**：`ambiguous` 澄清（append 澄清文案后 `handled`） |
| `agent-store.ts:1278-1296` | `WorkflowStartError` catch 分支——直出移除后**失去来源**（随案 B 退役） |
| `src/services/agent/writing-intent.ts`（125 行） | 模式库；kind：`chapter_creation` / `refine` / `character` / `architecture` / `ambiguous` / `none` |
| 消费者核查（自审） | `detectWritingIntent` 仅 `agent-store.ts:590` 一处（+测试）——**改动面收窄为 agent-store + writing-intent + 测试** |

## 4. 改动清单

1. `src/stores/agent-store.ts`
   - 移除直出分支（`chapter_creation` / `refine` / `architecture` 三项）及配套：`:1170` 动态 import `workflow-starter`、`makeStartedMsg`、`WorkflowStartError` catch（`:1278-1296`）——先核保留路径不再引用；
   - 保留 `character` / `ambiguous` 两路径；`:587-589` 分叉注释按案 B 修订（「确定性触发」表述退役）。
2. `src/services/agent/writing-intent.ts`
   - 直出三类的**执行**退役；解析保留与否见待定 D2；
   - 文件头自述（`:1-5`）更新；「查询护栏」等历次加固注释按新语义复核（多数仍有效：护栏本就防误路由）。
3. 测试（`src/stores/agent-store.test.ts`）
   - 删 / 改「强命中直接启动工作流」类断言（`mockDetect` 相关用例，`:451` 起）；
   - 新增：「说『写第三章』不再本地启动、落 ReAct」；「歧义输入仍澄清」；「角色增强仍生效」。

## 5. 待定（实施前需定）

- **D1 区间行为**：「写五到八章」旧行为 = 串行连发 4 个工作流；案 B 后目标行为未定义——建议：模型自行一次 `start_workflow`（一次确认）；先核工具参数是否支持多章。
- **D2 模式库收留范围**：直出三类的解析逻辑保留（供澄清话术 / 提示）还是整段删除？建议保留解析、退役执行（回归面最小）。
- D3：`/status` 穿透先例（`agent-store.ts:554-557`）与 `ActionPolicy` 保留为既有词汇，不属本线改动。

## 6. 验收

- 门禁：`tsc` / `eslint --max-warnings 0` / `vitest` 全绿；
- 真机（按 computer-use 约束另立测试文档后执行）：
  1. 「列出小说大纲」→ **不启动任何东西**、落 ReAct 正常回答（根治 `f6f9240` 症状）；
  2. 「写第三章」→ 模型调 `start_workflow` → **确认卡** → 确认后才启动；
  3. 「创建角色」（无名字）→ 澄清消息（不变）；
  4. 「创建角色：苏晚」→ 增强改写进模型（不变）。

## 7. 风险与关联

- 代价（已接受）：说「写第三章」多一轮模型往返（延迟 + 少量 token）；
- 测试删除范围：意图路由解析用例大多仍适用，只删「直出」断言；
- 相邻已知缺陷（**不属本线**、另行分诊）：`base-command.ts:214` 未传 modelId → 工作流命令全走默认模型。

## 8. 证据索引（切片）

- 总纲 §5「NF」全部条目（`agent-store.ts` / `writing-intent.ts` / `intent-router.ts` / 工具与审批 / 提交清单）；
- 自审实测：`agent-store.ts:519-558`（内置 4 命令与 `/status` 不拦截）、`:590-595`、`:1166-1296`；`start-workflow.tool.ts:40`；`agent-engine.ts:488`；`approval/policy.ts:17-59`。
