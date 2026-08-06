/**
 * PreferenceRepository — 偏好记忆 (preferences 表)
 *
 * 记录"用户把 AI 文本的 X 改成 Y"的替换对：同对累加 count（反映偏好强度），
 * last_chapter 记录最近一次出现的章节（供"近因偏好"排序）。
 */
import { getProjectDb } from '../database'

/** 偏好替换对 */
export interface PreferenceData {
    id?: number
    /** AI 原文（用户不喜欢的表达） */
    aiText: string
    /** 用户替换后的文本（用户偏好） */
    userText: string
    /** 累计出现次数（偏好强度） */
    count: number
    /** 最近一次出现章节（近因） */
    lastChapter?: number
}

export class PreferenceRepository {
    /** 记录一个替换对（存在则 count+1 并更新 lastChapter） */
    static record(aiText: string, userText: string, chapterNumber?: number): void {
        const db = getProjectDb()
        if (!db) return
        const ai = (aiText || '').trim()
        const usr = (userText || '').trim()
        if (!ai || !usr || ai === usr) return

        db.prepare(`
            INSERT INTO preferences (ai_text, user_text, count, last_chapter, updated_at)
            VALUES (?, ?, 1, ?, unixepoch() * 1000)
            ON CONFLICT(ai_text, user_text) DO UPDATE SET
                count = count + 1,
                last_chapter = excluded.last_chapter,
                updated_at = unixepoch() * 1000
        `).run(ai, usr, chapterNumber ?? 0)
    }

    /** 获取 Top 偏好（按次数降序；可选仅最近 N 章内出现过） */
    static getTop(limit: number = 5, recentChapters?: number): PreferenceData[] {
        const db = getProjectDb()
        if (!db) return []

        const rows = recentChapters && recentChapters > 0
            ? db.prepare(`
                SELECT * FROM preferences
                WHERE last_chapter >= ?
                ORDER BY count DESC, updated_at DESC, id DESC
                LIMIT ?
            `).all(recentChapters, limit) as Record<string, unknown>[]
            : db.prepare(`
                SELECT * FROM preferences
                ORDER BY count DESC, updated_at DESC, id DESC
                LIMIT ?
            `).all(limit) as Record<string, unknown>[]

        return rows.map(rowToData)
    }
}

function rowToData(row: Record<string, unknown>): PreferenceData {
    return {
        id: row.id as number,
        aiText: (row.ai_text as string) || '',
        userText: (row.user_text as string) || '',
        count: (row.count as number) || 1,
        lastChapter: (row.last_chapter as number) || 0,
    }
}
