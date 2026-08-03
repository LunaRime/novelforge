import { describe, it, expect } from 'vitest'
import { splitChaptersIntoVolumes, volumeChapterCount } from './volume-utils'

describe('splitChaptersIntoVolumes', () => {
  it('整除均分', () => {
    const r = splitChaptersIntoVolumes(100, 4)
    expect(r).toEqual([
      { volumeNumber: 1, chapterStart: 1, chapterEnd: 25 },
      { volumeNumber: 2, chapterStart: 26, chapterEnd: 50 },
      { volumeNumber: 3, chapterStart: 51, chapterEnd: 75 },
      { volumeNumber: 4, chapterStart: 76, chapterEnd: 100 },
    ])
  })

  it('余数分散到前面的卷', () => {
    const r = splitChaptersIntoVolumes(100, 3)
    expect(r).toEqual([
      { volumeNumber: 1, chapterStart: 1, chapterEnd: 34 },
      { volumeNumber: 2, chapterStart: 35, chapterEnd: 67 },
      { volumeNumber: 3, chapterStart: 68, chapterEnd: 100 },
    ])
  })

  it('卷数超过章节数时每卷至少 1 章', () => {
    const r = splitChaptersIntoVolumes(3, 5)
    expect(r.length).toBe(3)
    expect(r[2]).toEqual({ volumeNumber: 3, chapterStart: 3, chapterEnd: 3 })
  })

  it('非法输入返回空数组', () => {
    expect(splitChaptersIntoVolumes(0, 4)).toEqual([])
    expect(splitChaptersIntoVolumes(10, 0)).toEqual([])
  })
})

describe('volumeChapterCount', () => {
  it('有明确终点按范围计算', () => {
    expect(volumeChapterCount(1, 20, 100)).toBe(20)
    expect(volumeChapterCount(21, 50, 100)).toBe(30)
  })

  it('进行中卷（end=0）按总章数推断', () => {
    expect(volumeChapterCount(1, 0, 100)).toBe(100)
    expect(volumeChapterCount(30, 0, 100)).toBe(71)
  })
})
