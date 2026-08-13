/**
 * 角色重复检测 — 纯函数（P1-6 角色库清理）
 *
 * 角色库"只增不减"的入口之一：LLM 昵称变体/错字/括号形态导致的重复建卡。
 * 检测规则（按置信度排序，全部基于 DB 现有数据，无需 LLM）：
 * 1. alias-equals-name（0.9）：A 的别名恰好等于 B 的名字（或 B 的别名等于 A 的名字）
 * 2. shared-alias（0.8）：A 与 B 的别名注册表有交集
 * 3. name-similar（0.6）：名字等长且编辑距离 = 1（单个字符差异，如 苏晚/苏婉）
 *    ——排除"包含关系"（苏晚/苏晚晴 是真实的不同角色，前缀关系不算重复）
 *
 * 返回的 pair 已规范化（a < b 字典序），每对只出现一次。
 */

/** 重复原因 */
export type DuplicateReason = 'alias-equals-name' | 'shared-alias' | 'name-similar'

/** 疑似重复对 */
export interface DuplicatePair {
  /** 角色 A（DB 规范名） */
  a: string
  /** 角色 B（DB 规范名） */
  b: string
  reason: DuplicateReason
  /** 置信度 0-1（展示排序用） */
  score: number
}

/** 最小编辑距离（Levenshtein，名字通常 ≤6 字符，O(n×m) 足够） */
export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    prev = cur
  }
  return prev[n]
}

/** 检测全量角色中的疑似重复对 */
export function findDuplicatePairs(
  chars: Array<{ name: string; aliases?: unknown }>,
): DuplicatePair[] {
  const pairs: DuplicatePair[] = []
  const names = chars.map(c => c.name).filter(Boolean)

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i]
      const b = names[j]
      const [x, y] = a < b ? [a, b] : [b, a] // 规范化排序，防重复
      const charX = chars.find(c => c.name === x)
      const charY = chars.find(c => c.name === y)
      const aliasesX = charX ? parseAliasesSafe(charX.aliases) : []
      const aliasesY = charY ? parseAliasesSafe(charY.aliases) : []

      // 1. 别名等于对方名字（强疑似）
      if (aliasesX.includes(y) || aliasesY.includes(x)) {
        pairs.push({ a: x, b: y, reason: 'alias-equals-name', score: 0.9 })
        continue
      }
      // 2. 共享别名
      const shared = aliasesX.filter(al => aliasesY.includes(al))
      if (shared.length > 0) {
        pairs.push({ a: x, b: y, reason: 'shared-alias', score: 0.8 })
        continue
      }
      // 3. 等长 + 编辑距离 1（单个字符差异；包含关系排除——前缀名是真实角色）
      if (x.length === y.length && x.length > 0 && levenshtein(x, y) === 1) {
        pairs.push({ a: x, b: y, reason: 'name-similar', score: 0.6 })
      }
    }
  }

  // 置信度降序
  return pairs.sort((p1, p2) => p2.score - p1.score)
}

/** 从当前角色（selectedName）出发的疑似重复对列表 */
export function findPairsForCharacter(
  chars: Array<{ name: string; aliases?: unknown }>,
  selectedName: string,
): DuplicatePair[] {
  return findDuplicatePairs(chars).filter(p => p.a === selectedName || p.b === selectedName)
}

function parseAliasesSafe(raw: unknown): string[] {
  if (raw === undefined || raw === null) return []
  if (Array.isArray(raw)) return raw.map(String).map(s => s.trim()).filter(Boolean)
  const s = String(raw).trim()
  if (!s || s === '[]') return []
  try {
    const parsed = JSON.parse(s)
    return Array.isArray(parsed) ? parsed.map(String).map(x => x.trim()).filter(Boolean) : []
  } catch {
    return []
  }
}
