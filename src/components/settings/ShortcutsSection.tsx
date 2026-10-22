import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import {
  SHORTCUT_CATEGORIES,
  SHORTCUT_DEFINITIONS,
  bindingFromEvent,
  formatBinding,
  shortcutBinding,
  shortcutLabelKey,
  useShortcutStore,
} from '../../stores/shortcut-store'
import { Button } from '../ui/Button'
import { Disclosure } from '../ui/Disclosure'

function ShortcutRow({ id }: { id: string }) {
  const { t } = useTranslation()
  const bindings = useShortcutStore(s => s.bindings)
  const setBinding = useShortcutStore(s => s.setBinding)
  const resetBinding = useShortcutStore(s => s.resetBinding)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const def = SHORTCUT_DEFINITIONS.find(item => item.id === id)!
  const current = shortcutBinding(id, bindings)
  const custom = bindings[id] !== undefined

  useEffect(() => {
    if (!recording) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        setRecording(false)
        setError(null)
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setRecording(false)
        setError(null)
        return
      }
      if (['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) return
      const next = bindingFromEvent(event)
      if (!next) {
        setError(t('shortcut.invalid'))
        return
      }
      const result = setBinding(id, next)
      if (!result.ok) {
        setError(result.conflictId
          ? t('shortcut.conflict').replace('{name}', t(shortcutLabelKey(result.conflictId)))
          : t('shortcut.invalid'))
        return
      }
      setError(null)
      setRecording(false)
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [id, recording, setBinding, t])

  return (
    <div className="flex items-center gap-2 py-1">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs" style={{ color: 'var(--color-text)' }}>{t(def.labelKey)}</span>
          {custom && (
            <span className="rounded-full px-1.5 py-px text-micro" style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-accent)' }}>
              {t('shortcut.custom')}
            </span>
          )}
        </div>
        {error && <p className="mt-0.5 text-micro" style={{ color: 'var(--color-error)' }}>{error}</p>}
      </div>

      <button
        type="button"
        onClick={() => { setError(null); setRecording(true) }}
        className="flex h-7 min-w-[112px] items-center justify-center rounded-md border px-2 font-mono text-micro transition-colors hover:bg-[var(--color-hover)]"
        style={{
          borderColor: recording ? 'var(--color-accent)' : 'var(--color-border)',
          backgroundColor: recording ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : 'var(--color-panel)',
          color: recording ? 'var(--color-accent)' : 'var(--color-text-secondary)',
        }}
        aria-label={`${t(def.labelKey)}: ${formatBinding(current)}`}
      >
        {recording ? t('shortcut.recording') : formatBinding(current)}
      </button>

      <Button
        variant="ghost"
        size="icon"
        className="flex-shrink-0"
        style={{ width: 32, height: 32 }}
        title={t('shortcut.reset')}
        aria-label={t('shortcut.reset')}
        disabled={!custom}
        onClick={() => { resetBinding(id); setError(null) }}
      >
        <RotateCcw size={12} />
      </Button>
    </div>
  )
}

/** 设置 → 编辑器 → 快捷键：按分类折叠，默认全部收起。 */
export default function ShortcutsSection() {
  const { t } = useTranslation()
  const resetAll = useShortcutStore(s => s.resetAll)
  const hasCustom = useShortcutStore(s => Object.keys(s.bindings).length > 0)

  return (
    <section
      className="rounded-lg p-4"
      style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{t('shortcut.title')}</p>
          <p className="mt-0.5 text-micro" style={{ color: 'var(--color-text-muted)' }}>{t('shortcut.desc')}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="flex-shrink-0"
          disabled={!hasCustom}
          onClick={() => resetAll()}
        >
          <RotateCcw size={12} />
          {t('shortcut.resetAll')}
        </Button>
      </div>

      <div className="mt-3 space-y-1">
        {SHORTCUT_CATEGORIES.map(category => {
          const defs = SHORTCUT_DEFINITIONS.filter(def => def.category === category.id)
          return (
            <Disclosure
              key={category.id}
              label={(
                <span className="flex items-center gap-1.5">
                  <span>{t(category.labelKey)}</span>
                  <span className="text-micro" style={{ color: 'var(--color-text-muted)' }}>{defs.length}</span>
                </span>
              )}
            >
              <div className="space-y-0.5">
                {defs.map(def => <ShortcutRow key={def.id} id={def.id} />)}
              </div>
            </Disclosure>
          )
        })}
      </div>
    </section>
  )
}
