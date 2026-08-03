import { describe, it, expect } from 'vitest'
import {
  repetitionAudit,
  continuityAudit,
  terminologyAudit,
  blueprintAudit,
  sensitiveAudit,
  timelineAudit,
  extractTimelineAnchors,
  runAllAudits,
} from './audits'

describe('repetitionAudit', () => {
  it('检出高频重复词（对话区豁免）', () => {
    const text = '他苦笑一声。众人苦笑点头。老者苦笑摇头。'
    const r = repetitionAudit(text)
    expect(r.issues.length).toBeGreaterThan(0)
    expect(r.issues[0].message).toContain('苦笑')
  })

  it('对话区口头禅不报警', () => {
    const text = '“好的好的好的。”他说。“好的好的。”她答。'
    const r = repetitionAudit(text)
    // 对话区被剥离，正文无重复词
    expect(r.passed).toBe(true)
  })
})

describe('continuityAudit', () => {
  it('无上章结尾时通过', () => {
    const r = continuityAudit('开头内容')
    expect(r.passed).toBe(true)
  })

  it('开头与上章结尾重叠少时报警', () => {
    const r = continuityAudit('全新的场景开始了。', '完全不同的内容结尾。')
    expect(r.issues.length).toBeGreaterThan(0)
  })
})

describe('terminologyAudit', () => {
  it('检出角色名疑似变体', () => {
    const r = terminologyAudit('上官婉儿拔剑。上官婉向前一步。', ['上官婉儿'])
    expect(r.issues.length).toBeGreaterThan(0)
    expect(r.issues[0].message).toContain('上官婉')
  })

  it('术语全部一致时通过', () => {
    const r = terminologyAudit('上官婉儿拔剑。上官婉儿收剑。', ['上官婉儿'])
    expect(r.passed).toBe(true)
  })
})

describe('blueprintAudit', () => {
  it('关键事件未体现时报警', () => {
    const r = blueprintAudit('他走在路上，风很大。', ['主角获得传承戒指'])
    expect(r.issues.length).toBeGreaterThan(0)
  })

  it('关键事件体现时通过', () => {
    const r = blueprintAudit('主角在洞中获得一枚传承戒指，戒指上刻着古老的纹路。', ['主角获得传承戒指'])
    expect(r.passed).toBe(true)
  })
})

describe('sensitiveAudit', () => {
  it('命中违禁词报警', () => {
    const r = sensitiveAudit('这里的描写涉及血腥场面。', ['血腥'])
    expect(r.issues.length).toBe(1)
  })
})

describe('timelineAudit', () => {
  it('提取时间锚点', () => {
    const anchors = extractTimelineAnchors('第一天他出发。次日到达。三天后决战。')
    expect(anchors.map(a => a.dayOffset)).toEqual([1, 2, 3])
  })

  it('时间倒序报警', () => {
    const r = timelineAudit('第五天他回来了。第二天他却离开了。')
    expect(r.issues.length).toBeGreaterThan(0)
  })

  it('时间正序通过', () => {
    const r = timelineAudit('第一天出发。次日到达。三天后决战。')
    expect(r.passed).toBe(true)
  })
})

describe('runAllAudits', () => {
  it('聚合全部审计', () => {
    const r = runAllAudits({
      chapterText: '他苦笑一声。第一天出发，次日到达。',
      prevChapterEnding: '完全不同',
      keyEvents: ['获得传承戒指'],
      terms: ['上官婉儿'],
    })
    expect(r.issues.length).toBeGreaterThan(0)
    expect(r.summary).toContain('问题')
  })
})
