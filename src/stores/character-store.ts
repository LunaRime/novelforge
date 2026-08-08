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
  /** 改名映射 oldName → newName（#34 块 B：编辑时捕获，保存时级联重写 relations） */
  renameMap: Record<string, string>

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

export const useCharacterStore = create<CharacterState>()((set, get) => ({
  characters: [],
  selectedName: null,
  saving: false,
  loaded: false,
  dirty: false,
  renameMap: {},

  load: async (force = false) => {
    // #34 块 D：自动刷新（定稿完成/档案生成/提取失败）尊重未保存编辑——
    // dirty 时跳过（手动刷新经 confirm 后传 force=true）
    if (get().dirty && !force) {
      renderLog('warn', 'Load:Character', t('log.render.characterLoadSkippedDirty'))
      return
    }
    const seq = ++loadSeq
    try {
      // #34：存量角色名括号别名一次性修复（幂等——无括号名时零操作），
      // 修复后再读取，保证 store 与 DB 一致；repair 内部带项目切换校验
      const { applyCharacterNameRepair } = await import('../services/character-name-repair')
      await applyCharacterNameRepair()
      if (seq !== loadSeq) return // 项目已切换，丢弃旧响应
      const cards = await ipc.invoke('db:character-get-all')
      if (seq !== loadSeq) return

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
      if (seq !== loadSeq) return
      // 加载失败打日志（此前静默清空列表，无从排查）
      renderLog('error', 'Load:Character', t('log.render.characterLoadFailed').replace('{error}', () => String(e)))
      set({ characters: [], selectedName: null, loaded: true, dirty: false })
    }
  },

  loadCharacters: async () => {
    await get().load()
  },

  reset: () => {
    set({ characters: [], selectedName: null, saving: false, loaded: false, dirty: false, renameMap: {} })
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
      toast.error(t('character.deleteFailed').replace('{error}', String(result?.error ?? t('status.unknown'))))
      return
    }

    // 级联清理其他角色 relations 中对被删角色的引用（防悬空边/图谱断边）——
    // #34 块 C：store 同步更新（此前只写 DB，store 残留悬空引用 → 下次 saveAll
    // 用旧数据写回，级联清理被完全抵消）；级联 upsert 用清理后的数据
    const remaining = characters
      .filter(c => c.name !== name)
      .map(c => {
        let rels: Array<{ target: string }> = []
        try { rels = JSON.parse(c.relations || '[]') } catch { return c }
        if (!rels.some(r => r.target === name)) return c
        return { ...c, relations: JSON.stringify(rels.filter(r => r.target !== name)) }
      })
    for (const c of remaining) {
      const old = characters.find(x => x.name === c.name)
      if (old && c.relations !== old.relations) {
        await ipc.invoke('db:character-upsert', c as never).catch(() => {})
      }
    }

    // 清理改名映射中指向被删角色的条目（改名 A→B 后删除 B，A→B 映射作废）
    const renameMap = { ...get().renameMap }
    for (const [old, n] of Object.entries(renameMap)) {
      if (n === name) delete renameMap[old]
    }

    set({
      characters: remaining,
      selectedName: remaining.length > 0 ? remaining[0].name : null,
      dirty: true,
      renameMap,
    })

    // #34 块 D：删除成功反馈（此前静默，违反 save-feedback-standard 双通道）
    renderLog('info', 'Delete:Character', t('log.render.characterDeleted').replace('{name}', name))
    toast.success(t('character.deleted').replace('{name}', name))
  },

  updateField: (name, key, value) => {
    set((s) => {
      const newChars = s.characters.map(c =>
        c.name === name ? { ...c, [key]: value } : c
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
          if (!found) renameMap[name] = newName
        }
      }

      return { characters: newChars, selectedName: newSelected, renameMap, dirty: true }
    })
  },

  saveAll: async () => {
    set({ saving: true })
    const { characters, renameMap } = get()
    // #34 块 C：记录保存起点——保存期间的新编辑不得被无条件清 dirty
    const snapshot = characters

    try {
      // #34 块 B：重名校验——改名撞名时后者会静默覆盖前者整卡（ON CONFLICT 全列覆盖）
      const names = characters.map(c => c.name)
      const dup = names.find((n, i) => n && names.indexOf(n) !== i)
      if (dup) throw new Error(t('error.characterDuplicateName').replace('{name}', dup))

      // 级联重写 relations（#34 块 B）：改名映射应用到其他角色的 relations target。
      // ⚠️ 无稳定 id，改名映射只能在编辑时捕获（renameMap），保存时无法从 diff 推断
      let toSave = characters
      if (Object.keys(renameMap).length > 0) {
        const resolve = (n: string): string => {
          let cur = n
          const seen = new Set<string>()
          while (renameMap[cur] && !seen.has(cur)) { seen.add(cur); cur = renameMap[cur] }
          return cur
        }
        toSave = characters.map(c => {
          if (!c.relations) return c
          let rels: Array<Record<string, unknown>> = []
          try { rels = JSON.parse(c.relations) } catch { return c }
          let changed = false
          const next = rels.map(r => {
            const t = String(r.target ?? '')
            const mapped = resolve(t)
            if (mapped !== t) { changed = true; return { ...r, target: mapped } }
            return r
          })
          return changed ? { ...c, relations: JSON.stringify(next) } : c
        })
      }

      // 旧名清理（#34 块 C 收敛）：只删「改名映射的旧名」且 DB 存在 store 无 的行——
      // 此前 diff 删除所有「DB 有 store 无」的行，会把工作流并发写入、store 尚未
      // load 到的新角色静默误删（AI 生成数据丢失）
      const dbChars = await ipc.invoke('db:character-get-all').catch(() => [])
      const storeNames = new Set(toSave.map(c => c.name))
      const staleOldNames = new Set(Object.keys(renameMap))
      for (const dbChar of (Array.isArray(dbChars) ? dbChars : [])) {
        const dbName = (dbChar as { name?: string }).name
        if (dbName && !storeNames.has(dbName) && staleOldNames.has(dbName)) {
          await ipc.invoke('db:character-delete', dbName).catch(() => {})
        }
      }

      // 提交到 DB 批量保存——#34 块 C：校验主进程返回值（此前忽略 {success:false}，
      // DB 事务失败被当成成功、dirty 被清为已保存）
      const result = await ipc.invoke('db:character-save-all', toSave)
      if (!result.success) {
        throw new Error(result.error || t('error.characterCardsSave').replace('{error}', t('status.unknown')))
      }

      // #34 块 C：保存期间若有新编辑（引用变化），dirty 与 renameMap 保留
      const stillDirty = get().characters !== snapshot
      set({ dirty: stillDirty, renameMap: stillDirty ? get().renameMap : {} })
    } catch (e) {
      // 失败向上抛——CharacterEditor handleSave 的 catch 负责 renderLog + toast（此前无 catch，未捕获 rejection）
      renderLog('error', 'Save:Character', t('log.render.characterSaveFailed').replace('{error}', () => String(e)))
      throw e
    } finally {
      set({ saving: false })
    }
  },
}))
