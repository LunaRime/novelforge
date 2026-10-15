/**
 * ThemeSection — 设置 → 编辑器的「界面主题」分区（用户建议 5 · docs/ui-6items-plan.md §2.5）。
 *
 * 与右侧图标栏底部的主题菜单**同源**：同一份主题元数据（`lib/theme-meta.ts`：图标/顺序/名称）、
 * 同一个 store（`useThemeStore`）、同一个圆形扩散过渡（`lib/theme-transition.ts`）。卡片点选**立即生效**
 * （主题是本地视图偏好，与界面字体一样不走本页的「保存」）。
 *
 * ⚠️ 预览条只准用 `var(--color-*)`（color-token-standard 一）：这里拼的是**当前主题**的
 * 「画布 / 活动栏 / 强调」三色，**不硬编码四套主题的色值**（那正是取色纪律禁止的写法）。
 * 取这三色而不是 `--color-panel` / `--color-sidebar`：后两者在四套主题块里**逐一同值**，
 * 拼在一根条上会是两段同色（色值只在 src/index.css 的主题块里定义，此处不复述）。
 */
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

      {/* 2×2 网格：设置弹窗内容区约 392px（max-w-md），四列会让俄语主题名截断 */}
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
              className="flex flex-col gap-2 rounded-lg p-2.5 text-left transition-colors hover:bg-[var(--color-hover)]"
              style={{
                backgroundColor: 'var(--color-panel)',
                // 选中态 = accent 描边 + 右上角勾（与图标栏菜单的「选中项 accent 文字 + 勾」同一语言）
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

              {/* 三色预览条：画布 / 活动栏 / 强调 —— 当前主题的令牌，表达「哪一类配色」。
                  ⚠️ 四张卡都用**当前主题**的 token 渲染（不是各卡渲染各自主题），
                  故 title 只说「当前主题的配色预览」，不暗示逐主题真预览 */}
              <span
                aria-hidden
                title={t('theme.palettePreview')}
                className="flex w-full h-2 overflow-hidden rounded-full"
                style={{ border: '1px solid var(--color-border)' }}
              >
                <span className="flex-1" style={{ backgroundColor: 'var(--color-canvas)' }} />
                <span className="flex-1" style={{ backgroundColor: 'var(--color-activity-bar)' }} />
                <span className="flex-1" style={{ backgroundColor: 'var(--color-accent)' }} />
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
