/**
 * character-store 测试
 * - addCharacter 默认名（#29）：i18n 文案 + 数字序号去重
 * - renameMap 改名捕获/级联/重名校验（#34 块 B）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EMPTY_CARD, useCharacterStore } from './character-store'
import type { CharacterEditsInput } from '../core'

// vi.hoisted：mock 工厂（hoisted）引用共享状态
const mock = vi.hoisted(() => ({
  savedCalls: [] as unknown[][],
  deletedCalls: [] as string[],
  dbSnapshot: [] as unknown[],
  read: vi.fn(),
  project: { currentProject: { id: 'a', path: '/book' }, projectSession: 1 },
  commit: vi.fn(),
}))
vi.mock('./project-store', () => ({ useProjectStore: { getState: () => mock.project } }))

vi.mock('../components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

vi.mock('../services/ipc-client', () => ({
  ipc: {
    invoke: vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'db:character-get-all') return mock.dbSnapshot
      if (channel === 'db:character-edit-snapshot') return mock.read()
      if (channel === 'db:character-commit-edits') return mock.commit(args[0])
      if (channel === 'db:character-save-all') { mock.savedCalls.push(args); return { success: true } }
      if (channel === 'db:character-delete') { mock.deletedCalls.push(String(args[0])); return { success: true } }
      return { success: true }
    }),
  },
}))

beforeEach(() => {
  mock.savedCalls.length = 0
  mock.deletedCalls.length = 0
  mock.dbSnapshot = []
  mock.project.projectSession = 1
  mock.commit.mockReset()
  mock.read.mockReset().mockImplementation(async () => ({ scope: { projectPath: '/book', token: 'db' }, cards: mock.dbSnapshot }))
  useCharacterStore.getState().reset()
})

it('rebases a new rename and field edits on the returned card after an in-flight save', async () => {
  const first = { ...EMPTY_CARD, name: 'A', uid: 'uid-a' }
  mock.dbSnapshot = [first]
  const store = useCharacterStore.getState()
  await store.load()
  store.updateField('A', 'name', 'B')
  let complete!: (result: unknown) => void
  mock.commit.mockReturnValueOnce(new Promise(resolve => { complete = resolve }))
  const pending = store.saveAll('/book')
  expect(mock.commit).toHaveBeenCalledWith(expect.objectContaining({ edits: [{ before: first, after: { ...first, name: 'B' } }] }))
  store.updateField('B', 'name', 'C')
  store.updateField('C', 'notes', 'typed during save')
  complete({ success: true, cards: [{ ...first, name: 'B', background: 'concurrent field' }] })
  await pending
  expect(useCharacterStore.getState()).toMatchObject({
    characters: [{ name: 'C', notes: 'typed during save', background: 'concurrent field' }],
    renameMap: { B: 'C' }, dirty: true,
  })
})

it('deletes the persisted identity after an unsaved rename and preserves other local edits', async () => {
  const first = { ...EMPTY_CARD, name: 'A', uid: 'uid-a' }
  const other = { ...EMPTY_CARD, name: 'Other', uid: 'uid-b', relations: '[{"target":"A"}]' }
  mock.dbSnapshot = [first, other]
  const store = useCharacterStore.getState()
  await store.load()
  store.updateField('A', 'name', 'B')
  store.updateField('Other', 'notes', 'unsaved')
  mock.commit.mockImplementationOnce(async (input: CharacterEditsInput) => {
    expect(input.edits).toEqual([{ before: first, after: null }])
    return { success: true, cards: [{ ...other, relations: '[]' }] }
  })
  await store.deleteCharacter('B', '/book')
  expect(useCharacterStore.getState()).toMatchObject({ characters: [{ name: 'Other', notes: 'unsaved', relations: '[]' }], dirty: true, renameMap: {} })
})

it('retains additions during the first load and allows saving them against the returned baseline', async () => {
  const before = { ...EMPTY_CARD, name: 'Known', uid: 'known' }
  let finish!: (value: unknown) => void
  mock.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  const store = useCharacterStore.getState()
  const loading = store.load()
  store.addCharacter()
  const added = useCharacterStore.getState().characters[0]
  finish({ scope: { projectPath: '/book', token: 'db' }, cards: [before] })
  await loading
  expect(useCharacterStore.getState().characters).toEqual([before, added])
  mock.commit.mockResolvedValueOnce({ success: true, cards: [before, added] })
  await store.saveAll()
  expect(mock.commit).toHaveBeenCalledWith(expect.objectContaining({ edits: [{ before: null, after: added }] }))
})

it('clears relations to a name edited while deletion is in flight', async () => {
  const first = { ...EMPTY_CARD, name: 'A', uid: 'uid-a' }
  const other = { ...EMPTY_CARD, name: 'Other', uid: 'uid-other' }
  mock.dbSnapshot = [first, other]
  const store = useCharacterStore.getState()
  await store.load()
  store.updateField('A', 'name', 'B')
  let finish!: (value: unknown) => void
  mock.commit.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  const deleting = store.deleteCharacter('B')
  store.updateField('B', 'name', 'C')
  store.updateField('Other', 'relations', '[{"target":"C"}]')
  finish({ success: true, cards: [other] })
  await deleting
  expect(useCharacterStore.getState().characters).toEqual([other])
})

describe('addCharacter 默认名', () => {
  it('默认名使用 i18n 文案（无随机后缀）', () => {
    useCharacterStore.getState().addCharacter()
    const names = useCharacterStore.getState().characters.map(c => c.name)
    expect(names).toEqual(['新角色'])
    expect(names[0]).not.toMatch(/新角色_[a-z0-9]{4}/)
  })

  it('重复添加时数字序号去重（新角色 → 新角色 2）', () => {
    useCharacterStore.getState().addCharacter()
    useCharacterStore.getState().addCharacter()
    const names = useCharacterStore.getState().characters.map(c => c.name)
    expect(names).toEqual(['新角色', '新角色 2'])
  })

  it('序号跳过与已有名字的冲突', () => {
    // 预置「新角色 2」，新添加应跳过 2 取 3
    useCharacterStore.setState({
      characters: [
        { ...useCharacterStore.getState().characters[0], name: '新角色' },
        { ...useCharacterStore.getState().characters[0], name: '新角色 2' },
      ],
    })
    useCharacterStore.getState().addCharacter()
    const names = useCharacterStore.getState().characters.map(c => c.name)
    expect(names).toContain('新角色 3')
    expect(names).not.toContain('新角色 2 ') // 不允许重名
  })
})

describe('renameMap 改名捕获与级联（#34 块 B）', () => {
  const card = (name: string, relations = '[]') => ({
    ...useCharacterStore.getState().characters[0], name, relations,
  })

  it('改名记录映射（旧名 → 新名）', () => {
    useCharacterStore.setState({ characters: [card('旧名')] })
    useCharacterStore.getState().updateField('旧名', 'name', '新名')
    expect(useCharacterStore.getState().renameMap).toEqual({ 旧名: '新名' })
  })

  it('链式改名压缩（A→B 再 B→C → A→C）', () => {
    useCharacterStore.setState({ characters: [card('旧名')] })
    useCharacterStore.getState().updateField('旧名', 'name', '中间名')
    useCharacterStore.getState().updateField('中间名', 'name', '最终名')
    expect(useCharacterStore.getState().renameMap).toEqual({ 旧名: '最终名' })
  })
})

describe('transactional character saves', () => {
  const card = (name: string, relations = '[]') => ({ ...EMPTY_CARD, uid: `id:${name}`, name, relations })

  it('preserves failed input, selection and the rename map', async () => {
    const before = card('Old')
    mock.dbSnapshot = [before]
    const store = useCharacterStore.getState()
    await store.load()
    store.updateField('Old', 'name', 'New')
    mock.commit.mockResolvedValueOnce({ success: false, error: 'db error' })
    await expect(store.saveAll()).rejects.toThrow('db error')
    expect(useCharacterStore.getState()).toMatchObject({ dirty: true, selectedName: 'New', renameMap: { Old: 'New' } })
  })

  it('sends only edited rows and accepts transactionally rewritten relations and concurrent additions', async () => {
    const before = card('Old')
    const observer = card('Observer', '[{"target":"Old","label":"ally"}]')
    const concurrent = card('Concurrent')
    const renamed = { ...before, name: 'New' }
    const rewritten = { ...observer, relations: '[{"target":"New","label":"ally"}]' }
    mock.dbSnapshot = [before, observer]
    const store = useCharacterStore.getState()
    await store.load()
    store.updateField('Old', 'name', 'New')
    mock.commit.mockResolvedValueOnce({ success: true, cards: [renamed, rewritten, concurrent] })
    await store.saveAll()
    expect(mock.commit).toHaveBeenCalledWith({ scope: { projectPath: '/book', token: 'db' }, edits: [{ before, after: renamed }] })
    expect(useCharacterStore.getState()).toMatchObject({ characters: [renamed, rewritten, concurrent], dirty: false, renameMap: {} })
  })

  it('rejects duplicate names before issuing the transaction', async () => {
    mock.dbSnapshot = [card('A'), card('B')]
    const store = useCharacterStore.getState()
    await store.load()
    store.updateField('A', 'name', 'B')
    await expect(store.saveAll()).rejects.toThrow('角色名重复')
    expect(mock.commit).not.toHaveBeenCalled()
    expect(useCharacterStore.getState().dirty).toBe(true)
  })

  it('does not publish a commit after a same-path reopen', async () => {
    const before = card('A')
    mock.dbSnapshot = [before]
    const store = useCharacterStore.getState()
    await store.load()
    store.updateField('A', 'notes', 'pending')
    mock.commit.mockImplementationOnce(async () => {
      ++mock.project.projectSession
      return { success: true, cards: [{ ...before, notes: 'old response' }] }
    })
    await expect(store.saveAll()).rejects.toThrow()
    expect(useCharacterStore.getState().characters[0].notes).toBe('pending')
    expect(useCharacterStore.getState().dirty).toBe(true)
  })

  it('leaves manually named parenthesized characters intact when reloading', async () => {
    const before = card('A（chosen alias）')
    mock.dbSnapshot = [before]
    await useCharacterStore.getState().load(true)
    expect(useCharacterStore.getState().characters).toEqual([before])
    expect(mock.commit).not.toHaveBeenCalled()
    expect(mock.savedCalls).toEqual([])
    expect(mock.deletedCalls).toEqual([])
  })
})
