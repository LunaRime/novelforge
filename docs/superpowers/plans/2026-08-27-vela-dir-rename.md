# `.vela` → `.novelforge` 目录改名实施计划（档 1：只改目录名）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将用户可见的 `.vela/` 目录改名 `.novelforge/`（项目内 + 全局 `~/.vela` → `~/.novelforge`），带一次性迁移；`vela.db` 文件名、`vela://` 协议、`velaAPI`、CSS 类名（含 index.html 启动屏类）**保持不变**。

**Architecture（P0-5 修订——消除中间态）：** ① 常量收敛（散落字面量 → 常量引用，**V1 不改值**：`PROJECT_VELA_DIR` 先以 `.vela` 落地，V1 提交零行为变化）② 改值 + 迁移合并为**一次提交**（V2：`PROJECT_VELA_DIR`/`VELA_HOME` 改 `.novelforge`，同 commit 落地全局/项目迁移 + 双路径兜底——避免「值已改、迁移未到」的中间态：better-sqlite3 对不存在路径静默建空库 = 数据感知上全丢）③ 直开点统一走 `getProjectVelaDir`（**惰性迁移**：旧 `.vela` 存在且新目录不存在时自动 rename——覆盖未打开项目的跨项目聚合直开点）④ 迁移失败回退双路径读取。

**Tech Stack:** TypeScript + Node fs（主进程）+ vitest

**Spec:** 无 spec 文档（本次评估产出，档 1 裁决）；关联约束：`CLAUDE.md` 品牌约束需同步更新（「技术标识符 velaAPI, vela://, .vela/ 保留不改」→ .vela 目录已改，仅 velaAPI/vela:// 保留）

## Global Constraints

- ESLint strict（--max-warnings 0）、TypeScript strict（noUnusedLocals/Parameters）
- **白名单替换纪律**：只替换「目录路径」语义的 `.vela` 字面量；`vela.db`（文件名）、`vela://`（协议）、`velaAPI`（API 名）、CSS 类名（`.vela-editor-content`（novel-editor.css:4-34）+ index.html 启动屏 6 类 `.vela-initial-loader`/`.vela-core-container`/`.vela-ring`/`.vela-ring-inner`/`.vela-core`/`.vela-text` + 4 个 keyframes `vela-spin`/`vela-spin-reverse`/`vela-pulse`/`vela-text-shine`）、`VELA_HOME` 常量名（标识符本身可留，值改）**一律不动**
- 迁移失败必须回退（旧路径可读），**绝不阻塞启动/打开项目**
- 提交规范：`feat:`/`fix:`/`docs:` 前缀、一个提交一件事、`git commit -F - <<'EOF'` 消息文件
- 执行窗口建议：改动面 59 文件，与 A/B/加固计划无文件重叠（那些是 agent 层）——可独立窗口执行，建议排在零成本小改之后

---

### Task V1: 路径常量收敛（不改值，零行为变化）+ 分类清单

**Files:**
- Modify: `electron/utils/config-utils.ts`（新增 `PROJECT_VELA_DIR` 常量——**值暂为 '.vela'**，改值在 V2；`VELA_HOME` **值不动**）
- Modify: `electron/database.ts`（:29 路径拼装改用 `PROJECT_VELA_DIR` 常量）
- Modify: 全部直开点改用常量/helper（**值不变**）：activity-repository.ts:55/:94、usage-repository.ts:64/:91、project-controller.ts:305、memory-controller.ts:12、vector-store.ts:167/:182/:845、knowledge-base.ts:39（核验新增）
- Modify: `electron/mcp/mcp-ipc-bridge.ts`（:19）与 `electron/mcp/mcp-manager.ts`（:116）——`app.getPath('home')` 硬编码 → `VELA_HOME`（纯收敛，值不变）
- Modify: `src/shared/project-paths.ts`（:13/:16 渲染层集中常量，被 generate-draft.command.ts:298 消费）——先收敛再逐文件替换
- Modify: 全库目录语义 `.vela` 字面量（**白名单纪律**；核验实测源码字面量 17 处 + 1 测试文件，「59 文件」是含注释/文档/i18n 的全口径）
- Test: 全量回归（零行为变化验证——此时所有路径值仍为 `.vela`）

