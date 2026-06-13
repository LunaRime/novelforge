/**
 * BlueprintRepository — 章节蓝图 (blueprints 表)
 *
 * 取代旧的 chapter-repository.ts，管理章节的规划元数据。
 */
import { getProjectDb } from '../database'

/** 蓝图行类型（DB 蛇形命名） */
export interface BlueprintRow {
    chapter_number: number
    title: string
    role: string
    purpose: string
    key_events: string
    characters: string
    suspense_hook: string
    user_guidance: string
    notes: string
    notes_updated_at: string
    sort_order: number
    priority: number
    created_at: string
    updated_at: string
}

/** 前端使用的驼峰接口 */
export interface BlueprintData {
    chapterNumber: number
    title: string
    role: string
    purpose: string
    keyEvents: string
    characters: string[]
    suspenseHook: string
    userGuidance: string
    notes: string
    notesUpdatedAt: string
    sortOrder: number
    priority: number
}

/** 蓝图排序方式 */
export type BlueprintSortKey = 'chapter_number' | 'priority' | 'role' | 'custom'
export type SortDirection = 'asc' | 'desc'

export interface BlueprintSortConfig {
    key: BlueprintSortKey
    direction: SortDirection
}

function rowToData(row: BlueprintRow): BlueprintData {
    let chars: string[] = []
    try { chars = JSON.parse(row.characters) } catch { /* 容错 */ }
    return {
        chapterNumber: row.chapter_number,
        title: row.title,
        role: row.role,
        purpose: row.purpose,
        keyEvents: row.key_events,
        characters: chars,
        suspenseHook: row.suspense_hook,
        userGuidance: row.user_guidance,
        notes: row.notes,
        notesUpdatedAt: row.notes_updated_at,
        sortOrder: row.sort_order ?? 0,
        priority: row.priority ?? 0,
    }
}

export class BlueprintRepository {
    /** 获取所有蓝图（按章节号排序） */
    static getAll(): BlueprintData[] {
        const db = getProjectDb()
        if (!db) return []

        const rows = db.prepare(
            'SELECT * FROM blueprints ORDER BY chapter_number ASC'
        ).all() as BlueprintRow[]

        return rows.map(rowToData)
    }

    /** 按指定排序方式获取所有蓝图 */
    static getAllSorted(config: BlueprintSortConfig): BlueprintData[] {
        const db = getProjectDb()
        if (!db) return []

        let orderClause: string
        switch (config.key) {
            case 'priority':
                orderClause = `priority ${config.direction === 'desc' ? 'DESC' : 'ASC'}, chapter_number ASC`
                break
            case 'role':
                // 按章节定位排序：开端 → 发展 → 转折 → 高潮 → 结局
                orderClause = `
                    CASE role
                        WHEN '开端' THEN 1
                        WHEN '发展' THEN 2
                        WHEN '转折' THEN 3
                        WHEN '高潮' THEN 4
                        WHEN '结局' THEN 5
                        ELSE 6
                    END ${config.direction === 'desc' ? 'DESC' : 'ASC'},
                    chapter_number ASC
                `
                break
            case 'custom':
                orderClause = `sort_order ${config.direction === 'desc' ? 'DESC' : 'ASC'}, chapter_number ASC`
                break
            case 'chapter_number':
            default:
                orderClause = `chapter_number ${config.direction === 'desc' ? 'DESC' : 'ASC'}`
                break
        }

        const rows = db.prepare(
            `SELECT * FROM blueprints ORDER BY ${orderClause}`
        ).all() as BlueprintRow[]

        return rows.map(rowToData)
    }

    /** 检测缺失的章节号（缺口检测） */
    static getGaps(totalChapters: number): number[] {
        const db = getProjectDb()
        if (!db) return []

        const rows = db.prepare(
            'SELECT chapter_number FROM blueprints ORDER BY chapter_number ASC'
        ).all() as Array<{ chapter_number: number }>

        const existing = new Set(rows.map(r => r.chapter_number))
        const gaps: number[] = []

        for (let i = 1; i <= totalChapters; i++) {
            if (!existing.has(i)) {
                gaps.push(i)
            }
        }

        return gaps
    }

