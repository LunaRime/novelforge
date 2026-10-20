import { describe, expect, it } from 'vitest'
import { createToolProtocolStreamFilter } from './tool-protocol-stream-filter'
import { createDsmlStreamFilter } from './dsml-tool-calls'

function runInChunks(input: string, chunkSize: number): string {
  const filter = createToolProtocolStreamFilter()
  let out = ''
  for (let i = 0; i < input.length; i += chunkSize) {
    out += filter.push(input.slice(i, i + chunkSize))
  }
  return out + filter.flush()
}

describe('createToolProtocolStreamFilter', () => {
  const input = '前文 <tool_call>{"name":"x","arguments":{"a":1}}</tool_call> 中间 <tool_result name="x">ok</tool_result> 结尾'
  const expected = '前文  中间  结尾'

  it('完整工具块不进入可见文本', () => {
    expect(runInChunks(input, input.length)).toBe(expected)
  })

  it('在任意字符边界切 chunk 都不泄漏协议残片', () => {
    for (let split = 0; split <= input.length; split++) {
      const filter = createToolProtocolStreamFilter()
      const out = filter.push(input.slice(0, split)) + filter.push(input.slice(split)) + filter.flush()
      expect(out, `split=${split}`).toBe(expected)
    }
  })

  it('普通正文的 < 不被吞', () => {
    expect(runInChunks('1 < 2，a < b，代码 <tag> 保留', 3)).toContain('1 < 2')
    expect(runInChunks('1 < 2，a < b，代码 <tag> 保留', 3)).toContain('<tag>')
  })

  it('未闭合工具块在 flush 时整段丢弃', () => {
    const filter = createToolProtocolStreamFilter()
    const out = filter.push('正文 <tool_call>{"name":"x"}') + filter.flush()
    expect(out).toBe('正文 ')
  })

  it('可与 DSML 过滤器串联', () => {
    const xml = createToolProtocolStreamFilter()
    const dsml = createDsmlStreamFilter()
    const raw = '开头 <tool_call>{"name":"x"}</tool_call> 结尾 <｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="y"></｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>'
    let out = ''
    for (let i = 0; i < raw.length; i += 2) {
      out += dsml.push(xml.push(raw.slice(i, i + 2)))
    }
    out += dsml.push(xml.flush()) + dsml.flush()
    expect(out).toContain('开头')
    expect(out).toContain('结尾')
    expect(out).not.toContain('<tool_call>')
    expect(out).not.toContain('<｜｜DSML｜｜')
  })
})
