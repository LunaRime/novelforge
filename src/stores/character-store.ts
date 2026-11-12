import { create } from 'zustand'
import { applyCharacterDelta, hasCharacterChanges, remapCharacterRelations, type CharacterData, type CharacterEdit, type CharacterStateData, type CharacterWriteScope } from '../core'
import { t } from '../shared/locale'
import { renderLog } from '../services/render-logger'
import { toast } from '../components/ui/Toast'
import { randomUUID } from '../utils/id'
import { captureCharacterSource, CharacterEditCancelled, commitCharacterEdits, isCharacterSourceCurrent, readCharacterEdits, type CharacterSource } from '../services/characters/character-edits-adapter'

export type CharacterCurrentState = CharacterStateData
export type CharacterCard = CharacterData

export const EMPTY_CARD: CharacterCard = {
  name: '', role: 'supporting', gender: '', age: '',
  appearance: '', personality: '', background: '', abilities: '',
  motivation: '', relationships: '', arc: '', notes: '',
  tier: 2, tags: '', appearChapters: '[]', relations: '[]',
}

export const EMPTY_STATE: CharacterCurrentState = {
  location: '', powerLevel: '', physicalState: '', mentalState: '',
  keyItems: '', recentEvents: '', updatedAtChapter: 0,
}

/** 按 tier 分组角色，主角/反派强制归入 tier 1
 * ⚠️ 不 mutation 传入对象（P1 修复）：此前 `c.tier = 1` 直接改写 zustand store 中的对象
 *（无 set 通知、严格模式双执行、不落库）——侧栏显示 1、图谱显示 DB 值 2、编辑器 Select 又 1，
 * 三处不一致且取决于组件挂载顺序。tier 非法值（<1 或 >3）归一化到 1-3。 */
export function groupByTier(chars: CharacterCard[]): Record<number, CharacterCard[]> {
  const groups: Record<number, CharacterCard[]> = { 1: [], 2: [], 3: [] }
  for (const c of chars) {
    // 主角和反派始终 tier=1（副本上修正，不写回原对象）
    const effectiveTier = (c.role === 'protagonist' || c.role === 'antagonist')
      ? 1
      : (c.tier >= 1 && c.tier <= 3 ? c.tier : 2)
    const t = effectiveTier
    if (!groups[t]) groups[t] = []
    groups[t].push(c)
  }
  return groups
}

interface CharacterState {
  characters: CharacterCard[]
  selectedName: string | null
  saving: boolean
  loaded: boolean
  /** 是否有未保存的编辑（刷新/切项目前用于确认，P3 修复） */
  dirty: boolean
  /** 改名映射 oldName → newName（#34 块 B：编辑时捕获，保存时级联重写 relations） */
  renameMap: Record<string, string>
  source: CharacterSource | null
  writeScope: CharacterWriteScope | null
  baseline: CharacterCard[]

  /** force=true 时忽略 dirty 强制刷新（手动刷新确认后） */
  load: (force?: boolean) => Promise<void>
  reset: () => void
  setSelectedName: (name: string | null) => void
  addCharacter: () => void
  deleteCharacter: (name: string, projectPath?: string) => Promise<void>
  updateField: <K extends keyof CharacterCard>(name: string, key: K, value: CharacterCard[K]) => void
  saveAll: (projectPath?: string) => Promise<void>

  // 兼容旧接口
  loadCharacters: (projectPath: string) => Promise<void>
}

// 加载请求序号（#34 块 C）：快速切换项目时，旧项目的慢响应不得覆盖当前项目数据
//（对齐 volume-store / draft-store 的 loadSeq 模式——此前 character-store 缺失，
//  旧项目角色覆盖新项目 + repair 跨项目写库）
let loadSeq = 0
const editKeys = new WeakMap<CharacterCard, string>()

function editKey(card: CharacterCard): string {
  let key = editKeys.get(card)
  if (!key) {
    key = card.uid || randomUUID()
    editKeys.set(card, key)
  }
  return key
}

function retainKey(card: CharacterCard, previous: CharacterCard): CharacterCard {
  editKeys.set(card, editKey(previous))
  return card
}

function editsBetween(baseline: CharacterCard[], cards: CharacterCard[]): CharacterEdit[] {
  const originals = new Map(baseline.map(card => [editKey(card), card]))
  return cards.flatMap(card => {
    const before = originals.get(editKey(card)) ?? null
    return !before || hasCharacterChanges(before, card) ? [{ before, after: card }] : []
  })
}

