# NovelForge 架构文档

> 当前实施边界（2026-11-13）：独立存储核心、M2–M4、编辑器应用层、修稿原子合并与知识库侧栏均已交付。本分支已完成知识库总览 A、架构文档 B1、小说配置 B2 与架构状态总览 B3（19–22），以及 C1a–C1g（23–24、26–30）、C2（31）和 [C3 角色模板与重复角色合并](32-character-templates-and-merge-plan.md)。C3 本地验收为 350 个测试文件、3,849 条测试。[D1 状态职责清单](33-store-responsibilities.md) 已完成，[D2 项目保存与配置撤销](34-project-config-save-plan.md) 已提交为 `6e13992`。[D3 Runtime 实例隔离](35-runtime-instances-plan.md) 已提交为 `d5c964d`。[D4 无 UI 创作业务链路](36-headless-draft-lifecycle-plan.md) 已提交为 `45a6530`。[E1 存储生命周期矩阵](37-storage-lifecycle-matrix.md) 已完成，下一批为 E2 只读诊断。应用入口当前读写现有 DB，离线迁移输出使用独立空目录。

> 2026-10-28 起，这一组文档是改造的权威依据。旧的 `docs/architecture-review.md`、`docs/project-structure-review.md` 回答的是"目录整不整齐"，这里回答的是"事实放在哪、一次改动要跨几层"。

---

## 阅读顺序

