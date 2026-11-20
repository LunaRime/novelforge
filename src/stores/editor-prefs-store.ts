import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface WritingAppearance {
  proseFontSize: 17 | 18
  measureWidth: number
  prosePaper: 'theme' | 'warm'
  listDensity: 'compact' | 'standard' | 'comfortable'
}

export const DEFAULT_WRITING_APPEARANCE: WritingAppearance = {
  proseFontSize: 17,
  measureWidth: 760,
  prosePaper: 'theme',
  listDensity: 'standard',
}

/**
 * 与主题和字体分开持久化。正文排版作用于 prose 模式，密度仅作用于显式接入的列表。
 */
export interface EditorPrefsState extends WritingAppearance {
  /** 打字机滚动：光标保持垂直 40% */
  typewriter: boolean
  /** 当前段落高亮（专注模式下同时压暗其它段落） */
  paragraphFocus: boolean
  setProseFontSize: (size: 17 | 18) => void
  setMeasureWidth: (width: number) => void
  toggleTypewriter: () => void
  toggleParagraphFocus: () => void
  applyWritingAppearance: (appearance: WritingAppearance) => void
}

const MIN_MEASURE = 720
const MAX_MEASURE = 800
const clampMeasure = (width: number) => Number.isFinite(width)
  ? Math.min(MAX_MEASURE, Math.max(MIN_MEASURE, Math.round(width)))
  : DEFAULT_WRITING_APPEARANCE.measureWidth

export function selectWritingAppearance({ proseFontSize, measureWidth, prosePaper, listDensity }: EditorPrefsState): WritingAppearance {
  return { proseFontSize, measureWidth, prosePaper, listDensity }
}

export const useEditorPrefsStore = create<EditorPrefsState>()(persist((set, get) => ({
  ...DEFAULT_WRITING_APPEARANCE,
  typewriter: true,
  paragraphFocus: true,
  setProseFontSize: (proseFontSize) => set({ proseFontSize }),
  setMeasureWidth: (measureWidth) => set({ measureWidth: clampMeasure(measureWidth) }),
  toggleTypewriter: () => set((s) => ({ typewriter: !s.typewriter })),
  toggleParagraphFocus: () => set((s) => ({ paragraphFocus: !s.paragraphFocus })),
  applyWritingAppearance: (appearance) => {
    const previous = selectWritingAppearance(get())
    try {
      set({ ...appearance, measureWidth: clampMeasure(appearance.measureWidth) })
    } catch (error) {
      // Persist writes after updating memory. Restore the visible preferences even if storage stays unavailable.
      try { set(previous) } catch { /* The original persistence error is reported to the caller. */ }
      throw error
    }
  },
}), {
  name: 'novelforge:editor-prefs',
}))

if (typeof document !== 'undefined') {
  const applyAppearanceToDocument = ({ prosePaper, listDensity }: WritingAppearance) => {
    document.documentElement.dataset.v3ProsePaper = prosePaper
    document.documentElement.dataset.v3ListDensity = listDensity
  }
  applyAppearanceToDocument(useEditorPrefsStore.getState())
  useEditorPrefsStore.subscribe((next, previous) => {
    if (next.prosePaper !== previous.prosePaper || next.listDensity !== previous.listDensity) applyAppearanceToDocument(next)
  })
}
