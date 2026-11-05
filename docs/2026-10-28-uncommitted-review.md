# 未提交文档审查报告与修改计划书

> **2026-10-28 20:30 追记（必读）**：作者决定 beta 期走激进路线——**章节正文改为文件真相（`chapters/*.md` + frontmatter），SQLite 降级为可重建索引**，并删掉 06 初稿里的双写开关。因此：
> - 本报告 §三 的 P0 事实缺陷（版本号、契约测试落位、路径守卫、`contents` 假 gate、`filePath` 定性、回填漏孤儿）**仍然成立**，是审查结论；
> - 本报告 §四 的阶段 A/B 排期与"v24 建 `chapters` 表"的施工方案**已被取代**，以 [03 路线](architecture/03-roadmap.md) / [04 施工](architecture/04-refactor-plan.md) / [06 存储](architecture/06-storage-design.md) 为准；
> - 文中数字（26 工具 / 34 文件·47 处 `getState()` / 3,078 用例 / 23 张表）已同步进正文与图示；
> - 后续 [08 自审](architecture/08-self-review-and-migration.md) 又推翻了「0.1.9 删旧表」和「影子双写」的表述，已并入 03 规矩一与 04 M1.5（见 §四台账）；
> - **M0 已落地**：`scripts/check-boundaries.mjs` + 基线、`src/contracts/` 7 条契约、两个 npm script、CI 两步，全部跑绿（279 文件 / 3,078 通过 + 7 expected fail）。

> 审查对象：工作区 **18 个未跟踪文件**（0 个已修改、0 个已暂存）
> 基线：`master @ 562c6be`，与 `origin/master` 同步；版本 `0.1.7-beta.3`，`CURRENT_SCHEMA_VERSION = 23`
> 审查时间：2026-10-28
> 核验方式：`git status --porcelain -uall` 清单 → 逐文件阅读 → 对文中 22 项事实断言跑代码/DB/测试核对 → 全量测试实测（**278 文件 / 3,078 用例全绿，100.5s**）

---

## 一、总体结论

**方向正确，证据链扎实，但不能原样入库。**

这批文档（架构对比 → 诊断 → 目标 → 路线 → 施工 → 借鉴）是本项目第一次把「用着不对但说不出哪里不对」落成可检验的结构问题，价值高于仓库里既有的两份「整体健康」评审。核心论断（双轨执行、无单一事实源、UI 反向定义数据模型）**经代码核实成立**。

问题在于：**施工细则里有 6 处会直接让方案跑不通或跑成假绿的硬伤**，另有 6 处数字/定性与代码实测不符。这些不是文风问题——按现在的 04 号文档执行，第一步的契约测试会以「找不到测试文件」报红，迁移脚本会因为版本号已被占用而**静默不执行**，第 4 阶段的路径守卫是**空操作**，第 5 阶段删字段会**打断编辑器标签身份**。

**建议：先按本报告 P0 修正（工作量：小，半天级），再分两个 commit 入库。**

### 文件级判定

| 文件 | 体积 | 性质 | 判定 |
|---|---:|---|---|
| `docs/2026-10-28-architecture-comparison.md` | 12.6 KB | 六项目调研全文 | 保留，改 4 处数字 + 1 处定性 |
| `docs/2026-10-28-refactor-plan.md` | 684 B | 重定向存根 | **删除**（与 04 重名，纯跳转） |
| `docs/architecture/01-diagnosis.md` | 7.0 KB | 现状诊断 | 保留，修口径与定性 |
| `docs/architecture/02-target-architecture.md` | 4.8 KB | 目标架构 | 保留，补「卷」的归属决策 |
| `docs/architecture/03-roadmap.md` | 4.1 KB | 七周路线 | 保留，改排期口径（见 P1-2） |
| `docs/architecture/04-refactor-plan.md` | 9.8 KB | 施工细则 | **保留但重写 5 处关键步骤**（P0-1~P0-6） |
| `docs/architecture/05-lessons.md` | 12.9 KB | 可借鉴清单 | 保留，改 1 处数字 |
| `docs/architecture/images/*.png` | 253/260/473 KB | 三张配图 | 保留（已目视确认清晰可读） |
| `docs/diagrams/*.zh.json`（4 个） | 4.4–7.9 KB | 图源 | 保留 |
| `docs/diagrams/*.zh.html`（4 个） | 4 × ~850 KB | 渲染产物 | **入库**，用 `.gitattributes` 标 `linguist-generated` 折叠 diff（见 P1-5） |

---

## 二、事实核验（22 项）

