import type { Meta, StoryObj } from '@storybook/react' // eslint-disable-line storybook/no-renderer-packages
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '../components/ui/Button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/Dialog'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { useTranslation } from '../hooks/useTranslation'
import { THEME_ORDER, themeLabel } from '../lib/theme-meta'
import type { Theme } from '../stores/theme-store'
import './v3-appearance.story.css'

type Appearance = { theme: Theme; fontSize: '17' | '18'; measure: number }
const defaults: Appearance = { theme: 'light', fontSize: '17', measure: 760 }
const fontSizes = [{ value: '17', label: '17 px' }, { value: '18', label: '18 px' }] as const

function PreviewSheet({ preference }: { preference: Appearance }) {
  return (
    <div className="v3-appearance-paper" style={{ fontSize: `${preference.fontSize}px`, maxWidth: preference.measure }}>
      <p>雾港来信</p>
      <p>退潮后的石阶露出一条窄缝。林澈伸手摸到一封湿透的信，封口的蜡还软。远处港钟响了两声，她认出信封上是自己的名字。</p>
    </div>
  )
}

function V3Appearance() {
  const { t } = useTranslation()
  const measureId = useId()
  const [open, setOpen] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [applied, setApplied] = useState(defaults)
  const [draft, setDraft] = useState(defaults)
  const heading = useRef<HTMLHeadingElement>(null)
  const continueEditing = useRef<HTMLButtonElement>(null)
  const editingFocus = useRef<HTMLElement | null>(null)
  const dirty = draft.theme !== applied.theme || draft.fontSize !== applied.fontSize || draft.measure !== applied.measure
  const isDefault = draft.theme === defaults.theme && draft.fontSize === defaults.fontSize && draft.measure === defaults.measure

  // 关闭确认沿用同一个对话框。取消后把焦点还给之前的设置控件。
  useLayoutEffect(() => {
    if (!open) return
    if (confirmDiscard) continueEditing.current?.focus()
    else {
      editingFocus.current?.focus({ preventScroll: true })
      editingFocus.current = null
    }
  }, [confirmDiscard, open])

  function changeOpen(next: boolean) {
    if (next || !dirty) setOpen(next)
    else if (confirmDiscard) setConfirmDiscard(false)
    else {
      editingFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setConfirmDiscard(true)
    }
  }

  function discard() {
    setDraft(applied)
    setConfirmDiscard(false)
    editingFocus.current = null
    setOpen(false)
  }

  function apply() {
    // 只把临时预览应用到样板稿纸，保留正式设置偏好。
    heading.current?.focus({ preventScroll: true })
    setApplied(draft)
  }

  return (
    <main className={`v3-appearance-sample ${applied.theme}`} data-applied-theme={applied.theme}>
      <Dialog open={open} onOpenChange={changeOpen}>
        <header className="v3-appearance-header">
          <h1>{t('theme.appearance')}</h1>
          <DialogTrigger asChild><Button size="sm" variant="outline">{t('settings.title')}</Button></DialogTrigger>
        </header>
        <div className="v3-appearance-canvas"><PreviewSheet preference={applied} /></div>
        <DialogContent className={`v3-appearance-dialog ${draft.theme}`} preventOutsideClose>
          <DialogHeader className="v3-appearance-dialog-header">
            <DialogTitle ref={heading} tabIndex={-1}>{t(confirmDiscard ? 'dialog.unsavedTitle' : 'theme.appearance')}</DialogTitle>
            <DialogDescription>{t(confirmDiscard ? 'settings.discardConfirm' : 'settings.typographyDesc')}</DialogDescription>
          </DialogHeader>
          <div className="v3-appearance-body" hidden={confirmDiscard}>
            <div className="v3-appearance-settings">
              <fieldset>
                <legend>{t('theme.appearance')}</legend>
                <div className="v3-appearance-themes">
                  {THEME_ORDER.map(theme => (
                    <Button key={theme} size="sm" variant={draft.theme === theme ? 'default' : 'outline'}
                      aria-pressed={draft.theme === theme} data-appearance-theme={theme}
                      onClick={() => setDraft(previous => ({ ...previous, theme }))}>{themeLabel(theme, t)}</Button>
                  ))}
                </div>
              </fieldset>
              <fieldset className="v3-appearance-typography">
                <legend>{t('settings.typography')}</legend>
                <div>
                  <span>{t('settings.fontSize')}</span>
                  <SegmentedControl items={[...fontSizes]} value={draft.fontSize}
                    onChange={fontSize => setDraft(previous => ({ ...previous, fontSize }))} />
                </div>
                <div>
                  <label htmlFor={measureId}>{t('settings.measure')}</label>
                  <output htmlFor={measureId}>{draft.measure}</output>
                  <input id={measureId} type="range" min={720} max={800} step={10} value={draft.measure}
                    onChange={event => {
                      const measure = event.currentTarget.valueAsNumber
                      setDraft(previous => ({ ...previous, measure }))
                    }} />
                </div>
              </fieldset>
            </div>
            <PreviewSheet preference={draft} />
          </div>
          <DialogFooter className="v3-appearance-footer">
            {confirmDiscard ? <>
              <Button ref={continueEditing} size="sm" variant="outline" onClick={() => setConfirmDiscard(false)}>{t('common.cancel')}</Button>
              <Button size="sm" variant="destructive" onClick={discard}>{t('action.discard')}</Button>
            </> : <>
              <Button size="sm" variant="outline" disabled={isDefault} onClick={() => {
                heading.current?.focus({ preventScroll: true })
                setDraft(defaults)
              }}>{t('action.reset')}</Button>
              <p role="status">{t(dirty ? 'statusbar.unsavedShort' : 'statusbar.saved')}</p>
              <Button size="sm" disabled={!dirty} onClick={apply}>{t('action.apply')}</Button>
            </>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}

const meta = {
  title: 'NovelForge Workbench/V3 Appearance',
  component: V3Appearance,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof V3Appearance>

export default meta
type Story = StoryObj<typeof meta>

export const PreviewAndApply: Story = {}
