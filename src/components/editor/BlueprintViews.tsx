import { BookOpen, PenLine, Save, Trash2 } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import { cn } from '../../lib/utils'
import type { ChapterBlueprint } from '../../services/workflows/directory-workflow'
import { getCurrentLocale, type TextKey } from '../../shared/locale'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../ui/Select'
import { Textarea } from '../ui/Textarea'

const ROLES = ['建置', '铺垫', '发展', '冲突', '高潮', '转折', '收尾']

/** 章节角色 value（中文数据，存库兼容）→ i18n key（下拉显示时 t()） */
const ROLE_LABEL_KEYS: Record<string, TextKey> = {
  '建置': 'chapter.role.establishment',
  '铺垫': 'chapter.role.setup',
  '发展': 'chapter.role.development',
  '冲突': 'chapter.role.conflict',
  '高潮': 'chapter.role.climax',
  '转折': 'chapter.role.twist',
  '收尾': 'chapter.role.resolution',
}

const ROLE_COLORS: Record<string, string> = {
  高潮: 'bg-[rgba(var(--color-error-rgb),0.2)] text-[var(--color-error)]',
  冲突: 'bg-[rgba(var(--color-warning-rgb),0.2)] text-[var(--color-warning)]',
  转折: 'bg-[rgba(var(--color-accent-rgb),0.2)] text-[var(--color-accent)]',
  建置: 'bg-[rgba(var(--color-info-rgb),0.2)] text-[var(--color-info)]',
  收尾: 'bg-[rgba(var(--color-success-rgb),0.2)] text-[var(--color-success)]',
}

