# NovelForge 开发者控制台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 NovelForge 增加一个仅开发态可用的开发者控制台：一键启动隔离实例、观察 IPC 调用、只读浏览项目数据库、查看主进程日志与性能指标，让 AI/开发者能在不污染真实项目的前提下做真机测试。

**Architecture:** 主进程新增 `dev-controller` 的只读观测通道和开发态门禁；`guardedHandle` 增加轻量 IPC 指标环；数据库检查器用独立只读 `better-sqlite3` 连接；隔离实例由独立 CLI `scripts/dev-instance.mjs` 管理（临时 HOME + 独立项目 + 独立 CDP 端口 + manifest），渲染层只负责展示与调用。所有新通道统一登记到 `ipc-channels.ts` / `ipc-policy.ts`。

**Tech Stack:** Electron 41 / React 19 / TypeScript 6 / better-sqlite3 / Node 24（Electron 内置）/ Vitest。

**Spec:** 本文件（范围来自 2026-10-22 用户需求与真机冒烟经验）。

## Global Constraints

- 仅开发态可用：主进程 `!app.isPackaged` 或配置 `devMode.consoleEnabled === true` 或环境变量 `NOVELFORGE_DEVTOOLS=1`；打包版默认关闭。
- 数据库检查器必须使用**只读连接**，只允许 `SELECT` / `WITH` / `PRAGMA`，禁止多语句与任何写操作。
- 所有 IPC 参数/错误在展示前脱敏（`sk-*`、`Bearer`、`apiKey`、`Authorization`、`token`、`password`）。
- 隔离实例只启动 NovelForge 自己的 Electron 可执行文件，固定参数；不接受任意 shell 命令。
- 不新增事件通道；新增 invoke 通道必须同时更新 `ipc-channels.ts`、`ipc-policy.ts`、`ipc-channel-parity.test.ts` 的数量快照。
- 所有用户可见文本走 `t()`，三语齐全；颜色只用 `var(--color-*)`。
- `.superpowers/` 与 `~/.novelforge/dev-instances/` 是运行数据，不进入 git。

## Review Focus

- **密钥泄漏**：IPC metrics、错误详情、实例 manifest/log 中不得出现 API key、Authorization 头、凭据文件内容。
- **SQL 写穿透**：`dev:db-query` 必须拒绝 `INSERT/UPDATE/DELETE/DROP/ALTER/ATTACH/DETACH/VACUUM/PRAGMA assignment`，且连接本身只读。
- **实例清理**：`stop`/`clean` 必须杀进程组并确认端口释放；不能误杀主实例（端口/ID 绑定）。
- **开发态门禁**：打包版未显式开启时，所有 `dev:console-*` / `dev:instance-*` / `dev:db-*` 返回 disabled，UI 不得显示控制台入口。
- **指标开销**：metrics 关闭时 `guardedHandle` 只多一次布尔判断；环上限 500 条，避免长跑内存增长。

---

### Task 1: 隔离实例 CLI

**Files:**
- Create: `scripts/dev-instance.mjs`
- Create: `scripts/dev-instance-lib.mjs`
- Test: `scripts/dev-instance-lib.test.ts`

**Interfaces:**
- Produces（`dev-instance-lib.mjs`）:
  ```js
  export function parseArgs(argv): { command: string, options: Record<string, unknown>, positional: string[] }
  export function buildInstanceId(projectPath: string, now?: Date): string
  export function sanitizeName(name: string): string
  export function isPidAlive(pid: number): boolean
  export function readManifests(rootDir: string): Array<Record<string, unknown>>
  export function pickFreePort(startPort: number): Promise<number>
  ```
- CLI commands: `start | list | stop | clean | logs | eval | shot | console | dir`
- Manifest shape:
  ```json
  {
    "id": "dev-20261022-131500-9223",
    "pid": 12345,
    "pgid": 12345,
    "port": 9223,
    "project": "/tmp/nf-dev-...",
    "home": "/home/user/.novelforge/dev-instances/<id>/home",
    "log": "/home/user/.novelforge/dev-instances/<id>/instance.log",
    "startedAt": 1790000000000,
    "status": "running"
  }
  ```

- [ ] **Step 1: 写纯函数测试**

