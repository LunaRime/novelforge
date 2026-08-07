import { describe, it, expect } from 'vitest'
import {
  repetitionAudit,
  waterAudit,
  continuityAudit,
  terminologyAudit,
  blueprintAudit,
  sensitiveAudit,
  timelineAudit,
  extractTimelineAnchors,
  buildBaselineFreqs,
  extractSettingNouns,
  runAllAudits,
} from './audits'

describe('repetitionAudit', () => {
  it('检出高频重复词（对话区豁免）', () => {
    const text = '他苦笑一声。众人苦笑点头。老者苦笑摇头。'
    const r = repetitionAudit(text, { maxRepeat: 3 })
    expect(r.issues.length).toBeGreaterThan(0)
    expect(r.issues[0].message).toContain('苦笑')
  })

  it('对话区口头禅不报警', () => {
    const text = '“好的好的好的。”他说。“好的好的。”她答。'
    const r = repetitionAudit(text)
    // 对话区被剥离，正文无重复词
    expect(r.passed).toBe(true)
  })

  it('角色名等专名高频出现不报警（excludeWords 豁免）', () => {
    const text = '苏晚向前一步。苏晚抬头望天。苏晚笑了笑。苏晚摇头。苏晚转身。苏晚落座。苏晚端茶。苏晚抿了一口。'
    const r = repetitionAudit(text, { excludeWords: ['苏晚'] })
    expect(r.passed).toBe(true)
  })

  it('默认阈值随正文长度动态提升（短文本不误报）', () => {
    // 固定阈值 3 会把「世界」11 次这类正常语境词误报为水文；
    // 默认阈值 = max(8, 字数/300)，短文本下限 8 次
    const text = '世界。世界。世界。世界。世界。世界。世界。' // 7 次 < 8
    const r = repetitionAudit(text)
    expect(r.passed).toBe(true)
  })
})

describe('waterAudit 句子重复', () => {
  it('短句完全重复 ≥3 次报警（error 级）', () => {
    const text = '他点了点头。他点了点头。他点了点头。随后离开。'
    const r = waterAudit(text)
    const issue = r.issues.find(i => i.message.includes('完整句子重复'))
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe('error')
    expect(issue?.message).toContain('他点了点头')
  })

  it('长句完全重复 ≥2 次报警（AI 复读）', () => {
    const text = '他缓缓抬起头，目光扫过在场每一个人的面孔，最终停在窗外的暮色上。他缓缓抬起头，目光扫过在场每一个人的面孔，最终停在窗外的暮色上。'
    const r = waterAudit(text)
    expect(r.issues.some(i => i.message.includes('完整句子重复'))).toBe(true)
  })

  it('句子各不相同不报警', () => {
    const text = '他走进门。她抬起头。众人围了过来。老者率先开口。'
    const r = waterAudit(text)
    expect(r.issues.some(i => i.message.includes('完整句子重复'))).toBe(false)
  })
})

describe('waterAudit 句首模板', () => {
  it('同一句首 3 字模板 ≥6 次报警（句式单调）', () => {
    const text = '他缓缓站起身，望向远处。他缓缓推开窗，深吸一口气。他缓缓坐下，整理衣襟。他缓缓迈步，走向大门。他缓缓握拳，指节发白。他缓缓抬头，对上目光。他缓缓转身，消失在门后。'
    const r = waterAudit(text)
    const issue = r.issues.find(i => i.message.includes('句首'))
    expect(issue).toBeDefined()
    expect(issue?.message).toContain('他缓缓')
  })

  it('对话引导语（他说/她道）句首不报警', () => {
    const text = '他说。她点了点头。他说。她摇了摇头。他说。她抿嘴一笑。他说。她垂下眼帘。他说。她别过脸去。他说。她轻轻应了一声。'
    const r = waterAudit(text)
    expect(r.issues.some(i => i.message.includes('句首'))).toBe(false)
  })

  it('角色名开头的句子不算句式单调', () => {
    const text = '苏晚向前一步。苏晚抬头望天。苏晚笑了笑。苏晚摇头。苏晚转身。苏晚落座。苏晚端茶。苏晚抿了一口。'
    const r = waterAudit(text, { excludeWords: ['苏晚'] })
    expect(r.issues.some(i => i.message.includes('句首'))).toBe(false)
  })
})

