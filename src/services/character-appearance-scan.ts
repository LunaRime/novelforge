/**
 * 角色出场统计扫描 — P2-1
 *
 * 生命周期字段（appear_count/first_chapter/last_chapter）默认只在**定稿时**维护；
 * 存量项目/导入小说的角色这些字段全是 0。本工具扫描全部定稿章节，
 * 统计每个角色的出场章（含别名形态 + 前缀碰撞过滤），供 UI 一键回填。
 *
 * 疑似退场提示：lastChapter 距最新定稿章 ≥ DEPARTED_GAP 章的角色列出来（不自动改 status，
 * 由用户确认后手动切换——自动规则易误伤周期性回归的角色）。
 */
import { ipc } from './ipc-client'
import { buildNamePositions } from './workflows/relation-utils'
import { parseAliases } from './character-normalize'
import type { ChapterContent } from './character-archive'

/** 连续多少章未出场视为"疑似退场"（提示阈值，不自动改状态） */
export const DEPARTED_GAP = 20

/** 单角色出场统计结果 */
export interface CharacterAppearanceStats {
  name: string
  /** 出场章数 */
  appearCount: number
  /** 首次出场章（0 = 未出场） */
  firstChapter: number
  /** 最近出场章（0 = 未出场） */
  lastChapter: number
  /** 出场章节列表（升序） */
  chapters: number[]
}

/** 扫描结果 */
export interface AppearanceScanResult {
  stats: CharacterAppearanceStats[]
  /** 疑似退场角色名（lastChapter 距最新章 ≥ DEPARTED_GAP） */
  departed: string[]
  /** 全部已定稿章节号（用于判断"距最新章"） */
  maxChapter: number
}

/**
 * 扫描角色出场（纯函数，可单测）。
 * 名单 = 每个角色的规范名 + 别名（buildNamePositions 内置双形态 + 前缀碰撞过滤）。
 */
export function scanCharacterAppearances(
  chapters: ChapterContent[],
  chars: Array<{ name: string; aliases?: unknown }>,
): AppearanceScanResult {
  // 扫描名单：规范名 + 别名（去空去重）
  const entries: string[] = []
  for (const c of chars) {
    for (const form of [c.name, ...parseAliases(c.aliases)]) {
      const f = String(form ?? '').trim()
      if (f && !entries.includes(f)) entries.push(f)
    }
  }

  // entry → 归属角色
  const ownerOf = new Map<string, string>()
  for (const c of chars) {
    for (const form of [c.name, ...parseAliases(c.aliases)]) {
      const f = String(form ?? '').trim()
      if (f) ownerOf.set(f, c.name)
    }
  }

  // 逐章扫描，收集每角色的出场章集合
  const chapterSets = new Map<string, Set<number>>()
  for (const c of chars) chapterSets.set(c.name, new Set())
  for (const ch of chapters) {
    const positions = buildNamePositions(ch.content, entries)
    for (const entry of entries) {
      if ((positions.get(entry) ?? []).length > 0) {
        const owner = ownerOf.get(entry)
        if (owner) chapterSets.get(owner)!.add(ch.chapterNumber)
      }
    }
  }

  const stats: CharacterAppearanceStats[] = chars.map(c => {
    const chaps = [...(chapterSets.get(c.name) ?? [])].sort((a, b) => a - b)
    return {
      name: c.name,
      appearCount: chaps.length,
      firstChapter: chaps[0] ?? 0,
      lastChapter: chaps[chaps.length - 1] ?? 0,
      chapters: chaps,
    }
  })

  const maxChapter = chapters.reduce((m, ch) => Math.max(m, ch.chapterNumber), 0)
  const departed = stats
    .filter(s => s.lastChapter > 0 && maxChapter - s.lastChapter >= DEPARTED_GAP)
    .map(s => s.name)

  return { stats, departed, maxChapter }
}

/** 加载全部定稿章节正文（与 character-archive-workflow 相同的补全逻辑） */
export async function loadFinalizedChapters(): Promise<ChapterContent[]> {
  const chapterNumbers = (await ipc.invoke('db:draft-get-all-chapter-numbers')) as number[]
  const chapters: ChapterContent[] = []
  for (const n of [...chapterNumbers].sort((a, b) => a - b)) {
    const meta = await ipc.invoke('db:draft-get-finalized', n) as { id: number; content?: string } | null
    if (!meta) continue
    const full = await ipc.invoke('db:draft-get-full', meta.id) as { content?: string } | null
    if (full?.content) chapters.push({ chapterNumber: n, content: full.content })
  }
  return chapters
}

/** 回填出场统计到 DB（逐角色 updateAppearanceStats，只更新统计三列） */
export async function saveAppearanceStats(
  stats: CharacterAppearanceStats[],
): Promise<{ updated: number; failed: number }> {
  let updated = 0
  let failed = 0
  for (const s of stats) {
    try {
      const res = await ipc.invoke('db:character-update-appearance-stats', s.name, {
        appearCount: s.appearCount,
        firstChapter: s.firstChapter,
        lastChapter: s.lastChapter,
      })
      if (res.success) updated++
      else failed++
    } catch {
      failed++
    }
  }
  return { updated, failed }
}
