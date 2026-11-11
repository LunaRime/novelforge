interface BlueprintVerificationEntry {
  chapterNumber: number
  title: string
  role: string
}

interface BlueprintGapFacts<T> {
  missingChapterNumbers: number[]
  precedingChapter: T | null
  followingChapter: T | null
}

export interface BlueprintRoleMismatch {
  chapter: number
  role: string
  expectedRole: string
  positionPercent: number
}

export type BlueprintVerificationSeverity = 'ok' | 'warning' | 'critical'

function expectedRoleAt(position: number): string {
  if (position <= 0.1) return '建置'
  if (position <= 0.2) return '铺垫'
  if (position <= 0.35) return '发展'
  if (position <= 0.5) return '冲突'
  if (position <= 0.65) return '高潮'
  if (position <= 0.85) return '转折'
  return '收尾'
}

export function analyzeBlueprintRoles(
  totalChapters: number,
  blueprints: readonly BlueprintVerificationEntry[],
  normalizeRole: (role: string) => string,
): BlueprintRoleMismatch[] {
  const mismatches: BlueprintRoleMismatch[] = []
  for (const { chapterNumber, role: rawRole } of blueprints) {
    const role = normalizeRole(rawRole)
    if (role === '发展') continue

    // Compare positions against the configured book length even in a partial snapshot.
    const position = chapterNumber / totalChapters
    const expectedRole = expectedRoleAt(position)
    if (role !== expectedRole) {
      mismatches.push({ chapter: chapterNumber, role, expectedRole, positionPercent: Math.round(position * 100) })
    }
  }
  return mismatches
}

export function analyzeBlueprintSnapshot<T extends BlueprintVerificationEntry>(
  totalChapters: number,
  blueprints: readonly T[],
  normalizeRole: (role: string) => string,
) {
  const gaps: BlueprintGapFacts<T>[] = []
  let nextChapter = 1
  let precedingChapter: T | null = null
  const appendGap = (end: number, followingChapter: T | null) => {
    if (nextChapter <= end) {
      gaps.push({
        missingChapterNumbers: Array.from({ length: end - nextChapter + 1 }, (_, index) => nextChapter + index),
        precedingChapter,
        followingChapter,
      })
    }
  }

  for (const blueprint of [...blueprints].sort((a, b) => a.chapterNumber - b.chapterNumber)) {
    if (blueprint.chapterNumber < nextChapter) continue
    appendGap(Math.min(blueprint.chapterNumber - 1, totalChapters), blueprint)
    nextChapter = blueprint.chapterNumber + 1
    precedingChapter = blueprint
    if (nextChapter > totalChapters) break
  }
  appendGap(totalChapters, null)

  const missingTitles = blueprints
    .filter(({ title, chapterNumber }) => !title || title === `第${chapterNumber}章`)
    .map(({ chapterNumber }) => chapterNumber)
  const inconsistentRoles = analyzeBlueprintRoles(totalChapters, blueprints, normalizeRole)
  const coverage = blueprints.length / totalChapters
  const severity: BlueprintVerificationSeverity = coverage < 0.5 || gaps.length > totalChapters * 0.2 ? 'critical'
    : coverage < 0.8 || gaps.length > 0 ? 'warning' : 'ok'

  return { gaps, missingTitles, inconsistentRoles, severity }
}
