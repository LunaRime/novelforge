// @vitest-environment jsdom
/** 加载方式写回链路（C 档第一轮）：读-改-写 + 编辑器脏检查守卫 + 常驻合计 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { changeMemoryLoadMode, residentTargets, sumResidentSectionTokens } from './load-mode'
import { useEditorStore } from '../../stores/editor-store'
import type { MemoryFileMeta } from './memory-codec'

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

  it('编辑器里有已保存的标签页 → 同样不写盘（两处写入会互相覆盖）', async () => {
    // 评审 I2：此前对干净标签页调 syncTabContent，而 CodeMirror 的外部内容回显会经 onChange →
    // updateTabContent 无条件置 dirty（EditorArea.tsx:698 记录了同一个坑），
    // 于是「刚同步过的内容」立刻显示为未保存，第二次切换被自己的脏检查拦死。
    // 处置与仓库既有约定一致：**不碰编辑器缓冲**，改为要求先关标签页。
    useEditorStore.setState({ tabs: [{ id: TAB_ID, name: 'book-state.md', type: 'memory', filePath: TAB_ID, content: RAW, dirty: false }] })
    const res = await changeMemoryLoadMode('book-state.md', 'manual')
    expect(res).toEqual({ ok: false, reason: 'openInEditor' })
    expect(invoke).not.toHaveBeenCalledWith('memory:write', expect.anything(), expect.anything())
    expect(useEditorStore.getState().tabs[0].content).toBe(RAW)   // 缓冲原样，不被写也不被标脏
    expect(useEditorStore.getState().tabs[0].dirty).toBe(false)
  })

  it('文件不存在 → readFailed；写盘失败 → writeFailed（都不抛）', async () => {
    invoke.mockImplementation(async (ch: string) => (ch === 'memory:read' ? null : { success: false }))
    expect(await changeMemoryLoadMode('gone.md', 'resident')).toEqual({ ok: false, reason: 'readFailed' })
    invoke.mockImplementation(async (ch: string) => (ch === 'memory:read' ? RAW : { success: false }))
    expect(await changeMemoryLoadMode('book-state.md', 'resident')).toEqual({ ok: false, reason: 'writeFailed' })
  })
})

describe('residentTargets（与注入口径一致）', () => {
  const meta = (file: string, loadMode: MemoryFileMeta['loadMode'], stale: boolean): MemoryFileMeta =>
    ({ file, kind: 'book', loadMode, brief: '', stale, mtime: 1 })

  it('只取非 stale 的常驻文件（stale 不进上下文，面板不该把它算进来）', () => {
    expect(residentTargets([
      meta('stale-resident.md', 'resident', true),
      meta('fresh-resident.md', 'resident', false),
      meta('auto.md', 'auto', false),
    ])).toEqual(['fresh-resident.md'])
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