**Interfaces:**
- Produces: `PROJECT_VELA_DIR = '.vela'`（config-utils 导出，**占位值**，V2 改 `.novelforge`）；`VELA_HOME` 值不变
- Consumes: 无

- [ ] **Step 1: 写分类清单（防误伤）**

  全库 grep `.vela`，逐处分类（核验基准：electron+src 源码字面量 17 处 + 1 测试文件；docs 12 文件 68 处；locale-data 6 处含 5 条用户可见）：
  - **目录语义（收敛为常量引用）**：`'.vela'` 字符串路径、`~/.vela/...` 路径拼装、注释/文档中的目录描述（`{project}/.vela/vela.db` 描述等）
  - **直开点（本次新增类别）**：activity-repository.ts:55/:94、usage-repository.ts:64/:91、project-controller.ts:305、mcp-ipc-bridge.ts:19、mcp-manager.ts:116（`app.getPath('home')` 硬编码）、update-controller.ts:135（os.homedir，**删除语义**）、memory-controller.ts:12、vector-store.ts:167/:182/:845、knowledge-base.ts:39、project-paths.ts:13/:16（渲染层）
  - **保留（不动）**：`vela.db`、`vela://`、`velaAPI`、`VELA_HOME` 标识符、CSS 类名（.vela-editor-content + index.html 启动屏 6 类 + 4 keyframes）、`vela_` 前缀（如 DB 表/字段）
  - 清单写入任务报告（替换数/保留数），作为评审输入

- [ ] **Step 2: 常量收敛（先做，替换基础）**

```ts
// electron/utils/config-utils.ts（V1：值均不动——P0-5 修订：改值推迟到 V2 与迁移同提交）
export const VELA_HOME = path.join(os.homedir(), '.vela')  // V1 保持原值；V2 改 ~/.novelforge
/** 项目内运行时数据目录名（V1 占位值 .vela；V2 改 .novelforge——与 VELA_HOME 同步一次改） */
export const PROJECT_VELA_DIR = '.vela'
```

```ts
// electron/database.ts:29
import { PROJECT_VELA_DIR } from './utils/config-utils'
const dbPath = path.join(projectPath, PROJECT_VELA_DIR, 'vela.db')
```

- [ ] **Step 3: 字面量收敛为常量引用（白名单纪律；P0-5 修订——值不改，只改引用）**

  对 Step 1 分类清单中的「目录语义」「直开点」项逐一**把字面量替换为常量引用**（值仍 `.vela`，零行为变化）：
  - `path.join(projectPath, '.vela', ...)` → `path.join(projectPath, PROJECT_VELA_DIR, ...)`（database.ts:29 / activity-repository :55 / usage-repository :64 / project-controller :305 / memory-controller :12 / vector-store :167/:182/:845 / knowledge-base :39）
  - `app.getPath('home') + '.vela'` → `VELA_HOME`（mcp-ipc-bridge :19 / mcp-manager :116——**评审要求 V1 同时收敛**）
  - `os.homedir() + '.vela'` → `VELA_HOME`（update-controller :135，删除语义在 V2 处理双删）
  - 渲染层 `'.vela/chapter_creation_log.json'`（**ChapterCreationDialog.tsx:34**——核验确认文件名，计划初稿「Dialog.tsx:34」错；全 dialogs 目录仅此文件含 .vela）→ 引用常量（project-paths.ts 新增导出或同值常量）
  - `src/shared/project-paths.ts` 常量值保持 '.vela'（V2 改）；generate-draft.command.ts:298 已消费常量 ✓
  - 测试文件 mock 路径同步（intent-router.test.ts:65-66 mock 目录名 + :81 断言在 V2 随安全名单双前缀改）
  - `vela.db`/`vela://`/`velaAPI`/`VELA_HOME` 标识符/CSS 类名保留

  ⚠️ 不用全局 find-replace——用白名单清单逐处核对。**V1 提交后全库不再有散落 `.vela` 路径字面量（均走常量）**——V2 一处改值即全库生效。

- [ ] **Step 4: 全量回归（零行为变化验证）**