口径说明：行数 = **非测试** TS/TSX 物理行（`git ls-files` + 逐文件统计），与文档数字同口径；测试数 = 本次 `npx vitest run` 实测。

| # | 文档断言 | 实测 | 判定 |
|---|---|---|---|
| 1 | `src/components` 38,048 行 | 38,353 | ⚠ 偏低 305 行（0.8%），需重测 |
| 2 | `src/services` 31,386 行 | 31,555 | ⚠ 同源偏差（-169） |
| 3 | `electron` 22,064 行 | 22,163 | ⚠ 同源偏差（-99） |
| 4 | `src/stores` 7,090 行 | 7,115 | ⚠ 同源偏差（-25） |
| 5 | 全仓 112k + 测试 45k | 112,448 + 45,822 | ✔ |
| 6 | `ipc-channels.ts` 1,614 行 / 273 通道 | 1,614 / 273 | ✔ |
| 7 | `agent-store.ts` 2,064 行 | 2,064 | ✔ |
| 8 | `agent-engine.ts` 1,032 行 | 1,032 | ✔ |
| 9 | 「27 个 agent 工具」 | **26** 个（`builtinTools` 条目数） | ✘ 需改 27→26 |
| 10 | 20 个工具依赖 `stores/*` | 20 / 26 = **77%**（文档写 74%） | ✔ 事实对，百分比需改 |
| 11 | 「21 处 project-store」 | 16 文件 / **17 处** `getState()` | ✘ |
| 12 | 「editor-store(3)、layout(1)、agent(1)」 | editor **11**、vector 2、workflow 1、layout 1、draft 1、agent 1 | ✘ 漏 3 个 store |
| 13 | `ToolArtifact` 13 种 | 13 | ✔ |
| 14 | 「274 个测试」 | **278 文件 / 3,078 用例**，全绿 | ✘ 把文件数当用例数 |
| 15 | 迁移脚本标 `v22` | 当前已是 **23** | ✘ **致命**（见 P0-1） |
| 16 | `contents` 写入「期望 1 处」 | 现在就是 1 处 | ✔ 但作为验收 gate **无效**（P0-4） |
| 17 | workflow-starter 5 个活动入口 | 5 个；非测试引用 13 处 | ✔ |
| 18 | 定稿后处理「kb_import 单根 + 8 路并行」 | 9 步 DAG（1+8） | ✔ |
| 19 | 「22 张表」 | **23** 张 | ✘ 图示需重出 |
| 20 | `DraftMeta.filePath` 是「伪造字段」 | `vela://draft/{id}` **虚拟 URI**，`fileName` 才是伪造的显示串 | ✘ 定性错误（P0-5） |
| 21 | `chapters` 表不存在 / `drafts.chapter_number` NOT NULL 无 FK | 属实（`database.ts:293-312`） | ✔ |
| 22 | 一致性靠后处理 DAG 事后补偿 | 属实（`finalize-chapter.command.ts`） | ✔ |

**结论**：核心诊断经得起核对；失分集中在「规模数字」与「三个关键实现细节」，后者会直接反噬施工步骤。

---

## 三、缺陷清单

### P0 — 会让方案跑不通或跑成假绿

#### P0-1 迁移版本号冲突：`v22` 已被占用 → 迁移永不执行

- 证据：`electron/database.ts:124` `CURRENT_SCHEMA_VERSION = 23`；`database.ts:148` 为 `if (currentVersion >= CURRENT_SCHEMA_VERSION) return`。
- 后果：按 04 号文档写 `-- v22`，新库直接以 23 落地、旧库走 23 迁移分支，**`chapters` 表与 `drafts.chapter_id` 永远不会被创建**，而测试与开发机上「表不存在」要到运行期才炸。这是最隐蔽的一条：迁移"没报错"，schema 就是没变。
- 修法：改 `v24`；并在文档里写死一条规矩——**迁移编号只认 `CURRENT_SCHEMA_VERSION + 1`，写文档时留占位符 `v{N+1}`，落地时替换**。

#### P0-2 契约测试落位与脚本都不存在：阶段 0 的「先红」是假红

