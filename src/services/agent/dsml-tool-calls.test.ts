/**
 * DeepSeek DSML 原生工具调用解析器单测（2026-10-17）
 *
 * 样本来源：2026-10-17 18:43 真机会话（deepseek-flash / DeepSeek V4.1）把工具调用以
 * 原生 DSML 文本泄漏进 assistant content 的事故归档。**真实样本必须逐字保留**：
 * 双全角竖线 U+FF5C、`calls>` 前有空格、file_path 为 Windows 路径。
 *
 * 覆盖：V3/V4/V4.1 wrapper、多 invoke、缺 wrapper、混排正文、参数类型（string=true/false/
 * 缺省）、值含换行与 `>`、残缺结构诊断、strip 零改动不变量、流式过滤器跨 chunk/逐字符。
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  buildUnparsedDsmlError,
  containsDsmlMarkup,
  createDsmlStreamFilter,
  parseDsmlToolCalls,
  stripDsmlMarkup,
  stripDsmlTokens,
} from './dsml-tool-calls'
import { getCurrentLocale, setCurrentLocale, SUPPORTED_LOCALES, t } from '../../shared/locale'

/** 全角竖线（U+FF5C）——DSML 分隔符 */
const BAR = '｜'

/** 真实 V4.1 样本（逐字符来自事故归档；勿改空格/竖线） */
const REAL_V41_SAMPLE = [
  '<｜｜DSML｜｜ calls>',
  '<｜｜DSML｜｜ invoke name="read_file">',
  '<｜｜DSML｜｜ parameter name="file_path" string="true">C:\\Users\\0\\.novelforge\\agent-results\\3252294d1e4f.txt</｜｜DSML｜｜ parameter>',
  '<｜｜DSML｜｜ parameter name="offset" string="false">440</｜｜DSML｜｜ parameter>',
  '<｜｜DSML｜｜ parameter name="limit" string="false">2000</｜｜DSML｜｜ parameter>',
  '</｜｜DSML｜｜ invoke>',
  '</｜｜DSML｜｜ calls>',
].join('\n')

const FILE_PATH = 'C:\\Users\\0\\.novelforge\\agent-results\\3252294d1e4f.txt'

afterEach(() => {
  // 三语用例会切 locale，结束统一还原（其他用例断言 zh-CN 文案）
  setCurrentLocale('zh-CN')
})

/** V4.1 风格 invoke 块（双全角竖线；`calls>` 前的空格在 wrapper helper） */
function v41Invoke(name: string, params: Array<[name: string, stringFlag: string, value: string]> = []): string {
  const lines = [`<｜｜DSML｜｜ invoke name="${name}">`]
  for (const [paramName, stringFlag, value] of params) {
    lines.push(`<｜｜DSML｜｜ parameter name="${paramName}" string="${stringFlag}">${value}</｜｜DSML｜｜ parameter>`)
  }
  lines.push('</｜｜DSML｜｜ invoke>')
  return lines.join('\n')
}

/** V4.1 风格 wrapper（`calls>` 前有空格，对应真实样本） */
function v41Wrapper(invokes: string[]): string {
  return ['<｜｜DSML｜｜ calls>', ...invokes, '</｜｜DSML｜｜ calls>'].join('\n')
}

// ===== containsDsmlMarkup =====

