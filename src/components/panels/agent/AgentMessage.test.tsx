// @vitest-environment jsdom
/**
 * AgentMessage — 对话思考块默认折叠 + ToolCallBlock 文件摘要（C4）
 *
 * 验证渲染层拆分解析 `_思考过程：_\n> ...` 前缀：助手消息的思考块默认
 * 折叠为「思考过程」头部（点击展开后正文可见），正文不受影响；无思考块
 * 的普通内容原样渲染。另含 ToolCallBlock 头部 📄/📖/👤 摘要。
 *
 * 2026-10-17 追加：正文段与工具批按 `contentOffset` 交错渲染（dsh step 节奏）——
 * 多轮 ReAct 回复应为「正文段 → 工具行/过程组 → 正文段」，旧归档（无 offset）保持底部布局。
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import AgentMessage from './AgentMessage'
import ToolCallBlock from './ToolCallBlock'
import type { ToolCallInfo } from '../../../services/agent/agent-engine'

function render(ui: React.ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(ui) })
  return { container, root }
}

/** 构造工具调用夹具（contentOffset 缺省 = 旧归档形态） */
function toolCall(id: string, toolName: string, contentOffset?: number): ToolCallInfo {
  return {
    id,
    toolName,
    arguments: {},
    status: 'completed',
    ...(contentOffset === undefined ? {} : { contentOffset }),
  }
}

/**
 * 提取「正文段 / 思考行 / 工具行 / 过程组」在 DOM 中的顺序标记。
 * querySelectorAll 返回文档顺序 —— 直接用来断言交错顺序，而不是靠整体 textContent。
 */