- 证据：`vitest.config.ts` 的 `include` 只覆盖 `src/**`、`electron/**`、`scripts/**`；仓库**没有 `test/` 目录**；`package.json` 没有 `test:contracts` / `test:runtime`。
- 后果：`pnpm vitest run test/contracts` 只会输出「No test files found」并以非 0 退出——看起来"红了"，但那是路径错，不是契约失败。文档却要求「失败项就是你的改造清单」，会拿到空清单。CI 段落的 `pnpm run test:contracts` 直接 `Missing script`。
- 修法：测试放 `src/contracts/chapter-consistency.test.ts`（跟随现有共置约定）；`package.json` 增 `"test:contracts": "vitest run src/contracts"`；若坚持独立目录，必须在 `include` 里加 `'test/**/*.test.ts'` 并把这一步写进同一阶段。

#### P0-3 路径守卫是空操作：正则匹配不到任何真实路径

- 证据：04 号文档给的是 `const PROTECTED = [/^drafts\//, /^chapters\//]`；但本仓库的草稿正文路径是 `vela://draft/{id}`（`src/services/vela-protocol.ts`、`write-file.tool.ts:45-95`），项目中**不存在 `drafts/`、`chapters/` 目录**。
- 后果：被标注为「最容易漏、最致命」的一步，落地后一条都拦不住，而团队会以为已经上锁。
- 另需修正叙述：agent 写正文**并非无防护**——`write_file` 带 `requiresConfirmation: true`，走 `approval/critical.ts` 人工确认，且以 `expectedHash` CAS 落库、`finalized` 只读。真正缺的不是"禁止"，而是**这条写入路径不经过 Chapter 用例**（不产生章节状态、事件、大纲联动）。
- 修法：守卫落在 `write-file.tool.ts` 的 `isVelaProtocol` 分支，改成「写 draft 必须携带 `chapterId` 并调用 `writeChapter` 用例」，或先降级为「仅允许 `edit_file` 段落级修改」。禁止式写法只保留作为兜底，不作为主方案。

#### P0-4 验收 gate 已经成立 → 无法证明改造有效

- 证据：04 号文档的出口条件是 `grep -rn "INSERT INTO contents" src/ electron/ | wc -l` **期望 1**；实测现在就是 **1**（`electron/repositories/content-repository.ts:17`）。
- 后果：改造前后都是 1，这条 gate 零鉴别力，属典型的"绿灯陷阱"。
- 修法：换成有区分度的信号，例如「`drafts` 的 INSERT/UPDATE 只出现在 `draft-repository.ts`」+「`write_file` 的 `vela://draft/*` 分支只能由 `writeChapter` 用例触达」+「契约测试从 0 到 N」。

#### P0-5 `filePath` 定性错误：它不是伪造路径，是虚拟 URI

- 证据：`src/services/draft-index.ts:73` `filePath: \`${VELA.DRAFT}${dbMeta.id}\`, // 伪协议路径，用于 editor-store`；`VELA.DRAFT = 'vela://draft/'`。`fileName: draft_v{n}.md` 才是为了让 UI 有东西显示而拼的。
- 后果：文档把两者并列为「伪造字段 → 删掉」，并按「>10 处引用就单独排期」自我校验；实测 **`draft.filePath` 类直接引用 15 处**，而 `filePath` 全量引用 **248 处**（含编辑器标签身份 `editor-store.tabs[].filePath`）。照文档执行会拆掉标签页的文档身份，`DraftEditor`/`EditorArea`/`DraftBoxGroup` 全部要改键。
- 修法：分两步、改叙述：① `fileName` 删（纯显示串，可派生）；② `filePath` **重命名为 `uri`/`documentId` 并把 editor 标签键改为 `draft:{id}`**，这不属于"删兼容层"，而是独立的「文档身份」改造，必须单独立项（P1-2 已按此重排）。

#### P0-6 回填脚本漏「孤儿章节」，断言在真实库上会失败

- 证据：`database.ts:295` 注释明写「导入时先于蓝图创建」，`:312`「chapter_number 与 blueprints 无硬 FK」；`volumes` 用 `chapter_start/chapter_end` 区间（`:506-515`）。
- 后果：04 号文档的 `allChapterNumbers()` 未定义，最可能实现成「读 blueprints」→ 导入期先建的草稿章节号不在 blueprints 里 → `chapter_id IS NULL` 的行必然存在 → 脚本最后那句 `assert(... === 0)` 直接把迁移打断（而项目规矩是"非关键步骤不 throw"）。
- 修法：章节号来源取**三源并集** `blueprints.chapter_number ∪ drafts.chapter_number ∪ volumes 区间展开`；断言改成"记录告警 + 落 `migration_report` 表"，不阻断启动。

#### P0-7 文档没有入口，且存根制造同名文档

