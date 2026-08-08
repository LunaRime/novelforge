/**
 * character-store 测试
 * - addCharacter 默认名（#29）：i18n 文案 + 数字序号去重
 * - renameMap 改名捕获/级联/重名校验（#34 块 B）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useCharacterStore } from './character-store'

// vi.hoisted：mock 工厂（hoisted）引用共享状态
const mock = vi.hoisted(() => ({
  savedCalls: [] as unknown[][],
  deletedCalls: [] as string[],
  dbSnapshot: [] as unknown[],
}))

vi.mock('../components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

vi.mock('../services/ipc-client', () => ({
  ipc: {
    invoke: vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'db:character-get-all') return mock.dbSnapshot
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
  useCharacterStore.getState().reset()
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

  it('saveAll 级联重写其他角色 relations 引用并清空映射', async () => {
    mock.dbSnapshot = [{ name: '旧名', relations: '[]' }, { name: '旁观者', relations: '[]' }]
    useCharacterStore.setState({ characters: [
      card('旧名', '[{"target":"旧名"}]'),
      card('旁观者', '[{"target":"旧名","label":"兄弟"}]'),
    ] })
    useCharacterStore.getState().updateField('旧名', 'name', '新名')
    await useCharacterStore.getState().saveAll()

    const saved = mock.savedCalls[0]?.[0] as Array<Record<string, unknown>>
    const observer = saved.find(c => c.name === '旁观者')
    expect(JSON.parse(String(observer?.relations))).toEqual([{ target: '新名', label: '兄弟' }])
    expect(useCharacterStore.getState().renameMap).toEqual({})
    expect(useCharacterStore.getState().dirty).toBe(false)
  })

  it('重名保存被拒绝（throw 且 dirty 保持）', async () => {
    useCharacterStore.setState({ characters: [card('甲'), card('甲')], dirty: true })
    await expect(useCharacterStore.getState().saveAll()).rejects.toThrow('角色名重复')
    expect(useCharacterStore.getState().dirty).toBe(true)
    expect(mock.savedCalls.length).toBe(0)
  })

  it('删除被改名角色后清理映射', async () => {
    useCharacterStore.setState({ characters: [card('旧名'), card('旁观者')] })
    useCharacterStore.getState().updateField('旧名', 'name', '新名')
    // 删除新名角色 → 映射作废
    await useCharacterStore.getState().deleteCharacter('新名')
    expect(useCharacterStore.getState().renameMap).toEqual({})
  })
})


describe('saveAll 语义（#34 块 C）', () => {
  const card = (name: string, relations = '[]') => ({
    ...useCharacterStore.getState().characters[0], name, relations,
  })

  it('主进程保存失败 → reject 且 dirty 保持（不误报成功）', async () => {
    // 整体替换实现：save-all 返回失败（get-all 等多通道调用不能用 mockImplementationOnce）
    const origImpl = vi.mocked(ipcInvoke).getMockImplementation()
    vi.mocked(ipcInvoke).mockImplementation(async (channel: unknown) => {
      if (channel === 'db:character-get-all') return mock.dbSnapshot
      if (channel === 'db:character-save-all') return { success: false, error: 'db error' }
      return { success: true }
    })
    try {
      useCharacterStore.setState({ characters: [card('甲')], dirty: true })
      await expect(useCharacterStore.getState().saveAll()).rejects.toThrow('db error')
      expect(useCharacterStore.getState().dirty).toBe(true)
    } finally {
      vi.mocked(ipcInvoke).mockImplementation(origImpl!)
    }
  })

  it('diff 收敛：DB 有而 store 无的非改名行不被删除（工作流并发新角色保留）', async () => {
    mock.dbSnapshot = [
      { name: '新角色', relations: '[]' },      // 并发新角色（store 未 load 到）→ 保留
      { name: '旧名', relations: '[]' },         // 改名旧名 → 删除
    ]
    useCharacterStore.setState({ characters: [card('旧名')] })
    useCharacterStore.getState().updateField('旧名', 'name', '新名')
    await useCharacterStore.getState().saveAll()
    expect(mock.deletedCalls).toEqual(['旧名']) // 只删改名旧名
  })
})

// 供 mockImplementationOnce 引用
import { ipc } from '../services/ipc-client'
const ipcInvoke = ipc.invoke as unknown as (...args: unknown[]) => Promise<unknown>
