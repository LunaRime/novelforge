/**
 * 世界实体 / 实体关系 / 时间线事件（v23）。
 * 所有跨表引用使用稳定 uid；显示名可改。
 */
import { randomUUID } from 'node:crypto'
import { getProjectDb } from '../database'

export interface WorldEntity {
  uid: string
  kind: string
  name: string
  aliases: string[]
  description: string
  metadata: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface EntityRelation {
  id: number
  fromUid: string
  toUid: string
  type: string
  label: string
  createdAt: number
}

export interface TimelineEvent {
  uid: string
  title: string
  lane: string
  timeValue: number
  timeLabel: string
  chapterNumber: number | null
  description: string
  entityUids: string[]
  locationUid: string | null
  createdAt: number
  updatedAt: number
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

function entityRow(row: Record<string, unknown>): WorldEntity {
  return {
    uid: row.uid as string,
    kind: row.kind as string,
    name: row.name as string,
    aliases: parseJson<string[]>(row.aliases, []),
    description: (row.description as string) || '',
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: (row.created_at as number) || 0,
    updatedAt: (row.updated_at as number) || 0,
  }
}

function relationRow(row: Record<string, unknown>): EntityRelation {
  return {
    id: row.id as number,
    fromUid: row.from_uid as string,
    toUid: row.to_uid as string,
    type: row.type as string,
    label: (row.label as string) || '',
    createdAt: (row.created_at as number) || 0,
  }
}

function eventRow(row: Record<string, unknown>): TimelineEvent {
  return {
    uid: row.uid as string,
    title: row.title as string,
    lane: (row.lane as string) || 'main',
    timeValue: (row.time_value as number) || 0,
    timeLabel: (row.time_label as string) || '',
    chapterNumber: (row.chapter_number as number | null) ?? null,
    description: (row.description as string) || '',
    entityUids: parseJson<string[]>(row.entity_uids, []),
    locationUid: (row.location_uid as string | null) ?? null,
    createdAt: (row.created_at as number) || 0,
    updatedAt: (row.updated_at as number) || 0,
  }
}

export class WorldRepository {
  static listEntities(kind?: string): WorldEntity[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = kind
      ? db.prepare('SELECT * FROM world_entities WHERE kind = ? ORDER BY name ASC').all(kind)
      : db.prepare('SELECT * FROM world_entities ORDER BY kind ASC, name ASC').all()
    return (rows as Record<string, unknown>[]).map(entityRow)
  }

  static upsertEntity(data: { uid?: string; kind: string; name: string; aliases?: string[]; description?: string; metadata?: Record<string, unknown> }): string {
    const db = getProjectDb()
    if (!db) throw new Error('db-not-connected')
    const uid = data.uid || randomUUID()
    db.prepare(`
      INSERT INTO world_entities (uid, kind, name, aliases, description, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(uid) DO UPDATE SET
        kind = excluded.kind, name = excluded.name, aliases = excluded.aliases,
        description = excluded.description, metadata = excluded.metadata,
        updated_at = unixepoch() * 1000
    `).run(uid, data.kind, data.name, JSON.stringify(data.aliases ?? []), data.description ?? '', JSON.stringify(data.metadata ?? {}))
    return uid
  }

  static deleteEntity(uid: string): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare('DELETE FROM world_entities WHERE uid = ?').run(uid)
  }

  static listRelations(fromUid?: string): EntityRelation[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = fromUid
      ? db.prepare('SELECT * FROM entity_relations WHERE from_uid = ? ORDER BY id ASC').all(fromUid)
      : db.prepare('SELECT * FROM entity_relations ORDER BY id ASC').all()
    return (rows as Record<string, unknown>[]).map(relationRow)
  }

  static upsertRelation(data: { fromUid: string; toUid: string; type: string; label?: string }): void {
    const db = getProjectDb()
    if (!db) throw new Error('db-not-connected')
    db.prepare(`
      INSERT INTO entity_relations (from_uid, to_uid, type, label)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(from_uid, to_uid, type) DO UPDATE SET label = excluded.label
    `).run(data.fromUid, data.toUid, data.type, data.label ?? '')
  }

  static deleteRelation(id: number): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare('DELETE FROM entity_relations WHERE id = ?').run(id)
  }

  static listEvents(): TimelineEvent[] {
    const db = getProjectDb()
    if (!db) return []
    return (db.prepare('SELECT * FROM timeline_events ORDER BY lane ASC, time_value ASC, created_at ASC').all() as Record<string, unknown>[]).map(eventRow)
  }

  static upsertEvent(data: {
    uid?: string; title: string; lane?: string; timeValue?: number; timeLabel?: string;
    chapterNumber?: number | null; description?: string; entityUids?: string[]; locationUid?: string | null
  }): string {
    const db = getProjectDb()
    if (!db) throw new Error('db-not-connected')
    const uid = data.uid || randomUUID()
    db.prepare(`
      INSERT INTO timeline_events (uid, title, lane, time_value, time_label, chapter_number, description, entity_uids, location_uid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(uid) DO UPDATE SET
        title = excluded.title, lane = excluded.lane, time_value = excluded.time_value,
        time_label = excluded.time_label, chapter_number = excluded.chapter_number,
        description = excluded.description, entity_uids = excluded.entity_uids,
        location_uid = excluded.location_uid, updated_at = unixepoch() * 1000
    `).run(
      uid, data.title, data.lane ?? 'main', data.timeValue ?? 0, data.timeLabel ?? '',
      data.chapterNumber ?? null, data.description ?? '', JSON.stringify(data.entityUids ?? []), data.locationUid ?? null,
    )
    return uid
  }

  static deleteEvent(uid: string): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare('DELETE FROM timeline_events WHERE uid = ?').run(uid)
  }
}
