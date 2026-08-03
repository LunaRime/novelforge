import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './editor-store'

beforeEach(() => {
  // 重置 store 状态
  useEditorStore.setState({ tabs: [], activeTabId: null })
})

describe('editor-store openFile', () => {
  it('新文件打开并激活', () => {
    const s = useEditorStore.getState()
    s.openFile({ id: 'vela://draft/1', name: '第一章 · 草稿', type: 'chapter', filePath: 'vela://draft/1', content: '旧内容' })
    const st = useEditorStore.getState()
    expect(st.tabs.length).toBe(1)
    expect(st.activeTabId).toBe('vela://draft/1')
    expect(st.tabs[0].content).toBe('旧内容')
  })

  it('重复打开同 id：激活 + 更新名称 + 非 dirty 刷新内容', () => {
    const s = useEditorStore.getState()
    s.openFile({ id: 'vela://manuscript/5', name: '第三章', type: 'chapter', filePath: 'vela://manuscript/5', content: '定稿 v1' })
    // 定稿后内容变化，再次打开（模拟工作台/ProjectTree 入口）
    s.openFile({ id: 'vela://manuscript/5', name: '第三章', type: 'chapter', filePath: 'vela://manuscript/5', content: '定稿 v2' })
    const st = useEditorStore.getState()
    expect(st.tabs.length).toBe(1) // 去重，不重复开
    expect(st.activeTabId).toBe('vela://manuscript/5')
    expect(st.tabs[0].content).toBe('定稿 v2') // 内容已刷新
  })

  it('dirty 时重复打开：保留用户未保存编辑，仅激活', () => {
    const s = useEditorStore.getState()
    s.openFile({ id: 'vela://draft/9', name: '第二章 · 草稿', type: 'chapter', filePath: 'vela://draft/9', content: '原文' })
    // 用户开始编辑（dirty）
    useEditorStore.setState(s => ({
      tabs: s.tabs.map(t => t.id === 'vela://draft/9' ? { ...t, content: '用户编辑中', dirty: true } : t),
    }))
    // 工作台再次点击同一草稿（读到 DB 最新内容）
    s.openFile({ id: 'vela://draft/9', name: '第二章 · 草稿', type: 'chapter', filePath: 'vela://draft/9', content: 'DB 最新' })
    const st = useEditorStore.getState()
    expect(st.tabs[0].content).toBe('用户编辑中') // 不覆盖未保存编辑
    expect(st.activeTabId).toBe('vela://draft/9')
  })

  it('按 filePath + type 去重（不同 id 同一文件）', () => {
    const s = useEditorStore.getState()
    s.openFile({ id: 'vela://manuscript/3', name: 'A', type: 'chapter', filePath: 'vela://manuscript/3', content: '1' })
    // 另一个入口用相同 filePath 但不同 id 打开
    s.openFile({ id: 'alias-3', name: 'B', type: 'chapter', filePath: 'vela://manuscript/3', content: '2' })
    const st = useEditorStore.getState()
    expect(st.tabs.length).toBe(1)
    expect(st.tabs[0].id).toBe('vela://manuscript/3') // 保留首次 id
    expect(st.tabs[0].content).toBe('2')
  })

  it('diff 类型只按 id 精确匹配，内容强制更新', () => {
    const s = useEditorStore.getState()
    s.openFile({ id: 'diff-1', name: '修稿 A', type: 'diff', filePath: 'vela://draft/1', content: 'A' })
    s.openFile({ id: 'diff-2', name: '修稿 B', type: 'diff', filePath: 'vela://draft/1', content: 'B' })
    const st = useEditorStore.getState()
    expect(st.tabs.length).toBe(2) // 不按 filePath 去重
    expect(st.activeTabId).toBe('diff-2')
  })
})

describe('editor-store closeTab', () => {
  it('关闭激活 Tab 回退到最后一个', () => {
    const s = useEditorStore.getState()
    s.openFile({ id: 'a', name: 'A', type: 'chapter', filePath: 'a' })
    s.openFile({ id: 'b', name: 'B', type: 'chapter', filePath: 'b' })
    s.closeTab('b')
    const st = useEditorStore.getState()
    expect(st.tabs.length).toBe(1)
    expect(st.activeTabId).toBe('a')
  })

  it('pinned Tab 不可关闭', () => {
    const s = useEditorStore.getState()
    s.openFile({ id: 'p', name: 'P', type: 'config', pinned: true })
    s.closeTab('p')
    expect(useEditorStore.getState().tabs.length).toBe(1)
  })
})
