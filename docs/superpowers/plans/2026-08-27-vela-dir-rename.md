# `.vela` → `.novelforge` 目录改名实施计划（档 1：只改目录名）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将用户可见的 `.vela/` 目录改名 `.novelforge/`（项目内 + 全局 `~/.vela` → `~/.novelforge`），带一次性迁移；`vela.db` 文件名、`vela://` 协议、`velaAPI`、CSS 类名**保持不变**。

**Architecture:** ① 路径常量收敛（散落 59 文件的目录字面量 → 常量模块）② 全局迁移（应用启动早期检测 `~/.vela` → rename）③ 项目迁移（打开项目时检测 `{project}/.vela` → rename，数据库打开前）④ 迁移失败回退双路径读取。

**Tech Stack:** TypeScript + Node fs（主进程）+ vitest

**Spec:** 无 spec 文档（本次评估产出，档 1 裁决）；关联约束：`CLAUDE.md` 品牌约束需同步更新（「技术标识符 velaAPI, vela://, .vela/ 保留不改」→ .vela 目录已改，仅 velaAPI/vela:// 保留）

## Global Constraints

- ESLint strict（--max-warnings 0）、TypeScript strict（noUnusedLocals/Parameters）
- **白名单替换纪律**：只替换「目录路径」语义的 `.vela` 字面量；`vela.db`（文件名）、`vela://`（协议）、`velaAPI`（API 名）、`.vela-editor-content`（CSS 类）、`VELA_HOME` 常量名（标识符本身可留，值改）**一律不动**
- 迁移失败必须回退（旧路径可读），**绝不阻塞启动/打开项目**
- 提交规范：`feat:`/`fix:`/`docs:` 前缀、一个提交一件事、`git commit -F - <<'EOF'` 消息文件
- 执行窗口建议：改动面 59 文件，与 A/B/加固计划无文件重叠（那些是 agent 层）——可独立窗口执行，建议排在零成本小改之后

---

### Task V1: 路径常量收敛 + 目录字面量替换

**Files:**
- Modify: `electron/utils/config-utils.ts`（VELA_HOME 值 + 新增 `PROJECT_VELA_DIR` 常量）
- Modify: `electron/database.ts`（:29 路径拼装改用常量）
- Modify: 全库目录语义 `.vela` 字面量（约 55 文件 src/electron，**白名单纪律**）
- Test: 全量回归（替换不改变行为——除 V2/V3 迁移外零行为变化）

**Interfaces:**
- Produces: `PROJECT_VELA_DIR = '.novelforge'`（config-utils 导出）；`VELA_HOME` 值改为 `~/.novelforge`
- Consumes: 无

- [ ] **Step 1: 写分类清单（防误伤）**

  全库 grep `.vela`，逐处分类：
  - **目录语义（替换）**：`'.vela'` 字符串路径、`~/.vela/...` 路径拼装、注释/文档中的目录描述（`{project}/.vela/vela.db` 描述等）
  - **保留（不动）**：`vela.db`、`vela://`、`velaAPI`、`VELA_HOME` 标识符（仅值改）、`.vela-editor-content`、`vela_` 前缀（如 DB 表/字段 vela 前缀，若存在）
  - 清单写入任务报告（替换数/保留数），作为评审输入

- [ ] **Step 2: 常量收敛（先做，替换基础）**

```ts
// electron/utils/config-utils.ts
export const VELA_HOME = path.join(os.homedir(), '.novelforge')  // 值改：~/.vela → ~/.novelforge
/** 项目内运行时数据目录名（用户可见，品牌一致） */
export const PROJECT_VELA_DIR = '.novelforge'
```

```ts
// electron/database.ts:29
import { PROJECT_VELA_DIR } from './utils/config-utils'
const dbPath = path.join(projectPath, PROJECT_VELA_DIR, 'vela.db')
```

- [ ] **Step 3: 批量替换目录字面量（白名单纪律）**

  对 Step 1 分类清单中的「目录语义」项逐一替换：
  - `'.vela'` → `'.novelforge'`（含 `'.vela/'` 前缀拼接）
  - `~/.vela` → `~/.novelforge`（注释/文档中）
  - `{project}/.vela` → `{project}/.novelforge`（注释中）
  - 渲染层（如 Dialog.tsx:34 `'.vela/chapter_creation_log.json'`）→ `'.novelforge/chapter_creation_log.json'`——**渲染层必须同步，否则创建日志路径错**
  - 测试文件 mock 路径同步
  - `vela.db`/`vela://`/`velaAPI`/`VELA_HOME`（标识符）保留

  ⚠️ 不用全局 find-replace——用白名单清单逐处核对；V2/V3 的迁移逻辑依赖「新目录为主、旧目录兜底」，替换不完整会导致迁移后路径错位。

