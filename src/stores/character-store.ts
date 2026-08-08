import { create } from 'zustand'
import { ipc } from '../services/ipc-client'
import { t } from '../shared/locale'
import { renderLog } from '../services/render-logger'
import { toast } from '../components/ui/Toast'
import type { CharacterData, CharacterStateData } from '../../electron/repositories/character-repository'

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

  load: () => Promise<void>
  reset: () => void
  setSelectedName: (name: string | null) => void
  addCharacter: () => void
  deleteCharacter: (name: string, projectPath?: string) => Promise<void>
  updateField: <K extends keyof CharacterCard>(name: string, key: K, value: CharacterCard[K]) => void
  saveAll: (projectPath?: string) => Promise<void>

  // 兼容旧接口
  loadCharacters: (projectPath: string) => Promise<void>
}

export const useCharacterStore = create<CharacterState>()((set, get) => ({
  characters: [],
  selectedName: null,
  saving: false,
  loaded: false,
  dirty: false,

  load: async () => {
    try {
      const cards = await ipc.invoke('db:character-get-all')

      const { selectedName } = get()
      set({
        characters: cards,
        loaded: true,
        dirty: false,
        selectedName: cards.find(c => c.name === selectedName)
          ? selectedName
          : (cards.length > 0 ? cards[0].name : null),
      })
    } catch (e) {
      // 加载失败打日志（此前静默清空列表，无从排查）
      renderLog('error', 'Load:Character', t('log.render.characterLoadFailed').replace('{error}', () => String(e)))
      set({ characters: [], selectedName: null, loaded: true, dirty: false })
    }
  },

  loadCharacters: async () => {
    await get().load()
  },

  reset: () => {
    set({ characters: [], selectedName: null, saving: false, loaded: false, dirty: false })
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
    }
    set((s) => ({
      characters: [...s.characters, newCard],
      selectedName: newCard.name,
      dirty: true,
    }))
  },

  deleteCharacter: async (name) => {
    const { characters } = get()
    const card = characters.find(c => c.name === name)
    if (!card) return

    // SQLite 删除——失败时回滚 store（P1 修复：此前 catch 忽略 + 乐观移除，
    // DB 删除失败时 UI 显示已删、下次 load 角色复活且 upsert-only 语义下永久残留）
    const result = await ipc.invoke('db:character-delete', name).catch(() => null)
    if (!result?.success) {
      renderLog('error', 'Delete:Character', t('log.render.characterDeleteFailed').replace('{error}', () => String(result?.error ?? t('status.unknown'))))
      toast.error(t('save.failed').replace('{error}', String(result?.error ?? t('status.unknown'))))
      return
    }

    // 级联清理其他角色 relations 中对被删角色的引用（防悬空边/图谱断边）
    const remaining = characters.filter(c => c.name !== name)
    for (const c of remaining) {
      let rels: Array<{ target: string }> = []
      try { rels = JSON.parse(c.relations || '[]') } catch { rels = [] }
      if (rels.some(r => r.target === name)) {
        await ipc.invoke('db:character-upsert', {
          ...c,
          relations: JSON.stringify(rels.filter(r => r.target !== name)),
        } as never).catch(() => {})
      }
    }

    set({
      characters: remaining,
      selectedName: remaining.length > 0 ? remaining[0].name : null,
      dirty: true,
    })
  },

  updateField: (name, key, value) => {
    set((s) => {
      const newChars = s.characters.map(c =>
        c.name === name ? { ...c, [key]: value } : c
      )

      let newSelected = s.selectedName
      if (key === 'name' && s.selectedName === name) {
        newSelected = value as string
      }

      return { characters: newChars, selectedName: newSelected, dirty: true }
    })
  },

  saveAll: async () => {
    set({ saving: true })
    const { characters } = get()

    try {
      // 改名 diff（P1 修复）：name 是唯一主键——「DB 有而 store 无」的名字 = 被改名/删除的
      // 旧记录，先删再 upsert。此前改名后旧名行残留（幽灵角色）、撞名时后者覆盖前者静默丢失
      const dbChars = await ipc.invoke('db:character-get-all').catch(() => [])
      const storeNames = new Set(characters.map(c => c.name))
      for (const dbChar of (Array.isArray(dbChars) ? dbChars : [])) {
        const dbName = (dbChar as { name?: string }).name
        if (dbName && !storeNames.has(dbName)) {
          await ipc.invoke('db:character-delete', dbName).catch(() => {})
        }
      }

      // 提交到 DB 批量保存
      await ipc.invoke('db:character-save-all', characters)
      set({ dirty: false })
    } catch (e) {
      // 失败向上抛——CharacterEditor handleSave 的 catch 负责 renderLog + toast（此前无 catch，未捕获 rejection）
      renderLog('error', 'Save:Character', t('log.render.characterSaveFailed').replace('{error}', () => String(e)))
      throw e
    } finally {
      set({ saving: false })
    }
  },
}))
