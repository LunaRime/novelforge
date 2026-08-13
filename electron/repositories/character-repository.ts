/**
 * CharacterRepository — 角色卡 (characters 表)
 *
 * currentState 子结构已拍平为 cs_* 前缀列，杜绝 JSON 大字段。
 */
import { getProjectDb } from '../database'
import { t } from '../../src/shared/locale'
import { isNoChangeValue } from '../../src/services/character-normalize'

/** 角色卡动态状态 */
export interface CharacterStateData {
    location: string
    powerLevel: string
    physicalState: string
    mentalState: string
    keyItems: string
    recentEvents: string
    updatedAtChapter: number
}

/** 角色卡完整数据（前端驼峰接口） */
export interface CharacterData {
    name: string
    role: string
    gender: string
    age: string
    appearance: string
    personality: string
    background: string
    abilities: string
    motivation: string
    relationships: string
    arc: string
    notes: string
    /** v7: 戏份等级 1=核心 2=配角 3=龙套 */
    tier: number
    /** v7: 标签 JSON 数组 */
    tags: string
    /** v7: 出场章节 JSON 数组 [1,5,10] */
    appearChapters: string
    /** v7: 结构化关系 JSON 数组 */
    relations: string
    /** v14: 别名/称呼注册表 JSON 数组（昵称/称号/曾用名，角色名匹配的变体形态） */
    aliases?: string
    /** v15: 出场章数统计（定稿时维护） */
    appearCount?: number
    /** v15: 首次出场章号（0=未记录） */
    firstChapter?: number
    /** v15: 最近出场章号（0=未记录） */
    lastChapter?: number
    /** v15: 生命周期状态 active=活跃 / departed=退场 / dead=死亡移除（dead 退出关系检测候选） */
    status?: string
    currentState?: CharacterStateData
}

/** 结构化关系条目 */
export interface CharacterRelation {
    target: string
    type: 'ally' | 'enemy' | 'family' | 'master_student' | 'lover' | 'rival' | 'neutral' | 'other'
    label: string
    sinceChapter: number
    endedChapter?: number
}

function rowToData(row: Record<string, unknown>): CharacterData {
    const data: CharacterData = {
        name: row.name as string,
        role: (row.role as string) || 'supporting',
        gender: (row.gender as string) || '',
        age: (row.age as string) || '',
        appearance: (row.appearance as string) || '',
        personality: (row.personality as string) || '',
        background: (row.background as string) || '',
        abilities: (row.abilities as string) || '',
        motivation: (row.motivation as string) || '',
        relationships: (row.relationships as string) || '',
        arc: (row.arc as string) || '',
        notes: (row.notes as string) || '',
        tier: (row.tier as number) ?? 2,
        tags: (row.tags as string) || '',
        appearChapters: (row.appear_chapters as string) || '[]',
        relations: (row.relations as string) || '[]',
        aliases: (row.aliases as string) || '[]',
        appearCount: (row.appear_count as number) || 0,
        firstChapter: (row.first_chapter as number) || 0,
        lastChapter: (row.last_chapter as number) || 0,
        status: (row.status as string) || 'active',
    }

    // 构建 currentState：任一 cs_ 字段非空即构建（P1 修复——此前仅 cs_updated_at_chapter > 0，
    //    而 UI 状态编辑器不提供 updatedAtChapter 输入：从未定稿过的角色（=0）编辑
    //    location/recentEvents 保存后整个状态被读端丢弃，编辑内容凭空消失）
    const updatedChapter = (row.cs_updated_at_chapter as number) || 0
    const stateFields = [
        row.cs_location, row.cs_power_level, row.cs_physical_state,
        row.cs_mental_state, row.cs_key_items, row.cs_recent_events,
    ]
    if (stateFields.some(v => typeof v === 'string' && (v as string).trim() !== '')) {
        data.currentState = {
            location: (row.cs_location as string) || '',
            powerLevel: (row.cs_power_level as string) || '',
            physicalState: (row.cs_physical_state as string) || '',
            mentalState: (row.cs_mental_state as string) || '',
            keyItems: (row.cs_key_items as string) || '',
            recentEvents: (row.cs_recent_events as string) || '',
            updatedAtChapter: updatedChapter,
        }
    }

    return data
}