Run: `pnpm run test && pnpm run typecheck && pnpm run lint`
Expected: 全绿（**值未变**：所有路径仍指向 `.vela`，行为与提交前逐位一致）。

- [ ] **Step 5: Commit**

```bash
git add -A  # 替换面大，逐文件 add 或 -A 后 review
git commit -F - <<'EOF'
refactor: 路径常量收敛（.vela 字面量 → PROJECT_VELA_DIR/VELA_HOME 常量引用，零行为变化；mcp 硬编码收敛）
EOF
```

---

### Task V2: 改值 + 全局/项目迁移 + 双路径兜底（一次提交，无中间态——P0-5）

**Files:**
- Modify: `electron/utils/config-utils.ts`（**`PROJECT_VELA_DIR`/`VELA_HOME` 值改 `.novelforge`** + `migrateLegacyDirs()` + `getProjectVelaDir` 升级双路径惰性迁移）
- Modify: `electron/main.ts`（启动早期调用——whenReady 第一条，logger 首写 VELA_HOME 在 :269）
- Modify: `electron/database.ts`（打开项目库前经 getProjectVelaDir 触发惰性迁移 + 双路径兜底）
- Modify: 全部直开点（activity/usage/project-controller/memory/vector-store/knowledge-base/update-controller）改走 `getProjectVelaDir`/`VELA_HOME`（V1 已收敛引用，V2 值变自动生效）
- Modify: `src/services/agent/intent-router.ts`（:208 目录排除）与 `src/services/agent/tools/write-file.tool.ts`（:52 写保护前缀）+ intent-router.test.ts mock/断言（P0-7）
- Modify: `src/shared/project-paths.ts`（常量值改 `.novelforge`）+ 渲染层消费点自动生效
- Test: `electron/utils/config-utils.test.ts`（新建，临时目录 mock）+ `electron/database.test.ts`（迁移测试）

**Interfaces:**
- Produces: `migrateLegacyDirs(): Promise<void>`（全局 + 项目目录迁移入口）；`getProjectVelaDir(projectPath): string`（**双路径兜底 + 惰性迁移** helper——原独立 migrateProjectVelaDir 并入）
- Consumes: `PROJECT_VELA_DIR`（V1）

- [ ] **Step 1: 写失败测试**

```ts
// electron/utils/config-utils.test.ts（或迁移模块测试，用临时目录 mock os.homedir/fs）
describe('全局迁移 ~/.vela → ~/.novelforge', () => {
  it('旧目录存在且新目录不存在 → rename', async () => {
    // mock fs：~/.vela 存在（含 config.json 等文件）、~/.novelforge 不存在
    // 断言：rename 被调用（旧 → 新）；迁移后 VELA_HOME 路径可用
  })

  it('新目录已存在（用户手动建过）→ 不覆盖，保留双读', async () => {
    // mock 两目录都存在 → 断言不 rename
  })

  it('旧目录不存在（全新安装）→ 无操作', async () => {
    // 断言 rename 未调用
  })

  it('rename 失败（占用/权限）→ 静默回退，不阻塞启动', async () => {
    // mock rename throw → 断言不抛、后续路径读取用旧目录兜底
  })
})

describe('项目目录迁移 + 双路径（P0-6 覆盖直开点语义）', () => {
  it('{project}/.vela 存在且 .novelforge 不存在 → getProjectVelaDir 惰性迁移后返回新路径', async () => {
    // mock 临时项目目录：.vela/vela.db 存在；调用 getProjectVelaDir(projectPath)
    // 断言：.vela → .novelforge rename；返回 .novelforge 路径（直开点只调 helper 即获迁移）
  })

  it('rename 失败 → getProjectVelaDir 回退旧路径（activity/usage/get-summary 的 existsSync 检查不静默漏读）', async () => {
    // mock rename throw → 断言返回 .vela 路径（活动/用量/摘要显示不空）
  })

  it('新项目（无任何目录）→ 用 .novelforge 创建', async () => {
    // 断言 getProjectVelaDir 返回 .novelforge（database.ts 创建 .novelforge/vela.db）
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm run test:watch electron/utils/config-utils.test.ts`
Expected: FAIL（迁移/惰性迁移不存在）。

