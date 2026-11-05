# 04 · 施工细则（beta 激进版）

> 当前实施边界（2026-11-05）：本轮仅交付独立存储核心、契约与离线迁移验证；应用入口继续读写现有 DB。下文的文件真相、冻结旧表与 UI/agent 切换属于后续里程碑，尚未启用。迁移输出使用独立空目录，不修改原项目。

> 阅读顺序：[01 现状](01-diagnosis.md) → [02 目标](02-target-architecture.md) → [03 路线](03-roadmap.md) → **04 施工**
>
> 施工单，不是建议书：每一步写清**改哪个文件、改成什么、怎么证明改对了**。
> 前提：beta，**不写双写、不留兼容层、不做过渡命名**。改坏了就 revert + 还原备份。
>
> 存储方案细节见 [06](06-storage-design.md)，DB 职责见 [07](07-db-and-scale.md)；本文只写"怎么落地"。

---

## M0 · 上锁（只加文件，不动一行业务）

### 0.1 契约测试：用 `test.fails` 编码「先红」

`test.fails` 的语义是"这个用例现在就该失败"：CI 不会长期红，失败原因就是改造清单；实现完成后用例转绿 → `test.fails` 反而变红，**逼你删标记**，这就是转正信号。

```ts
// src/contracts/chapter-store.contract.test.ts
import { describe, test } from 'vitest'

describe('章节存储契约（M1 转正）', () => {
  test.fails('创建后：文件名只含序号，按 id 可读回', async () => {
    throw new Error('M1 待实现：FileChapterStore.create')
  })
  test.fails('重排章号：id 不变，路径跟随', async () => {
    throw new Error('M1 待实现：FileChapterStore.reorder')
  })
  test.fails('外部改名：索引 stale，rescan 按 id 找回', async () => {
    throw new Error('M1 待实现：rescan')
  })
  test.fails('外部编辑：hash 漂移 → 重载并回写索引', async () => {
    throw new Error('M1 待实现：byId 校验')
  })
  test.fails('删除索引：rescan 后一章不少', async () => {
    throw new Error('M1 待实现：rescanAll')
  })
  test.fails('崩溃残留：.tmp 不算正式章节', async () => {
    throw new Error('M1 待实现：启动清理 .tmp')
  })
  test.fails('跨项目：读写必须被拒绝', async () => {
    throw new Error('M1 待实现：项目路径校验')
  })
})
```

**每个 body 必须真的抛错，不能留空。** 空函数会"通过"，而 `test.fails` 的语义是"预期失败"——空 body 会让整个套件变红，正好制造你想避免的假绿/假红混乱。M1 实现后把 `throw` 换成真实断言，再删掉 `.fails`。

> 只想留清单不想玩 `.fails`，用 `test.todo('…')`：报告里显示为待办，不参与红绿。两者选一个，别混。

**为什么放 `src/contracts/`**：`vitest.config.ts` 的 `include` 只覆盖 `src/**`、`electron/**`、`scripts/**`。放 `test/` 会得到 "No test files found"——那不是契约失败，是路径错。

> 这 7 条不是拍脑袋写的：`docs/architecture/prototype/chapter-store.mjs` 已经在 10/10 场景里跑通（2026-10-28 实测 `node chapter-store.mjs <dir>`），契约就是把原型的行为固化下来。

### 0.2 边界棘轮：允许现状，禁止变差

一次性把 runtime 的依赖全改成注入，等于把 M3 提前，会卡住整条线。用**棘轮**：

```js
// scripts/check-boundaries.mjs（已落地）
// 1) src/core/**         禁止 import electron / react / zustand / stores / components → 基线 0（硬失败）
// 2) src/services/agent  统计引用 /stores/ 的文件数与 useXStore.getState() 次数 → 基线 34 / 47
// 3) 当前值 > 基线 → 退出码 1；< 基线 → 打印"可下调基线"
```

```json
// scripts/boundary-baseline.json（已落地）
{
  "coreForbidden": 0,
  "agentStoreFiles": 34,
  "agentStoreRefs": 47
}
```

基线口径（2026-10-28 实测）：`src/services/agent/**` **排除 `.test/.stories`**，34 个文件引用 `/stores/`，共 47 处 `getState()`。其中工具目录单独看是 20/26 个文件、34 处。**从此只许降。**

> 抓依赖必须同时认**动态导入**：`task.tool.ts` 里是 `await import('../../../stores/agent-store')`，只匹配 `from '…'` 会漏掉它（第一版脚本就漏了，计数 33 vs 34）。

### 0.3 脚本与 CI

