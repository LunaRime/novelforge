import { useCallback, useEffect, useMemo, useState } from 'react'
import { Globe, Plus, Trash2, Route, RefreshCw, X } from 'lucide-react'
import { ipc } from '../../services/ipc-client'
import { useTranslation } from '../../hooks/useTranslation'
import type { TextKey } from '../../shared/locale'
import { Button } from '../ui/Button'
import CountBadge from '../ui/CountBadge'
import EditorPageHeader from '../ui/EditorPageHeader'
import { EmptyState } from '../ui/EmptyState'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../ui/Select'
import { Spinner } from '../ui/Spinner'
import { openDraftByChapter } from '../panels/sidebar/SidebarShared'

type Kind = 'place' | 'faction' | 'item' | 'concept'
interface Entity { uid: string; kind: string; name: string; description: string }
interface EventItem {
  uid: string
  title: string
  lane: string
  timeValue: number
  timeLabel: string
  chapterNumber: number | null
  description: string
  entityUids: string[]
}

const ENTITY_KINDS: Kind[] = ['place', 'faction', 'item', 'concept']

/**
 * 世界观与时间线 —— 与章节蓝图共用页头 / 左侧列表 / 右侧内容的三段结构。
 *
 * 左栏是实体清单（可选中过滤时间线），右栏是事件时间线；新增实体与新增事件
 * 各自留在所属栏内，避免出现第二个“隐藏入口”。
 */
