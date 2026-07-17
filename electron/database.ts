/**
 * Vela SQLite 数据库服务 — 主进程使用
 *
 * 负责 SQLite 实例的连接、生命周期与建表。
 * 具体业务逻辑由 /repositories 提供。
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { dialog } from 'electron'
import { logger } from './utils/logger'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as typeof import('better-sqlite3')
import type BetterSqlite3 from 'better-sqlite3'

let projectDb: BetterSqlite3.Database | null = null

/** 初始化项目数据库（打开项目时调用） */
export function initProjectDatabase(projectPath: string): void {
  closeProjectDatabase()

  const dbPath = path.join(projectPath, '.vela', 'vela.db')
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })

  try {
    projectDb = new Database(dbPath)
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    const isCorrupt = errMsg.includes('SQLITE_CORRUPT') || errMsg.includes('SQLITE_NOTADB')

    logger.error('DB', `打开数据库失败: ${errMsg}`)

    if (isCorrupt) {
      // 备份损坏的数据库文件
      try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const backupPath = dbPath + `.corrupted.${timestamp}`
        fs.renameSync(dbPath, backupPath)
        logger.warn('DB', `损坏数据库已备份: ${backupPath}`)
      } catch (backupErr) {
        logger.error('DB', `备份损坏数据库失败: ${backupErr}`)
      }

      // 创建新数据库
      try {
        projectDb = new Database(dbPath)
        logger.info('DB', '已创建新数据库替代损坏文件')
      } catch (createErr) {
        logger.error('DB', `创建新数据库失败: ${createErr}`)
        throw createErr
      }

      // 通知用户
      dialog.showMessageBox({
        type: 'error',
        title: '数据库损坏',
        message: '项目数据库文件已损坏，已自动创建新数据库。',
        detail: '损坏的数据库文件已备份（文件名后缀 .corrupted）。\n\n' +
          '之前的数据可能已丢失。如果你有最近的备份，可以手动恢复。\n' +
          '备份路径：' + path.dirname(dbPath),
        buttons: ['确定'],
      }).catch(() => { /* dialog may fail in headless */ })
    } else {
      throw error // 非损坏错误，继续抛出
    }
  }

  // 数据库完整性检查
  try {
    const integrity = projectDb.pragma('integrity_check', { simple: true }) as string
    if (integrity !== 'ok') {
      logger.error('DB', `数据库完整性检查失败: ${integrity}`)
      dialog.showMessageBox({
        type: 'warning',
        title: '数据库完整性警告',
        message: '数据库完整性检查未通过，可能存在数据损坏。',
        detail: `检查结果: ${integrity}\n\n建议备份项目数据后重新打开。`,
        buttons: ['确定'],
      }).catch(() => { /* ignore */ })
    }
  } catch (checkErr) {
    logger.error('DB', `数据库完整性检查执行失败: ${checkErr}`)
  }

  projectDb.pragma('journal_mode = WAL')
  projectDb.pragma('foreign_keys = ON')

  // 创建表结构
  createTables(projectDb)
  logger.info('DB', `项目数据库已打开: ${dbPath}`)
}

/** 关闭项目数据库 */
export function closeProjectDatabase(): void {
  if (projectDb) {
    // WAL checkpoint — 将 WAL 日志合并回主数据库，防止 WAL 文件无限增长
    try { projectDb.pragma('wal_checkpoint(TRUNCATE)') } catch { /* 忽略 */ }
    projectDb.close()
    projectDb = null
  }
}

/** 获取当前数据库实例 */
export function getProjectDb(): BetterSqlite3.Database | null {
  return projectDb
}

// ===== Schema 版本管理 =====
/** 当前数据库 schema 版本号 */
const CURRENT_SCHEMA_VERSION = 5

