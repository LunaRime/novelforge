# 05 · 可借鉴清单：六个项目，十二个机制

> 阅读顺序：[01 现状](01-diagnosis.md) → [02 目标](02-target-architecture.md) → [03 路线](03-roadmap.md) → [04 施工](04-refactor-plan.md) → **05 借鉴**
>
> 样本：pi / deepseek-harness / denova / genoffice / Claude Code / archify

---

## 结论先行

前面诊断出三个病，六个项目恰好各自治好了其中一个：

| 你的病 | 谁治好了 | 核心机制 |
|---|---|---|
| 双轨执行 | pi、Claude Code | 内核只调度，策略外置；工具契约自带执行语义 |
| 没有单一事实源 | pi、dsh、Claude Code | 日志/模型是唯一真相，视图是投影 |
| UI 是第一约束 | denova、pi | 运行时抽成独立库，产品只做适配 |
| **可验证性缺失**（新发现） | **archify** | 诊断带修复建议；通过拆成互不蕴含的凭证 |

最后一行是这次加进 archify 之后才看清的：**你的项目有 278 个测试文件 / 3,078 个用例，但没有一组在验证「同一事实的多种表示是否一致」——它们都在验证「函数是否按预期返回」**。

---

## 一、治「双轨执行」

### 1.1 内核只调度，不做策略（来自 pi）

pi 的 agent 内核只有 2541 行、6 个文件，不重试、不压缩、不管权限。所有策略都在产品层或扩展里。

落到 NovelForge：`agent-engine.ts` 现在 1032 行，里面塞了 DSML 解析、XML 协议过滤、预算压缩、错误恢复三档降级、工具调度。**这些都不是循环该干的事**。

拆法：

```
runtime/loop.ts          只管：调模型 → 收 tool_call → 执行 → 回填
runtime/recovery.ts      可恢复错误的降级策略
runtime/protocol.ts      模型方言适配（DSML / XML / 原生）
runtime/tool-scheduler.ts 并发与超时
```

判断标准：`loop.ts` 里不该出现任何 `if (model === 'deepseek')`。

### 1.2 工具契约自带执行语义（来自 Claude Code）

Claude Code 的每个工具强制声明 `isReadOnly` / `isConcurrencySafe` / `isDestructive`，调度器只读这三个布尔值就能分批并发（`toolOrchestration.ts:91-116`），新增工具不用改调度器。

NovelForge 现在靠 `MAX_PARALLEL_READ_TOOLS` 加约定。改成：

```ts
interface AgentTool {
  isReadOnly: boolean
  isConcurrencySafe: boolean
  isDestructive: boolean
}
```

好处立刻体现：`write_file` 和 `read_file` 混在一批时，调度器自动串行化写操作，不用人工维护「哪些工具能并发」的清单。

### 1.3 该确定的地方硬编码，该灵活的地方 prompt（来自 denova）

denova 做的是同类产品（小说创作），它的切分很清醒：

- 写作流程 → system prompt + SKILL.md（改流程不用改代码）
- 游戏规则（掷骰、状态机、判定）→ 硬编码 Go
- 领域数据（章节路径、角色卡、资料库）→ Go，**不 import 任何 runtime 包**

NovelForge 现在反过来：写作流程硬编码成 `chapter-workflow` 的 steps，而"什么算好章节"散在 prompt 里。

**建议的切分线**：

| 必须确定性（代码） | 必须灵活（prompt/skill） |
|---|---|
| 章节状态机（draft → revised → finalized） | 怎么写这一章 |
| 数据不变量（不能有孤儿 draft） | 审稿标准与评分权重 |
| 定稿后的后处理顺序 | 伏笔埋设策略 |
| 字数、格式、导出结构 | 文风、语气、节奏 |

现在 `finalize` 的 8 路 DAG 属于左边（该代码化，已经是了），`chapter-workflow` 的写稿步骤属于右边（该搬进 prompt）。

### 1.4 写入即生效 + 原子批 + 读回校验（来自 genoffice）

genoffice 的 agent 不做 diff 审批，而是 `apply_ops` 原子批：任一条非法整批拒绝，写完读回校验。对「段落级改写」这种局部操作，这比让用户逐条确认快得多。

NovelForge 的段落改写（扩写/缩写/改风格）现在是整段替换 + 用户手动撤销。可以借鉴：把一次改写的多个 op 打包，全成功才落盘，失败不留半成品。

---

## 二、治「没有单一事实源」

### 2.1 transcript 是唯一真相（来自 pi）

pi 的 system prompt 和工具声明都编码进 message，所以回放、fork、压缩只依赖日志。`buildSessionProjection` 从日志派生模型看到的消息。

