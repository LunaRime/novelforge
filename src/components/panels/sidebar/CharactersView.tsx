/**
 * CharactersView — 角色管理列表视图 (v7 戏份分级)
 */
import { useState, useMemo } from 'react'
import { Users, RefreshCw, Plus, ChevronDown, ChevronRight } from 'lucide-react'
import { useProjectStore } from '../../../stores/project-store'
import {
  useCharacterStore, ROLE_LABELS, TIER_LABELS, groupByTier,
} from '../../../stores/character-store'
import type { CharacterCard } from '../../../stores/character-store'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { cn } from '../../../lib/utils'
import { useTranslation } from '../../../hooks/useTranslation'

export default function CharactersView() {
  const { t } = useTranslation()
  const currentProject = useProjectStore(s => s.currentProject)
  const characters = useCharacterStore(s => s.characters)
  const selectedName = useCharacterStore(s => s.selectedName)
  const load = useCharacterStore(s => s.load)
  const setSelectedName = useCharacterStore(s => s.setSelectedName)
  const addCharacter = useCharacterStore(s => s.addCharacter)
  const [tierFilter, setTierFilter] = useState<number | null>(null)
  const [collapsedTiers, setCollapsedTiers] = useState<Record<number, boolean>>({ 2: false, 3: true })

  const grouped = useMemo(() => groupByTier(characters), [characters])
  const display = useMemo(() => {
    if (tierFilter === null) return grouped
    return { [tierFilter]: grouped[tierFilter] || [] }
  }, [grouped, tierFilter])

  if (!currentProject) {
    return <EmptyState icon={<Users size={36} />} message={t('blueprint.openProjectFirst')} className="pb-[15vh]" opacity={0.4} />
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between px-3 h-9 flex-shrink-0 border-b border-[var(--color-border)]">
        <span className="text-xs font-medium text-[var(--color-text)] flex items-center gap-1">
          <Users size={13} />
          {t('charList.title')} ({characters.length})
        </span>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => load()} title={t('charList.refresh')}>
            <RefreshCw size={14} strokeWidth={2} />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={addCharacter} title={t('charList.newChar')}>
            <Plus size={14} strokeWidth={2} />
          </Button>
        </div>
      </div>

      {/* 分级筛选标签 */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[var(--color-border)] flex-shrink-0">
        {[null, 1, 2, 3].map(tier => (
          <button
            key={String(tier)}
            className={cn(
              'text-[0.65rem] px-2 py-0.5 rounded-full transition-colors cursor-pointer border',
              tierFilter === tier
                ? 'bg-[var(--color-accent)]/20 border-[var(--color-accent)] text-[var(--color-accent)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]'
            )}
            onClick={() => setTierFilter(tier)}
            type="button"
          >
            {tier === null ? t('charList.filterAll') : TIER_LABELS[tier]}
            <span className="ml-0.5 opacity-60">{tier === null ? characters.length : (grouped[tier] || []).length}</span>
          </button>
        ))}
      </div>

      {/* 角色列表 — 按 tier 分组 */}
      <div className="flex-1 overflow-y-auto p-1">
        {characters.length === 0 ? (
          <div className="text-center py-6 opacity-30 text-xs">{t('character.empty')}</div>
        ) : (
          [1, 2, 3].map(tier => {
            const chars = display[tier] || []
            if (chars.length === 0) return null
            const collapsed = collapsedTiers[tier] ?? false
            return (
              <div key={tier}>
                {/* tier 分组头 */}
                <button
                  className="flex items-center gap-1 px-2 py-1 w-full text-[0.65rem] font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] rounded cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); setCollapsedTiers(prev => ({ ...prev, [tier]: !collapsed })) }}
                  type="button"
                >
                  {collapsed
                    ? <ChevronRight size={10} />
                    : <ChevronDown size={10} />
                  }
                  {TIER_LABELS[tier]}
                  <span className="opacity-50 ml-auto">{chars.length}</span>
                </button>
                {!collapsed && chars.map(c => (
                  <CharItem
                    key={c.name}
                    char={c}
                    selected={selectedName === c.name}
                    onClick={() => setSelectedName(c.name)}
                  />
                ))}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function CharItem({ char: c, selected, onClick }: {
  char: CharacterCard; selected: boolean; onClick: () => void
}) {
  const { t } = useTranslation()

  // 解析标签
  let tags: string[] = []
  try { tags = JSON.parse(c.tags || '[]') } catch { tags = [] }

  // 解析出场章节
  let chaps: number[] = []
  try { chaps = JSON.parse(c.appearChapters || '[]') } catch { chaps = [] }

  const chapsDisplay = chaps.length <= 3
    ? chaps.join(',')
    : t('character.chapterRange')
        .replace('{start}', String(chaps[0]))
        .replace('{end}', String(chaps[chaps.length - 1]))
        .replace('{n}', String(chaps.length))

  const tier = c.tier ?? (c.role === 'protagonist' || c.role === 'antagonist' ? 1 : 2)

  return (
    <div
      className={cn(
        'px-2.5 py-1.5 rounded-md text-xs cursor-pointer mb-0.5 transition-colors',
        selected
          ? 'bg-[var(--color-active)] text-[var(--color-text)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]'
      )}
      onClick={onClick}
    >
      <div className="flex items-center gap-1">
        <span className="font-medium truncate">{c.name || t('character.unnamed')}</span>
        {c.currentState?.updatedAtChapter ? (
          <span className="text-[0.6rem] opacity-40 ml-auto flex-shrink-0">
            {t('chapter.nLabel').replace('{n}', String(c.currentState.updatedAtChapter))}
          </span>
        ) : null}
      </div>
      <div className="text-[0.7rem] mt-0.5 opacity-60 flex items-center gap-1.5">
        <span>{ROLE_LABELS[c.role]}</span>
        {tier === 1 && chaps.length > 0 && (
          <span className="opacity-50">· {chapsDisplay}</span>
        )}
      </div>
      {tags.length > 0 && (
        <div className="flex gap-1 mt-1 flex-wrap">
          {tags.slice(0, 3).map(tag => (
            <span
              key={tag}
              className="text-[0.6rem] px-1 rounded"
              style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-muted)' }}
            >
              #{tag}
            </span>
          ))}
          {tags.length > 3 && (
            <span className="text-[0.6rem] opacity-40">+{tags.length - 3}</span>
          )}
        </div>
      )}
    </div>
  )
}