- [ ] **Step 4: 全量回归（零行为变化验证）**

Run: `pnpm run test && pnpm run typecheck && pnpm run lint`
Expected: 全绿（无迁移逻辑时旧目录仍不存在 → 所有路径用 .novelforge，测试 mock 已同步）。

- [ ] **Step 5: Commit**

```bash
git add -A  # 替换面大，逐文件 add 或 -A 后 review
git commit -F - <<'EOF'
feat: .vela 目录改名 .novelforge（常量收敛 + 目录字面量替换，vela.db/vela:///velaAPI 保留）
EOF
```

---

### Task V2: 全局迁移（~/.vela → ~/.novelforge）

**Files:**
- Modify: `electron/main.ts` 或 `electron/utils/config-utils.ts`（迁移函数 + 启动调用）
- Test: `electron/utils/config-utils.test.ts`（新建）或迁移函数独立测试

**Interfaces:**
- Produces: `migrateLegacyDirs(): Promise<void>`（全局 + 项目目录迁移入口）；`getProjectVelaDir(projectPath): string`（双路径兜底 helper）
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
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm run test:watch electron/utils/config-utils.test.ts`
Expected: FAIL（迁移函数不存在）。

- [ ] **Step 3: 实现**

```ts
// electron/utils/config-utils.ts 追加
/** 全局目录迁移：~/.vela → ~/.novelforge（启动早期调用；失败静默，旧路径兜底） */
export async function migrateLegacyDirs(): Promise<void> {
  const oldHome = path.join(os.homedir(), '.vela')
  const newHome = path.join(os.homedir(), '.novelforge')
  if (fs.existsSync(oldHome) && !fs.existsSync(newHome)) {
    try {
      fs.renameSync(oldHome, newHome)
    } catch (e) {
      console.error('[NovelForge] 迁移 ~/.vela 失败，保留旧目录读取：', e)
    }
  }
}

/** 项目库目录：优先 .novelforge，迁移失败/旧项目回退 .vela（双路径兜底） */
export function getProjectVelaDir(projectPath: string): string {
  const newDir = path.join(projectPath, PROJECT_VELA_DIR)
  return fs.existsSync(newDir) ? newDir : path.join(projectPath, '.vela')
}
```

  `electron/main.ts` 启动早期（任何 VELA_HOME 读取前）调用 `await migrateLegacyDirs()`。

- [ ] **Step 4: 运行确认通过 + 全量回归**

Run: `pnpm run test && pnpm run typecheck && pnpm run lint`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts electron/utils/config-utils.ts electron/utils/config-utils.test.ts
git commit -F - <<'EOF'
feat: 全局 ~/.vela → ~/.novelforge 迁移（启动检测 rename，失败回退旧路径读取）
EOF
```

---

### Task V3: 项目迁移（{project}/.vela → .novelforge）

**Files:**
- Modify: `electron/database.ts`（打开项目库前迁移 + 双路径兜底）
- Modify: `electron/controllers/project-controller.ts`（如项目打开入口在别处，同步迁移点）
- Test: `electron/database.test.ts`（或迁移逻辑测试）

**Interfaces:**
- Consumes: `migrateLegacyDirs`（V2 扩展为同时处理项目目录）或独立 `migrateProjectVelaDir(projectPath)`；`getProjectVelaDir`（V2）
- Produces: 项目打开流程：旧 `.vela` 检测 → rename → 新路径打开 DB

**关键时序**：迁移必须在**数据库打开前**（rename 前无句柄占用）；若迁移失败 → `getProjectVelaDir` 返回旧路径继续读（数据不丢）。

- [ ] **Step 1: 写失败测试**

```ts
describe('项目目录迁移', () => {
  it('{project}/.vela 存在且 .novelforge 不存在 → 打开前 rename', async () => {
    // mock 临时项目目录：.vela/vela.db 存在
    // 调用项目打开流程（或 migrateProjectVelaDir）
    // 断言：.vela → .novelforge rename；database.ts 用 .novelforge/vela.db 打开
  })

  it('rename 失败 → getProjectVelaDir 回退旧路径，DB 正常打开', async () => {
    // mock rename throw → 断言数据库从 .vela/vela.db 打开（数据不丢）
  })

  it('新项目（无任何目录）→ 用 .novelforge 创建', async () => {
    // 断言 database.ts 创建 .novelforge/vela.db
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm run test:watch electron/database.test.ts`
Expected: FAIL（无迁移逻辑）。

