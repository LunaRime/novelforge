// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildBookSummaryFile, rebuildBookState, maybeTriggerBookState } from './book-memory'
import { ensureVolumeSummary } from './chapter-memory'
import { parseMemoryFile } from './memory-codec'

// mock IPC（memory:read/write/list 通道，chapter-memory.test.ts 先例）
const memoryFiles = new Map<string, string>()
// memory:list 从内存文件表派生（kind 判定与 controller classifyMemoryFileKind 同口径）
const listFiles = (): { file: string; kind: 'chapters' | 'volume' | 'book' | 'unknown'; stale: boolean }[] =>
  [...memoryFiles.keys()].map(file => ({
    file,
    kind: file === 'book-state.md' ? 'book' as const : file.startsWith('chapters-') ? 'chapters' as const : file.startsWith('volume-') ? 'volume' as const : 'unknown' as const,
    stale: parseMemoryFile(memoryFiles.get(file) ?? '')?.frontmatter.status === 'stale',
  }))
const mockInvoke = vi.fn(async (ch: string, ...args: unknown[]) => {
  switch (ch) {
    case 'memory:read':
      return memoryFiles.get(String(args[0])) ?? null
    case 'memory:write': {
      memoryFiles.set(String(args[0]), String(args[1]))
      return { success: true }
    }
    case 'memory:list':
      return listFiles()
    default:
      return null
  }
})

beforeEach(() => {
  memoryFiles.clear()
  mockInvoke.mockReset()
  mockInvoke.mockImplementation(async (ch: string, ...args: unknown[]) => {
    switch (ch) {
      case 'memory:read':
        return memoryFiles.get(String(args[0])) ?? null
      case 'memory:write': {
        memoryFiles.set(String(args[0]), String(args[1]))
        return { success: true }
      }
      case 'memory:list':
        return listFiles()
      default:
        return null
    }
  })
  Object.defineProperty(window, 'velaAPI', { value: { invoke: mockInvoke }, configurable: true })
})

/** P1 卷摘要文件形态（buildVolumeSummaryFile 产物），用于 rebuildBookState 聚合输入 */
const volumeFile = (volumeNumber: number, range: string, entries: { n: number; title: string; keyEvents: string }[]): string => [
  '---', `volume: ${volumeNumber}`, `range: ${range}`, '---', '',
  `# 第 ${volumeNumber} 卷 · 卷${volumeNumber}`,
  ...entries.flatMap(({ n, title, keyEvents }) => [
    '', `## 第 ${n} 章 · ${title}`, `- 关键事件：${keyEvents}`,
    '- 出场角色：无', '- 伏笔：无', '- 新设定：无', '- 当前状态：无',
  ]),
].join('\n')

describe('buildBookSummaryFile（聚合纯函数）', () => {
  it('frontmatter 含 updatedAt 与卷范围', () => {
    const content = buildBookSummaryFile([{ volumeNumber: 1, range: '1-15' }], [])
    expect(content).toContain('updatedAt:')
    expect(content).toContain('volumes: 1')
  })

  it('聚合卷章节条目', () => {
    const content = buildBookSummaryFile(
      [{ volumeNumber: 1, range: '1-15' }],
      [{ volumeNumber: 1, chapters: [{ chapterNumber: 1, title: '开局', keyEvents: '主角觉醒', characters: '苏晚晴', foreshadowing: '虚晶', newElements: '武魂', currentState: '筑基' }] }],
    )
    expect(content).toContain('第 1 章 · 开局')
    expect(content).toContain('主角觉醒')
  })

  it('多卷聚合：每卷节选 + frontmatter volumes 计数', () => {
    const content = buildBookSummaryFile(
      [{ volumeNumber: 1, range: '1-15' }, { volumeNumber: 2, range: '16-30' }],
      [{ volumeNumber: 1, chapters: [{ chapterNumber: 1, title: '开局', keyEvents: 'A', characters: '', foreshadowing: '', newElements: '', currentState: '' }] }],
    )
    expect(content).toContain('volumes: 2')
    expect(content).toContain('## 第 1 卷 · 范围 1-15')
    expect(content).toContain('第 1 章 · 开局')
  })

  it('条目形态与 P1 卷摘要一致（六字段行）', () => {
    const content = buildBookSummaryFile(
      [{ volumeNumber: 1, range: '1-15' }],
      [{ volumeNumber: 1, chapters: [{ chapterNumber: 1, title: '开局', keyEvents: '主角觉醒', characters: '苏晚晴', foreshadowing: '虚晶', newElements: '武魂', currentState: '筑基' }] }],
    )
    expect(content).toContain('- 关键事件：主角觉醒')
    expect(content).toContain('- 出场角色：苏晚晴')
    expect(content).toContain('- 伏笔：虚晶')
    expect(content).toContain('- 新设定：武魂')
    expect(content).toContain('- 当前状态：筑基')
  })
})