describe('containsDsmlMarkup', () => {
  it('识别 V4.1 / V4 / V3 三种形态（含仅闭合 token）', () => {
    expect(containsDsmlMarkup(REAL_V41_SAMPLE)).toBe(true)
    expect(containsDsmlMarkup('<｜｜DSML｜｜tool_calls>')).toBe(true)
    expect(containsDsmlMarkup('<｜DSML｜function_calls>')).toBe(true)
    expect(containsDsmlMarkup('尾部孤立闭标签</｜｜DSML｜｜ invoke>')).toBe(true)
    // 左右竖线数可各自 1~2（兼容「单侧双竖线」变体）
    expect(containsDsmlMarkup('<｜｜DSML｜ calls>')).toBe(true)
  })

  it('普通文本 / ASCII 竖线 / 不完整 token 均不误判', () => {
    expect(containsDsmlMarkup('普通中文正文，没有任何工具调用。')).toBe(false)
    expect(containsDsmlMarkup('<||DSML|| calls>')).toBe(false)
    expect(containsDsmlMarkup('<|DSML| calls>')).toBe(false)
    expect(containsDsmlMarkup('<tool_call>{"name":"x","arguments":{}}</tool_call>')).toBe(false)
    expect(containsDsmlMarkup('这里讨论 DSML 这个缩写，但不含标记')).toBe(false)
    expect(containsDsmlMarkup('<｜DSML')).toBe(false) // 右侧竖线缺失 → 还不是 token
  })
})

// ===== parseDsmlToolCalls：真实样本 =====

describe('parseDsmlToolCalls：真实 V4.1 样本', () => {
  it('解析出 read_file 与三个参数（string=true 字符串 / string=false 数字）', () => {
    const parsed = parseDsmlToolCalls(`正文开头。\n${REAL_V41_SAMPLE}\n正文结尾。`)

    expect(parsed.toolCalls).toHaveLength(1)
    expect(parsed.toolCalls[0].name).toBe('read_file')
    expect(parsed.toolCalls[0].arguments).toEqual({
      file_path: FILE_PATH,
      offset: 440,
      limit: 2000,
    })
    // 显式锁类型：string="false" 必须是 number，string="true" 必须是 string
    expect(typeof parsed.toolCalls[0].arguments.file_path).toBe('string')
    expect(typeof parsed.toolCalls[0].arguments.offset).toBe('number')
    expect(typeof parsed.toolCalls[0].arguments.limit).toBe('number')

    expect(parsed.parseErrors).toHaveLength(0)

    const text = parsed.textParts.join('')
    expect(text).toBe('正文开头。\n\n正文结尾。')
    expect(text).not.toContain('DSML')
    expect(text).not.toContain(BAR)
  })

  it('无 DSML 时 textParts=[text] 且其余为空数组（含空串）', () => {
    const plain = '  只是普通回复，没有任何工具调用。\n'
    expect(parseDsmlToolCalls(plain)).toEqual({ textParts: [plain], toolCalls: [], parseErrors: [] })
    expect(parseDsmlToolCalls('')).toEqual({ textParts: [''], toolCalls: [], parseErrors: [] })
  })
})

// ===== 版本兼容 =====

describe('parseDsmlToolCalls：V3/V4 wrapper 与竖线变体', () => {
  it('V3/R1 单竖线 function_calls', () => {
    const text = [
      '<｜DSML｜function_calls>',
      '<｜DSML｜invoke name="read_file">',
      '<｜DSML｜parameter name="file_path" string="true">a.md</｜DSML｜parameter>',
      '</｜DSML｜invoke>',
      '</｜DSML｜function_calls>',
    ].join('\n')
    const parsed = parseDsmlToolCalls(text)
    expect(parsed.toolCalls).toEqual([{ name: 'read_file', arguments: { file_path: 'a.md' } }])
    expect(parsed.parseErrors).toHaveLength(0)
    expect(parsed.textParts.join('')).toBe('')
  })

  it('V4 双竖线 tool_calls', () => {
    const text = [
      '<｜｜DSML｜｜tool_calls>',
      '<｜｜DSML｜｜invoke name="read_file">',
      '<｜｜DSML｜｜parameter name="offset" string="false">10</｜｜DSML｜｜parameter>',
      '</｜｜DSML｜｜invoke>',
      '</｜｜DSML｜｜tool_calls>',
    ].join('\n')
    const parsed = parseDsmlToolCalls(text)
    expect(parsed.toolCalls).toEqual([{ name: 'read_file', arguments: { offset: 10 } }])
    expect(parsed.parseErrors).toHaveLength(0)
  })

  it('左右竖线数不对称的变体也能解析', () => {
    const text = [
      '<｜｜DSML｜ calls>',
      '<｜｜DSML｜ invoke name="read_file">',
      '<｜｜DSML｜ parameter name="offset" string="false">7</｜｜DSML｜ parameter>',
      '</｜｜DSML｜ invoke>',
      '</｜｜DSML｜ calls>',
    ].join('\n')
    const parsed = parseDsmlToolCalls(text)
    expect(parsed.toolCalls).toEqual([{ name: 'read_file', arguments: { offset: 7 } }])
    expect(parsed.parseErrors).toHaveLength(0)
  })
})

