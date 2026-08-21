# CCR 增强（P2）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** P2 增强六项——LanceDB 存量 schema 修复（chapterNumber 列）、v14 cached_tokens 迁移、book-state 全书摘要自动生成、进行中卷聚合、记忆手动编辑、全局 token 统计面板。

**Architecture:** 六项独立可交付：① LanceDB：检索/启动前 schema 自检 → 缺 chapterNumber 列时 `add_columns`（或触发既有重建路径）+ 从 fileName 解析回填（`parseChapterMetaFromFileName` 已存在于 knowledge-base.ts:292）——导入路径已有自愈（vector-store.ts:240-282），补检索侧。② v14 迁移：`llm_calls` 加 `cached_tokens` 列（幂等 + node:sqlite 验证——项目唯一可行的 DB 测试路径），三处写入端（ccr-summary/chapter-memory/agent-store）补字段，CacheAligner 效果可事后统计。③ book-state：每 3-5 分卷检查点/手动触发 → 从 volume-NNN.md 聚合（纯函数零 LLM）。④ 进行中卷：聚合区间 = 卷起始..当前最大章节（解除 P1 start..start+30 限制）。⑤ 手动编辑：查看器编辑模式（memory:write 复用 + 校验）。⑥ 全局统计：llm_calls 聚合视图（purpose/模型/时间维度）。

**Tech Stack:** Electron 41 + React 19 + TypeScript 6 + LanceDB + better-sqlite3。复用：`parseChapterMetaFromFileName`（knowledge-base.ts）、`buildVolumeSummaryFile`/`ensureVolumeSummary`（chapter-memory.ts）、`memory:*` 通道、`estimateTokens`。

**Spec:** [docs/2026-08-21-ccr-memory-design.md](2026-08-21-ccr-memory-design.md) §6（P2 方向）+ §5（记忆子系统）；LanceDB 问题为用户实测（2026-08-21 写稿日志：`纯文本检索失败 ... No field named "chapterNumber"`）

## Global Constraints

- LanceDB：**add_columns 优先**（不 drop 重建——drop 丢失向量数据需重嵌入）；回填从 fileName 解析（`第N章 标题.txt` 格式，parseChapterMetaFromFileName 已有）；无匹配 fileName 的行 chapterNumber 置 NULL（scopeFilter 已容忍 `OR chapterNumber IS NULL`，vector-store.ts:499）
- **v16 迁移**（当前 CURRENT_SCHEMA_VERSION=15——v14/v15 已被 characters 列占用）：幂等（safeAddColumn 先 pragma 检查）+ **基础 CREATE TABLE 同步加列**（全新库不跑迁移段）+ **LLMHistoryRepository.logCall INSERT 列清单同步**；`cached_tokens` 写入端 = 三处渲染层 log-llm-call（ccr-summary/chapter-memory/agent-store）；node:sqlite 内存 DB 验证（项目测试环境 better-sqlite3 与 vitest Node ABI 不兼容——P2 前已验证可行）
- book-state：聚合纯函数（volume-NNN.md → book-state.md），零 LLM 调用；每 3-5 分卷或手动触发；`book-state.md` frontmatter 记 `updatedAt` + `volumes` 覆盖范围
- 进行中卷聚合：区间 = chapterStart..当前最大章节号（memory:list 各 chapters 文件 range 的最大 end），与 P1 的 stale 过滤同口径
- 手动编辑：memory:write 通道复用；校验 = 文件名校验（safeFile 已有）+ 内容 UTF-8；编辑后清除 frontmatter status（同 upsert 语义）
- 全局统计：只读聚合（llm_calls 查询 + purpose 维度——agent/ccr_summary/memory_summary + 模型 + 时间区间）；UI = 设置→模型页或新统计视图（参照 ModelsView 惯例）
- 质量门禁：tsc 零错误 / lint 零警告 / 测试全过（基线 614/614 无豁免）；每任务独立 commit

---

### Task 1: LanceDB 存量 schema 修复（chapterNumber 列）

**Files:**
- Modify: `electron/vector-store.ts`（schema 自检 + add_columns + 回填）
- Test: `electron/vector-store.test.ts`（已存在，追加用例）