NovelForge 的对应物应该是**章节事件流**：

```
ChapterCreated → DraftWritten → DraftRefined → Reviewed → Finalized → PostProcessed
```

现在这些状态变化散在 `drafts.status`、`workflow_checkpoints`、`post_process_runs` 三张表里，没有统一的事件序列。加一张 `chapter_events`（append-only），状态由事件重放得出——这样才能回答「这一章是怎么变成现在这样的」。

### 2.2 model-visible means logged（来自 deepseek-harness）

dsh 的铁律：任何模型可见的输入，都必须先变成 SessionEvent。

对 NovelForge 的直接用处：**排查"为什么 AI 写歪了"**。现在 prompt 是运行时拼的，出问题只能靠日志猜。如果每次请求的 system + context 都落成事件，就能精确回放。

成本极低（一次 JSON 落盘），收益极高。

### 2.3 压缩要保前缀字节不变（来自 Claude Code）

Claude Code 的 microcompact 只清旧工具结果的**内容**，保留 `tool_use_id` 和结构，就是为了不破坏 prompt cache 前缀。它的压缩策略全部从 `effectiveWindow` 减预留推导，还有连续 3 次失败熔断。

NovelForge 的 `computeMessageBudget` + 降档重试思路类似，但缺两样：**缓存友好**（是否保持前缀稳定）和**熔断**（现在是 `MAX_CONSECUTIVE_RECOVERY_FAILURES = 3`，有了）。补前者：压缩只从尾部截，不动 system 和早期消息。

### 2.4 发布要身份绑定，不是 writeFileSync（来自 archify）

archify 写一个 HTML 要：持有 fd 锁住 inode → 校验 `dev/ino/mode/sha256/nlink` → 独占硬链接发布 → 隔离删除旧文件 → 失败可恢复（`atomic-output.mjs`）。

听起来过度，但它解决的是真实问题：**「我写的这个文件，和我校验的那个文件，是同一个吗」**。

NovelForge 保存章节时如果直接 `writeFileSync`，在「自动保存 + agent 同时改 + 用户撤销」三方并发下，可能出现：校验通过的内容被覆盖、符号链接逃逸、崩溃后留下半截文件。

不需要全套实现，但至少要：**写临时文件 → fsync → rename**（原子替换），并在保存前比对内容哈希。

---

## 三、治「UI 是第一约束」

### 3.1 运行时抽成独立库（来自 denova）

denova 的 `agent/` 是独立 go module（49.3k 行），依赖方向 `agent → lifecycle → engine → context`，**不感知产品**。产品侧 `internal/agents`（60.6k）只做适配。

NovelForge 的等价物是 `src/runtime/`，但关键是**它不能 import 任何 `stores/`**。这不是洁癖，是让 agent 能在 Node 里跑测试的前提。

### 3.2 UI 是消费者，不是定义者（来自 pi）

pi 的 TUI 只做差分渲染，不反向依赖 agent。`tui` 包 19.8k 行，跟 agent 内核零耦合。

NovelForge 的 `ToolArtifact` 13 种类型，本质是**工具在替 UI 设计数据结构**。收敛成领域事件后，UI 自己决定渲染成卡片还是面板。

### 3.3 子代理靠克隆上下文隔离（来自 Claude Code）

Claude Code 的子代理不开进程：克隆 `ToolUseContext`（深拷贝 readFileState、独立 AbortController、`setAppState` 默认 no-op）。比容器隔离便宜一个数量级，又保住了文件读缓存。

NovelForge 有 subagent（`subAgentProgress`），但上下文隔离方式不清楚。如果现在共享 store，改成克隆 + 只读父状态，能立刻消除「子代理改坏了主会话」这类问题。

---

## 四、补「可验证性」（archify 独有，也是你最缺的一维）

### 4.1 错误必须携带可执行修复

archify 的诊断对象是硬结构：

```ts
{ code, severity, message, subject, evidence, supportedFixes[] }
```

`architecture/component-out-of-bounds` 不只说「越界」，而是算出四边 overflow，给出「右移 N px」「width 至少 X」「viewBox 至少 [w,h]」的精确补丁。全仓 214 个 code、30 个命名空间，230 处测试断言 `supportedFixes` 存在。

**NovelForge 的对照**：workflow 失败时只说「第 3 章写稿失败」。应该给出：

```ts
{
  code: 'workflow/draft-generation-failed',
  subject: { chapter: 3, step: 'draft' },
  evidence: { model, promptTokens, errorKind: 'context-overflow' },
  supportedFixes: ['把上下文预算降到 60% 重试', '先补第 2 章定稿再写第 3 章'],
}
```

用户看到的不再是「失败了」，而是「点这个按钮能修」。

