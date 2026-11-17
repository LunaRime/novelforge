# C1c 蓝图删除命令实施计划

2026-11-07，基线 `04a2397`。承接 [18](18-followup-implementation-plan.md) 与 [23](23-blueprint-load-save-application-plan.md)。本批迁移章节蓝图编辑器的手动删除，目录工作流批量清理留给生成专项。

- [x] 先补应用层、组件与边界失败回归。覆盖显式拒绝、项目切换、保存互斥、过期列表、取消确认与失败保留编辑。
- [x] 扩展 `ChapterBlueprintPorts.deleteOne(chapterNumber): Promise<boolean>` 和同名应用命令。检查正安全章号、项目会话和实例写锁。删除启动时淘汰旧读取。成功仅表示当前单条删除已提交。
- [x] renderer adapter 通过既有 `db:blueprint-delete` 调用，要求 `success === true`。controller、权限与仓储保持既有边界。仓储是一条 SQLite DELETE，无附带的草稿、历史或卷区间变更。
- [x] ChapterCardEditor 继续负责确认、当前行身份核对、保留其他行的 dirty 与选择、失败反馈。成功使用 `Delete:Blueprint` 日志与三语 toast，并通知蓝图投影刷新。关闭/重开后忽略旧命令结果。
- [x] 定向回归、独立复核与全量门禁。更新 18 和架构索引。本地独立提交。下一小批核对生成/校检边界，草稿列表另批处理。

## 实施记录

`deleteOne` 通过蓝图应用实例复用保存的写锁和读取版本。适配器要求现有 IPC 返回明确成功。编辑器保留确认、行身份和项目会话保护。失败保留原选择和未保存编辑。提交成功后只移除目标行，发布蓝图资源刷新，并通过三语提示和 `Delete:Blueprint` 日志反馈。仓储沿用已有单条删除语义。

应用和组件首轮回归观察到 4 条失败，边界规则单独观察到 1 条失败，接线后通过。独立复核发现删除前一行时，如果用户选中其他行，原索引会落到下一章。新增用例先失败，改为按原行对象定位后通过。组件定向 13 条通过，复核无其他待修问题。

最终本地验收为 333 个测试文件、3,661 条测试。另跑 12 条契约测试。全量 TypeScript、零警告 ESLint、core 独立编译、边界 0/0/0、生产 Vite 构建及公开产物审计通过。package.json 和锁文件核对无变化。日志位于 `logs/tmp/blueprint-delete-*.log`。下一批 C1d 核对目录生成、补缺口和校检。