export function BlueprintList({ blueprints, volumes, selectedIdx, loadFailed, onSelect }: {
  blueprints: ChapterBlueprint[]
  volumes: ReadonlyArray<{ chapterStart: number; chapterEnd: number; title?: string; volumeNumber: number }>
  selectedIdx: number
  loadFailed: boolean
  onSelect: (index: number) => void
}) {
  const { t } = useTranslation()
  if (blueprints.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-4 text-center opacity-40">
        <BookOpen size={36} aria-hidden="true" />
        <span className="text-xs">{t(loadFailed ? 'common.loadFailed' : 'blueprint.emptyHint')}</span>
      </div>
    )
  }

  return (
    <ul className="space-y-[var(--v3-list-gap,2px)] p-1">
      {blueprints.map((blueprint, index) => {
        const volume = volumes.find(item => item.chapterStart <= blueprint.chapterNumber
          && (item.chapterEnd === 0 || blueprint.chapterNumber <= item.chapterEnd))
        const active = selectedIdx === index
        const title = blueprint.title || t('character.unnamed')
        return (
          <li key={blueprint.chapterNumber}>
            <button type="button" aria-current={active ? 'page' : undefined} title={title}
              onClick={() => onSelect(index)} className={cn(
                'w-full rounded-md px-2.5 py-2 text-left text-xs focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)]',
                active ? 'bg-[var(--color-active)] text-[var(--color-text)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]',
              )}>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="shrink-0 rounded bg-[var(--color-editor-bg)] px-1.5 py-0.5 text-micro tabular-nums text-[var(--color-text-muted)]">{blueprint.chapterNumber}</span>
                <span className="truncate font-medium">{title}</span>
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1">
                {volume && <span className="rounded bg-[rgba(var(--color-accent-rgb),0.12)] px-1 py-0.5 text-micro text-[var(--color-accent)]" title={volume.title || undefined}>
                  {t('volume.ordinal').replace('{n}', String(volume.volumeNumber))}
                </span>}
                <span className={cn('rounded px-1 py-0.5 text-micro', ROLE_COLORS[blueprint.role] || 'bg-[var(--color-hover)] text-[var(--color-text-muted)]')}>
                  {t(ROLE_LABEL_KEYS[blueprint.role] ?? 'chapter.role.development')}
                </span>
                {blueprint.userGuidance && <span className="rounded bg-[rgba(var(--color-accent-rgb),0.15)] px-1 py-0.5 text-micro text-[var(--color-accent)]" title={t('chapter.authorGuidance')}>
                  {t('chapter.hasGuidance')}
                </span>}
                {blueprint.notes && <span className="rounded bg-[rgba(var(--color-success-rgb),0.15)] px-1 py-0.5 text-micro text-[var(--color-success)]" title={t('chapter.blueprintNotes')}>
                  {t('chapter.hasNotes')}
                </span>}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export function BlueprintDetail({ selected, canWrite, saving, deleting, updateField, onWrite, onSave, onDelete }: {
  selected: ChapterBlueprint | null
  canWrite: boolean
  saving: boolean
  deleting: boolean
  updateField: <K extends keyof ChapterBlueprint>(key: K, value: ChapterBlueprint[K]) => void
  onWrite: () => void
  onSave: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex-1 overflow-y-auto">
      {selected ? (
        <fieldset className="min-w-0 max-w-2xl mx-auto px-5 py-4" disabled={deleting}>
          {/* 详情页将章节标题与写入操作放在同一页首，窄栏可以自然换行。 */}
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] pb-3">
            <h3 className="min-w-0 break-words font-[family-name:var(--font-writing)] text-xl font-semibold text-[var(--color-text)]">
              {t('import.chapterLabel').replace('{n}', String(selected.chapterNumber)).replace('{title}', selected.title || t('chapter.unnamed'))}
            </h3>
            <div className="flex items-center gap-1.5">
              {/* 仅下一章允许写作 */}
              {canWrite && (
                <Button
                  variant="ai"
                  size="sm"
                  onClick={onWrite}
                  title={t('chapter.generateDraft')}
                >
                  <PenLine size={12} /> {t('chapter.writeThisChapter')}
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={onDelete} title={t('chapter.deleteChapter')} disabled={saving || deleting}>
                <Trash2 size={13} style={{ color: 'var(--color-text-muted)' }} />
              </Button>
              <Button variant="outline" size="sm" onClick={onSave} disabled={saving || deleting}>
                <Save size={12} /> {saving ? t('chapter.saving') : t('chapter.save')}
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            {/* 基本信息 */}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3">
              <div>
                <Label>{t('blueprint.chapterNumber')}</Label>
                <Input
                  type="number"
                  value={selected.chapterNumber === 0 ? '' : selected.chapterNumber}
                  onChange={e => {
                    const raw = e.target.value
                    if (raw === '') {
                      updateField('chapterNumber', 0)
                    } else {
                      const n = parseInt(raw, 10)
                      if (!isNaN(n)) updateField('chapterNumber', n)
                    }
                  }}
                  onBlur={() => {
                    if (!selected.chapterNumber || selected.chapterNumber < 1) {
                      updateField('chapterNumber', 1)
                    }
                  }}
                />
              </div>
              <div className="min-w-0">
                <Label>{t('blueprint.chapterTitle')}</Label>
                <Input
                  value={selected.title}
                  onChange={e => updateField('title', e.target.value)}
                  placeholder={t('chapter.placeholderTitle')}
                />
              </div>
            </div>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3">
              <div>
                <Label>{t('blueprint.chapterPosition')}</Label>
                <Select value={selected.role} onValueChange={(v) => updateField('role', v)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map(r => <SelectItem key={r} value={r}>{t(ROLE_LABEL_KEYS[r] ?? 'chapter.role.development')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('blueprint.keyCharacters')}</Label>
                <Input
                  value={selected.characters.join('、')}
                  onChange={e => updateField('characters', e.target.value.split(/[,，、\s]+/).filter(Boolean))}
                  placeholder={t('chapter.placeholderCharacters')}
                />
              </div>
            </div>

            <div>
              <Label>{t('blueprint.mcGoal')}</Label>
              <Textarea
                value={selected.purpose}
                onChange={e => updateField('purpose', e.target.value)}
                placeholder={t('chapter.placeholderConflict')}
                rows={2}
              />
            </div>

            <div>
              <Label>{t('blueprint.conflict')}</Label>
              <Textarea
                value={selected.keyEvents}
                onChange={e => updateField('keyEvents', e.target.value)}
                placeholder={t('chapter.placeholderActions')}
                rows={4}
              />
            </div>

            <div>
              <Label>{t('blueprint.cliffhanger')}</Label>
              <Textarea
                value={selected.suspenseHook}
                onChange={e => updateField('suspenseHook', e.target.value)}
                placeholder={t('chapter.placeholderSuspense')}
                rows={2}
              />
            </div>

            {/* 作者微操指导 — 特别标注，写稿时注入为最高优先级 */}
            <div
              className="p-3 rounded-lg border"
              style={{
                borderColor: 'var(--color-accent)',
                backgroundColor: 'rgba(var(--color-accent-rgb), 0.06)',
              }}
            >
              <Label className="flex items-center gap-1.5">
                <span>{t('blueprint.authorGuidance')}</span>
                <span
                  className="text-micro font-normal"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {t('chapter.guidanceHint')}
                </span>
              </Label>
              <Textarea
                value={selected.userGuidance}
                onChange={e => updateField('userGuidance', e.target.value)}
                placeholder={t('chapter.placeholderGuidance')}
                rows={3}
                className="mt-1.5"
              />
            </div>
            {/* 章节要点（定稿后自动生成，也可手动编辑） */}
            <div
              className="p-3 rounded-lg border"
              style={{
                borderColor: 'var(--color-border)',
                backgroundColor: 'rgba(var(--color-success-rgb),0.04)',
              }}
            >
              <Label className="flex items-center gap-1.5">
                <span>{t('blueprint.keyPoints')}</span>
                <span
                  className="text-micro font-normal"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {selected.notesUpdatedAt
                    ? t('chapter.notesAuto').replace('{date}', new Date(selected.notesUpdatedAt).toLocaleDateString(getCurrentLocale()))
                    : t('chapter.notesAutoManual')
                  }
                </span>
              </Label>
              <Textarea
                value={selected.notes || ''}
                onChange={e => updateField('notes', e.target.value)}
                placeholder={t('chapter.placeholderNotes')}
                rows={4}
              />
            </div>
          </div>
        </fieldset>
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-3 opacity-30">
          <BookOpen size={36} />
          <span className="text-sm">{t('blueprint.selectChapter')}</span>
        </div>
      )}
    </div>
  )
}