export class CharacterRepository {
    /** 获取所有角色（按戏份核心度排序：主角→反派→配角→龙套，与 tier 分级一致） */
    static getAll(): CharacterData[] {
        const db = getProjectDb()
        if (!db) return []

        const rows = db.prepare(`
      SELECT * FROM characters
      ORDER BY
        CASE role
          WHEN 'protagonist' THEN 0
          WHEN 'antagonist' THEN 1
          WHEN 'supporting' THEN 2
          WHEN 'minor' THEN 3
          ELSE 9
        END ASC
    `).all() as Record<string, unknown>[]

        return rows.map(rowToData)
    }

    /** 获取单个角色 */
    static getByName(name: string): CharacterData | null {
        const db = getProjectDb()
        if (!db) return null

        const row = db.prepare(
            'SELECT * FROM characters WHERE name = ?'
        ).get(name) as Record<string, unknown> | undefined

        return row ? rowToData(row) : null
    }

    /** 获取角色数量 */
    static count(): number {
        const db = getProjectDb()
        if (!db) return 0

        const row = db.prepare(
            'SELECT COUNT(*) as cnt FROM characters'
        ).get() as { cnt: number }

        return row.cnt
    }

    /** 插入或更新角色 */
    static upsert(data: CharacterData): void {
        const db = getProjectDb()
        if (!db) throw new Error(t('error.repoCharacterCannotSave').replace('{repo}', '[CharacterRepository]'))

        const cs = data.currentState
        db.prepare(`
      INSERT INTO characters (
        name, role, gender, age, appearance, personality, background,
        abilities, motivation, relationships, arc, notes,
        tier, tags, appear_chapters, relations, aliases,
        appear_count, first_chapter, last_chapter, status,
        cs_location, cs_power_level, cs_physical_state, cs_mental_state,
        cs_key_items, cs_recent_events, cs_updated_at_chapter
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        role = excluded.role,
        gender = excluded.gender,
        age = excluded.age,
        appearance = excluded.appearance,
        personality = excluded.personality,
        background = excluded.background,
        abilities = excluded.abilities,
        motivation = excluded.motivation,
        relationships = excluded.relationships,
        arc = excluded.arc,
        notes = excluded.notes,
        tier = excluded.tier,
        tags = excluded.tags,
        appear_chapters = excluded.appear_chapters,
        relations = excluded.relations,
        aliases = excluded.aliases,
        appear_count = excluded.appear_count,
        first_chapter = excluded.first_chapter,
        last_chapter = excluded.last_chapter,
        status = excluded.status,
        cs_location = excluded.cs_location,
        cs_power_level = excluded.cs_power_level,
        cs_physical_state = excluded.cs_physical_state,
        cs_mental_state = excluded.cs_mental_state,
        cs_key_items = excluded.cs_key_items,
        cs_recent_events = excluded.cs_recent_events,
        cs_updated_at_chapter = excluded.cs_updated_at_chapter,
        updated_at = unixepoch() * 1000
    `).run(
            data.name,
            data.role,
            data.gender,
            data.age,
            data.appearance,
            data.personality,
            data.background,
            data.abilities,
            data.motivation,
            data.relationships,
            data.arc,
            data.notes,
            data.tier ?? (data.role === 'protagonist' || data.role === 'antagonist' ? 1 : 2),
            data.tags || '',
            data.appearChapters || '[]',
            data.relations || '[]',
            data.aliases || '[]',
            data.appearCount || 0,
            data.firstChapter || 0,
            data.lastChapter || 0,
            data.status || 'active',
            cs?.location ?? '',
            cs?.powerLevel ?? '',
            cs?.physicalState ?? '',
            cs?.mentalState ?? '',
            cs?.keyItems ?? '',
            cs?.recentEvents ?? '',
            cs?.updatedAtChapter ?? 0,
        )
    }

    /** 批量保存角色（事务） */
    static saveAll(characters: CharacterData[]): void {
        const db = getProjectDb()
        if (!db) throw new Error(t('error.repoCharacterCannotSaveCard').replace('{repo}', '[CharacterRepository]'))

        const tx = db.transaction(() => {
            for (const char of characters) {
                CharacterRepository.upsert(char)
            }
        })
        tx()
    }

