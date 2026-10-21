import { useCallback, useEffect, useMemo, useState } from 'react'
import { Globe, Plus, Trash2, Route } from 'lucide-react'
import { ipc } from '../../services/ipc-client'
import { useTranslation } from '../../hooks/useTranslation'
import type { TextKey } from '../../shared/locale'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { EmptyState } from '../ui/EmptyState'

type Kind = 'place' | 'faction' | 'item' | 'concept'
interface Entity { uid: string; kind: string; name: string; description: string }
interface EventItem { uid: string; title: string; lane: string; timeLabel: string; chapterNumber: number | null; description: string; entityUids: string[] }

export default function WorldTimelineView() {
  const { t } = useTranslation()
  const [entities, setEntities] = useState<Entity[]>([])
  const [events, setEvents] = useState<EventItem[]>([])
  const [entityName, setEntityName] = useState('')
  const [entityKind, setEntityKind] = useState<Kind>('place')
  const [eventTitle, setEventTitle] = useState('')
  const [eventLane, setEventLane] = useState('main')
  const [eventTime, setEventTime] = useState('')
  const [eventChapter, setEventChapter] = useState('')

  const load = useCallback(async () => {
    const [es, evs] = await Promise.all([
      ipc.invoke('world:entity-list') as Promise<Entity[]>,
      ipc.invoke('timeline:event-list') as Promise<EventItem[]>,
    ])
    setEntities(es)
    setEvents(evs)
  }, [])

  useEffect(() => { Promise.resolve().then(() => load()) }, [load])

  const addEntity = async () => {
    const name = entityName.trim()
    if (!name) return
    await ipc.invoke('world:entity-upsert', { kind: entityKind, name, aliases: [], description: '', metadata: {} })
    setEntityName('')
    await load()
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
      entityUids: [],
    })
    setEventTitle('')
    setEventTime('')
    setEventChapter('')
    await load()
  }

  const lanes = useMemo(() => {
    const map = new Map<string, EventItem[]>()
    for (const event of events) {
      const lane = event.lane || 'main'
      if (!map.has(lane)) map.set(lane, [])
      map.get(lane)!.push(event)
    }
    return [...map.entries()]
  }, [events])

  return (
    <div className="h-full flex overflow-hidden">
      <div className="w-[300px] flex-shrink-0 flex flex-col" style={{ borderRight: '1px solid var(--color-border)', backgroundColor: 'var(--color-sidebar)' }}>
        <div className="px-3 h-10 flex items-center gap-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <Globe size={14} style={{ color: 'var(--color-accent)' }} />
          <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{t('world.entities')}</span>
        </div>
        <div className="p-2 space-y-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex gap-1.5">
            <select value={entityKind} onChange={(e) => setEntityKind(e.target.value as Kind)} className="rounded px-1 text-micro" style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
              <option value="place">{t('world.kind.place')}</option>
              <option value="faction">{t('world.kind.faction')}</option>
              <option value="item">{t('world.kind.item')}</option>
              <option value="concept">{t('world.kind.concept')}</option>
            </select>
            <Input value={entityName} onChange={(e) => setEntityName(e.target.value)} placeholder={t('world.entityName')} onKeyDown={(e) => { if (e.key === 'Enter') void addEntity() }} />
            <Button size="sm" onClick={() => void addEntity()}><Plus size={12} /></Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {entities.length === 0 ? <EmptyState icon={<Globe size={28} />} message={t('world.emptyEntities')} /> : entities.map((entity) => (
            <div key={entity.uid} className="rounded-lg p-2.5" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
              <div className="flex items-center gap-2">
                <span className="text-micro px-1 rounded" style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-muted)' }}>{t(('world.kind.' + entity.kind) as TextKey)}</span>
                <span className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{entity.name}</span>
                <span className="flex-1" />
                <button type="button" className="icon-btn" title={t('action.delete')} onClick={async () => { await ipc.invoke('world:entity-delete', entity.uid); await load() }}>
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="mt-1 text-micro truncate" style={{ color: 'var(--color-text-muted)' }}>{entity.uid}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="px-3 h-10 flex items-center gap-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <Route size={14} style={{ color: 'var(--color-accent)' }} />
          <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{t('world.timeline')}</span>
        </div>
        <div className="p-3 flex flex-wrap gap-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <Input value={eventTitle} onChange={(e) => setEventTitle(e.target.value)} placeholder={t('world.eventTitle')} onKeyDown={(e) => { if (e.key === 'Enter') void addEvent() }} />
          <Input value={eventLane} onChange={(e) => setEventLane(e.target.value)} placeholder={t('world.lane')} />
          <Input value={eventTime} onChange={(e) => setEventTime(e.target.value)} placeholder={t('world.time')} />
          <Input value={eventChapter} onChange={(e) => setEventChapter(e.target.value)} placeholder={t('world.chapter')} />
          <Button size="sm" onClick={() => void addEvent()}><Plus size={12} /> {t('world.addEvent')}</Button>
        </div>
        <div className="flex-1 overflow-auto p-3 space-y-3">
          {lanes.length === 0 ? <EmptyState icon={<Route size={28} />} message={t('world.emptyTimeline')} /> : lanes.map(([lane, items]) => (
            <div key={lane}>
              <div className="mb-1.5 text-micro font-medium" style={{ color: 'var(--color-text-secondary)' }}>{lane}</div>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {items.map((event) => (
                  <div key={event.uid} className="w-[190px] flex-shrink-0 rounded-lg p-2.5" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-micro" style={{ color: 'var(--color-text-muted)' }}>{event.timeLabel || '—'}</span>
                      {event.chapterNumber != null && <span className="text-micro" style={{ color: 'var(--color-accent)' }}>{t('chapter.label').replace('{n}', String(event.chapterNumber))}</span>}
                      <span className="flex-1" />
                      <button type="button" className="icon-btn" title={t('action.delete')} onClick={async () => { await ipc.invoke('timeline:event-delete', event.uid); await load() }}>
                        <Trash2 size={11} />
                      </button>
                    </div>
                    <div className="mt-1 text-xs font-medium" style={{ color: 'var(--color-text)' }}>{event.title}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
