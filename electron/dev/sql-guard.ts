/**
 * 开发者控制台 — 只读 SQL 守卫。
 *
 * 防御层次：
 * 1. 本守卫只放行 SELECT / WITH / 只读 PRAGMA；
 * 2. db-inspector 仍使用 better-sqlite3 的 readonly 连接（第二道防线）。
 */

import { t } from '../../src/shared/locale'

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
  if (!original) return { ok: false, reason: t('dev.sqlEmpty') }

  const normalized = stripComments(original).trim()
  if (!normalized) return { ok: false, reason: t('dev.sqlOnlyComments') }

  // 只允许末尾一个分号；其余分号视为多语句
  const withoutTrailing = normalized.replace(/;\s*$/, '').trim()
  if (withoutTrailing.includes(';')) return { ok: false, reason: t('dev.sqlMultiStatement') }
  if (!withoutTrailing) return { ok: false, reason: t('dev.sqlEmpty') }

  const first = withoutTrailing.match(/^([a-z]+)\b/i)?.[1]?.toLowerCase()
  if (!first || !['select', 'with', 'pragma'].includes(first)) {
    return { ok: false, reason: t('dev.sqlOnlyRead') }
  }

  if (FORBIDDEN.test(withoutTrailing)) {
    return { ok: false, reason: t('dev.sqlWrite') }
  }

  if (first === 'pragma') {
    if (withoutTrailing.includes('=')) {
      return { ok: false, reason: t('dev.sqlPragmaAssign') }
    }
    const pragma = withoutTrailing.match(/^pragma\s+([a-z_]+)\b/i)?.[1]?.toLowerCase()
    if (!pragma || !ALLOWED_PRAGMAS.has(pragma)) {
      return { ok: false, reason: t('dev.sqlPragmaReadOnly') }
    }
  }

  return { ok: true, sql: withoutTrailing }
}