```jsonc
// package.json（只加 scripts，不动 version）—— M0 只加这两个
"test:contracts": "vitest run src/contracts",
"check:boundaries": "node scripts/check-boundaries.mjs"
// M1 随脚本落地再加："doctor"、"migrate:files"
```

```yaml
# .github/workflows/build.yml —— 在 Test (Vitest) 之后加两步，都只在 ubuntu 跑
- name: Contracts (Vitest)
  if: matrix.os == 'ubuntu-latest'
  run: pnpm run test:contracts
- name: Boundary ratchet
  if: matrix.os == 'ubuntu-latest'
  run: pnpm run check:boundaries
```

### 0.4 出口

```bash
pnpm test:contracts        # 7 个 test.fails 全部"失败" → 整体绿
pnpm check:boundaries      # core=0 / agent=20/34，退出 0
pnpm typecheck && pnpm lint && pnpm test
```

---

## M1 · 搬家：文件成为真相，DB 变索引

### 1.1 目录与文件

```
src/core/
  domain/       chapter.ts（Chapter / ChapterMeta / 状态机）
  ports/        chapter-repo.ts  chapter-query.ts  chapter-indexer.ts
  adapters/     file-chapter-store.ts        # 唯一碰章节文件的地方
                sqlite-chapter-index.ts      # chapter_index + FTS5
  indexer/      rescan.ts  repair-names.ts  doctor.ts
```

### 1.2 `ChapterRepo`：四个方法就够

```ts
// src/core/ports/chapter-repo.ts
export interface ChapterRepo {
  byId(id: string): Promise<Chapter | null>       // 读文件 + 校验 hash
  save(ch: Chapter, opts?: { actor?: string }): Promise<void>  // 写前存 history
  remove(id: string): Promise<void>
  list(): Promise<ChapterMeta[]>                  // 走索引，不扫盘
}

export interface ChapterMeta {
  id: string; number: number; title: string; status: ChapterStatus
  path: string; contentHash: string; wordCount: number
}
```

**正文永不进索引表。** `chapter_index` 只存元数据，`byId` 才读文件。这条守住，索引体积永远是 KB 级（07 §六.4）。

### 1.3 写入：原子 + 历史 + 锁

```ts
// src/core/adapters/file-chapter-store.ts
async function atomicWrite(file: string, text: string) {
  const tmp = `${file}.${process.pid}.tmp`
  const fh = await fs.open(tmp, 'w')
  try { await fh.writeFile(text, 'utf8'); await fh.sync() } finally { await fh.close() }
  await fs.rename(tmp, file)        // 同目录 rename 原子
}

async save(ch: Chapter) {
  const cur = await this.byId(ch.id)
  if (cur) await this.snapshot(cur)             // history/{id}/{ts}.md
  await atomicWrite(this.pathOf(ch), serialize(ch))
  await this.index.upsert(toMeta(ch))           // 索引永远在文件之后
}
```

顺序不能反：**写文件 → rename → 更新索引**。索引失败不回滚文件，下次 `rescan` 修正（06 §4.2）。

锁：同进程 per-chapter mutex；跨窗口 `.novelforge/locks/{id}.lock`（`O_EXCL`）。**锁粒度是单章**，两个人改不同章节不该互相阻塞。

### 1.4 索引表（`index.db`，可删可建）

```sql
CREATE TABLE IF NOT EXISTS chapter_index (
  id TEXT PRIMARY KEY, path TEXT NOT NULL, number INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
  word_count INTEGER DEFAULT 0, content_hash TEXT NOT NULL,
  volume_id TEXT, shard INTEGER DEFAULT 0,      -- 07 §3.3 预留列
  mtime INTEGER, indexed_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chapter_number ON chapter_index(number);

CREATE VIRTUAL TABLE IF NOT EXISTS chapter_fts USING fts5(
  chapter_id UNINDEXED, title, body, tokenize = 'unicode61 remove_diacritics 2'
);
```

FTS5 用 **jieba 预分词 + unicode61**，不用 trigram：

```ts
import { tokenizeToSpaceSeparated } from '../../../electron/chinese-tokenizer'
const tokens = tokenizeToSpaceSeparated(body)      // 双字词才有救
```

> 07 §3.2 实测：trigram 对「雨水/屋檐/雨夜/门」全部命中 0，且不报错；jieba 预分词 7/7 命中。

章节事件表（06 §五 / 07 §6.5）也放在 `index.db`，`seq` 单调递增，未来做增量同步可直接当游标：

```sql
CREATE TABLE IF NOT EXISTS chapter_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id TEXT NOT NULL, type TEXT NOT NULL, payload TEXT, at INTEGER
);
```

