/**
 * skill-registry 装载测试（B 档第一轮 T3）
 *
 * 靶点：`loadFromDirectory` 此前**只认 `<目录>/SKILL.md`**，而设置页导入写的是扁平
 * `<name>.md`（skill-controller）→ UI 导入的技能永远不会被装载。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('../ipc-client', () => ({ ipc: { invoke: invokeMock } }))
vi.mock('../../stores/project-store', () => ({
  useProjectStore: { getState: () => ({ currentProject: null }) },
}))

import { skillRegistry } from './skill-registry'

const SKILL_MD = (name: string) => `---\nname: ${name}\ndescription: 描述-${name}\n---\n\n正文-${name}`

beforeEach(() => {
  invokeMock.mockReset()
})

describe('loadFromDirectory 两种形态（B 档第一轮 T3）', () => {
  it('装载 <dir>/SKILL.md（既有形态）', async () => {
    invokeMock.mockImplementation(async (ch: string, ...args: unknown[]) => {
      if (ch === 'fs:list-dir') {
        return [{ name: 't3-dir-skill', path: '/skills/t3-dir-skill', isDir: true }]
      }
      if (ch === 'fs:check-exists') return String(args[0]).endsWith('/t3-dir-skill/SKILL.md')
      if (ch === 'fs:read-file') return { success: true, content: SKILL_MD('t3-dir-skill') }
      return null
    })
    const n = await skillRegistry.loadFromDirectory('/skills', 'user')
    expect(n).toBe(1)
    expect(skillRegistry.get('t3-dir-skill')?.content).toContain('正文-t3-dir-skill')
  })

  it('装载扁平 <name>.md（与设置页导入格式对齐）', async () => {
    invokeMock.mockImplementation(async (ch: string) => {
      if (ch === 'fs:list-dir') {
        return [{ name: 't3-flat-skill.md', path: '/skills/t3-flat-skill.md', isDir: false }]
      }
      if (ch === 'fs:read-file') return { success: true, content: SKILL_MD('t3-flat-skill') }
      return null
    })
    const n = await skillRegistry.loadFromDirectory('/skills', 'user')
    expect(n).toBe(1)
    const loaded = skillRegistry.get('t3-flat-skill')
    expect(loaded?.content).toContain('正文-t3-flat-skill')
    expect(loaded?.baseDir).toBe('/skills')   // 扁平形态的 baseDir 取所在目录
  })

  it('两种形态同名时目录形态优先（后注册覆盖）', async () => {
    invokeMock.mockImplementation(async (ch: string, ...args: unknown[]) => {
      if (ch === 'fs:list-dir') {
        return [
          { name: 't3-dup.md', path: '/skills/t3-dup.md', isDir: false },
          { name: 't3-dup', path: '/skills/t3-dup', isDir: true },
        ]
      }
      if (ch === 'fs:check-exists') return String(args[0]).endsWith('/t3-dup/SKILL.md')
      if (ch === 'fs:read-file') {
        const p = String(args[0])
        return { success: true, content: p.includes('/t3-dup/') ? '目录形态正文' : '扁平形态正文' }
      }
      return null
    })
    await skillRegistry.loadFromDirectory('/skills', 'user')
    expect(skillRegistry.get('t3-dup')?.content).toBe('目录形态正文')
  })

  it('非 .md 的普通文件被忽略', async () => {
    invokeMock.mockImplementation(async (ch: string) => {
      if (ch === 'fs:list-dir') return [{ name: 'notes.txt', path: '/skills/notes.txt', isDir: false }]
      return null
    })
    expect(await skillRegistry.loadFromDirectory('/skills', 'user')).toBe(0)
  })
})