describe('rebuildBookState（全书重建）', () => {
  it('无分卷 → 聚合最新章节文件（章节级，volumes: 0）', async () => {
    memoryFiles.set('chapters-001-015.md', [
      '# 章节记忆 001-015', '',
      '## 第 1 章 · 开局',
      '- 关键事件：主角觉醒',
      '- 出场角色：苏晚晴',
      '- 伏笔：虚晶',
      '- 新设定：武魂',
      '- 当前状态：筑基',
    ].join('\n'))
    const res = await rebuildBookState()
    expect(res).toEqual({ success: true, file: 'book-state.md' })
    const content = memoryFiles.get('book-state.md')!
    expect(content).toContain('volumes: 0')
    expect(content).toContain('第 1 章 · 开局')
    expect(content).toContain('主角觉醒')
  })

  it('有分卷 → 聚合全部非 stale volume-NNN.md（卷级，volumes: 2）', async () => {
    memoryFiles.set('volume-001.md', volumeFile(1, '1-15', [{ n: 1, title: '开局', keyEvents: '主角觉醒' }]))
    memoryFiles.set('volume-002.md', volumeFile(2, '16-30', [{ n: 16, title: '转折', keyEvents: '入城' }]))
    const res = await rebuildBookState()
    expect(res).toEqual({ success: true, file: 'book-state.md' })
    const content = memoryFiles.get('book-state.md')!
    expect(content).toContain('volumes: 2')
    expect(content).toContain('## 第 1 卷 · 范围 1-15')
    expect(content).toContain('第 1 章 · 开局')
    expect(content).toContain('主角觉醒')
    expect(content).toContain('## 第 2 卷 · 范围 16-30')
    expect(content).toContain('第 16 章 · 转折')
    expect(content).toContain('入城')
  })

  it('stale 卷不参与聚合（与 M2 注入 fresh 口径一致）', async () => {
    memoryFiles.set('volume-001.md', '---\nvolume: 1\nrange: 1-15\nstatus: stale\n---\n\n# 第 1 卷 · 旧\n\n## 第 1 章 · 旧稿\n- 关键事件：旧事件\n')
    memoryFiles.set('volume-002.md', volumeFile(2, '16-30', [{ n: 16, title: '转折', keyEvents: '新事件' }]))
    const res = await rebuildBookState()
    expect(res.success).toBe(true)
    const content = memoryFiles.get('book-state.md')!
    expect(content).toContain('volumes: 1')
    expect(content).not.toContain('旧事件')
    expect(content).toContain('新事件')
  })

  it('无任何记忆文件 → 失败（file: null + reason）', async () => {
    const res = await rebuildBookState()
    expect(res.success).toBe(false)
    expect(res.file).toBeNull()
    expect(res.reason).toBeTruthy()
  })

  it('卷文件存在但全部 stale → 不降级回退（success:false + reason，不覆盖原多卷摘要）', async () => {
    // 已有双卷全书摘要（模拟重建前状态）
    memoryFiles.set('book-state.md', '---\nupdatedAt: 2026-08-20T00:00:00.000Z\nvolumes: 2\n---\n\n# 全书状态\n')
    // 全部卷文件 stale（卷边界编辑 collectAffectedFiles 批量标记场景）
    memoryFiles.set('volume-001.md', '---\nvolume: 1\nrange: 1-15\nstatus: stale\n---\n\n# 第 1 卷 · 旧\n\n## 第 1 章 · 旧稿\n- 关键事件：旧事件\n')
    memoryFiles.set('volume-002.md', '---\nvolume: 2\nrange: 16-30\nstatus: stale\n---\n\n# 第 2 卷 · 旧\n')
    // 存在 fresh 章节文件——若落入「无分卷」分支会聚合出单窗口降级版
    memoryFiles.set('chapters-001-015.md', '\n## 第 1 章 · 开局\n- 关键事件：主角觉醒\n')
    const res = await rebuildBookState()
    expect(res).toEqual({ success: false, file: null, reason: 'all volume files stale' })
    expect(memoryFiles.get('book-state.md')).toContain('volumes: 2')
    expect(memoryFiles.get('book-state.md')).not.toContain('主角觉醒')
  })

  it('完全无卷文件（仅章节文件）→ 无分卷降级路径不回归', async () => {
    memoryFiles.set('chapters-001-015.md', [
      '# 章节记忆 001-015', '',
      '## 第 1 章 · 开局',
      '- 关键事件：主角觉醒',
      '- 出场角色：苏晚晴',
      '- 伏笔：虚晶',
      '- 新设定：武魂',
      '- 当前状态：筑基',
    ].join('\n'))
    const res = await rebuildBookState()
    expect(res).toEqual({ success: true, file: 'book-state.md' })
    expect(memoryFiles.get('book-state.md')).toContain('volumes: 0')
  })
})

