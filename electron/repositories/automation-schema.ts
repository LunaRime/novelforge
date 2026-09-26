/**
 * 写作自动化三张表的 DDL —— **单一真相源**
 *
 * 独立成零依赖文件，供三处共用：
 * - `electron/database.ts` 的全新建表块
 * - `electron/database.ts` 的增量迁移（v18）
 * - `electron/repositories/automation-repository.ts` 与其测试
 *
 * ⚠️ 刻意不放 repository 里：repository 依赖 `../database`，若 database 反过来
 * import repository 的 DDL 就形成循环依赖。
 *
 * 全部为 `CREATE ... IF NOT EXISTS`，迁移可重入（db-migration-standard）。
 */
export const AUTOMATION_SCHEMA_SQL = `
  -- 自动化任务定义（项目级）
  CREATE TABLE IF NOT EXISTS automations (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    enabled               INTEGER NOT NULL DEFAULT 1,
    target_type           TEXT NOT NULL CHECK (target_type IN ('workflow', 'agent')),
    target_ref            TEXT NOT NULL,
    session_strategy      TEXT NOT NULL DEFAULT 'per_run' CHECK (session_strategy IN ('per_run', 'per_task')),
    session_id            TEXT,
    triggers              TEXT NOT NULL DEFAULT '[]',
    default_action_policy TEXT NOT NULL DEFAULT 'confirm'
                          CHECK (default_action_policy IN ('auto_run', 'confirm', 'notify_only')),
    trigger_state         TEXT NOT NULL DEFAULT '{}',
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL
  );

  -- 收件箱（产出待审 / 仅通知）
  CREATE TABLE IF NOT EXISTS automation_inbox (
    id            TEXT PRIMARY KEY,
    automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    trigger_id    TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'confirmed', 'dismissed', 'auto_run')),
    action_policy TEXT NOT NULL CHECK (action_policy IN ('auto_run', 'confirm', 'notify_only')),
    title         TEXT NOT NULL,
    summary       TEXT NOT NULL,
    evidence      TEXT NOT NULL DEFAULT '[]',
    fingerprint   TEXT NOT NULL,
    run_id        TEXT,
    action_error  TEXT,
    created_at    INTEGER NOT NULL,
    read_at       INTEGER,
    handled_at    INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_automation_inbox_status
    ON automation_inbox(status, created_at DESC);
  -- 同一触发指纹只入箱一次（DB 层兜底，防调度竞态产生重复条目）
  CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_inbox_fingerprint
    ON automation_inbox(automation_id, fingerprint);

  -- 运行记录
  CREATE TABLE IF NOT EXISTS automation_runs (
    id             TEXT PRIMARY KEY,
    automation_id  TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    trigger_type   TEXT NOT NULL CHECK (trigger_type IN ('manual', 'schedule', 'chapter_batch', 'semantic')),
    target_type    TEXT NOT NULL CHECK (target_type IN ('workflow', 'agent')),
    ref_id         TEXT,
    status         TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed', 'aborted')),
    summary        TEXT,
    error          TEXT,
    evidence       TEXT NOT NULL DEFAULT '[]',
    started_at     INTEGER NOT NULL,
    finished_at    INTEGER,
    recovery_state TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_automation_runs_task
    ON automation_runs(automation_id, started_at DESC);
`