- 证据：`docs/2026-10-28-refactor-plan.md`（684 B）只是跳转页，与 `docs/architecture/04-refactor-plan.md` 同名；全仓 `README.md`、`AGENTS.md`、`docs/` 均**未引用**这批新文档（`grep` 无命中）。
- 后果：两份"重构计划书"并存，三个月后不知道哪份是权威；同时新文档成为孤岛，只有作者本人找得到。
- 修法：删存根；在 `README.md` 的文档区或 `AGENTS.md` 项目记忆里加一行入口（指向 `docs/architecture/01-diagnosis.md`）；`docs/architecture/` 下加一个 `README.md` 作为阅读顺序索引（现在阅读顺序只写在每篇的页眉里，没有总入口）。

---

### P1 — 影响可信度与执行效率

| 编号 | 问题 | 证据 / 影响 | 建议 |
|---|---|---|---|
| P1-1 | 规模数字失真 | 27→26 工具、21→17 project-store、3→11 editor-store、274→3,078、22→23 表、74%→77% | 统一在 01/03/05/comparison/图示里替换；注明"实测于 2026-10-28，口径=非测试物理行" |
| P1-2 | 七周排期不可信 | 单人维护 112k 行；`filePath` 全量 248 处；5 个 workflow 入口非测试调用 13 处；文档自身又写「>10 处要单独排期」 | 改成**按出口条件排期的里程碑 M0–M4**（见 B 节），不给日历周数；周数会变成承诺，条件不会 |
| P1-3 | 卷归属双事实源未决策 | `volumes.chapter_start/chapter_end` 已定义卷范围；04 号文档又给 `chapters.volume_id`，但全文未提 `volumes` | 阶段 1 **不加** `volume_id`，`Chapter.volumeId` 由区间派生；等 `volumes` 降级为视图后再落列。写进 02 号文档的「不要做什么」 |
| P1-4 | 迁移不幂等，违反 `db-migration-standard` | `ALTER TABLE drafts ADD COLUMN chapter_id` 无存在性判断；`CREATE UNIQUE INDEX` 无 `IF NOT EXISTS`；断言直接 throw | 按附录 A 骨架重写：`PRAGMA table_info` 判列、`IF NOT EXISTS` 建索引、失败只告警 |
| P1-5 | 4 份 HTML 各 850 KB，重复内嵌 47 个 `data:` 字体 | 合计 3.4 MB，Git diff 噪声大；原文生成命令写死 `D:/Code/archify/...`、含本机盘符回收站问题，外部不可复现 | **已处置**：入库并用根目录 `.gitattributes` 标 `linguist-generated`；重生成流程写进 [`docs/architecture/README.md`](architecture/README.md)（`ARCHIFY` 变量 + 临时目录渲染 + `chrome-headless-shell` 截图），HTML 已按新 JSON 重渲染 |
| P1-6 | 工具契约描述过时 | `AgentTool` 已有 `isReadOnly`、`requiresConfirmation`、`timeoutMs`（`tool-registry.ts:80-103`），文档称「现在靠 `MAX_PARALLEL_READ_TOOLS` 加约定」 | 改为「已有一枚布尔，缺 `isConcurrencySafe` / `isDestructive` 两枚」，只补这两枚的收益才成立 |

### P2 — 一致性与体例

| 编号 | 问题 | 建议 |
|---|---|---|
| P2-1 | comparison 说「5 种表示」，其表格是 6 行，01 号文档说「6 种」；同一节标题「两条执行路径」正文却是「三个入口」 | 统一为「六种表示 / 三条写入路径」 |
| P2-2 | 图示命名分裂：旧 `novelforge-architecture.{en,zh}.json` 已无任何引用（孤儿），新图用 `novelforge-{current,target,roadmap,workflow}.zh.*` | 删除两份孤儿 JSON（或改名并入新命名）；`workflow` 图当前**无任何 md 引用**，要么在 01 号文档链上，要么入库前删 |
| P2-3 | 命名约定不一致：`docs/*.md` 用日期前缀，`docs/architecture/` 无日期 | 保留现状（专题目录不写日期、单篇报告写日期），并在 `docs/architecture/README.md` 声明这条约定 |

---

## 四、处置台账（本轮已执行）

