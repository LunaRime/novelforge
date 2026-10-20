// @vitest-environment jsdom
/**
 * AgentInputBox 模型 + 思考等级合并弹窗
 *
 * 契约：
 * - 只有一个入口：触发器同时显示当前模型名与当前思考等级
 * - 弹窗上半「本对话模型」列表（按会话），下半「全局思考等级」四档滑块（全局）
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import AgentInputBox from './AgentInputBox'
import { useAgentStore } from '../../../stores/agent-store'
import { useLLMStore } from '../../../stores/llm-store'
import { useThinkingStore } from '../../../stores/thinking-store'

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} disconnect() {} }
})

beforeEach(() => {
  document.body.innerHTML = ''
  useAgentStore.setState({
    conversations: [{ id: 'c1', title: 't', messages: [], createdAt: 0, updatedAt: 0, modelId: 'm1' }],
    activeConversationId: 'c1',
    generating: false,
  })
  useLLMStore.setState({
    defaultModelId: 'm1',
    models: [
      { id: 'm1', name: 'Model One', provider: 'openai', protocol: 'openai', modelName: 'm1', baseUrl: '', maxTokens: 4096, contextWindow: 128000, purposes: ['generation'] },
      { id: 'm2', name: 'Model Two', provider: 'openai', protocol: 'openai', modelName: 'm2', baseUrl: '', maxTokens: 4096, contextWindow: 128000, purposes: ['generation'] },
    ] as never,
  })
  useThinkingStore.setState({ level: 'high' })
})

describe('AgentInputBox 模型+思考等级弹窗', () => {
  it('一个入口同时显示模型与四档等级', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    act(() => { createRoot(container).render(<AgentInputBox />) })

    expect(container.textContent).toContain('Model One')
    expect(container.textContent).toContain('高')
    const trigger = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Model One'))
    act(() => { trigger!.click() })
    expect(container.textContent).toContain('本对话模型')
    expect(container.textContent).toContain('全局思考等级')
    expect(container.querySelectorAll('[data-thinking-node]').length).toBe(4)
  })
})