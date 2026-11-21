/** 主题卡片复用顶栏菜单的元数据和切换逻辑。配色预览各自应用主题类。 */
import { Check, Palette } from 'lucide-react'
import { CUSTOM_THEME_DEFAULTS, customThemePalette, useThemeStore } from '../../stores/theme-store'
import { useTranslation } from '../../hooks/useTranslation'
import { applyThemeWithTransition } from '../../lib/theme-transition'
import { THEME_ICONS, THEME_ORDER, themeLabel } from '../../lib/theme-meta'
import { OptionCards } from '../ui/ChoiceControls'
import { Button } from '../ui/Button'
import './theme-section.css'

export default function ThemeSection() {
  const { t } = useTranslation()
  const theme = useThemeStore(s => s.theme)
  const custom = useThemeStore(s => s.customColors)
  const setCustomColors = useThemeStore(s => s.setCustomColors)
  const preview = customThemePalette(custom)

  return (
    <div className="space-y-1.5">
      <div>
        <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{t('theme.appearance')}</p>
        <p className="text-micro mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
          {t('theme.appearanceDesc')}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {THEME_ORDER.map((id) => {
          const Icon = THEME_ICONS[id]
          const active = theme === id
          const name = themeLabel(id, t)
          return (
            <button
              key={id}
              type="button"
              onClick={(e) => applyThemeWithTransition(id, e)}
              aria-pressed={active}
              aria-label={t('theme.label').replace('{theme}', name)}
              data-theme-card={id}
              data-active={active ? 'true' : 'false'}
              className="flex cursor-pointer flex-col gap-2.5 rounded-lg p-3 text-left"
              style={{
                backgroundColor: 'var(--color-panel)',
                border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
              }}
            >
              <span className="flex items-center gap-1.5 w-full min-w-0">
                <Icon
                  size={14}
                  strokeWidth={active ? 2 : 1.5}
                  style={{ color: active ? 'var(--color-accent)' : 'var(--color-text-muted)', flexShrink: 0 }}
                />
                <span className="text-xs truncate min-w-0" style={{ color: 'var(--color-text)' }}>{name}</span>
                {active && (
                  <span
                    className="ml-auto flex-shrink-0"
                    style={{ color: 'var(--color-accent)' }}
                    title={t('theme.applied')}
                  >
                    <Check size={12} strokeWidth={2.5} aria-hidden />
                  </span>
                )}
              </span>

              {/* 只给预览条应用主题类，按钮的焦点和选中态仍遵循当前主题。 */}
              <span
                aria-hidden
                title={t('theme.palettePreview')}
                className={`${id} flex h-4 w-full overflow-hidden rounded-sm`}
                style={{ border: '1px solid var(--color-border)' }}
              >
                <span className="flex-1" style={{ backgroundColor: id === 'custom' ? preview.canvas : 'var(--color-canvas)' }} />
                <span className="flex-1" style={{ backgroundColor: id === 'custom' ? preview.paper : 'var(--color-editor-bg)' }} />
                <span className="flex-1" style={{ backgroundColor: id === 'custom' ? preview.accent : 'var(--color-accent)' }} />
              </span>
            </button>
          )
        })}
      </div>
      {theme === 'custom' && <section className="nf-custom-theme-settings" aria-label={t('theme.custom')}>
        <div className="nf-custom-theme-heading">
          <Palette size={16} aria-hidden="true" />
          <div><strong>{t('theme.custom')}</strong><p>{t('theme.customHint')}</p></div>
          <Button variant="outline" size="sm" onClick={() => setCustomColors(CUSTOM_THEME_DEFAULTS[custom.base])}>{t('action.reset')}</Button>
        </div>
        <div className="nf-custom-theme-controls">
          <OptionCards size="sm" value={custom.base} onChange={base => setCustomColors({ ...custom, base })}
            items={[{ value: 'light', label: t('theme.light') }, { value: 'dark', label: t('theme.dark') }]} />
          {(['accent', 'paper'] as const).map(token => <label key={token} className="nf-custom-theme-color">
            <input type="color" value={custom[token]} onChange={event => setCustomColors({ ...custom, [token]: event.target.value })} />
            <span>{t(token === 'accent' ? 'theme.customAccent' : 'theme.customPaper')}<code>{custom[token].toUpperCase()}</code></span>
          </label>)}
        </div>
      </section>}
    </div>
  )
}
