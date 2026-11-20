// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_WRITING_APPEARANCE, useEditorPrefsStore } from './editor-prefs-store'

describe('editor-prefs-store', () => {
  beforeEach(() => {
    useEditorPrefsStore.setState({
      ...DEFAULT_WRITING_APPEARANCE,
      typewriter: true,
      paragraphFocus: true,
    })
  })

  it('栏宽被夹在规范区间 720–800', () => {
    useEditorPrefsStore.getState().setMeasureWidth(300)
    expect(useEditorPrefsStore.getState().measureWidth).toBe(720)
    useEditorPrefsStore.getState().setMeasureWidth(1200)
    expect(useEditorPrefsStore.getState().measureWidth).toBe(800)
    useEditorPrefsStore.getState().setMeasureWidth(777.6)
    expect(useEditorPrefsStore.getState().measureWidth).toBe(778)
  })

  it('打字机/段落焦点可独立开关', () => {
    const { toggleTypewriter, toggleParagraphFocus } = useEditorPrefsStore.getState()
    toggleTypewriter()
    expect(useEditorPrefsStore.getState().typewriter).toBe(false)
    expect(useEditorPrefsStore.getState().paragraphFocus).toBe(true)
    toggleParagraphFocus()
    expect(useEditorPrefsStore.getState().paragraphFocus).toBe(false)
  })

  it('读取旧偏好并为稿纸和密度填入默认值', async () => {
    localStorage.setItem('novelforge:editor-prefs', JSON.stringify({ version: 0,
      state: { proseFontSize: 18, measureWidth: 800, typewriter: false, paragraphFocus: true },
    }))
    await useEditorPrefsStore.persist.rehydrate()
    expect(useEditorPrefsStore.getState()).toMatchObject({
      proseFontSize: 18, measureWidth: 800, typewriter: false, prosePaper: 'theme', listDensity: 'standard',
    })
  })

  it('应用并写入稿纸和列表密度，恢复外观默认值时保留阅读行为', async () => {
    useEditorPrefsStore.getState().toggleTypewriter()
    useEditorPrefsStore.getState().applyWritingAppearance({
      proseFontSize: 18, measureWidth: 800, prosePaper: 'warm', listDensity: 'comfortable',
    })
    expect(document.documentElement.dataset).toMatchObject({ v3ProsePaper: 'warm', v3ListDensity: 'comfortable' })
    const saved = localStorage.getItem('novelforge:editor-prefs')!
    useEditorPrefsStore.getState().applyWritingAppearance(DEFAULT_WRITING_APPEARANCE)
    expect(useEditorPrefsStore.getState()).toMatchObject({ ...DEFAULT_WRITING_APPEARANCE, typewriter: false })
    localStorage.setItem('novelforge:editor-prefs', saved)
    await useEditorPrefsStore.persist.rehydrate()
    expect(document.documentElement.dataset).toMatchObject({ v3ProsePaper: 'warm', v3ListDensity: 'comfortable' })
    expect(useEditorPrefsStore.getState()).toMatchObject({ proseFontSize: 18, measureWidth: 800, typewriter: false })
  })

  it('持久化失败时保留之前应用的外观', () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable') })
    try {
      expect(() => useEditorPrefsStore.getState().applyWritingAppearance({
        ...DEFAULT_WRITING_APPEARANCE, prosePaper: 'warm', listDensity: 'compact',
      })).toThrow('Storage unavailable')
      expect(useEditorPrefsStore.getState()).toMatchObject(DEFAULT_WRITING_APPEARANCE)
      expect(document.documentElement.dataset).toMatchObject({ v3ProsePaper: 'theme', v3ListDensity: 'standard' })
    } finally {
      storage.mockRestore()
    }
  })
})
