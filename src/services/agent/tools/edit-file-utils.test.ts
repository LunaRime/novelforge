/**
 * edit_file 纯函数引擎测试（C2 / CC §三.3）——三层匹配降级链 + 引号回映 + preserveQuoteStyle + 尾换行语义。
 * node 环境：edit-file-utils.ts 无 locale/store/ipc 依赖（纯函数层铁律）。
 */
import { describe, it, expect } from 'vitest'
import {
  adaptTextToQuoteStyle,
  applySpanEdit,
  consumeTrailingNewline,
  DESANITIZE_MAP,
  desanitizeText,
  detectFileQuoteStyle,
  detectRegionAwareQuoteStyle,
  EDIT_CONTEXT_MAX_CHARS,
  findEditMatch,
  normalizeQuoteKey,
  trimModelTrailingWhitespace,
  truncateContextAtLineBoundary,
  type EditMatch,
} from './edit-file-utils'

// ===== 反脱敏层（L2） =====

describe('反脱敏层（L2）', () => {
  it('生产表当前为空（调研结论：NF 管道无可逆脱敏占位符）→ desanitizeText 恒等', () => {
    expect(DESANITIZE_MAP).toHaveLength(0)
    expect(desanitizeText('&lt;fnr&gt; <function_results> 原文')).toBe('&lt;fnr&gt; <function_results> 原文')
  })

  it('表驱动：条目把 LLM 可见的脱敏形态回退为文件真实形态（全量替换）', () => {
    const map: ReadonlyArray<readonly [string, string]> = [
      ['&lt;fnr&gt;', '<function_results>'],
      ['&lt;tool_call&gt;', '<tool_call>'],
    ]
    expect(desanitizeText('&lt;fnr&gt; 完成', map)).toBe('<function_results> 完成')
    expect(desanitizeText('&lt;tool_call&gt;x&lt;tool_call&gt;', map)).toBe('<tool_call>x<tool_call>')
  })

  it('注入映射表后降级链可命中（L2 架构验证）；无注入则精确失败 → null', () => {
    const file = '<function_results> 已返回：完成。'
    const map: ReadonlyArray<readonly [string, string]> = [['&lt;fnr&gt;', '<function_results>']]
    // 脱敏形态 old_string（LLM 在 observation 中可能看到的写法）→ 反脱敏后命中文件真实文本
    const hit = findEditMatch(file, '&lt;fnr&gt; 已返回', { desanitizeMap: map })
    expect(hit).not.toBeNull()
    expect(hit!.layer).toBe('desanitized')
    expect(hit!.matchedText).toBe('<function_results> 已返回')
    expect(hit!.start).toBe(0)
    // 默认空表 → 无映射可用 → 匹配失败（不能臆造）
    expect(findEditMatch(file, '&lt;fnr&gt; 已返回')).toBeNull()
  })
})

// ===== L1 精确 / L3 空格 / L4 引号 =====

describe('匹配降级链：L1 精确 + 多命中', () => {
  it('精确命中：层=exact、span/回映=原文、occurrenceTotal=1', () => {
    const file = '他是主角。'
    const m = findEditMatch(file, '主角')
    expect(m).not.toBeNull()
    expect(m!.layer).toBe('exact')
    expect(m!.start).toBe(2)
    expect(m!.end).toBe(4)
    expect(m!.matchedText).toBe('主角')
    expect(m!.occurrenceTotal).toBe(1)
  })

  it('多处命中：替换取第一处，occurrenceTotal 报告总数', () => {
    const file = '重复重复重复'
    const m = findEditMatch(file, '重复')
    expect(m!.start).toBe(0)
    expect(m!.occurrenceTotal).toBe(3)
  })

  it('未命中 → null（不臆造匹配）', () => {
    expect(findEditMatch('甲乙丙', '丁')).toBeNull()
    expect(findEditMatch('', 'x')).toBeNull()
  })

  it('空 old_string → null（调用方另有专门错误）', () => {
    expect(findEditMatch('anything', '')).toBeNull()
  })
})

