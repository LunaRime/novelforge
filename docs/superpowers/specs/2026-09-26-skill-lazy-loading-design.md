# 技能第三面：模型自主懒加载（B 档第一轮）设计

> **Status**: 设计已获批准（2026-09-26），待实施。
> **依据**: `docs/superpowers/plans/2026-09-08-agent-capabilities-plan.md`（§7.1-B 条目 B1 / §3.1 B 档 ⑤′）
> **参照实现**: Denova `internal/agents/skillassembly/assembly.go` 的 `Bucket` 三面：①提示词只放目录 ②`skill` 工具按名懒加载全文 ③`skill://` 有界引用

## 1. 目标与非目标

### 1.1 目标

让**模型**能自主发现并按需加载技能。现状是两头都缺：

- 模型看不到技能描述 —— 技能以 `skill__<name>` 工具形式注册，但排在内置工具之后，而工具提示词有 `truncateToTokenBudget(…, 1200)` 截断（`context-builder.ts:62`），**先被砍掉的就是技能**；截断后模型只剩一份名字清单
- 模型没有加载手段 —— 唯一可靠的装载方式是用户手打 `/技能名`（`agent-store.ts:420-431`），模型无法自行取用

### 1.2 非目标

- **`skill://` 有界引用**：NF 的 SKILL.md 是单文件，没有可引用的伴随资源目录，不移植
- 技能热加载（导入后立即生效）：现状是初始化时 `loadAll()` 一次，导入需重启 —— 本次不改（另属体验优化）
- 技能的市场/分发

## 2. 现状与两个存量缺陷

| # | 事实 | 位置 |
|---|---|---|
| 1 | 三来源：builtin（**内联数组，无磁盘目录**，17 个）/ `~/.novelforge/skills` / `<project>/.novelforge/skills` | `skill-registry.ts:131-163`、`:296-456` |
| 2 | **存量缺陷 A：UI 导入的技能永远不会被装载** —— 设置页写扁平 `~/.novelforge/skills/<name>.md`，注册中心只扫 `<目录>/SKILL.md` | `skill-controller.ts:69-81` vs `skill-registry.ts:103-107` |
| 3 | `/技能名` 全文注入**无任何预算**（单篇最大 1442 字，每次调用都进历史） | `agent-store.ts:420-431` |
| 4 | `allowedTools` 只拼进工具描述做提示、**无强制**；且 `allowedTools: []` 因 `?.length` 判空而**丢失"禁止调工具"语义** | `skill-registry.ts:175-176`、`:425` |
| 5 | 技能 → `/命令` 的过滤用 `userInvocable !== false` | `intent-router.ts:92` |

## 3. 设计

### 3.1 新增 `skill` 元工具

**位置**：`src/services/agent/tools/skill.tool.ts`，注册进 `src/services/agent/tools/index.ts` 的 `builtinTools`。

> ⚠️ **必须注册为 builtin**：`skill-registry.ts:170` 在每次 `loadAll()` 时会 `unregisterBySource('skill')` 清掉所有 `source: 'skill'` 的注册；元工具若标成该 source 会被自己清掉。

**接口**：

```ts
skill({ name?: string, args?: string }) → string
```

| 入参 | 行为 |
|---|---|
| 无 `name` | 返回**技能目录**：每行 `- <displayName>（<name>）：<description> — 何时用：<whenToUse>`，按 source（project → user → builtin）排序 |
| `name` | 返回该技能 SKILL.md **全文**（`content`），并做 `${args}`（或 `$1`）替换（与 `/命令` 同语义，`agent-store.ts:424-426`） |
| `name` 不存在 | 返回错误文本 + 目录提示（让模型能自我纠正，而不是静默失败） |

- `requiresConfirmation: false` / `isReadOnly: true`（纯读）
- 描述里写明「先用无参调用列目录，再按名加载」的用法

**为何不是"每个技能一个工具"**：现状正是如此（`skill__<name>`），但它把 17 个技能全塞进工具提示词的 1200 token 预算，且不随技能数扩展。元工具把常驻成本压到一行描述。

### 3.2 技能目录独立成段

**位置**：`src/services/agent/context-builder.ts`。

- **新增**「技能目录」段：每技能一行（`<displayName>（<name>）：<description>`），独立预算 `SKILL_CATALOG_BUDGET_TOKENS = 400`，超限按行截断并追加「还有 N 个技能，可用 skill 工具查看全部」
- **移除**工具提示词里的技能条目：`skill-registry.ts` 的 `registerToToolRegistry()`（`:168-212`）不再把技能注册成 `skill__<name>` 工具

> ⚠️ 移除 `skill__*` 会同时移除模型侧的一条既有路径（模型曾能直接调用 `skill__review-chapter`）。这是**有意的收敛**：该路径的可见性本就不可靠（被截断），且与 `/命令`、新元工具形成三套并行入口。计划里必须补测：`/命令` 链路仍可用（它不依赖工具注册，见 `agent-store.ts:422`）。
- `userInvocable: false` 的技能**对模型仍可见**（该字段只约束 `/命令`）

### 3.3 修装载路径缺陷（存量缺陷 A）

**位置**：`skill-registry.ts:98-126` 的 `loadFromDirectory`。

- 现支持：`<dir>/SKILL.md`
- **新增支持**：`<dir>.md`（扁平文件，与 `skill-controller.ts` 的导入格式对齐）
- 判定顺序：先试 `<dir>/SKILL.md`，不存在再试 `<dir>.md`
- 两种形态都解析同一 `parseSkillMd`；`baseDir` 在扁平形态下取 `dirname(file)`

### 3.4 `/技能名` 注入加预算

**位置**：`agent-store.ts:420-431`。

- 注入前 `truncateToTokenBudget(content, SKILL_INJECT_MAX_TOKENS = 2000)`（复用 `token-budget.ts`）
- 被截断时追加一行提示：「技能内容已截断，完整内容可用 skill 工具按名加载」

### 3.5 修 `allowedTools: []` 的语义丢失

**位置**：`skill-registry.ts:175-176`。

- 未声明（`undefined`）→ 不产生提示（现状行为）
- 显式空数组（`[]`）→ 产生「该技能不应调用任何工具」提示
- 非空 → 现有「允许的工具：…」提示

## 4. 测试策略

| 层 | 用例 |
|---|---|
| `skill.tool` | 无参 → 目录含全部技能（含 `userInvocable: false` 的）；按名 → 全文；`${args}` 替换；未知名 → 错误文本 + 目录提示 |
| `context-builder` | 目录段存在且含技能名；超 400 token 时截断并提示剩余数；工具提示词里**不再**含 `skill__` |
| `skill-registry` | 两种装载形态（`<dir>/SKILL.md` 与 `<dir>.md`）都能装载；`allowedTools` 三种语义（未声明 / 空 / 非空） |
| `agent-store` | `/技能名` 注入受 2000 token 限制；截断时带提示 |
| 回归 | 既有 17 个内置技能仍可 `/` 调用；`skill-registry.test.ts` 全绿 |

## 5. 文件结构

| 文件 | 动作 |
|---|---|
| `src/services/agent/tools/skill.tool.ts` | 新建（元工具） |
| `src/services/agent/tools/index.ts` | 注册进 `builtinTools` |
| `src/services/agent/context-builder.ts` | 新增技能目录段 |
| `src/services/agent/skill-registry.ts` | 停止注册 `skill__*` 工具；`loadFromDirectory` 兼容扁平形态；`allowedTools` 三态 |
| `src/stores/agent-store.ts` | `/技能名` 注入加预算 |
| `src/shared/locale-data/*` | 新文案（三语） |
