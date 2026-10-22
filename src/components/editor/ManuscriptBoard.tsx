import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, FileText, LayoutGrid, List, ListTree, RefreshCw, Route, Users } from 'lucide-react'
import { ipc } from '../../services/ipc-client'
import type { BlueprintData } from '../../../electron/repositories/blueprint-repository'
import { useProjectStore } from '../../stores/project-store'
import { useDraftStore } from '../../stores/draft-store'
import { useVolumeStore } from '../../stores/volume-store'
import { useCharacterStore } from '../../stores/character-store'
import { SegmentedControl } from '../ui/SegmentedControl'
import { EmptyState } from '../ui/EmptyState'
import { Spinner } from '../ui/Spinner'
import { Button } from '../ui/Button'
import CountBadge from '../ui/CountBadge'
import EditorPageHeader from '../ui/EditorPageHeader'
import { useTranslation } from '../../hooks/useTranslation'
import { openDraftByChapter, openBuiltinEditor } from '../panels/sidebar/SidebarShared'
import { normalizeBlueprintRole } from '../../services/blueprint-role'
import type { TextKey } from '../../shared/locale'

type BoardView = 'list' | 'card' | 'outline' | 'timeline'

const ROLE_KEYS: Record<string, TextKey> = {
  建置: 'chapter.role.establishment',
  铺垫: 'chapter.role.setup',
  发展: 'chapter.role.development',
  冲突: 'chapter.role.conflict',
  高潮: 'chapter.role.climax',
  转折: 'chapter.role.twist',
  收尾: 'chapter.role.resolution',
}

interface ChapterRow {
  blueprint: BlueprintData
  status: 'empty' | 'draft' | 'final'
  words: number
}

/**
 * 章节看板 —— 列表 / 卡片 / 大纲三视图。
 *
 * 与侧栏的「活页夹」并存：侧栏负责定位，这里负责**纵览**。数据全部来自既有
 * blueprint + drafts，不引入第二套章节模型；打开草稿复用侧栏入口，避免出现
 * 两条保存链路。反向链接只读展示 blueprint.characters，角色实体仍归角色库。
 */
