// @vitest-environment jsdom
/**
 * ConfirmCard — Agent 工具确认卡片（2026-09-25）
 *
 * 写于「按钮改用 ui/Button + 删除 .confirm-card-btn 系列 CSS」这次收敛**之前**：
 * 先把两条接线钉住 —— 批准必须 resolve(true)、拒绝必须 resolve(false)，
 * 且都带上这次工具调用的 id。按钮换实现时最怕的就是把两个回调接反，
 * 而这条链路会真实授权/拒绝文件写入等操作，接反的后果是静默执行了用户拒绝的操作。
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import ConfirmCard from './ConfirmCard'
import type { ToolCallInfo } from '../../../services/agent/agent-engine'

const mockResolve = vi.hoisted(() => vi.fn())

vi.mock('../../../stores/agent-store', () => ({
  useAgentStore: () => ({ resolveToolConfirmation: mockResolve }),
}))

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
  root = null
  container = null
  mockResolve.mockClear()
})

const TOOL_CALL = {
  id: 'tc-42',
  toolName: 'write_file',
  /* 注意字段名是 file_path —— generateDescription 按工具的入参名取，写成 path 会回落「未知路径」 */
  arguments: { file_path: 'drafts/ch01.md', content: '正文' },
} as unknown as ToolCallInfo

/** 卡片底部两个按钮：拒绝在前、批准在后 */
const buttons = () => Array.from(document.querySelectorAll('button'))

describe('ConfirmCard', () => {
  it('渲染人类可读的操作描述（含目标路径）、参数原文与两个按钮', () => {
    const el = render(<ConfirmCard toolCall={TOOL_CALL} />)
    // 描述里必须出现目标路径——用户是照着这句决定批不批的
    expect(el.textContent).toContain('drafts/ch01.md')
    // 参数以 JSON 原文附在下方，供用户核对
    expect(el.textContent).toContain('"content": "正文"')
    expect(buttons()).toHaveLength(2)
  })

  it('批准 → resolveToolConfirmation(id, true)', () => {
    render(<ConfirmCard toolCall={TOOL_CALL} />)
    act(() => buttons()[1].click())
    expect(mockResolve).toHaveBeenCalledTimes(1)
    expect(mockResolve).toHaveBeenCalledWith('tc-42', true)
  })

  it('拒绝 → resolveToolConfirmation(id, false)', () => {
    render(<ConfirmCard toolCall={TOOL_CALL} />)
    act(() => buttons()[0].click())
    expect(mockResolve).toHaveBeenCalledTimes(1)
    expect(mockResolve).toHaveBeenCalledWith('tc-42', false)
  })
})

/** A 档：审批决策（可固化提案 / 高风险不可固化） */
const DECISION_REMEMBERABLE = {
  action: 'prompt',
  risk: 'medium',
  ruleId: 'prompt_rememberable',
  reasonKey: 'approval.promptWithRemember',
  remember: {
    toolName: 'write_file',
    matcher: 'args-identity',
    matcherVersion: 1,
    matchKey: '["write_file","drafts"]',
    displayPattern: 'write_file → drafts/',
  },
} as const

const DECISION_ONE_SHOT = {
  action: 'prompt',
  risk: 'high',
  ruleId: 'prompt_one_shot',
  reasonKey: 'approval.promptOneShot',
} as const

describe('ConfirmCard × A 档审批决策', () => {
  it('有可固化提案 → 渲染「始终允许」并展示将记住的规则描述', () => {
    const el = render(<ConfirmCard toolCall={{ ...TOOL_CALL, approval: DECISION_REMEMBERABLE } as unknown as ToolCallInfo} />)
    expect(buttons()).toHaveLength(3)
    expect(el.textContent).toContain('write_file → drafts/')   // 规则描述 = 用户判断"记住什么"的依据
  })

  it('点「始终允许」→ resolveToolConfirmation(id, true, true)', () => {
    render(<ConfirmCard toolCall={{ ...TOOL_CALL, approval: DECISION_REMEMBERABLE } as unknown as ToolCallInfo} />)
    act(() => buttons()[1].click())          // 顺序：拒绝 | 始终允许 | 批准
    expect(mockResolve).toHaveBeenCalledWith('tc-42', true, true)
  })

  it('无可固化提案（MCP 工具 / 高风险）→ 仍是两个按钮，不出现「始终允许」', () => {
    const el = render(<ConfirmCard toolCall={{ ...TOOL_CALL, approval: DECISION_ONE_SHOT } as unknown as ToolCallInfo} />)
    expect(buttons()).toHaveLength(2)
    expect(el.textContent).not.toContain('始终允许')
  })

  it('高风险决策渲染风险提示', () => {
    const el = render(<ConfirmCard toolCall={{ ...TOOL_CALL, approval: DECISION_ONE_SHOT } as unknown as ToolCallInfo} />)
    expect(el.textContent).toContain('风险')
  })
})