describe('匹配降级链：L3 模型侧尾随空格松弛', () => {
  it('模型 old_string 带尾随空格而文件没有 → 剥模型侧后命中（回映文件真实文本）', () => {
    const m = findEditMatch('alpha beta', 'alpha beta ')
    expect(m).not.toBeNull()
    expect(m!.layer).toBe('whitespace')
    expect(m!.matchedText).toBe('alpha beta')
  })

  it('模型 old_string 行尾多余空格 → 逐行剥后命中', () => {
    const m = findEditMatch('a\nb\nc', 'a \nb\nc ')
    expect(m!.layer).toBe('whitespace')
    expect(m!.matchedText).toBe('a\nb\nc')
  })

  it('.md 硬换行保护：文件行尾 2 空格是语义内容，模型漏写空格不得命中（不能猜测破坏硬换行）', () => {
    // 模型把 '第一行  \n第二行' 转写为 '第一行\n第二行'（丢了硬换行的 2 空格）→ 必须匹配失败
    const file = '第一行  \n第二行' // 行尾两个空格 = Markdown 硬换行
    const m = findEditMatch(file, '第一行\n第二行')
    expect(m).toBeNull()
    // 反向（模型多写空格、文件无）允许——只裁模型侧，文件侧零改动
    const ok = findEditMatch('a\nb', 'a \nb')
    expect(ok).not.toBeNull()
    expect(ok!.layer).toBe('whitespace')
  })

  it('allowModelTrailingWhitespace=false 关闭该层', () => {
    expect(findEditMatch('alpha beta', 'alpha beta ', { allowModelTrailingWhitespace: false })).toBeNull()
  })
})

describe('匹配降级链：L4 引号归一化 + 回映', () => {
  it('中文弯双引号：模型直引号 → 归一化命中并回映文件弯引号真实子串', () => {
    // fixture 只在引号上差异（冒号/句读等标点逐字一致——引号归一化不做标点宽度转换）
    const file = '他说：“你好。”'
    const old = '他说："你好。"'
    const m = findEditMatch(file, old)
    expect(m).not.toBeNull()
    expect(m!.layer).toBe('quotes')
    expect(m!.matchedText).toBe('他说：“你好。”')
    expect(file.slice(m!.start, m!.end)).toBe(m!.matchedText)
  })

  it('英文缩写撇号：文件弯撇号（don’t）↔ 模型直撇号（don\'t）族内互换', () => {
    const m = findEditMatch('don’t stop believin’', "don't stop")
    expect(m).not.toBeNull()
    expect(m!.layer).toBe('quotes')
    expect(m!.matchedText).toBe('don’t stop')
  })

  it('中文弯双引号 → 模型弯引号（文件相反方向：文件直引号、模型弯引号同样族内命中）', () => {
    const m = findEditMatch('他说"好"走了', '他说“好”走了')
    expect(m!.layer).toBe('quotes')
    expect(m!.matchedText).toBe('他说"好"走了')
  })

  it('跨族不匹配：文件直角引号「」/弯单引号，模型直双引号不得命中（防错误回映）', () => {
    expect(findEditMatch('「你好」', '"你好"')).toBeNull()
    expect(findEditMatch('‘你好’', '"你好"')).toBeNull()
    expect(findEditMatch('“你好”', "'你好'")).toBeNull()
  })

  it('多个同形候选（内容相同、引号差异相同）→ 取最早一处（occurrenceTotal = 候选数）', () => {
    const file = '“你好”，然后“你好”。' // 两处相同弯引号对，与直引号 old 差异相同
    const m = findEditMatch(file, '"你好"')
    expect(m!.layer).toBe('quotes')
    expect(m!.start).toBe(0)
    expect(m!.matchedText).toBe('“你好”')
    expect(m!.occurrenceTotal).toBe(2)
  })

  it('多个候选 → 择优（引号差异最少者），非简单取最早', () => {
    // 两处候选：'说“好”'（与 old 差异 2：开/闭都不同）vs '说"好”'（差异 1：仅闭不同）
    const file = 'A说“好”B说"好”C'
    const m = findEditMatch(file, '说"好“')
    expect(m).not.toBeNull()
    expect(m!.layer).toBe('quotes')
    expect(m!.start).toBe(6) // 差异更少的第二处
    expect(m!.matchedText).toBe('说"好”')
  })

  it('normalizeQuoteKey 长度不变（1:1 映射 → 偏移可直接回映文件）', () => {
    const text = 'a"b“c”d\'e‘f’g'
    const key = normalizeQuoteKey(text)
    expect(key.length).toBe(text.length)
  })
})