- [ ] **Step 3: 实现**

```ts
// database.ts 打开项目库前：
import { getProjectVelaDir, PROJECT_VELA_DIR } from './utils/config-utils'

/** 项目目录迁移：{project}/.vela → .novelforge（DB 打开前调用；失败静默，getProjectVelaDir 兜底） */
export function migrateProjectVelaDir(projectPath: string): void {
  const oldDir = path.join(projectPath, '.vela')
  const newDir = path.join(projectPath, PROJECT_VELA_DIR)
  if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
    try {
      fs.renameSync(oldDir, newDir)
    } catch (e) {
      console.error(`[NovelForge] 迁移 ${projectPath}/.vela 失败，保留旧目录读取：`, e)
    }
  }
}

// 打开流程：migrateProjectVelaDir(projectPath) → const velaDir = getProjectVelaDir(projectPath) → path.join(velaDir, 'vela.db')
```

  项目打开入口（project-controller.ts 的 open-project 或等价）在 database.open 前调用。渲染层读取项目 `.novelforge` 路径的通道（如 chapter_creation_log）已在 V1 同步替换——但**旧项目迁移后**渲染层读新路径，一致 ✓；迁移失败场景渲染层读新路径会 miss——v1 接受（日志类非关键数据），报告注明。

- [ ] **Step 4: 运行确认通过 + 全量回归**

Run: `pnpm run test && pnpm run typecheck && pnpm run lint`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add electron/database.ts electron/controllers/project-controller.ts electron/database.test.ts
git commit -F - <<'EOF'
feat: 项目 .vela → .novelforge 迁移（DB 打开前 rename，失败回退旧路径读取）
EOF
```

---

### Task V4: 文档与约束更新

**Files:**
- Modify: `CLAUDE.md`（品牌约束：`.vela/` 已改 `.novelforge/`，velaAPI/vela:// 保留）
- Modify: `README.md` / `README.en.md`（若提及 .vela 路径）
- Modify: `docs/` 相关文档（数据库架构章节「项目数据库位于 {projectPath}/.vela/vela.db」等）
- Modify: `src/shared/locale-data.ts`（若任何用户可见 i18n 文本含 .vela——grep 确认后处理）

- [ ] **Step 1: 核查并更新文档**

grep `.vela` 于 CLAUDE.md/README/docs，目录语义处更新为 `.novelforge`；`vela.db`/`vela://`/`velaAPI` 描述保留（技术标识符说明同步更新：`.novelforge/vela.db`、`vela://draft/{id}` 不变）。

CLAUDE.md 品牌约束改为：

```
3. **品牌标识**：用户可见用 NovelForge；目录名 `.novelforge/`；技术标识符（velaAPI, vela://, vela.db）保留不改
```

- [ ] **Step 2: 用户可见文本核查**

grep i18n 键值中含 `.vela` 的（设置页路径展示等）→ 更新为 `.novelforge` 或改键值（三语同步）。

- [ ] **Step 3: 全量回归 + Commit**

Run: `pnpm run test && pnpm run typecheck && pnpm run lint`
Expected: 全绿。

```bash
git add CLAUDE.md README.md README.en.md docs/ src/shared/locale-data.ts
git commit -F - <<'EOF'
docs: .vela → .novelforge 文档与品牌约束更新（vela.db/vela:///velaAPI 保留说明）
EOF
```

---

## Self-Review 记录

**Spec 覆盖**：档 1 裁决四项——项目内目录改名（V1/V3）、全局改名（V1/V2）、vela.db 保留（V1 白名单）、vela:///velaAPI 保留（V1 白名单 + V4 文档说明）。

**占位符扫描**：无 TBD；「约 55 文件」「如存在」「grep 确认后」为清单式指示（Step 1 分类清单是强制产出，非占位）。

**类型一致性**：`PROJECT_VELA_DIR`/`VELA_HOME` 在 V1 定义、V2/V3 消费一致；`migrateLegacyDirs`/`getProjectVelaDir`/`migrateProjectVelaDir` 签名在 V2/V3 一致。

**风险记录**：迁移失败回退双路径（数据不丢）；rename 前无句柄（DB 打开前）；渲染层日志路径迁移失败场景 miss（非关键数据，已注明）；`VELA_HOME` 环境变量此前无覆盖机制（硬编码），本次不新增。