**Interfaces:**
- Produces:
  - `export async function ensureChunksSchema(db: LanceDB): Promise<{ migrated: boolean; error?: string }>`（幂等自检：tableNames 含 chunks → openTable → schema fields 缺 chapterNumber → add_columns + 从 fileName 解析回填 → 返回 migrated；无缺列 → 不动作）
  - 调用点：`ensureChunksSchema` 在检索入口（纯文本/向量检索前）与启动时（kb 初始化）调用——检索不再抛 `No field named "chapterNumber"`

- [ ] **Step 1: 写失败测试（回填纯函数）**

⚠️ **审阅修正（前提错误）**：现有 `parseChapterMetaFromFileName`（knowledge-base.ts:292）正则为 `/^第(\d+)章\s+(.+?)\s+(正文|要点|蓝图)\.md$/`——匹配 `.md` 后缀 + 尾缀，**不匹配真实定稿导入文件名**（`第${chapterNumber}章 ${chapterTitle}.txt`，finalize-chapter.command.ts:131）。不可复用，需**新写**匹配真实格式的解析函数。

```ts
// electron/vector-store.test.ts（既有测试文件追加）
import { describe, it, expect } from 'vitest'
import { parseChapterNumberForBackfill } from './vector-store'

describe('存量回填章节号解析（真实定稿导入格式）', () => {
  it('第N章 标题.txt（真实格式：定稿导入文件名）→ 章节号', () => {
    expect(parseChapterNumberForBackfill('第9章 破坛换晶.txt')).toBe(9)
    expect(parseChapterNumberForBackfill('第 9 章 破坛换晶.txt')).toBe(9)
  })

  it('无匹配 → null（回填 NULL，scopeFilter 容忍）', () => {
    expect(parseChapterNumberForBackfill('设定集.md')).toBeNull()
    expect(parseChapterNumberForBackfill('chapter_9.txt')).toBeNull()
    expect(parseChapterNumberForBackfill('第9章 正文.md')).toBeNull() // 旧格式（正文/要点/蓝图.md）非定稿导入
  })
})
```

- [ ] **Step 2: 实现**

```ts
// electron/vector-store.ts（独立函数，不依赖 knowledge-base 的旧解析器）

/** 存量表回填章节号解析（匹配真实定稿导入文件名 `第N章 标题.txt`；无匹配 null） */
export function parseChapterNumberForBackfill(fileName: string): number | null {
  const m = fileName.match(/^第(\d+)章\s*(.+?)\.txt$/)
  return m ? parseInt(m[1], 10) : null
}

/**
 * chunks 表 schema 自检 + 迁移（P2：存量表缺 chapterNumber 列——导入路径已有重建自愈
 * （requiredFields 检查），检索/启动路径此前无修复，纯文本检索因 scopeFilter 查询
 * 不存在列而失败降级。add_columns 优先：不 drop 重建，避免向量数据重嵌入）。
 */
export async function ensureChunksSchema(db: LanceDB): Promise<{ migrated: boolean; error?: string }> {
  try {
    const tableNames = await db.tableNames()
    if (!tableNames.includes(TABLE_NAME)) return { migrated: false }
    const table = await db.openTable(TABLE_NAME)
    const fields = (await table.schema()).fields.map(f => f.name)
    if (fields.includes('chapterNumber')) return { migrated: false }

    await table.addColumns([{ name: 'chapterNumber', type: new Int32() }])
    // 从 fileName 解析回填（无匹配置 null——scopeFilter 已容忍 NULL）
    const rows = await table.query().select(['id', 'fileName']).toArray()
    const updates = rows.map((r: { id: string; fileName?: string }) => ({
      id: r.id,
      chapterNumber: r.fileName ? parseChapterNumberForBackfill(r.fileName) : null,
    }))
    // 逐行 update（LanceDB update 需 where 条件）
    for (const u of updates) {
      await table.update({ chapterNumber: u.chapterNumber }, `id = '${u.id}'`).catch(() => { /* 单行失败跳过 */ })
    }
    return { migrated: true }
  } catch (e) {
    return { migrated: false, error: String(e) }
  }
}
```

（注：LanceDB add_columns/update API 签名以项目已用版本（v0.27）为准——实施时对照 vector-store.ts 既有用法；update 逐行可能慢（行数大），可改为分页批量或仅回填 NULL 章节（按需，实施时评估）

- [ ] **Step 3: 接线检索入口**（纯文本/向量检索前 `await ensureChunksSchema(db)`——幂等，迁移过一次后零开销；kb 初始化/启动时也可预热一次）