describe('waterAudit 白名单', () => {
  it('whitelist.words 豁免词频、patterns 豁免句首', () => {
    const text = '他缓缓起身。他缓缓坐下。他缓缓抬头。他缓缓低头。他缓缓握拳。他缓缓松手。他缓缓迈步。他缓缓停步。他缓缓闭眼。他缓缓睁眼。'
    const r = waterAudit(text, { whitelist: { words: ['缓缓'], patterns: ['他缓缓'] } })
    expect(r.passed).toBe(true)
  })

  it('whitelist.sentences 豁免故意复用的句子', () => {
    const text = '大道无形。大道无形。大道无形。'
    const r = waterAudit(text, { whitelist: { sentences: ['大道无形'] } })
    expect(r.passed).toBe(true)
  })

  it('无白名单时句子重复仍报警', () => {
    const text = '大道无形。大道无形。大道无形。'
    const r = waterAudit(text)
    expect(r.issues.some(i => i.message.includes('完整句子重复'))).toBe(true)
  })
})

describe('buildBaselineFreqs', () => {
  it('跨章稳定词入基线（均值），单章偶然词不入', () => {
    const ch1 = '苏晚踏入魂殿。苏晚见到老乞。' // 苏晚 2
    const ch2 = '苏晚离开魂殿。苏晚告别老乞。' // 苏晚 2
    const ch3 = '苏晚回到住处。' // 苏晚 1
    const b = buildBaselineFreqs([ch1, ch2, ch3])
    expect(b['苏晚']).toBeCloseTo(5 / 3, 5)
    expect(b['魂殿']).toBe(1) // 出现 2 章，均值 1
    expect(b['老乞']).toBe(1)
    expect(b['踏入']).toBeUndefined() // 单章偶然词不构成"本书正常密度"
  })

  it('少于 2 章返回空表（调用方回退动态阈值）', () => {
    expect(buildBaselineFreqs([])).toEqual({})
    expect(buildBaselineFreqs(['只有一章'])).toEqual({})
  })
})

describe('repetitionAudit 基线频率', () => {
  it('基线内高频词不报警（专名/场景词天然豁免）', () => {
    // 「苦笑」本书每章约 4 次 → 本章 4 次属正常密度，不报
    const text = '他苦笑。她苦笑。众人苦笑。老者苦笑。'
    const r = repetitionAudit(text, { baselineFreqs: { 苦笑: 4 } })
    expect(r.passed).toBe(true)
  })

  it('超基线 ×2 且过绝对下限才报警（真水文）', () => {
    const text = '他苦笑。她苦笑。众人苦笑。老者苦笑。他苦笑。她苦笑。众人苦笑。老者苦笑。他苦笑。她苦笑。' // 苦笑 10
    const r = repetitionAudit(text, { baselineFreqs: { 苦笑: 4 } })
    expect(r.issues.length).toBeGreaterThan(0)
    expect(r.issues[0].message).toContain('苦笑')
  })

  it('无基线时回退动态阈值', () => {
    const r = repetitionAudit('他苦笑。她苦笑。众人苦笑。老者苦笑。', { baselineFreqs: {} })
    expect(r.passed).toBe(true) // 4 次 < 动态阈值 8
  })
})

