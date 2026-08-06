/**
 * ProjectCoreRepository — 项目主台账 (project_core 表)
 *
 * 合并 NovelConfig + 架构四大件的统一读写。
 * 始终只有一行数据 (id = 'main')。
 */
import { getProjectDb } from '../database'
import { logger } from '../utils/logger'
import { t } from '../../src/shared/locale'

/** project_core 表行类型
 * 注意：premise/worldbuilding/characters_arch/synopsis 已在 v6 迁移中 DROP，
 * 大文本存储于 project_archives，此处不再声明（兼容访问见 rowToData）。
 */
export interface ProjectCoreRow {
    id: string
    project_name: string
    genre: string
    sub_genre: string
    target_audience: string
    total_chapters: number
    words_per_chapter: number
    plot_structure: string
    narrative_pov: string
    writing_style: string
    reference_works: string
    global_guidance: string
    golden_finger: string
    character_states: string
    created_at: number
    updated_at: number
}

/** 前端使用的驼峰命名接口 */
export interface ProjectCoreData {
    projectName: string
    genre: string
    subGenre: string
    targetAudience: string
    totalChapters: number
    wordsPerChapter: number
    plotStructure: string
    narrativePov: string
    writingStyle: string
    referenceWorks: string
    globalGuidance: string
    goldenFinger: string
    premise: string
    worldbuilding: string
    charactersArch: string
    synopsis: string
    characterStates: string
    createdAt: number
    updatedAt: number
}

/** 数据库行 → 前端数据 */
function rowToData(row: ProjectCoreRow): ProjectCoreData {
    const db = getProjectDb()

    /** 读取大文本字段：优先从 project_archives，回退到 project_core 列（兼容 v5 及以前） */
    const readArchiveOrColumn = (archiveKey: string, columnValue: string | null): string => {
        // 优先读 project_archives（v6+ 数据存储位置）
        if (db) {
            try {
                const archiveRow = db.prepare(
                    'SELECT body FROM project_archives WHERE project_id = ? AND field_key = ?'
                ).get('main', archiveKey) as { body: string } | undefined
                if (archiveRow?.body) return archiveRow.body
            } catch { /* 表可能尚不存在 */ }
        }
        // 回退到 project_core 列（v5 及以前，列尚未被 DROP）
        return columnValue ?? ''
    }

    // 兼容访问：SELECT * 已不含被 DROP 的归档列，用 Record 类型访问避免类型断言污染
    const legacyRow = row as unknown as Record<string, string | null | undefined>

    return {
        projectName: row.project_name,
        genre: row.genre,
        subGenre: row.sub_genre,
        targetAudience: row.target_audience,
        totalChapters: row.total_chapters,
        wordsPerChapter: row.words_per_chapter,
        plotStructure: row.plot_structure,
        narrativePov: row.narrative_pov,
        writingStyle: row.writing_style,
        referenceWorks: row.reference_works,
        globalGuidance: row.global_guidance,
        goldenFinger: row.golden_finger,
        premise: readArchiveOrColumn('premise', legacyRow.premise ?? null),
        worldbuilding: readArchiveOrColumn('worldbuilding', legacyRow.worldbuilding ?? null),
        charactersArch: readArchiveOrColumn('characters_arch', legacyRow.characters_arch ?? null),
        synopsis: readArchiveOrColumn('synopsis', legacyRow.synopsis ?? null),
        characterStates: row.character_states,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }
}

export class ProjectCoreRepository {
    /** 获取项目配置（不存在则返回 null） */
    static get(): ProjectCoreData | null {
        const db = getProjectDb()
        if (!db) return null

        const row = db.prepare(
            'SELECT * FROM project_core WHERE id = ?'
        ).get('main') as ProjectCoreRow | undefined

        return row ? rowToData(row) : null
    }

    /** 初始化项目配置（创建项目时调用） */
    static init(projectName: string): void {
        const db = getProjectDb()
        if (!db) return

        db.prepare(`
      INSERT OR IGNORE INTO project_core (id, project_name)
      VALUES ('main', ?)
    `).run(projectName)
    }

