/**
 * NovelForge 智能上下文剪枝器 — 长篇小说 token 优化
 *
 * 按章节与当前章的相关度排序，只注入 top-N 最相关章节的上下文，
 * 在保持连贯性的同时大幅减少 token 消耗。
 */

import { ipc } from './ipc-client'
import { estimateTokens } from './agent/token-budget'

// ===== 类型定义 =====

export interface ChapterContextScore {
  chapterNumber: number
  /** 综合相关度 (0-1) */
  relevance: number
  /** 来源 */
  summary: string
}

export interface PrunedContext {
  /** 精选后的上下文文本 */
  text: string
  /** token 统计 */
  tokensSaved: number
  tokensUsed: number
}

// ===== 核心函数 =====

/**
 * 智能剪枝：从所有已写入的章节中选出与当前章最相关的 top-N
 *
 * 相关性计算基于：
 * 1. 章节距离（越近越相关）
 * 2. 关键词重叠（蓝图/角色/事件）
 * 3. 伏笔引用
 */
export async function pruneChapterContext(
  currentChapter: number,
  currentBlueprint: { title: string; keyEvents: string; characters: string[] },
  maxTokens: number = 2500,
  maxChapters: number = 3,
): Promise<PrunedContext> {
  const allScores: ChapterContextScore[] = []

  // 收集前 30 章的信息
  const startChapter = Math.max(1, currentChapter - 30)

  for (let ch = startChapter; ch < currentChapter; ch++) {
    try {
      // 获取蓝图信息
      const blueprint = await ipc.invoke('db:blueprint-get', ch)
      if (!blueprint) continue

      // 计算相关性
      const relevance = calculateRelevance(currentBlueprint, {
        title: blueprint.title || `第${ch}章`,
        keyEvents: blueprint.keyEvents || '',
        characters: blueprint.characters || [],
      }, ch, currentChapter)

      allScores.push({
        chapterNumber: ch,
        relevance,
        summary: `第${ch}章 ${blueprint.title}: ${(blueprint.keyEvents || '').slice(0, 80)}`,
      })
    } catch { /* skip */ }
  }

  // 按相关度降序排列
  allScores.sort((a, b) => b.relevance - a.relevance)

  // 取 top-N，但确保 token 不超预算
  const selected: ChapterContextScore[] = []
  let usedTokens = 0

  for (const scored of allScores.slice(0, maxChapters)) {
    const estTokens = estimateTokens(scored.summary)
    if (usedTokens + estTokens > maxTokens) break
    selected.push(scored)
    usedTokens += estTokens
  }

  // 按章节号排序输出（时间线顺序）
  selected.sort((a, b) => a.chapterNumber - b.chapterNumber)

  // 计算节省的 token（相较于全量注入）
  const originalTokens = estimateTokens(allScores.map(s => s.summary).join('\n'))
  const tokensSaved = Math.max(0, originalTokens - usedTokens)

  return {
    text: selected.length > 0
      ? selected.map((s, i) => `[${i + 1}] ${s.summary}`).join('\n')
      : '（无前文章节数据）',
    tokensSaved,
    tokensUsed: usedTokens,
  }
}

/**
 * 计算章节相关性
 */
function calculateRelevance(
  current: { title: string; keyEvents: string; characters: string[] },
  target: { title: string; keyEvents: string; characters: string[] },
  targetChapter: number,
  currentChapter: number,
): number {
  let score = 0

  // 1. 距离权重（越近越相关，最高 0.3）
  const distance = currentChapter - targetChapter
  if (distance <= 3) score += 0.3
  else if (distance <= 10) score += 0.2
  else if (distance <= 20) score += 0.1

  // 2. 关键词重叠（基于 keyEvents，最高 0.35）
  const currentWords = extractKeywords(current.keyEvents + ' ' + current.title)
  const targetWords = extractKeywords(target.keyEvents + ' ' + target.title)
  if (currentWords.length > 0 && targetWords.length > 0) {
    let overlap = 0
    for (const w of currentWords) {
      if (targetWords.includes(w)) overlap++
    }
    score += (overlap / Math.max(currentWords.length, targetWords.length, 1)) * 0.35
  }

  // 3. 角色重叠（最高 0.2）
  const currentChars = new Set(current.characters)
  const targetChars = new Set(target.characters)
  if (currentChars.size > 0 && targetChars.size > 0) {
    let overlap = 0
    for (const c of currentChars) {
      if (targetChars.has(c)) overlap++
    }
    score += (overlap / Math.max(currentChars.size, targetChars.size, 1)) * 0.2
  }

  // 4. 伏笔引用（如果目标章节被其他章引用，加 0.15）
  if (target.keyEvents.includes('伏笔') || target.keyEvents.includes('悬念') || target.keyEvents.includes('秘密')) {
    score += 0.15
  }

  return Math.min(1, score)
}

/**
 * 提取关键词（简单分词）
 */
function extractKeywords(text: string): string[] {
  const words: string[] = []
  // 2-4 字片段
  for (let i = 0; i <= text.length - 2; i++) {
    for (let len = 2; len <= 4 && i + len <= text.length; len++) {
      const w = text.slice(i, i + len)
      if (w.match(/^[一-鿿]+$/)) words.push(w)
    }
  }
  return [...new Set(words)].slice(0, 30)
}