describe('extractSettingNouns', () => {
  it('提取引号内专名与高频设定词，过滤通用词', () => {
    const world = '「武魂」是大陆上最古老的力量体系。「魂殿」掌控武魂秘辛。武魂、魂殿与天地灵气相生相克。'
    const nouns = extractSettingNouns(world)
    expect(nouns).toContain('武魂')
    expect(nouns).toContain('魂殿')
    expect(nouns).not.toContain('大陆') // 通用词混入会让水文检测失效
    expect(nouns).not.toContain('天地')
  })

  it('空文本返回空数组', () => {
    expect(extractSettingNouns('')).toEqual([])
    expect(extractSettingNouns('   ')).toEqual([])
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
  it('提取时间锚点（X天后标记为相对增量）', () => {
    const anchors = extractTimelineAnchors('第一天他出发。次日到达。三天后决战。')
    expect(anchors.map(a => a.dayOffset)).toEqual([1, 2, 3])
    expect(anchors.map(a => a.delta)).toEqual([false, false, true])
  })

  it('「X天后」按相对增量推进，不误报（误报场景）', () => {
    // 绝对模式会把「一天后」当第 1 天 → 误报「1 出现在已过 2 天之后」；
    // 增量模式：第二天(2) → 一天后(2+1=3) 线性推进
    const r = timelineAudit('第二天出发。一天后到达。')
    expect(r.issues.length).toBe(0)
  })

  it('时间倒序报警', () => {
    const r = timelineAudit('第五天他回来了。第二天他却离开了。')
    expect(r.issues.length).toBeGreaterThan(0)
  })

  it('时间正序通过', () => {
    const r = timelineAudit('第一天出发。次日到达。三天后决战。')
    expect(r.passed).toBe(true)
  })

  it('对话区时间词不误报', () => {
    // 台词里的"第三天"不是叙事时间
    const r = timelineAudit('他说道："第三天我们在城门口见。"随后离开。')
    expect(r.issues.length).toBe(0)
  })

  it('「当天」是指代性锚点，不参与检测（误报场景）', () => {
    // 正文：「已过 2 天」之后写「当天」指代那天，叙事合法——不得报警
    const r = timelineAudit('次日苏晚来到魂殿。当天傍晚，她见到了老乞。')
    expect(r.issues.length).toBe(0)
  })

  it('「X天前」闪回/倒叙不报警（正常叙事手法）', () => {
    const r = timelineAudit('第五天他回来了。三天前他还在北境。')
    expect(r.issues.length).toBe(0)
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

describe('重复词检测误报优化（用户实测回归）', () => {
  // 用户实测误报词：碎片35/虚脉21（术语）、了一18/枚碎18/的虚17（跨词边界碎片）、
  // 第二11（序数）、小屋8（场景词）——跨词边界碎片应永不报警，场景词靠阈值放宽

  it('跨词边界 2-gram 碎片不报警（了一/枚碎/的虚/第二）', () => {
    const text = ('他走了一程又一程。四枚碎片散落在地。这的虚脉渐渐凝实。第二天清晨出发。').repeat(10)
    const r = waterAudit(text)
    const words = r.issues.map(i => i.message)
    expect(words.some(m => m.includes('「了一」'))).toBe(false)
    expect(words.some(m => m.includes('「枚碎」'))).toBe(false)
    expect(words.some(m => m.includes('「的虚」'))).toBe(false)
    expect(words.some(m => m.includes('「第二」'))).toBe(false)
  })

  it('实词组合不受虚字过滤影响（碎片仍参与检测）', () => {
    const text = '碎片'.repeat(30)
    const r = waterAudit(text, { maxRepeat: 8 })
    expect(r.issues.some(i => i.message.includes('「碎片」'))).toBe(true)
  })

  it('无基线默认阈值下限 10：8-9 次场景词不报警（旧阈值 8 误报「小屋」）', () => {
    const text = ('小屋'.repeat(8) + '。')
    const r = waterAudit(text)
    expect(r.issues.some(i => i.message.includes('「小屋」'))).toBe(false)
  })

  it('新术语集中章（碎片 9 次）默认阈值下不报警，超阈值仍报', () => {
    const low = waterAudit('碎片。'.repeat(9))
    expect(low.issues.some(i => i.message.includes('「碎片」'))).toBe(false)
    const high = waterAudit('碎片。'.repeat(12))
    expect(high.issues.some(i => i.message.includes('「碎片」'))).toBe(true)
  })
})