    /** 更新项目配置（传入部分字段即可） */
    static update(data: Partial<ProjectCoreData>): void {
        const db = getProjectDb()
        if (!db) {
            logger.error('ProjectCore', t('log.projectCore.dbNotConnected'))
            throw new Error('项目数据库未连接，请关闭项目后重新打开')
        }

        // ★ v6 修复：大文本字段写 project_archives，其余字段写 project_core
        //    v6 迁移已将 premise/worldbuilding/characters_arch/synopsis 从 project_core DROP，
        //    再次 UPDATE 会因列不存在而静默失败 → 导致配置保存无效、重启丢失。
        const archiveFieldKeys: Array<{ camel: string; archiveKey: string }> = [
            { camel: 'premise', archiveKey: 'premise' },
            { camel: 'worldbuilding', archiveKey: 'worldbuilding' },
            { camel: 'charactersArch', archiveKey: 'characters_arch' },
            { camel: 'synopsis', archiveKey: 'synopsis' },
        ]

        // 分离：archive 字段 → setArchiveField，其余 → UPDATE project_core
        const coreData: Partial<ProjectCoreData> = {}
        for (const key of Object.keys(data) as Array<keyof ProjectCoreData>) {
            const isArchive = archiveFieldKeys.some(a => a.camel === key)
            if (isArchive && (data as Record<string, unknown>)[key] !== undefined) {
                const archiveKey = archiveFieldKeys.find(a => a.camel === key)!.archiveKey
                ProjectCoreRepository.setArchiveField(archiveKey, String((data as Record<string, unknown>)[key]))
            } else {
                (coreData as Record<string, unknown>)[key] = (data as Record<string, unknown>)[key]
            }
        }

        // 写入 project_core（仅非归档字段）
        const fieldMap: Record<string, string> = {
            projectName: 'project_name',
            genre: 'genre',
            subGenre: 'sub_genre',
            targetAudience: 'target_audience',
            totalChapters: 'total_chapters',
            wordsPerChapter: 'words_per_chapter',
            plotStructure: 'plot_structure',
            narrativePov: 'narrative_pov',
            writingStyle: 'writing_style',
            referenceWorks: 'reference_works',
            globalGuidance: 'global_guidance',
            goldenFinger: 'golden_finger',
            characterStates: 'character_states',
        }

        const setClauses: string[] = []
        const values: unknown[] = []

        for (const [camel, col] of Object.entries(fieldMap)) {
            if (camel in coreData) {
                setClauses.push(`${col} = ?`)
                values.push((coreData as Record<string, unknown>)[camel])
            }
        }

        if (setClauses.length > 0) {
            setClauses.push("updated_at = unixepoch() * 1000")
            values.push('main')

            db.prepare(
                `UPDATE project_core SET ${setClauses.join(', ')} WHERE id = ?`
            ).run(...values)
        }
    }

    // ===== project_archives 大文本字段读写（v4 schema） =====

    /** 根据 key 读取存档字段（premise / worldbuilding / characters_arch / synopsis） */
    static getArchiveField(key: string): string | null {
        const db = getProjectDb()
        if (!db) return null

        try {
            const row = db.prepare(`
        SELECT body FROM project_archives WHERE project_id = 'main' AND field_key = ?
      `).get(key) as { body: string } | undefined
            return row?.body ?? null
        } catch {
            return null
        }
    }

    /** 写入存档字段 */
    static setArchiveField(key: string, body: string): void {
        const db = getProjectDb()
        if (!db) return

        const id = `main_${key}`
        try {
            db.prepare(`
        INSERT INTO project_archives (id, project_id, field_key, body, updated_at)
        VALUES (?, 'main', ?, ?, unixepoch() * 1000)
        ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = unixepoch() * 1000
      `).run(id, key, body)
        } catch (error) {
            logger.error('ProjectCore', t('log.projectCore.archiveSetFailed').replace('{key}', key).replace('{err}', String(error)))
            throw error
        }
    }
}
