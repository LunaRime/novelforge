// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { t } from '../../shared/locale'
import EditorToolbar, { type EditorToolbarProps } from './EditorToolbar'

it('keeps save available and runs the same version actions from the overflow', async () => {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  const props: EditorToolbarProps = {
    meta: null, charCount: 120, isDirty: true, isReadonly: false, saving: false,
    isChapterBusy: false, pendingRevisions: [], reviewCount: 0, hasProcessFailure: false,
    onSave: vi.fn(), onRefine: vi.fn(), onReview: vi.fn(), onTranslate: vi.fn(),
    onFinalize: vi.fn(), onRepairFinalize: vi.fn(), onOpenRevision: vi.fn(), onOpenReview: vi.fn(),
  }
  try {
    await act(async () => root.render(<EditorToolbar {...props} />))
    const button = (label: string, within: ParentNode = host) =>
      [...within.querySelectorAll('button')].find(item => item.textContent === label)
    const trigger = host.querySelector<HTMLButtonElement>(`button[aria-label="${t('tip.moreOptions')}"]`)
    expect(trigger).not.toBeNull()
    act(() => button(t('editor.save'))?.click())
    expect(props.onSave).toHaveBeenCalledOnce()
    act(() => trigger?.click())
    const menu = host.querySelector(`[id="${trigger?.getAttribute('aria-controls')}"]`)
    expect(menu).not.toBeNull()
    expect(document.activeElement).toBe(button(t('editor.aiPolishBtn'), menu!))
    act(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(trigger?.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)

    act(() => trigger?.click())
    const reopened = host.querySelector(`[id="${trigger?.getAttribute('aria-controls')}"]`)
    act(() => button(t('editor.finalizeBtn'), reopened!)?.click())
    expect(props.onFinalize).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(trigger)

    await act(async () => root.render(<EditorToolbar {...props} isChapterBusy />))
    act(() => trigger?.click())
    const busy = host.querySelector(`[id="${trigger?.getAttribute('aria-controls')}"]`)
    expect(button(t('editor.finalizeBtn'), busy!)?.disabled).toBe(true)
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})
