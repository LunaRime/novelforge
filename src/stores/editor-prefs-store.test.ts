import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorPrefsStore } from './editor-prefs-store'

describe('editor-prefs-store', () => {
  beforeEach(() => {
    useEditorPrefsStore.setState({
      proseFontSize: 17,
      measureWidth: 760,
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
})
