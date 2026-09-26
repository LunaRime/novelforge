# 记忆分层：常驻 / 自动 / 手动（C 档第一轮）设计

> **Status**: 设计已获批准（2026-09-26 用户拍板：三值 resident/auto/manual，**manual 的硬门控要真正实现**），待实施。
> **依据**: `docs/superpowers/plans/2026-09-08-agent-capabilities-plan.md`（§7.1-C 条目 C1/C2 / §3.1 C 档「先从 lore 式 resident/on_demand 分层起步」）
> **参照**: Denova `internal/book/lore/`（`types.go` 的数据模型 / `store_read.go` 的渐进装配 / `index.go` 的分级降级 / `lore_catalog.go` 的名字目录）

## 1. 目标与非目标

### 1.1 目标

让"哪些设定必须每轮进上下文、哪些按需披露"成为**用户可编辑的显式分层**，并给模型一条**按名读全文**的通道。

现状（调研结论）：NovelForge 的记忆注入是**隐式硬编码**的一刀切 ——

- M2 作品记忆固定 800 token **截断注入**（`context-builder.ts:26`），超预算时可被整段丢弃（降级链 M1 → M2 → L1 → Tool）
- 知识库是"每轮固定 ≤800 token 自动注入 + `search_knowledge` 工具"双通道，**用户不可关**
- 偏好记忆完全不进 agent 链路（只属写稿工作流）
- **模型手里 27 个工具没有一个能读记忆文件** —— 只有那 800 token 截断注入这一条只读通道
- 全仓无 `resident` / 常驻 / `pinnedMemory` 类载体（grep 零命中）

### 1.2 非目标

- **hindsight 式长期记忆引擎**（LLM 事实提取 → 知识页合成，18-28 人日）：计划 §7.3 已定"先 Denova 式分层，hindsight 降为可选"
- 向量检索记忆：Denova 的 lore 索引是**纯词法 + 模糊匹配**，NF 已有 LanceDB 向量库（RAG 通道），本轮不把两者合并
- 多 agent 拆分派发（C 档第二轮，需先做控制面作用域化）

## 2. 参照实现的关键事实（含一处刻意不抄）

| # | Denova 事实 | 我们的取舍 |
|---|---|---|
| 1 | `load_mode` 三值 `resident / auto / manual`（**没有 `on_demand`**，那是 UI 同义词） | 抄三值；中文命名「常驻 / 自动 / 手动」 |
| 2 | ⚠️ **`auto` 与 `manual` 在 Go 侧没有行为差异**（只有 i18n 文案承诺"manual = 仅明确引用才加载"，后端无门控） | **只抄语义、不抄空壳** —— manual 的硬门控本轮真正实现（§3.4） |
| 3 | resident 有界：警告 32 KiB / **硬上限 1 MiB**（`ResidentLoreSafetyMaxBytes`） | 抄双阈值：警告仅提示、硬上限**拒绝注入并报错**（不静默截断） |
| 4 | 非 resident 只进**名字目录**（≤64 KiB，只放 `- [type/importance] name`），正文靠工具按名取 | 抄；预算按 NF 的 token 口径折算 |
| 5 | 索引渲染**分级降级**：brief 180 rune → brief 72 + hint → 仅 name/id + hint；hint 明示"用关键词收窄再调 read" | 抄（这是名字目录超预算时最有价值的机制） |
| 6 | 装配期 revision fence（前后 revision 必须一致，否则报"lore changed during assembly"） | 简化：NF 的记忆是文件、装配在渲染层一次完成，本轮只做"读到即用"（不做 fence） |

## 3. 设计

### 3.1 数据模型：frontmatter 加 `load_mode`

记忆文件（`{project}/.novelforge/memory/*.md`）的 frontmatter 现有 `status` / `type`，**新增 `load_mode`**：

```yaml
---
type: book
load_mode: resident   # resident | auto | manual；缺省 auto
---
```

- 解析：`electron/utils/memory-codec.ts` 的扁平 key:value 解析器已够用（无需引入 YAML 库）
- **缺省推导**：未声明 → `auto`（**NF 没有 Denova 的 `importance` 字段，故不抄"major → resident"那条规则**）
- 非法值 → 回落 `auto`（fail-safe，不抛）
- 类型：`export type MemoryLoadMode = 'resident' | 'auto' | 'manual'`（放 `src/shared/`，主进程与渲染层共用）

### 3.2 注入重构：resident 全文段 + 名字目录段

**替换** `context-builder.ts:213-252` 现有的"M2 800 token 截断"单一通道，改为**两段**：

| 段 | 内容 | 预算 |
|---|---|---|
| **常驻记忆** | `load_mode === 'resident'` 的条目**全文**，按文件顺序拼接 | `RESIDENT_MEMORY_BUDGET_TOKENS = 4000`（= 硬上限）；超 `RESIDENT_MEMORY_WARN_TOKENS = 2000` 时在 context 明细面板标注「常驻记忆接近上限」，**超硬上限则整段不入上下文**并记 warn（不静默截断） |
| **记忆目录** | 非 resident 的条目：每行 `- [type] name：brief`（brief 取正文首行，截断） | `MEMORY_CATALOG_BUDGET_TOKENS = 800`；超限走**分级降级** |

