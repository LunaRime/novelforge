/**
 * LLM 提取/导入角色卡的批量合并写入（#34 评估 P0/P1 修复）
 *
 * 背景：架构提取（createCharacterExtractSteps）与小说导入（import-novel）此前
 * 对 LLM 结果做全列覆盖 upsert——重跑时缺失字段绑 NULL/空值，存量角色卡的
 * 手写档案、tags、appearChapters、relations、cs_* 动态状态被静默清空
 * （与 82ebd8c 定稿后处理同款事故在另一路径复现）。
 *
 * 语义：
 * - 已存在角色（精确 + 括号别名双形态匹配）→ 仅填空合并：LLM 非空字段覆盖，
 *   空白/缺失字段保留 DB 现值（含 currentState）
 * - 新角色 → INSERT（补默认 relations/appearChapters）
 *
 * mergeCardRows 为纯函数（可单测）；mergeCharacterCards 走 IPC 写库。
 */
import { stripNameAlias, matchCharacterName, normalizeCharacterRole, parseAliases } from './character-normalize'
import { ipc } from './ipc-client'
import type { CharacterData } from '../../electron/repositories/character-repository'

/** 字符串档案字段（LLM 非空才覆盖） */
const STRING_FIELDS = ['gender', 'age', 'appearance', 'personality', 'background', 'abilities', 'motivation', 'relationships', 'arc', 'notes'] as const

export interface MergeStats {
  /** 最终写入行数 */
  saved: number
  /** 合并（已存在角色）行数 */
  merged: number
  /** 新建行数 */
  created: number
}

/** 合并计算（纯函数）：existing 为 DB 全量角色，cards 为 LLM 提取结果 */
export function mergeCardRows(
  existing: Array<Record<string, unknown>>,
  cards: Array<Record<string, unknown>>,
): { rows: Array<Record<string, unknown>>; stats: MergeStats } {
  const rows: Array<Record<string, unknown>> = []
  const stats: MergeStats = { saved: 0, merged: 0, created: 0 }

  for (const card of cards) {
    const rawName = String(card.name ?? '').trim()
    const name = stripNameAlias(rawName)
    if (!name) continue

    // 双形态匹配（三向）：精确；DB 名带括号（存量旧数据）← LLM 无括号名；
    // LLM 名带括号 → DB 无括号名
    const existingChar =
      existing.find(c => String(c.name) === name) ??
      existing.find(c => stripNameAlias(String(c.name)) === name) ??
      matchCharacterName(existing as Array<{ name: unknown }>, rawName)

    if (existingChar) {
      // 仅填空合并：LLM 非空字段覆盖，空白/缺失保留 DB 现值
      const merged: Record<string, unknown> = { ...existingChar, name: String(existingChar.name) }
      for (const f of STRING_FIELDS) {
        const v = card[f]
        if (v !== undefined && String(v).trim() !== '') merged[f] = String(v)
      }
      // role：LLM 原始值非空才覆盖（normalize 兜底 supporting 不覆盖已有 role）
      if (card.role !== undefined && String(card.role).trim() !== '') {
        merged.role = normalizeCharacterRole(String(card.role))
      }
      // tags：非空且非 '[]' 才覆盖
      if (card.tags !== undefined) {
        const t = String(card.tags).trim()
        if (t !== '' && t !== '[]') merged.tags = t
      }
      // 结构化字段：LLM 给了才覆盖
      if (card.appearChapters !== undefined) merged.appearChapters = String(card.appearChapters)
      if (card.relations !== undefined) merged.relations = String(card.relations)
      if (card.currentState !== undefined) merged.currentState = card.currentState
      rows.push(merged)
      stats.merged++
    } else {
      // 新角色：先展开 LLM 字段，再补缺失默认值（防覆盖）
      const role = normalizeCharacterRole(String(card.role ?? ''))
      const newRow: Record<string, unknown> = { ...card, name, role }
      for (const f of STRING_FIELDS) {
        if (newRow[f] === undefined || newRow[f] === null) newRow[f] = ''
      }
      // tier 按 role 推导（主角/反派 → 1，minor → 3，其余 2）
      if (newRow.tier === undefined) {
        newRow.tier = role === 'protagonist' || role === 'antagonist' ? 1 : (role === 'minor' ? 3 : 2)
      }
      if (newRow.tags === undefined) newRow.tags = ''
      if (newRow.appearChapters === undefined) newRow.appearChapters = '[]'
      if (newRow.relations === undefined) newRow.relations = '[]'
      // aliases：LLM 原始值（数组/字符串）统一归一化为 JSON 数组字符串（仓库 upsert 绑定值必须为 TEXT）
      const aliases = parseAliases(card.aliases)
      newRow.aliases = aliases.length > 0 ? JSON.stringify(aliases) : '[]'
      rows.push(newRow)
      stats.created++
    }
  }
  stats.saved = rows.length
  return { rows, stats }
}

/** 合并写入（读全角色 → 合并 → save-all；返回统计） */
export async function mergeCharacterCards(
  cards: Array<Record<string, unknown>>,
): Promise<MergeStats> {
  if (cards.length === 0) return { saved: 0, merged: 0, created: 0 }
  const existing = (await ipc.invoke('db:character-get-all')) as unknown as Array<Record<string, unknown>>
  const { rows, stats } = mergeCardRows(existing, cards)
  if (rows.length > 0) {
    const result = await ipc.invoke('db:character-save-all', rows as unknown as CharacterData[])
    if (!result.success) {
      throw new Error(result.error || 'save failed')
    }
  }
  return stats
}
