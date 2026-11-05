# 五个 Agent 项目横向对比 + NovelForge「根刺」诊断

> 调研日期：2026-10-28
> 样本：pi / deepseek-harness / denova / genoffice / Claude Code 源码 + NovelForge
> 目的：回答「为什么 NovelForge 用着总觉得不对，但说不出哪里不对」

---

## 一、一句话结论

**这五个项目都把「事实」放在一个不可变的日志或模型里，UI 是它的投影；NovelForge 反过来了——UI 状态是事实，数据模型是投影，而且为了迁就 UI 在伪造字段。**

这就是那根刺。它不是 bug，是**表达与事实的分离**。

---

## 二、五个项目的画像

| | 形态 | 代码量 | agent 内核 | 事实源 |
|---|---|---|---|---|
| **pi** | CLI / SDK | agent 2.5k + 产品 76.5k | `packages/agent`，6 文件 2541 行 | append-only JSONL transcript 树 |
| **deepseek-harness** | Web/CLI/Desktop | 53 万行，397 子包 | core 仅 2.8%，全是插件 | append-only SessionEvent log |
| **denova** | Go 服务 + 浏览器 | Go 254k + TS 146k | 独立 Go module 49.3k | 文件（JSONL + progress.md + 角色卡） |
| **genoffice** | Electron 办公套件 | 759k，AI 占 7.8% | agent-core 3.4k | 文档模型（docx/Univer/pptx） |
| **Claude Code** | CLI | 513k | query loop + tools | 会话 transcript |
| **NovelForge** | Electron 桌面 | 112k（+45k 测试） | 无独立内核，混在 services | **UI store（DB/文件是副产物）** |

### pi —— 薄内核，厚产品
- 依赖链干净：`pi-ai` → `pi-agent-core` → `pi-coding-agent`。内核只做调度，不做策略：不重试、不压缩、不管权限。
- 主循环用 `lastCompletedTurn` 快照传递状态，三个钩子（prepareNextTurn / prepareRequest / finishTurn）表达全部控制流。
- 刻意不做 sub-agent 和 plan mode——后者做成示例扩展。**用「不做」换内核的稳定**。
- 上下文策略全外置：内核只暴露 `transformContext`；压缩、截断都在产品层。
- 最值得抄的：**transcript 是唯一事实源**，system prompt 和工具声明都编码进 message，所以回放、fork、压缩只依赖日志。

### deepseek-harness —— 配置树即程序
- everything-is-a-plugin 落到 Cordis：插件 = `{ apply(ctx, config) }`，声明 `inject/provide`，挂了自动回滚。
- agent loop 自己也是插件（`AgentLoop → ReactLoopAgent`），可被替换。
- 权限三段式（pre-execute waterfall → approval seam → sandbox policy），所有工具走同一条受治理管线。
- **代价写在数字里**：core 只占 2.8%，boot 组 1.3 万行，app-boot 单文件 1274 行。追一个行为要跨 profile → patch → service → event → tool 五个包。
- 最值得抄的：**「model-visible means logged」**——任何模型可见的输入都必须先变成 SessionEvent。

### denova —— 与 NovelForge 最像的对手
- 同样做「小说 + AI」，但形态是 Go 服务 + 浏览器，不是 Electron。
- **agent 运行时是独立 go module**（49.3k），产品侧 `internal/agents`（60.6k）只做适配：Definition、上下文来源、工具目录、多 runtime 切换。
- 写作流程不写死：主流程在 system prompt 里（构思→大纲→细纲→写章→同步），档位由 SKILL.md 承载（novel-standard 有审稿、novel-lite 没有）。**改流程 = 改 prompt，不用改代码**。
- 反过来，游戏侧（掷骰、规则判定、状态机）是硬编码 Go。**该确定的地方确定，该灵活的地方灵活**。
- 领域层 `internal/book`（12k）只管「文件与状态」，不 import 任何 runtime 包——**零耦合**。

### genoffice —— agent 贴着文档跑
- agent-core 只有 3.4k 行（ReAct + Skill + IPC transport），但 6 个 app 各自一套 AiPanel（合计 43.5k）。
- 工具直接在渲染进程操作编辑器（`apply_ops` 原子批），不做 diff 审批，靠 schema 校验 + 读回校验 + 一千多行循环护栏兜底。
- 明确取舍：**放弃统一 agent 运行时**，换来工具能精确到字符。代价是 6 套重复实现、会话不跨文档。

