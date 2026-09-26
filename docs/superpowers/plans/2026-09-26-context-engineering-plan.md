# 上下文工程（B 档第二轮）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 CCR 压缩从「压完即信」变成可证明、可回溯、可解释：降幅可验证、原文分卷保留可重生成、前缀变化可见、副作用回执随压缩留存、明细面板能回答"这轮到底发了什么"。

**Architecture:** 新增分卷存储层（原文移出会话 JSON）+ 压缩分支的证明与回执提取 + 前缀记账（只记不拦）+ 逐段 context 明细模型 + 产物依赖指纹的失效语义。会话 archive 格式向前兼容（旧 inline original 仍可读）。

**Tech Stack:** TypeScript strict / Zustand / better-sqlite3（v19 幂等迁移）/ React 19 / vitest

**Spec:** `docs/superpowers/specs/2026-09-26-context-engineering-design.md`

## Global Constraints

- TypeScript strict + ESLint `--max-warnings 0`；所有用户可见文本 i18n（三语，扁平 key）
- 颜色用 CSS 变量；DB 迁移幂等（`db-migration-standard`）
- **会话 archive 必须向后兼容**：旧档案（`CompressedBatch.original` 为 inline 数组）仍能读、能展开、不报错
- 新 IPC 通道三处同步（channels / policy / controller），`fs:` 前缀已在 preload 白名单内
- 测试 `npx vitest run <file>`；全量 `npx vitest run`

## Review Focus

- **分卷与会话 JSON 的一致性**：原文写入分卷成功但会话 JSON 保存失败（或反之）时的可恢复性 —— 分卷是**幂等覆盖**（同会话同批次），会话 JSON 是权威
- **`degraded` 必须真的不替换历史**：只标记不生效等于没做（可证明性的全部价值在此）
- **前缀指纹的稳定性**：指纹必须只覆盖 **system 段**（不含 history/user），否则每轮必变、告警沦为噪音
- **回执的防重放语义**：同 target 只留最新一条是核心（旧回执会诱导模型重复已完成的写入）
- **失效产物不得注入**：`invalidated` 的摘要若仍进上下文，比"没有摘要"更糟（误导模型）
- **面板 vs 实发口径**：两个数字必须分开列，不能再用面板值假装是实发值

---

### Task 1: 分卷存储层

**Files:**
- Create: `src/services/agent/compaction-originals.ts`
- Modify: `electron/controllers/fs-controller.ts`（三个通道）、`src/shared/ipc-channels.ts`、`src/shared/ipc-policy.ts`
- Test: `src/services/agent/compaction-originals.test.ts`

**Interfaces:**
- Produces: `writeBatchOriginal(convId, batch, messages): Promise<void>`；`readBatchOriginal(convId, batch): Promise<AgentMessage[] | null>`；`deleteAllOriginals(convId): Promise<void>`；`countOriginals(convId): Promise<{ batches: number; bytes: number }>`

- [ ] **Step 1: 写失败测试**

```ts
it('写入后读回（同批次覆盖幂等）')
it('不存在的批次 → null（不抛）')
it('分卷损坏 → null（fail-safe）')
it('删除会话 → 分卷清空')
it('countOriginals 返回批次数与总字节')
```

Run: `npx vitest run src/services/agent/compaction-originals.test.ts` → FAIL

- [ ] **Step 2: 实现 + IPC**

- 文件：`~/.novelforge/agent-archives/<convId>.originals.json`，形状 `{ version: 1, batches: { [n]: AgentMessage[] } }`
- IPC：`fs:agent-archive-original-read` / `-write` / `-delete`（`fs:` 前缀已在白名单）
- 读写全部 fail-safe（损坏 → null / 空）

Run: 同上 → PASS

- [ ] **Step 3: 提交**

```bash
git add src/services/agent/compaction-originals.ts src/services/agent/compaction-originals.test.ts electron/controllers/fs-controller.ts src/shared/ipc-channels.ts src/shared/ipc-policy.ts
git commit -m "feat(ccr): 分卷存储层（原文移出会话 JSON）"
```

---

### Task 2: 压缩分支改造（可证明性 + 写分卷 + 回执）

**Files:**
- Modify: `src/services/agent/archive-codec.ts`（`CompressedBatch` 形状 + 旧格式兼容）
- Modify: `src/stores/agent-store.ts`（压缩分支）
- Modify: `src/services/agent/ccr-summary.ts`（回执段）
- Test: `src/stores/agent-store.test.ts`、`src/services/agent/archive-codec.test.ts`

