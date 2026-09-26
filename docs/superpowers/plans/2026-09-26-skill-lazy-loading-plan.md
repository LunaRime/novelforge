# 技能第三面（模型自主懒加载）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让模型能自主发现技能（目录段）并按需加载全文（`skill` 元工具），同时修掉两处存量缺陷（UI 导入的技能不被装载 / `/技能名` 注入无预算）。

**Architecture:** 技能从「每个技能一个 `skill__<name>` 工具」收敛为「常驻目录段（名字+描述，独立预算）+ 一个 `skill` 元工具按名取全文」。装载路径兼容扁平与目录两种形态，`allowedTools` 区分未声明与显式空白名单。

**Tech Stack:** TypeScript strict / React 19 / vitest

**Spec:** `docs/superpowers/specs/2026-09-26-skill-lazy-loading-design.md`

## Global Constraints

- TypeScript strict + ESLint `--max-warnings 0`
- 所有用户可见文本必须 i18n（zh-CN / en-US / ru-RU，`src/shared/locale-data/*.ts` 扁平 key）
- 新工具必须注册进 `src/services/agent/tools/index.ts` 的 `builtinTools`（标成 `source: 'skill'` 会被 `loadAll()` 的 `unregisterBySource` 清掉）
- 测试命令 `npx vitest run <file>`；全量 `npx vitest run`

## Review Focus

- **元工具的注册来源**：必须是 builtin —— 注册成 `source: 'skill'` 会在下次 `loadAll()` 被清掉（静默失能）
- **移除 `skill__*` 的连锁**：`/命令` 链路（`intent-router.ts:92` + `agent-store.ts:422-428`）不依赖工具注册，必须仍可用；审批层的 `startsWith('skill__')` 判定成为死分支（无害，保留）
- **目录段的可见性边界**：`userInvocable: false` 的技能**对模型可见**、对 `/命令` 不可见 —— 两个面不能混
- **装载兼容不破坏既有形态**：`<dir>/SKILL.md` 必须仍优先；扁平 `<dir>.md` 是新增兜底
- **注入预算不改变 `/命令` 语义**：截断只影响长度，`${args}` 替换与「已使用技能」标注照旧

---

### Task 1: `skill` 元工具

**Files:**
- Create: `src/services/agent/tools/skill.tool.ts`
- Modify: `src/services/agent/tools/index.ts`（注册）
- Modify: `src/shared/locale-data/prompt.ts`（三语文案）
- Test: `src/services/agent/tools/skill.tool.test.ts`

**Interfaces:**
- Consumes: `skillRegistry.listAll()` / `skillRegistry.get(name)`（`src/services/agent/skill-registry.ts`）
- Produces: `skillTool`（AgentTool 形状，注册名 `skill`）

- [ ] **Step 1: 写失败测试**

```ts
// 用例（每条一个 it）：
it('无参 → 返回技能目录（含 displayName 与 name）')
it('目录含 userInvocable:false 的技能（只约束 /命令，不约束模型）')
it('{ name } → 返回该技能全文')
it('{ name, args } → ${args} 被替换')
it('未知技能 → 错误文本含该名字 + 目录提示（模型可自我纠正）')
```

Run: `npx vitest run src/services/agent/tools/skill.tool.test.ts` → FAIL（模块不存在）

- [ ] **Step 2: 实现**

```ts
// src/services/agent/tools/skill.tool.ts
import { skillRegistry } from '../skill-registry'
import { t } from '../../../shared/locale'
import type { AgentTool } from '../tool-registry'

const SOURCE_ORDER = { project: 0, user: 1, builtin: 2 } as const

function buildCatalog(): string { /* 按 source 排序，逐行 `- displayName（name）：description` */ }

export const skillTool: AgentTool = {
  name: 'skill',
  description: t('tool.skill.description'),   // 写明：先无参列目录，再按名加载
  inputSchema: { type: 'object', properties: { name: { type: 'string' }, args: { type: 'string' } } },
  requiresConfirmation: false,
  isReadOnly: true,
  source: 'builtin',
  execute: async (input) => { /* 无 name → 目录；有 name → 全文（含 ${args} 替换）；未知 → 错误+目录 */ },
}
```

- [ ] **Step 3: 注册 + 跑测试**

`tools/index.ts`：`builtinTools` 数组加 `skillTool`（只读组）。

Run: `npx vitest run src/services/agent/tools/skill.tool.test.ts` → PASS

- [ ] **Step 4: 提交**

```bash
git add src/services/agent/tools/skill.tool.ts src/services/agent/tools/skill.tool.test.ts src/services/agent/tools/index.ts src/shared/locale-data/prompt.ts
git commit -m "feat(skill): skill 元工具（按名懒加载技能全文）"
```

---