> 事件流默认随索引一起删（可重建）；需要长期审计时再落 `chapters/.events.jsonl` 跟文件走。

同批改掉 07 §3.1 的五条 PRAGMA（`synchronous=NORMAL` / `mmap_size` / `cache_size` / `temp_store=MEMORY` / `busy_timeout`），五分钟，全局受益。

### 1.5 一次性导出（不双写，只迁章节）

```ts
// scripts/migrate-to-files.mjs
// 1) 备份：db.exec(`VACUUM INTO '${backup}'`)，失败直接中止
// 2) 新建独立空输出目录；不得修改原 DB 的 storage_meta 或任何业务行
// 3) 只读导出，不写旧表
const rows = db.prepare(`
  SELECT d.id, d.chapter_number, d.status, d.version, d.content_hash, c.body, b.title, d.created_at
  FROM drafts d JOIN contents c ON c.id = d.content_id
  LEFT JOIN blueprints b ON b.chapter_number = d.chapter_number
  WHERE d.status != 'archived'
  ORDER BY d.chapter_number, d.version
`).all()
// 4) 每章取最高版本写 chapters/{4位序号}.md；其余版本写 history/{id}/{created_at}.md
// 5) 逐章校验：sha256(body) === content_hash（不一致 → 整批中止并输出差异清单）
// 6) 仅校验通过后在输出目录写迁移清单（项目 id / schemaVersion / 迁移来源）
```

**当前没有双写，也不切应用入口。** 原 DB 保持应用正常读写；旧表冻结仅在未来统一切换文件真相后发生（见 4.3）。

导出必须同时满足 [08](08-self-review-and-migration.md) 的四条硬约束（缺一条就是拿用户数据冒险）：

| 约束 | 落地方式 |
|---|---|
| P0-1 不删表 | `contents` / `draft_snapshots` 冻结 + deprecated 标记；删除不早于 1.0 |
| P0-2 降级闸门 | `storage_meta.storage_version` 独立管理；仅能约束实现检查的新版本；已发布旧版不识别该表，须保留原项目并隔离导出目录 |
| P0-3 保存反馈 | 写文件失败必须**日志 + toast + 错误返回**三件套，并记录文件写入失败；未来切换文件真相后，失败不得回退写 DB 或报告保存成功 |
| P1-1 复用基建 | 加列走已有 `safeAddColumn(db, table, col, def)`（`electron/database.ts:682`），禁止裸 `ALTER` |

另有 08 的三条执行约束：**只迁章节**（设定/角色/大纲第一版仍留 DB）、**提示用户把 `.novelforge/` 加进自己的 `.gitignore`**（我们不改用户仓库，只在 `doctor` 里列检查项）、**所有提示文案走 `t()` 三语**（加键前先 grep，避免 TS1117 重复键）。

### 1.6 自愈：`doctor`

```bash
pnpm doctor --project ./my-novel
# 索引孤儿（索引有、文件无） / 未索引文件 / 命名不符 / hash 漂移 / .tmp 残留 / history 超限
# 输出：可自动修复 + 需人工确认
```

文件方案的全部故障模式都是"文件与索引不一致"，`doctor` 是这套架构的配套工具，不是加分项。

### 1.7 出口

```bash
pnpm test:contracts                       # ≥5 条转正（删 .fails）
rm .novelforge/index.db && pnpm doctor    # rescan 后章数一致
pnpm migrate:files && pnpm migrate:files --verify   # 第二遍零变更
pnpm typecheck && pnpm lint && pnpm test
```

---

## M2 · 合流：正文只有一个写入口

### 2.1 用例层（唯一 `new` 的地方）

```ts
// src/core/application/write-chapter.ts
export async function writeChapter(
  input: { chapterId: string; guidance?: string },
  deps: { chapters: ChapterRepo; runtime: AgentRuntime; events: EventBus },
): Promise<{ chapterId: string }> {
  const chapter = await deps.chapters.byId(input.chapterId)
  if (!chapter) throw new ChapterNotFound(input.chapterId)
  const draft = await deps.runtime.runDraftTask({ chapter, guidance: input.guidance })
  chapter.body = draft.body
  await deps.chapters.save(chapter, { actor: 'agent' })
  await deps.events.emit({ type: 'chapter.draft_written', chapterId: chapter.id })
  return { chapterId: chapter.id }
}
```

### 2.2 工具层禁写正文

`write_file` 现在有一个 `vela://draft/{id}` 分支（CAS 直写草稿），这是第二条写正文的路：

