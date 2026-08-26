// @vitest-environment jsdom
/**
 * AgentMessage — 对话思考块默认折叠 + ToolCallBlock 文件摘要（C4）
 *
 * 验证渲染层拆分解析 `_思考过程：_\n> ...` 前缀：助手消息的思考块默认
 * 折叠为「思考过程」头部（点击展开后正文可见），正文不受影响；无思考块
 * 的普通内容原样渲染。另含 ToolCallBlock 头部 📄/📖/👤 摘要。
 */
import { describe, it, expect, afterEach } from 'vitest'
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
