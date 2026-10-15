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

  it('含思考块的助手消息渲染为 24px 折叠行（折叠显示首行摘要，展开显示完整正文）', () => {
    const msg = {
      id: '1',
      role: 'assistant' as const,
      content: '_思考过程：_\n> 先构思情节走向\n\n正式正文内容',
      createdAt: 0,
    }
    const { container, root } = render(<AgentMessage message={msg} />)
    // 折叠行标题存在（i18n agent.thinkingToggle = 「思考过程」）
    expect(container.textContent).toContain('思考过程')
    // dsh 形态：折叠时显示首行摘要（「先构思情节走向」作为摘要可见）
    expect(container.textContent).toContain('先构思情节走向')
    // 正文内容可见
    expect(container.textContent).toContain('正式正文内容')
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
    // 无思考折叠按钮 —— 按折叠头部的特征类判断：
    // 2026-09-22 起每条回复底部固定有「复制 / 满意 / 不满意」按钮，
    // 再笼统断言 `querySelector('button') === null` 已不成立
    expect(container.querySelector('[class*="w-full text-left"]')).toBeNull()
    act(() => { root.unmount() })
  })
})

describe('AgentMessage 分支操作', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('操作区**持续显示**（2026-09-22 起不再 hover 显隐），提供 onFork/onRewind 回调时渲染按钮', () => {
    const onFork = vi.fn()
    const onRewind = vi.fn()
    const msg = { id: 'm1', role: 'assistant' as const, content: '正文', createdAt: 0 }
    const { container, root } = render(<AgentMessage message={msg} onFork={onFork} onRewind={onRewind} />)
    // 操作区容器常显：仍用固定容器（禁止 display 切换导致布局跳动）
    const actions = container.querySelector<HTMLElement>('[title="从此处分支"]')?.parentElement
    expect(actions).toBeTruthy()
    expect(actions!.classList.contains('opacity-0')).toBe(false)
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

  it('底部操作条：5 个图标按钮热区均 32×32（图标视觉仍 12px）+ aria-label + 同令牌 hover', () => {
    const msg = { id: 'm1', role: 'assistant' as const, content: '正文', createdAt: 0 }
    const { container, root } = render(<AgentMessage message={msg} onFork={vi.fn()} onRewind={vi.fn()} />)
    // 复制 / 满意 / 不满意 / 分支 / 回退 —— 按 zh-CN title 逐个取（键值断言，避免键名 cast）
    const titles = ['复制消息', '有帮助', '没帮助', '从此处分支', '回退到此处']
    for (const title of titles) {
      const btn = container.querySelector<HTMLButtonElement>(`[title="${title}"]`)
      expect(btn, `缺少按钮：${title}`).toBeTruthy()
      // card-affordance-standard §5.2：桌面热区 ≥32×32，固定像素（不是 rem 档位倒推）
      expect(btn!.style.width).toBe('32px')
      expect(btn!.style.height).toBe('32px')
      // ui-interaction-standard §3.2：title 服务看得见的人，aria-label 服务读屏，两者都要
      expect(btn!.getAttribute('aria-label')).toBe(title)
      // 单图标按钮必须有 hover 底色变化，且与行片同令牌
      expect(btn!.className).toContain('hover:bg-[var(--color-hover)]')
    }
    // §5.2 相邻中心距 ≥40px：32px + gap-2.5(8.75px) = 40.75px
    const bar = container.querySelector<HTMLElement>('[title="复制消息"]')!.parentElement!
    expect(bar.className).toContain('gap-2.5')
    // 操作条容器自身不点亮（否则留死带）
    expect(bar.className).not.toContain('hover:bg-')
    // 形态 A：操作按钮是外层 div 的兄弟，不存在 button 嵌 button
    expect(container.querySelectorAll('button button')).toHaveLength(0)
    act(() => { root.unmount() })
  })

  it('末条回退禁用：热区仍 32×32，但禁用态不挂 hover 底色（禁用三件套之一）', () => {
    const msg = { id: 'm1', role: 'assistant' as const, content: '正文', createdAt: 0 }
    const { container, root } = render(<AgentMessage message={msg} onRewind={vi.fn()} rewindDisabled />)
    const btn = container.querySelector<HTMLButtonElement>('[title="最后一条消息，无需回退"]')
    expect(btn).toBeTruthy()
    expect(btn!.disabled).toBe(true)
    expect(btn!.style.width).toBe('32px')
    expect(btn!.style.height).toBe('32px')
    expect(btn!.className).not.toContain('hover:bg-')
    expect(btn!.style.cursor).toBe('not-allowed')
    act(() => { root.unmount() })
  })

  it('用户消息（role=user）气泡变体：右对齐 + 内容原样 + 气泡下方只有时间与复制', () => {
    const onFork = vi.fn()
    const onRewind = vi.fn()
    const msg = { id: 'u1', role: 'user' as const, content: '用户输入的原样文本', createdAt: 0 }
    const { container, root } = render(<AgentMessage message={msg} onFork={onFork} onRewind={onRewind} />)
    const wrap = container.firstElementChild as HTMLElement
    // 用户消息右对齐（助手消息为 left）。
    // 2026-09-22 起改为纵向布局（flex-col items-end）：气泡在上、时间与操作在气泡**下方**
    expect(wrap.className).toContain('items-end')
    expect(wrap.className).not.toContain('items-start')
    // 气泡样式：accent 半透明背景（内联 style，用户消息专用视觉）。
    // 2026-09-22 起操作区移到气泡**外**，气泡不再是 wrap 的第一个子元素 —— 改为按内容定位。
    const bubble = [...wrap.children].find(el => (el.textContent || '').includes('用户输入的原样文本')) as HTMLElement
    expect(bubble).toBeTruthy()
    expect(bubble.style.backgroundColor).toBe('rgba(var(--color-accent-rgb), 0.12)')
    // 内容原样渲染（不走 Markdown/思考块拆分）
    expect(container.textContent).toContain('用户输入的原样文本')
    // 2026-09-22：用户气泡下方只保留「时间 + 复制」——
    // 分支 / 回退只在模型回复下方渲染，用户消息不再出现这两个按钮
    expect(container.querySelector('[title="从此处分支"]')).toBeNull()
    expect(container.querySelector('[title="回退到此处"]')).toBeNull()
    expect(container.querySelector('[title="复制消息"]')).toBeTruthy()
    expect(onFork).not.toHaveBeenCalled()
    expect(onRewind).not.toHaveBeenCalled()
    act(() => { root.unmount() })
  })

  it('用户消息那一行：时间 + 复制同处一条，复制热区 32×32；行容器不点亮（无死带）', () => {
    const msg = { id: 'u1', role: 'user' as const, content: '用户输入的原样文本', createdAt: 0 }
    const { container, root } = render(<AgentMessage message={msg} />)
    const copy = container.querySelector<HTMLButtonElement>('[title="复制消息"]')
    expect(copy).toBeTruthy()
    // 热区口径与助手消息一致：32×32 固定像素
    expect(copy!.style.width).toBe('32px')
    expect(copy!.style.height).toBe('32px')
    expect(copy!.getAttribute('aria-label')).toBe('复制消息')
    // 时间与按钮同处一条（同一行容器）
    const row = copy!.parentElement as HTMLElement
    expect(row.className).toContain('items-center')
    expect(row.querySelectorAll('button')).toHaveLength(1)
    // 时间仍是纯文本：不可点、无手型、无 hover 暗示
    const time = row.querySelector('span') as HTMLElement
    expect(time).toBeTruthy()
    expect(time.className).not.toContain('cursor-pointer')
    expect(time.className).not.toContain('hover:bg-')
    // 死带禁令（§3）：行容器自身不点亮 —— hover 亮起的边界只有按钮的 32×32 热区，
    // 不存在「亮了却点不动」的时间段/内边距
    expect(row.className).not.toContain('hover:bg-')
    expect(row.getAttribute('role')).toBeNull()
    expect(container.querySelectorAll('button button')).toHaveLength(0)
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
  it('read_file 调用显示文件名摘要（单行，工具类型由图标分族表达，不再用 emoji 前缀）', () => {
    const tc = { id: '1', toolName: 'read_file', arguments: { file_path: 'C:\\proj\\note.md' }, status: 'completed' as const }
    const { container, root } = render(<ToolCallBlock toolCall={tc} />)
    expect(container.textContent).toContain('note.md')
    act(() => { root.unmount() })
  })

  it('无路径参数的工具不显示文件摘要', () => {
    const tc = { id: '2', toolName: 'calculator', arguments: { expression: '1+1' }, status: 'completed' as const }
    const { container, root } = render(<ToolCallBlock toolCall={tc} />)
    expect(container.textContent).not.toContain('📄')
    act(() => { root.unmount() })
  })

  it('read_drafts 调用显示章节摘要（chapter_number 参数）', () => {
    const tc = { id: '3', toolName: 'read_drafts', arguments: { chapter_number: 3 }, status: 'completed' as const }
    const { container, root } = render(<ToolCallBlock toolCall={tc} />)
    // chapter.label 三语：zh「第3章」/ en「Ch.3」/ ru「Гл.3」
    expect(container.textContent).toMatch(/第3章|Ch\.3|Гл\.3/)
    act(() => { root.unmount() })
  })

  it('read_characters 调用显示角色摘要（character_name 参数）', () => {
    const tc = { id: '4', toolName: 'read_characters', arguments: { character_name: '林晚' }, status: 'completed' as const }
    const { container, root } = render(<ToolCallBlock toolCall={tc} />)
    expect(container.textContent).toContain('林晚')
    act(() => { root.unmount() })
  })

  it('角色工具使用 name 参数（非真实 schema）时不触发角色摘要', () => {
    const tc = { id: '5', toolName: 'read_characters', arguments: { name: '林晚' }, status: 'completed' as const }
    const { container, root } = render(<ToolCallBlock toolCall={tc} />)
    expect(container.textContent).not.toContain('👤')
    act(() => { root.unmount() })
  })
})