// ===== preserveQuoteStyle =====

describe('detectFileQuoteStyle', () => {
  it('纯弯 / 纯直 / 持平 / 无证据', () => {
    expect(detectFileQuoteStyle('“弯”')).toEqual({ double: 'curly', single: 'none' })
    expect(detectFileQuoteStyle('"直"')).toEqual({ double: 'straight', single: 'none' })
    expect(detectFileQuoteStyle('"一“二”三"')).toEqual({ double: 'none', single: 'none' })
    expect(detectFileQuoteStyle('无引号')).toEqual({ double: 'none', single: 'none' })
  })

  it('单引号族独立判定（含撇号形态）', () => {
    expect(detectFileQuoteStyle("don't stop")).toEqual({ double: 'none', single: 'straight' })
    expect(detectFileQuoteStyle('don’t stop')).toEqual({ double: 'none', single: 'curly' })
  })
})

describe('adaptTextToQuoteStyle（preserveQuoteStyle 回填）', () => {
  const curlyDouble = { double: 'curly', single: 'none' } as const
  const straightAll = { double: 'straight', single: 'straight' } as const

  it('文件弯双引号 → 模型直引号按开/闭交替回填', () => {
    expect(adaptTextToQuoteStyle('他说："好。"', curlyDouble)).toBe('他说：“好。”')
    expect(adaptTextToQuoteStyle('"alpha" and "beta"', curlyDouble)).toBe('“alpha” and “beta”')
  })

  it('开/闭交替状态在换行处重置（中文对话每行独立一对）', () => {
    expect(adaptTextToQuoteStyle('"a"\n"b"', curlyDouble)).toBe('“a”\n“b”')
  })

  it('单引号族回填：缩写撇号（两侧词字符）→ 右弯撇号，不参与开/闭交替', () => {
    const styles = { double: 'none', single: 'curly' } as const
    // it's → 撇号形态 ’；'x' → 成对 ‘x’
    expect(adaptTextToQuoteStyle("it's 'x'", styles)).toBe('it’s ‘x’')
    expect(adaptTextToQuoteStyle("O'Brien", styles)).toBe('O’Brien')
  })

  it('文件直引号为主 → 弯引号转直（风格统一反向）', () => {
    expect(adaptTextToQuoteStyle('“a” ‘b’', straightAll)).toBe('"a" \'b\'')
  })

  it('直角引号「」不参与转换（跨族回填是猜测，v1 裁决不做）', () => {
    expect(adaptTextToQuoteStyle('「原样」"转弯"', curlyDouble)).toBe('「原样」“转弯”')
  })

  it('无证据/持平（none）→ 文本原样不动', () => {
    const none = { double: 'none', single: 'none' } as const
    expect(adaptTextToQuoteStyle('"保持"', none)).toBe('"保持"')
  })
})

// ===== 区域感知风格（评审 Finding 2） =====

