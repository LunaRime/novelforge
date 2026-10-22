/**
 * 开发者控制台 — 只读 SQL 守卫。
 *
 * 防御层次：
 * 1. 本守卫只放行 SELECT / WITH / 只读 PRAGMA；
 * 2. db-inspector 仍使用 better-sqlite3 的 readonly 连接（第二道防线）。
 */

export type SqlGuardResult =
  | { ok: true; sql: string }
  | { ok: false; reason: string }

const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|replace|attach|detach|vacuum|reindex|truncate|begin|commit|rollback|savepoint|release)\b/i
const ALLOWED_PRAGMAS = new Set([
  'table_info',
  'index_list',
  'index_info',
  'foreign_key_list',
  'database_list',
  'user_version',
  'table_list',
])

/** 去掉注释后再校验；返回去注释、去尾部单分号的 SQL */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
}

export function isReadOnlySql(sql: string): SqlGuardResult {
  const original = (sql ?? '').trim()
  if (!original) return { ok: false, reason: 'SQL 不能为空' }

  const normalized = stripComments(original).trim()
  if (!normalized) return { ok: false, reason: 'SQL 不能只有注释' }

  // 只允许末尾一个分号；其余分号视为多语句
  const withoutTrailing = normalized.replace(/;\s*$/, '').trim()
  if (withoutTrailing.includes(';')) return { ok: false, reason: '不允许多条语句' }
  if (!withoutTrailing) return { ok: false, reason: 'SQL 不能为空' }

  const first = withoutTrailing.match(/^([a-z]+)\b/i)?.[1]?.toLowerCase()
  if (!first || !['select', 'with', 'pragma'].includes(first)) {
    return { ok: false, reason: '仅允许 SELECT / WITH / PRAGMA' }
  }

  if (FORBIDDEN.test(withoutTrailing)) {
    return { ok: false, reason: '包含写操作或 DDL' }
  }

  if (first === 'pragma') {
    if (withoutTrailing.includes('=')) {
      return { ok: false, reason: 'PRAGMA 不允许赋值' }
    }
    const pragma = withoutTrailing.match(/^pragma\s+([a-z_]+)\b/i)?.[1]?.toLowerCase()
    if (!pragma || !ALLOWED_PRAGMAS.has(pragma)) {
      return { ok: false, reason: 'PRAGMA 仅允许只读查询' }
    }
  }

  return { ok: true, sql: withoutTrailing }
}