function rebaseCharacters(submitted: CharacterCard[], latest: CharacterCard[], committed: CharacterCard[], names = new Map<string, string | null>()): CharacterCard[] {
  const byKey = new Map(submitted.map(card => [editKey(card), card]))
  const byName = new Map(submitted.filter(card => !card.uid).map(card => [card.name, card]))
  const recent = new Map(latest.map(card => [editKey(card), card]))
  const rebased = committed.map(card => {
    const before = byKey.get(editKey(card)) ?? byName.get(card.name)
    if (!before) return card
    retainKey(card, before)
    const after = recent.get(editKey(before))
    if (!after || !hasCharacterChanges(before, after)) return card
    const result = applyCharacterDelta(before, after, card)
    result.relations = remapCharacterRelations(result.relations, names)
    return retainKey(result, before)
  })
  const added = latest.filter(card => !byKey.has(editKey(card))).map(card => {
    const relations = remapCharacterRelations(card.relations, names)
    return relations === card.relations ? card : retainKey({ ...card, relations }, card)
  })
  return [...rebased, ...added]
}

function pendingEdits(baseline: CharacterCard[], characters: CharacterCard[]) {
  const edits = editsBetween(baseline, characters)
  return {
    dirty: edits.length > 0,
    renameMap: Object.fromEntries(edits.flatMap(({ before, after }) =>
      before && after && before.name !== after.name ? [[before.name, after.name]] : [])),
  }
}

function editSource(state: CharacterState, projectPath?: string) {
  if (!state.source || (projectPath !== undefined && projectPath !== state.source.path)
    || !isCharacterSourceCurrent(state.source)) throw new CharacterEditCancelled(t('error.requestCancelled'))
  if (!state.writeScope) throw new Error(t('error.characterEditConflict'))
  return { source: state.source, scope: state.writeScope }
}