```ts
// scripts/dev-instance-lib.test.ts
import { describe, it, expect } from 'vitest'
import { parseArgs, buildInstanceId, sanitizeName } from './dev-instance-lib.mjs'

describe('dev-instance-lib', () => {
  it('解析 start 参数', () => {
    const r = parseArgs(['start', '--project', '/tmp/p', '--port', '9333', '--json'])
    expect(r.command).toBe('start')
    expect(r.options).toMatchObject({ project: '/tmp/p', port: 9333, json: true })
  })

  it('实例 ID 含端口且可读', () => {
    const id = buildInstanceId('/tmp/my-project', new Date('2026-10-22T13:15:00'))
    expect(id).toMatch(/^dev-20261022-131500-\d+$/)
    expect(id.length).toBeLessThan(80)
  })

  it('名称清洗只保留安全字符', () => {
    expect(sanitizeName('My Novel / 测试')).toMatch(/^[a-z0-9-]+$/)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run scripts/dev-instance-lib.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 实现纯函数库**

`parseArgs` 支持 `--key value`、`--key=value`、布尔 flag；`--port` 转 number；未知 flag 收进 options。`buildInstanceId` 用本地时间 `YYYYMMDD-HHmmss` + 端口占位（start 时替换）。`sanitizeName` 小写、空白→`-`、去非 `[a-z0-9-]`、截断 40。`isPidAlive` 用 `process.kill(pid, 0)`；`readManifests` 读 `manifest.json` 并容错；`pickFreePort` 用 `net.createServer().listen(port,'127.0.0.1')` 探测，占用则 +1，最多 100 次。

- [ ] **Step 4: 实现 CLI**

`start`：
1. 运行目录 `~/.novelforge/dev-instances/<id>/`（`os.homedir()`）。
2. 复制 `~/.novelforge/{config.json,models.json,credentials.json,prompts/}` 到 `<runDir>/home/.novelforge/`；`config.json` 里 `recentProjects=[]`；**不复制** `vela.db`、`lancedb`、`logs`、`memory`、`skills`。
3. 项目：`--project` 存在则用之；否则创建 `<runDir>/project`。
4. 端口：`--port` 或 `pickFreePort(9223)`。
5. 启动：`electronBin = <repoRoot>/node_modules/.bin/electron`（`--electron <path>` 可覆盖）；args `['.', '--no-sandbox', '--remote-debugging-port=<port>', '--project=<project>']`；env `HOME=<home>`, `XDG_CONFIG_HOME=<home>/.config`, `ELECTRON_ENABLE_LOGGING=1`, `NOVELFORGE_DEVTOOLS=1`；`detached: true`, `stdio: ['ignore', logFd, logFd]`, `unref()`。
6. 等待 `http://127.0.0.1:<port>/json/version` 最多 30s；失败则杀进程并抛错。
7. 写 `manifest.json`；`--json` 时只打印 JSON。

`list`：扫描 manifest，`isPidAlive(pid)` 计算 `alive`，按 `startedAt` 降序。
`stop <id>`：读 manifest，`process.kill(-pgid, 'SIGTERM')`，轮询 5s，必要时 `SIGKILL`；更新 `status:'stopped'`。
`clean <id>`：stop + `fs.rmSync(runDir,{recursive:true,force:true})`。
`logs <id> [n]`：读 manifest.log 尾部 n 行（默认 100）。
`dir <id>`：打印 manifest 路径与项目/home/log。
`eval/shot/console`：用 `WebSocket` 连接 `/json` 的第一个 page target，`Runtime.evaluate` / `Page.captureScreenshot` / 控制台收集；复用 `dev-instance-lib.mjs` 的 `cdpPage` 辅助。

- [ ] **Step 5: 真机验证**

```bash
node scripts/dev-instance.mjs start --project /tmp/nf-dev-smoke --json
node scripts/dev-instance.mjs list --json
node scripts/dev-instance.mjs eval <id> 'document.title'
node scripts/dev-instance.mjs shot <id> /tmp/nf-dev-smoke.png
node scripts/dev-instance.mjs stop <id>
```

Expected：实例启动、CDP 返回标题、截图非空、stop 后 `list` 显示 not alive。

- [ ] **Step 6: 提交**

```bash
git add scripts/dev-instance.mjs scripts/dev-instance-lib.mjs scripts/dev-instance-lib.test.ts package.json
git commit -m "feat: 隔离实例 CLI（start/list/stop/eval/shot）"
```

---

### Task 2: IPC 指标与开发通道

