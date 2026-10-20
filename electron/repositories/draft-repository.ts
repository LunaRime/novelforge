/**
 * DraftRepository — 草稿 (drafts 表 + contents 联动)
 *
 * 草稿是创作栈的主线。status='finalized' 代表定稿。
 * 正文统一存储在 contents 表中，drafts 只持有 content_id 外键。
 */
import { getProjectDb } from '../database'
import { t } from '../../src/shared/locale'
import { ContentRepository } from './content-repository'
import { createHash } from 'node:crypto'

/** 草稿元数据（不含正文，适合列表查询） */
export interface DraftMeta {
    id: number
    chapterNumber: number
    version: number
    status: string
    source: string
    contentId: number
    wordCount: number
    createdAt: number
    updatedAt: number
    contentHash: string
    lastAutoSnapshotAt: number
    branchId: number | null
}

/** 草稿完整数据（含正文） */
export interface DraftFull extends DraftMeta {
    content: string
}

/** DB 行 → DraftMeta */
function rowToMeta(row: Record<string, unknown>): DraftMeta {
    return {
        id: row.id as number,
        chapterNumber: row.chapter_number as number,
        version: row.version as number,
        status: row.status as string,
        source: row.source as string,
        contentId: row.content_id as number,
        wordCount: row.word_count as number,
        createdAt: row.created_at as number,
        updatedAt: row.updated_at as number,
        contentHash: (row.content_hash as string) || '',
        lastAutoSnapshotAt: (row.last_auto_snapshot_at as number) || 0,
        branchId: (row.branch_id as number | null) ?? null,
    }
}