**Interfaces:**
- Consumes: Task 1 的分卷读写
- Produces: `CompressedBatch` 新形状（`originalBytes` / `recoverable` / `beforeTokens` / `afterTokens` / `changeTokens`）；`extractSideEffectReceipts(messages): Receipt[]`

- [ ] **Step 1: 写失败测试**

```ts
// archive-codec
it('新形状序列化/反序列化往返')
it('旧档案（inline original 数组）仍可读，且 original 保留在内存态')
// agent-store 压缩分支
it('降幅低于阈值 → 不替换历史 + 标 degraded + warn 日志')
it('正常压缩 → 原文写分卷、会话 JSON 不含 inline original、记 before/after/change')
it('回执：只抽副作用工具、同 target 留最新、上限 32 条 / 32KB')
it('摘要生成失败 → 走既有降级（不压缩），不写分卷')
```

Run: `npx vitest run src/stores/agent-store.test.ts src/services/agent/archive-codec.test.ts` → FAIL

- [ ] **Step 2: 实现**

- `extractSideEffectReceipts`：从 `toolCalls`（status 非 pending/running）+ `artifacts` 抽 `{ tool, target, outcome, artifactPaths }`；同 target 去重留最新；≤32 条 / 32KB
- 压缩分支顺序：**先算降幅 → degraded 则 return（不替换）→ 否则写分卷 → 构造 batch（引用式）→ 替换历史 → 落盘**
- 回执段拼进 `generateConversationSummary` 的 prompt（`ccr-summary.ts`）

Run: 同上 → PASS

- [ ] **Step 3: 提交**

```bash
git add src/services/agent/archive-codec.ts src/services/agent/archive-codec.test.ts src/services/agent/ccr-summary.ts src/stores/agent-store.ts src/stores/agent-store.test.ts
git commit -m "feat(ccr): 压缩可证明性 + 原文分卷 + 副作用回执"
```

---

### Task 3: 前缀记账（含 v19 迁移）

**Files:**
- Create: `src/services/agent/prefix-accounting.ts`
- Modify: `electron/database.ts`（v19）、`src/stores/agent-store.ts`（记 fingerprint）、`electron/controllers/db-controller.ts`（`db:log-llm-call` 加两列）
- Test: `src/services/agent/prefix-accounting.test.ts`

**Interfaces:**
- Produces: `computePrefixFingerprint(systemText): string`（sha1-12）；`comparePrefix(prev, current): { changed: boolean; sharedChars: number }`

- [ ] **Step 1: 写失败测试**

```ts
it('同一 system 文本 → 指纹相同、changed=false')
it('system 尾部追加摘要 → changed=true 且 sharedChars 等于公共前缀长度')
it('指纹只覆盖 system 段（同前缀不同 history 视为未变）')
```

Run: `npx vitest run src/services/agent/prefix-accounting.test.ts` → FAIL

- [ ] **Step 2: 实现 + 迁移 + 落库**

- v19：`llm_calls` 幂等 ADD COLUMN `prefix_fingerprint TEXT` / `prefix_shared_chars INTEGER`
- agent-store 的 LLM 调用日志处带上两值；`prefixChanged && 上轮 cachedTokens > 0` → warn 日志

Run: 同上 → PASS；`npx vitest run electron/` → PASS

- [ ] **Step 3: 提交**

```bash
git add src/services/agent/prefix-accounting.ts src/services/agent/prefix-accounting.test.ts electron/database.ts electron/controllers/db-controller.ts src/stores/agent-store.ts
git commit -m "feat(ccr): 前缀指纹记账（含 llm_calls v19 迁移）"
```

---

### Task 4: 失效语义（依赖指纹）

**Files:**
- Modify: `src/stores/agent-store.ts`（rewind/fork/移除压缩 处重算）、`src/services/agent/context-builder.ts`（失效摘要不注入）
- Test: `src/stores/agent-store.test.ts`、`src/services/agent/context-builder.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('rewind 后 rollingSummary/compressed 标 invalidated')
it('编辑消息后依赖指纹失配 → invalidated')
it('invalidated 的摘要不注入上下文（base 不含其内容）')
it('未变更时不受影响（不误伤）')
```

Run: 两个文件 → FAIL

- [ ] **Step 2: 实现**

- `dependencyHash` = 该产物所依赖的历史消息 id 列表的 sha1
- 历史变更点（rewind / 移除压缩 / 消息编辑）后重算比对；失配 → `invalidated: true`
- `buildAgentSystemSegments` 注入 M1 前过滤 `invalidated`

Run: 同上 → PASS

- [ ] **Step 3: 提交**

```bash
git add src/stores/agent-store.ts src/stores/agent-store.test.ts src/services/agent/context-builder.ts src/services/agent/context-builder.test.ts
git commit -m "feat(ccr): 产物依赖指纹与失效语义"
```