// ===== 多调用 / 混排正文 =====

describe('parseDsmlToolCalls：多 wrapper、多 invoke 与正文混排', () => {
  it('一条回复两个 wrapper：调用顺序与正文片段顺序都保持', () => {
    const blockA = v41Wrapper([v41Invoke('read_file', [['file_path', 'true', 'a.md']])])
    const blockB = v41Wrapper([v41Invoke('write_file', [['file_path', 'true', 'b.md']])])
    const parsed = parseDsmlToolCalls(`前言\n${blockA}\n中间\n${blockB}\n后记`)

    expect(parsed.toolCalls.map(c => c.name)).toEqual(['read_file', 'write_file'])
    expect(parsed.parseErrors).toHaveLength(0)
    // 正文片段不 trim、保留原始空白（strip 的 join 结果才与原文切除后逐字一致）
    expect(parsed.textParts).toEqual(['前言\n', '\n中间\n', '\n后记'])
    expect(parsed.textParts.join('')).toBe('前言\n\n中间\n\n后记')
  })

  it('一个 wrapper 内多个 invoke', () => {
    const text = v41Wrapper([
      v41Invoke('read_file', [['file_path', 'true', 'a.md']]),
      v41Invoke('read_file', [['file_path', 'true', 'b.md']]),
      v41Invoke('grep', [['pattern', 'true', '主角']]),
    ])
    const parsed = parseDsmlToolCalls(text)
    expect(parsed.toolCalls).toEqual([
      { name: 'read_file', arguments: { file_path: 'a.md' } },
      { name: 'read_file', arguments: { file_path: 'b.md' } },
      { name: 'grep', arguments: { pattern: '主角' } },
    ])
    expect(parsed.parseErrors).toHaveLength(0)
  })

  it('缺外层 wrapper 的孤立 invoke 也能还原', () => {
    const block = v41Invoke('read_file', [['file_path', 'true', 'a.md']])
    const parsed = parseDsmlToolCalls(`正文\n${block}\n尾部`)
    expect(parsed.toolCalls).toEqual([{ name: 'read_file', arguments: { file_path: 'a.md' } }])
    expect(parsed.parseErrors).toHaveLength(0)
    expect(parsed.textParts.join('')).toBe('正文\n\n尾部')
  })

  it('XML 与 DSML 混排：XML 块保留在正文片段里交给调用方再解析', () => {
    const xmlCall = '<tool_call>{"name": "read_file", "arguments": {"file_path": "x.md"}}</tool_call>'
    const parsed = parseDsmlToolCalls(`${xmlCall}\n${REAL_V41_SAMPLE}`)
    expect(parsed.toolCalls).toHaveLength(1)
    expect(parsed.toolCalls[0].name).toBe('read_file')
    expect(parsed.textParts.join('')).toBe(`${xmlCall}\n`)
  })
})

// ===== 参数解析规则 =====