- [ ] **Step 3: 实现**

```ts
// electron/utils/config-utils.ts：值改（V2 一处改值全库生效——V1 已收敛全部引用）
export const VELA_HOME = path.join(os.homedir(), '.novelforge')  // ~/.vela → ~/.novelforge
export const PROJECT_VELA_DIR = '.novelforge'

/** 全局目录迁移：~/.vela → ~/.novelforge（启动早期调用；失败静默，旧路径兜底） */
export async function migrateLegacyDirs(): Promise<void> {
  const oldHome = path.join(os.homedir(), '.vela')
  const newHome = VELA_HOME
  if (fs.existsSync(oldHome) && !fs.existsSync(newHome)) {
    try {
      fs.renameSync(oldHome, newHome)
    } catch (e) {
      console.error('[NovelForge] 迁移 ~/.vela 失败，保留旧目录读取：', e)
    }
  }
}

/** 项目库目录：优先 .novelforge；旧 .vela 存在且新目录不存在时**惰性迁移**（P0-6：覆盖未打开项目的
 *  跨项目聚合直开点——activity/usage 只读扫 B/C 项目时同样触发迁移，不再静默漏读）；
 *  迁移失败回退旧路径（双路径兜底，数据不丢） */
export function getProjectVelaDir(projectPath: string): string {
  const newDir = path.join(projectPath, PROJECT_VELA_DIR)
  if (fs.existsSync(newDir)) return newDir
  const oldDir = path.join(projectPath, '.vela')
  if (fs.existsSync(oldDir)) {
    try {
      fs.renameSync(oldDir, newDir)  // 惰性迁移：rename 成功后返回新路径
      return newDir
    } catch (e) {
      console.error(`[NovelForge] 迁移 ${projectPath}/.vela 失败，保留旧目录读取：`, e)
    }
  }
  return newDir  // 新项目：无任何目录 → 用 .novelforge 创建
}
```

  `electron/main.ts` 启动早期调用 `await migrateLegacyDirs()`——**whenReady 第一条**（:268 detectLogEnvironment 之前；logger 首写 VELA_HOME 在 :269，时序核验确认）。
  ⚠️ cleanupOldLogs（logger.ts:179-193）同时清理 logs/ 与 logs/dev/——迁移后首日旧 dev 日志不跟随新路径（可接受丢失，报告注明）。

  安全名单双前缀（P0-7——迁移窗口期内旧 .vela 回退目录同样防写，失守 = AI 工具可写项目数据目录）：

```ts
// write-file.tool.ts:52——新旧双前缀
const forbiddenPrefixes = ['.novelforge/', '.vela/', '.git/', 'node_modules/']
// intent-router.ts:208——目录排除新旧都保留
if (n.name === '.novelforge' || n.name === '.vela' || n.name === 'node_modules' || n.name === '.git') continue
```

  测试同步：intent-router.test.ts:65-66 mock 目录名 + :81 断言（not.toContain 加 `.novelforge/` 与 `.vela/` 双断言）。
  卸载双删（update-controller.ts:135，os.homedir 硬编码 → VELA_HOME）：`fs.rmSync(velaHome)` 改为删除 `VELA_HOME`（新）+ 旧 `~/.vela` 若存在也删除（迁移失败残留场景）——否则卸载残留 ~/.novelforge。

- [ ] **Step 4: 运行确认通过 + 全量回归**

Run: `pnpm run test && pnpm run typecheck && pnpm run lint`
Expected: 全绿（V1 常量引用 + V2 改值迁移 + 安全名单双前缀全部就位）。

- [ ] **Step 5: 直开点全覆盖自检（P0-6）**

  grep 全库 `'.vela'` 与 `app.getPath('home')`/`os.homedir()` 拼装——确认**无遗留路径字面量**（除白名单保留项）；逐个直开点确认已走 `getProjectVelaDir`/`VELA_HOME`（activity/usage/project-controller/memory/vector-store/knowledge-base/update-controller/mcp 两处）。

- [ ] **Step 6: Commit**