**Files:**
- Create: `electron/dev/ipc-metrics.ts`
- Create: `electron/dev/ipc-metrics.test.ts`
- Modify: `electron/security/ipc-guard.ts`
- Modify: `electron/controllers/dev-controller.ts`
- Modify: `src/shared/ipc-channels.ts`、`src/shared/ipc-policy.ts`、`src/shared/ipc-channel-parity.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface DevIpcMetric {
    channel: string; calls: number; errors: number
    totalMs: number; lastMs: number; avgMs: number
    lastAt: number; lastError?: string
  }
  export interface DevIpcRecentCall {
    channel: string; at: number; durationMs: number; ok: boolean; error?: string
  }
  export function setIpcMetricsEnabled(enabled: boolean): void
  export function recordIpcCall(channel: string, durationMs: number, error?: unknown): void
  export function getIpcMetrics(): { metrics: DevIpcMetric[]; recent: DevIpcRecentCall[] }
  export function clearIpcMetrics(): void
  export function redactSecrets(text: string): string
  ```
- Channels:
  - `dev:ipc-set-enabled` `[enabled: boolean]` → `{ success: boolean }`
  - `dev:ipc-metrics` `[]` → `{ enabled: boolean; metrics: DevIpcMetric[]; recent: DevIpcRecentCall[] }`
  - `dev:ipc-clear` `[]` → `{ success: boolean }`

- [ ] **Step 1: 写指标模块测试**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { recordIpcCall, getIpcMetrics, clearIpcMetrics, redactSecrets, setIpcMetricsEnabled } from './ipc-metrics'

