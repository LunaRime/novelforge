// @vitest-environment jsdom
/**
 * ToolCallBlock — 单行可供性契约（线② · dsh 照搬）
 *
 * 从折叠块改为 dsh 的 24px 单行：「[icon] 标题 · 摘要」（点分隔 + 单行省略）；
 * 展开为 IN/OUT 双栏卡。整行可点（expandOnRowClick），前导图标悬停置换为 chevron。
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

describe('ToolCallBlock — 单行（线② · dsh 照搬）', () => {
  it('单行显示：工具名 + 点分隔 + 摘要（文件名），无块状边框', () => {
    const el = render(<ToolCallBlock toolCall={CALL} />)
    expect(el.textContent).toContain('read_file')
    expect(el.textContent).toContain('ch1.md')
    // 折叠态：参数 JSON 不可见（不渲染展开体）
    expect(el.textContent).not.toContain('file_path')
  })

  it('整行可点展开（键盘可达：role=button + tabIndex），展开显示 IN/OUT', async () => {
    const el = render(<ToolCallBlock toolCall={CALL} />)
    const row = el.querySelector('[role="button"]') as HTMLElement
    expect(row).toBeTruthy()
    expect(row.getAttribute('tabindex')).toBe('0')
    await act(async () => { row.click() })
    // 展开：参数 JSON 可见
    expect(el.textContent).toContain('file_path')
    expect(el.textContent).toContain('正文内容')
  })

  it('无 button 嵌 button', async () => {
    const el = render(<ToolCallBlock toolCall={CALL} />)
    expect(el.querySelectorAll('button button')).toHaveLength(0)
  })

  it('错误态：摘要显示错误信息（红），而非工具名摘要', () => {
    const err = render(
      <ToolCallBlock toolCall={{ ...CALL, status: 'failed', error: '读取失败：文件不存在' }} />,
    )
    expect(err.textContent).toContain('读取失败：文件不存在')
  })

  it('运行态：shimmer 装饰副本存在（流式扫光）', () => {
    const running = render(<ToolCallBlock toolCall={{ ...CALL, status: 'running', result: '' }} />)
    expect(running.querySelector('[aria-hidden="true"]')).toBeTruthy()
  })
})
