import { useRef } from 'react'
import { useTranslation } from '../../hooks/useTranslation'
import { DEFAULT_WRITING_APPEARANCE, type WritingAppearance } from '../../stores/editor-prefs-store'
import { Button } from '../ui/Button'
import { OptionCards } from '../ui/ChoiceControls'
import './writing-appearance.css'

interface Props {
  appearance: WritingAppearance
  dirty: boolean
  onChange: (change: Partial<WritingAppearance>) => void
  onApply: () => void
}

export default function WritingAppearanceSection({ appearance, dirty, onChange, onApply }: Props) {
  const { t } = useTranslation()
  const heading = useRef<HTMLHeadingElement>(null)
  const atDefaults = appearance.proseFontSize === DEFAULT_WRITING_APPEARANCE.proseFontSize
    && appearance.measureWidth === DEFAULT_WRITING_APPEARANCE.measureWidth
    && appearance.prosePaper === DEFAULT_WRITING_APPEARANCE.prosePaper
    && appearance.listDensity === DEFAULT_WRITING_APPEARANCE.listDensity

  return (
    <section className="nf-writing-settings space-y-3">
      <h3 ref={heading} tabIndex={-1} className="text-base font-semibold text-[var(--color-text)]">
        {t('settings.typography')}
      </h3>
      <p className="text-micro text-[var(--color-text-muted)]">{t('settings.typographyDesc')}</p>
      {/* 允许预览草稿设置，应用操作才会更新作者的正文和导航。 */}
      <div className="nf-writing-settings-layout">
        <div className="nf-writing-settings-fields">
          <div className="nf-writing-setting-row" role="group" aria-label={t('settings.fontSize')}>
            <span>{t('settings.fontSize')}</span>
            <OptionCards size="sm" value={appearance.proseFontSize}
              onChange={proseFontSize => onChange({ proseFontSize })}
              items={[{ value: 17, label: '17px' }, { value: 18, label: '18px' }]} />
          </div>
          <div className="nf-writing-setting-row" role="group" aria-label={t('settings.measure')}>
            <span>{t('settings.measure')}</span>
            <OptionCards size="sm" value={appearance.measureWidth}
              onChange={measureWidth => onChange({ measureWidth })}
              items={[{ value: 720, label: '720' }, { value: 760, label: '760' }, { value: 800, label: '800' }]} />
          </div>
          <div className="nf-writing-setting-row" role="group" aria-label={t('settings.prosePaper')}>
            <span>{t('settings.prosePaper')}</span>
            <OptionCards size="sm" value={appearance.prosePaper}
              onChange={prosePaper => onChange({ prosePaper })}
              items={[
                { value: 'theme', label: t('settings.prosePaperTheme') },
                { value: 'warm', label: t('settings.prosePaperWarm') },
              ]} />
          </div>
          <div className="nf-writing-setting-row" role="group" aria-label={t('settings.listDensity')}>
            <div>
              <span>{t('settings.listDensity')}</span>
              <p className="text-[var(--color-text-muted)]">{t('settings.listDensityDesc')}</p>
            </div>
            <OptionCards size="sm" value={appearance.listDensity}
              onChange={listDensity => onChange({ listDensity })}
              items={[
                { value: 'compact', label: t('settings.listDensityCompact') },
                { value: 'standard', label: t('settings.listDensityStandard') },
                { value: 'comfortable', label: t('settings.listDensityComfortable') },
              ]} />
          </div>
        </div>
        <div role="group" aria-label={t('settings.appearancePreview')} className="nf-writing-appearance-preview"
          data-v3-preview-paper={appearance.prosePaper} data-v3-list-density={appearance.listDensity}>
          <p className="mb-2 text-xs font-semibold text-[var(--color-text-secondary)]">{t('settings.appearancePreview')}</p>
          <p className="nf-writing-preview-paper" style={{
            fontSize: appearance.proseFontSize,
            width: `${appearance.measureWidth / 8}%`,
          }}>{t('settings.appearancePreviewText')}</p>
          <div data-v3-density-list="" className="nf-writing-preview-list">
            <p className="menu-chip">{t('nav.projectTree')}</p>
            <p className="menu-chip">{t('chapter.blueprintTitle')}</p>
            <p className="menu-chip">{t('nav.knowledgeBase')}</p>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <p role="status" className="mr-auto text-micro text-[var(--color-text-muted)]">
          {t(dirty ? 'statusbar.unsavedShort' : 'statusbar.saved')}
        </p>
        <Button variant="outline" disabled={atDefaults} onClick={() => {
          heading.current?.focus({ preventScroll: true })
          onChange(DEFAULT_WRITING_APPEARANCE)
        }}>{t('action.reset')}</Button>
        <Button disabled={!dirty} onClick={() => {
          heading.current?.focus({ preventScroll: true })
          onApply()
        }}>{t('action.apply')}</Button>
      </div>
    </section>
  )
}