| 缺陷 | 处置 | 落点 |
|---|---|---|
| P0-1 迁移版本号冲突 | **已消解**：文件方案不再建 `chapters` 表；旧表冻结不删，因此连 v24 迁移都不需要（当前 23 保持不变） | 03 / 04 M4.3 |
| 08-P0-1 删表不可逆 | 已收回"0.1.9 drop"：**旧表冻结 + deprecated**，删除不早于 1.0 | 03 规矩一 / 04 M4.3 |
| 08-P0-2 降级闸门 | 已补 `storage_meta.storage_version` + `StorageTooNewError` | 04 M1.5 |
| 08-P0-3 保存静默失败 | 已补：日志 + toast + 返回错误三件套 + `shadow_write_fail` 事件 | 04 M1.5 |
| 08-P1-1 未复用迁移基建 | 已改：加列走 `safeAddColumn`，禁止裸 `ALTER` | 04 M1.5 |
| 08-P2-2 文案未走 i18n | 已补：迁移提示必须 `t()` 三语，加键前 grep | 04 M1.5 |
| P0-2 契约测试落位 | 已改 `src/contracts/`，`test:contracts` 进 CI | 04 M0 |
| P0-3 守卫空操作 | 已改 `vela://draft/*` 落点，并补「现有 requiresConfirmation + CAS」事实 | 04 M2 |
| P0-4 `contents` 假 gate | 已删；换成「全仓只有一处写正文」+「删索引可重建」 | 04 M1/M2 |
| P0-5 `filePath` 定性 | 已改「虚拟 URI」，`fileName` 单列伪造；删字段拆成 M4 独立动作 | 01 / 02 / 04 |
| P0-6 回填漏孤儿 | **已消解**：改为导出脚本逐章 hash 校验，不一致整批中止 | 04 M1.5 |
| P0-7 文档无入口 | 已加 `docs/architecture/README.md` + `AGENTS.md` 入口 | 新增 |
| P1-1 数字失真 | 已按实测替换（26 / 17 / 11 / 34 / 3,078 / 23） | 01/02/03/05/comparison/图 |
| P1-2 七周排期 | 已改为 M0–M4 出口条件 | 03 |
| P1-3 卷归属 | **已消解**：文件方案下 `volume` 是 frontmatter 字段，索引里是预留列 | 02/06/07 |
| P1-4 迁移不幂等 | **已消解**：不再有 SQL 表迁移；导出脚本要求跑两遍零变更 | 04 M1 |
| P1-5 图产物策略 | 入库 + `linguist-generated`；重生成流程写进 README | `.gitattributes` / README |
| P1-6 工具契约描述 | 已改为「已有 `isReadOnly`，缺两枚并发布尔」 | 04 M3 |
| P2-1 术语不一致 | 已改「六种表示 / 三条写入路径」 | comparison |
| P2-2 图命名分裂 | 保留新命名；旧 `novelforge-architecture.*.json` 已无引用，待删 | 待办 |
| P2-3 命名约定 | 已写进 README + [04 附录 B](architecture/04-refactor-plan.md)（项目文件 / 源码 / 文档三套规则 + M1–M4 改名清单 + 改动前 7 条检查） | README / 04 |
| M0 落地 | `scripts/check-boundaries.mjs` + 基线（34 文件 / 47 处）、`src/contracts/` 7 条契约、两个 npm script、CI 两步 | 已跑绿 |

---

## 五、提交建议

两个 commit，不要合并：

```
commit 1  docs: 架构诊断与改造方案（01-07 + README + 调研全文）
commit 2  docs: 架构图示（json 源 + html 渲染 + png 截图）
```

分开的理由：正文会长期演进，图是低频重生成物；`git log` 才能区分"结论变了"还是"图重画了"。`.gitattributes` 已把 HTML 标为生成物，diff 会折叠。

---

## 六、审查边界（未验证的部分）

- **未在真实用户库上执行导出**：孤儿章节数由表注释与导入顺序推断；落地前先在真实库副本上跑 `SELECT COUNT(*) FROM drafts d LEFT JOIN blueprints b USING(chapter_number) WHERE b.chapter_number IS NULL`，并核对导出的章数与 `drafts` 实际条数。
- **未评估 UI 侧标签身份的迁移成本**：`filePath` 248 处引用只做了计数，未逐个判断是"标签键"还是"草稿元数据"。这项工作应在 M4 之前单独跑一遍（`editor-store.tabs` 的键来源）。
- **图示工具已验证**：`archify 3.2.0`（本机 `D:/Code/archify`）validate/render 通过；截图用 Playwright 缓存里的 `chrome-headless-shell`（1400×1250 @1.5x = 2100×1875）。命令已参数化写进 [`docs/architecture/README.md`](architecture/README.md)。
- **原型已验证**：`docs/architecture/prototype/chapter-store.mjs` 实跑 10/10 场景通过（2026-10-28）；它验证的是文件语义，不含 Electron / 真实项目库压力。