```ts
// src/services/agent/tools/write-file.tool.ts —— isVelaProtocol 分支内
if (resolvedPath.startsWith(VELA.DRAFT)) {
  return {
    success: false,
    content: '',
    error: t('tool.draftWriteViaWorkflow'),   // 新增键，三语；加键前先 grep 防 TS1117 重复键
    hint: '章节正文请调用 start_workflow（写第 N 章），不再直接改 draft',
  }
}
```

工具描述（`tool.writeFileDesc`）同步改写，否则模型会继续尝试。

### 2.3 删掉 5 个直调入口

`src/services/workflows/workflow-starter.ts` 的 5 个公开函数，非测试调用点 **13 处**（`startChapterWorkflow` 3、`startBlueprintWorkflow` 2、`startArchitectureWorkflow` 2、`startBookPipelineWorkflow` 4、`startConfigGenerationWorkflow` 2）：

1. 先改调用点：UI 按钮 → 发 agent 命令（`/write 第 N 章`）或调 `start_workflow`；
2. 再删导出，保留内部 `create*Workflow` 供工具调用；
3. 最后清 `workflow-store` 里只服务旧入口的字段。

### 2.4 拆掉 `chapterDir`（修掉既有的"章节识别不到"）

`chapterDir` 是"用章号拼路径"的中间概念，见附录 B.5 的格式冲突表。M2 一并拆除：

1. 删 `getDraftDir()` / `getDraftPath()`（`chapter-workflow.ts:66,70`），连同 `draft-store.ts:142`、`DraftEditor.tsx:66,252,276` 三处拼串；
2. `draft-index.ts` 里 8 个带 `chapterDir: string` 形参的函数全部换成 `chapterId: string`——`getNextDraftVersion`(144)、`getDraftMeta`(152)、`getNextRevisionIndex`(169)、`getPendingRevisions`(180)、`markRevisionMerged`(195)、`getNextReviewIndex`(242)、`getLatestReview`(253)、`getReviewsForVersion`(270)。它们内部本来就是先 `match(/ch(\d+)$/)` 取章号、再拿章号去查 `drafts` 拿 id，等于绕一圈；直接传 id 可以省掉这次往返。
3. `vela-protocol.ts` 的 `parseVelaId` 从 `/^\d+$/` 换成 `ch_` 前缀校验；老的 `vela://draft/{数字}` 走 B.5 类别 B 的**一次性读时映射**（不设开关、不落新串）。

这一步不是"改名"，是**消字段**：`chapterDir` 消失后，格式冲突的两个模块各自只剩一种格式，死路径自动消失。

### 2.5 出口

```bash
grep -rn "startChapterWorkflow" src/components | wc -l     # 0
grep -rn "db:draft-apply-content" src/services/agent      # 0
grep -rn "chapterDir" src --include="*.ts" --include="*.tsx" | wc -l   # 0
pnpm test:contracts                                        # 7 条全部转正
```

---

## M3 · 抽核：`src/core/` 成型

### 3.1 唯一出口

```
src/core/index.ts    只导出：Chapter / ChapterRepo / writeChapter / createRuntime / createContainer
```

### 3.2 工具改注入（runtime 34 个文件 / 47 处 `getState()`）

```ts
// before
export const startWorkflowTool = buildAgentTool({
  execute: async (args) => {
    useLayoutStore.getState().openRightPanel('ai-output')   // ✗ 反向依赖 UI
    return startChapterWorkflow(args)
  },
})

// after
export function createStartWorkflowTool(ports: { workflows: WorkflowPort; layout: LayoutPort }) {
  return buildAgentTool({
    execute: async (args) => { ports.layout.openOutput(); return ports.workflows.start(args) },
  })
}
```

`project-store` 的 17 处是"运行时捞当前项目路径"，统一换成 `ports.project.current()`——**路径由应用层注入，工具不再知道全局状态存在**。

### 3.3 artifact → 事件（13 → 4）

| 旧 `ToolArtifact` | 新领域事件 |
|---|---|
| `file_created` / `file_modified` | `document.changed` |
| `draft_generated` / `review_completed` / `mutual_review_completed` | `chapter.draft_written` / `chapter.reviewed` |
| `workflow_started` / `workflow_completed` | `workflow.progressed` |
| 其余 6 种 | 由 UI 从上述事件派生，或直接删 |

```ts
type RuntimeEvent =
  | { type: 'chapter.draft_written'; chapterId: string }
  | { type: 'chapter.reviewed'; chapterId: string; score: number }
  | { type: 'workflow.progressed'; runId: string; step: string; pct: number }
  | { type: 'document.changed'; id: string }
```

### 3.4 补两枚执行语义布尔

