// @vitest-environment jsdom
/** 加载方式写回链路（C 档第一轮）：读-改-写 + 编辑器脏检查守卫 + 常驻合计 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { changeMemoryLoadMode, sumResidentSectionTokens } from './load-mode'
import { useEditorStore } from '../../stores/editor-store'

const TAB_ID = 'vela://memory/book-state.md'
const RAW = '---\ntype: shared\n---\n\n# 全书精要\n主角是苏晚晴'

let invoke: ReturnType<typeof vi.fn>

beforeEach(() => {
  useEditorStore.setState({ tabs: [], activeTabId: null })
  // ⚠️ 只声明用得到的形参：尾部未使用参数会被 tsc 的 noUnusedParameters 拒绝
  invoke = vi.fn(async (ch: string) => {
    if (ch === 'memory:read') return RAW
    if (ch === 'memory:write') return { success: true }
    return null
  })
  Object.defineProperty(window, 'velaAPI', { value: { invoke }, configurable: true })
})

describe('changeMemoryLoadMode', () => {
  it('读-改-写：写回的文件带 load_mode 且原有键与正文保留', async () => {
    const res = await changeMemoryLoadMode('book-state.md', 'resident')
    expect(res).toEqual({ ok: true, mode: 'resident' })
    expect(invoke).toHaveBeenCalledWith('memory:write', 'book-state.md', '---\ntype: shared\nload_mode: resident\n---\n\n# 全书精要\n主角是苏晚晴')
  })

  it('切回 auto → 删除该键', async () => {
    invoke.mockImplementation(async (ch: string) => (ch === 'memory:read' ? '---\nload_mode: resident\n---\n正文' : { success: true }))
    await changeMemoryLoadMode('book-state.md', 'auto')
    expect(invoke).toHaveBeenCalledWith('memory:write', 'book-state.md', '正文')
  })

  it('编辑器里有未保存修改 → 不写盘（不覆盖用户的未保存内容）', async () => {
    useEditorStore.setState({ tabs: [{ id: TAB_ID, name: 'book-state.md', type: 'memory', filePath: TAB_ID, content: '改了一半', dirty: true }] })
    const res = await changeMemoryLoadMode('book-state.md', 'resident')
    expect(res).toEqual({ ok: false, reason: 'dirty' })
    expect(invoke).not.toHaveBeenCalledWith('memory:write', expect.anything(), expect.anything())
  })

  it('编辑器有同一文件的干净标签页 → 写盘后静默同步标签页内容', async () => {
    useEditorStore.setState({ tabs: [{ id: TAB_ID, name: 'book-state.md', type: 'memory', filePath: TAB_ID, content: RAW, dirty: false }] })
    await changeMemoryLoadMode('book-state.md', 'manual')
    expect(useEditorStore.getState().tabs[0].content).toContain('load_mode: manual')
    expect(useEditorStore.getState().tabs[0].dirty).toBe(false)
  })

  it('文件不存在 → readFailed；写盘失败 → writeFailed（都不抛）', async () => {
    invoke.mockImplementation(async (ch: string) => (ch === 'memory:read' ? null : { success: false }))
    expect(await changeMemoryLoadMode('gone.md', 'resident')).toEqual({ ok: false, reason: 'readFailed' })
    invoke.mockImplementation(async (ch: string) => (ch === 'memory:read' ? RAW : { success: false }))
    expect(await changeMemoryLoadMode('book-state.md', 'resident')).toEqual({ ok: false, reason: 'writeFailed' })
  })
})

describe('sumResidentSectionTokens', () => {
  it('与注入同口径（同一个 buildResidentSection）；空列表为 0', async () => {
    expect(await sumResidentSectionTokens([])).toEqual({ tokens: 0, overCap: false })
    const { tokens, overCap } = await sumResidentSectionTokens(['book-state.md'])
    expect(tokens).toBeGreaterThan(0)
    expect(overCap).toBe(false)
  })

  it('读盘失败的文件被跳过（不抛出）', async () => {
    invoke.mockImplementation(async () => null)
    expect(await sumResidentSectionTokens(['a.md', 'b.md'])).toEqual({ tokens: 0, overCap: false })
  })
})
