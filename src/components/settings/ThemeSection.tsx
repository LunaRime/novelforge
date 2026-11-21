/** 主题卡片复用顶栏菜单的元数据和切换逻辑。配色预览各自应用主题类。 */
import { Check } from 'lucide-react'
import { useThemeStore } from '../../stores/theme-store'
import { useTranslation } from '../../hooks/useTranslation'
import { applyThemeWithTransition } from '../../lib/theme-transition'
import { THEME_ICONS, THEME_ORDER, themeLabel } from '../../lib/theme-meta'

export default function ThemeSection() {
  const { t } = useTranslation()
  const theme = useThemeStore(s => s.theme)

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
                <span className="flex-1" style={{ backgroundColor: 'var(--color-canvas)' }} />
                <span className="flex-1" style={{ backgroundColor: 'var(--color-editor-bg)' }} />
                <span className="flex-1" style={{ backgroundColor: 'var(--color-accent)' }} />
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