**分级降级**（Denova `index.go:258-283` 的 NF 版）：`brief 全 → brief 截 72 字 + 提示 → 仅 name + 提示`；提示文案明示「用 read_memory 按名取正文，或用关键词收窄」。

**manual 的可见性**：`manual` 条目**进目录**（模型至少要知道它存在）但带标记（如 `[manual]`），正文需显式引用（§3.4）。

> 与既有降级链的关系：常驻段**参与** `assembleFinalPrompt` 的降级链（它是上下文的一部分，不该享有豁免）；目录段不参与（它很小且是模型发现记忆的唯一途径 —— 与技能目录段的处置一致）。

### 3.3 模型侧通道：`read_memory` 工具

新增只读工具（注册进 `builtinTools`，**排在靠前** —— 工具提示词有 1200 token 截断，排太后契约不可见，这是技能轮 C1 的教训）：

```ts
read_memory({ name?, keyword?, type? }) → string
```

| 入参 | 行为 |
|---|---|
| `name` | 返回该记忆文件全文（**manual 也放行** —— 显式指定就是"明确引用"） |
| `keyword` | 走本地词法匹配（沿用 Denova 的打分思路：name > type > brief > content），返回命中条目的 name + brief + 位置提示 |
| 都缺省 | 返回名字目录（与注入的目录段同源） |

- `requiresConfirmation: false` / `isReadOnly: true`
- 数据源：`memory:read` IPC（已存在，`memory-controller.ts:48-111`），无需新通道
- **与 `search_knowledge` 的分工**：后者查知识库（向量/FTS），本工具查**作品记忆文件**（结构化、有分层）—— 两者互补，工具描述里写明边界

### 3.4 `manual` 的硬门控（Denova 没做的那一半）

**门控位置**：`sendMessage` 组装上下文时，检查本轮用户消息是否**显式引用**了该 manual 条目。

**"显式引用"的判定**（复用既有链路，零 LLM 成本）：

- `intent-router.ts` 的 `parseMentions` 解析出的 `@名字` 提及
- 或本轮调用了 `read_memory({ name })`（模型自取）

**行为**：

| 情形 | manual 条目的正文 |
|---|---|
| 本轮消息 @提及了它 | **注入**（仅本轮：拼进本轮 system 段，**不进会话历史、不被后续轮次继承**） |
| 模型本轮调了 `read_memory({name})` | 由工具返回（不经注入） |
| 其他 | **不注入**（目录仍列出，带 `[manual]` 标记） |

> ⚠️ 与 Denova 的差异：它在通用写作路径上"完全交给模型自决"，只在交互式分支计划路径强制门控。我们**在所有路径统一强制** —— 这是本轮的卖点（用户拍板"真正实现"）。

### 3.5 UI：加载模式选择器

**位置**：`src/components/panels/agent/AgentMemoryView.tsx`（记忆查看/编辑面板，调研已确认其存在与位置）。

- 每个记忆条目的 frontmatter 加一个三态选择器（常驻 / 自动 / 手动），写入文件 frontmatter
- **常驻总量指示**：显示所有 resident 条目的合计 token 与预算占比（超警告阈值时变色）
- 文案（三语）：常驻 = "每轮进上下文"；自动 = "进名字目录，模型可自取"；手动 = "仅显式引用时才加载"

## 4. 测试策略

| 层 | 用例 |
|---|---|
| frontmatter 解析 | 三值解析；缺省 → auto；非法值 → auto（fail-safe）；与既有的 status/type 解析共存 |
| 注入 | resident 全文进段；非 resident 只进目录；manual 带标记；超硬上限 → 整段不注入 + warn；分级降级三档 |
| `read_memory` | 按名读全文（含 manual）；关键词检索；都缺省 → 目录；未知名 → 错误 + 目录 |
| 硬门控 | @提及 manual → 注入；未提及 → 不注入；read_memory 自取 → 工具返回 |
| 回归 | 既有 M2 注入（无 load_mode 的旧文件 → auto）行为不破坏；context-builder 既有测试全绿 |

## 5. 文件结构

| 文件 | 动作 |
|---|---|
| `src/shared/memory-types.ts` | 新建：`MemoryLoadMode` 等共享类型 |
| `electron/utils/memory-codec.ts` | 解析 `load_mode` + 缺省推导 + 非法回落 |
| `src/services/agent/context-builder.ts` | M2 段重构为「常驻全文 + 名字目录」+ 分级降级 |
| `src/services/agent/tools/read-memory.tool.ts` | 新建：`read_memory` 工具 |
| `src/services/agent/tools/index.ts` | 注册（**靠前**，避免被 1200 token 截断砍掉契约） |
| `src/stores/agent-store.ts` | manual 硬门控（@提及判定 → 注入本轮一次性上下文） |
| `src/components/panels/agent/AgentMemoryView.tsx` | 加载模式选择器 + 常驻总量指示 |
| `src/shared/locale-data/*` | 三语文案 |