### 4.2 修复建议要先试跑，再承诺

archify 的编译器会**先试编译**候选补丁，只有真通过才写入 `evidence.verifiedRepair`，试错噪声用隔离记录丢弃。

对 NovelForge 的启示：agent 说「我帮你改好了」之前，应该先跑一遍校验（字数、角色一致性、伏笔回收），而不是让用户自己发现。

它现在有 `content_audit` 和 `blueprint-verification`，但这些是定稿后的独立步骤，不是「修复的前置验证」。

### 4.3 产物检查器必须独立于生成器

archify 的 `scripts/check-render-output.mjs` 只读 HTML，不 import 任何渲染器——所以它能审计第三方产物，也天然防止「生成器和校验器共享同一个 bug」。

**这是 NovelForge 最该抄的一条**：现在的 5 角色评审用的是同一个模型、同一套 prompt 家族，等于「生成器自己检查自己」。

具体做法：
- 评审 prompt 不带生成时的上下文（只给成品 + 设定）
- 至少一路用不同模型（哪怕降级到便宜模型）
- 结构化评分：每条意见必须指向具体段落，不允许「整体感觉不错」

### 4.4 通过要拆成互不蕴含的凭证

archify 分四级：schema / 静态产物 / 浏览器 / 感知，每级独立 receipt、独立退出码、都绑 `artifact.sha256`，且明确规定「通过一个不蕴含另一个」（`delivery-contract.md:389-396`）。

**NovelForge 的「定稿」现在是一个动作**：跑完 finalize 就定稿。应该拆成：

| 凭证 | 证明什么 | 谁签 |
|---|---|---|
| 结构合格 | 章节有标题、有正文、字数达标 | 代码校验 |
| 设定一致 | 没有和角色卡/世界观冲突 | 提取 + 比对 |
| 连续性合格 | 和前 3 章衔接、伏笔状态正确 | 场景卡比对 |
| 人工确认 | 作者认可 | 用户点击 |

四张都齐才允许 `finalized`。现在这些检查散在后处理 DAG 里，但没有「齐了才算定稿」的门。

---

## 五、优先级矩阵

| 机制 | 收益 | 成本 | 建议 |
|---|---|---|---|
| 契约测试（改标题全链一致） | 高 | 低 | **第 1 周就做** |
| 诊断带 supportedFixes | 高 | 低 | 第 2 周起，边改边加 |
| 评审独立于生成 | 高 | 中 | 第 3 周，与用例层同期 |
| 工具契约三个布尔值 | 中 | 低 | 抽 runtime 时顺手 |
| 章节事件流 | 高 | 中 | 与 Chapter 身份同期 |
| 定稿多凭证 | 高 | 中 | 第 6 周，合流之后 |
| 原子写 + 哈希校验 | 中 | 低 | 一次改完，别再拖延 |
| 内核拆 2541 行 | 中 | 高 | 最后做，或者不做 |

**不要一次做全部**。上面前四条合起来不到两周，已经能消除大部分「不对劲」的体感。

---

## 六、不该学的三件事

### 6.1 不要学 deepseek-harness 的插件树

397 个子包、配置树即程序、core 只占 2.8%。它换来的是任意层可替换 + HMR + 隔离 realm，代价是「追一个行为要跨五个包」，boot 组 1.3 万行、`app-boot` 单文件 1274 行。

NovelForge 11 万行、单人维护，插件化只会让调试变慢。

### 6.2 不要学 genoffice 的六套 AiPanel

它每个 app 一套 AI 面板（合计 43.5k 行），换来工具能精确到字符，代价是 6 套重复实现、会话不跨文档。

NovelForge 只有一种文档（章节），不需要这种拆分。

### 6.3 不要学 Claude Code 的 feature flag 门控

`feature('XXX')` + `USER_TYPE === 'ant'` 让外部构建读到的高级路径未必生效。那是产品发布策略，不是架构优点。你抄了只会得到「代码里一半功能是死的」。

---

## 七、一页速查

```
双轨   → pi 的内核/策略分离 + CC 的工具契约布尔值 + denova 的确定性边界
事实源 → pi 的 transcript 唯一 + dsh 的 model-visible-means-logged + archify 的身份绑定
UI     → denova 的独立 runtime + pi 的 UI 只消费 + CC 的克隆式子代理
验证   → archify 的诊断带修复 + 独立检查器 + 多级凭证
```

如果只能记一句：**archify 教你的不是「怎么画图」，是「怎么让机器替你证明东西是对的」。**

---

延伸阅读：[06 · 小说存储方案](06-storage-design.md)　（文件为真相 + 可重建索引，附可运行原型）

[← 返回 01 现状](01-diagnosis.md)