describe('parseDsmlToolCalls：参数类型与标签容错', () => {
  it('string="false"：数字 / 布尔 / 对象按 JSON literal；非法 literal 回退字符串', () => {
    const text = v41Wrapper([
      v41Invoke('t', [
        ['num', 'false', '42'],
        ['flag', 'false', 'true'],
        ['obj', 'false', '{"deep": true}'],
        ['bad', 'false', 'not-json'],
      ]),
    ])
    expect(parseDsmlToolCalls(text).toolCalls[0].arguments).toEqual({
      num: 42,
      flag: true,
      obj: { deep: true },
      bad: 'not-json',
    })
  })

  it('缺 string 属性按字符串处理（值保持模型原样）', () => {
    const text = v41Wrapper([v41Invoke('t', [['offset', '', '440']])])
    const parsed = parseDsmlToolCalls(text)
    expect(parsed.toolCalls[0].arguments.offset).toBe('440')
  })

  it('参数值可含换行与 `>`，且原样保留', () => {
    const value = '第一行 > 第二行\n第三行 < 不是标签'
    const text = v41Wrapper([v41Invoke('write_file', [['content', 'true', value]])])
    const parsed = parseDsmlToolCalls(text)
    expect(parsed.toolCalls[0].arguments.content).toBe(value)
    expect(parsed.parseErrors).toHaveLength(0)
  })

  it('开标签内额外空白不影响解析', () => {
    const text = [
      '<｜｜DSML｜｜ calls>',
      '<｜｜DSML｜｜   invoke   name="read_file">',
      '<｜｜DSML｜｜ parameter  name="file_path"  string="true" >a.txt</｜｜DSML｜｜ parameter>',
      '</｜｜DSML｜｜   invoke>',
      '</｜｜DSML｜｜ calls>',
    ].join('\n')
    expect(parseDsmlToolCalls(text).toolCalls).toEqual([
      { name: 'read_file', arguments: { file_path: 'a.txt' } },
    ])
  })
})

// ===== 残缺结构诊断 =====

describe('parseDsmlToolCalls：残缺块产出 parseErrors', () => {
  it('空 wrapper（无 invoke）→ 1 条诊断，不当正文残留', () => {
    const broken = ['<｜｜DSML｜｜ calls>', '这里没有任何 invoke 结构', '</｜｜DSML｜｜ calls>'].join('\n')
    const parsed = parseDsmlToolCalls(`前言\n${broken}`)
    expect(parsed.toolCalls).toHaveLength(0)
    expect(parsed.parseErrors).toHaveLength(1)
    expect(parsed.parseErrors[0].rawContent).toContain('没有任何 invoke 结构')
    expect(parsed.parseErrors[0].reason).toBe(t('engine.parseReasonDsml'))
    expect(parsed.parseErrors[0].suggestion).toBe(t('engine.parseSuggestionDsml'))
    expect(parsed.textParts.join('')).toBe('前言\n')
  })

  it('未闭合到文末的 wrapper/invoke → 1 条诊断、0 个调用', () => {
    const text = `前面正文\n<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="read_file">\n<｜｜DSML｜｜ parameter name="file_path" string="true">a.md`
    const parsed = parseDsmlToolCalls(text)
    expect(parsed.toolCalls).toHaveLength(0)
    expect(parsed.parseErrors).toHaveLength(1)
    expect(parsed.textParts.join('')).toBe('前面正文\n')
    expect(stripDsmlMarkup(text)).toBe('前面正文\n')
  })

  it('invoke 缺 name 属性 → 诊断，不产出无名调用', () => {
    const text = ['<｜｜DSML｜｜ calls>', '<｜｜DSML｜｜ invoke>', '</｜｜DSML｜｜ invoke>', '</｜｜DSML｜｜ calls>'].join('\n')
    const parsed = parseDsmlToolCalls(text)
    expect(parsed.toolCalls).toHaveLength(0)
    expect(parsed.parseErrors).toHaveLength(1)
  })

  it('invoke 已闭合但 parameter 未闭合 → 参数不可信，整条调用不执行', () => {
    const text = [
      '<｜｜DSML｜｜ calls>',
      '<｜｜DSML｜｜ invoke name="read_file">',
      '<｜｜DSML｜｜ parameter name="file_path" string="true">a.md',
      '</｜｜DSML｜｜ invoke>',
      '</｜｜DSML｜｜ calls>',
    ].join('\n')
    const parsed = parseDsmlToolCalls(text)
    expect(parsed.toolCalls).toHaveLength(0)
    expect(parsed.parseErrors).toHaveLength(1)
  })

  it('wrapper 未闭合但内部 invoke 完整 → 调用仍还原，同时报 wrapper 结构诊断', () => {
    const text = `<｜｜DSML｜｜ calls>\n${v41Invoke('read_file', [['file_path', 'true', 'a.md']])}`
    const parsed = parseDsmlToolCalls(text)
    expect(parsed.toolCalls).toEqual([{ name: 'read_file', arguments: { file_path: 'a.md' } }])
    expect(parsed.parseErrors).toHaveLength(1)
  })

  it('parseErrors.rawContent 截断到 300 字符', () => {
    const broken = `<｜｜DSML｜｜ calls>\n${'x'.repeat(500)}\n</｜｜DSML｜｜ calls>`
    const parsed = parseDsmlToolCalls(broken)
    expect(parsed.parseErrors).toHaveLength(1)
    expect(parsed.parseErrors[0].rawContent).toHaveLength(300)
  })

  it('只有半截 token（无完整标签）→ 移除残片但不报结构错误', () => {
    const parsed = parseDsmlToolCalls('正文\n<｜｜DSML｜｜ invoke name="x"')
    expect(parsed.toolCalls).toHaveLength(0)
    expect(parsed.parseErrors).toHaveLength(0)
    expect(parsed.textParts.join('')).toBe('正文\n')
  })
})