describe('detectRegionAwareQuoteStyle（命中区优先，全文件多数决仅兜底）', () => {
  it('弯引号主文件的直引号区（JSON/代码块）→ 区域直 → 保持直（不被全文件转弯）', () => {
    const file = '“弯一”“弯二”\n{"a": "b"}\n“弯三”'
    const region = '{"a": "b"}' // 命中区真实文本
    const styles = detectRegionAwareQuoteStyle(region, file)
    expect(styles.double).toBe('straight')
    // 回填验证：直引号 new_string 逐字保持
    expect(adaptTextToQuoteStyle('{"k": "v"}', styles)).toBe('{"k": "v"}')
  })

  it('命中区该族无证据 → 回退全文件多数决（new_string 引入命中区没有的引号族）', () => {
    const file = '“弯文”' // 全文件弯双引号
    const region = '无引号区'
    const styles = detectRegionAwareQuoteStyle(region, file)
    expect(styles.double).toBe('curly')
    expect(adaptTextToQuoteStyle('"引入"', styles)).toBe('“引入”')
  })

  it('族独立：命中区单引号族弯、双引号族无证据 → 单引号按区域、双引号按全文件', () => {
    const file = '"直双引号"文件。don’t'
    const region = 'it’s ok' // 单引号弯、双引号无
    const styles = detectRegionAwareQuoteStyle(region, file)
    expect(styles.single).toBe('curly')
    expect(styles.double).toBe('straight') // 全文件直双引号兜底
  })

  it('区域与全文件都无证据/持平 → none 不动', () => {
    const styles = detectRegionAwareQuoteStyle('无引号', '同样无引号')
    expect(styles).toEqual({ double: 'none', single: 'none' })
    expect(adaptTextToQuoteStyle('"原样"', styles)).toBe('"原样"')
  })
})

// ===== 尾换行语义 =====

describe('尾换行语义（附带，对齐 CC）', () => {
  it('删除独占一行片段 → 连带删除尾换行（不留空行）', () => {
    const r = applySpanEdit('a\nb\nc\n', 2, 3, 'b', '')
    expect(r.content).toBe('a\nc\n')
    expect(r.removedChars).toBe(2) // 'b\n'
    expect(r.addedChars).toBe(0)
  })

  it('整行内容替换（old 无换行、new 无换行）→ 不消费文件换行（new 与下行用原 \n 分隔）', () => {
    const r = applySpanEdit('a\nb\nc\n', 2, 3, 'b', 'x')
    expect(r.content).toBe('a\nx\nc\n')
    expect(r.removedChars).toBe(1)
    expect(r.addedChars).toBe(1)
  })

  it('old_string 自带行尾换行而 new 没有 → 补 \n 对称防护（防与下行粘连）', () => {
    const r = applySpanEdit('a\nb\nc\n', 2, 4, 'b\n', 'x')
    expect(r.content).toBe('a\nx\nc\n')
    expect(r.removedChars).toBe(2)
    expect(r.addedChars).toBe(2) // 'x' + 补的 '\n'
  })

  it('old 不以换行结尾、new 以换行结尾 → 连带消费文件尾换行（等价但不留双空行）', () => {
    const r = applySpanEdit('a\nb\nc\n', 2, 3, 'b', 'x\n')
    expect(r.content).toBe('a\nx\nc\n')
  })

  it('文件首行整行删除（start===0）同样消费尾换行', () => {
    const r = applySpanEdit('ab\ncd', 0, 2, 'ab', '')
    expect(r.content).toBe('cd')
    expect(r.removedChars).toBe(3) // 'ab\n'
  })

  it('行尾片段（段末标点）删除 → 不消费尾换行（评审 Finding 1：不并段落行）', () => {
    const r = applySpanEdit('第一段结尾。\n第二段开始。\n', 5, 6, '。', '')
    expect(r.content).toBe('第一段结尾\n第二段开始。\n') // '。' 被删但 \n 保留，两段不合并
    expect(r.removedChars).toBe(1)
  })

  it('md 段落边界（\\n\\n）保留：行尾片段删除不得塌缩段落分隔（评审 Finding 1）', () => {
    const r = applySpanEdit('第一段结尾。\n\n第二段开始。\n', 5, 6, '。', '')
    expect(r.content).toBe('第一段结尾\n\n第二段开始。\n') // \n\n 原样保留
  })

  it('行中片段（后无换行）删除 → 不消费任何字符', () => {
    const r = applySpanEdit('alpha beta gamma', 6, 10, 'beta', '')
    expect(r.content).toBe('alpha  gamma') // 双侧空格保留
    expect(r.removedChars).toBe(4)
  })

  it('consumeTrailingNewline 单测：边界条件（整行门控 + 行尾判定）', () => {
    // 整行（前字符为 \n）删除 → 消费
    expect(consumeTrailingNewline('a\nb\nc', 2, 3, 'b', '')).toBe(4)
    // 文件首行（start===0）删除 → 消费
    expect(consumeTrailingNewline('ab\ncd', 0, 2, 'ab', '')).toBe(3)
    // 整行 + 无换行替换 → 不消费
    expect(consumeTrailingNewline('a\nb\nc', 2, 3, 'b', 'x')).toBe(3)
    // 非整行（行尾片段）删除 → 不消费（评审 Finding 1）
    expect(consumeTrailingNewline('x。\ny', 1, 2, '。', '')).toBe(2)
    // 文件尾无 \n → 不消费
    expect(consumeTrailingNewline('a\nb', 2, 3, 'b', '')).toBe(3)
    // old 自带 \n → 不消费（命中区已含行分隔）
    expect(consumeTrailingNewline('a\nb\nc', 2, 4, 'b\n', '')).toBe(4)
  })
})

