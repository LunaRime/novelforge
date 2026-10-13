// @vitest-environment jsdom
/**
 * ProcessGroup — 过程组降噪契约（线② · dsh 照搬）
 *
 * 连续工具折叠为一行：运行中「正在…」→ 结束「已读取文件、已写入文件」+ 计数；
 * 展开显示各 ToolCallBlock。
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import ProcessGroup from './ProcessGroup'
import type { ToolCallInfo } from '../../../services/agent/agent-engine'

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

const CALLS: ToolCallInfo[] = [
  { id: '1', toolName: 'read_file', arguments: { file_path: 'a.md' }, status: 'completed', result: 'a' },
  { id: '2', toolName: 'write_file', arguments: { file_path: 'b.md' }, status: 'completed', result: 'b' },
  { id: '3', toolName: 'read_file', arguments: { file_path: 'c.md' }, status: 'completed', result: 'c' },
]

describe('ProcessGroup — 过程组降噪（线② · dsh 照搬）', () => {
  it('结束态：单行折叠标题「已读取文件、已写入文件」+ 计数，正文工具行默认折叠', () => {
    const el = render(<ProcessGroup toolCalls={CALLS} />)
    expect(el.textContent).toContain('已读取文件')
    expect(el.textContent).toContain('已写入文件')
    expect(el.textContent).toContain('3') // 计数
    // 折叠：单个工具名（read_file 的标题）不出现
    expect(el.textContent).not.toContain('write_file')
  })

  it('运行态：标题「正在…」', () => {
    const running = [
      { id: '1', toolName: 'read_file', arguments: {}, status: 'running' as const },
      { id: '2', toolName: 'write_file', arguments: {}, status: 'pending' as const },
    ]
    const el = render(<ProcessGroup toolCalls={running} />)
    expect(el.textContent).toContain('正在读取文件')
  })

  it('整行可点展开，展开显示各工具行', async () => {
    const el = render(<ProcessGroup toolCalls={CALLS} />)
    const row = el.querySelector('[role="button"]') as HTMLElement
    expect(row).toBeTruthy()
    await act(async () => { row.click() })
    expect(el.textContent).toContain('write_file')
  })

  it('无 button 嵌 button', async () => {
    const el = render(<ProcessGroup toolCalls={CALLS} />)
    const row = el.querySelector('[role="button"]') as HTMLElement
    await act(async () => { row.click() })
    expect(el.querySelectorAll('button button')).toHaveLength(0)
  })
})
