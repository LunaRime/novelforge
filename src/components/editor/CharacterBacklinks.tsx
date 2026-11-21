import { useMemo, useState, type ReactNode } from 'react'
import { Activity, ArrowDownLeft, ArrowUpRight, BookOpen, ChevronRight, Search } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import { parseAliases } from '../../services/character-normalize'
import type { CharacterCard } from '../../stores/character-store'
import { SemanticLabel } from '../ui/SemanticLabel'
import CountBadge from '../ui/CountBadge'
import { Input } from '../ui/Input'
import { CharacterChapterLink } from './CharacterChapterLink'
import { readAppearanceChapters, readCharacterRelations, relationLabels, useCharacterChapterDrafts } from './character-links'

interface Props {
  character: CharacterCard
  allCharacters: CharacterCard[]
  onSelect: (name: string) => void
}

export default function CharacterBacklinks({ character, allCharacters, onSelect }: Props) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()
  const drafts = useCharacterChapterDrafts()
  const related = useMemo(() => {
    const outgoing = readCharacterRelations(character)
    const incoming = allCharacters.flatMap(other =>
      other.name === character.name ? [] : readCharacterRelations(other)
        .filter(relation => relation.target === character.name)
        .map(relation => ({ ...relation, target: other.name })),
    )
    return { outgoing, incoming }
  }, [character, allCharacters])
  const cardsByName = useMemo(() => new Map(allCharacters.map(card => [card.name, card])), [allCharacters])
  const chapters = useMemo(() => readAppearanceChapters(character.appearChapters), [character.appearChapters])
  const chapterTitle = (chapter: number) => t('chapter.label').replace('{n}', String(chapter))
  const shownChapters = chapters.filter(chapter => !query || String(chapter).includes(query) || chapterTitle(chapter).toLowerCase().includes(query))
  const matches = (row: ReturnType<typeof readCharacterRelations>[number]) => !query || [
    row.target,
    ...parseAliases(cardsByName.get(row.target)?.aliases),
    row.label,
    t(relationLabels[row.type]),
    row.sinceChapter > 0 ? chapterTitle(row.sinceChapter) : '',
  ].some(text => text.toLowerCase().includes(query))
  const outgoing = related.outgoing.filter(matches)
  const incoming = related.incoming.filter(matches)
  const hasLinks = chapters.length + related.incoming.length + related.outgoing.length > 0
  const noMatches = Boolean(query && shownChapters.length + outgoing.length + incoming.length === 0)
  const state = character.currentState
  const stateChapter = state?.updatedAtChapter ?? 0

  const relationRows = (rows: typeof outgoing) => (
    <ul className="nf-character-link-list">
      {rows.map(({ target, type, label, sinceChapter }, index) => {
        const exists = cardsByName.has(target)
        const content = (
          <>
            <span className="nf-character-relation-name">{target}</span>
            <span className="nf-character-relation-meta">
              <span className="nf-character-relation-type">{t(relationLabels[type])}</span>
              {label && <span className="min-w-0 break-words">{label}</span>}
            </span>
          </>
        )
        return (
          <li key={JSON.stringify([target, type, label, sinceChapter, index])}>
            {exists ? (
              <button type="button" className="nf-character-relation-target" onClick={event => {
                event.currentTarget.closest<HTMLElement>('.nf-character-backlinks')?.focus({ preventScroll: true })
                setSearch('')
                onSelect(target)
              }}>
                {content}
                <ChevronRight size={14} className="nf-character-relation-chevron" aria-hidden="true" />
              </button>
            ) : <div className="nf-character-relation-target">{content}</div>}
            {sinceChapter > 0 && (
              <span className="nf-character-relation-chapter">
                <CharacterChapterLink chapter={sinceChapter} drafts={drafts} />
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )

  return (
    <div tabIndex={-1} className="nf-character-backlinks" aria-label={t('character.backlinks')} role="region">
      {hasLinks && (
        <div className="nf-character-search">
          <Search size={14} aria-hidden="true" />
          <Input type="search" value={search} aria-label={t('character.backlinks.search')}
            placeholder={t('character.backlinks.search')} onChange={event => setSearch(event.currentTarget.value)} />
        </div>
      )}
      {noMatches ? (
        <p className="nf-character-note" role="status">{t('character.backlinks.noMatches')}</p>
      ) : (
        <>
          <LinkSection icon={<BookOpen size={14} />} title={t('character.backlinks.chapters')} count={shownChapters.length}>
            {shownChapters.length > 0 ? (
              <ul className="nf-character-chapter-list">
                {shownChapters.map(chapter => <li key={chapter}><CharacterChapterLink chapter={chapter} drafts={drafts} /></li>)}
              </ul>
            ) : <p className="nf-character-note">{t('character.backlinks.noChapters')}</p>}
          </LinkSection>
          <div className="nf-character-backlink-columns">
            <LinkSection icon={<ArrowUpRight size={14} />} title={t('character.backlinks.relatedChars')} count={outgoing.length}>
              {outgoing.length > 0 ? relationRows(outgoing) : <p className="nf-character-note">{t('character.backlinks.noRelations')}</p>}
            </LinkSection>
            <LinkSection icon={<ArrowDownLeft size={14} />} title={t('character.backlinks.mentionedBy')} count={incoming.length}>
              {incoming.length > 0 ? relationRows(incoming) : <p className="nf-character-note">{t('character.backlinks.noRelations')}</p>}
            </LinkSection>
          </div>
        </>
      )}
      {state && (state.location || state.powerLevel || state.recentEvents || stateChapter > 0) && (
        <LinkSection icon={<Activity size={14} />} title={t('character.backlinks.stateSummary')}
          meta={stateChapter > 0 ? <CharacterChapterLink chapter={stateChapter} drafts={drafts} /> : undefined}>
          <div className="flex flex-wrap gap-2 text-xs text-[var(--color-text-secondary)]">
            {state.location && <SemanticLabel name="location">{state.location}</SemanticLabel>}
            {state.powerLevel && <SemanticLabel name="power">{state.powerLevel}</SemanticLabel>}
          </div>
          {state.recentEvents && <p className="nf-character-note whitespace-pre-wrap">{state.recentEvents}</p>}
        </LinkSection>
      )}
    </div>
  )
}

function LinkSection({ icon, title, count, meta, children }: {
  icon: ReactNode
  title: string
  count?: number
  meta?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="nf-character-card">
      <h3 className="nf-character-card-title">
        <span className="nf-character-section-icon" aria-hidden="true">{icon}</span>
        {title}
        {count !== undefined && <CountBadge value={count} />}
      </h3>
      {meta && <div className="nf-character-note">{meta}</div>}
      {children}
    </section>
  )
}