- [ ] **Step 4: 门禁 + 提交**

Run: `pnpm run typecheck && pnpm run lint` + 测试
```bash
git add electron/vector-store.ts electron/knowledge-base.ts electron/vector-store.test.ts
git commit -m "fix: LanceDB 存量表 chapterNumber 迁移（add_columns + fileName 回填，检索不再降级）"
```

---

### Task 2: v14 cached_tokens 迁移

**Files:**
- Modify: `electron/database.ts`（**v16** 迁移段 + CURRENT_SCHEMA_VERSION → 16）
- Modify: `electron/repositories/llm-repository.ts`（`LLMHistoryRepository.logCall` 固定列 INSERT——**列清单补 cached_tokens，否则渲染层补传被丢弃**）
- Modify: `src/services/agent/ccr-summary.ts`、`src/services/memory/chapter-memory.ts`、`src/stores/agent-store.ts`（三处 log-llm-call 补 cached_tokens）
- Test: 迁移 SQL 幂等（node:sqlite）

⚠️ **审阅修正**：① 当前 `CURRENT_SCHEMA_VERSION = 15`（database.ts:121——v14 已被 characters.aliases 占用、v15 生命周期列）——本迁移应为 **v16**；② **全新库路径（user_version=0）只跑 createTables 不跑 safeAddColumn**（database.ts:497）——`llm_calls` 基础 CREATE TABLE 必须直接含 cached_tokens 列，否则新装用户 Task 6 查询报 no such column；③ `LLMHistoryRepository.logCall` 是固定列 INSERT（llm-repository.ts:23）——repository INSERT 列清单同步补 cached_tokens

**Interfaces:**
- Produces: `llm_calls.cached_tokens` 列（INTEGER，默认 0）——CacheAligner 效果事后统计（设计 §6/P2 目的）

- [ ] **Step 1: 写失败测试（node:sqlite 迁移幂等）**

```ts
// electron/database.test.ts 追加（node:sqlite 内存 DB——项目唯一可行路径）
import { DatabaseSync } from 'node:sqlite'
import { describe, it, expect } from 'vitest'

describe('v16 cached_tokens 迁移', () => {
  it('加列幂等（重复执行不报错）', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(`CREATE TABLE llm_calls (id INTEGER PRIMARY KEY, prompt_tokens INTEGER, completion_tokens INTEGER, total_tokens INTEGER, cost REAL, purpose TEXT)`)
    // 迁移段（从 database.ts 提取的 v16 SQL，含 safeAddColumn 语义）
    const cols = db.prepare(`PRAGMA table_info(llm_calls)`).all() as { name: string }[]
    if (!cols.some(c => c.name === 'cached_tokens')) {
      db.exec(`ALTER TABLE llm_calls ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0`)
    }
    expect((db.prepare(`PRAGMA table_info(llm_calls)`).all() as { name: string }[]).some(c => c.name === 'cached_tokens')).toBe(true)
    // 二次执行（幂等）
    const cols2 = db.prepare(`PRAGMA table_info(llm_calls)`).all() as { name: string }[]
    if (!cols2.some(c => c.name === 'cached_tokens')) db.exec(`ALTER TABLE llm_calls ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0`)
    expect((db.prepare(`PRAGMA table_info(llm_calls)`).all() as { name: string }[]).filter(c => c.name === 'cached_tokens')).toHaveLength(1)
    db.close()
  })
})
```

- [ ] **Step 2: database.ts 迁移段**（v15 → v16：safeAddColumn 'llm_calls' 'cached_tokens' + **基础 CREATE TABLE llm_calls 同步加列**（全新库路径不跑 safeAddColumn）+ CURRENT_SCHEMA_VERSION 16——照 db-migration-standard 幂等/哨兵 checklist）

- [ ] **Step 3: repository + 三处写入端**（`LLMHistoryRepository.logCall` INSERT 列清单补 cached_tokens（llm-repository.ts:23）；ccr-summary.ts / chapter-memory.ts 成功落库 + agent-store.ts 成功/失败落库——`cached_tokens: usage?.cachedTokens ?? 0`）

- [ ] **Step 4: 门禁 + 提交**

```bash
git add electron/database.ts electron/database.test.ts src/services/agent/ccr-summary.ts src/services/memory/chapter-memory.ts src/stores/agent-store.ts
git commit -m "feat: v14 cached_tokens 列迁移（llm_calls + 三处写入端，CacheAligner 可事后统计）"
```

