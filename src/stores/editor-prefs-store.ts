import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * 正文编辑的「长时舒适」偏好。
 *
 * 与主题/字体分开：这三项只影响 CodeMirror 正文（prose），不影响章节卡片、设置表单等
 * 其它编辑器实例；持久化在 localStorage，切换项目后仍保持同一写作手感。
 */
export interface EditorPrefsState {
  /** 正文字号（规范 17–18px；默认 17） */
  proseFontSize: 17 | 18
  /** 正文栏宽（规范 720–800px；默认 760） */
  measureWidth: number
  /** 打字机滚动：光标保持垂直 40% */
  typewriter: boolean
  /** 当前段落高亮（专注模式下同时压暗其它段落） */
  paragraphFocus: boolean
  setProseFontSize: (size: 17 | 18) => void
  setMeasureWidth: (width: number) => void
  toggleTypewriter: () => void
  toggleParagraphFocus: () => void
}

const MIN_MEASURE = 720
const MAX_MEASURE = 800

export const useEditorPrefsStore = create<EditorPrefsState>()(persist((set) => ({
  proseFontSize: 17,
  measureWidth: 760,
  typewriter: true,
  paragraphFocus: true,
  setProseFontSize: (proseFontSize) => set({ proseFontSize }),
  setMeasureWidth: (measureWidth) => set({
    measureWidth: Math.min(MAX_MEASURE, Math.max(MIN_MEASURE, Math.round(measureWidth))),
  }),
  toggleTypewriter: () => set((s) => ({ typewriter: !s.typewriter })),
  toggleParagraphFocus: () => set((s) => ({ paragraphFocus: !s.paragraphFocus })),
}), {
  name: 'novelforge:editor-prefs',
}))
