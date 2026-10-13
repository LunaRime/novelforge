// @vitest-environment jsdom
/**
 * PendingToolConfirmation — 父 agent 审批卡挂载点契约（线② · dsh 照搬，接管输入区）
 *
 * 从 active 会话收集 waiting_confirm 的 toolCall，渲染在输入区上方；无则返回 null。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import PendingToolConfirmation from './PendingToolConfirmation'

const mockResolve = vi.hoisted(() => vi.fn())

// useAgentStore 支持两种形态：带 selector（本组件）+ 无 selector（ConfirmCard 内部）
vi.mock('../../../stores/agent-store', () => ({
  useAgentStore: (selector?: (s: unknown) => unknown) => {
    const state = {
      activeConversationId: 'conv-1',
      resolveToolConfirmation: mockResolve,
      conversations: [{
        id: 'conv-1',
        messages: [
          { id: 'm1', role: 'user', content: 'hi', createdAt: 0 },
          {
            id: 'm2', role: 'assistant', content: '', createdAt: 0,
            toolCalls: [
              { id: 'tc-1', toolName: 'write_file', arguments: { file_path: 'a.md' }, status: 'waiting_confirm' },
              { id: 'tc-2', toolName: 'read_file', arguments: {}, status: 'completed' },
            ],
          },
        ],
      }],
    }
    return selector ? selector(state) : state
  },
}))

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(node: React.ReactNode): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(node) })
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  mockResolve.mockClear()
})

describe('PendingToolConfirmation — 审批接管输入区（线②）', () => {
  it('有 waiting_confirm 工具 → 渲染确认卡（含工具描述）', () => {
    const el = render(<PendingToolConfirmation />)
    expect(el.textContent).toContain('a.md')   // ConfirmCard 的 generateDescription 含目标路径
  })

  it('只取第一个 waiting_confirm（串行确认，同一时刻至多一个）', () => {
    const el = render(<PendingToolConfirmation />)
    // 渲染的是 ConfirmCard 结构（含「确认」标题 + 按钮），而非多个卡
    expect(el.querySelectorAll('.confirm-card')).toHaveLength(1)
  })
})