describe('maybeTriggerBookState（每满 3 卷检查点触发）', () => {
  it('非 stale 卷计数 2 → 不触发', async () => {
    memoryFiles.set('volume-001.md', volumeFile(1, '1-15', [{ n: 1, title: '开局', keyEvents: 'A' }]))
    memoryFiles.set('volume-002.md', volumeFile(2, '16-30', [{ n: 16, title: '转折', keyEvents: 'B' }]))
    expect(await maybeTriggerBookState()).toBe(false)
    expect(memoryFiles.has('book-state.md')).toBe(false)
  })

  it('非 stale 卷计数 3 → 触发重建', async () => {
    memoryFiles.set('volume-001.md', volumeFile(1, '1-15', [{ n: 1, title: '开局', keyEvents: 'A' }]))
    memoryFiles.set('volume-002.md', volumeFile(2, '16-30', [{ n: 16, title: '转折', keyEvents: 'B' }]))
    memoryFiles.set('volume-003.md', volumeFile(3, '31-45', [{ n: 31, title: '高潮', keyEvents: 'C' }]))
    expect(await maybeTriggerBookState()).toBe(true)
    const content = memoryFiles.get('book-state.md')!
    expect(content).toContain('volumes: 3')
    expect(content).toContain('第 31 章 · 高潮')
  })

  it('接线：卷聚合（ensureVolumeSummary）成功后每满 3 卷自动重建', async () => {
    // 3 个单章卷（覆盖三份章节文件；upsertChapterMemory 真实产物的块前带换行——split 依赖）
    memoryFiles.set('chapters-001-015.md', '\n## 第 1 章 · 开局\n- 关键事件：A\n')
    memoryFiles.set('chapters-016-030.md', '\n## 第 16 章 · 转折\n- 关键事件：B\n')
    memoryFiles.set('chapters-031-045.md', '\n## 第 31 章 · 高潮\n- 关键事件：C\n')
    // 卷 1 聚合 → 计数 1，不触发
    await ensureVolumeSummary({ volumeNumber: 1, title: '卷1', chapterStart: 1, chapterEnd: 1 })
    expect(memoryFiles.has('book-state.md')).toBe(false)
    // 卷 2 聚合 → 计数 2，不触发
    await ensureVolumeSummary({ volumeNumber: 2, title: '卷2', chapterStart: 16, chapterEnd: 16 })
    expect(memoryFiles.has('book-state.md')).toBe(false)
    // 卷 3 聚合 → 计数 3，触发
    await ensureVolumeSummary({ volumeNumber: 3, title: '卷3', chapterStart: 31, chapterEnd: 31 })
    const content = memoryFiles.get('book-state.md')!
    expect(content).toContain('volumes: 3')
    expect(content).toContain('第 1 章 · 开局')
    expect(content).toContain('第 16 章 · 转折')
    expect(content).toContain('第 31 章 · 高潮')
  })
})