| # | 文档 | 一句话 | 状态 |
|---|---|---|---|
| 01 | [现状诊断](01-diagnosis.md) | 一个章节有六种身份，UI 是事实源 | 已完成 |
| 02 | [目标架构](02-target-architecture.md) | 依赖单向向下；core 可独立编译 | 已完成 |
| 03 | [改造路线](03-roadmap.md) | 五个里程碑，不留兼容层 | 已完成 |
| 04 | [施工细则](04-refactor-plan.md) | 每步改哪个文件、怎么验证 | 已完成 |
| 05 | [可借鉴清单](05-lessons.md) | 六个项目里哪些机制值得抄 | 选读 |
| 06 | [存储方案](06-storage-design.md) | 文件是真相，索引可重建 | 已完成（原型 11/11） |
| 07 | [DB 与规模](07-db-and-scale.md) | DB 只做索引 / 检索 / 缓存 / 协调 | 已完成 |
| 08 | [自审与迁移](08-self-review-and-migration.md) | 用项目自己的规范审这套文档；15 个 0.1.x 用户怎么迁 | **必读（3 条 P0）** |
| 09 | [本轮实施计划](09-core-implementation-plan.md) | 核心与离线迁移，不切应用入口 | 2026-11-05 |
| 10 | [核心使用与验证](10-core-usage.md) | 当前 API、离线导出命令与限制 | 2026-11-05 |
| 11 | [M2 合流计划](11-write-flow-implementation-plan.md) | 应用入口、真实草稿身份与写入用例 | 已验证 |
| 12 | [M2 与公开构建验收](12-m2-and-public-build.md) | 控制台裁剪、议题 #41/#42 与最终验证 | 2026-11-05 |
| 13 | [M3 运行时实施与验证](13-m3-runtime-implementation-plan.md) | 端口注入、四类事件与显式调度语义 | 2026-11-06 |
| 14 | [M4 草稿与编辑器身份](14-m4-document-identity.md) | 元数据清理与 doc 标签身份 | 2026-11-06 |
| 15 | [编辑器应用层抽离](15-editor-application-plan.md) | UI、应用用例与 renderer 适配器分工 | 已实现并通过本地验证 |
| 16 | [修稿合并用例与原子提交](16-revision-merge-application-plan.md) | 合并业务退出 store，三项同事务 | 已实现并通过本地验证 |
| 17 | [知识库侧栏应用层抽离](17-knowledge-panel-application-plan.md) | 搜索/摘要/删除用例及请求失效保护 | 已实现并通过本地验证 |
| 18 | [后续重构实施计划](18-followup-implementation-plan.md) | 各批实施范围、顺序与验收条件 | E1 已完成，E2 只读诊断待续 |
| 19 | [知识库总览应用层实施](19-knowledge-overview-application.md) | 维护互斥、导出元数据、项目隔离及总览组件回归 | 本地提交 0c1375c |
| 20 | [架构文档应用层实施](20-architecture-document-application-plan.md) | B1 读写/生成用例、dirty 会话与运行归属 | 本地实施与验证记录 |
| 21 | [小说配置应用层实施](21-novel-config-application-plan.md) | B2 保存、字段版本、生成冲突与撤销保护 | 本地实施与验证记录 |
| 22 | [世界观与架构状态应用层](22-architecture-overview-application-plan.md) | B3 部分失败、来源隔离、提取取消与编辑会话保护 | 本地实施与验证记录 |
| 23 | [章节蓝图加载与保存应用层](23-blueprint-load-save-application-plan.md) | C1a 快照保存、逐行 dirty、来源隔离与批量事务验证 | 本地实施与验证记录 |
| 24 | [活页夹卷归属与手动顺序](24-binder-application-plan.md) | C1b 重排用例、实际成员投影与事务回滚 | 本地实施与验证记录 |
| 25 | [UI 与前端重构实施计划](25-frontend-ui-refactor-plan.md) | 后端交接、应用壳、写作体验、导航、AI 与验收 | 计划已写，等待后端交接 |
| 26 | [蓝图删除命令](26-blueprint-delete-application-plan.md) | C1c 手动删除、会话隔离与写入互斥 | 本地实施与验证记录 |
| 27 | [蓝图生成入口、补缺口与校检](27-blueprint-generation-verification-plan.md) | 严格快照、连续缺口、确认与派发失效保护 | 本地提交 7f04bbe |
| 28 | [补缺口执行期仅插入协议](28-blueprint-gap-insert-only-plan.md) | 写时不覆盖、连接身份、取消与断点恢复来源保护 | 本地提交 133c8bb |
| 29 | [目录蓝图生成写入](29-directory-blueprint-write-plan.md) | 全书与范围生成、快照冲突、原子提交与断点处理 | C1f 已通过本地验收 |
| 30 | [草稿箱应用层接入](30-draft-box-application-plan.md) | 真实草稿身份、会话列表、归档与项目切换隔离 | C1g 已通过本地验收 |
| 31 | [角色编辑事务](31-character-edits-transaction-plan.md) | 字段冲突、角色身份、引用更新与模型写时合并 | C2 已通过本地验收 |
| 32 | [角色模板与重复角色合并](32-character-templates-and-merge-plan.md) | 应用级模板、项目会话保护、合并事务与引用重定向 | C3 已通过本地验收 |
| 33 | [状态职责清单](33-store-responsibilities.md) | 项目、草稿、角色与工作流的异步操作、提交点及现有验证 | D1 已完成 |
| 34 | [项目保存与配置撤销](34-project-config-save-plan.md) | 写入互斥、迟到回执、项目连接与字段撤销 | D2 已本地实现 |
| 35 | [Runtime 实例隔离](35-runtime-instances-plan.md) | Agent 端口、审批与工作流事件、断点隔离 | D3 已本地实现 |
| 36 | [无 UI 创作业务链路](36-headless-draft-lifecycle-plan.md) | 草稿身份、修稿与审稿、合并回滚及定稿保护 | D4 已提交 |
| 37 | [存储生命周期矩阵](37-storage-lifecycle-matrix.md) | SQLite 创作入口、离线文件覆盖与切换准入 | E1 已完成 |
| — | [调研全文](../2026-10-28-architecture-comparison.md) | 六个项目的对比与「根刺」 | 背景材料 |
| — | [原型](prototype/chapter-store.mjs) | 纯 Node 存储原型，11 条断言 | 可运行 |

三句话概括整套方案：

1. **真相**：`chapters/*.md`，`id` 在 frontmatter；`SQLite` 只是可删可建的索引。
2. **路径**：章节正文只有一个写入口 `writeChapter`，agent 与 UI 都走它。
3. **核心**：`src/core/` 不依赖 Electron / React / stores，能 `tsc` 独立编译——将来可抽包。

---

## 当前可运行的验证

```sh
pnpm run test:contracts
pnpm run typecheck:core
pnpm run check:boundaries
# 只对一致的离线库副本执行，目标目录必须尚不存在
pnpm run migrate:files ./offline-vela.db ./new-export project-id
```

实际命令参数与限制见 [10 核心使用](10-core-usage.md)。`doctor` 命令与应用切换尚未交付。

## 后续切换的验收目标（尚未启用）

```bash
# 1) 删索引不丢章
rm .novelforge/index.db && pnpm doctor

# 2) 契约全绿（没有 .fails 残留）
pnpm test:contracts

# 3) core 能独立编译（不需要 Electron 二进制）
pnpm exec tsc -p tsconfig.core.json

# 4) 边界没回潮
pnpm check:boundaries
```