export const useCharacterStore = create<CharacterState>()((set, get) => ({
  characters: [],
  selectedName: null,
  saving: false,
  loaded: false,
  dirty: false,
  renameMap: {},
  source: null,
  writeScope: null,
  baseline: [],

  load: async (force = false) => {
    const source = captureCharacterSource()
    if (!source || get().saving) return
    const previous = get()
    const sameSource = previous.source && isCharacterSourceCurrent(previous.source)
    if (sameSource && previous.writeScope && previous.dirty && !force) {
      renderLog('warn', 'Load:Character', t('log.render.characterLoadSkippedDirty'))
      return
    }
    const seq = ++loadSeq
    if (!sameSource) set({ characters: [], baseline: [], selectedName: null, dirty: false, renameMap: {}, loaded: false, source, writeScope: null })
    const editing = get().characters
    try {
      const snapshot = await readCharacterEdits(source)
      if (seq !== loadSeq) return
      const latest = get()
      if (latest.writeScope && latest.characters !== editing) return
      const characters = latest.writeScope ? snapshot.cards : [...snapshot.cards, ...latest.characters]
      const selected = get().selectedName
      set({
        characters, baseline: snapshot.cards, source, writeScope: snapshot.scope,
        loaded: true, ...pendingEdits(snapshot.cards, characters),
        selectedName: characters.some(card => card.name === selected) ? selected : characters[0]?.name ?? null,
      })
    } catch (error) {
      if (seq !== loadSeq || !isCharacterSourceCurrent(source)) return
      renderLog('error', 'Load:Character', t('log.render.characterLoadFailed').replace('{error}', () => String(error)))
      set({ loaded: true })
    }
  },

  loadCharacters: async () => {
    await get().load()
  },

  reset: () => {
    ++loadSeq
    set({ characters: [], selectedName: null, saving: false, loaded: false, dirty: false, renameMap: {}, baseline: [], source: null, writeScope: null })
  },

  setSelectedName: (name) => set({ selectedName: name }),

  addCharacter: () => {
    // 角色名是唯一主键：默认名用 i18n 文案 + 数字序号去重（#29——此前硬编码中文
    // 「新角色_随机4位」产生垃圾名且英文界面显示中文）
    const base = t('character.defaultName')
    const existing = new Set(get().characters.map(c => c.name))
    let name = base
    let seq = 2
    while (existing.has(name)) {
      name = `${base} ${seq}`
      seq++
    }
    const newCard: CharacterCard = {
      ...EMPTY_CARD,
      name,
      uid: randomUUID(),
    }
    set((s) => ({
      characters: [...s.characters, newCard],
      selectedName: newCard.name,
      dirty: true,
    }))
  },

  deleteCharacter: async (name, projectPath) => {
    const initial = get()
    if (initial.saving) return
    const card = initial.characters.find(item => item.name === name)
    if (!card) return
    let seq: number | undefined
    try {
      const { source, scope } = editSource(initial, projectPath)
      const key = editKey(card)
      const before = initial.baseline.find(item => editKey(item) === key)
      const removals = new Map<string, string | null>([[name, null]])
      if (before) removals.set(before.name, null)
      const remaining = () => {
        const latest = get().characters
        const deleting = latest.find(item => editKey(item) === key)
        if (deleting) removals.set(deleting.name, null)
        return latest.filter(item => editKey(item) !== key).map(item => {
          const relations = remapCharacterRelations(item.relations, removals)
          return relations === item.relations ? item : retainKey({ ...item, relations }, item)
        })
      }
      let baseline = initial.baseline
      let characters: CharacterCard[]
      if (before) {
        seq = ++loadSeq
        set({ saving: true })
        baseline = await commitCharacterEdits(source, scope, [{ before, after: null }])
        if (seq !== loadSeq) return
        characters = rebaseCharacters(initial.baseline, remaining(), baseline)
      } else characters = remaining()
      const selected = get().selectedName
      set({
        characters, baseline, ...pendingEdits(baseline, characters),
        selectedName: characters.some(item => item.name === selected) ? selected : characters[0]?.name ?? null,
      })
      if (!isCharacterSourceCurrent(source)) return
      renderLog('info', 'Delete:Character', t('log.render.characterDeleted').replace('{name}', () => name))
      toast.success(t('character.deleted').replace('{name}', () => name))
    } catch (error) {
      if (error instanceof CharacterEditCancelled || (seq !== undefined && seq !== loadSeq)) return
      const detail = error instanceof Error ? error.message : String(error)
      renderLog('error', 'Delete:Character', t('log.render.characterDeleteFailed').replace('{error}', () => detail))
      toast.error(t('character.deleteFailed').replace('{error}', () => detail))
    } finally {
      if (seq !== undefined && seq === loadSeq) set({ saving: false })
    }
  },

  updateField: (name, key, value) => {
    set((s) => {
      const current = s.characters.find(c => c.name === name)
      if (!current || Object.is(current[key], value)) return s
      const newChars = s.characters.map(c =>
        c === current ? retainKey({ ...c, [key]: value }, c) : c
      )

      let newSelected = s.selectedName
      let renameMap = s.renameMap
      if (key === 'name') {
        const newName = value as string
        if (newSelected === name) newSelected = newName
        if (name !== newName) {
          // 捕获改名映射（#34 块 B：保存时级联重写其他角色 relations 的 target；
          // 链式压缩：A→B 再改 B→C 时把指向 B 的键更新为 C——反向查找）
          renameMap = { ...s.renameMap }
          let found = false
          for (const [old, n] of Object.entries(renameMap)) {
            if (n === name) { renameMap[old] = newName; found = true }
          }
          if (!found) renameMap = { ...renameMap, [name]: newName }
          renameMap = Object.fromEntries(Object.entries(renameMap).filter(([from, to]) => from !== to))
        }
      }

      return { characters: newChars, selectedName: newSelected, renameMap, dirty: true }
    })
  },

  saveAll: async (projectPath) => {
    const initial = get()
    if (initial.saving) throw new CharacterEditCancelled(t('error.requestCancelled'))
    const uniqueNames = new Set<string>()
    for (const card of initial.characters) {
      if (uniqueNames.has(card.name)) throw new Error(t('error.characterDuplicateName').replace('{name}', () => card.name))
      uniqueNames.add(card.name)
    }
    const { source, scope } = editSource(initial, projectPath)
    const baselineNames = new Set(initial.baseline.map(card => card.name))
    const localNames = new Map(Object.entries(initial.renameMap).filter(([name]) => !baselineNames.has(name)))
    const submitted = initial.characters.map(card => {
      const relations = remapCharacterRelations(card.relations, localNames)
      return relations === card.relations ? card : retainKey({ ...card, relations }, card)
    })
    const edits = editsBetween(initial.baseline, submitted)
    const names = new Map<string, string | null>([
      ...localNames,
      ...edits.flatMap(({ before, after }): Array<[string, string]> =>
        before && after && before.name !== after.name ? [[before.name, after.name]] : []),
    ])
    const seq = ++loadSeq
    set({ saving: true })
    try {
      const baseline = await commitCharacterEdits(source, scope, edits)
      if (seq !== loadSeq) throw new CharacterEditCancelled(t('error.requestCancelled'))
      const characters = rebaseCharacters(initial.characters, get().characters, baseline, names)
      const selected = get().selectedName
      set({
        characters, baseline, ...pendingEdits(baseline, characters),
        selectedName: characters.some(card => card.name === selected) ? selected : characters[0]?.name ?? null,
      })
    } finally {
      if (seq === loadSeq) set({ saving: false })
    }
  },
}))