function domOrder(container: HTMLElement): string[] {
  const nodes = container.querySelectorAll('.assistant-content, [data-variant="think"], [data-tool], [data-process-group]')
  return [...nodes].map(el => {
    if (el.classList.contains('assistant-content')) return `text:${(el.textContent ?? '').trim()}`
    if (el.getAttribute('data-variant') === 'think') return 'think'
    if (el.hasAttribute('data-process-group')) return 'group'
    return `tool:${el.getAttribute('data-tool')}`
  })
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

  it('底部操作条：5 个图标按钮为原样式（22×22、gap-0.5、hover:opacity-70）', () => {
    const msg = { id: 'm1', role: 'assistant' as const, content: '正文', createdAt: 0 }
    const { container, root } = render(<AgentMessage message={msg} onFork={vi.fn()} onRewind={vi.fn()} />)
    // 复制 / 满意 / 不满意 / 分支 / 回退 —— 按 zh-CN title 逐个取（键值断言，避免键名 cast）
    const titles = ['复制消息', '有帮助', '没帮助', '从此处分支', '回退到此处']
    for (const title of titles) {
      const btn = container.querySelector<HTMLButtonElement>(`[title="${title}"]`)
      expect(btn, `缺少按钮：${title}`).toBeTruthy()
      // ⚠️ 2026-10-16 用户裁决：**改回原样式** —— 22×22 固定像素（2026-09-22 起的形态）。
      // 这一排按钮不在「历史会话行选中范围」的改动范围内；不要再按 §5.2 把它改成 32×32。
      expect(btn!.style.width).toBe('22px')
      expect(btn!.style.height).toBe('22px')
      // hover 反馈是透明度变化（原样式），不是底色块
      expect(btn!.className).toContain('hover:opacity-70')
    }
    // 原间距 gap-0.5
    const bar = container.querySelector<HTMLElement>('[title="复制消息"]')!.parentElement!
    expect(bar.className).toContain('gap-0.5')
    // 操作条容器自身不点亮
    expect(bar.className).not.toContain('hover:bg-')
    // 形态 A：操作按钮是外层 div 的兄弟，不存在 button 嵌 button
    expect(container.querySelectorAll('button button')).toHaveLength(0)
    act(() => { root.unmount() })
  })

  it('末条回退禁用：原样式 22×22 + 禁用态三件套（淡化 / not-allowed / hover 不生效）', () => {
    const msg = { id: 'm1', role: 'assistant' as const, content: '正文', createdAt: 0 }
    const { container, root } = render(<AgentMessage message={msg} onRewind={vi.fn()} rewindDisabled />)
    const btn = container.querySelector<HTMLButtonElement>('[title="最后一条消息，无需回退"]')
    expect(btn).toBeTruthy()
    expect(btn!.disabled).toBe(true)
    expect(btn!.style.width).toBe('22px')
    expect(btn!.style.height).toBe('22px')
    // 内联 opacity 压过 hover:opacity-70（禁用态 hover 不生效）
    expect(btn!.style.opacity).toBe('0.4')
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

  it('用户消息那一行：时间 + 复制同处一条（原样式：复制 22×22）', () => {
    const msg = { id: 'u1', role: 'user' as const, content: '用户输入的原样文本', createdAt: 0 }
    const { container, root } = render(<AgentMessage message={msg} />)
    const copy = container.querySelector<HTMLButtonElement>('[title="复制消息"]')
    expect(copy).toBeTruthy()
    // ⚠️ 2026-10-16 用户裁决：这排按钮**改回原样式**（22×22，闲置快照 = 2026-09-22 起的形态）
    expect(copy!.style.width).toBe('22px')
    expect(copy!.style.height).toBe('22px')
    // 时间与按钮同处一条（同一行容器）
    const row = copy!.parentElement as HTMLElement
    expect(row.className).toContain('items-center')
    expect(row.querySelectorAll('button')).toHaveLength(1)
    // 时间仍是纯文本：不可点、无手型、无 hover 暗示
    const time = row.querySelector('span') as HTMLElement
    expect(time).toBeTruthy()
    expect(time.className).not.toContain('cursor-pointer')
    expect(time.className).not.toContain('hover:bg-')
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

describe('正文与工具调用交错渲染（contentOffset，2026-10-17）', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('正文段 → 工具行 → 正文段：按 offset 插回对应位置，不再所有工具卡堆在底部', () => {
    const content = '先读文件。然后写入。最后完成。'
    const first = '先读文件。'.length
    const second = '先读文件。然后写入。'.length
    const msg = {
      id: 'a1',
      role: 'assistant' as const,
      content,
      createdAt: 0,
      toolCalls: [toolCall('t1', 'read_file', first), toolCall('t2', 'write_file', second)],
    }
    const { container, root } = render(<AgentMessage message={msg} />)
    // 交错容器存在 + 统一 8px 节奏（gap-2，不是任意值字号/间距）
    const timeline = container.querySelector<HTMLElement>('[data-agent-timeline]')
    expect(timeline).toBeTruthy()
    expect(timeline!.className).toContain('flex-col')
    expect(timeline!.className).toContain('gap-2')
    expect(domOrder(container)).toEqual([
      'text:先读文件。',
      'tool:read_file',
      'text:然后写入。',
      'tool:write_file',
      'text:最后完成。',
    ])
    act(() => { root.unmount() })
  })

  it('同一轮多个调用（offset 相同）合并为一个过程组，插在当轮正文之后', () => {
    const content = '并行读取两个文件后汇总。'
    const offset = '并行读取'.length
    const msg = {
      id: 'a2',
      role: 'assistant' as const,
      content,
      createdAt: 0,
      toolCalls: [toolCall('t1', 'read_file', offset), toolCall('t2', 'read_file', offset)],
    }
    const { container, root } = render(<AgentMessage message={msg} />)
    // ≥2 个连续工具沿用 ProcessGroup（过程组降噪），单行折叠在正文段之间
    expect(domOrder(container)).toEqual(['text:并行读取', 'group', 'text:两个文件后汇总。'])
    act(() => { root.unmount() })
  })

  it('旧归档（无 contentOffset）保持旧布局：正文整体在前、工具组在底部', () => {
    const msg = {
      id: 'a3',
      role: 'assistant' as const,
      content: '旧归档正文',
      createdAt: 0,
      toolCalls: [toolCall('t1', 'read_file'), toolCall('t2', 'write_file')],
    }
    const { container, root } = render(<AgentMessage message={msg} />)
    expect(container.querySelector('[data-agent-timeline]')).toBeNull()
    expect(domOrder(container)).toEqual(['text:旧归档正文', 'group'])
    act(() => { root.unmount() })
  })

  it('offset 超出正文长度：clamp 到正文末尾（不崩、不误置顶）', () => {
    const msg = {
      id: 'a4',
      role: 'assistant' as const,
      content: '正文只有这些。',
      createdAt: 0,
      toolCalls: [toolCall('t1', 'read_file', 9999)],
    }
    const { container, root } = render(<AgentMessage message={msg} />)
    expect(domOrder(container)).toEqual(['text:正文只有这些。', 'tool:read_file'])
    act(() => { root.unmount() })
  })

  it('思考前缀 + 越界 offset：按实际正文（rest）长度 clamp，工具卡不跑到正文之前', () => {
    const msg = {
      id: 'a5',
      role: 'assistant' as const,
      content: '_思考过程：_\n> 想一想\n\n正文段落。',
      createdAt: 0,
      toolCalls: [toolCall('t1', 'read_file', 9999)],
    }
    const { container, root } = render(<AgentMessage message={msg} />)
    // 思考折叠行恒在最前，工具卡贴正文末尾——不会出现在正文段之前
    expect(domOrder(container)).toEqual(['think', 'text:正文段落。', 'tool:read_file'])
    act(() => { root.unmount() })
  })

  it('调用发生在正文之前（offset=0）：工具行先于正文段（首轮先调工具再叙述）', () => {
    const msg = {
      id: 'a6',
      role: 'assistant' as const,
      content: '结果如下。',
      createdAt: 0,
      toolCalls: [toolCall('t1', 'read_file', 0)],
    }
    const { container, root } = render(<AgentMessage message={msg} />)
    expect(domOrder(container)).toEqual(['tool:read_file', 'text:结果如下。'])
    act(() => { root.unmount() })
  })

  it('流式初期（正文为空、已有工具调用）不崩，工具行在时间线内且光标在末尾', () => {
    const msg = {
      id: 'a7',
      role: 'assistant' as const,
      content: '',
      createdAt: 0,
      streaming: true,
      toolCalls: [toolCall('t1', 'read_file', 0)],
    }
    const { container, root } = render(<AgentMessage message={msg} />)
    expect(domOrder(container)).toEqual(['tool:read_file'])
    // 末段是工具批 → 光标单独补在时间线尾部（不丢流式反馈）
    const timeline = container.querySelector<HTMLElement>('[data-agent-timeline]')
    expect(timeline!.lastElementChild!.className).toContain('inline-flex')
    act(() => { root.unmount() })
  })

  it('末段是工具批：正文段不残留流式光标，光标只补在时间线末尾', () => {
    const content = '第一段。第二段。'
    const msg = {
      id: 'a8',
      role: 'assistant' as const,
      content,
      createdAt: 0,
      streaming: true,
      // 第二段正文之后还有一批工具 → 正文段都已结束，streaming 不得传给任何正文段
      toolCalls: [toolCall('t1', 'read_file', '第一段。'.length), toolCall('t2', 'write_file', content.length)],
    }
    const { container, root } = render(<AgentMessage message={msg} />)
    const cursors = container.querySelectorAll('span[style*="agent-cursor-blink"]')
    expect(cursors).toHaveLength(1)
    // 光标不在任何正文 markdown 段内部（否则会看起来「正文一直在流式」）
    expect(container.querySelector('.assistant-content span[style*="agent-cursor-blink"]')).toBeNull()
    // 唯一光标位于交错时间线末尾（工具批之后）；外层是 inline-flex 包装 span，光标是其子节点
    const timeline = container.querySelector<HTMLElement>('[data-agent-timeline]')
    expect(timeline!.lastElementChild!.querySelector('span[style*="agent-cursor-blink"]')).not.toBeNull()
    expect(timeline!.lastElementChild!.className).toContain('inline-flex')
    act(() => { root.unmount() })
  })

  it('末段是正文：流式光标只跟最后一个正文段走（同样只出现一次）', () => {
    const content = '第一段。第二段。'
    const msg = {
      id: 'a9',
      role: 'assistant' as const,
      content,
      createdAt: 0,
      streaming: true,
      // 工具之后没有正文 → 末段是正文，光标应落在最后一个正文段末尾
      toolCalls: [toolCall('t1', 'read_file', '第一段。'.length)],
    }
    const { container, root } = render(<AgentMessage message={msg} />)
    expect(container.querySelectorAll('span[style*="agent-cursor-blink"]')).toHaveLength(1)
    const mdSegments = container.querySelectorAll('.assistant-content')
    expect(mdSegments).toHaveLength(2)
    expect(mdSegments[0]!.querySelector('span[style*="agent-cursor-blink"]')).toBeNull()
    expect(mdSegments[1]!.querySelector('span[style*="agent-cursor-blink"]')).toBeTruthy()
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