---

## 图示

| 图 | 源文件 | 渲染产物 |
|---|---|---|
| 现状 | [`../diagrams/novelforge-current.zh.json`](../diagrams/novelforge-current.zh.json) | `novelforge-current.zh.html` + [`images/01-current-state.png`](images/01-current-state.png) |
| 目标 | [`../diagrams/novelforge-target.zh.json`](../diagrams/novelforge-target.zh.json) | `novelforge-target.zh.html` + [`images/02-target.png`](images/02-target.png) |
| 路线 | [`../diagrams/novelforge-roadmap.zh.json`](../diagrams/novelforge-roadmap.zh.json) | `novelforge-roadmap.zh.html` + [`images/03-roadmap.png`](images/03-roadmap.png) |
| 创作流程 | [`../diagrams/novelforge-workflow.zh.json`](../diagrams/novelforge-workflow.zh.json) | `novelforge-workflow.zh.html` |

**图源是 JSON，HTML 是生成物，PNG 是 HTML 的截图。** 改文案只改 JSON，然后重渲染。

```bash
# 需要 archify 3.2.0（HTML 的 meta generator 可查版本）
ARCHIFY=/path/to/archify/archify/bin/archify.mjs
TMP=$(mktemp -d)          # 关键：渲染到临时目录再复制
# 原因：本机 D:/E: 盘的删除会进回收站，archify 的原子写校验会失败

node "$ARCHIFY" validate architecture docs/diagrams/novelforge-current.zh.json
node "$ARCHIFY" render   architecture docs/diagrams/novelforge-current.zh.json "$TMP/current.html"
cp "$TMP/current.html" docs/diagrams/novelforge-current.zh.html

# PNG：1400×1250 @1.5x = 2100×1875，与现有图片一致
chrome-headless-shell --headless --disable-gpu --no-sandbox \
  --screenshot="$TMP/current.png" --window-size=1400,1250 \
  --force-device-scale-factor=1.5 --virtual-time-budget=8000 --hide-scrollbars \
  "file://$TMP/current.html"
cp "$TMP/current.png" docs/architecture/images/01-current-state.png
```

> `workflow` 类型的图（路线图）validate/render 的第一个参数是 `workflow`，不是 `architecture`。

---

## 约定

- **数字口径**：所有行数 = 非测试 TS/TSX 物理行；每篇注明实测日期。改代码后数字会漂，别凭记忆写。
- **命名与改动规范**：项目文件 / 源码 / 文档三套命名规则、M1–M4 改名清单、改动前必过的 7 条检查，见 [04 附录 B](04-refactor-plan.md)。三条高压线：
  1. **章节 id 独立于章号**。离线导出以项目 ID 和草稿 ID 计算哈希，实时接入须持久化身份映射。见 [存储生命周期矩阵](37-storage-lifecycle-matrix.md)。
  2. **标题不进文件名**——`chapters/{0001}.md`，标题只在 frontmatter。中文 slug 会撞 Unicode 归一化，标点会撞路径注入。
  3. **改名必须捕获 `renameMap` 联动**（引用 / 索引 / 导出 / 记忆四处）。
- **`vela` / `.vela` 残留**：391 处 / 87 文件，按"是否落盘"三级处置，见 [04 附录 B.5](04-refactor-plan.md)。一句话判断标准：**名字会出现在磁盘 / 用户 profile / 数据库 → 不改；不会 → 随便改。** `vela.db`、`.vela` 保护段、`vela-*` localStorage 键属于前者，保留到 1.0；`velaAPI`、`VELA_HOME` 属于后者，M3 全局替换。
- **文档命名**：专题文档放 `docs/architecture/`（不带日期，`01-…` 前缀表阅读顺序）；单篇报告放 `docs/` 带日期前缀。
- **图示**：`docs/diagrams/*.html` 标记为生成物（见根目录 `.gitattributes`），diff 折叠显示。
- **不做**：不引入 DI 框架、不拆 monorepo（理由见 [03](03-roadmap.md) 末尾）。
- **迁移边界**：当前只离线导出到独立空目录，原 DB 和应用入口保持原样；不进行影子双写。08 中旧双写路线已撤销。
- **写文档也要过一遍项目规范**：08 是用 `.agents/skills/` 里的规范审出来的，9 条里有 3 条 P0。下次写完架构文档，先跑一遍自审再落盘。

