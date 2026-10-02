# 手动 AI 产出审查（线③，候选）：产出侧不变量实施设计

> **日期**：2026-10-02（自 `docs/2026-10-01-agent-command-review-design.md` §3.5 拆分）
> **状态**：**候选**（未拍板是否实施）——拆出自审后按候选线留存。
> **拆分来源**：总纲 §3.5「手动 AI 动作的产出审查」（内容已迁入本文，总纲不再保留副本）；入口盘点证据同源（`manual-ai-entry-survey`，16 处入口）。

## 1. 判断（本线的由来）

这些入口的「判据」没有问题——用户手动点按钮 = 显式命令。问题全在**产出侧**：一份 AI 产出可以绕过任何接受门直接变成项目状态。这就是线①不变量的镜像面：

> 「一句话不得绕过审查变成动作」 ↔ 「**一份 AI 产出不得绕过接受变成项目状态**」。

## 2. 现状要点（2026-10-01 盘点 16 处入口）

- **配置编辑器双实现**：批量「AI 填充配置」走 `config_generation` 工作流——生成前列举覆盖确认、**生成后零复核**（`onGenerated` 直接 `updateNovelConfig()` 浅合并 + `saveProject()`，无预览 / diff / 撤销 / 快照；对话框内规模参数打开即直写项目、取消不还原；`onComplete: silent`；错误只进日志）。单字段生成**绕过 WorkflowEngine**（假 step、不可取消、无流式、无覆盖确认、错误只进日志）。两条路互不共享组件 / 对话框 / 错误处理。
- 其余 14 处入口形态散：**5 套确认弹窗**（GenerateConfig / ArchitectureConfirm / DirectoryConfig / AIActionDialog / ReviewReport 内联复制）+ 若干 confirm / toast；角色档案状态机重复两份、失败靠 60s 超时兜底；错误提示不一致（有无 toast 各行其是）。
- 共享层**不存在**：无 AI 动作注册 / 服务层；`AIActionDialog` 名为通用实为 refine / review 专用（唯一 caller = DraftEditor）。
- **唯一完整闭环范本**：段落级内联改写（`CodeMirrorEditor`）——流式 + 预览 + 可停止 + 逐句接受 + 不接受不动原文。

## 3. 改法方向（按优先级）

1. **产出审查层（最高优先）**：统一「生成 → 复核 → 应用」。最小可行一步 = **前置快照 + 撤销出口**（现在连快照都没有，浅合并落库无退路）；破坏性覆盖（配置 12 字段、角色卡重建）再加「查看变更」diff。终态向范本看齐：结构化内容「预览 + 逐字段接受」，文本改写「流式 + 接受 / 拒绝」。单字段至少补齐与批量同级的覆盖确认。
2. **统一执行路径**：单字段走 `startWorkflow`（可取消、流式、进面板、统一失败面），删假 step；配置生成补 `isTypeRunning` 守卫 + 按钮随工作流禁用（对齐架构 / 蓝图弹窗）。
3. **收敛确认壳**：`AIActionDialog` 泛化为「action 描述（key + 参数 + 提示词模板）」驱动的统一壳，配置 / 架构 / 蓝图 / 报告共用（先删 ReviewReport 的复制体）；角色档案状态机抽公共 hook、60s 超时改显式失败事件；错误面统一 toast + 日志（对齐 DraftEditor 标准）。
4. **与 Agent / 命令层打通**：`start_workflow` 工具补 `config_generation`（现在 Agent 起不了配置生成）；长期让按钮与 Agent 共用底层命令层——**按钮 = 显式命令通道**，与「两套判据」精神一致，两份入口一份实现。
5. **补能力入口（产品决策）**：`fill-gaps`「AI 补全」有能力无入口；知识面板无任何 AI 动作。

## 4. 状态与待定

- **是否实施未拍板**（候选线）——实施前先定范围：五条改法是全做还是先做第 1 条（产出审查层 / 最小可行 = 快照 + 撤销）。
- 若实施：建议独立 spec 细化（本档为方向；1–5 的优先级即建议切分顺序）。

## 5. 验收（若实施）

- 门禁三绿；
- 真机：批量配置生成 → **可预览 / 可撤销**；单字段生成 → 覆盖确认与批量同级、失败有 toast；角色档案失败显式化（不再 60s 静默超时）。

## 6. 证据索引（切片）

- 总纲 §5 的「手动 AI 入口盘点（§3.5）」全条目：`NovelConfigEditor.tsx:75-137, 322-329`（自审实测 `onGenerated` 现为 `:325-327`）、`GenerateConfigDialog.tsx:46-65, 81-114`、`generate-field.command.ts:55-67`、`architecture.command.ts:56-108`、`architecture-workflow.ts:102-119`；`AIActionDialog.tsx:19-26`、`ReviewReport.tsx:434-470`、`CharacterEditor.tsx:119-141` + `CharactersView.tsx:59-82`、`CodeMirrorEditor.tsx:686-744, 817-843`。