// ===== stripDsmlMarkup =====

describe('stripDsmlMarkup', () => {
  it('无 DSML 时逐字原样返回（不 trim、不折叠空白）', () => {
    const plain = '  前后带空白的正文\n\n\n连续空行  '
    expect(stripDsmlMarkup(plain)).toBe(plain)
    expect(stripDsmlMarkup('ASCII 竖线 | 与 <tool_call> 标签都不该动')).toBe('ASCII 竖线 | 与 <tool_call> 标签都不该动')
    expect(stripDsmlMarkup('')).toBe('')
  })

  it('完整 wrapper 块整块移除，正文空白逐字保留', () => {
    const text = `我先读一下。\n${REAL_V41_SAMPLE}\n读完了。`
    expect(stripDsmlMarkup(text)).toBe('我先读一下。\n\n读完了。')
    expect(stripDsmlMarkup(REAL_V41_SAMPLE)).toBe('')
  })

  it('孤立闭合标签只删标签；孤立开标签按「未闭合块」删到文末（与 parse 口径一致）', () => {
    // 孤立闭合标签：没有可吞的内容，只删标记本身
    expect(stripDsmlMarkup('抬头\n</｜｜DSML｜｜ invoke>\n尾巴')).toBe('抬头\n\n尾巴')
    // 孤立开标签 = 未闭合到文末的 DSML 块（spec 主语义）：删到文末，其后的「后」属于块内容。
    // 与 parseDsmlToolCalls 一致（该输入 parse 后正文片段同样是「前」）——不要把完整块语义与残片语义混用。
    expect(stripDsmlMarkup(`前<｜｜DSML｜｜ invoke name="x">后`)).toBe('前')
    expect(parseDsmlToolCalls(`前<｜｜DSML｜｜ invoke name="x">后`).textParts.join('')).toBe('前')
  })

  it('孤立 parameter 块（无 invoke）整块移除', () => {
    const block = '<｜｜DSML｜｜ parameter name="a" string="true">v</｜｜DSML｜｜ parameter>'
    expect(stripDsmlMarkup(`前${block}后`)).toBe('前后')
  })

  it('未闭合到文末的 DSML 块删到文末', () => {
    expect(stripDsmlMarkup('保留正文\n<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="x">')).toBe('保留正文\n')
    expect(stripDsmlMarkup('保留正文\n<｜｜DSML｜｜')).toBe('保留正文\n')
  })

  it('strip 结果与 parse textParts.join 一致（同一套区间语义）', () => {
    const text = `A\n${REAL_V41_SAMPLE}\nB`
    expect(stripDsmlMarkup(text)).toBe(parseDsmlToolCalls(text).textParts.join(''))
  })
})

