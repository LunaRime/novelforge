// @vitest-environment jsdom
/**
 * AgentInputBox `+` 菜单 — 工作流命令展开列表
 *
 * 契约：
 * - 工具栏只保留 `+` 一个能力入口（不再有常驻 @ / / 图标按钮）
 * - `+` 菜单第三项「工作流命令」可展开，展开后按来源分组列出内置命令与 Skill
 * - 点击行调用既有 handleSlashSelect：内置命令立即发送 / 命令，Skill 仅插入 `/name `
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

vi.mock('../../../services/agent/intent-router', () => ({
  getAllSlashCommands: () => [
    { name: 'clear', displayName: '清空对话', description: '清空当前对话', source: 'builtin_command' },
    { name: 'novel-writing', displayName: '小说创作', description: '写小说', source: 'skill' },
  ],
  searchSlashCommands: () => [],
}))

import AgentInputBox from './AgentInputBox'
import { useAgentStore } from '../../../stores/agent-store'
import { useLLMStore } from '../../../stores/llm-store'
import { t } from '../../../shared/locale'

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} disconnect() {} }
})

beforeEach(() => {
  document.body.innerHTML = ''
  useAgentStore.setState({ conversations: [], activeConversationId: null, generating: false })
  useLLMStore.setState({ models: [], defaultModelId: null })
})

describe('AgentInputBox + 菜单', () => {
  it('展开工作流命令并选择内置命令', () => {
    const sendMessage = vi.fn()
    useAgentStore.setState({ sendMessage } as never)
    const container = document.createElement('div')
    document.body.appendChild(container)
    act(() => { createRoot(container).render(<AgentInputBox />) })

    // 控制器裁决：按 title 精确定位 + 按钮（container.querySelector('button[title]') 可能选中发送按钮）
    const plus = container.querySelector(`button[title="${t('tip.addContext')}"]`) as HTMLButtonElement
    act(() => { plus.click() })
    const workflowRow = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('工作流命令'))
    act(() => { workflowRow!.click() })

    expect(container.textContent).toContain('清空对话')
    const clearRow = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('/clear'))
    act(() => { clearRow!.click() })
    expect(sendMessage).toHaveBeenCalledWith('/clear')
  })
})