export class DraftRepository {
    /**
     * 创建草稿（先写 contents 再建 draft 记录）
     * 返回新建的 draft ID
     */
    static create(params: {
        chapterNumber: number
        version: number
        source: 'write' | 'rewrite' | 'translation'
        content: string
        wordCount: number
        branchId?: number | null
    }): number {
        const db = getProjectDb()
        if (!db) throw new Error(t('error.repoDbNotConnected').replace('{repo}', '[DraftRepository]'))

        // 事务：先入内容池，再建元数据
        const tx = db.transaction(() => {
            const contentId = ContentRepository.create(params.content)
            const result = db.prepare(`
        INSERT INTO drafts (chapter_number, version, source, content_id, word_count, content_hash, branch_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
                params.chapterNumber,
                params.version,
                params.source,
                contentId,
                params.wordCount,
                createHash('sha256').update(params.content).digest('hex'),
                params.branchId ?? null,
            )
            return Number(result.lastInsertRowid)
        })

        return tx()
    }

    /** 列出章节的所有草稿（不含正文，按版本升序） */
    static listByChapter(chapterNumber: number): DraftMeta[] {
        const db = getProjectDb()
        if (!db) return []

        const rows = db.prepare(`
      SELECT * FROM drafts WHERE chapter_number = ? ORDER BY version ASC
    `).all(chapterNumber) as Record<string, unknown>[]

        return rows.map(rowToMeta)
    }

    /** 获取草稿元数据 */
    static getMeta(id: number): DraftMeta | null {
        const db = getProjectDb()
        if (!db) return null

        const row = db.prepare(
            'SELECT * FROM drafts WHERE id = ?'
        ).get(id) as Record<string, unknown> | undefined

        return row ? rowToMeta(row) : null
    }

    /** 获取草稿完整数据（含正文） — 单次 JOIN 查询替代 N+1 */
    static getFull(id: number): DraftFull | null {
        const db = getProjectDb()
        if (!db) return null

        const row = db.prepare(`
      SELECT d.*, c.body FROM drafts d
      JOIN contents c ON d.content_id = c.id
      WHERE d.id = ?
    `).get(id) as Record<string, unknown> | undefined

        if (!row) return null
        const meta = rowToMeta(row)
        return { ...meta, content: (row.body as string) ?? '' }
    }

    /** 获取章节最新版本的草稿（默认主线；分支传 branchId） */
    static getLatestByChapter(chapterNumber: number, branchId: number | null = null): DraftMeta | null {
        const db = getProjectDb()
        if (!db) return null

        const row = db.prepare(`
      SELECT * FROM drafts
      WHERE chapter_number = ? AND ${branchId === null ? 'branch_id IS NULL' : 'branch_id = ?'}
      ORDER BY version DESC LIMIT 1
    `).get(...(branchId === null ? [chapterNumber] : [chapterNumber, branchId])) as Record<string, unknown> | undefined

        return row ? rowToMeta(row) : null
    }

    /** 获取章节已定稿的草稿 */
    static getFinalizedByChapter(chapterNumber: number): DraftMeta | null {
        const db = getProjectDb()
        if (!db) return null

        const row = db.prepare(`
      SELECT * FROM drafts
      WHERE chapter_number = ? AND status = 'finalized'
      ORDER BY version DESC LIMIT 1
    `).get(chapterNumber) as Record<string, unknown> | undefined

        return row ? rowToMeta(row) : null
    }

    /** 获取下一个可用版本号（默认主线；分支内独立编号） */
    static getNextVersion(chapterNumber: number, branchId: number | null = null): number {
        const db = getProjectDb()
        if (!db) return 1

        const row = db.prepare(`
      SELECT MAX(version) as maxVer FROM drafts
      WHERE chapter_number = ? AND ${branchId === null ? 'branch_id IS NULL' : 'branch_id = ?'}
    `).get(...(branchId === null ? [chapterNumber] : [chapterNumber, branchId])) as { maxVer: number | null }

        return (row.maxVer ?? 0) + 1
    }

    /** 分支内草稿列表 */
    static listByBranch(chapterNumber: number, branchId: number): DraftMeta[] {
        const db = getProjectDb()
        if (!db) return []
        const rows = db.prepare(`
      SELECT * FROM drafts WHERE chapter_number = ? AND branch_id = ? ORDER BY version DESC
    `).all(chapterNumber, branchId) as Record<string, unknown>[]
        return rows.map(rowToMeta)
    }

    /** 获取最大的已定稿章节号，如果没有则返回 0 */
    static getMaxFinalizedChapter(): number {
        const db = getProjectDb()
        if (!db) return 0
        const row = db.prepare(`
            SELECT MAX(chapter_number) as maxChapter
            FROM drafts
            WHERE status = 'finalized'
        `).get() as { maxChapter: number | null }
        return row?.maxChapter ?? 0
    }

    /**
     * D 档自动化：列出全部已定稿章节（chapter_batch 触发器判定用）。
     * 同章多版本时取 version 最大的一条；drafts 表无标题，标题按章号生成。
     */
    static listFinalizedChapters(): Array<{ number: number; title: string; wordCount: number }> {
        const db = getProjectDb()
        if (!db) return []
        const rows = db.prepare(`
            SELECT d.chapter_number AS number, d.word_count AS wordCount
            FROM drafts d
            JOIN (
                SELECT chapter_number, MAX(version) AS v
                FROM drafts WHERE status = 'finalized'
                GROUP BY chapter_number
            ) m ON d.chapter_number = m.chapter_number AND d.version = m.v
            WHERE d.status = 'finalized'
            ORDER BY d.chapter_number ASC
        `).all() as Array<{ number: number; wordCount: number | null }>
        return rows.map(r => ({
            number: r.number,
            title: `第${r.number}章`,
            wordCount: r.wordCount ?? 0,
        }))
    }

    /**
     * D 档 semantic 触发器：已定稿章节的正文，**在主进程侧按上限截断**
     * （避免整篇正文灌进渲染进程；截断策略见 spec §4.4）。
     * 返回 { 章节号: 截断后的正文 }。
     */
    static getFinalizedChapterTexts(truncate: number): Record<number, string> {
        const db = getProjectDb()
        if (!db) return {}
        const rows = db.prepare(`
            SELECT d.chapter_number AS number, c.body AS body
            FROM drafts d
            JOIN contents c ON c.id = d.content_id
            JOIN (
                SELECT chapter_number, MAX(version) AS v
                FROM drafts WHERE status = 'finalized'
                GROUP BY chapter_number
            ) m ON d.chapter_number = m.chapter_number AND d.version = m.v
            WHERE d.status = 'finalized'
            ORDER BY d.chapter_number ASC
        `).all() as Array<{ number: number; body: string | null }>
        const limit = Math.max(0, truncate)
        const out: Record<number, string> = {}
        for (const row of rows) out[row.number] = (row.body ?? '').slice(0, limit)
        return out
    }

    /** 获取所有有草稿的章节号（去重、升序） */
    static getAllChapterNumbers(): number[] {
        const db = getProjectDb()
        if (!db) return []
        const rows = db.prepare(`
            SELECT DISTINCT chapter_number as cn FROM drafts ORDER BY cn ASC
        `).all() as Array<{ cn: number }>
        return rows.map(r => r.cn)
    }

    /** 更新草稿状态 */
    static updateStatus(id: number, status: string, wordCount?: number): void {
        const db = getProjectDb()
        if (!db) return

        if (wordCount !== undefined) {
            db.prepare(`
        UPDATE drafts SET status = ?, word_count = ?, updated_at = unixepoch() * 1000
        WHERE id = ?
      `).run(status, wordCount, id)
        } else {
            db.prepare(`
        UPDATE drafts SET status = ?, updated_at = unixepoch() * 1000
        WHERE id = ?
      `).run(status, id)
        }
    }

    /** 更新草稿正文（事务保护：contents + word_count 原子更新） */
    static updateContent(id: number, content: string, wordCount: number): void {
        const db = getProjectDb()
        if (!db) return

        const meta = DraftRepository.getMeta(id)
        if (!meta) return

        const hash = createHash('sha256').update(content).digest('hex')
        const tx = db.transaction(() => {
            ContentRepository.updateBody(meta.contentId, content)
            db.prepare(`
          UPDATE drafts SET word_count = ?, content_hash = ?, updated_at = unixepoch() * 1000
          WHERE id = ?
        `).run(wordCount, hash, id)
        })
        tx()
    }

    /** CAS 写正文：hash/updated_at 任一不符即 conflict（Agent 编辑用） */
    static applyContentIfUnchanged(
        id: number,
        expectedHash: string,
        expectedUpdatedAt: number,
        content: string,
        wordCount: number,
    ): { ok: boolean; conflict?: boolean; currentHash?: string; currentUpdatedAt?: number } {
        const db = getProjectDb()
        if (!db) return { ok: false }
        const meta = DraftRepository.getMeta(id)
        if (!meta) return { ok: false }

        const tx = db.transaction(() => {
            const current = db.prepare(
                'SELECT content_hash, updated_at FROM drafts WHERE id = ?'
            ).get(id) as { content_hash: string; updated_at: number } | undefined
            if (!current) throw new Error('draft-not-found')
            if ((current.content_hash || '') !== expectedHash || current.updated_at !== expectedUpdatedAt) {
                return { ok: false, conflict: true, currentHash: current.content_hash || '', currentUpdatedAt: current.updated_at }
            }
            const hash = createHash('sha256').update(content).digest('hex')
            ContentRepository.updateBody(meta.contentId, content)
            db.prepare(`
              UPDATE drafts SET word_count = ?, content_hash = ?, updated_at = unixepoch() * 1000
              WHERE id = ?
            `).run(wordCount, hash, id)
            return { ok: true }
        })
        return tx()
    }

    /** 自动快照节流时间（仅主进程调用） */
    static touchAutoSnapshotAt(id: number, at: number): void {
        const db = getProjectDb()
        if (!db) return
        db.prepare('UPDATE drafts SET last_auto_snapshot_at = ? WHERE id = ?').run(at, id)
    }

    /** 删除草稿（级联删除 revisions/reviews，但 contents 需手动清理） */
    static delete(id: number): void {
        const db = getProjectDb()
        if (!db) return

        // ⚠️ P3 修复：两条语句包事务——进程在 DELETE drafts 与 DELETE contents 之间
        //    崩溃会残留孤儿 contents 行
        const tx = db.transaction(() => {
            // 先获取 contentId 以便清理
            const meta = DraftRepository.getMeta(id)
            db.prepare('DELETE FROM drafts WHERE id = ?').run(id)

            // 清理孤立的 content 记录
            if (meta) {
                // 【DB 迁移备注】：如果 contents.id 仍被 revision 或 review 引用，
                // SQLite外键约束会阻止删除（抛出异常）。捕获并吞掉异常是预期的，
                // 这会导致少量不再被草稿引用的内容记录残留，但长期风险极低。
                try { ContentRepository.delete(meta.contentId) } catch { /* 被外键保护 */ }
            }
        })
        tx()
    }
}