import { describe, it, expect } from 'vitest'
import { buildShareCardHTML } from './share-card'

/**
 * 章节分享卡 — 选中正文 → LLM 摘要 → 品牌卡片 HTML → 主进程离屏截图导出 PNG。
 * 与年度报告共用 report:render-html / fs:write-buffer 链路。
 */
describe('buildShareCardHTML', () => {
  const input = {
    title: '雪夜入谷',
    meta: '第 12 章 · 主角初遇',
    summary: '风雪之夜，少年踏入山谷，命运的齿轮开始转动。',
    quote: '这一剑，等了十年。',
  }

  it('包含标题/章节元信息/摘要/金句', () => {
    const html = buildShareCardHTML(input)
    expect(html).toContain('雪夜入谷')
    expect(html).toContain('第 12 章 · 主角初遇')
    expect(html).toContain('这一剑，等了十年。')
  })

  it('HTML 转义：用户内容不被注入', () => {
    const html = buildShareCardHTML({
      title: '<script>alert(1)</script>',
      meta: 'x',
      summary: 'y',
      quote: 'z',
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('空金句时隐藏金句区（不渲染空引用块）', () => {
    const html = buildShareCardHTML({ ...input, quote: '' })
    expect(html).not.toContain('这一剑')
    expect(html).not.toContain('class="quote"')
  })
})