### Task 2: 技能目录独立成段

**Files:**
- Modify: `src/services/agent/context-builder.ts`
- Modify: `src/services/agent/skill-registry.ts`（`registerToToolRegistry` 不再注册 `skill__*`）
- Test: `src/services/agent/context-builder.test.ts`（新增用例）

- [ ] **Step 1: 写失败测试**

```ts
it('目录段存在且含技能名与描述')
it('目录段超预算时按行截断并提示剩余数量')
it('工具提示词里不再出现 skill__ 前缀（收敛为元工具）')
it('userInvocable:false 的技能出现在目录段')
```

Run: `npx vitest run src/services/agent/context-builder.test.ts` → FAIL

- [ ] **Step 2: 实现**

- `context-builder.ts` 新增常量 `SKILL_CATALOG_BUDGET_TOKENS = 400` 与目录段构建（`skillRegistry.listAll()` 逐行，超预算截断 + 追加剩余提示）
- 段序：base → **技能目录** → memory（M1）——目录段不参与 `TOTAL_BUDGET_TOKENS` 的降级链（它很小且是模型发现技能的唯一途径）
- `skill-registry.ts` 的 `registerToToolRegistry()`：移除 `register(builtinTool)` 调用（保留 `listAll`/`get` 供 `/命令` 与元工具用）

Run: 同上 → PASS

- [ ] **Step 3: 回归 `/命令` 链路**

Run: `npx vitest run src/services/agent/intent-router.test.ts src/stores/agent-store.test.ts`
Expected: PASS（`/命令` 不依赖工具注册）

- [ ] **Step 4: 提交**

```bash
git add src/services/agent/context-builder.ts src/services/agent/context-builder.test.ts src/services/agent/skill-registry.ts
git commit -m "feat(skill): 技能目录独立成段（不再占用工具提示词预算）"
```

---

### Task 3: 装载路径兼容 + allowedTools 三态

**Files:**
- Modify: `src/services/agent/skill-registry.ts`
- Test: `src/services/agent/skill-registry.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('装载 <dir>/SKILL.md（既有形态仍优先）')
it('装载扁平 <dir>.md（与设置页导入格式对齐）')
it('两种形态同名时目录形态优先')
it('allowedTools 未声明 → 工具描述无提示')
it('allowedTools: [] → 描述含"不应调用任何工具"')
it('allowedTools: ["read_file"] → 描述含允许清单')
```

Run: `npx vitest run src/services/agent/skill-registry.test.ts` → FAIL（新增用例）

- [ ] **Step 2: 实现**

- `loadFromDirectory`：先试 `<dir>/SKILL.md`，`fs:read-file` 失败再试 `<dir>.md`；扁平形态 `baseDir = dirname(file)`
- `allowedTools` 三态：`Array.isArray(tools) && tools.length === 0` → 显式空提示；`undefined` → 无提示；非空 → 现有清单

Run: 同上 → PASS

- [ ] **Step 3: 提交**

```bash
git add src/services/agent/skill-registry.ts src/services/agent/skill-registry.test.ts
git commit -m "fix(skill): 装载兼容扁平形态 + allowedTools 三态语义"
```

---

### Task 4: `/技能名` 注入加预算

**Files:**
- Modify: `src/stores/agent-store.ts:420-431`
- Test: `src/stores/agent-store.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('/技能名 注入受上限约束（超长技能被截断）')
it('截断时追加"完整内容可用 skill 工具加载"提示')
it('未超限时不加提示（既有语义不变）')
```

Run: `npx vitest run src/stores/agent-store.test.ts` → FAIL

- [ ] **Step 2: 实现**

- 常量 `SKILL_INJECT_MAX_TOKENS = 2000`
- 注入前 `truncateToTokenBudget(content, SKILL_INJECT_MAX_TOKENS)`；被截断则追加提示行
- `${args}` 替换在截断**之前**（与现状一致）

Run: 同上 → PASS

- [ ] **Step 3: 提交**

```bash
git add src/stores/agent-store.ts src/stores/agent-store.test.ts src/shared/locale-data/agent.ts
git commit -m "feat(skill): /技能名 注入加 token 预算"
```

---

### Task 5: 全量门禁 + 收口

- [ ] **Step 1: 全量验证**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run`
Expected: 零错误 / 零 warning / 全绿

- [ ] **Step 2: 确认技能仍可用（人工核对清单）**

- `/` 输入能列出 17 个内置技能（`getAllSlashCommands`）
- 新 `skill` 工具出现在工具清单（`generateToolPrompt`）
- 工具提示词里**没有** `skill__` 前缀
- 系统提示词里有技能目录段

- [ ] **Step 3: 提交（若 Step 1 有格式修正）**

```bash
git commit -am "chore(skill): 全量门禁修正"
```
