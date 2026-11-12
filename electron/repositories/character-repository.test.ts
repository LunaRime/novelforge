/**
 * CharacterRepository.updateState 单元测试 — mock getProjectDb 用内存 DB 验证 SQL 逻辑
 *
 * 核心验证：哨兵合并下沉后（CASE WHEN 保旧值），并发定稿/慢工作流的旧快照空值
 * 不会覆盖 DB 中较新的真实状态（此前渲染进程内合并存在读快照竞态）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { CharacterRepository, type CharacterData } from './character-repository'
import { readCharacterEditSnapshot, commitDatabaseCharacterEdits, mergeDatabaseCharacterCards, mergeDatabaseDuplicateCharacters } from '../services/character-edits-service'

// mock database 模块（避免加载 electron 依赖与原生模块 ABI 冲突）
vi.mock('../database', () => ({
  getProjectDb: () => (globalThis as unknown as { __testDb: DatabaseSync }).__testDb,
  getCurrentProjectPath: () => '/book',
}))

let db: DatabaseSync

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  Object.assign(db, { transaction: <T>(work: () => T) => () => {
    db.exec('BEGIN')
    try {
      const result = work()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  } })
  db.exec(`
    CREATE TABLE characters (
      name TEXT PRIMARY KEY,
      uid TEXT,
      role TEXT DEFAULT 'supporting',
      gender TEXT DEFAULT '',
      age TEXT DEFAULT '',
      appearance TEXT DEFAULT '',
      personality TEXT DEFAULT '',
      background TEXT DEFAULT '',
      abilities TEXT DEFAULT '',
      motivation TEXT DEFAULT '',
      relationships TEXT DEFAULT '',
      arc TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      tier INTEGER DEFAULT 2,
      tags TEXT DEFAULT '',
      appear_chapters TEXT DEFAULT '[]',
      relations TEXT DEFAULT '[]',
      aliases TEXT DEFAULT '[]',
      appear_count INTEGER DEFAULT 0,
      first_chapter INTEGER DEFAULT 0,
      last_chapter INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      cs_location TEXT DEFAULT '',
      cs_power_level TEXT DEFAULT '',
      cs_physical_state TEXT DEFAULT '',
      cs_mental_state TEXT DEFAULT '',
      cs_key_items TEXT DEFAULT '',
      cs_recent_events TEXT DEFAULT '',
      cs_updated_at_chapter INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      updated_at INTEGER DEFAULT (unixepoch() * 1000)
    );
    CREATE UNIQUE INDEX idx_characters_uid ON characters(uid);
    CREATE TABLE blueprints (chapter_number INTEGER PRIMARY KEY, characters TEXT, character_uids TEXT, updated_at INTEGER);
  `)
  ;(globalThis as unknown as { __testDb: DatabaseSync }).__testDb = db
})
afterEach(() => db.close())

describe('scoped duplicate merge', () => {
  function fixture() {
    CharacterRepository.upsert(makeChar('Keep', { uid: 'keep', notes: 'Нет сведений о прошлом', relations: '[{"target":"Remove"}]' }))
    CharacterRepository.upsert(makeChar('Remove', { uid: 'remove', notes: 'Other notes', appearance: 'Tall', relations: '[{"target":"Keep"}]' }))
    CharacterRepository.upsert(makeChar('Observer', { relations: '[{"target":"Remove","type":"ally"}]' }))
    db.prepare('INSERT INTO blueprints VALUES (1, ?, ?, 0)').run('["Keep","Remove"]', '["keep","remove"]')
    return {
      scope: readCharacterEditSnapshot().scope,
      target: CharacterRepository.getByName('Keep')!,
      source: CharacterRepository.getByName('Remove')!,
    }
  }

  it('keeps handwritten fields and redirects relation and blueprint references in the merge receipt', () => {
    const result = mergeDatabaseDuplicateCharacters(fixture())
    expect(result).toEqual({ success: true, cards: expect.arrayContaining([
      expect.objectContaining({ name: 'Keep', uid: 'keep', notes: 'Нет сведений о прошлом', appearance: 'Tall', relations: '[]' }),
      expect.objectContaining({ name: 'Observer', relations: '[{"target":"Keep","type":"ally"}]' }),
    ]) })
    expect(CharacterRepository.getByName('Remove')).toBeNull()
    expect(db.prepare('SELECT characters, character_uids FROM blueprints').get()).toEqual({
      characters: '["Keep"]', character_uids: '["keep"]',
    })
  })

  it.each([
    "UPDATE characters SET notes = 'New hand edit' WHERE name = 'Keep'",
    "UPDATE characters SET name = 'Renamed' WHERE name = 'Remove'",
    "UPDATE characters SET uid = 'replacement' WHERE name = 'Remove'",
  ])('rejects a stale preview after %s', sql => {
    const preview = fixture()
    db.exec(sql)
    expect(mergeDatabaseDuplicateCharacters(preview).success).toBe(false)
    expect(CharacterRepository.getAll()).toHaveLength(3)
    expect(db.prepare('SELECT characters FROM blueprints').get()).toEqual({ characters: '["Keep","Remove"]' })
  })

  it('rejects a different connection scope', () => {
    const preview = fixture()
    expect(mergeDatabaseDuplicateCharacters({ ...preview, scope: { ...preview.scope, token: 'stale' } }).success).toBe(false)
    expect(CharacterRepository.getAll()).toHaveLength(3)
  })

  it('rolls back card and blueprint changes if removing the source fails', () => {
    const preview = fixture()
    db.exec(`CREATE TRIGGER fail_remove BEFORE DELETE ON characters WHEN OLD.name = 'Remove'
      BEGIN SELECT RAISE(ABORT, 'injected failure'); END;`)
    expect(mergeDatabaseDuplicateCharacters(preview)).toMatchObject({ success: false, error: expect.stringContaining('injected failure') })
    expect(CharacterRepository.getByName('Keep')).toEqual(preview.target)
    expect(CharacterRepository.getByName('Remove')).toEqual(preview.source)
    expect(CharacterRepository.getByName('Observer')?.relations).toContain('"Remove"')
    expect(db.prepare('SELECT characters, character_uids FROM blueprints').get()).toEqual({
      characters: '["Keep","Remove"]', character_uids: '["keep","remove"]',
    })
  })
})

function makeChar(name: string, overrides: Partial<CharacterData> = {}): CharacterData {
  return {
    name,
    role: 'supporting',
    gender: '', age: '', appearance: '', personality: '',
    background: '', abilities: '', motivation: '',
    relationships: '', arc: '', notes: '',
    tier: 2, tags: '', appearChapters: '[]', relations: '[]',
    ...overrides,
  }
}

function state(location: string, updatedAtChapter = 1) {
  return {
    location,
    powerLevel: '', physicalState: '', mentalState: '',
    keyItems: '', recentEvents: '', updatedAtChapter,
  }
}

describe('character edit transaction', () => {
  function setup() {
    CharacterRepository.upsert(makeChar('A', { uid: 'uid-a' }))
    CharacterRepository.upsert(makeChar('Observer', { relations: '[{"target":"A","label":"ally"}]' }))
    db.exec(`UPDATE characters SET created_at = 17 WHERE name = 'A';
      INSERT INTO blueprints VALUES (1, '["A","Observer"]', '["uid-a"]', 23)`)
    const { scope, cards } = readCharacterEditSnapshot()
    return { scope, before: cards.find(card => card.name === 'A')! }
  }

  it('renames in place and rewrites every structured reference while preserving a concurrent card and field', () => {
    const { scope, before } = setup()
    CharacterRepository.upsert(makeChar('Concurrent', { relations: '[{"target":"A"}]' }))
    CharacterRepository.updateState('A', state('updated'))
    const result = commitDatabaseCharacterEdits({ scope, edits: [{ before, after: { ...before, name: 'C', notes: 'edited' } }] })
    expect(result.success).toBe(true)
    expect(CharacterRepository.getByName('A')).toBeNull()
    expect(CharacterRepository.getByName('C')).toMatchObject({ uid: 'uid-a', aliases: '["A"]', notes: 'edited', currentState: { location: 'updated' } })
    expect(db.prepare("SELECT created_at FROM characters WHERE name = 'C'").get()).toMatchObject({ created_at: 17 })
    expect(CharacterRepository.getByName('Observer')?.relations).toBe('[{"target":"C","label":"ally"}]')
    expect(CharacterRepository.getByName('Concurrent')?.relations).toBe('[{"target":"C"}]')
    expect(db.prepare('SELECT * FROM blueprints').get()).toMatchObject({ characters: '["C","Observer"]', character_uids: '["uid-a"]' })
  })

  it.each(['rename', 'delete'])('rolls back %s and reference cleanup if the last write fails', operation => {
    const { scope, before } = setup()
    const original = db.prepare('SELECT * FROM characters ORDER BY name').all()
    db.exec("CREATE TRIGGER fail_refs BEFORE UPDATE ON blueprints BEGIN SELECT RAISE(ABORT, 'injected failure'); END")
    const after = operation === 'rename' ? { ...before, name: 'C' } : null
    expect(commitDatabaseCharacterEdits({ scope, edits: [{ before, after }] })).toMatchObject({ success: false })
    expect(db.prepare('SELECT * FROM characters ORDER BY name').all()).toEqual(original)
    expect(db.prepare('SELECT * FROM blueprints').get()).toMatchObject({ characters: '["A","Observer"]', character_uids: '["uid-a"]', updated_at: 23 })
  })

  it('deletes an existing role and clears name and UID references', () => {
    const { scope, before } = setup()
    expect(commitDatabaseCharacterEdits({ scope, edits: [{ before, after: null }] }).success).toBe(true)
    expect(CharacterRepository.getByName('A')).toBeNull()
    expect(CharacterRepository.getByName('Observer')?.relations).toBe('[]')
    expect(db.prepare('SELECT * FROM blueprints').get()).toMatchObject({ characters: '["Observer"]', character_uids: '[]' })
  })

  it('rejects stale tokens, new-name collisions and concurrent writes to an edited field', () => {
    const { scope, before } = setup()
    const edit = { before, after: { ...before, notes: 'manual' } }
    expect(commitDatabaseCharacterEdits({ scope: { ...scope, token: 'old' }, edits: [edit] }).success).toBe(false)
    expect(commitDatabaseCharacterEdits({ scope, edits: [{ before, after: { ...before, name: 'Observer' } }] }).success).toBe(false)
    CharacterRepository.upsert({ ...before, notes: 'concurrent' })
    expect(commitDatabaseCharacterEdits({ scope, edits: [edit] }).success).toBe(false)
    expect(CharacterRepository.getByName('A')?.notes).toBe('concurrent')
  })

  it('treats a zero-row delete as failure and preserves all references', () => {
    const { scope, before } = setup()
    db.exec("CREATE TRIGGER skip_remove BEFORE DELETE ON characters BEGIN SELECT RAISE(IGNORE); END")
    expect(commitDatabaseCharacterEdits({ scope, edits: [{ before, after: null }] }).success).toBe(false)
    expect(CharacterRepository.getByName('A')).toBeTruthy()
    expect(CharacterRepository.getByName('Observer')?.relations).toContain('"A"')
  })

  it('fills current cards after renames and skips deleted identities from an older model request', () => {
    const { scope, before } = setup()
    const observer = CharacterRepository.getByName('Observer')!
    const known = [before, observer]
    expect(commitDatabaseCharacterEdits({ scope, edits: [
      { before, after: { ...before, name: 'C', notes: 'manual' } },
      { before: observer, after: null },
    ] }).success).toBe(true)
    expect(mergeDatabaseCharacterCards({ scope, known, cards: [
      { name: 'A', notes: 'from model', appearance: 'new' },
      { name: 'Observer', notes: 'old result' },
      { name: 'Unseen', background: 'new character' },
    ] })).toMatchObject({ success: true, stats: { created: 1, merged: 1, saved: 2 } })
    expect(CharacterRepository.getByName('C')).toMatchObject({ notes: 'manual', appearance: 'new' })
    expect(CharacterRepository.getByName('A')).toBeNull()
    expect(CharacterRepository.getByName('Observer')).toBeNull()
    expect(CharacterRepository.getByName('Unseen')?.background).toBe('new character')
  })
})

describe('CharacterRepository.updateState 哨兵合并（写时刻以 DB 当前值为基准）', () => {
  it('非空值正常覆盖', () => {
    CharacterRepository.upsert(makeChar('张三'))
    CharacterRepository.updateState('张三', state('森林', 3))
    expect(CharacterRepository.getByName('张三')?.currentState?.location).toBe('森林')
    expect(CharacterRepository.getByName('张三')?.currentState?.updatedAtChapter).toBe(3)
  })

  it('空值/哨兵不覆盖已有值（旧快照写入空值 → DB 保留较新状态）', () => {
    CharacterRepository.upsert(makeChar('张三'))
    CharacterRepository.updateState('张三', state('森林', 3))
    // 并发场景：慢工作流基于旧快照（认为无变化）后写入空值——不得清空已有状态；
    // updatedAtChapter 总是更新（重定稿旧章需可回写章节号，故不做单调保护）
    CharacterRepository.updateState('张三', state('', 2))
    const cur = CharacterRepository.getByName('张三')?.currentState
    expect(cur?.location).toBe('森林')
    expect(cur?.updatedAtChapter).toBe(2)
  })

  it('字段级独立保旧：仅空字段保留，非空字段各自覆盖', () => {
    CharacterRepository.upsert(makeChar('张三'))
    CharacterRepository.updateState('张三', { ...state('森林', 3), powerLevel: '金丹期' })
    CharacterRepository.updateState('张三', { ...state('', 4), powerLevel: '元婴期' })
    const cur = CharacterRepository.getByName('张三')?.currentState
    expect(cur?.location).toBe('森林')      // 空 → 保留
    expect(cur?.powerLevel).toBe('元婴期')  // 非空 → 覆盖
  })

  it('tags/motivation COALESCE：null 不覆盖', () => {
    CharacterRepository.upsert(makeChar('张三', { tags: '["主角"]', motivation: '复仇' }))
    CharacterRepository.updateState('张三', state('森林'), { tags: null, motivation: null })
    const char = CharacterRepository.getByName('张三')
    expect(char?.tags).toBe('["主角"]')
    expect(char?.motivation).toBe('复仇')
  })

  it('tags/motivation 有值时覆盖', () => {
    CharacterRepository.upsert(makeChar('张三'))
    CharacterRepository.updateState('张三', state('森林'), { tags: '["新标签"]', motivation: '守护' })
    const char = CharacterRepository.getByName('张三')
    expect(char?.tags).toBe('["新标签"]')
    expect(char?.motivation).toBe('守护')
  })
})

describe('CharacterRepository.mergeFields 仅填充空白(写时刻保旧)', () => {
  it('非空字段填充,空字段保旧', () => {
    CharacterRepository.upsert(makeChar('张三', { appearance: '已有外貌' }))
    CharacterRepository.mergeFields('张三', { appearance: '新外貌', personality: '冷静' })
    const char = CharacterRepository.getByName('张三')
    expect(char?.appearance).toBe('已有外貌') // 非空保旧
    expect(char?.personality).toBe('冷静')     // 空白填充
  })

  it('字段级独立:空值不覆盖、哨兵(无)不覆盖', () => {
    CharacterRepository.upsert(makeChar('张三', { motivation: '复仇' }))
    CharacterRepository.mergeFields('张三', { motivation: '', background: '无名门派' })
    const char = CharacterRepository.getByName('张三')
    expect(char?.motivation).toBe('复仇')
    expect(char?.background).toBe('无名门派')
  })

  it('tags COALESCE:null 不覆盖', () => {
    CharacterRepository.upsert(makeChar('张三', { tags: '["旧标签"]' }))
    CharacterRepository.mergeFields('张三', { tags: null as unknown as string })
    expect(CharacterRepository.getByName('张三')?.tags).toBe('["旧标签"]')
  })

  it('DB 哨兵值(无/none)视为空白 → 填充', () => {
    CharacterRepository.upsert(makeChar('张三', { gender: '无', age: 'none' }))
    CharacterRepository.mergeFields('张三', { gender: '女', age: '18', personality: '冷静' })
    const char = CharacterRepository.getByName('张三')
    expect(char?.gender).toBe('女')          // DB 哨兵 '无' → 视为空白 → 填充
    expect(char?.age).toBe('18')             // DB 哨兵 'none' → 视为空白 → 填充
    expect(char?.personality).toBe('冷静')   // DB 空 → 填充
  })

  it('tags 哨兵视为空白 → 填充;新值也是哨兵 → 不写', () => {
    CharacterRepository.upsert(makeChar('张三', { tags: '无' }))
    CharacterRepository.mergeFields('张三', { tags: '["新标签"]', appearance: '无变化' })
    const char = CharacterRepository.getByName('张三')
    expect(char?.tags).toBe('["新标签"]')  // DB tags 哨兵 → 填充
    expect(char?.appearance).toBe('')       // 新值是哨兵 → 不写
  })

  it('不触碰动态状态与角色定位', () => {
    CharacterRepository.upsert(makeChar('张三', { role: 'protagonist', tier: 1 }))
    CharacterRepository.mergeFields('张三', { appearance: '黑发' })
    const char = CharacterRepository.getByName('张三')
    expect(char?.role).toBe('protagonist')
    expect(char?.tier).toBe(1)
    expect(char?.currentState).toBeUndefined()
  })
})

describe('CharacterRepository.mergeCharacters（P1-6 用户合并角色）', () => {
  it('合并：空白字段填充 + tags 并集 + 出场数据合并 + 删除源角色', () => {
    CharacterRepository.upsert(makeChar('苏晚', {
      appearance: '黑发', tags: '["天才"]', appearChapters: '[1,3]',
      appearCount: 2, firstChapter: 1, lastChapter: 3,
    }))
    CharacterRepository.upsert(makeChar('苏晚晴', {
      appearance: '', personality: '冷静', tags: '["天才","剑修"]',
      appearChapters: '[2]', appearCount: 1, firstChapter: 2, lastChapter: 2,
    }))
    CharacterRepository.mergeCharacters('苏晚', '苏晚晴')

    const merged = CharacterRepository.getByName('苏晚')
    expect(merged).not.toBeNull()
    expect(CharacterRepository.getByName('苏晚晴')).toBeNull() // 源已删除
    expect(merged?.appearance).toBe('黑发')    // target 非空保旧
    expect(merged?.personality).toBe('冷静')   // target 空白 → source 填充
    expect(merged?.tags).toBe('["天才","剑修"]') // 并集去重
    expect(JSON.parse(merged?.appearChapters || '[]')).toEqual([1, 2, 3]) // 并集升序
    expect(merged?.appearCount).toBe(3)
    expect(merged?.firstChapter).toBe(1)
    expect(merged?.lastChapter).toBe(3)
  })

  it('合并：role/tier 取更核心，relations 并入与全库重定向', () => {
    CharacterRepository.upsert(makeChar('苏晚', { role: 'supporting', tier: 2, relations: '[]' }))
    CharacterRepository.upsert(makeChar('苏夜', {
      role: 'protagonist', tier: 1,
      relations: JSON.stringify([{ target: '李雷', type: 'ally', label: '搭档', sinceChapter: 5 }, { target: '苏晚', type: 'other', label: '自身', sinceChapter: 1 }]),
    }))
    CharacterRepository.upsert(makeChar('李雷', {
      relations: JSON.stringify([{ target: '苏夜', type: 'enemy', label: '宿敌', sinceChapter: 6 }]),
    }))
    CharacterRepository.mergeCharacters('苏晚', '苏夜')

    const merged = CharacterRepository.getByName('苏晚')
    expect(merged?.role).toBe('protagonist') // 取更核心
    expect(merged?.tier).toBe(1)
    // source 指向 target 的条目丢弃；指向其他角色的条目并入
    const rels = JSON.parse(merged?.relations || '[]') as Array<{ target: string }>
    expect(rels.some(r => r.target === '苏晚')).toBe(false)
    expect(rels.some(r => r.target === '李雷')).toBe(true)
    // 全库重定向：李雷指向 苏夜 → 苏晚
    const liRel = JSON.parse(CharacterRepository.getByName('李雷')?.relations || '[]') as Array<{ target: string }>
    expect(liRel.some(r => r.target === '苏晚')).toBe(true)
    expect(liRel.some(r => r.target === '苏夜')).toBe(false)
  })

  it('合并：currentState 空白填充 + updatedAtChapter 取更晚', () => {
    CharacterRepository.upsert(makeChar('苏晚', {
      currentState: { location: '森林', powerLevel: '', physicalState: '', mentalState: '', keyItems: '', recentEvents: '', updatedAtChapter: 3 },
    }))
    CharacterRepository.upsert(makeChar('苏夜', {
      currentState: { location: '', powerLevel: '金丹期', physicalState: '轻伤', mentalState: '', keyItems: '', recentEvents: '', updatedAtChapter: 8 },
    }))
    CharacterRepository.mergeCharacters('苏晚', '苏夜')

    const cs = CharacterRepository.getByName('苏晚')?.currentState
    expect(cs?.location).toBe('森林')   // target 非空保旧
    expect(cs?.powerLevel).toBe('金丹期') // target 空白 → source
    expect(cs?.physicalState).toBe('轻伤')
    expect(cs?.updatedAtChapter).toBe(8) // 取更晚
  })

  it('合并：目标或源不存在 / 自身 → 抛错且不删数据', () => {
    CharacterRepository.upsert(makeChar('苏晚'))
    expect(() => CharacterRepository.mergeCharacters('苏晚', '不存在')).toThrow()
    expect(() => CharacterRepository.mergeCharacters('不存在', '苏晚')).toThrow()
    expect(() => CharacterRepository.mergeCharacters('苏晚', '苏晚')).toThrow()
    expect(CharacterRepository.getByName('苏晚')).not.toBeNull()
  })

  it('合并：status/aliases 保留 target', () => {
    CharacterRepository.upsert(makeChar('苏晚', { status: 'departed', aliases: '["阿晚"]' }))
    CharacterRepository.upsert(makeChar('苏夜', { status: 'dead', aliases: '["夜儿"]' }))
    CharacterRepository.mergeCharacters('苏晚', '苏夜')
    const merged = CharacterRepository.getByName('苏晚')
    expect(merged?.status).toBe('departed')
    expect(merged?.aliases).toBe('["阿晚"]')
  })
})
