/**
 * 存量角色名括号别名修复（#34 评估修复方案 5）
 *
 * 背景：历史数据中 LLM 曾把「无名老乞丐（前魂师）」整名落库（角色名唯一主键），
 * 导致：后续无括号输出匹配不到 → 重复创建；正文精确扫描（互动检测/档案上下文）
 * 永不命中。写入端已归一化（stripNameAlias），此处一次性修复存量：
 * - 无冲突（目标名不存在）→ 改名（连带其他角色 relations 中的引用）
 * - 有冲突（目标名已存在）→ 合并（空白字段补齐 + relations 合并去重 + 删除别名行）
 *
 * computeNameRepairPlan 为纯函数（可单测）；applyCharacterNameRepair 走 IPC 写库。
 * 幂等：无括号名时零变更。
 */
import { stripNameAlias } from './character-normalize'
import { ipc } from './ipc-client'
import { renderLog } from './render-logger'
import { t } from '../shared/locale'
import type { CharacterData } from '../../electron/repositories/character-repository'

/** 兼容 CharacterData 的角色行（动态字段访问用 index signature） */
export interface CharacterCardLike extends CharacterData {
  [key: string]: unknown
}

export interface NameRepairPlan {
  /** 待 upsert 的完整角色数据（改名后的别名行 / 合并后的目标行 / relations 引用被改的行） */
  upserts: CharacterCardLike[]
  /** 待删除的别名行 name（合并场景） */
  deletes: string[]
  renamed: number
  merged: number
}

/** 解析 relations JSON（容错） */
function parseRelations(raw: string): Array<{ target?: string }> {
  try {
    const arr = JSON.parse(raw || '[]')
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

/** 计算修复计划（纯函数） */
export function computeNameRepairPlan(chars: CharacterCardLike[]): NameRepairPlan {
  const plan: NameRepairPlan = { upserts: [], deletes: [], renamed: 0, merged: 0 }
  if (!Array.isArray(chars) || chars.length === 0) return plan

  const byName = new Map<string, CharacterCardLike>(chars.map(c => [c.name, c]))
  const bracketed = chars.filter(c => {
    const base = stripNameAlias(c.name)
    return base && base !== c.name
  })
  if (bracketed.length === 0) return plan

  // 引用替换映射：旧名 → 新名（改名 + 合并都产生）
  const remap = new Map<string, string>()

  for (const old of bracketed) {
    const base = stripNameAlias(old.name)
    const existing = byName.get(base)

    if (existing) {
      // 合并：目标行空白字段用别名行补齐；relations 合并去重；删除别名行
      const merged = { ...existing }
      for (const k of Object.keys(old)) {
        if (k === 'name' || k === 'relations') continue
        const v = old[k]
        if (v !== undefined && v !== null && String(v).trim() !== '' && String(merged[k] ?? '').trim() === '') {
          merged[k] = v
        }
      }
      const rels = [...parseRelations(String(merged.relations ?? '[]')), ...parseRelations(String(old.relations ?? '[]'))]
      const seen = new Set<string>()
      const mergedRels = rels.filter(r => {
        const key = r.target ?? JSON.stringify(r)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      // 引用替换：别名行 relations 中指向的角色
      merged.relations = JSON.stringify(mergedRels)
      // 其他角色的 relations 里指向旧名 → 目标名
      remap.set(old.name, base)
      plan.upserts.push(merged)
      plan.deletes.push(old.name)
      plan.merged++
    } else {
      // 改名：别名行整体迁移到干净名
      plan.upserts.push({ ...old, name: base })
      remap.set(old.name, base)
      plan.renamed++
    }
  }

  // 其他角色 relations 引用替换（指向被改/被合并的旧名）
  for (const c of chars) {
    const rels = parseRelations(String(c.relations ?? '[]'))
    let changed = false
    const seen = new Set<string>()
    const next = rels.map(r => {
      const key = r.target ?? JSON.stringify(r)
      if (seen.has(key)) return null
      seen.add(key)
      const mapped = r.target && remap.has(r.target) ? { ...r, target: remap.get(r.target)! } : r
      if (mapped !== r) changed = true
      return mapped
    }).filter((r): r is { target?: string } => r !== null)
    if (changed) {
      plan.upserts.push({ ...c, relations: JSON.stringify(next) })
    }
  }

  return plan
}

/** 应用修复（读全角色 → 计算 → 写回；非关键，失败仅日志） */
export async function applyCharacterNameRepair(): Promise<void> {
  try {
    const chars = (await ipc.invoke('db:character-get-all')) as unknown as CharacterCardLike[]
    const plan = computeNameRepairPlan(chars)
    if (plan.upserts.length === 0 && plan.deletes.length === 0) return
    for (const row of plan.upserts) {
      await ipc.invoke('db:character-upsert', row)
    }
    for (const name of plan.deletes) {
      await ipc.invoke('db:character-delete', name)
    }
    renderLog('info', 'Repair:CharacterName', t('log.render.characterNameRepaired')
      .replace('{renamed}', String(plan.renamed))
      .replace('{merged}', String(plan.merged)))
  } catch (e) {
    renderLog('warn', 'Repair:CharacterName', `角色名修复失败（非关键）: ${String(e)}`)
  }
}
