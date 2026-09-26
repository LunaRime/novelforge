// @vitest-environment jsdom
/**
 * read_memory — 模型按名/关键词取作品记忆正文（C 档第一轮）。
 * 契约要点：manual 也放行（显式指定即「明确引用」）；未知名 → 错误 + 目录；
 * 关键词检索零 LLM 成本且对正则元字符安全。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readMemoryTool } from './read-memory.tool'
import { buildSharedFile } from '../../memory/shared-memory'
import { t } from '../../../shared/locale'

const LIST = [
  { file: 'book-state.md', kind: 'book', loadMode: 'manual', brief: '主角是苏晚晴', stale: false, mtime: 1 },
  { file: 'chapters-001-015.md', kind: 'chapters', loadMode: 'auto', brief: '关键事件：主角觉醒', range: '001-015', stale: false, mtime: 2 },
  { file: 'shared.md', kind: 'shared', loadMode: 'auto', brief: '用户偏好爽文节奏', stale: false, mtime: 3 },
]

const BODIES: Record<string, string> = {
  'book-state.md': '---\nload_mode: manual\n---\n# 全书精要\n\n主角是苏晚晴，复仇线为主。',
  'chapters-001-015.md': '---\nrange: 001-015\n---\n\n# 章节记忆 001-015\n\n## 第 1 章 · 开局\n- 关键事件：主角觉醒',
  'shared.md': buildSharedFile(['用户偏好爽文节奏', '主角名苏晚晴']),
}

beforeEach(() => {
  Object.defineProperty(window, 'velaAPI', {
    value: {
      invoke: vi.fn(async (ch: string, file?: string) => {
        if (ch === 'memory:list') return LIST
        if (ch === 'memory:read') return BODIES[file ?? ''] ?? null
        return null
      }),
    },
    configurable: true,
  })
})

describe('read_memory 工具', () => {
  it('只读、免确认（buildAgentTool 默认 isReadOnly = !requiresConfirmation）', () => {
    expect(readMemoryTool.requiresConfirmation).toBe(false)
    expect(readMemoryTool.isReadOnly).toBe(true)
  })

  it('按名取全文：manual 也放行（显式指定 = 明确引用）；返回正文而非 frontmatter 噪音', async () => {
    const res = await readMemoryTool.execute({ name: 'book-state' })     // 去后缀名可接受
    expect(res.success).toBe(true)
    expect(res.content).toContain('主角是苏晚晴，复仇线为主。')
    expect(res.content).not.toContain('load_mode')
  })

  it('未知名 → 失败 + 附可用记忆目录（模型能自行改道）', async () => {
    const res = await readMemoryTool.execute({ name: 'nope' })
    expect(res.success).toBe(false)
    expect(res.error).toContain('nope')
    expect(res.error).toContain('shared')      // 目录里点名可用文件
  })

  it('关键词：命中 name/kind/brief/正文并给出位置提示；正则元字符不抛错', async () => {
    const hit = await readMemoryTool.execute({ keyword: '觉醒' })
    expect(hit.success).toBe(true)
    expect(hit.content).toContain('chapters-001-015')
    expect(hit.content).toContain('关键事件：主角觉醒')
    const meta = await readMemoryTool.execute({ keyword: '第1章(' })
    expect(meta.success).toBe(true)            // 无命中也是成功（内容为空提示）
    expect(meta.content).toContain(t('tool.readMemoryNoMatch').split('{')[0])
  })

  it('type 过滤：只检索指定 kind', async () => {
    const res = await readMemoryTool.execute({ keyword: '苏晚晴', type: 'shared' })
    expect(res.content).toContain('shared')
    expect(res.content).not.toContain('book-state')
  })

  it('无参数 → 返回名字目录（与注入的目录段同源；含 kind 标签）', async () => {
    const res = await readMemoryTool.execute({})
    expect(res.success).toBe(true)
    expect(res.content).toContain('[共享] shared')
    expect(res.content).toContain('[全书][manual] book-state')
  })

  it('无记忆文件 → 明确空态提示（不是失败）', async () => {
    const invokeMock = window.velaAPI.invoke as ReturnType<typeof vi.fn>
    invokeMock.mockImplementation(async (ch: string) => (ch === 'memory:list' ? [] : null))
    const res = await readMemoryTool.execute({})
    expect(res.success).toBe(true)
    expect(res.content).toBe(t('tool.readMemoryEmpty'))
  })
})

describe('read_memory 在工具提示词中的契约可见性（1200 token 截断线内）', () => {
  it('被截断也要给得出签名：base 段含 read_memory(name?, keyword?, type?)', async () => {
    vi.resetModules()   // 干净模块图：工具/上下文构建器共用同一注册表单例
    const { registerBuiltinTools } = await import('./index')
    const { buildAgentSystemSegments } = await import('../context-builder')
    const { toolRegistry } = await import('../tool-registry')
    registerBuiltinTools()
    // 实测（C 档第一轮 T4）：30 个工具共 5435 tokens，1200 的截断落在**第 2 个工具内部** ——
    // 「排靠前」救不了后面的工具，故截断通知改为携带**全部工具的签名**；只列名字
    // 会让模型知道有 read_memory 却不知道参数名（= 不可调用）。
    const { base } = buildAgentSystemSegments('balanced')
    expect(base).toContain('read_memory(name?, keyword?, type?)')
    expect(toolRegistry.get('read_memory')?.requiresConfirmation).toBe(false)
  })
})