// ===== buildUnparsedDsmlError =====

describe('buildUnparsedDsmlError', () => {
  it('三语均可用（reason/suggestion 跟随当前 locale）', () => {
    const original = getCurrentLocale()
    const seenReasons = new Set<string>()
    for (const locale of SUPPORTED_LOCALES) {
      setCurrentLocale(locale)
      const error = buildUnparsedDsmlError('raw DSML')
      expect(error.rawContent).toBe('raw DSML')
      expect(error.reason).toBe(t('engine.parseReasonDsml'))
      expect(error.suggestion).toBe(t('engine.parseSuggestionDsml'))
      expect(error.reason.length).toBeGreaterThan(0)
      // 修复建议必须给出规定的 XML 调用格式
      expect(error.suggestion).toContain('<tool_call>')
      seenReasons.add(error.reason)
    }
    setCurrentLocale(original)
    // 三语确实是不同文案（不漏翻/不回落成同一条）
    expect(seenReasons.size).toBe(SUPPORTED_LOCALES.length)
  })

  it('rawContent 截断到 300 字符', () => {
    expect(buildUnparsedDsmlError('y'.repeat(1000)).rawContent).toHaveLength(300)
    expect(buildUnparsedDsmlError('short').rawContent).toBe('short')
  })
})

// ===== 流式过滤器 =====

/** 流式输入：正文前缀 + 真实 DSML 块 + 正文后缀 */
const STREAM_INPUT = `我先读一下。\n${REAL_V41_SAMPLE}\n读完了。`
/** 流式可见文本（与 stripDsmlMarkup 一致） */
const STREAM_VISIBLE = '我先读一下。\n\n读完了。'

