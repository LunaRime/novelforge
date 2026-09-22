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
import { useAgentStore, type AgentConversation as AgentConv } from '../../../stores/agent-store'
import { useLLMStore } from '../../../stores/llm-store'
import { useProjectStore } from '../../../stores/project-store'
import { t } from '../../../shared/locale'

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

  // 从预算条的 data 属性取四段 token（base,memory,history,current）的第 2 段。
  // 2026-09-22 UI 重做后，窄面板放不下「记忆 N」这类标签（已挪进 title），
  // 原本按文案正则匹配的写法会失效 —— 改读 data 属性，与文案解耦。
  const readMemoryToken = (container: HTMLElement): number => {
    const raw = container.querySelector('[data-budget-segments]')?.getAttribute('data-budget-segments')
    if (!raw) return -1
    const parts = raw.split(',')
    return parts[1] === undefined ? -1 : Number(parts[1])
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

    // 2026-09-22 起外层的 role="button" 的 div（内联重命名要放 input，不能嵌在 <button> 里）
    const row = Array.from(container.querySelectorAll<HTMLElement>('[role="button"], button'))
      .find(el => el.className.includes('group'))
    expect(row).toBeTruthy()
    // 操作组里**最后一个**才是删除（前面还有 置顶 / 重命名 / 分叉 / 归档）
    const opBtns = Array.from(row!.querySelectorAll<HTMLButtonElement>('button[title]'))
    const deleteBtn = opBtns[opBtns.length - 1]
    const timeSpan = row!.querySelector<HTMLSpanElement>('span')
    expect(deleteBtn).toBeTruthy()
    expect(timeSpan).toBeTruthy()

    // 断言 1：删除按钮不含 'hidden' 类（当前实现含 'hidden group-hover:flex' 做 display 切换）
    expect(deleteBtn!.className).not.toContain('hidden')
    // 断言 2：时间元素不含 'group-hover:hidden' 类（当前实现含——display 切换导致布局跳动根因）
    expect(timeSpan!.className).not.toContain('group-hover:hidden')
    // 断言 3：删除按钮的祖先容器有固定宽度 style（当前实现无固定宽度——修复前此断言失败，防假绿）
    // ⚠️ 2026-09-22 起多了一层「操作组容器」：删除按钮的**祖父**才是固定宽度容器
    const rightBox = deleteBtn!.parentElement!.parentElement!
    expect(rightBox.style.width).not.toBe('')
    // 正向锁定：固定宽度容器 + 两端 opacity 过渡替代 display 切换
    expect(rightBox.className).toContain('relative')
    // hover 淡入的是**操作组容器**（2026-09-22 起按钮本身只带 ACT_BTN 样式）
    expect(rightBox.lastElementChild!.className).toContain('group-hover:opacity-100')
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

  /** 统计最近会话行数（RecentConversationItem 外层 token 恰为 group；
   *  2026-09-22 起外层是 role="button" 的 div —— 内联重命名要放 input，不能嵌在 button 里） */
  const recentRowCount = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<HTMLElement>('[role="button"]'))
      .filter(el => el.className.split(' ').includes('group')).length

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

