import { analyzeBlueprintRoles, analyzeBlueprintSnapshot, type BlueprintRoleMismatch, type BlueprintVerificationSeverity } from '../core'
import { t, type TextKey } from '../shared/locale'
import type { ChapterBlueprint } from './workflows/directory-workflow'
import { normalizeBlueprintRole } from './blueprint-role'

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
  severity: BlueprintVerificationSeverity
  /** 生成时间 */
  generatedAt: string
}

const roleKey: Record<string, TextKey> = {
  '建置': 'chapter.role.establishment',
  '铺垫': 'chapter.role.setup',
  '发展': 'chapter.role.development',
  '冲突': 'chapter.role.conflict',
  '高潮': 'chapter.role.climax',
  '转折': 'chapter.role.twist',
  '收尾': 'chapter.role.resolution',
}

function presentRoleMismatch({ chapter, role, expectedRole, positionPercent }: BlueprintRoleMismatch): InconsistentRole {
  return {
    chapter,
    role,
    expectedRole,
    reason: t('blueprintVerify.positionReason')
      .replace('{n}', String(chapter))
      .replace('{x}', String(positionPercent))
      .replace('{role}', t(roleKey[expectedRole] ?? 'chapter.role.development')),
  }
}

export function detectInconsistentRoles(blueprints: ChapterBlueprint[], totalChapters: number): InconsistentRole[] {
  return analyzeBlueprintRoles(totalChapters, blueprints, normalizeBlueprintRole).map(presentRoleMismatch)
}

/** Present verification facts from one already loaded blueprint snapshot. */
export function generateVerificationReport(totalChapters: number, blueprints: ChapterBlueprint[]): VerificationReport {
  const facts = analyzeBlueprintSnapshot(totalChapters, blueprints, normalizeBlueprintRole)
  const { missingTitles, severity } = facts
  const inconsistentRoles = facts.inconsistentRoles.map(presentRoleMismatch)
  const gaps: BlueprintGap[] = facts.gaps.map(gap => {
    const { precedingChapter, followingChapter } = gap
    // The gap filler consumes this context verbatim, including the Chinese labels.
    const contextParts: string[] = []
    if (precedingChapter) {
      contextParts.push(`[前一章 第${precedingChapter.chapterNumber}章 ${precedingChapter.title}] ${precedingChapter.keyEvents}`)
    }
    if (followingChapter) {
      contextParts.push(`[后一章 第${followingChapter.chapterNumber}章 ${followingChapter.title}] ${followingChapter.keyEvents}`)
    }
    return { ...gap, gapSize: gap.missingChapterNumbers.length, context: contextParts.join('\n') }
  })

  // 生成摘要
  const summaryParts: string[] = []
  summaryParts.push(t('blueprintVerify.summary').replace('{total}', String(totalChapters)).replace('{existing}', String(blueprints.length)))
  if (gaps.length > 0) {
    const totalMissing = gaps.reduce((sum, g) => sum + g.gapSize, 0)
    summaryParts.push(t('blueprintVerify.gapsFound').replace('{n}', String(gaps.length)).replace('{missing}', String(totalMissing)))
  }
  if (missingTitles.length > 0) {
    summaryParts.push(t('blueprintVerify.missingTitles').replace('{n}', String(missingTitles.length)))
  }
  if (inconsistentRoles.length > 0) {
    summaryParts.push(t('blueprintVerify.roleMismatch').replace('{n}', String(inconsistentRoles.length)))
  }
  if (gaps.length === 0 && missingTitles.length === 0 && inconsistentRoles.length === 0) {
    summaryParts.push(t('blueprintVerify.complete'))
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