describe('createDsmlStreamFilter', () => {
  it('单次 push 完整文本：整块吞掉，前后正文一次返回', () => {
    const filter = createDsmlStreamFilter()
    const visible = filter.push(STREAM_INPUT) + filter.flush()
    expect(visible).toBe(STREAM_VISIBLE)
    expect(visible).not.toContain(BAR)
  })

  it('逐字符喂入：任何时刻都不泄漏半截标记，最终不丢字', () => {
    const filter = createDsmlStreamFilter()
    let visible = ''
    for (const char of STREAM_INPUT) {
      const chunk = filter.push(char)
      expect(chunk).not.toContain(BAR)
      expect(chunk).not.toContain('DSML')
      visible += chunk
    }
    visible += filter.flush()
    expect(visible).toBe(STREAM_VISIBLE)
  })

  it('在任意位置切分 chunk（含 token 中间）：结果与整块清洗一致', () => {
    const expected = stripDsmlMarkup(STREAM_INPUT)
    for (let split = 1; split < STREAM_INPUT.length; split++) {
      const filter = createDsmlStreamFilter()
      const visible = filter.push(STREAM_INPUT.slice(0, split))
        + filter.push(STREAM_INPUT.slice(split))
        + filter.flush()
      expect(visible, `切分点 ${split}`).toBe(expected)
    }
  })

  it('固定 3 字符块：块跨 chunk 时中途不得泄漏 DSML token', () => {
    const filter = createDsmlStreamFilter()
    let visible = ''
    for (let i = 0; i < STREAM_INPUT.length; i += 3) {
      const chunk = filter.push(STREAM_INPUT.slice(i, i + 3))
      expect(chunk).not.toContain(BAR)
      expect(chunk).not.toContain('DSML')
      visible += chunk
    }
    visible += filter.flush()
    expect(visible).toBe(STREAM_VISIBLE)
  })

  it('无 DSML 的正文：内容不丢字（含末尾单独的 `<`）', () => {
    const plain = '纯正文没有标记。\n第二行结束'
    const filter = createDsmlStreamFilter()
    let visible = ''
    for (let i = 0; i < plain.length; i += 4) visible += filter.push(plain.slice(i, i + 4))
    visible += filter.flush()
    expect(visible).toBe(plain)

    // 末尾 `<` 可能是正文（不是 DSML 残片）→ flush 放行
    const withLt = createDsmlStreamFilter()
    expect(withLt.push('对比 a <') + withLt.flush()).toBe('对比 a <')
  })

  it('未闭合 DSML 块：从开 token 起全部扣住，flush 丢弃残片', () => {
    const filter = createDsmlStreamFilter()
    const first = filter.push('开头\n<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="read_file">')
    expect(first).toBe('开头\n')
    expect(filter.flush()).toBe('')
  })

  it('flush 返回残余安全文本并丢弃不完整的开标签', () => {
    const filter = createDsmlStreamFilter()
    // token 中间截断（流在 `<｜` 处结束）→ 半截标记不得上屏
    expect(filter.push('尾部正文<｜')).toBe('尾部正文')
    expect(filter.flush()).toBe('')
  })

  it('连续多个 DSML 块：全部吞掉，块间正文按序保留', () => {
    const blockA = v41Wrapper([v41Invoke('read_file', [['file_path', 'true', 'a.md']])])
    const blockB = v41Wrapper([v41Invoke('write_file', [['file_path', 'true', 'b.md']])])
    const input = `甲${blockA}乙${blockB}丙`
    const filter = createDsmlStreamFilter()
    let visible = ''
    for (let i = 0; i < input.length; i += 5) visible += filter.push(input.slice(i, i + 5))
    visible += filter.flush()
    expect(visible).toBe('甲乙丙')
  })
})

// ===== stripDsmlTokens（observation 注入净化，2026-10-17 安全核查反例 A） =====

describe('stripDsmlTokens：只删 token 标记、不整块删内容', () => {
  it('DSML token 被剥掉，块内文本保留（防工具结果回吐被解析成真实调用，且不污染 read_file 数据）', () => {
    const block = `<｜｜DSML｜｜ calls>\n正文X\n</｜｜DSML｜｜ calls>`
    const out = stripDsmlTokens(block)
    expect(out).not.toContain('DSML')
    expect(out).not.toContain(BAR)
    // 块内容逐字保留：不是走 stripDsmlMarkup 的整块删除
    expect(out).toContain('正文X')
    expect(out).toContain(' calls>')
  })

  it('V3 单竖线 token 同样剥除', () => {
    expect(stripDsmlTokens('前<｜DSML｜function_calls>后')).toBe('前function_calls>后')
  })

  it('无 DSML token 时逐字原样返回（含空白/ASCII 竖线）', () => {
    const normal = '  a | b\n\n<D<x>  '
    expect(stripDsmlTokens(normal)).toBe(normal)
  })

  // 二次核查反例 A3：单趟 replace 会在删除接缝「删出新 token」，构造输入可绕过注入防守
  it('删除接缝可拼回完整 token 时循环到不动点（构造输入不得绕过）', () => {
    expect(stripDsmlTokens('<｜<｜DSML｜DSML｜')).not.toContain('DSML')
    expect(stripDsmlTokens('<｜<｜DSML｜DSML｜')).not.toContain(BAR)
    // 每个标签都用「半个 token + 半个 token」拼接的块：单趟会拼回可解析 DSML 块
    const crafted = '<｜<｜DSML｜DSML｜ calls>\n<｜<｜DSML｜DSML｜ invoke name="x">'
    expect(stripDsmlTokens(crafted)).not.toContain('DSML')
    expect(stripDsmlTokens(crafted)).not.toContain(BAR)
  })
})