`AgentTool` 已有 `isReadOnly`、`requiresConfirmation`、`timeoutMs`；缺并发语义：

```ts
interface AgentTool {
  isConcurrencySafe: boolean   // 只读且无副作用 → 可并入并发批
  isDestructive: boolean       // 删除/覆盖 → 串行 + 二次确认
}
```

调度器把 `MAX_PARALLEL_READ_TOOLS` 的隐式约定换成读这两个布尔值。

### 3.5 出口

```bash
grep -rn "stores/\|components/\|from 'electron'" src/core | wc -l   # 0
pnpm check:boundaries                                               # 全 0，基线文件可删
pnpm test
```

---

## M4 · 成型：可独立编译 + 删兼容层

### 4.1 独立编译

```jsonc
// tsconfig.core.json
{
  "compilerOptions": {
    "composite": true, "declaration": true, "outDir": "dist-core", "rootDir": "src/core",
    "lib": ["ES2022"], "types": ["node"],          // 没有 DOM、没有 electron
    "strict": true, "skipLibCheck": true
  },
  "include": ["src/core/**/*.ts"]
}
```

```bash
pnpm exec tsc -p tsconfig.core.json     # 通过 = core 不依赖 src 其余部分
```

这就是"框架核心"的验收：core 能在没有 Electron、没有 React、没有 Zustand 的机器上编译。

### 4.2 删兼容层

- `DraftMeta.filePath` / `fileName` / `chapterTitle?` 直接删；`vela://draft/{id}` 改成 `draftUri(id)` 按需生成（URI 是投影，不是数据）。
- 编辑器标签键从 `filePath` 改为 `doc:{draftId}`：`editor-store.tabs[].docId`，一次性切换，不保留双键。
- 影响面：`draft.filePath` 直接引用 15 处（`DraftBoxGroup` 7、`book-pipeline-workflow` 3、`workflow-starter` 4、`KnowledgePanel` 1）；全量 `filePath` 248 处里其余是章节/核心文档的真实路径，不动。

### 4.3 旧表冻结（不删，M4 只做标记）

`contents` / `draft_snapshots` / `drafts` 在切换读路径后**冻结**：不再写入，但表留着，`contents.body` 是老版本唯一的真相来源，只能作为切换时的历史快照；回退必须恢复匹配备份，不能当成最新稿。

删除不在这个路线里，不早于 1.0，且必须满足 [08 §三.C](08-self-review-and-migration.md) 的四条前置：全量用户升级完毕 + 应用内公告与确认 + `doctor` 在真实项目全绿 + 最近 3 份备份在位。

**为什么收回"0.1.9 drop"**：已发出的 0.1.x 有真实用户在跑（15 人量级），删表不可逆，用户装回旧版会看到"稿子消失"。代码可以激进，数据不能——这条优先级高于架构整洁。

### 4.4 出口

```bash
pnpm exec tsc -p tsconfig.core.json
grep -rn "为了兼容" src electron | wc -l                        # 0
grep -rn "\.filePath" src/components | grep -i draft | wc -l     # 0
gh run list --repo LunaRime/novelforge --limit 1                 # CI 绿
```

---