describe('AgentHistoryPanel fork 层级', () => {
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

  /** 构造根会话 R + fork 子会话 C（parentId=R, forkMessageId='m1'），并打开历史面板 */
  const makeForkState = () => {
    const now = Date.now()
    const rootConv: AgentConv = {
      id: 'conv-root',
      title: '父会话A',
      messages: [{ id: 'm1', role: 'user', content: '你好', createdAt: now }],
      createdAt: now,
      updatedAt: now,
      mode: 'balanced',
      modelId: null,
    }
    const childConv: AgentConv = {
      ...rootConv,
      id: 'conv-fork',
      title: '子会话B',
      createdAt: now + 1,
      updatedAt: now + 1, // fork 后创建 → 排序更靠前
      parentId: rootConv.id,
      forkMessageId: 'm1',
    }
    useAgentStore.setState({ conversations: [childConv, rootConv], activeConversationId: null, showHistory: true })
    return { rootConv, childConv }
  }

  /** RecentConversationItem 外层行（外层 token 恰为 group；内层按钮为 group-hover:* 不算）。
   *  2026-09-22 起外层是 role="button" 的 div —— 内联重命名要放 input，不能嵌在 button 里 */
  const historyRows = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<HTMLElement>('[role="button"]'))
      .filter(el => el.className.split(' ').includes('group'))

  it('fork 子会话缩进显示 + GitFork 图标 + 父会话标注', () => {
    const { rootConv, childConv } = makeForkState()
    const { container, root } = render(<AgentConversation />)
    const rows = historyRows(container)
    expect(rows).toHaveLength(2)
    const rowC = rows.find(r => r.textContent?.includes(childConv.title))!
    expect(rowC).toBeTruthy()
    // 缩进：固定 pl-5（C1 教训——固定缩进无布局跳动）
    expect(rowC.className).toContain('pl-5')
    // 分支图标：lucide-react 1.8.0 无 ForkRight（B2 实测核验）→ GitFork
    expect(rowC.querySelector('svg.lucide-git-fork')).toBeTruthy()
    // 父会话标注：与组件同源 t() 计算期望值（B3 评审 Minor③ 防同源遮蔽——下方另补字面量断言）
    const expectedLabel = t('agent.forkedFrom').replace('{title}', rootConv.title)
    expect(rowC.textContent).toContain(expectedLabel)
    // 真实渲染断言（B4 收尾，B3 评审 Minor③）：zh-CN 模板「来自「{title}」」的实际求值
    // 「来自「父会话A」」——字面量断言验证模板占位符 {title} 已被正确替换；
    // 若替换失败（如组件 .replace('{xx}') 不匹配），同源 t() 期望值仍通过而此断言失败（假绿反制）
    expect(rowC.textContent).toContain('来自「父会话A」')
    act(() => { root.unmount() })
  })

  it('根会话无标注', () => {
    const { rootConv, childConv } = makeForkState()
    const { container, root } = render(<AgentConversation />)
    // B4 收尾修正：fork 子会话标注包含父标题文本——单按 rootConv.title 匹配会误中
    // 子会话行（其「来自『父会话A』」标注含该文本），须排除子会话标题作双重区分
    const rowR = historyRows(container).find(r =>
      r.textContent?.includes(rootConv.title) && !r.textContent?.includes(childConv.title)
    )!
    expect(rowR).toBeTruthy()
    // 根会话：无缩进、无**标注**、无标注文本。
    // ⚠️ 2026-09-22 起操作组里的「分叉」按钮也用 GitFork 图标，笼统查 svg.lucide-git-fork
    // 会命中按钮本身 —— 改用数量锁定：根会话只有按钮那 1 个（子会话还会有标注用的第 2 个）
    expect(rowR.className).not.toContain('pl-5')
    expect(rowR.querySelectorAll('svg.lucide-git-fork')).toHaveLength(1)
    expect(rowR.textContent).not.toContain('agent.forkedFrom')
    expect(rowR.textContent).not.toContain('来自')
    act(() => { root.unmount() })
  })
})

describe('AgentConversation 末条消息 rewind 禁用（D1/F6）', () => {
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

  /** 构造带 4 条可见消息的活跃会话（user/assistant 交替，无 system——显示即物理序） */
  const makeActiveConv = () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? {
        ...c,
        mode: 'balanced',
        messages: [
          { id: 'm1', role: 'user', content: '你好', createdAt: Date.now() },
          { id: 'm2', role: 'assistant', content: '你好呀', createdAt: Date.now() + 1 },
          { id: 'm3', role: 'user', content: '继续', createdAt: Date.now() + 2 },
          { id: 'm4', role: 'assistant', content: '好的', createdAt: Date.now() + 3 },
        ],
      } : c),
    }))
    return conv
  }

  it('末条消息 rewind 按钮 disabled（解释性 tooltip），其余消息保持可点（F6 静默 no-op 消除）', () => {
    makeActiveConv()
    const { container, root } = render(<AgentConversation />)

    // rewind 按钮：正常态 title=agent.rewindToHere；禁用态 title=agent.rewindLastMessage（二选一匹配）
    const rewindBtns = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .filter(b => b.title === t('agent.rewindToHere') || b.title === t('agent.rewindLastMessage'))
    // 2026-09-22：分支 / 回退只在**模型回复**下方渲染，用户消息不再有 ——
    // 本 fixture 是 2 条用户 + 2 条助手，所以只剩 2 个
    expect(rewindBtns).toHaveLength(2)
    // 末条助手消息（DOM 序最后一个）禁用 + 解释性 tooltip
    const last = rewindBtns[rewindBtns.length - 1]!
    expect(last.disabled).toBe(true)
    expect(last.title).toBe(t('agent.rewindLastMessage'))
    // 另一条助手消息可点且 tooltip 不变
    expect(rewindBtns[0]!.disabled).toBe(false)
    expect(rewindBtns[0]!.title).toBe(t('agent.rewindToHere'))
    // 禁用不影响 fork 入口（两条助手消息均可见 GitFork 按钮）
    expect(container.querySelectorAll('svg.lucide-git-fork')).toHaveLength(2)

    act(() => { root.unmount() })
  })
})