    /** 删除角色 */
    static delete(name: string): void {
        const db = getProjectDb()
        if (!db) throw new Error(t('error.repoCharacterCannotDelete').replace('{repo}', '[CharacterRepository]'))

        db.prepare('DELETE FROM characters WHERE name = ?').run(name)
    }

    /**
     * 仅更新角色动态状态（后处理时使用）。
     * ⚠️ 哨兵合并语义（写时刻以 DB 当前值为基准）：cs_* 六字段空值/哨兵
     * （'' 或 null）不覆盖已有值（CASE WHEN 保旧列）——调用端不再需要读快照合并，
     * 消除并发定稿/LLM 调用期间慢工作流用旧快照覆盖新状态、以及手动编辑被覆盖的竞态。
     * @param extra 可选的结构化字段更新——tags（JSON 数组字符串）/ motivation；
     *              undefined 或 null 时不覆盖该列（COALESCE 保旧值）
     */
    static updateState(
        name: string,
        state: CharacterStateData,
        extra?: { tags?: string | null; motivation?: string | null },
    ): void {
        const db = getProjectDb()
        if (!db) throw new Error(t('error.repoCharacterCannotUpdateStatus').replace('{repo}', '[CharacterRepository]'))

        db.prepare(`
      UPDATE characters SET
        cs_location = CASE WHEN ? != '' THEN ? ELSE cs_location END,
        cs_power_level = CASE WHEN ? != '' THEN ? ELSE cs_power_level END,
        cs_physical_state = CASE WHEN ? != '' THEN ? ELSE cs_physical_state END,
        cs_mental_state = CASE WHEN ? != '' THEN ? ELSE cs_mental_state END,
        cs_key_items = CASE WHEN ? != '' THEN ? ELSE cs_key_items END,
        cs_recent_events = CASE WHEN ? != '' THEN ? ELSE cs_recent_events END,
        cs_updated_at_chapter = ?,
        tags = COALESCE(?, tags),
        motivation = COALESCE(?, motivation),
        updated_at = unixepoch() * 1000
      WHERE name = ?
    `).run(
            state.location, state.location,
            state.powerLevel, state.powerLevel,
            state.physicalState, state.physicalState,
            state.mentalState, state.mentalState,
            state.keyItems, state.keyItems,
            state.recentEvents, state.recentEvents,
            state.updatedAtChapter,
            extra?.tags ?? null,
            extra?.motivation ?? null,
            name,
        )
    }

    /**
     * 仅填充空白(写时刻保旧):DB 中已有非空值的档案字段一律保留,只填充空白字段
     * （以 DB 当前值为基准——LLM 提取结果只补全、不覆盖用户手写内容,
     * 与 updateState 的新值优先语义相反,勿混用）；tags 同规则保旧;
     * 不触碰 role/tier/currentState。
     * 哨兵语义:DB 值空或哨兵('无'/'none'/'无变化' 等变体,见 isNoChangeValue)
     * 一律视为空白才填充——存量哨兵值(beta.2 前历史写入或用户手输)不再堵住
     * LLM 提取结果写入(纯 CASE WHEN != '' 只能挡空串,挡不住哨兵)。
     */
    static mergeFields(name: string, fields: Record<string, string>): void {
        const db = getProjectDb()
        if (!db) throw new Error(t('error.repoCharacterCannotUpdateStatus').replace('{repo}', '[CharacterRepository]'))
        // 预读该行 DB 值,哨兵视为空白(需要填充的字段才写;列名来自硬编码白名单,无注入面)
        const row = db.prepare(
            'SELECT gender, age, appearance, personality, background, abilities, motivation, relationships, arc, notes, tags FROM characters WHERE name = ?'
        ).get(name) as Record<string, unknown> | undefined
        if (!row) return
        const cols = ['gender', 'age', 'appearance', 'personality', 'background', 'abilities', 'motivation', 'relationships', 'arc', 'notes']
        const updates: Record<string, string> = {}
        for (const c of cols) {
            const dbVal = String(row[c] ?? '').trim()
            const newVal = String(fields[c] ?? '').trim()
            if ((dbVal === '' || isNoChangeValue(dbVal)) && newVal !== '' && !isNoChangeValue(newVal)) {
                updates[c] = newVal
            }
        }
        const dbTags = String(row.tags ?? '').trim()
        const newTags = String(fields.tags ?? '').trim()
        if ((dbTags === '' || isNoChangeValue(dbTags)) && newTags && !isNoChangeValue(newTags)) updates.tags = newTags
        if (Object.keys(updates).length === 0) return
        const setClauses: string[] = []
        const params: unknown[] = []
        for (const [k, v] of Object.entries(updates)) {
            setClauses.push(`${k} = ?`)
            params.push(v)
        }
        setClauses.push('updated_at = unixepoch() * 1000')
        db.prepare(`UPDATE characters SET ${setClauses.join(', ')} WHERE name = ?`).run(...params, name)
    }