describe('ipc-metrics', () => {
  beforeEach(() => { clearIpcMetrics(); setIpcMetricsEnabled(true) })

  it('聚合调用次数/错误/耗时', () => {
    recordIpcCall('db:test', 10)
    recordIpcCall('db:test', 30, new Error('boom sk-abc123456789'))
    const m = getIpcMetrics().metrics.find(x => x.channel === 'db:test')!
    expect(m.calls).toBe(2)
    expect(m.errors).toBe(1)
    expect(m.totalMs).toBe(40)
    expect(m.lastError).toContain('sk-***')
  })

  it('recent 环上限 500', () => {
    for (let i = 0; i < 510; i++) recordIpcCall('x', 1)
    expect(getIpcMetrics().recent).toHaveLength(500)
  })

  it('关闭后不记录', () => {
    setIpcMetricsEnabled(false)
    recordIpcCall('x', 1)
    expect(getIpcMetrics().metrics).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run electron/dev/ipc-metrics.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 实现指标模块**

`redactSecrets`：替换 `sk-[A-Za-z0-9._-]{8,}`、`Bearer\s+\S+`、`(apiKey|token|password|authorization)\s*[:=]\s*\S+` 为 `***`；错误文本截断 300 字符。`recent` 用数组 push + shift（500）；聚合用 Map。`setIpcMetricsEnabled` 默认值为 `process.env.NOVELFORGE_DEVTOOLS === '1'`。排除 `dev:ipc-` 自身与 `dev:ipc-metrics` 记录，避免自增噪声。

- [ ] **Step 4: 接入 guardedHandle**

`guardedHandle` 的回调改为 `async`；在信任校验后：
```ts
if (!isIpcMetricsEnabled()) return handler(event, ...(args as never[]))
const started = performance.now()
try {
  const result = await handler(event, ...(args as never[]))
  recordIpcCall(channel, performance.now() - started)
  return result
} catch (e) {
  recordIpcCall(channel, performance.now() - started, e)
  throw e
}
```
`performance` 从 `node:perf_hooks` 引入（或全局 `performance`）。现有 ipc-guard 测试需保持通过。

- [ ] **Step 5: 新增通道与控制器**

`DevChannels` 增加三个通道及类型；`AllInvokeChannels` 自动合并。`IPC_CHANNEL_POLICY` 增加：
```ts
'dev:ipc-set-enabled': { authority: 'dev-bridge' },
'dev:ipc-metrics': { authority: 'dev-bridge' },
'dev:ipc-clear': { authority: 'dev-bridge' },
```
`dev-controller.ts` 增加 `guardedHandle`；门禁 `assertDevConsoleEnabled()`（`app.isPackaged === false` 或配置 `devMode.consoleEnabled` 或 env）。更新 parity 测试的通道数量快照（+3）。

- [ ] **Step 6: 运行测试 + 类型检查**

Run: `pnpm exec vitest run electron/dev/ipc-metrics.test.ts src/shared/ipc-channel-parity.test.ts && pnpm run typecheck`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add electron/dev/ipc-metrics.ts electron/dev/ipc-metrics.test.ts electron/security/ipc-guard.ts electron/controllers/dev-controller.ts src/shared/ipc-channels.ts src/shared/ipc-policy.ts src/shared/ipc-channel-parity.test.ts
git commit -m "feat: IPC 调用指标与开发通道"
```

---

### Task 3: 开发者控制台外壳与实例页

**Files:**
- Create: `src/components/dev/DevConsoleDialog.tsx`
- Create: `src/components/dev/DevInstancesTab.tsx`
- Modify: `src/components/settings/DeveloperModeSection.tsx`（打开控制台按钮 + 开关）
- Modify: `src/stores/layout-store.ts`（`devConsoleOpen`）
- Modify: `src/App.tsx`（挂载 Dialog）
- Modify: `src/shared/ipc-channels.ts`（实例通道类型）
- Create: `electron/dev/instance-controller.ts`（`dev:instance-*`）
- Modify: `electron/controllers/dev-controller.ts`（注册 instance controller）
- Modify: `src/shared/locale-data/settings.ts`（三语）
- Test: `electron/dev/instance-controller.test.ts`（参数校验/门禁）

**Interfaces:**
- Channels:
  ```ts
  'dev:console-status': { args: []; return: { enabled: boolean; reason?: string } }
  'dev:instance-list': { args: []; return: DevInstanceInfo[] }
  'dev:instance-start': { args: [input: { project?: string; port?: number; name?: string }]; return: { success: boolean; instance?: DevInstanceInfo; error?: string } }
  'dev:instance-stop': { args: [id: string]; return: { success: boolean; error?: string } }
  'dev:instance-clean': { args: [id: string]; return: { success: boolean; error?: string } }
  ```
- `DevInstanceInfo` 同 Task 1 manifest + `alive: boolean`。

- [ ] **Step 1: 写门禁/参数测试**

测试 `assertDevConsoleEnabled` 纯函数（传入 `{isPackaged, configEnabled, envFlag}`）返回 enabled/reason；测试实例 start 参数拒绝非法端口（<1024 或 >65535）与不存在的 project。用 `vi.mock('electron')` 提供 `app.isPackaged`。

- [ ] **Step 2: 实现实例控制器**

`instance-controller.ts` 通过 `execFile` 调用 CLI：
```ts
const script = path.join(app.getAppPath(), 'scripts/dev-instance.mjs')
execFile(process.execPath, [script, 'start', '--json', ...], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  timeout: 45_000,
})
```
解析 stdout JSON；`list` 直接读 manifest（复用 CLI 的 `list --json`）；`stop/clean` 同理。所有输出经过 `redactSecrets`。`app.getAppPath()` 在打包版需包含脚本——Task 6 把 `scripts/dev-instance*.mjs` 加入 `electron-builder.json5` files。

- [ ] **Step 3: 实现控制台 Dialog**

`DevConsoleDialog`：
- Props `{ open, onClose }`，`DialogContent` 宽 1100 / 高 80vh；顶部标题 + 关闭；`SegmentedControl` 或 button tabs：实例 / IPC / 数据库 / 日志 / 性能。
- 打开时调用 `dev:console-status`；disabled 时显示提示（需在设置启用或 `--devtools` 启动）。
- `DevInstancesTab`：`dev:instance-list`；按钮 启动（表单：项目路径可选、端口可选）/ 停止 / 清理 / 复制命令；5s 轮询。
- 入口：`DeveloperModeSection` 增加 `consoleEnabled` 开关（保存到 `config.devMode.consoleEnabled`）+「打开开发者控制台」按钮；`layout-store` 增加 `devConsoleOpen`；`App.tsx` 挂载。
- i18n：`dev.consoleTitle`、`dev.consoleDisabled`、`dev.consoleInstances`、`dev.consoleIpc`、`dev.consoleDb`、`dev.consoleLogs`、`dev.consolePerf`、`dev.instanceStart`、`dev.instanceStop`、`dev.instanceClean`、`dev.instanceProject`、`dev.instancePort`、`dev.instanceCopyCommand`、`dev.instanceEmpty`、`dev.instanceStarted`、`dev.instanceStopped`、`dev.instanceFailed`、`dev.consoleEnabled`。

- [ ] **Step 4: 运行测试 + 类型检查 + lint**

Run: `pnpm exec vitest run electron/dev/instance-controller.test.ts && pnpm run typecheck && pnpm run lint`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/components/dev/DevConsoleDialog.tsx src/components/dev/DevInstancesTab.tsx src/components/settings/DeveloperModeSection.tsx src/stores/layout-store.ts src/App.tsx electron/dev/instance-controller.ts electron/controllers/dev-controller.ts src/shared/ipc-channels.ts src/shared/locale-data/settings.ts electron/dev/instance-controller.test.ts
git commit -m "feat: 开发者控制台外壳与隔离实例页"
```

---

### Task 4: 数据库只读检查器

**Files:**
- Create: `electron/dev/sql-guard.ts`
- Test: `electron/dev/sql-guard.test.ts`
- Create: `electron/dev/db-inspector.ts`
- Modify: `electron/controllers/dev-controller.ts`
- Modify: `src/shared/ipc-channels.ts`、`src/shared/ipc-policy.ts`、`src/shared/ipc-channel-parity.test.ts`
- Create: `src/components/dev/DevDatabaseTab.tsx`

**Interfaces:**
- `isReadOnlySql(sql: string): { ok: true; sql: string } | { ok: false; reason: string }`
- Channels:
  ```ts
  'dev:db-tables': { args: []; return: DevDbTable[] }
  'dev:db-schema': { args: [table: string]; return: DevDbSchema | null }
  'dev:db-query': { args: [sql: string, limit?: number]; return: DevDbQueryResult }
  ```
- Types:
  ```ts
  export interface DevDbTable { name: string; rows: number }
  export interface DevDbSchema { name: string; columns: Array<{ name: string; type: string; notnull: number; pk: number; dfltValue: string | null }>; indexes: Array<{ name: string; unique: number; columns: string[] }> }
  export interface DevDbQueryResult { success: boolean; columns?: string[]; rows?: unknown[][]; rowCount?: number; truncated?: boolean; error?: string }
  ```

- [ ] **Step 1: 写 SQL 守卫测试**

```ts
import { describe, it, expect } from 'vitest'
import { isReadOnlySql } from './sql-guard'

describe('isReadOnlySql', () => {
  it('允许 SELECT / WITH / PRAGMA table_info', () => {
    expect(isReadOnlySql('SELECT * FROM drafts').ok).toBe(true)
    expect(isReadOnlySql('WITH x AS (SELECT 1) SELECT * FROM x').ok).toBe(true)
    expect(isReadOnlySql('PRAGMA table_info(drafts)').ok).toBe(true)
  })

  it.each([
    'DELETE FROM drafts',
    'UPDATE drafts SET version=2',
    'INSERT INTO drafts VALUES (1)',
    'DROP TABLE drafts',
    'ALTER TABLE drafts ADD COLUMN x TEXT',
    'ATTACH DATABASE "x" AS y',
    'PRAGMA writable_schema=ON',
    'SELECT 1; DELETE FROM drafts',
  ])('拒绝 %s', (sql) => {
    expect(isReadOnlySql(sql).ok).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run electron/dev/sql-guard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 实现 sql-guard**

只允许首关键字 `SELECT|WITH|PRAGMA`；拒绝分号（除末尾单个）；拒绝写/DDL/ATTACH/VACUUM/REINDEX/PRAGMA 赋值；`PRAGMA` 只允许 `table_info|index_list|index_info|foreign_key_list|database_list|user_version`。返回 trim 后的 SQL。

- [ ] **Step 4: 实现 db-inspector**

`db-inspector.ts`：
- `getProjectDbPath()`：`getCurrentProjectPath()` → `.novelforge/vela.db`；不存在返回 null。
- `listTables()`：`sqlite_master` + `COUNT(*)`，最多 200 表。
- `getSchema(table)`：先验证表存在；`PRAGMA table_info("...")`、`PRAGMA index_list`、`PRAGMA index_info`；表名引号用 `"` 双写。
- `runQuery(sql, limit)`：`isReadOnlySql`；`new Database(path, { readonly: true, fileMustExist: true })`；`stmt.iterate()` 取最多 `limit`（默认 200，最大 500）行；`stmt.columns()` 取列名；finally close。**不**打开全局 DB。
- 所有错误 `redactSecrets` 后返回。

- [ ] **Step 5: 接入控制器与 UI**

`dev-controller` 注册三个通道，`assertDevConsoleEnabled` 门禁；策略表 authority `read-project`。`DevDatabaseTab`：左表列表 + 行数，右 schema / SQL 输入（Textarea）+ 执行按钮 + 结果表格（最多 200 行，提示 truncated）。i18n 键：`dev.dbTables`、`dev.dbSchema`、`dev.dbQuery`、`dev.dbRun`、`dev.dbNoProject`、`dev.dbRows`、`dev.dbTruncated`、`dev.dbError`。

- [ ] **Step 6: 运行测试 + 类型检查 + lint**

Run: `pnpm exec vitest run electron/dev/sql-guard.test.ts src/shared/ipc-channel-parity.test.ts && pnpm run typecheck && pnpm run lint`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add electron/dev/sql-guard.ts electron/dev/sql-guard.test.ts electron/dev/db-inspector.ts src/components/dev/DevDatabaseTab.tsx electron/controllers/dev-controller.ts src/shared/ipc-channels.ts src/shared/ipc-policy.ts src/shared/ipc-channel-parity.test.ts
git commit -m "feat: 开发者控制台数据库只读检查器"
```

---

### Task 5: 日志与性能页

**Files:**
- Create: `src/components/dev/DevLogsTab.tsx`
- Create: `src/components/dev/DevPerformanceTab.tsx`
- Create: `electron/dev/perf-snapshot.ts`
- Modify: `electron/controllers/dev-controller.ts`
- Modify: `src/shared/ipc-channels.ts`、`src/shared/ipc-policy.ts`、`src/shared/ipc-channel-parity.test.ts`
- Modify: `src/components/dev/DevConsoleDialog.tsx`（接入两个 tab）

**Interfaces:**
- Channel `dev:perf` → `DevPerfSnapshot`:
  ```ts
  export interface DevPerfSnapshot {
    main: { pid: number; rss: number; heapUsed: number; heapTotal: number; external: number; uptimeSec: number; eventLoopDelayMs: number }
    app: Array<{ type: string; pid: number; cpuPercent: number; memoryKB: number }>
    db: { projectPath: string | null; size: number; walSize: number }
    logs: { dir: string; files: number; bytes: number }
  }
  ```

- [ ] **Step 1: 实现性能快照**

`perf-snapshot.ts`：`process.memoryUsage()`、`process.uptime()`、`monitorEventLoopDelay({ resolution: 20 })`（模块加载时 enable，快照时取 `histogram.mean / 1e6` 并 reset）、`app.getAppMetrics()`、项目 DB/WAL 文件 size、日志目录文件数与总字节。所有异常兜底返回 0/null。

- [ ] **Step 2: 通道与控制器**

`dev:perf` 注册到 `DevChannels`/policy（`dev-bridge`），`assertDevConsoleEnabled` 门禁。parity 快照 +1。

- [ ] **Step 3: 日志页**

`DevLogsTab`：调用 `log:list-files` 选择最新的 dev/release 文件；`log:read-file(env, name, 500)` 每 2s 刷新；级别过滤 + 搜索；复用 `Button`/`SegmentedControl`。无需新通道。

- [ ] **Step 4: 性能页**

`DevPerformanceTab`：打开时 `dev:perf` 每 2s 刷新；卡片显示 RSS/heap/event loop/DB 大小/日志大小；`app.getAppMetrics` 表格；渲染层 `performance.memory` 可选显示（类型安全用 `(performance as unknown as { memory?: ... })`）。i18n 键：`dev.perfTitle`、`dev.perfMain`、`dev.perfApp`、`dev.perfDb`、`dev.perfLogs`、`dev.perfEventLoop`、`dev.perfUptime`、`dev.perfCpu`、`dev.perfMemory`。

- [ ] **Step 5: 运行测试 + 类型检查 + lint**

Run: `pnpm run typecheck && pnpm run lint && pnpm exec vitest run src/shared/ipc-channel-parity.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/components/dev/DevLogsTab.tsx src/components/dev/DevPerformanceTab.tsx electron/dev/perf-snapshot.ts electron/controllers/dev-controller.ts src/shared/ipc-channels.ts src/shared/ipc-policy.ts src/shared/ipc-channel-parity.test.ts src/components/dev/DevConsoleDialog.tsx
git commit -m "feat: 开发者控制台日志与性能页"
```

---

### Task 5.5: Agent 运行与模型表现监控

**Files:**
- Create: `src/components/dev/DevAgentTab.tsx`
- Create: `src/components/dev/DevModelsTab.tsx`
- Modify: `src/components/dev/DevConsoleDialog.tsx`（接入两个 tab）
- Modify: `src/shared/locale-data/settings.ts`（三语）
- Test: `src/components/dev/dev-monitor-utils.test.ts`（纯聚合/格式化函数）

**Interfaces:**
- 复用现有通道，不新增后端：
  - `useAgentStore`（渲染层）：会话列表、当前会话、流式状态、消息数、工具调用/计划步骤（按 store 实际字段展示）。
  - `fs:agent-archive-list`：历史会话归档列表。
  - `db:usage-dashboard`：模型调用次数/tokens/cost/duration 聚合（已有）。
  - `db:get-llm-history`：最近 LLM 调用记录（已有；展示 model/purpose/success/error/duration/tokens/cost）。
- 纯函数（`dev-monitor-utils.ts`）：
  ```ts
  export function successRate(success: number, total: number): string
  export function formatDuration(ms: number): string
  export function aggregateRecentByModel(rows: LlmHistoryRow[]): Array<{ model: string; calls: number; errors: number; avgMs: number }>
  ```

- [ ] **Step 1: 写纯函数测试**

```ts
import { describe, it, expect } from 'vitest'
import { successRate, formatDuration, aggregateRecentByModel } from './dev-monitor-utils'

describe('dev-monitor-utils', () => {
  it('成功率与耗时格式化', () => {
    expect(successRate(9, 10)).toBe('90.0%')
    expect(successRate(0, 0)).toBe('—')
    expect(formatDuration(1234)).toBe('1.23s')
  })

  it('按模型聚合最近调用', () => {
    const rows = [
      { model: 'a', success: 1, durationMs: 100 },
      { model: 'a', success: 0, durationMs: 300 },
      { model: 'b', success: 1, durationMs: 50 },
    ]
    expect(aggregateRecentByModel(rows)).toEqual([
      { model: 'a', calls: 2, errors: 1, avgMs: 200 },
      { model: 'b', calls: 1, errors: 0, avgMs: 50 },
    ])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/components/dev/dev-monitor-utils.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 实现纯函数与 Agent 页**

`DevAgentTab`：
- 从 `useAgentStore` 读 `sessions` / `activeSessionId` / `isStreaming` / 当前消息数（按 store 字段命名，编码前先读 `src/stores/agent-store.ts` 确认）。
- 每个会话一行：标题、消息数、是否流式、最近活动时间；点击激活。
- 计划步骤：若当前会话有 plan steps，展示 done/total。
- 历史归档：`fs:agent-archive-list` 最近 20 条，只显示标题/时间/大小。
- 5s 轮询归档列表；实时会话直接订阅 store。

- [ ] **Step 4: 实现模型页**

`DevModelsTab`：
- `db:usage-dashboard`（今天/近 7 天）→ 按模型表：calls、tokens、cost、avg duration。
- `db:get-llm-history(200)` → 最近调用表：时间、model、purpose、success、duration、tokens、cost；错误列展示脱敏后的 error（若返回）。
- 失败率用 `aggregateRecentByModel`；不展示 prompt/response 正文。
- 2s/5s 轮询；打开 tab 时加载。

- [ ] **Step 5: 接入 DevConsoleDialog**

Tabs 增加 `agent` 与 `models`，默认顺序：实例 / IPC / Agent / 模型 / 数据库 / 日志 / 性能。i18n 键：`dev.consoleAgent`、`dev.consoleModels`、`dev.agentActive`、`dev.agentStreaming`、`dev.agentMessages`、`dev.agentPlan`、`dev.agentArchive`、`dev.agentEmpty`、`dev.modelsByModel`、`dev.modelsRecent`、`dev.modelsCalls`、`dev.modelsSuccess`、`dev.modelsDuration`、`dev.modelsTokens`、`dev.modelsCost`、`dev.modelsEmpty`。

- [ ] **Step 6: 运行测试 + 类型检查 + lint**

Run: `pnpm exec vitest run src/components/dev/dev-monitor-utils.test.ts && pnpm run typecheck && pnpm run lint`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/components/dev/DevAgentTab.tsx src/components/dev/DevModelsTab.tsx src/components/dev/dev-monitor-utils.ts src/components/dev/dev-monitor-utils.test.ts src/components/dev/DevConsoleDialog.tsx src/shared/locale-data/settings.ts
git commit -m "feat: 开发者控制台 Agent 与模型监控"
```

---

### Task 5.6: 控制台脱离项目与 CLI 启动

**Files:**
- Modify: `electron/main.ts`（`--dev-console` → `?devconsole=1`）
- Modify: `src/App.tsx`（启动时自动开控制台 + `window.__velaOpenDevConsole`）
- Modify: `src/components/command-palette/CommandPalette.tsx`（全局命令入口）
- Modify: `src/components/dev/DevModelsTab.tsx`（无项目时空态）
- Modify: `scripts/dev-instance.mjs`（`start --dev-console`、`console-ui <id>`）

- [ ] **Step 1: 主进程参数**

`--dev-console` 通过 URL query / `loadFile({ query })` 注入 `devconsole=1`；与 `--project` 可组合，也可单独使用（不打开项目）。

- [ ] **Step 2: 渲染端自动打开 + 远程入口**

`App.tsx` 读取 `devconsole=1` 后调用 `openDevConsole()`，并清掉 query；
挂载 `window.__velaOpenDevConsole` 供 CLI/CDP 远程打开（只负责开弹窗，后端仍走门禁）。

- [ ] **Step 3: 全局命令入口**

命令面板新增「开发者控制台」，无项目时也可用；模型页在无项目时显示「当前没有打开的项目数据库」。

- [ ] **Step 4: CLI**

`node scripts/dev-instance.mjs start --dev-console` 启动后自动打开控制台；
`node scripts/dev-instance.mjs console-ui <id>` 对已运行实例远程打开控制台。

- [ ] **Step 5: 真机验证**

```bash
node scripts/dev-instance.mjs start --dev-console --json
node scripts/dev-instance.mjs console-ui <id>
```

Expected：控制台直接打开；实例/IPC/日志/性能页可用；DB/模型页在无项目时显示空态。

---

### Task 6: 打包白名单、门禁与真机验证

**Files:**
- Modify: `electron-builder.json5`（files 增加 `scripts/dev-instance*.mjs`）
- Modify: `package.json`（`dev:instance` script）
- Modify: `README.md`（开发章节一段，说明 `node scripts/dev-instance.mjs start`）
- Maybe: `src/shared/locale-data/settings.ts`（补齐遗漏文案）

- [ ] **Step 1: 打包白名单**

`electron-builder.json5` 的 `files` 增加：
```json5
"scripts/dev-instance.mjs",
"scripts/dev-instance-lib.mjs",
```
确认 `verify-asar` 不因新增文件失败。

- [ ] **Step 2: package.json 脚本**

```json
"dev:instance": "node scripts/dev-instance.mjs"
```

- [ ] **Step 3: 真机验证（隔离实例）**

```bash
node scripts/dev-instance.mjs start --project /tmp/nf-dev-console-smoke --json
# 打开该实例，设置 → 开发者选项 → 启用开发者控制台
# 实例页：看到当前实例，stop 可用
# IPC 页：打开控制台后产生流量，metrics 出现
# 数据库页：SELECT * FROM drafts LIMIT 5 返回行；DELETE 被拒绝
# 日志页：显示最新日志并自动刷新
# 性能页：RSS/heap/event loop/DB 大小非零
node scripts/dev-instance.mjs stop <id>
```

- [ ] **Step 4: 全量门禁**

```bash
pnpm run typecheck
pnpm run lint
pnpm exec vitest run scripts/dev-instance-lib.test.ts electron/dev/ipc-metrics.test.ts electron/dev/sql-guard.test.ts electron/dev/instance-controller.test.ts src/shared/ipc-channel-parity.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add electron-builder.json5 package.json README.md
git commit -m "chore: 开发者控制台打包与使用说明"
```

---

## 非目标（下一轮）

- CDP eval/screenshot/console 的 UI 内嵌（CLI 已提供，先够用）。
- LLM 提示词/响应正文查看（避免敏感内容进入 UI；只展示调用元数据与聚合指标）。
- 自动化测试夹具生成（多卷/多角色/失败后处理）。
- 远程实例/多机调试。
- 生产版默认开放（明确不开放）。