export default function WorldTimelineView() {
  const { t } = useTranslation()
  const [entities, setEntities] = useState<Entity[]>([])
  const [events, setEvents] = useState<EventItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedEntityUid, setSelectedEntityUid] = useState<string | null>(null)
  const [entityName, setEntityName] = useState('')
  const [entityKind, setEntityKind] = useState<Kind>('place')
  const [eventTitle, setEventTitle] = useState('')
  const [eventLane, setEventLane] = useState('main')
  const [eventTime, setEventTime] = useState('')
  const [eventChapter, setEventChapter] = useState('')

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const [nextEntities, nextEvents] = await Promise.all([
        ipc.invoke('world:entity-list') as Promise<Entity[]>,
        ipc.invoke('timeline:event-list') as Promise<EventItem[]>,
      ])
      setEntities(nextEntities)
      setEvents(nextEvents)
      setSelectedEntityUid((prev) => prev && nextEntities.some(e => e.uid === prev) ? prev : null)
    } finally {
      if (!silent) setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { Promise.resolve().then(() => { void load() }) }, [load])

  const entityById = useMemo(() => new Map(entities.map(e => [e.uid, e])), [entities])
  const selectedEntity = selectedEntityUid ? entityById.get(selectedEntityUid) ?? null : null

  const addEntity = async () => {
    const name = entityName.trim()
    if (!name) return
    const result = await ipc.invoke('world:entity-upsert', {
      kind: entityKind,
      name,
      aliases: [],
      description: '',
      metadata: {},
    })
    if (result.success) {
      setEntityName('')
      if (result.uid) setSelectedEntityUid(result.uid)
      await load(true)
    }
  }

  const addEvent = async () => {
    const title = eventTitle.trim()
    if (!title) return
    await ipc.invoke('timeline:event-upsert', {
      title,
      lane: eventLane.trim() || 'main',
      timeLabel: eventTime.trim(),
      timeValue: Number(eventTime.replace(/\D/g, '')) || 0,
      chapterNumber: eventChapter ? Number(eventChapter) : null,
      description: '',
      entityUids: selectedEntityUid ? [selectedEntityUid] : [],
    })
    setEventTitle('')
    setEventTime('')
    setEventChapter('')
    await load(true)
  }

  const visibleEvents = useMemo(() => {
    const list = selectedEntityUid
      ? events.filter(event => event.entityUids.includes(selectedEntityUid))
      : events
    return [...list].sort((a, b) => (a.timeValue - b.timeValue) || ((a.chapterNumber ?? 0) - (b.chapterNumber ?? 0)))
  }, [events, selectedEntityUid])

  const lanes = useMemo(() => {
    const map = new Map<string, EventItem[]>()
    for (const event of visibleEvents) {
      const lane = event.lane || 'main'
      if (!map.has(lane)) map.set(lane, [])
      map.get(lane)!.push(event)
    }
    return [...map.entries()]
  }, [visibleEvents])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <EditorPageHeader
        icon={<Globe size={13} />}
        title={t('world.title')}
        meta={(
          <>
            <CountBadge value={entities.length} unit={t('unit.entities')} />
            <CountBadge value={events.length} unit={t('unit.events')} />
          </>
        )}
        actions={(
          <Button
            variant="ghost"
            size="icon"
            onClick={() => { setRefreshing(true); void load(true) }}
            title={t('action.refresh')}
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </Button>
        )}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* 左栏：实体清单 + 新增实体 */}
        <aside
          className="w-[220px] flex-shrink-0 flex flex-col overflow-hidden"
          style={{ borderRight: '1px solid var(--color-border)', backgroundColor: 'var(--color-sidebar)' }}
        >
          <div className="p-2 space-y-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-1.5">
              <Select value={entityKind} onValueChange={(value) => setEntityKind(value as Kind)}>
                <SelectTrigger className="h-7 w-[88px] text-micro">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_KINDS.map(kind => (
                    <SelectItem key={kind} value={kind}>{t(('world.kind.' + kind) as TextKey)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={entityName}
                onChange={(e) => setEntityName(e.target.value)}
                placeholder={t('world.entityName')}
                onKeyDown={(e) => { if (e.key === 'Enter') void addEntity() }}
                className="min-w-0 flex-1"
              />
              <Button size="sm" className="h-7 px-2" onClick={() => void addEntity()} title={t('world.entityName')}>
                <Plus size={12} />
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
            {loading ? (
              <div className="flex h-full items-center justify-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                <Spinner size={14} /> {t('status.loading')}
              </div>
            ) : entities.length === 0 ? (
              <EmptyState icon={<Globe size={28} />} message={t('world.emptyEntities')} />
            ) : entities.map((entity) => {
              const selected = selectedEntityUid === entity.uid
              return (
                <div
                  key={entity.uid}
                  className={`group flex min-h-9 items-center gap-1 rounded-md px-2 py-1.5 transition-colors ${selected ? 'bg-[var(--color-active)]' : 'hover:bg-[var(--color-hover)]'}`}
                  style={selected ? { boxShadow: 'inset 2px 0 0 var(--color-accent)' } : undefined}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedEntityUid(selected ? null : entity.uid)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left cursor-pointer"
                  >
                    <span
                      className="flex-shrink-0 rounded px-1 py-px text-micro"
                      style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-muted)' }}
                    >
                      {t(('world.kind.' + entity.kind) as TextKey)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium" style={{ color: 'var(--color-text)' }}>{entity.name}</span>
                      <span className="block truncate text-micro" style={{ color: 'var(--color-text-muted)' }}>
                        {entity.description || entity.uid.slice(0, 10)}
                      </span>
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                    style={{ width: 32, height: 32 }}
                    title={t('action.delete')}
                    onClick={async () => { await ipc.invoke('world:entity-delete', entity.uid); await load(true) }}
                  >
                    <Trash2 size={12} style={{ color: 'var(--color-text-muted)' }} />
                  </Button>
                </div>
              )
            })}
          </div>
        </aside>

        {/* 右栏：事件时间线 */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <div className="p-3 flex flex-wrap items-end gap-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div style={{ flex: '1 1 140px', minWidth: 120 }}>
              <Label>{t('world.eventTitle')}</Label>
              <Input value={eventTitle} onChange={(e) => setEventTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addEvent() }} />
            </div>
            <div style={{ flex: '0 1 96px', minWidth: 80 }}>
              <Label>{t('world.lane')}</Label>
              <Input value={eventLane} onChange={(e) => setEventLane(e.target.value)} />
            </div>
            <div style={{ flex: '0 1 96px', minWidth: 80 }}>
              <Label>{t('world.time')}</Label>
              <Input value={eventTime} onChange={(e) => setEventTime(e.target.value)} />
            </div>
            <div style={{ flex: '0 1 72px', minWidth: 64 }}>
              <Label>{t('world.chapter')}</Label>
              <Input value={eventChapter} onChange={(e) => setEventChapter(e.target.value)} />
            </div>
            <Button size="sm" className="h-7" onClick={() => void addEvent()}>
              <Plus size={12} /> {t('world.addEvent')}
            </Button>
          </div>

          {selectedEntity && (
            <div className="flex items-center gap-2 px-3 py-1.5 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-elevated)' }}>
              <span className="text-micro" style={{ color: 'var(--color-text-muted)' }}>{t('world.entities')}</span>
              <span className="text-xs font-medium" style={{ color: 'var(--color-accent)' }}>{selectedEntity.name}</span>
              <span className="flex-1" />
              <Button variant="ghost" size="sm" onClick={() => setSelectedEntityUid(null)}>
                <X size={11} /> {t('action.cancel')}
              </Button>
            </div>
          )}

          <div className="flex-1 overflow-auto p-4 space-y-4">
            {loading ? null : lanes.length === 0 ? (
              <EmptyState icon={<Route size={28} />} message={selectedEntity ? t('world.noEntityEvents') : t('world.emptyTimeline')} />
            ) : lanes.map(([lane, items]) => (
              <section key={lane}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-micro font-medium" style={{ color: 'var(--color-text-secondary)' }}>{lane}</span>
                  <CountBadge value={items.length} unit={t('unit.events')} />
                  <span className="h-px flex-1" style={{ backgroundColor: 'var(--color-border)' }} />
                </div>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {items.map((event) => (
                    <div
                      key={event.uid}
                      className="w-[210px] flex-shrink-0 rounded-md p-3"
                      style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
                    >
                      <div className="flex items-start gap-1.5">
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left cursor-pointer"
                          onClick={() => { if (event.chapterNumber != null) void openDraftByChapter(event.chapterNumber, event.title) }}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="text-micro" style={{ color: 'var(--color-text-muted)' }}>{event.timeLabel || '—'}</span>
                            {event.chapterNumber != null && (
                              <span className="text-micro" style={{ color: 'var(--color-accent)' }}>
                                {t('chapter.label').replace('{n}', String(event.chapterNumber))}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 text-xs font-medium" style={{ color: 'var(--color-text)' }}>{event.title}</div>
                          {event.description && (
                            <div className="mt-0.5 text-micro line-clamp-2" style={{ color: 'var(--color-text-muted)' }}>{event.description}</div>
                          )}
                        </button>
                        <Button
                          variant="ghost"
                          size="icon"
                          style={{ width: 32, height: 32 }}
                          title={t('action.delete')}
                          onClick={async () => { await ipc.invoke('timeline:event-delete', event.uid); await load(true) }}
                        >
                          <Trash2 size={11} style={{ color: 'var(--color-text-muted)' }} />
                        </Button>
                      </div>
                      {event.entityUids.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {event.entityUids.map(uid => {
                            const entity = entityById.get(uid)
                            if (!entity) return null
                            return (
                              <button
                                key={uid}
                                type="button"
                                className="rounded px-1 py-px text-micro cursor-pointer"
                                style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-secondary)' }}
                                onClick={() => setSelectedEntityUid(uid)}
                              >
                                {entity.name}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </main>
      </div>
    </div>
  )
}
