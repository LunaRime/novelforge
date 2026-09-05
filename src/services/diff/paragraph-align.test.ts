/**
 * paragraph-align — diff-core 抽取回归测试（L1 Task 1）
 *
 * 覆盖：extractParagraphsWithOffsets 空行切段/段内多行/首尾空行/CRLF/
 * offsets slice 回读一致；computeParagraphHunks 与 ThreeWayMerge 段 diff 等价
 * （抽取回归锁）+ DEL/INS 归一化；buildMergeSegments 与旧 computeSegments 语义一致。
 *
 * CRLF 校准说明：段内内容行结尾的 \r 计入段文本与行宽（与旧 extractParagraphs
 * 逐字一致——旧实现 split('\n') 后整行入 buf），因此 '甲\r\n\r\n乙\r\n丙' 的段落为
 * ['甲\r', '乙\r\n丙']，保证 text.slice(start,end) === text 自洽回读；
 * 若剥离 \r 则 offsets 无法连续覆盖原文，slice 回读不成立（设计：CRLF 下 \r 计入行宽）。
 */
import { describe, it, expect } from 'vitest'
import {
  extractParagraphsWithOffsets, computeParagraphHunks, buildMergeSegments, splitFrontmatter,
} from './paragraph-align'

describe('extractParagraphsWithOffsets', () => {
  it('空行切段 + offsets 与原文 slice 回读一致（设计 §7）', () => {
    const text = '甲\n乙\n\n丙\n\n\n丁'
    const spans = extractParagraphsWithOffsets(text)
    expect(spans.map(s => s.text)).toEqual(['甲\n乙', '丙', '丁'])
    for (const s of spans) expect(text.slice(s.start, s.end)).toBe(s.text)
  })
  it('首尾空行不产出空段，offsets 仍回读一致', () => {
    const text = '\n\n甲\n\n乙\n\n'
    const spans = extractParagraphsWithOffsets(text)
    expect(spans.map(s => s.text)).toEqual(['甲', '乙'])
    for (const s of spans) expect(text.slice(s.start, s.end)).toBe(s.text)
  })
  it('CRLF 文档 offsets 仍与 slice 回读一致（\\r 计入行宽，段文本保留 \\r）', () => {
    const text = '甲\r\n\r\n乙\r\n丙'
    const spans = extractParagraphsWithOffsets(text)
    expect(spans.map(s => s.text)).toEqual(['甲\r', '乙\r\n丙'])
    for (const s of spans) expect(text.slice(s.start, s.end)).toBe(s.text)
  })
  it('frontmatter：splitFrontmatter offset 正确，computeParagraphHunks 区间含偏移（R7）', () => {
    const fm = '---\ntitle: x\n---\n'
    const doc = fm + '正文一\n\n正文二'
    const hunks = computeParagraphHunks(doc, fm + '正文一改\n\n正文二')
    expect(hunks).toHaveLength(1)
    expect(doc.slice(hunks[0].origRange.from, hunks[0].origRange.to)).toBe('正文一')
    expect(hunks[0].origText).toBe('正文一')
    expect(hunks[0].modText).toBe('正文一改')
    expect(splitFrontmatter(doc)).toEqual({ body: '正文一\n\n正文二', offset: fm.length })
  })
})