---

### Task 5: context 逐段明细模型

**Files:**
- Modify: `src/services/agent/context-usage.ts`
- Modify: `src/services/agent/context-builder.ts`（返回逐段来源）
- Test: `src/services/agent/context-usage.test.ts`

**Interfaces:**
- Produces: `ContextSegment { key, label, tokens, chars, source?, truncated? }`；`computeContextUsage()` 返回 `{ segments: ContextSegment[]; total; modelMax; historyPanelTokens; historySentTokens? }`

- [ ] **Step 1: 写失败测试**

```ts
it('逐段：base/l0/l1/tools/skill-catalog/memory-m2/memory-m1/current 各一段')
it('每段带 chars 与 source')
it('截断发生时段标 truncated')
it('historyPanelTokens ≠ historySentTokens 时两者都给出')
```

Run: `npx vitest run src/services/agent/context-usage.test.ts` → FAIL

- [ ] **Step 2: 实现**

- segments 由 `buildAgentSystemSegmentsAsync` 的实际产物推导（不重复计算）
- `historySentTokens` 取发送前裁剪后的实际值（agent-store 在发送处回填）

Run: 同上 → PASS

- [ ] **Step 3: 提交**

```bash
git add src/services/agent/context-usage.ts src/services/agent/context-usage.test.ts src/services/agent/context-builder.ts src/stores/agent-store.ts
git commit -m "feat(ccr): context 逐段明细模型"
```

---

### Task 6: 明细面板 UI

**Files:**
- Modify: `src/components/panels/agent/ContextBudgetBar.tsx`
- Modify: `src/shared/locale-data/agent.ts`
- Test: `src/components/panels/agent/ContextBudgetBar.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
it('渲染逐段明细（标签 + token + 字符数）')
it('有 source 的段可展开查看来源')
it('剪贴板：单段复制产出结构化文本')
it('面板值 vs 实发值并列展示并标注')
it('前缀行：稳定 / 已变化（共享 N 字符）')
```

Run: `npx vitest run src/components/panels/agent/ContextBudgetBar.test.tsx` → FAIL

- [ ] **Step 2: 实现**

- 弹层分区：指标格 → 逐段明细 → 前缀行 → 调用级用量
- 复制用 `navigator.clipboard`（失败静默 + toast）

Run: 同上 → PASS

- [ ] **Step 3: 提交**

```bash
git add src/components/panels/agent/ContextBudgetBar.tsx src/components/panels/agent/ContextBudgetBar.test.tsx src/shared/locale-data/agent.ts
git commit -m "feat(ccr): context 明细面板（逐段来源/复制/调用级用量）"
```

---

### Task 7: 压缩卡片（真实降幅 + 回执 + 按需读原文 + 移除/重生成）

**Files:**
- Modify: `src/components/panels/agent/CompressedBatchCard.tsx`
- Modify: `src/stores/agent-store.ts`（`removeCompaction(batch)` / `regenerateBatchSummary(batch)`）
- Test: `src/components/panels/agent/CompressedBatchCard.test.tsx`、`src/stores/agent-store.test.ts`

- [ ] **Step 1: 写失败测试**

```tsx
it('展示真实降幅（before → after）而非旧估算')
it('展开原文：按需从分卷读（不读会话 JSON）')
it('recoverable=false → 显示「原文不可用」不崩')
it('回执独立成段展示')
it('「移除当前压缩」→ 恢复原文进历史 + 移除该批次')
it('「重生成摘要」→ 调 store 并从原文重建')
```

Run: 两个文件 → FAIL

- [ ] **Step 2: 实现**

- `removeCompaction`：读分卷原文 → 插回 `messages`（按时间序）→ 从 `compressed` 移除该批次 → 重算 `rollingSummary`（剩余批次摘要拼接）→ 落盘
- `regenerateBatchSummary`：读分卷原文 → `generateConversationSummary` → 更新该批次摘要

Run: 同上 → PASS

- [ ] **Step 3: 全量门禁 + 提交**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run`

```bash
git add src/components/panels/agent/CompressedBatchCard.tsx src/components/panels/agent/CompressedBatchCard.test.tsx src/stores/agent-store.ts src/stores/agent-store.test.ts
git commit -m "feat(ccr): 压缩卡片真实降幅 + 回执 + 原文按需读 + 移除/重生成"
```

---

## 明确不做（本计划范围外）

- 前缀**硬拒绝**（spec §1.2）
- 原文分卷的自动 GC / 配额（保留全部 + 会话级联删除）
- 上下文分层重构（把摘要移出 system 前缀区）
