/**
 * character-store — addCharacter 默认名测试（#29）
 * 角色名唯一主键：默认名用 i18n 文案 + 数字序号去重，不再产生「新角色_随机4位」垃圾名。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useCharacterStore } from './character-store'

beforeEach(() => {
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
