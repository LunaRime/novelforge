import { describe, it, expect } from 'vitest'
import { buildCcrSummaryPrompt } from './ccr-summary'

describe('buildCcrSummaryPrompt', () => {
  it('含旧摘要时以「旧摘要 + 新批」迭代输入', () => {
    const p = buildCcrSummaryPrompt('旧摘要内容', '新批内容')
    expect(p).toContain('旧摘要内容')
    expect(p).toContain('新批内容')
    // 旧摘要标记与新批标记分离
    expect(p.indexOf('旧摘要内容')).toBeLessThan(p.indexOf('新批内容'))
  })

  it('无旧摘要（首次压缩）时不含旧摘要标记', () => {
    const p = buildCcrSummaryPrompt('', '新批内容')
    expect(p).not.toContain('旧摘要')
    expect(p).toContain('新批内容')
  })
})