// ===== 上下文截断 =====

describe('truncateContextAtLineBoundary（diff 上下文护栏）', () => {
  it('短于上限 → 原样返回，truncated=false', () => {
    expect(truncateContextAtLineBoundary('short')).toEqual({ text: 'short', truncated: false })
  })

  it('超上限且前缀内有换行 → 在最后一个换行处截断（不切半行）', () => {
    // 构造：每行 100 字符，上限 8192 → 前缀含多个 \n
    const line = 'x'.repeat(100)
    const text = Array.from({ length: 100 }, (_, i) => `${i}-${line}`).join('\n') // 100 行 ≈ 10299 字符
    const { text: cut, truncated } = truncateContextAtLineBoundary(text)
    expect(truncated).toBe(true)
    expect(cut.length).toBeLessThanOrEqual(EDIT_CONTEXT_MAX_CHARS)
    expect(cut.endsWith('\n')).toBe(true) // 整行截断
    expect(text.startsWith(cut)).toBe(true)
  })

  it('单行超长（前缀内无换行）→ 硬切上限', () => {
    const text = 'z'.repeat(EDIT_CONTEXT_MAX_CHARS + 500)
    const { text: cut, truncated } = truncateContextAtLineBoundary(text)
    expect(truncated).toBe(true)
    expect(cut).toBe('z'.repeat(EDIT_CONTEXT_MAX_CHARS))
  })

  it('自定义上限', () => {
    const { text: cut, truncated } = truncateContextAtLineBoundary('a\nbb\nccc', 4)
    expect(truncated).toBe(true)
    expect(cut).toBe('a\n') // 前缀 'a\nbb' 内最后 \n 在 idx2 → 截到 'a\n'
  })
})

// ===== 类型/杂项 =====

describe('杂项', () => {
  it('trimModelTrailingWhitespace 语义', () => {
    expect(trimModelTrailingWhitespace('a \nb\t\nc ')).toBe('a\nb\nc')
    expect(trimModelTrailingWhitespace('无空格')).toBe('无空格')
  })

  it('EditMatch 类型可析构（tsc strict 编译期契约）', () => {
    const m: EditMatch | null = findEditMatch('x', 'x')
    if (m) {
      const { layer, start, end, matchedText } = m
      expect([layer, start, end, matchedText]).toEqual(['exact', 0, 1, 'x'])
    }
  })
})