### Claude Code —— 标杆的工程细节
- 主循环 `queryLoop` 的 `while(true)`，跨轮状态集中在 `State`，`transition` 记录「为什么继续」。
- 工具契约里写死执行语义：`isReadOnly` / `isConcurrencySafe` / `isDestructive`，调度器只读这些布尔值分批并发。
- 上下文四道闸门：单条结果落盘（50k）→ 单消息聚合预算（200k）→ microcompact（只清内容不动 id，保 cache）→ 摘要压缩。**每一次压缩都刻意保持前缀字节不变**。
- 子代理不是开进程，是**克隆 ToolUseContext**：深拷贝 readFileState、独立 AbortController、`setAppState` 默认 no-op。比容器隔离便宜一个数量级。

---

## 三、它们真正的共同点

不是「都有 agent」，而是**都建立了一条单向事实链**：

```
事件日志 / 文档模型  →  派生视图（消息、UI、摘要）  →  渲染
```

- pi：transcript → session projection → TUI
- dsh：SessionEvent → deriveMessages() → Web UI
- denova：journal + 文件 → turn projection → SPA
- Claude Code：transcript → messagesForQuery → REPL
- genoffice：文档模型 → 视图 → 画布

**反向依赖是被禁止的**：UI 不能反过来定义数据长什么样。

NovelForge 恰恰在这里反了。

---

## 四、NovelForge 的「根刺」：三层

### 第一层（表层症状）：同一个动作有三条写入路径

「写一章」有三个入口，走三套逻辑：

1. UI 按钮 → `workflow-starter.startChapterWorkflow()` → `createChapterWorkflow`（命令式 steps）
2. Agent → `start_workflow` 工具 → 同一个 workflow-starter
3. Agent → 直接 `write_file` / `edit_file` 写正文（绕过 workflow）

`workflow` 是命令式步骤链，`agent` 是 ReAct 循环，**两套东西都自称能完成创作**，但：
- 状态推进方式不同（step 回调 vs tool observation）
- 失败恢复不同（workflow 有 rehydrate，agent 只有重试）
- 对 UI 的报告方式不同（workflow progress vs tool artifact）

用户体感：**同样的操作，有时有进度条有时没有；有时能撤销有时不能；有时会问我有时不问。**

### 第二层（结构问题）：没有单一事实源

一个「章节」在系统里有 6 种表示：

| 表示 | 位置 | 谁写 |
|---|---|---|
| 正文 | `contents.body`（SQLite） | 写稿/编辑 |
| 草稿元数据 | `drafts` 行（version/status/hash） | 状态流转 |
| 「文件」 | `DraftMeta.filePath` / `fileName` | —— |
| 大纲要点 | `blueprints` 表 + `notes` | 定稿后处理 |
| 记忆 | summary_snapshots / 章节记忆文件 | 后处理 DAG |
| 向量 | LanceDB chunk | kb_import |

而 `DraftMeta` 自己承认了这件事：