```bash
git add -A  # 改值 + 迁移 + 直开点 + 安全名单同 commit（P0-5：杜绝中间态——值改与迁移必须同时落地）
git commit -F - <<'EOF'
feat: .vela → .novelforge 改值与迁移（全局/项目惰性迁移 + 双路径兜底；安全名单双前缀；卸载双删）
EOF
```

---

### Task V3: 文档、i18n 与约束更新

**Files:**
- Modify: `CLAUDE.md`（品牌约束：`.vela/` 已改 `.novelforge/`，velaAPI/vela:// 保留）
- Modify: `CHANGELOG.md`（**2 处目录提及**：:40 `~/.vela/templates/`、:141 `~/.vela/skills`；:191 的 `Window.velaAPI` 是 velaAPI 子串**不动**——核验确认）
- Modify: `src/shared/locale-data.ts`（**5 条用户可见键值，每条三语**——核验确认清单见 Step 2）
- Modify: `docs/` 现行文档（数据库架构章节「项目数据库位于 {projectPath}/.vela/vela.db」等）
- README.md / README.en.md：**核验确认零提及——该分支为空操作，跳过**
- 历史计划文档（docs 顶层 6 个：ccr-memory-p0/p1/p2/p3-plan、ccr-memory-design、llm-anti-hallucination-tools-plan 等 21 处 .vela）**不改**——历史任务记录保持原貌（评审建议明确决策，否则改动面失控）

- [ ] **Step 1: 核查并更新文档**

grep `.vela` 于 CLAUDE.md/CHANGELOG/docs，目录语义处更新为 `.novelforge`；`vela.db`/`vela://`/`velaAPI` 描述保留（技术标识符说明同步更新：`.novelforge/vela.db`、`vela://draft/{id}` 不变）。**历史计划文档不改**（明确决策）。

CLAUDE.md 品牌约束改为：

```
3. **品牌标识**：用户可见用 NovelForge；目录名 `.novelforge/`；技术标识符（velaAPI, vela://, vela.db）保留不改
```

- [ ] **Step 2: 用户可见文本核查（核验已给出清单）**

| 键（:行号） | 修订 |
|---|---|
| dialog.uninstallConfirmMsg（:497） | `~/.vela` → `~/.novelforge`（三语） |
| dialog.migrationFailed（:511） | `.vela/vela.db` → `.novelforge/vela.db`（三语） |
| agent.mcpConfigHint（:1553） | `~/.vela/mcp_config.json` → `~/.novelforge/mcp_config.json`（三语） |
| agent.skillHint（:1557） | `~/.vela/skills/` → `~/.novelforge/skills/`（三语） |
| tool.writeProtectedPath（:2440） | `.vela` 提及 → `.novelforge / .vela`（双目录——与安全名单双前缀一致，三语） |

- [ ] **Step 3: 全量回归 + Commit**

Run: `pnpm run test && pnpm run typecheck && pnpm run lint`
Expected: 全绿。

```bash
git add CLAUDE.md CHANGELOG.md docs/ src/shared/locale-data.ts
git commit -F - <<'EOF'
docs: .vela → .novelforge 文档、CHANGELOG 与 i18n 更新（vela.db/vela:///velaAPI 保留；历史计划文档不改）
EOF
```

---

## Self-Review 记录

**Spec 覆盖**：档 1 裁决四项——项目内目录改名（V1/V3）、全局改名（V1/V2）、vela.db 保留（V1 白名单）、vela:///velaAPI 保留（V1 白名单 + V4 文档说明）。

**占位符扫描**：无 TBD；「如存在」「grep 确认后」为清单式指示（Step 1 分类清单是强制产出，非占位）；文件量级修正为「源码字面量 17 处 + 1 测试文件（59 是全口径含注释/文档/i18n）」（评审核验修正）。

**类型一致性**：`PROJECT_VELA_DIR`/`VELA_HOME` 在 V1 定义（占位值 .vela）、V2 改值后全库消费一致；`migrateLegacyDirs`/`getProjectVelaDir`（含惰性迁移，原独立 migrateProjectVelaDir 并入）在 V2 定义、全部直开点消费一致。

