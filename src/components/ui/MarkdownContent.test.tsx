// @vitest-environment jsdom
/**
 * MarkdownContent — 代码块渲染回归测试（2026-10-14）
 *
 * 靶点：react-markdown 迁移后，无语言代码块（``` 不写语言）曾被误判为行内代码
 * （className 无 language- 前缀 → 走 InlineCode 分支，丢失 pre 块 + 复制按钮）。
 * 修复：块级代码统一由 pre 组件承接，code 组件只透传；据此钉死三类渲染。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import MarkdownContent from './MarkdownContent'

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(node: React.ReactNode): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(node)
  })
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  container = null
  root = null
})

describe('MarkdownContent 代码块渲染', () => {
  it('无语言代码块（``` 不写语言）→ 仍是 CodeBlock（有 pre，非行内）', () => {
    const el = render(<MarkdownContent content={'```\nconsole.log(1)\n```'} />)
    expect(el.querySelector('pre')).toBeTruthy()
    expect(el.textContent).toContain('console.log(1)')
  })

  it('有语言代码块 → CodeBlock 且显示语言', () => {
    const el = render(<MarkdownContent content={'```js\nconsole.log(1)\n```'} />)
    expect(el.querySelector('pre')).toBeTruthy()
    expect(el.textContent).toContain('js')
  })

  it('行内代码 → 无 pre（是行内 <code>）', () => {
    const el = render(<MarkdownContent content={'行内 `code` 测试'} />)
    expect(el.querySelector('pre')).toBeFalsy()
    expect(el.querySelector('code')).toBeTruthy()
  })
})

it('文档渲染下划线及其中的 Markdown，代码和其他 HTML 仍按文本显示', () => {
  const el = render(<MarkdownContent document content={'<u>强调 **正文**</u>、`<u>代码</u>`、<u onclick="alert(1)">原文</u>、<img src=x onerror="alert(1)">'} />)
  expect(el.querySelector('u')).toMatchObject({ textContent: '强调 正文' })
  expect(el.querySelector('u strong')).toMatchObject({ textContent: '正文' })
  expect(el.querySelectorAll('u')).toHaveLength(1)
  expect(el.querySelector('code')).toMatchObject({ textContent: '<u>代码</u>' })
  expect(el.querySelector('img')).toBeNull()
  expect(el.textContent).toContain('<u onclick="alert(1)">原文</u>')
})