```ts
chapterTitle?: string  // 为了兼容保留（UI极少直接从draft拿），实际上可不填
fileName: `draft_v${version}.md`   // 纯显示串：DB 里没有这个文件
filePath: `vela://draft/${id}`      // 虚拟 URI：被 editor-store 当作文档身份
```

**`fileName` 是伪造的，`filePath` 不是。** 后者是合法的虚拟 URI（编辑器 untitled buffer 同理）。真正的问题不是"造假"，而是**一条 URI 成了章节在 UI 里的身份**——所以不是删字段，是换成 `docId`。

更严重的是 `drafts` 表注释：

```sql
chapter_number INTEGER NOT NULL,  -- 归属章节（与 blueprints 松散关联，导入时先于蓝图创建）
-- 注：chapter_number 与 blueprints 无硬 FK
```

**没有硬外键**。章节、大纲、正文之间靠 `chapter_number` 这个数字松散关联。所以「第 3 章」不是一个实体，是一个约定。

一致性因此只能靠 **定稿后处理 DAG 事后补偿**（kb_import → 剧情/角色/伏笔/声音/文风/记忆 八路并行）。这个 DAG 越复杂，越说明上游模型不收敛。

### 第三层（根因）：UI 是架构的第一约束

数字：

| 层 | 行数 | 占比 |
|---|---|---|
| `src/components` | 38,353 | 34% |
| `src/services` | 31,555 | 28% |
| `electron` | 22,163 | 20% |
| `src/stores` | 7,115 | 6% |

> 口径：非测试 TS/TSX 物理行，2026-10-28 实测。

**UI 比业务层还大。** 这在 agent 类项目里是异常值——pi 的 TUI 只占 15%（19.8k / 130.7k），主体代码花在会话、压缩、扩展加载上；Claude Code 的 513k 行里，架构主体是 `query/` + `tools/` + `compact/` + `permissions/`，UI 只是入口。

配套证据：
- `src/shared/ipc-channels.ts` **1614 行、273 个通道**。renderer 和 main 之间不是「域接口」，是扁平 RPC 表。
- `agent-store.ts` **2064 行**，一个 store 里同时装：会话消息、UI 折叠状态（showHistory / memoryView）、运行时状态（generating / activeRequestId / agentProgress）、观测数据（sendObservations）。
- **26 个 agent 工具里有 20 个从 `stores/*` 里取依赖（77%）**：工具内共 34 处 `getState()`，其中 `project-store` 17 处（工具运行时去全局状态里捞「当前项目路径」，而不是被注入），`editor-store` 11 处直接改 UI，其余 `vector-config`(2)、`workflow`/`draft`/`layout`/`agent` 各 1 处。`start-workflow.tool.ts` 甚至在工具执行中调 `useLayoutStore.getState().openRightPanel('ai-output')`。工具本该是被注入的纯函数，现在它们自己伸手去拿环境。
- `ToolArtifact` 定义了 **13 种产物类型**，全部为 UI 渲染服务。

后果是一条**只能加不能改**的路径：

> 想改数据模型 → 要改 UI → 怕改 UI → 伪造字段 → 兼容层累积 → 新人（包括你自己）读到的是「貌似合理但前后不一致」的代码 → **说不出哪里不对，但用着不对**。

---

## 五、为什么你自己的两份评审文档都说「健康」

`docs/architecture-review.md` 的结论是「框架整体健康、分层清晰、架构纪律很好的样本」，`docs/project-structure-review.md` 说「目录组织整体健康」。

它们没错，但**检查的维度不对**：

| 评审检查的 | 用户感觉到的 |
|---|---|
| 文件放对目录了吗 | 同一个概念是不是只有一处定义 |
| IPC 有没有白名单 | 一次修改要跨几个进程才能生效 |
| 命名规范吗 | 数据模型是否诚实 |
| 有没有死代码 | 两套执行路径会不会打架 |

前者是**结构规整度**，后者是**语义一致性**。一个项目完全可以「目录极整齐 + 模型极混乱」。

这就是为什么你读完评审报告觉得「嗯，挺好」，但一用又觉得「哪里不对」。

---

## 六、如果只做三件事

按投入产出排序（具体施工顺序与"不留兼容层"的取舍见 [03 路线](architecture/03-roadmap.md) / [04 施工](architecture/04-refactor-plan.md)）：

**1. 给「章节」一个一等公民身份（收益最大，M1）**

```ts
// src/domain/chapter.ts —— 唯一的 Chapter 定义
interface Chapter {
  id: string            // 稳定 ID，不是 chapter_number
  number: number
  title: string
  volumeId: string | null
  outline: ChapterOutline | null
  currentDraftId: string | null
  // 正文不进模型，通过 Draft 引用
}
```

- `chapter_number` 降级为「显示属性」，不再充当主键/外键。
- `DraftMeta.fileName` 删除；`filePath` 不是伪造字段，而是 `vela://` 虚拟 URI，要换成 `docId` 才能删（见 [04 · M4](architecture/04-refactor-plan.md)）。
- 加一个**语义一致性契约测试**：改标题后，检查 DB、导出文件、索引、记忆里的标题是否都变了。这是 278 个测试文件 / 3,078 个用例里目前缺的那一类。

**2. 让三条写入路径合流（收益中等但决定长期速度）**

二选一，不要都留：
- **workflow 降级为 agent 的工具集**：workflow 不再有独立 UI 入口，全部由 agent 调 `start_workflow` 触发，进度通过事件回传。适合你现在的方向（方案 B 已经这么走了）。
- **agent 降级为 workflow 的一个 step**：适合强确定性场景（发版、审稿）。

现在的问题是两条路都「活着」，且都能写正文。

**3. 把 agent 运行时从 UI 里拔出来（M3，为前两件事铺路）**

- `services/agent/` 不允许 import `stores/*`（加 lint 规则 `no-restricted-imports`）。
- 工具输出从「13 种 UI artifact」改为「领域事件」，UI 订阅事件自己决定怎么渲染。
- 这一步不改任何功能，但会立刻暴露所有隐藏耦合——**做完你会看到那根刺的具体形状**。

---

## 七、附：五个项目最值得抄的一件事

| 项目 | 抄什么 |
|---|---|
| pi | 内核只做调度不做策略；transcript 是唯一事实源 |
| deepseek-harness | 「model-visible means logged」——模型看到的一切必须先落日志 |
| denova | 流程放 prompt/skill，一致性放代码；运行时独立成库 |
| genoffice | 写入即生效 + 原子批 + 读回校验（而不是 diff 审批） |
| Claude Code | 工具契约写死执行语义（isReadOnly/isConcurrencySafe），调度器只读布尔值 |
