// @vitest-environment jsdom
/**
 * AgentMessage — 对话思考块默认折叠 + ToolCallBlock 文件摘要（C4）
 *
 * 验证渲染层拆分解析 `_思考过程：_\n> ...` 前缀：助手消息的思考块默认
 * 折叠为「思考过程」头部（点击展开后正文可见），正文不受影响；无思考块
 * 的普通内容原样渲染。另含 ToolCallBlock 头部 📄/📖/👤 摘要。
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import AgentMessage from './AgentMessage'
import ToolCallBlock from './ToolCallBlock'

function render(ui: React.ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(ui) })
  return { container, root }
}

describe('AgentMessage 思考折叠', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('含思考块的助手消息渲染为折叠头部（默认不展开思考内容）', () => {
    const msg = {
      id: '1',
      role: 'assistant' as const,
      content: '_思考过程：_\n> 先构思情节走向\n\n正式正文内容',
      createdAt: 0,
    }
    const { container, root } = render(<AgentMessage message={msg} />)
    // 折叠头部存在（i18n agent.thinkingPrefix = 「思考过程：」）
    expect(container.textContent).toContain('思考过程')
    // 思考正文默认不可见（折叠）
    expect(container.textContent).not.toContain('先构思情节走向')
    // 正文内容可见
    expect(container.textContent).toContain('正式正文内容')
    // 点击头部展开后思考正文可见
    const toggle = container.querySelector<HTMLButtonElement>('button')
    expect(toggle).toBeTruthy()
    act(() => { toggle!.click() })
    expect(container.textContent).toContain('先构思情节走向')
    act(() => { root.unmount() })
  })

  it('无思考块的普通内容不受影响', () => {
    const msg = {
      id: '2',
      role: 'assistant' as const,
      content: '普通正文内容没有思考块',
      createdAt: 0,
    }
    const { container, root } = render(<AgentMessage message={msg} />)
    expect(container.textContent).toContain('普通正文内容没有思考块')
    // 无折叠按钮（思考块头部）
    expect(container.querySelector('button')).toBeNull()
    act(() => { root.unmount() })
  })
})

describe('AgentMessage 分支操作', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('hover 操作区默认不可见（opacity-0 + 无 display 切换），提供 onFork/onRewind 回调时渲染按钮', () => {
    const onFork = vi.fn()
    const onRewind = vi.fn()
    const msg = { id: 'm1', role: 'assistant' as const, content: '正文', createdAt: 0 }
    const { container, root } = render(<AgentMessage message={msg} onFork={onFork} onRewind={onRewind} />)
    // 操作区容器存在：opacity 过渡模式（C1：固定容器，禁止 display 切换导致布局跳动）
    const actions = container.querySelector<HTMLElement>('[class*="group-hover:opacity-100"]')
    expect(actions).toBeTruthy()
    expect(actions!.classList.contains('opacity-0')).toBe(true)
    expect(actions!.classList.contains('transition-opacity')).toBe(true)
    expect(actions!.classList.contains('hidden')).toBe(false)
    // 两个按钮 title 存在（B4 键落地后为真实 zh-CN 文案，按键值断言——键名断言已随 cast 移除失效）
    expect(container.querySelector('[title="从此处分支"]')).toBeTruthy()
    expect(container.querySelector('[title="回退到此处"]')).toBeTruthy()
    act(() => { root.unmount() })
  })

  it('点击 fork 按钮回调携带 messageId', () => {
    const onFork = vi.fn()
    const msg = { id: 'm1', role: 'assistant' as const, content: '正文', createdAt: 0 }
    const { container, root } = render(<AgentMessage message={msg} onFork={onFork} />)
    const fork = container.querySelector<HTMLButtonElement>('[title="从此处分支"]')
    expect(fork).toBeTruthy()
    act(() => { fork!.click() })
    expect(onFork).toHaveBeenCalledWith('m1')
    act(() => { root.unmount() })
  })

  it('点击 rewind 按钮回调携带 messageId（B2 补强）', () => {
    const onRewind = vi.fn()
    const msg = { id: 'm1', role: 'assistant' as const, content: '正文', createdAt: 0 }
    const { container, root } = render(<AgentMessage message={msg} onRewind={onRewind} />)
    const rewind = container.querySelector<HTMLButtonElement>('[title="回退到此处"]')
    expect(rewind).toBeTruthy()
    act(() => { rewind!.click() })
    expect(onRewind).toHaveBeenCalledWith('m1')
    act(() => { root.unmount() })
  })

  it('用户消息（role=user）气泡变体：右对齐 + 内容原样 + 分支操作区可用（B2 补强）', () => {
    const onFork = vi.fn()
    const onRewind = vi.fn()
    const msg = { id: 'u1', role: 'user' as const, content: '用户输入的原样文本', createdAt: 0 }
    const { container, root } = render(<AgentMessage message={msg} onFork={onFork} onRewind={onRewind} />)
    const wrap = container.firstElementChild as HTMLElement
    // 用户消息右对齐（助手消息为 justify-start——两类消息的视觉区分点）
    expect(wrap.className).toContain('justify-end')
    expect(wrap.className).not.toContain('justify-start')
    // 气泡样式：accent 半透明背景（内联 style，用户消息专用视觉）
    const bubble = wrap.firstElementChild as HTMLElement
    expect(bubble.style.backgroundColor).toBe('rgba(var(--color-accent-rgb), 0.12)')
    // 内容原样渲染（不走 Markdown/思考块拆分）
    expect(container.textContent).toContain('用户输入的原样文本')
    // 分支操作区在气泡内且可用（fork/rewind 回调均触发）
    act(() => {
      container.querySelector<HTMLButtonElement>('[title="从此处分支"]')!.click()
      container.querySelector<HTMLButtonElement>('[title="回退到此处"]')!.click()
    })
    expect(onFork).toHaveBeenCalledWith('u1')
    expect(onRewind).toHaveBeenCalledWith('u1')
    act(() => { root.unmount() })
  })

  it('无 onFork/onRewind props 时不渲染操作区（只读历史/归档视图兼容）', () => {
    const msg = { id: 'm1', role: 'assistant' as const, content: '正文', createdAt: 0 }
    const { container, root } = render(<AgentMessage message={msg} />)
    expect(container.querySelector('[title="从此处分支"]')).toBeNull()
    expect(container.querySelector('[title="回退到此处"]')).toBeNull()
    expect(container.querySelector('[class*="group-hover:opacity-100"]')).toBeNull()
    act(() => { root.unmount() })
  })
})

describe('ToolCallBlock 文件摘要', () => {
  it('read_file 调用显示 📄 文件名摘要', () => {
    const tc = { id: '1', toolName: 'read_file', arguments: { file_path: 'C:\\proj\\note.md' }, status: 'completed' as const }
    const { container, root } = render(<ToolCallBlock toolCall={tc} />)
    expect(container.textContent).toContain('📄 note.md')
    act(() => { root.unmount() })
  })

  it('无路径参数的工具不显示文件摘要', () => {
    const tc = { id: '2', toolName: 'calculator', arguments: { expression: '1+1' }, status: 'completed' as const }
    const { container, root } = render(<ToolCallBlock toolCall={tc} />)
    expect(container.textContent).not.toContain('📄')
    act(() => { root.unmount() })
  })

  it('read_drafts 调用显示 📖 章节摘要（chapter_number 参数）', () => {
    const tc = { id: '3', toolName: 'read_drafts', arguments: { chapter_number: 3 }, status: 'completed' as const }
    const { container, root } = render(<ToolCallBlock toolCall={tc} />)
    expect(container.textContent).toContain('📖')
    // chapter.label 三语：zh「第3章」/ en「Ch.3」/ ru「Гл.3」
    expect(container.textContent).toMatch(/第3章|Ch\.3|Гл\.3/)
    act(() => { root.unmount() })
  })

  it('read_characters 调用显示 👤 角色摘要（character_name 参数）', () => {
    const tc = { id: '4', toolName: 'read_characters', arguments: { character_name: '林晚' }, status: 'completed' as const }
    const { container, root } = render(<ToolCallBlock toolCall={tc} />)
    expect(container.textContent).toContain('👤 林晚')
    act(() => { root.unmount() })
  })

  it('角色工具使用 name 参数（非真实 schema）时不触发 👤 摘要', () => {
    const tc = { id: '5', toolName: 'read_characters', arguments: { name: '林晚' }, status: 'completed' as const }
    const { container, root } = render(<ToolCallBlock toolCall={tc} />)
    expect(container.textContent).not.toContain('👤')
    act(() => { root.unmount() })
  })
})