export default function ManuscriptBoard() {
  const { t } = useTranslation()
  const project = useProjectStore((s) => s.currentProject)
  const draftsByChapter = useDraftStore((s) => s.draftsByChapter)
  const volumes = useVolumeStore((s) => s.volumes)
  const loadVolumes = useVolumeStore((s) => s.load)
  const [blueprints, setBlueprints] = useState<BlueprintData[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [view, setView] = useState<BoardView>('list')
  const [selected, setSelected] = useState<number | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const rows = await ipc.invoke('db:blueprint-get-all') as BlueprintData[]
      setBlueprints(rows.map((b) => ({ ...b, role: normalizeBlueprintRole(b.role) })))
      setSelected((prev) => prev ?? rows[0]?.chapterNumber ?? null)
    } finally {
      if (!silent) setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    Promise.resolve().then(() => { void load() })
    void useDraftStore.getState().loadAllDrafts()
    void loadVolumes()
  }, [project?.path, load, loadVolumes])

  const rows = useMemo<ChapterRow[]>(() => blueprints.map((blueprint) => {
    const latest = draftsByChapter[blueprint.chapterNumber]?.[0]
    return {
      blueprint,
      status: latest?.status === 'finalized' ? 'final' : latest ? 'draft' : 'empty',
      words: latest?.wordCount ?? 0,
    }
  }), [blueprints, draftsByChapter])

  const finalCount = rows.filter((row) => row.status === 'final').length

  const groups = useMemo(() => {
    const used = new Set<number>()
    const result = volumes.map((volume) => {
      const chapters = rows.filter((row) => {
        const n = row.blueprint.chapterNumber
        const inRange = n >= volume.chapterStart && (volume.chapterEnd === 0 || n <= volume.chapterEnd)
        if (inRange) used.add(n)
        return inRange
      })
      return { key: `v${volume.volumeNumber}`, title: volume.title || t('volume.title'), chapters }
    })
    const unassigned = rows.filter((row) => !used.has(row.blueprint.chapterNumber))
    if (unassigned.length > 0) result.push({ key: 'unassigned', title: t('board.unassigned'), chapters: unassigned })
    return result.length > 0 ? result : [{ key: 'all', title: t('board.title'), chapters: rows }]
  }, [rows, volumes, t])

  const selectedRow = rows.find((row) => row.blueprint.chapterNumber === selected) ?? null

  const openRow = (row: ChapterRow) => {
    void openDraftByChapter(row.blueprint.chapterNumber, row.blueprint.title)
  }

  const openCharacter = (name: string) => {
    useCharacterStore.getState().setSelectedName(name)
    openBuiltinEditor('character-editor', t('nav.characters'), 'character')
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
        <Spinner size={14} /> {t('status.loading')}
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<BookOpen size={32} style={{ color: 'var(--color-text-muted)', opacity: 0.6 }} />}
        message={t('board.empty')}
      />
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 min-w-0 flex flex-col">
        <EditorPageHeader
          icon={<LayoutGrid size={13} />}
          title={t('board.title')}
          meta={(
            <>
              <CountBadge value={rows.length} unit={t('unit.chapters')} />
              <CountBadge value={finalCount} unit={t('board.status.final')} tone={finalCount > 0 ? 'success' : 'muted'} />
            </>
          )}
          actions={(
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => { setRefreshing(true); void load(true); void useDraftStore.getState().loadAllDrafts(); void loadVolumes() }}
                title={t('action.refresh')}
              >
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              </Button>
              <SegmentedControl<BoardView>
                size="sm"
                value={view}
                onChange={setView}
                items={[
                  { value: 'list', label: t('board.view.list'), icon: <List size={11} /> },
                  { value: 'card', label: t('board.view.card'), icon: <LayoutGrid size={11} /> },
                  { value: 'outline', label: t('board.view.outline'), icon: <ListTree size={11} /> },
                  { value: 'timeline', label: t('board.view.timeline'), icon: <Route size={11} /> },
                ]}
              />
            </>
          )}
        />

        <div className="flex-1 min-h-0 overflow-y-auto p-4" data-board-view={view}>
          {groups.map((group) => (
            <section key={group.key} className="mb-5">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-micro font-medium" style={{ color: 'var(--color-text-secondary)' }}>{group.title}</span>
                <CountBadge value={group.chapters.length} unit={t('unit.chapters')} />
                <span className="h-px flex-1" style={{ backgroundColor: 'var(--color-border)' }} />
              </div>

              {view === 'timeline' ? (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {group.chapters.map((row) => (
                    <TimelineEvent
                      key={row.blueprint.chapterNumber}
                      row={row}
                      selected={selected === row.blueprint.chapterNumber}
                      onSelect={() => setSelected(row.blueprint.chapterNumber)}
                      onOpen={() => openRow(row)}
                    />
                  ))}
                </div>
              ) : view === 'card' ? (
                <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))' }}>
                  {group.chapters.map((row) => (
                    <ChapterCard
                      key={row.blueprint.chapterNumber}
                      row={row}
                      selected={selected === row.blueprint.chapterNumber}
                      onSelect={() => setSelected(row.blueprint.chapterNumber)}
                      onOpen={() => openRow(row)}
                    />
                  ))}
                </div>
              ) : view === 'outline' ? (
                <div className="space-y-2">
                  {group.chapters.map((row) => (
                    <OutlineRow
                      key={row.blueprint.chapterNumber}
                      row={row}
                      selected={selected === row.blueprint.chapterNumber}
                      onSelect={() => setSelected(row.blueprint.chapterNumber)}
                      onOpen={() => openRow(row)}
                    />
                  ))}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {group.chapters.map((row) => (
                    <ListRow
                      key={row.blueprint.chapterNumber}
                      row={row}
                      selected={selected === row.blueprint.chapterNumber}
                      onSelect={() => setSelected(row.blueprint.chapterNumber)}
                      onOpen={() => openRow(row)}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      </div>

      {/* 反向链接：本章 blueprint.characters 是唯一事实源；点击进入角色卡 */}
      <aside
        className="w-[236px] flex-shrink-0 flex flex-col"
        style={{ borderLeft: '1px solid var(--color-border)', backgroundColor: 'var(--color-sidebar)' }}
      >
        <div className="px-3 flex items-center gap-2" style={{ height: 40, borderBottom: '1px solid var(--color-border)' }}>
          <span className="text-micro font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t('board.backlinks')}</span>
          {selectedRow && selectedRow.blueprint.characters.length > 0 && (
            <CountBadge value={selectedRow.blueprint.characters.length} unit={t('unit.items')} />
          )}
        </div>
        {selectedRow ? (
          <div className="p-3 space-y-3 overflow-y-auto">
            <div>
              <div className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                {t('chapter.label').replace('{n}', String(selectedRow.blueprint.chapterNumber))} {selectedRow.blueprint.title}
              </div>
              <div className="mt-1 text-micro" style={{ color: 'var(--color-text-muted)' }}>
                {t('board.words').replace('{n}', selectedRow.words.toLocaleString())}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-micro" style={{ color: 'var(--color-text-muted)' }}>{t('board.characters')}</div>
              {selectedRow.blueprint.characters.length === 0 ? (
                <div className="text-micro" style={{ color: 'var(--color-text-muted)' }}>{t('board.noBacklinks')}</div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {selectedRow.blueprint.characters.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => openCharacter(name)}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-micro"
                      style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-secondary)' }}
                    >
                      <Users size={10} /> {name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => openRow(selectedRow)}
              className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-micro"
              style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-bg)' }}
            >
              <FileText size={11} /> {t('board.openDraft')}
            </button>
          </div>
        ) : null}
      </aside>
    </div>
  )
}

function RoleBadge({ role }: { role: string }) {
  const { t } = useTranslation()
  const key = ROLE_KEYS[role]
  if (!key) return null
  return (
    <span
      className="text-micro rounded px-1 py-px"
      style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)' }}
    >
      {t(key)}
    </span>
  )
}

function StatusDot({ status }: { status: ChapterRow['status'] }) {
  const { t } = useTranslation()
  const color = status === 'final' ? 'var(--color-success)' : status === 'draft' ? 'var(--color-warning)' : 'var(--color-text-muted)'
  const label = status === 'final' ? t('board.status.final') : status === 'draft' ? t('board.status.draft') : t('board.status.empty')
  return (
    <span className="inline-flex items-center gap-1 text-micro" style={{ color: 'var(--color-text-muted)' }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}

function ListRow({ row, selected, onSelect, onOpen }: {
  row: ChapterRow; selected: boolean; onSelect: () => void; onOpen: () => void
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onOpen}
      className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-[var(--color-hover)]"
      style={{
        minHeight: 36,
        backgroundColor: selected ? 'var(--color-active)' : 'transparent',
        color: 'var(--color-text)',
        cursor: 'pointer',
      }}
    >
      <span className="w-8 flex-shrink-0 text-right text-micro tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
        {row.blueprint.chapterNumber}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs">{row.blueprint.title || t('chapter.unnamed')}</span>
      <RoleBadge role={row.blueprint.role} />
      <span className="w-20 flex-shrink-0 text-right text-micro tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
        {t('board.words').replace('{n}', row.words.toLocaleString())}
      </span>
      <StatusDot status={row.status} />
    </button>
  )
}

function ChapterCard({ row, selected, onSelect, onOpen }: {
  row: ChapterRow; selected: boolean; onSelect: () => void; onOpen: () => void
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onOpen}
      className={`text-left rounded-md p-3 transition-colors ${selected ? 'bg-[var(--color-active)]' : 'bg-[var(--color-bg)] hover:bg-[var(--color-hover)]'}`}
      style={{
        border: `1px solid ${selected ? 'var(--color-accent)' : 'var(--color-border)'}`,
        color: 'var(--color-text)',
        cursor: 'pointer',
      }}
    >
      <div className="flex items-center gap-2">
        <span className="text-micro tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{row.blueprint.chapterNumber}</span>
        <RoleBadge role={row.blueprint.role} />
        <span className="flex-1" />
        <StatusDot status={row.status} />
      </div>
      <div className="mt-1.5 text-xs font-medium truncate">{row.blueprint.title || t('chapter.unnamed')}</div>
      <div className="mt-1 text-micro" style={{ color: 'var(--color-text-muted)' }}>
        {t('board.words').replace('{n}', row.words.toLocaleString())}
      </div>
      {row.blueprint.characters.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {row.blueprint.characters.slice(0, 3).map((name) => (
            <span key={name} className="rounded px-1 py-px text-micro" style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-secondary)' }}>
              {name}
            </span>
          ))}
          {row.blueprint.characters.length > 3 && (
            <span className="text-micro" style={{ color: 'var(--color-text-muted)' }}>+{row.blueprint.characters.length - 3}</span>
          )}
        </div>
      )}
    </button>
  )
}

function OutlineRow({ row, selected, onSelect, onOpen }: {
  row: ChapterRow; selected: boolean; onSelect: () => void; onOpen: () => void
}) {
  const { t } = useTranslation()
  const fields = [
    { label: t('board.outline.purpose'), value: row.blueprint.purpose },
    { label: t('board.outline.events'), value: row.blueprint.keyEvents },
    { label: t('board.outline.suspense'), value: row.blueprint.suspenseHook },
  ].filter((field) => field.value?.trim())

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onKeyDown={(event) => { if (event.key === 'Enter') onSelect() }}
      className={`rounded-md px-3 py-2.5 transition-colors ${selected ? 'bg-[var(--color-active)]' : 'bg-[var(--color-bg)] hover:bg-[var(--color-hover)]'}`}
      style={{
        border: `1px solid ${selected ? 'var(--color-accent)' : 'var(--color-border)'}`,
        cursor: 'pointer',
      }}
    >
      <div className="flex items-center gap-2">
        <span className="text-micro tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{row.blueprint.chapterNumber}</span>
        <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{row.blueprint.title || t('chapter.unnamed')}</span>
        <RoleBadge role={row.blueprint.role} />
        <span className="flex-1" />
        <StatusDot status={row.status} />
      </div>
      {fields.length > 0 && (
        <div className="mt-1.5 grid gap-1" style={{ gridTemplateColumns: '72px 1fr' }}>
          {fields.map((field) => (
            <div key={field.label} className="contents">
              <span className="text-micro" style={{ color: 'var(--color-text-muted)' }}>{field.label}</span>
              <span className="text-micro" style={{ color: 'var(--color-text-secondary)' }}>{field.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TimelineEvent({ row, selected, onSelect, onOpen }: {
  row: ChapterRow; selected: boolean; onSelect: () => void; onOpen: () => void
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onOpen}
      className={`text-left rounded-md p-2.5 flex-shrink-0 transition-colors ${selected ? 'bg-[var(--color-active)]' : 'bg-[var(--color-bg)] hover:bg-[var(--color-hover)]'}`}
      style={{
        width: 190,
        border: `1px solid ${selected ? 'var(--color-accent)' : 'var(--color-border)'}`,
        color: 'var(--color-text)',
        cursor: 'pointer',
      }}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-micro tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{row.blueprint.chapterNumber}</span>
        <RoleBadge role={row.blueprint.role} />
        <span className="flex-1" />
        <StatusDot status={row.status} />
      </div>
      <div className="mt-1 text-xs font-medium truncate">{row.blueprint.title || t('chapter.unnamed')}</div>
      {row.blueprint.characters.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {row.blueprint.characters.slice(0, 2).map((name) => (
            <span key={name} className="rounded px-1 text-micro" style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-secondary)' }}>
              {name}
            </span>
          ))}
        </div>
      )}
    </button>
  )
}
