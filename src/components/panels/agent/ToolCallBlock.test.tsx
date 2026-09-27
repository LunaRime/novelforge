// @vitest-environment jsdom
/**
 * ToolCallBlock — 头部可供性契约（2026-09-27 修复）
 *
 * 修复前：头部是 `<div onClick>`（键盘完全够不到）；折叠箭头顶在右端
 * （`agent-tools.css` 的 `margin-left:auto`）——该位置在本仓语言里是「进入」，语义冲突；
 * hover 边框挂在整块上（展开后悬停参数/结果区边框亮着却点不动）。
 * 修复后：头部 = 原生 button + 箭头置左；边框 hover 收窄到头部（:has）。
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import ToolCallBlock from './ToolCallBlock'
import type { ToolCallInfo } from '../../../services/agent/agent-engine'

const CALL: ToolCallInfo = {
  id: 't1',
  toolName: 'read_file',
  arguments: { file_path: 'drafts/ch1.md' },
  status: 'completed',
  result: '正文内容',
  source: 'builtin',
}

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(node: React.ReactNode): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(node) })
  return container
}

beforeAll(() => {
  const g = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  g.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('ToolCallBlock — 头部可供性（2026-09-27）', () => {
  it('头部是原生 button：可聚焦、点击切换展开、箭头位于最前（左端）', async () => {
    const el = render(<ToolCallBlock toolCall={CALL} />)
    const header = el.querySelector('.tool-call-header') as HTMLButtonElement
    expect(header.tagName).toBe('BUTTON')
    header.focus()
    expect(document.activeElement).toBe(header)
    // 折叠箭头置左（首个子元素）——不再靠 margin-left:auto 顶在右端
    expect(header.firstElementChild?.classList.contains('tool-call-arrow')).toBe(true)
    // 折叠态：参数区不可见
    expect(el.textContent).not.toContain('"file_path"')
    await act(async () => { header.click() })
    // 展开态：参数 JSON 可见
    expect(el.textContent).toContain('file_path')
  })

  it('无 button 嵌 button：展开后复制按钮在头部按钮之外', async () => {
    const el = render(<ToolCallBlock toolCall={CALL} />)
    const header = el.querySelector('.tool-call-header') as HTMLButtonElement
    await act(async () => { header.click() })
    expect(el.querySelector('.tool-call-result button')).toBeTruthy()
    expect(el.querySelectorAll('button button')).toHaveLength(0)
  })
})
