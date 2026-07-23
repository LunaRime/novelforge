/**
 * NovelForge 蓝图校检服务 — 章节蓝图缺口检测与 AI 分析
 *
 * 职责：
 * 1. 扫描蓝图缺口（缺失的章节号）
 * 2. 使用相邻章节上下文分析缺口严重程度
 * 3. 生成校检报告
 * 4. 协调 AI 补全缺失蓝图
 */

import { ipc } from './ipc-client'
import type { ChapterBlueprint } from './workflows/directory-workflow'

// ===== 类型定义 =====

/** 蓝图缺口 */
export interface BlueprintGap {
  /** 缺失的章节号列表 */
  missingChapterNumbers: number[]
  /** 前一章蓝图（缺口前最近的一章） */
  precedingChapter: ChapterBlueprint | null
  /** 后一章蓝图（缺口后最近的一章） */
  followingChapter: ChapterBlueprint | null
  /** 缺口大小 */
  gapSize: number
  /** 上下文摘要（前置 + 后置蓝图关键事件拼接） */
  context: string
}

/** 不一致的角色定位 */
export interface InconsistentRole {
  chapter: number
  role: string
  expectedRole: string
  reason: string
}

/** 校检报告 */
export interface VerificationReport {
  /** 总章节数 */
  totalChapters: number
  /** 已有蓝图数 */
  existingChapters: number
  /** 缺口列表 */
  gaps: BlueprintGap[]
  /** 角色定位不一致的章节 */
  inconsistentRoles: InconsistentRole[]
  /** 缺失标题的章节 */
  missingTitles: number[]
  /** 摘要 */
  summary: string
  /** 严重程度 */
  severity: 'ok' | 'warning' | 'critical'
  /** 生成时间 */
  generatedAt: string
}

// ===== 核心函数 =====

/**
 * 扫描蓝图缺口
 */
export async function scanGaps(totalChapters: number): Promise<number[]> {
  try {
    return await ipc.invoke('db:blueprint-get-gaps', totalChapters)
  } catch {
    console.error('[BlueprintVerification] 缺口扫描失败')
    return []
  }
}

/**
 * 获取相邻章节蓝图（用于 AI 上下文）
 */
async function getAdjacentBlueprints(
  chapterNumber: number,
): Promise<{ preceding: ChapterBlueprint | null; following: ChapterBlueprint | null }> {
  try {
    const [preceding, following] = await Promise.all([
      ipc.invoke('db:blueprint-get', chapterNumber - 1).catch(() => null) as Promise<ChapterBlueprint | null>,
      ipc.invoke('db:blueprint-get', chapterNumber + 1).catch(() => null) as Promise<ChapterBlueprint | null>,
    ])
    return { preceding, following }
  } catch {
    return { preceding: null, following: null }
  }
}

/**
 * 检测角色定位不一致
 */
function detectInconsistentRoles(blueprints: ChapterBlueprint[]): InconsistentRole[] {
  const inconsistent: InconsistentRole[] = []

  for (const bp of blueprints) {
    if (!bp.role || bp.role === '发展') continue

    // 检查章节号与角色定位是否匹配
    const totalChapters = blueprints.length
    const position = bp.chapterNumber / totalChapters

    let expectedRole = '发展'
    if (position <= 0.1) expectedRole = '开端'
    else if (position <= 0.4) expectedRole = '发展'
    else if (position <= 0.6) expectedRole = '转折'
    else if (position <= 0.85) expectedRole = '高潮'
    else expectedRole = '结局'

    if (bp.role !== expectedRole && bp.role !== '发展') {
      inconsistent.push({
        chapter: bp.chapterNumber,
        role: bp.role,
        expectedRole,
        reason: `第${bp.chapterNumber}章位于故事的${Math.round(position * 100)}%处，通常为「${expectedRole}」阶段`,
      })
    }
  }

  return inconsistent
}

/**
 * 生成校检报告
 */
export async function generateVerificationReport(
  totalChapters: number,
  blueprints: ChapterBlueprint[],
): Promise<VerificationReport> {
  const gapNumbers = await scanGaps(totalChapters)

  // 构建缺口详情
  const gaps: BlueprintGap[] = []
  let currentGapStart = -1

  for (const num of gapNumbers) {
    if (currentGapStart === -1) {
      currentGapStart = num
    }
    // 检查是否连续
    const nextExists = gapNumbers.includes(num + 1)
    if (!nextExists) {
      // 缺口结束
      const { preceding, following } = await getAdjacentBlueprints(num)
      const missingNums = []
      for (let i = currentGapStart; i <= num; i++) {
        missingNums.push(i)
      }

      const contextParts: string[] = []
      if (preceding) {
        contextParts.push(
          `[前一章 第${preceding.chapterNumber}章 ${preceding.title}] ${preceding.keyEvents}`,
        )
      }
      if (following) {
        contextParts.push(
          `[后一章 第${following.chapterNumber}章 ${following.title}] ${following.keyEvents}`,
        )
      }

      gaps.push({
        missingChapterNumbers: missingNums,
        precedingChapter: preceding,
        followingChapter: following,
        gapSize: missingNums.length,
        context: contextParts.join('\n'),
      })

      currentGapStart = -1
    }
  }

  // 检测不一致的角色定位
  const inconsistentRoles = detectInconsistentRoles(blueprints)

  // 检测缺失标题
  const missingTitles = blueprints
    .filter((bp) => !bp.title || bp.title === `第${bp.chapterNumber}章`)
    .map((bp) => bp.chapterNumber)

  // 计算严重程度
  const coverageRatio = blueprints.length / totalChapters
  let severity: VerificationReport['severity'] = 'ok'
  if (coverageRatio < 0.5 || gaps.length > totalChapters * 0.2) {
    severity = 'critical'
  } else if (coverageRatio < 0.8 || gaps.length > 0) {
    severity = 'warning'
  }

  // 生成摘要
  const summaryParts: string[] = []
  summaryParts.push(`共 ${totalChapters} 章，已有 ${blueprints.length} 章蓝图`)
  if (gaps.length > 0) {
    const totalMissing = gaps.reduce((sum, g) => sum + g.gapSize, 0)
    summaryParts.push(`发现 ${gaps.length} 处缺口，共缺失 ${totalMissing} 章`)
  }
  if (missingTitles.length > 0) {
    summaryParts.push(`${missingTitles.length} 章缺少标题`)
  }
  if (inconsistentRoles.length > 0) {
    summaryParts.push(`${inconsistentRoles.length} 章角色定位与位置不匹配`)
  }
  if (gaps.length === 0 && missingTitles.length === 0 && inconsistentRoles.length === 0) {
    summaryParts.push('✅ 蓝图完整无缺口')
  }

  return {
    totalChapters,
    existingChapters: blueprints.length,
    gaps,
    inconsistentRoles,
    missingTitles,
    summary: summaryParts.join('；'),
    severity,
    generatedAt: new Date().toISOString(),
  }
}