## 每天怎么跑

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm check:boundaries && pnpm test:contracts
```

五条全绿才提交。**本地绿 ≠ CI 绿**：提交后 `gh run list --repo LunaRime/novelforge --limit 1` 确认。

---

## 附录：不要做的事

| 别做 | 原因 |
|---|---|
| 写 `NF_STORAGE` 双写开关 | 两套真相合法化，正是要治的病；回滚靠备份 |
| 给旧 artifact 写兼容映射层 | 映射层活下来的概率高于新代码，最后没人敢删 |
| 正文进 `chapter_index` | 索引体积会从 KB 变 GB，且"删索引可重建"不再成立 |
| 用 `trigram` 做中文 FTS | 双字词全部命中 0 且不报错（07 实测） |
| 先改 UI 再改存储 | UI 是当前事实源，同时改两头必然失控 |
| 一次性拆 monorepo | `src/core/` + 独立 tsconfig 已足够证明可抽包 |
| 在同一版切读路径又删旧表 | 回滚时没有退路 |

---

## 附录 B · 命名与改动规范

命名不是洁癖：改名是唯一一种"改完没报错但什么都找不着"的操作。这一节把**项目文件、源码、文档**三套命名规则钉死，并给出 M1–M4 的改名清单。

### B.1 项目文件（用户看得见的）

| 对象 | 命名 | 规则 |
|---|---|---|
| 章节 | `chapters/{0001}.md` | **4 位定长序号，标题不进文件名**；程序任何关系都不认文件名，只认 frontmatter 的 `id` |
| 卷 | `volumes/01.md` | 2 位序号 |
| 设定 | `setting/world.json`、`outline.md`、`characters/char_001.json` | 3 位序号 |
| 记忆 | `memory/chapter/0001.md`、`volume/01.md`、`book.md` | 跟随章节/卷序号 |
| 历史版本 | `history/{chapter_id}/{timestamp}.md` | 以 id 分目录，不以章号 |
| 锁定 | `.novelforge/locks/{chapter_id}.lock` | 粒度是单章 |
| 临时 | `{name}.{pid}.tmp` | 启动时删除；rename 原子，`.tmp` 存在即未提交 |
| 项目清单 | `novel.json` | `id` / `name` / `schemaVersion` |
| 索引 | `.novelforge/index.db` | 可删、可重建；**不被 git 跟踪**（提示用户加进自己的 `.gitignore`） |

**为什么文件名不带 slug（B.1 最容易被"美化"掉的一条）**

曾经考虑过 `chapters/{0001}-{slug}.md`，否决。标题进文件名会同时引入三个新故障：

| 故障 | 触发 |
|---|---|
| 引用断裂 | 改标题 → 要不要改文件名？改，则 `history/`、`locks/`、向量 chunk 的 `chapterId` 引用全断；不改，则名实不符 |
| 跨平台幽灵文件 | 中文标题进文件名 → macOS APFS/HFS+ 按 NFD 归一化分解汉字，Linux/Windows 是 NFC；Git 的 `core.precomposeunicode` 差异会产出"同一文件两个名字" |
| 路径注入 | 小说标题里 `：` `/` `？` `《》` 极常见（"第一章：雨夜"），直接拼进路径就是分隔符注入 |

结论：**文件名只承担排序与稳定定位（4 位零填充序号），标题只进 frontmatter 的 `title`。** 展示层要标题就读 frontmatter，不解析文件名。

顺带一个反直觉结论：**章号可以做文件名前缀，但绝不能做 id**。章号在"中间插一章"时整体位移，位移一次就是 N 次 rename；序号前缀位移同样是 N 次 rename，但它只影响展示顺序、不影响任何引用，所以可接受——前提是引用一律走 `id`。

**id 规则（最容易做错的一条）**

```
新建章节   id = 'ch_' + randomHex(8)          ← 不依赖章号，章号重排不变
迁移章节   id = 'ch_' + sha256(draftId).slice(0, 8)  ← 确定性、可重放
```

两条规则并存是**故意的**，不是笔误：

- 迁移 id 用 `sha256(draftId)` —— **确定性**：不需要 renameMap 表，迁移脚本重放 N 次得到同一个 id，中断重跑不会分裂出两个章节。
- 新建 id 用 `randomHex(8)` —— **不可推导**：不向读者泄漏"这是第几个被迁移进来的章节"。
- 代价是光看 `ch_` 前缀无法区分二者。**不要试图"修好"这一点**（比如改成 `chm_` / `chn_` 两种前缀）——那等于把内部来源编码进公开身份，日后想统一就得再改一次 id。

三条禁止（都是"看起来省事、实际上会撞车"）：

- **禁止** `ch_${n}`（章号派生）：删掉第 2 章再新建一章会撞车，旧章的 `history/` 被新章继承。
- **禁止** `ch_${drafts.id}`（直接拿 DB 自增主键当 id）：它随删库重建而变，且和 `randomHex(8)` 的空间不重合、无法分辨。注意这与上面"用 `sha256(draftId)` 派生"不矛盾——禁止的是**直接挪用**，哈希一次之后就与自增序列无关了。
- **禁止**把 id 写进文件名（见上）：id 只活在 frontmatter，文件名只放序号。

今天 `vela://draft/{n}` 里的 `{n}` 正是 `drafts.id`——这就是 M2 必须切断的耦合点（B.5 / 2.4）。原按章号生成 id 的迁移样例已撤销，版本间身份须按同章映射保持稳定。
- frontmatter 保留 `legacyDraftId`，任何时候都能反查回旧库行。
- **名词对齐**：文件派生索引统一叫 `chapter_index`；08 的旧建表样例已撤销，离线导出不得在原库建表。

### B.2 源码（M1–M4 改名清单）