---

### Task 3: book-state 全书摘要自动生成

**Files:**
- Create: `src/services/memory/book-memory.ts`（聚合纯函数 + 检查点触发）
- Test: `src/services/memory/book-memory.test.ts`
- Modify: `src/components/panels/sidebar/MemoryGroup.tsx`（重建按钮完整链路——P1 仅标 stale）

**Interfaces:**
- Consumes: Task 2 前（P1）的 volume-NNN.md 文件、memory:list/read/write
- Produces:
  - `export function buildBookSummaryFile(volumes: { volumeNumber: number; range: string }[], entries: { volumeNumber: number; chapters: ChapterSummaryEntry[] }[]): string`（纯函数：frontmatter `updatedAt`/`volumes` + 每卷节选）
  - `export async function rebuildBookState(): Promise<{ success: boolean; file: string | null; reason?: string }>`（扫描 volume-NNN.md（非 stale）→ 聚合 → memory:write book-state.md；无分卷 → 直接聚合最新 chapters 文件）
  - 触发：**按非 stale volume-NNN.md 数量计数**（每满 3 卷触发一次——低频；⚠️ 审阅修正：卷号是用户自定可跳号，`卷号 % 3` 与「每 3-5 分卷」语义脱节，改计数）；查看器手动重建按钮（P1 仅标 stale → 改为真实重建）

- [ ] **Step 1: 写失败测试（聚合纯函数）**

```ts
// src/services/memory/book-memory.test.ts
import { describe, it, expect } from 'vitest'
import { buildBookSummaryFile } from './book-memory'

describe('buildBookSummaryFile', () => {
  it('frontmatter 含 updatedAt 与卷范围', () => {
    const content = buildBookSummaryFile([{ volumeNumber: 1, range: '1-15' }], [])
    expect(content).toContain('updatedAt:')
    expect(content).toContain('volumes: 1')
  })

  it('聚合卷章节条目', () => {
    const content = buildBookSummaryFile(
      [{ volumeNumber: 1, range: '1-15' }],
      [{ volumeNumber: 1, chapters: [{ chapterNumber: 1, title: '开局', keyEvents: '主角觉醒', characters: '苏晚晴', foreshadowing: '虚晶', newElements: '武魂', currentState: '筑基' }] }],
    )
    expect(content).toContain('第 1 章 · 开局')
    expect(content).toContain('主角觉醒')
  })
})
```

- [ ] **Step 2: 实现 + 触发接线**（rebuildBookState + 卷聚合后每 3 卷触发 + 查看器重建按钮改真实重建）

- [ ] **Step 3: 门禁 + 提交**

```bash
git add src/services/memory/book-memory.ts src/services/memory/book-memory.test.ts src/components/panels/sidebar/MemoryGroup.tsx
git commit -m "feat: book-state 全书摘要（每 3 卷检查点聚合 + 手动重建完整链路）"
```

---

### Task 4: 进行中卷卷级聚合（解除 P1 限制）

**Files:**
- Modify: `src/services/memory/chapter-memory.ts`（ensureVolumeSummary 进行中卷分支）
- Test: `src/services/memory/chapter-memory.test.ts`（追加）

**Interfaces:**
- Produces: `ensureVolumeSummary` 对进行中卷（chapterEnd === 0）：聚合区间 = chapterStart..**已有条目的最大章节号**（⚠️ 审阅修正：文件 range 的 end 是窗口上界（如 16-30）非实际定稿最大章——取 range 最大 end 会让未定稿窗口的完整性检查永远失败；正确上界 = 跨 chapters 文件解析条目后的最大 chapterNumber）；沿用 stale 过滤 + 完整性检查（区间内条目齐全才写）

- [ ] **Step 1: 写失败测试**（进行中卷 16 起、已定稿至 25（26-30 未定稿）→ 聚合 16-25 条目 → volume-002.md 生成——**若按 range 上界 30 则完整性失败，测试即暴露**）

- [ ] **Step 2: 实现**（进行中卷分支：先扫描收集条目（P1 F6 跨窗口逻辑），上界 = 条目最大 chapterNumber；完整性检查同 P1）

- [ ] **Step 3: 门禁 + 提交**