/** 检查并执行 schema 迁移（仅在版本号低于当前版本时运行） */
function ensureSchemaVersion(db: BetterSqlite3.Database): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number
  if (currentVersion >= CURRENT_SCHEMA_VERSION) return

  logger.info('DB', `Schema 迁移: v${currentVersion} → v${CURRENT_SCHEMA_VERSION}`)
  try {
    migrateExistingTables(db)
    // 仅在全部迁移步骤成功后才递增版本号
    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`)
    logger.info('DB', `Schema 迁移完成: v${CURRENT_SCHEMA_VERSION}`)
  } catch (error) {
    logger.error('DB', `Schema 迁移失败，数据库保持 v${currentVersion} 不变: ${error}`)
    // 不递增版本号，下次启动时重新尝试迁移
    throw new Error(
      `数据库迁移 v${currentVersion}→v${CURRENT_SCHEMA_VERSION} 失败。` +
      '请检查数据库文件完整性或手动删除 .vela/vela.db 后重新打开项目。'
    )
  }
}
function createTables(db: BetterSqlite3.Database) {
  db.exec(`
    -- ============================================================
    -- 1. project_core — 项目主台账（NovelConfig + 架构四大件）
    -- ============================================================
    -- ============================================================
    -- 0. project_archives — 大文本归档（premise/worldbuilding/characters/synopsis）
    -- ============================================================
    CREATE TABLE IF NOT EXISTS project_archives (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL DEFAULT 'main',
      field_key TEXT NOT NULL,
      body TEXT DEFAULT '',
      updated_at INTEGER DEFAULT (unixepoch() * 1000)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_field ON project_archives(project_id, field_key);

    -- ============================================================
    -- 1. project_core — 项目主台账（NovelConfig + 架构四大件）
    -- ============================================================
    CREATE TABLE IF NOT EXISTS project_core (
      id TEXT PRIMARY KEY DEFAULT 'main',
      project_name TEXT NOT NULL DEFAULT '',      -- 小说工程名
      -- [基础定位]
      genre TEXT DEFAULT '',                      -- 核心流派
      sub_genre TEXT DEFAULT '',                  -- 细分流派
      target_audience TEXT DEFAULT '',            -- 目标受众
      total_chapters INTEGER DEFAULT 100,         -- 预计总章数
      words_per_chapter INTEGER DEFAULT 3000,     -- 单章基准字数
      -- [写作技法]
      plot_structure TEXT DEFAULT 'three_act',    -- 故事模型
      narrative_pov TEXT DEFAULT 'third_limited', -- 叙事视角
      writing_style TEXT DEFAULT '',              -- 文风描述
      reference_works TEXT DEFAULT '',            -- 参考作品
      global_guidance TEXT DEFAULT '',            -- 全局行文指导
      golden_finger TEXT DEFAULT '',              -- 金手指设定
      -- [架构四大件]
      premise TEXT DEFAULT '',                    -- 故事前提
      worldbuilding TEXT DEFAULT '',              -- 世界观
      characters_arch TEXT DEFAULT '',            -- 人物群像网络
      synopsis TEXT DEFAULT '',                   -- 情节总大纲
      -- [系统缓存]
      character_states TEXT DEFAULT '',           -- 全书角色动态快照
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      updated_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    -- ============================================================
    -- 2. blueprints — 章节蓝图
    -- ============================================================
    CREATE TABLE IF NOT EXISTS blueprints (
      chapter_number INTEGER PRIMARY KEY,         -- 章节序号
      title TEXT NOT NULL DEFAULT '',             -- 章节标题
      role TEXT DEFAULT '',                       -- 章节角色
      purpose TEXT DEFAULT '',                    -- 核心目的
      key_events TEXT DEFAULT '',                 -- 关键事件
      characters TEXT DEFAULT '[]',               -- 出场角色 (JSON Array)
      suspense_hook TEXT DEFAULT '',              -- 悬念钩子
      user_guidance TEXT DEFAULT '',              -- 用户预设指导
      notes TEXT DEFAULT '',                      -- 后处理提取的章节要点
      notes_updated_at TEXT DEFAULT '',           -- notes 提取时间
      sort_order INTEGER DEFAULT 0,              -- 自定义排序序号
      priority INTEGER DEFAULT 0,                -- 优先级 (0=普通, 1=高, 2=关键)
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      updated_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    -- ============================================================
    -- 3. characters — 角色卡（currentState 拍平为 cs_* 列）
    -- ============================================================
    CREATE TABLE IF NOT EXISTS characters (
      name TEXT PRIMARY KEY,                      -- 角色名
      role TEXT DEFAULT 'supporting',             -- protagonist/antagonist/supporting/minor
      gender TEXT DEFAULT '',
      age TEXT DEFAULT '',
      appearance TEXT DEFAULT '',                 -- 外貌
      personality TEXT DEFAULT '',                -- 性格
      background TEXT DEFAULT '',                 -- 背景
      abilities TEXT DEFAULT '',                  -- 能力
      motivation TEXT DEFAULT '',                 -- 动机
      relationships TEXT DEFAULT '',              -- 关系链
      arc TEXT DEFAULT '',                        -- 弧光
      notes TEXT DEFAULT '',                      -- 备忘录
      cs_location TEXT DEFAULT '',                -- 当前位置
      cs_power_level TEXT DEFAULT '',             -- 修为境界
      cs_physical_state TEXT DEFAULT '',          -- 身体状态
      cs_mental_state TEXT DEFAULT '',            -- 心理状态
      cs_key_items TEXT DEFAULT '',               -- 关键道具
      cs_recent_events TEXT DEFAULT '',           -- 最近事件
      cs_updated_at_chapter INTEGER DEFAULT 0,    -- 状态更新于第几章
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      updated_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    -- ============================================================
    -- 4. contents — 文本内容池（正文与元数据分离）
    -- ============================================================
    CREATE TABLE IF NOT EXISTS contents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      body TEXT NOT NULL DEFAULT '',              -- 正文/报告内容
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      updated_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    -- ============================================================
    -- 5. drafts — 草稿主线（finalized = 定稿）
    -- ============================================================
    CREATE TABLE IF NOT EXISTS drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_number INTEGER NOT NULL,            -- 归属章节（与 blueprints 松散关联，导入时先于蓝图创建）
      version INTEGER NOT NULL,                   -- v1, v2...
      status TEXT DEFAULT 'draft',                -- draft/revised/finalized/archived
      source TEXT DEFAULT 'write',                -- write/rewrite
      content_id INTEGER NOT NULL,                -- FK -> contents
      word_count INTEGER DEFAULT 0,               -- 字数缓存
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      updated_at INTEGER DEFAULT (unixepoch() * 1000),
      FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_drafts_chapter ON drafts(chapter_number);
    CREATE INDEX IF NOT EXISTS idx_drafts_content ON drafts(content_id);
    CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(status);
    CREATE INDEX IF NOT EXISTS idx_drafts_chapter_status ON drafts(chapter_number, status);
    -- 注：chapter_number 与 blueprints 无硬 FK，因导入流程先建草稿后推演蓝图

    -- ============================================================
    -- 6. revisions — 修稿（派生自 draft）
    -- ============================================================
    CREATE TABLE IF NOT EXISTS revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      base_draft_id INTEGER NOT NULL,             -- 父草稿 FK
      revision_index INTEGER NOT NULL,            -- r1, r2
      revision_type TEXT NOT NULL,                -- refine | review-fix
      status TEXT DEFAULT 'pending',              -- pending/merged/discarded
      merged_to_draft_id INTEGER,                 -- 合并产出的新 draft
      user_prompt TEXT DEFAULT '',                -- 用户指导
      review_source_id INTEGER,                   -- 关联审稿 ID
      content_id INTEGER NOT NULL,                -- FK -> contents
      word_count INTEGER DEFAULT 0,               -- 字数缓存
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      updated_at INTEGER DEFAULT (unixepoch() * 1000),
      FOREIGN KEY (base_draft_id) REFERENCES drafts(id) ON DELETE CASCADE,
      FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_revisions_base_draft ON revisions(base_draft_id);
    CREATE INDEX IF NOT EXISTS idx_revisions_content ON revisions(content_id);
    CREATE INDEX IF NOT EXISTS idx_revisions_merged_to ON revisions(merged_to_draft_id);

    -- ============================================================
    -- 7. reviews — 审稿（派生自 draft）
    -- ============================================================
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      base_draft_id INTEGER NOT NULL,             -- 审查对象 FK
      review_index INTEGER NOT NULL,              -- 审阅顺位
      content_id INTEGER NOT NULL,                -- FK -> contents
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      FOREIGN KEY (base_draft_id) REFERENCES drafts(id) ON DELETE CASCADE,
      FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_reviews_base_draft ON reviews(base_draft_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_content ON reviews(content_id);

    -- ============================================================
    -- 8. post_process_runs — 后处理跑批实例
    -- ============================================================
    CREATE TABLE IF NOT EXISTS post_process_runs (
      id TEXT PRIMARY KEY,                        -- UUID
      trigger_source_type TEXT NOT NULL,           -- chapter_finalize / arch_extract
      trigger_source_id TEXT NOT NULL,             -- 章节号 / draft_id
      source_label TEXT DEFAULT '',               -- UI 标签
      all_critical_passed INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      updated_at INTEGER DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_post_runs_source
      ON post_process_runs(trigger_source_type, trigger_source_id);

    -- ============================================================
    -- 9. post_process_steps — 后处理步骤明细
    -- ============================================================
    CREATE TABLE IF NOT EXISTS post_process_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,                       -- FK -> post_process_runs
      step_key TEXT NOT NULL,                     -- 步骤标识
      label TEXT DEFAULT '',                      -- 展示名称
      critical INTEGER DEFAULT 0,                 -- 是否关键步骤
      ok INTEGER DEFAULT 0,                       -- 是否完成
      error_msg TEXT DEFAULT '',
      attempt_count INTEGER DEFAULT 0,
      completed_at TEXT DEFAULT '',
      last_attempt_at TEXT DEFAULT '',
      FOREIGN KEY (run_id) REFERENCES post_process_runs(id) ON DELETE CASCADE,
      UNIQUE(run_id, step_key)
    );
    CREATE INDEX IF NOT EXISTS idx_post_steps_run ON post_process_steps(run_id);

    -- ============================================================
    -- 沿用表：LLM 调用记录
    -- ============================================================
    CREATE TABLE IF NOT EXISTS llm_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id TEXT NOT NULL,
      model_name TEXT DEFAULT '',
      purpose TEXT DEFAULT '',
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      success INTEGER DEFAULT 1,
      error_message TEXT DEFAULT '',
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    -- ============================================================
    -- 沿用表：角色状态快照
    -- ============================================================
    CREATE TABLE IF NOT EXISTS summary_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_number INTEGER NOT NULL,
      character_states TEXT DEFAULT '',
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    -- 索引
    CREATE INDEX IF NOT EXISTS idx_llm_calls_time ON llm_calls(created_at);
    CREATE INDEX IF NOT EXISTS idx_summary_chapter ON summary_snapshots(chapter_number);
    CREATE INDEX IF NOT EXISTS idx_summary_created ON summary_snapshots(created_at);
  `)

  // ===== 旧表迁移（仅在新版本时执行） =====
  ensureSchemaVersion(db)
}

/** 为已存在的旧表补加缺失的列/约束（兼容性迁移） */
function migrateExistingTables(db: BetterSqlite3.Database) {
  // 1. contents 表：补加 updated_at 列
  try {
    const cols = db.pragma('table_info(contents)') as Array<{ name: string }>
    if (!cols.some(c => c.name === 'updated_at')) {
      db.exec("ALTER TABLE contents ADD COLUMN updated_at INTEGER DEFAULT (unixepoch() * 1000)")
      logger.info('DB', '迁移: contents 表已添加 updated_at 列')
    }
  } catch (e) {
    logger.error('DB', `迁移 contents.updated_at 失败: ${e}`)
    throw new Error(`关键迁移步骤失败 (contents.updated_at): ${e}`)
  }

  // 2. post_process_steps 表：补加唯一约束
  try {
    const indexes = db.pragma('index_list(post_process_steps)') as Array<{ name: string }>
    if (!indexes.some(i => i.name === 'uq_post_steps_run_key')) {
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_post_steps_run_key ON post_process_steps(run_id, step_key)')
      logger.info('DB', '迁移: post_process_steps 已添加唯一约束')
    }
  } catch (e) {
    logger.error('DB', `迁移 post_process_steps 唯一约束失败: ${e}`)
    throw new Error(`关键迁移步骤失败 (post_process_steps): ${e}`)
  }

  // 3. summary_snapshots 表：补加索引
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_summary_chapter ON summary_snapshots(chapter_number)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_summary_created ON summary_snapshots(created_at)')
  } catch (e) {
    logger.error('DB', `迁移 summary_snapshots 索引失败: ${e}`)
    throw new Error(`关键迁移步骤失败 (summary_snapshots indexes): ${e}`)
  }

  // 4. v2: blueprints 表：添加 sort_order, priority 列
  try {
    const bpCols = db.pragma('table_info(blueprints)') as Array<{ name: string }>
    if (!bpCols.some(c => c.name === 'sort_order')) {
      db.exec('ALTER TABLE blueprints ADD COLUMN sort_order INTEGER DEFAULT 0')
      logger.info('DB', '迁移: blueprints 表已添加 sort_order 列')
    }
    if (!bpCols.some(c => c.name === 'priority')) {
      db.exec('ALTER TABLE blueprints ADD COLUMN priority INTEGER DEFAULT 0')
      logger.info('DB', '迁移: blueprints 表已添加 priority 列')
    }
  } catch (e) {
    logger.error('DB', `迁移 blueprints 列失败: ${e}`)
    throw new Error(`关键迁移步骤失败 (blueprints): ${e}`)
  }

  // 5. v2: evaluation_scores 表
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS evaluation_scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        draft_id INTEGER NOT NULL,
        reviewer_perspective TEXT NOT NULL,
        scores TEXT NOT NULL DEFAULT '{}',
        overall_score REAL DEFAULT 0,
        strengths TEXT DEFAULT '[]',
        weaknesses TEXT DEFAULT '[]',
        suggestions TEXT DEFAULT '[]',
        raw_response TEXT DEFAULT '',
        tokens_used INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (unixepoch() * 1000),
        FOREIGN KEY (draft_id) REFERENCES drafts(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_evaluation_draft ON evaluation_scores(draft_id);
    `)
    logger.info('DB', '迁移: evaluation_scores 表 + draft_id 索引已创建')
  } catch (e) {
    logger.error('DB', `迁移 evaluation_scores 失败: ${e}`)
    throw new Error(`关键迁移步骤失败 (evaluation_scores): ${e}`)
  }

  // 6. v4: project_archives 表 + 大文本字段迁移
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_archives (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT 'main',
        field_key TEXT NOT NULL,
        body TEXT DEFAULT '',
        updated_at INTEGER DEFAULT (unixepoch() * 1000)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_field ON project_archives(project_id, field_key);
    `)
    // 迁移现有的 4 个大文本字段到 project_archives（保留原列以保持兼容）
    const FIELDS = ['premise', 'worldbuilding', 'characters_arch', 'synopsis']
    for (const field of FIELDS) {
      const row = db.prepare(`SELECT ${field} FROM project_core WHERE id = 'main'`).get() as Record<string, string> | undefined
      if (row?.[field]) {
        db.prepare(`
          INSERT OR REPLACE INTO project_archives (id, project_id, field_key, body)
          VALUES (?, 'main', ?, ?)
        `).run(`main_${field}`, field, row[field])
      }
    }
    logger.info('DB', '迁移: project_archives 表已创建，大文本字段已归档')
  } catch (e) {
    logger.error('DB', `迁移 project_archives 失败: ${e}`)
    throw new Error(`关键迁移步骤失败 (project_archives): ${e}`)
  }

  // 7. v5: 时间字段 TEXT → INTEGER 迁移（毫秒级 unix 时间戳）
  try {
    const TIME_COL_TABLES: Array<{ table: string; cols: string[] }> = [
      { table: 'project_core', cols: ['created_at', 'updated_at'] },
      { table: 'blueprints', cols: ['created_at', 'updated_at'] },
      { table: 'characters', cols: ['created_at', 'updated_at'] },
      { table: 'contents', cols: ['created_at', 'updated_at'] },
      { table: 'drafts', cols: ['created_at', 'updated_at'] },
      { table: 'revisions', cols: ['created_at', 'updated_at'] },
      { table: 'reviews', cols: ['created_at'] },
      { table: 'post_process_runs', cols: ['created_at', 'updated_at'] },
      { table: 'post_process_steps', cols: ['created_at'] },
      { table: 'llm_calls', cols: ['created_at'] },
      { table: 'summary_snapshots', cols: ['created_at'] },
      { table: 'project_archives', cols: ['updated_at'] },
    ]

    for (const { table, cols } of TIME_COL_TABLES) {
      for (const col of cols) {
        // 将旧的 TEXT 时间戳转换为 INTEGER 毫秒时间戳
        const rows = db.prepare(
          `SELECT rowid, ${col} FROM ${table} WHERE typeof(${col}) = 'text'`
        ).all() as Array<{ rowid: number; [key: string]: unknown }>

        for (const row of rows) {
          const textVal = row[col] as string
          if (textVal && typeof textVal === 'string') {
            const parsed = Date.parse(textVal)
            if (!isNaN(parsed)) {
              db.prepare(`UPDATE ${table} SET ${col} = ? WHERE rowid = ?`).run(parsed, row.rowid)
            }
          }
        }
      }
    }
    logger.info('DB', '迁移: 时间字段 TEXT→INTEGER 转换完成')
  } catch (e) {
    logger.error('DB', `时间字段迁移失败: ${e}`)
    throw new Error(`关键迁移步骤失败 (time migration v5): ${e}`)
  }
}