| 现状 | 目标 | 何时 |
|---|---|---|
| `src/services/draft-index.ts` | `src/core/adapters/chapter-meta.ts` | M4（删兼容字段后不再是"索引"层） |
| `src/services/vela-protocol.ts` | `src/shared/doc-uri.ts` | M4（URI 是投影，不是协议层） |
| `src/services/agent/**` | `src/core/runtime/**` | M3 |
| `src/services/workflows/workflow-starter.ts` | `src/core/application/workflows/start-workflow.ts` | M2 |
| `src/stores/agent-store.ts`（2,064 行） | 拆 `stores/agent/session-store.ts` + `stores/agent/ui-store.ts` | M3 |
| `electron/repositories/content-repository.ts` | 保留（主进程 IO），未来完成统一切换后只服务冻结表 | 1.0 后删 |
| `docs/diagrams/novelforge-architecture.{en,zh}.json` | 删除（孤儿，无任何引用） | M4 收尾 |

命名约定（与项目现状一致，不另起炉灶）：

- 文件/目录 **kebab-case**（`write-chapter.ts`、`draft-branch-repository.ts`）；组件文件 **PascalCase**（`DraftEditor.tsx`）；hooks 用 `useXxx.ts`。
- 仓储 `XxxRepository.ts`、服务 `xxx-service.ts`、用例 `动词-名词.ts`（`write-chapter.ts`）、工具 `xxx.tool.ts`、测试与被测文件同名 `.test.ts` **共置**。
- 契约测试独立放 `src/contracts/`（不共置，因为它不测某个文件，测的是跨层约定）。
- IPC 通道 `域:动作`（`db:draft-apply-content`），新增必须同步 `ipc-channels.ts` 与 `ipc-channel-parity` 快照。
- i18n 键：`域.对象.语义`；**加键前先 grep**（真实事故：重复键触发 TS1117）。

### B.3 文档

- 专题文档放 `docs/architecture/`（不带日期，`01-…` 前缀表阅读顺序）；单篇报告放 `docs/` 带日期前缀（`2026-10-28-…`）。
- 图源 `docs/diagrams/novelforge-{主题}.{lang}.json`，渲染产物同名 `.html`，截图进 `docs/architecture/images/`。
- 文档里的**规模数字必须标口径与实测日期**（"非测试 TS/TSX 物理行，2026-10-28 实测"），否则三个月后就是错的。

### B.4 改动规范（每次动文件前过一遍）

1. **改名必须捕获联动**：编辑期记录 `renameMap`（旧名→新名），一次性应用到引用、索引、导出、记忆四处——项目已有教训：改名漏联动会留下"名字改了但索引还是旧的"的幽灵数据。
2. **跨项目写库三件套**：`loadSeq` + 项目路径校验 + `saving` 状态保护，缺一不可（角色写入曾因此串项目）。
3. **数据库改动**遵守 `db-migration-standard`：加列走 `safeAddColumn`、迁移幂等、`user_version` 原子递增、**非关键步骤不 throw**（历史上 v6 删列导致 SELECT 死循环）。
4. **文件写入**用 `写临时文件 → fsync → rename`；保存前比对内容 hash；保存失败必须给用户反馈（日志 + toast + 返回值），不能静默。
5. **删除**：用户数据不删（冻结 + 备份）；代码删除走 git；临时产物（`.test-artifacts/`、`.test-projects/`）已在 `.gitignore`。
6. **提交**：`typecheck && lint && test && check:boundaries && test:contracts` 五条全绿；`git status --short package.json` 确认 scripts/devDeps 没被构建工具覆盖；推完看 `gh run list` 确认 CI 真绿。
7. **生成物**：`docs/diagrams/*.html` 已标 `linguist-generated`，改 JSON 后重渲染，不要手改 HTML。

### B.5 残留 `vela` / `.vela` 的分级处置

仓库里 `vela|VELA` 共 391 处 / 87 个非测试文件（口径：`src|electron|scripts` 下非 `.test.` 的 TS/TSX/MJS，2026-10-28 实测）。**绝大多数是内存标识符，改名零成本；但有三类碰了会真丢数据。** 判断标准只有一个：

> **这个名字会不会出现在磁盘 / 用户 profile / 数据库里？会 → 不改；不会 → 随便改。**

#### 类别 A · 落盘，禁止改名（改 = 老项目打不开）