    /** 批量更新排序序号 */
    static updateSortOrder(orders: Array<{ chapterNumber: number; sortOrder: number }>): void {
        const db = getProjectDb()
        if (!db) throw new Error('[BlueprintRepository] 数据库未连接，无法更新排序')

        const stmt = db.prepare(
            'UPDATE blueprints SET sort_order = ?, updated_at = datetime(\'now\') WHERE chapter_number = ?'
        )

        const tx = db.transaction(() => {
            for (const { chapterNumber, sortOrder } of orders) {
                stmt.run(sortOrder, chapterNumber)
            }
        })
        tx()
    }

    /** 批量更新优先级 */
    static updatePriority(chapterNumber: number, priority: number): void {
        const db = getProjectDb()
        if (!db) throw new Error('[BlueprintRepository] 数据库未连接，无法更新优先级')

        db.prepare(
            'UPDATE blueprints SET priority = ?, updated_at = datetime(\'now\') WHERE chapter_number = ?'
        ).run(priority, chapterNumber)
    }

    /** 批量更新多个蓝图优先级 */
    static updatePriorityBatch(items: Array<{ chapterNumber: number; priority: number }>): void {
        const db = getProjectDb()
        if (!db) throw new Error('[BlueprintRepository] 数据库未连接，无法批量更新优先级')

        const stmt = db.prepare(
            'UPDATE blueprints SET priority = ?, updated_at = datetime(\'now\') WHERE chapter_number = ?'
        )

        const tx = db.transaction(() => {
            for (const { chapterNumber, priority } of items) {
                stmt.run(priority, chapterNumber)
            }
        })
        tx()
    }

    /** 获取单个蓝图 */
    static getByChapter(chapterNumber: number): BlueprintData | null {
        const db = getProjectDb()
        if (!db) return null

        const row = db.prepare(
            'SELECT * FROM blueprints WHERE chapter_number = ?'
        ).get(chapterNumber) as BlueprintRow | undefined

        return row ? rowToData(row) : null
    }

    /** 获取蓝图总数 */
    static count(): number {
        const db = getProjectDb()
        if (!db) return 0

        const row = db.prepare(
            'SELECT COUNT(*) as cnt FROM blueprints'
        ).get() as { cnt: number }

        return row.cnt
    }

    /** 插入或更新蓝图 */
    static upsert(data: BlueprintData): void {
        const db = getProjectDb()
        if (!db) throw new Error('[BlueprintRepository] 数据库未连接，无法保存蓝图')

        db.prepare(`
      INSERT INTO blueprints (
        chapter_number, title, role, purpose, key_events, characters,
        suspense_hook, user_guidance, notes, notes_updated_at,
        sort_order, priority
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chapter_number) DO UPDATE SET
        title = excluded.title,
        role = excluded.role,
        purpose = excluded.purpose,
        key_events = excluded.key_events,
        characters = excluded.characters,
        suspense_hook = excluded.suspense_hook,
        user_guidance = excluded.user_guidance,
        notes = excluded.notes,
        notes_updated_at = excluded.notes_updated_at,
        sort_order = excluded.sort_order,
        priority = excluded.priority,
        updated_at = datetime('now')
    `).run(
            data.chapterNumber,
            data.title,
            data.role,
            data.purpose,
            data.keyEvents,
            JSON.stringify(data.characters),
            data.suspenseHook,
            data.userGuidance,
            data.notes,
            data.notesUpdatedAt,
            data.sortOrder ?? 0,
            data.priority ?? 0,
        )
    }

    /** 批量插入/更新蓝图（事务） */
    static upsertMany(items: BlueprintData[]): void {
        const db = getProjectDb()
        if (!db) throw new Error('[BlueprintRepository] 数据库未连接，无法批量保存蓝图')

        const tx = db.transaction(() => {
            for (const item of items) {
                BlueprintRepository.upsert(item)
            }
        })
        tx()
    }

    /** 删除蓝图 */
    static delete(chapterNumber: number): void {
        const db = getProjectDb()
        if (!db) throw new Error('[BlueprintRepository] 数据库未连接，无法删除蓝图')

        db.prepare('DELETE FROM blueprints WHERE chapter_number = ?').run(chapterNumber)
    }

    /** 仅更新 notes 字段 */
    static updateNotes(chapterNumber: number, notes: string): void {
        const db = getProjectDb()
        if (!db) throw new Error('[BlueprintRepository] 数据库未连接，无法更新蓝图笔记')

        db.prepare(`
      UPDATE blueprints
      SET notes = ?, notes_updated_at = datetime('now'), updated_at = datetime('now')
      WHERE chapter_number = ?
    `).run(notes, chapterNumber)
    }
}
