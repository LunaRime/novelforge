/**
 * 开发者控制台 — 项目数据库只读检查器。
 *
 * 每次查询打开独立的 readonly 连接（不碰主进程正在写的连接），
 * 只读 SQL 守卫 + readonly 连接构成双保险；不提供全局 DB 访问。
 */
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { getCurrentProjectPath } from '../database'
import { getProjectVelaDir } from '../utils/config-utils'
import { isReadOnlySql } from './sql-guard'
import { redactSecrets } from './ipc-metrics'
import type { DevDbQueryResult, DevDbSchema, DevDbTable } from '../../src/shared/ipc-channels'

function projectDbPath(): string | null {
  const project = getCurrentProjectPath()
  if (!project) return null
  const file = path.join(getProjectVelaDir(project), 'vela.db')
  return fs.existsSync(file) ? file : null
}

function openReadOnly(): Database.Database | null {
  const file = projectDbPath()
  if (!file) return null
  return new Database(file, { readonly: true, fileMustExist: true })
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

export function listTables(): DevDbTable[] {
  const db = openReadOnly()
  if (!db) return []
  try {
    const rows = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all() as Array<{ name: string }>
    return rows.slice(0, 200).map((row) => {
      let count = 0
      try {
        const result = db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(row.name)}`).get() as { n?: number }
        count = typeof result?.n === 'number' ? result.n : 0
      } catch {
        count = 0
      }
      return { name: row.name, rows: count }
    })
  } catch {
    return []
  } finally {
    db.close()
  }
}

export function getSchema(table: string): DevDbSchema | null {
  if (!table) return null
  const db = openReadOnly()
  if (!db) return null
  try {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
    if (!exists) return null

    const columns = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{
      name: string; type: string; notnull: number; pk: number; dflt_value: string | null
    }>
    const indexes = db.prepare(`PRAGMA index_list(${quoteIdent(table)})`).all() as Array<{
      name: string; unique: number
    }>

    return {
      name: table,
      columns: columns.map((c) => ({
        name: c.name,
        type: c.type,
        notnull: c.notnull,
        pk: c.pk,
        dfltValue: c.dflt_value,
      })),
      indexes: indexes.map((idx) => {
        let cols: string[] = []
        try {
          const info = db.prepare(`PRAGMA index_info(${quoteIdent(idx.name)})`).all() as Array<{ name: string }>
          cols = info.map((x) => x.name)
        } catch {
          cols = []
        }
        return { name: idx.name, unique: idx.unique, columns: cols }
      }),
    }
  } catch {
    return null
  } finally {
    db.close()
  }
}

export function runQuery(sql: string, limit = 200): DevDbQueryResult {
  const guard = isReadOnlySql(sql)
  if (!guard.ok) return { success: false, error: guard.reason }

  const db = openReadOnly()
  if (!db) return { success: false, error: '当前没有打开的项目数据库' }

  const max = Math.min(Math.max(Math.trunc(limit) || 200, 1), 500)
  try {
    const stmt = db.prepare(guard.sql)
    const columns = stmt.columns().map((c) => c.name)
    const rows: unknown[][] = []
    let truncated = false
    for (const row of stmt.iterate() as Iterable<Record<string, unknown>>) {
      if (rows.length >= max) { truncated = true; break }
      rows.push(columns.map((name) => row[name]))
    }
    return { success: true, columns, rows, rowCount: rows.length, truncated }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, error: redactSecrets(message) }
  } finally {
    db.close()
  }
}