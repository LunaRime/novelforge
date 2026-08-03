/**
 * VolumeRepository — 分卷 (volumes 表)
 *
 * 长篇小说按卷组织章节：卷号唯一（1-based），chapter_start/end 为含边界
 * （第一卷 第 1-20 章 → start=1, end=20；end=0 表示未定/进行中）。
 */
import { getProjectDb } from '../database'

/** 分卷数据（前端驼峰接口） */
export interface VolumeData {
    id?: number
    /** 卷号（1-based，唯一） */
    volumeNumber: number
    /** 卷标题（如「风起青萍」） */
    title: string
    description: string
    /** 起始章节（含） */
    chapterStart: number
    /** 结束章节（含；0 = 未定/进行中） */
    chapterEnd: number
}

export class VolumeRepository {
    /** 获取全部分卷（按卷号升序） */
    static getAll(): VolumeData[] {
        const db = getProjectDb()
        if (!db) return []

        const rows = db.prepare(
            'SELECT * FROM volumes ORDER BY volume_number ASC'
        ).all() as Record<string, unknown>[]

        return rows.map(rowToData)
    }

    /** 获取单个分卷 */
    static getByNumber(volumeNumber: number): VolumeData | null {
        const db = getProjectDb()
        if (!db) return null

        const row = db.prepare(
            'SELECT * FROM volumes WHERE volume_number = ?'
        ).get(volumeNumber) as Record<string, unknown> | undefined

        return row ? rowToData(row) : null
    }

    /** 查询章节所属分卷（含边界匹配；无匹配返回 null） */
    static getByChapter(chapterNumber: number): VolumeData | null {
        const db = getProjectDb()
        if (!db) return null

        const row = db.prepare(`
            SELECT * FROM volumes
            WHERE chapter_start <= ? AND (? <= chapter_end OR chapter_end = 0)
            ORDER BY volume_number ASC LIMIT 1
        `).get(chapterNumber, chapterNumber) as Record<string, unknown> | undefined

        return row ? rowToData(row) : null
    }

    /** 插入或更新分卷（卷号唯一；冲突时按卷号更新） */
    static upsert(data: VolumeData): void {
        const db = getProjectDb()
        if (!db) throw new Error('[VolumeRepository] 数据库未连接，无法保存分卷')

        db.prepare(`
            INSERT INTO volumes (volume_number, title, description, chapter_start, chapter_end, updated_at)
            VALUES (?, ?, ?, ?, ?, unixepoch() * 1000)
            ON CONFLICT(volume_number) DO UPDATE SET
                title = excluded.title,
                description = excluded.description,
                chapter_start = excluded.chapter_start,
                chapter_end = excluded.chapter_end,
                updated_at = unixepoch() * 1000
        `).run(
            data.volumeNumber,
            data.title || '',
            data.description || '',
            data.chapterStart || 0,
            data.chapterEnd || 0,
        )
    }

    /** 删除分卷 */
    static delete(volumeNumber: number): void {
        const db = getProjectDb()
        if (!db) throw new Error('[VolumeRepository] 数据库未连接，无法删除分卷')

        db.prepare('DELETE FROM volumes WHERE volume_number = ?').run(volumeNumber)
    }
}

function rowToData(row: Record<string, unknown>): VolumeData {
    return {
        id: row.id as number,
        volumeNumber: row.volume_number as number,
        title: (row.title as string) || '',
        description: (row.description as string) || '',
        chapterStart: (row.chapter_start as number) || 0,
        chapterEnd: (row.chapter_end as number) || 0,
    }
}