| 残留 | 位置 | 为什么不能动 |
|---|---|---|
| `vela.db` 文件名 | `electron/controllers/project-controller.ts:261,314`；i18n `ui.ts:235`（用户可见，3 语种） | 文件真实存在于用户项目 `.novelforge/` 下。改名 = 老项目打开时找不到库 |
| `.vela` 惰性迁移回退 | `config-utils.ts:82,109,168`、`main.ts:321`、`update-controller.ts:283` | 磁盘上仍有未迁移的老项目。删了 = 这些项目的数据目录不再受保护 |
| `.vela` 保护段 | `safe-path.ts:68`、`critical.ts:14`、`intent-router.ts:208`；i18n `tool.ts:279` | 同上：**把它从 `PROJECT_DATA_DIR_SEGMENTS` 里删掉，等于允许 agent 写老项目的数据目录** |
| `vela-*` localStorage 键 | `vela-workflow-checkpoint`、`vela-theme`、`vela-notice`、`vela-zoom-level`、`vela-first-run`、`vela-vector-config`、`vela-theme-migrated` | 键名在用户 Electron profile 里。改名 = 全体用户被判定为"首次运行"，已读通知 / 主题 / 缩放全部重置 |

`.vela` 保护段要保留到 **1.0**（与 B.4-5 的"用户数据不删"同原则）。届时处置方式是：启动时扫描磁盘、确认无任何 `.vela` 目录后再移除，而不是按版本号硬切。

#### 类别 B · 落盘但可改（改 = 必须配一次性读时映射）

**`vela://` URI（77 处）是唯一有真实迁移成本的残留。** 它不只是内存串，被持久化到两处：

| 落点 | 载体 | 成本 |
|---|---|---|
| **工作流 checkpoint（落库）** | `workflow-store.ts:24` `saveCheckpoint` → `db:checkpoint-save`，`activeRuns[].rehydrateParams.draftPath = 'vela://draft/12'` | **高**：改前缀后，挂起中的工作流恢复时带着老串 |
| editor tab key（内存） | `editor-store.ts` `tabs[].id = filePath` | 低：重启即失 |

所以 `vela://` → `doc://` 的改名必须配一条**一次性的读时映射**（解析失败时按老前缀重试一次，不设开关、不落新串），等存量 checkpoint 自然过期后删除。**不能**直接全局替换。

#### 类别 C · 纯内存标识符，可随时全局替换（零迁移成本）

| 残留 | 数量 | 处置 |
|---|---|---|
| `velaAPI`（preload 注入名） | 64 | M3 随 `src/core/` 一并改名；不落盘 |
| `VELA_HOME` 常量名 | 123 | 值早已是 `~/.novelforge`，只是名字没跟上；M3 改 |
| `getProjectVelaDir()` 函数名 | 40 | 同上，返回值已是 `.novelforge`；M3 改 `getProjectDataDir()` |
| `vela-protocol.ts` 文件名 | 1 | 见 B.2，M4 改 `doc-uri.ts` |
| CSS 类名 `.vela-editor-content`（8）、`.vela-toast-root`（3） | 2 个类名 / 11 处 | M4 收尾时改；DOM id 改了不影响任何持久化 |
| 日志文件前缀 `vela-dev-` | 1 | 可改；旧日志文件不受影响（已写完） |

#### 附带发现：两个既有的"章节识别不到"，不是附录 B 引入的

M1 动手前必须先知道——**两个模块对 `chapterDir` 这个字段的格式约定是相反的**：

| 模块 | 期望格式 | 校验 | 不匹配时 |
|---|---|---|---|
| `vela-protocol.ts:77` `parseVelaId` | `vela://draft/{纯数字 id}` | `/^\d+$/` | `return ''` |
| `draft-index.ts:144,152,169,180,242,253,270`（8 个函数） | `…ch{N}` 结尾 | `/ch(\d+)$/` | `return []` / `null` / `1` |

于是：

- `getDraftDir()`（`chapter-workflow.ts:66`）产出 `vela://draft/ch12` → 对 draft-index 合法、**对 vela-protocol 是死路径**；
- `chapter-workflow.ts:282` 产出 `vela://manuscript/{drafts.id}` → 对 vela-protocol 合法、**对 draft-index 是死路径**。

`DraftEditor.tsx:66` 用前者拼 `chapterDir` 去取修稿 / 审稿列表，`draft-store.ts:142` 用同一个函数。也就是说**修稿合并与审稿报告这两条链路，取决于传入的是哪种格式，有一半时间是静默返回空的**——这就是"章节识别不到"的现存实例，跟改名无关。

处置：M1 统一为**只认 `id`**（`doc://chapter/{ch_xxxxxxxx}`），`chapterDir` 这个"用章号拼路径"的中间概念**直接删除**。这本来就是附录 B 禁止章号派生 id 的动机，只是它今天已经以 bug 的形式先发生了。

---

[← 返回 03 路线](03-roadmap.md)　｜　[06 · 存储方案](06-storage-design.md)　｜　[07 · DB 与规模](07-db-and-scale.md)　｜　[08 · 自审与迁移](08-self-review-and-migration.md)