```bash
git add src/services/memory/chapter-memory.ts src/services/memory/chapter-memory.test.ts
git commit -m "feat: 进行中卷卷级聚合（区间 = 卷起始..当前最大章节）"
```

---

### Task 5: 记忆手动编辑（查看器编辑模式）

**Files:**
- Modify: `src/components/panels/sidebar/MemoryGroup.tsx`（查看区只读 → 可编辑 + 保存）
- Modify: `src/stores/memory-store.ts`（可选：编辑态）

**Interfaces:**
- Consumes: `memory:write`（safeFile 校验已有）、`memory:read`
- Produces: 编辑模式交互——查看区「编辑」按钮 → textarea（pre-wrap）→「保存」（memory:write + 清除 frontmatter status——同 upsert 语义）+ 失败 toast；「取消」还原

- [ ] **Step 1: 交互实现**（编辑/保存/取消三态 + i18n 3 key：memory.edit/save/cancel 三语）

⚠️ **审阅修正（结构校验）**：保存前校验内容可解析出章节块（`## 第 N 章` 至少 1 块或 frontmatter 完整）——坏格式文件会让 ensureVolumeSummary 的块解析静默失败。校验不过 → toast 阻止保存（`memory.invalidFormat` 新 key 三语：zh `记忆文件格式无效（缺少章节块）` / en `Invalid memory file format (missing chapter blocks)` / ru `Недопустимый формат файла памяти (нет блоков глав)`）

- [ ] **Step 2: 门禁 + 提交**

```bash
git add src/components/panels/sidebar/MemoryGroup.tsx src/stores/memory-store.ts src/shared/locale-data.ts
git commit -m "feat: 记忆手动编辑（查看器编辑模式 + 保存清除 stale）"
```

---

### Task 6: token 统计面板（当前项目维度）

⚠️ **审阅修正（名实校准）**：llm_calls 在项目库（`{project}/.vela/vela.db`）——本查询是**当前项目维度**，非全局；且无项目打开时 agent 调用无法落库（静默失败）。跨项目聚合归 P3。

**Files:**
- Create: `src/components/settings/UsageStatsView.tsx`（或按 ModelsView 惯例并入）
- Modify: `electron/controllers/db-controller.ts`（llm_calls 聚合查询通道——若已有 usage 聚合则复用）
- Modify: `src/shared/ipc-channels.ts`

**Interfaces:**
- Consumes: llm_calls 表（含 v14 cached_tokens——Task 2 后）
- Produces:
  - `'db:usage-stats': { args: [{ from: number; to: number }]; return: { byPurpose: { purpose: string; calls: number; promptTokens: number; completionTokens: number; cachedTokens: number; cost: number }[]; byModel: { model: string; calls: number; cost: number }[]; total: { calls: number; cost: number } } }`

- [ ] **Step 1: 主进程聚合查询**（db-controller 新通道：GROUP BY purpose/model + SUM；时间区间过滤）

- [ ] **Step 2: UI 面板**（purpose 维度表 + 模型维度 + 合计；参照 ModelsView 样式；入口：设置→模型/用量）

- [ ] **Step 3: 门禁 + 提交**

```bash
git add electron/controllers/db-controller.ts src/shared/ipc-channels.ts src/components/settings/UsageStatsView.tsx src/shared/locale-data.ts
git commit -m "feat: 全局 token 统计面板（purpose/模型维度 + cached_tokens）"
```

---

## 验收对照（设计 §6 + 用户指示）

| 验收项 | 对应任务 |
|--------|---------|
| LanceDB 存量表 chapterNumber 迁移——纯文本检索不再降级（用户实测问题） | Task 1 |
| llm_calls.cached_tokens 列（v16）——CacheAligner 效果可事后统计 | Task 2 |
| book-state 全书摘要自动生成（每满 3 个非 stale 分卷文件/手动） | Task 3 |
| 进行中卷卷级聚合（上界 = 条目最大章节号，解除 P1 限制） | Task 4 |
| 记忆手动编辑（查看器编辑模式 + 保存结构校验） | Task 5 |
| token 统计面板（当前项目维度，purpose/模型/cached_tokens） | Task 6 |

**范围外（P3 候选）**：跨项目 token 聚合（llm_calls 在项目库，全局需遍历项目）、跨会话记忆复用（SharedContext 式——最大项，独立一期）、记忆查看器 AI 面板入口（设计 §5.4 双入口的第二入口）。