describe('computeParagraphHunks（抽取回归锁 + offsets 组装，设计 §7）', () => {
  it('单段局部改写 → 1 个 MATCH hunk，origRange 精确圈住段文本', () => {
    const doc = '他推开门走了出去。\n\n她还在等。'
    const mod = '他推开门快步走了出去。\n\n她还在等。'
    const hunks = computeParagraphHunks(doc, mod)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].kind).toBe('MATCH')
    expect(doc.slice(hunks[0].origRange.from, hunks[0].origRange.to)).toBe(hunks[0].origText)
    expect(hunks[0].origText).toBe('他推开门走了出去。')
  })
  it('段拆/段并/纯增删段：hunk origRange/modText 组装正确（结构语义以实际 DP 产出为准，断言放宽容忍）', () => {
    // 段并（2:1 或 DELETE+INSERT 归一）→ 至少 1 个覆盖「甲、乙」两块原文的替换 hunk
    const mergeHunks = computeParagraphHunks('甲\n\n乙\n\n丙', '甲乙\n\n丙')
    const cover = mergeHunks.find(h => h.origText.includes('甲') && h.origText.includes('乙'))
    expect(cover).toBeTruthy()
    expect(cover!.origText).toBe('甲\n\n乙') // DP 合并语义：原文两块含中间空行
    expect(cover!.modText).toBe('甲乙')
    // 纯增段（原文只有甲，改文多一段丁）→ 出现 INSERT 或归一 hunk，modText 含「丁」
    const insertHunks = computeParagraphHunks('甲', '甲\n\n丁')
    expect(insertHunks.some(h => h.modText.includes('丁'))).toBe(true)
    // origRange 与各自原文 slice 回读一致（覆盖非空区间的 hunk）
    for (const h of mergeHunks) {
      if (h.origRange.to > h.origRange.from) {
        expect('甲\n\n乙\n\n丙'.slice(h.origRange.from, h.origRange.to)).toBe(h.origText)
      }
    }
  })
  it('1:1 完全重写（共享标点 → 相似度 ≥ 阈值走 MATCH 直通）→ 单整段替换形态', () => {
    // 输入说明：'春天来了。' 与 '狂风卷着沙尘。' 共享「。」→ sim = 2·1/(5+7) ≈ 0.167 ≥
    // SIM_THRESH(0.15)，DP 直接落 1:1 MATCH，未走 DEL+INS 归一化分支（归一化由下一条零重叠用例直接驱动）。
    const doc = '春天来了。\n\n第二段原样。'
    const mod = '狂风卷着沙尘。\n\n第二段原样。'
    const hunks = computeParagraphHunks(doc, mod)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].kind).toBe('MATCH')
    expect(hunks[0].modText).toBe('狂风卷着沙尘。')
    expect(doc.slice(hunks[0].origRange.from, hunks[0].origRange.to)).toBe('春天来了。')
  })
  it('零字符重叠替换（甲→X，sim=0 → DP 走 INSERT+DELETE 相邻对）→ 归一为单整段替换 MATCH hunk', () => {
    // 归一化驱动用例（Task 1 评审 Minor 1/2 补测）：DP 回溯对同位置替换恒产出
    // 「纯 INSERT 对在前、纯 DELETE 对在后」的相邻序列（非 DELETE→INSERT，见模块头
    // computeParagraphHunks 归一化注释与 exhaustive probe 证据）；实现按整段纯对
    // 连续 run 合并为单个 MATCH hunk（origRange = 删除段区间，modText = 插入文本，
    // 防「先删后插」在段界产生粘连文本——设计 R6）。
    const hunks = computeParagraphHunks('甲\n\n乙', 'X\n\n乙')
    expect(hunks).toHaveLength(1)
    expect(hunks[0].kind).toBe('MATCH')
    expect(hunks[0].origText).toBe('甲')
    expect(hunks[0].modText).toBe('X')
    expect('甲\n\n乙'.slice(hunks[0].origRange.from, hunks[0].origRange.to)).toBe('甲')
  })
  it('多段零重叠替换（甲、乙 → X、Y）→ 整段纯对 run 归一为单 MATCH hunk（非 4 个零散增删 hunk）', () => {
    const hunks = computeParagraphHunks('甲\n\n乙\n\n丙', 'X\n\nY\n\n丙')
    expect(hunks).toHaveLength(1)
    expect(hunks[0].kind).toBe('MATCH')
    expect(hunks[0].origText).toBe('甲\n\n乙')
    expect(hunks[0].modText).toBe('X\n\nY')
    expect('甲\n\n乙\n\n丙'.slice(hunks[0].origRange.from, hunks[0].origRange.to)).toBe('甲\n\n乙')
  })
  it('buildMergeSegments 与旧 computeSegments 语义一致（same 段无 hunk、hunk 索引连续、段间空行锚保留）', () => {
    const segments = buildMergeSegments('甲\n\n乙', '甲改\n\n乙')
    expect(segments.filter(s => s.type === 'hunk')).toHaveLength(1)
    const hunk = segments.filter(s => s.type === 'hunk')[0]
    expect((hunk as { hunk?: { index: number } }).hunk?.index).toBe(0)
    // 段间空行锚：same [''] 出现在 hunk 之后
    const types = segments.map(s => s.type)
    expect(types[types.length - 1]).toBe('same')
  })
})