    /**
     * 用户合并角色（P1-6）：把 source 合并进 target，事务执行后删除 source。
     *
     * 合并语义（全部以 DB 当前值为基准）：
     * - 档案文本字段：target 空白/哨兵 → 用 source 值（非空保旧，与 mergeFields 一致）
     * - tags：并集去重（上限 8）
     * - appearChapters：并集升序；appearCount 相加；firstChapter 取更早；lastChapter 取更晚
     * - role/tier：取更核心（protagonist > antagonist > supporting > minor）
     * - relations：source 指向 target 的条目丢弃（自身无意义）；source 指向其他角色的条目
     *   并入 target（已有同目标条目保留 sinceChapter 更早者）；全库其他角色指向 source 的
     *   条目重定向为 target 并去重
     * - currentState：target cs_* 空白 → 用 source 值；updatedAtChapter 取更晚
     * - status/aliases：保留 target（用户显式管理；别名不自动并入，避免误合并）
     */
    static mergeCharacters(targetName: string, sourceName: string): void {
        const db = getProjectDb()
        if (!db) throw new Error(t('error.repoCharacterCannotUpdateStatus').replace('{repo}', '[CharacterRepository]'))
        if (!targetName || !sourceName || targetName === sourceName) {
            throw new Error(t('error.repoCharacterMergeSelf'))
        }

        const tx = db.transaction(() => {
            const target = db.prepare('SELECT * FROM characters WHERE name = ?').get(targetName) as Record<string, unknown> | undefined
            const source = db.prepare('SELECT * FROM characters WHERE name = ?').get(sourceName) as Record<string, unknown> | undefined
            if (!target) throw new Error(t('error.repoCharacterMergeTargetMissing').replace('{name}', targetName))
            if (!source) throw new Error(t('error.repoCharacterMergeSourceMissing').replace('{name}', sourceName))

            const updates: Record<string, unknown> = {}

            // 1. 档案文本字段：target 空白/哨兵 → source 值
            const textCols = ['gender', 'age', 'appearance', 'personality', 'background', 'abilities', 'motivation', 'relationships', 'arc', 'notes']
            for (const col of textCols) {
                const tv = String(target[col] ?? '').trim()
                const sv = String(source[col] ?? '').trim()
                if ((tv === '' || isNoChangeValue(tv)) && sv !== '' && !isNoChangeValue(sv)) updates[col] = sv
            }

            // 2. tags 并集
            const mergedTags = [...new Set([...parseStringArray(target.tags), ...parseStringArray(source.tags)])].slice(0, 8)
            updates.tags = mergedTags.length > 0 ? JSON.stringify(mergedTags) : ''

            // 3. 出场数据并集 + 统计
            const mergedChaps = [...new Set([...parseJsonArray(target.appear_chapters), ...parseJsonArray(source.appear_chapters)])].sort((a, b) => a - b)
            updates.appear_chapters = JSON.stringify(mergedChaps)
            updates.appear_count = (Number(target.appear_count) || 0) + (Number(source.appear_count) || 0)
            const tFirst = Number(target.first_chapter) || 0
            const sFirst = Number(source.first_chapter) || 0
            updates.first_chapter = tFirst === 0 ? sFirst : (sFirst === 0 ? tFirst : Math.min(tFirst, sFirst))
            updates.last_chapter = Math.max(Number(target.last_chapter) || 0, Number(source.last_chapter) || 0)

            // 4. role/tier：取更核心
            const ROLE_ORDER: Record<string, number> = { protagonist: 0, antagonist: 1, supporting: 2, minor: 3 }
            const tRole = String(target.role || 'supporting')
            const sRole = String(source.role || 'supporting')
            if ((ROLE_ORDER[tRole] ?? 9) > (ROLE_ORDER[sRole] ?? 9)) updates.role = sRole
            updates.tier = Math.min(Number(target.tier) || 2, Number(source.tier) || 2)

            // 5. relations 合并
            const targetRels = parseRelations(target.relations)
            const sourceRels = parseRelations(source.relations)
            for (const r of sourceRels) {
                if (r.target === targetName) continue // source 指向 target → 自身，丢弃
                const existing = targetRels.find(x => x.target === r.target)
                if (existing) {
                    // sinceChapter 取更早；label/type 保留 target 的（用户维护优先）
                    if ((existing.sinceChapter === undefined || existing.sinceChapter === 0) && r.sinceChapter) existing.sinceChapter = r.sinceChapter
                } else {
                    targetRels.push({ ...r })
                }
            }
            updates.relations = JSON.stringify(targetRels)

            // 6. currentState：target 空白 → source 值；updatedAtChapter 取更晚
            for (const col of ['cs_location', 'cs_power_level', 'cs_physical_state', 'cs_mental_state', 'cs_key_items', 'cs_recent_events']) {
                if (!String(target[col] ?? '').trim() && String(source[col] ?? '').trim()) updates[col] = source[col]
            }
            updates.cs_updated_at_chapter = Math.max(Number(target.cs_updated_at_chapter) || 0, Number(source.cs_updated_at_chapter) || 0)

            // 7. 全库重定向：其他角色 relations 中指向 source → target（去重）
            const others = db.prepare('SELECT name, relations FROM characters WHERE name != ?').all(targetName) as Array<{ name: string; relations: string }>
            for (const row of others) {
                const rels = parseRelations(row.relations)
                let changed = false
                for (const r of rels) {
                    if (r.target === sourceName) {
                        r.target = targetName
                        changed = true
                    }
                }
                if (changed) {
                    // 重定向后去重（同目标多条只留一条，sinceChapter 取更早）
                    const seen = new Map<string, CharacterRelation>()
                    for (const r of rels) {
                        const prev = seen.get(r.target)
                        if (!prev) {
                            seen.set(r.target, r)
                        } else if ((prev.sinceChapter === undefined || prev.sinceChapter === 0) && r.sinceChapter) {
                            seen.set(r.target, r)
                        }
                    }
                    db.prepare('UPDATE characters SET relations = ? WHERE name = ?').run(JSON.stringify([...seen.values()]), row.name)
                }
            }

            // 8. 写回 target + 删除 source
            const setClauses: string[] = []
            const params: unknown[] = []
            for (const [k, v] of Object.entries(updates)) {
                setClauses.push(`${k} = ?`)
                params.push(v)
            }
            if (setClauses.length > 0) {
                setClauses.push('updated_at = unixepoch() * 1000')
                db.prepare(`UPDATE characters SET ${setClauses.join(', ')} WHERE name = ?`).run(...params, targetName)
            }
            db.prepare('DELETE FROM characters WHERE name = ?').run(sourceName)
        })
        tx()
    }
}

/** 容错解析 JSON 数字数组（appearChapters/出场统计） */
function parseJsonArray(raw: unknown): number[] {
    try {
        const arr = JSON.parse(String(raw ?? '[]'))
        return Array.isArray(arr) ? arr.filter((n: unknown) => typeof n === 'number' && Number.isFinite(n)) : []
    } catch {
        return []
    }
}

/** 容错解析 JSON 字符串数组（tags 等） */
function parseStringArray(raw: unknown): string[] {
    try {
        const arr = JSON.parse(String(raw ?? '[]'))
        return Array.isArray(arr)
            ? arr.map(String).map(s => s.trim()).filter(Boolean)
            : []
    } catch {
        return []
    }
}

/** 容错解析结构化关系 JSON */
function parseRelations(raw: unknown): CharacterRelation[] {
    try {
        const arr = JSON.parse(String(raw ?? '[]'))
        return Array.isArray(arr)
            ? arr.filter((r): r is CharacterRelation => !!r && typeof r === 'object' && typeof (r as CharacterRelation).target === 'string')
            : []
    } catch {
        return []
    }
}
