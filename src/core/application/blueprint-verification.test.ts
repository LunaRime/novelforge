import { describe, expect, it } from 'vitest'
import { analyzeBlueprintSnapshot } from './blueprint-verification'

const blueprint = (chapterNumber: number, role = '发展', title = 'Title') => ({ chapterNumber, role, title })
const analyze = (total: number, blueprints: ReturnType<typeof blueprint>[]) =>
  analyzeBlueprintSnapshot(total, blueprints, role => role)

describe('analyzeBlueprintSnapshot', () => {
  it('uses sorted gap boundaries without reordering the input', () => {
    const fourth = blueprint(4)
    const seventh = blueprint(7)
    const snapshot = [seventh, fourth]
    expect(analyze(9, snapshot).gaps).toEqual([
      { missingChapterNumbers: [1, 2, 3], precedingChapter: null, followingChapter: fourth },
      { missingChapterNumbers: [5, 6], precedingChapter: fourth, followingChapter: seventh },
      { missingChapterNumbers: [8, 9], precedingChapter: seventh, followingChapter: null },
    ])
    expect(snapshot).toEqual([seventh, fourth])
  })

  it('uses the full configured chapter count for role placement in a partial snapshot', () => {
    expect(analyze(100, [blueprint(12, '铺垫'), blueprint(20, '建置')]).inconsistentRoles).toEqual([
      { chapter: 20, role: '建置', expectedRole: '铺垫', positionPercent: 20 },
    ])
  })

  it('reports empty and default titles without changing coverage severity', () => {
    const snapshot = [blueprint(1, '发展', ''), blueprint(2, '发展', '第2章'), blueprint(3)]
    expect(analyze(3, snapshot)).toMatchObject({ missingTitles: [1, 2], severity: 'ok' })
    expect(analyze(4, snapshot).severity).toBe('critical')
    expect(analyze(5, [...snapshot, blueprint(4)]).severity).toBe('warning')
  })

  it('has no gaps or coverage warning when the total is unset and the snapshot is empty', () => {
    expect(analyze(0, [])).toMatchObject({ gaps: [], severity: 'ok' })
  })
})