**风险记录**：迁移失败回退双路径（数据不丢）；rename 前无句柄（DB 打开前）；渲染层日志路径迁移失败场景 miss（非关键数据，已注明）；`VELA_HOME` 环境变量此前无覆盖机制（硬编码），本次不新增；cleanupOldLogs 迁移后首日旧 dev 日志不跟随新路径（可接受，报告注明）；卸载双删（迁移失败残留场景旧 ~/.vela 一并清理）。

## 评审修订记录（2026-08-27 外部评审 + 代码核验——问题最多，3 严重项全部修订）

**🔴 P0-5｜V1→V3 中间状态数据丢失（最严重）**：原计划 V1 提交即改 database.ts:29 路径 → 迁移 V3 才落地——中间态打开旧项目，better-sqlite3 对不存在路径**静默创建空库**（数据感知上全丢，旧文件还在 .vela 但 UI 已连空库）；全局 VELA_HOME 改值同样使 ~/.vela/config.json 在 V2 前读不到。
**修订（已落地，评审方案 ①）**：V1 只做常量收敛**不改值**（`.vela` 字面量 → 常量引用，零行为变化提交）；改值 + 全局/项目迁移 + 双路径兜底合并为 **V2 一次提交**——无运行窗口的中间态。

**🔴 P0-6｜直开点绕行（核验确认 7 处 + 4 处遗漏）**：activity-repository.ts:55/94、usage-repository.ts:64/91、project-controller.ts:305、mcp-ipc-bridge.ts:19 + mcp-manager.ts:116（app.getPath('home') 硬编码）、update-controller.ts:135（os.homedir）、memory-controller.ts:12、vector-store.ts:167/182/845 全部 VERIFIED。**核验新增 4 处**：knowledge-base.ts:39（vectors.json 直拼，与 vector-store:845 成对）；src/shared/project-paths.ts:13/:16（渲染层集中常量，应先收敛）；update-controller.ts:135 是 rmSync **整目录删除**（卸载清数据，须双删）；vector-store 实际路径 electron\vector-store.ts（无 services/ 子目录）。**关键语义发现**：直开点全是「静默跳过」（existsSync → return null）——只改字面量 + 迁移仅挂 database.ts，旧 .vela 兜底存在时**静默漏读**（活动/用量/摘要显示为空但无报错）；且跨项目聚合（activity/usage 扫 B/C 项目）在用户未打开 B/C 时不会触发「打开项目时迁移」→ B/C 统计立即变空直到逐个打开。
**修订（已落地）**：getProjectVelaDir 内做**惰性迁移**（检测旧 .vela → rename），全部直开点统一走该 helper；V1 同时把 mcp 两处硬编码收敛到 VELA_HOME。

**🔴 P0-7｜安全回归：目录排除名单**：intent-router.ts:208（目录排除 .vela）与 write-file.tool.ts:52（forbiddenPrefixes = ['.vela/', '.git/', 'node_modules/']）若只替换新名，迁移失败回退旧目录时 AI 工具可写 `.vela/`（写保护失守）。
**修订（已落地）**：排除名单新旧双保留（`['.novelforge/', '.vela/', '.git/', 'node_modules/']`；router 排除列表加 .novelforge 且保留 .vela）；intent-router.test.ts:65-66 mock 与 :81 断言同步。

**🟡 重要（全部已落地）**：ChapterCreationDialog.tsx:34（计划「Dialog.tsx:34」文件名错，核验确认全 dialogs 目录仅此文件含 .vela）；index.html 启动屏 6 类 + 4 keyframes（`.vela-editor-content` 在 novel-editor.css:4-34 而非 index.html——前提修正，白名单纪律已补）；CHANGELOG 2 处目录提及（:40/:141，:191 velaAPI 子串不动）；README/README.en.md 零提及（V3 该分支空操作删除）；docs 12 文件 68 处中 6 个历史任务记录文件**不改**（明确决策）；locale-data 5 条用户可见键值（4 键三语）清单已入 V3 Step 2；「59 文件」量级修正（源码字面量实测 17 处 + 1 测试文件，59 是全口径含注释/文档/i18n）；database.ts 存在 user_version schema 迁移但**无目录改名迁移**（表述修正，V2 新建的正是后者）。
