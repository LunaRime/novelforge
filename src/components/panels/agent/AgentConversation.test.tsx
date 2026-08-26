// @vitest-environment jsdom
/**
 * AgentConversation — 预算条记忆段数据源测试（F3）
 *
 * 验证预算条与真实注入共用 buildAgentSystemSegmentsAsync：
 * 此前预算条走同步 buildAgentSystemSegments（仅 M1 ~300 tokens），
 * 实际注入含 M1+M2（~1.1k）——显示与实况不符。修复后 async 拉取
 * M2 真实值并用于 contextUsage 计算。
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import AgentConversation from './AgentConversation'
import { useAgentStore } from '../../../stores/agent-store'
import { useLLMStore } from '../../../stores/llm-store'
import { useProjectStore } from '../../../stores/project-store'

// jsdom 未实现 scrollTo / ResizeObserver（组件滚动效果与消息卡片依赖）
beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollTo = vi.fn() as never
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

function render(ui: React.ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(ui) })
  return { container, root }
}

describe('AgentConversation 预算条记忆段（F3）', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    // M2 有内容：book 文件多段落 ~1600 tokens → 节选到 800 预算
    // （注意 truncateToTokenBudget 按段落保留：单段落超预算会被整段丢弃，故用多段落）
    const bookBody = Array.from({ length: 40 }, (_, i) => `第${i + 1}节 ${'详'.repeat(30)}`).join('\n\n')
    Object.defineProperty(window, 'velaAPI', {
      value: {
        invoke: vi.fn(async (ch: string) => {
          if (ch === 'memory:list') return [{ file: 'book-state.md', kind: 'book', stale: false, mtime: 1 }]
          if (ch === 'memory:read') return `---\n---\n\n# 全书精要\n\n${bookBody}`
          return null
        }),
      },
      configurable: true,
    })
    useProjectStore.setState({ currentProject: null })
    useLLMStore.setState({ models: [], defaultModelId: null })
  })

  const readMemoryToken = (container: HTMLElement): number => {
    const m = container.textContent?.match(/记忆 (\d+)/)
    return m ? Number(m[1]) : -1
  }

  it('async 加载后记忆段反映 M2 真实值（与注入共用数据源）', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? {
        ...c,
        messages: [{ id: 'm1', role: 'user', content: '你好', createdAt: Date.now() }],
      } : c),
    }))
    const { container, root } = render(<AgentConversation />)
    // 初始（async 未就绪）：同步 M1-only 兜底——无滚动摘要 → 记忆段 0
    expect(readMemoryToken(container)).toBe(0)
    // 等待 async 段加载（microtask + effect 刷新）
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    // 记忆段 = M2 节选（≤800）+ M1（无）→ 应显著大于 0
    const memoryTokens = readMemoryToken(container)
    expect(memoryTokens).toBeGreaterThan(100)
    expect(memoryTokens).toBeLessThanOrEqual(800)
    act(() => { root.unmount() })
  })

  it('M2 读盘失败降级：记忆段回落同步 M1-only（不阻塞渲染）', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? {
        ...c,
        messages: [{ id: 'm1', role: 'user', content: '你好', createdAt: Date.now() }],
      } : c),
    }))
    ;(window.velaAPI.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no project'))
    const { container, root } = render(<AgentConversation />)
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    expect(readMemoryToken(container)).toBe(0) // 无 M1（无摘要）且 M2 失败 → 0
    act(() => { root.unmount() })
  })
})

describe('RecentConversationItem hover 行为', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    Object.defineProperty(window, 'velaAPI', {
      value: {
        invoke: vi.fn(async () => null),
      },
      configurable: true,
    })
    useProjectStore.setState({ currentProject: null })
    useLLMStore.setState({ models: [], defaultModelId: null })
    useAgentStore.setState({ conversations: [], activeConversationId: null, showHistory: false, memoryView: false })
  })

  it('右侧区域为固定宽度容器且时间/删除按钮无 hidden 切换类', () => {
    // 构造：一条有消息的会话但当前激活会话为空 → EmptyState 渲染 RecentConversationItem
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? {
        ...c,
        messages: [{ id: 'm1', role: 'user', content: '你好', createdAt: Date.now() }],
      } : c),
      activeConversationId: null,
    }))
    const { container, root } = render(<AgentConversation />)

    const row = Array.from(container.querySelectorAll('button')).find(b => b.className.includes('group'))
    expect(row).toBeTruthy()
    const deleteBtn = row!.querySelector<HTMLButtonElement>('button[title]')
    const timeSpan = row!.querySelector<HTMLSpanElement>('span')
    expect(deleteBtn).toBeTruthy()
    expect(timeSpan).toBeTruthy()

    // 断言 1：删除按钮不含 'hidden' 类（当前实现含 'hidden group-hover:flex' 做 display 切换）
    expect(deleteBtn!.className).not.toContain('hidden')
    // 断言 2：时间元素不含 'group-hover:hidden' 类（当前实现含——display 切换导致布局跳动根因）
    expect(timeSpan!.className).not.toContain('group-hover:hidden')
    // 断言 3：删除按钮的祖先容器有固定宽度 style（当前实现无固定宽度——修复前此断言失败，防假绿）
    const rightBox = deleteBtn!.parentElement!
    expect(rightBox.style.width).not.toBe('')
    // 正向锁定：固定宽度容器 + 两端 opacity 过渡替代 display 切换
    expect(rightBox.className).toContain('relative')
    expect(deleteBtn!.className).toContain('group-hover:opacity-100')
    expect(timeSpan!.className).toContain('group-hover:opacity-0')
    // 时间元素基础透明度须走类而非内联 style（内联 opacity 会压过 group-hover:opacity-0，hover 永不淡出）
    expect(timeSpan!.style.opacity).toBe('')

    act(() => { root.unmount() })
  })
})

describe('EmptyState 历史条数配置', () => {
  // 通道路由 mock：EmptyState 读取 config:get 控制最近会话条数；
  // makeConvs 的 createConversation 会触发 initializeTools → skillRegistry.loadAll（异步先消费 ipc 调用），
  // 故 mock 必须按通道分流，保证 config:get 精确命中测试值
  let configValue: unknown = null
  let configError: Error | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
    configValue = null
    configError = null
    Object.defineProperty(window, 'velaAPI', {
      value: {
        invoke: vi.fn(async (ch: string) => {
          if (ch === 'config:get') {
            if (configError) throw configError
            return configValue
          }
          return null
        }),
      },
      configurable: true,
    })
    useProjectStore.setState({ currentProject: null })
    useLLMStore.setState({ models: [], defaultModelId: null })
    useAgentStore.setState({ conversations: [], activeConversationId: null, showHistory: false, memoryView: false })
  })

  /** 构造 n 条带消息的会话（最新在前），并置空活跃会话 → 渲染 EmptyState */
  const makeConvs = (n: number) => {
    for (let i = 0; i < n; i++) {
      const conv = useAgentStore.getState().createConversation({ title: `会话${i}` })
      useAgentStore.setState(state => ({
        conversations: state.conversations.map(c => c.id === conv.id ? {
          ...c,
          messages: [{ id: `m${i}`, role: 'user', content: '你好', createdAt: Date.now() }],
        } : c),
      }))
    }
    useAgentStore.setState({ activeConversationId: null })
  }

  /** 统计最近会话行数（RecentConversationItem 外层按钮 token 恰为 group；内层删除按钮为 group-hover:* 不算） */
  const recentRowCount = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('button'))
      .filter(b => b.className.split(' ').includes('group')).length

  it('按 config recentConversationCount 显示条数（mock 5 → 显示 5 条）', async () => {
    configValue = { recentConversationCount: 5 }
    makeConvs(6)
    const { container, root } = render(<AgentConversation />)
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    expect(recentRowCount(container)).toBe(5) // slice(0, recentCount)：mock 5 → 显示 5 条
    expect(container.textContent).toContain('查看全部对话') // 6 > 5 → 「加载更多」出现
    act(() => { root.unmount() })
  })

  it('config 读取失败/无配置时默认 3 条', async () => {
    configError = new Error('no config')
    makeConvs(4)
    const { container, root } = render(<AgentConversation />)
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    expect(recentRowCount(container)).toBe(3) // 读取失败 → 默认 3 条
    expect(container.textContent).toContain('查看全部对话') // 4 > 3 → 「加载更多」仍出现
    act(() => { root.unmount() })
  })
})
