// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  computeMemoryFileRange,
  buildChapterSummaryPrompt,
  buildVolumeSummaryFile,
  generateChapterSummary,
  upsertChapterMemory,
  ensureVolumeSummary,
} from './chapter-memory'
import { parseMemoryFile } from './memory-codec'
import { useLLMStore } from '../../stores/llm-store'

// mock IPC（memory:read/write / db:log-llm-call 通道，P0 agent-store.test.ts 先例）
const memoryFiles = new Map<string, string>()
// memory:list 从内存文件表派生（ensureVolumeSummary 全量扫描依赖，F6）；
// stale 状态按 frontmatter 解析（与真实 controller 同口径——失效规则测试依赖）
const listFiles = (): { file: string; kind: 'chapters' | 'volume' | 'book' | 'unknown'; stale: boolean }[] =>
  [...memoryFiles.keys()].map(file => ({
    file,
    kind: file.startsWith('chapters-') ? 'chapters' as const : file.startsWith('volume-') ? 'volume' as const : 'book' as const,
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
    case 'db:log-llm-call':
      return { success: true }
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
      case 'db:log-llm-call':
        return { success: true }
      default:
        return null
    }
  })
  Object.defineProperty(window, 'velaAPI', { value: { invoke: mockInvoke }, configurable: true })
  useLLMStore.setState({
    models: [],
    getModelForPurpose: () => null,
    generate: vi.fn(async () => ({
      success: true,
      content: '关键事件：主角击败魔王\n出场角色：主角、魔王\n伏笔：主角的剑\n新设定：魔族大陆\n当前状态：主角重伤',
    })),
  })
})

describe('computeMemoryFileRange（分卷边界对齐）', () => {
  const volumes = [
    { volumeNumber: 1, chapterStart: 1, chapterEnd: 15 },
    { volumeNumber: 2, chapterStart: 16, chapterEnd: 0 }, // 0 = 进行中
  ]

  it('命中分卷 → 卷范围文件', () => {
    expect(computeMemoryFileRange(8, volumes)).toEqual({ file: 'chapters-001-015.md', range: '001-015' })
  })

  it('进行中卷内 → 15 章滚动（章节号恒在范围内）', () => {
    // 卷 2 无上界：第 20 章 → 16-30 窗口
    expect(computeMemoryFileRange(20, volumes).file).toBe('chapters-016-030.md')
  })

  it('进行中卷超过 15 章 → 窗口随章节号滚动（审阅修正：不映射到卷起始固定窗口外）', () => {
    // 第 31 章（进行中卷从 16 起）→ 31-45 窗口，章节号恒在范围内
    expect(computeMemoryFileRange(31, volumes).file).toBe('chapters-031-045.md')
    expect(computeMemoryFileRange(45, volumes).file).toBe('chapters-031-045.md')
    expect(computeMemoryFileRange(46, volumes).file).toBe('chapters-046-060.md')
  })

  it('无分卷 → 15 章滚动对齐', () => {
    const r = computeMemoryFileRange(37, [])
    expect(r.file).toBe('chapters-031-045.md')
  })
})

describe('buildChapterSummaryPrompt', () => {
  it('包含章节号/标题/正文与输出字段要求', () => {
    const p = buildChapterSummaryPrompt(1, '开局', '正文内容')
    expect(p).toContain('第 1 章')
    expect(p).toContain('开局')
    expect(p).toContain('正文内容')
    expect(p).toContain('关键事件')
  })
})

describe('generateChapterSummary（LLM 六字段解析）', () => {
  it('解析六字段输出并返回条目', async () => {
    const entry = await generateChapterSummary({ chapterNumber: 7, chapterTitle: '决战', draftContent: '正文', modelId: 'test-model' })
    expect(entry.chapterNumber).toBe(7)
    expect(entry.title).toBe('决战')
    expect(entry.keyEvents).toBe('主角击败魔王')
    expect(entry.characters).toBe('主角、魔王')
    expect(entry.foreshadowing).toBe('主角的剑')
    expect(entry.newElements).toBe('魔族大陆')
    expect(entry.currentState).toBe('主角重伤')
  })

  it('LLM 调用失败 → throw（DAG 步骤容错依赖）', async () => {
    useLLMStore.setState({
      generate: vi.fn(async () => ({ success: false, error: 'boom', content: '' })),
    })
    await expect(
      generateChapterSummary({ chapterNumber: 7, chapterTitle: '决战', draftContent: '正文', modelId: 'test-model' }),
    ).rejects.toThrow('boom')
  })

  it('成功路径以 purpose memory_summary 落库且带真实 usage token 统计', async () => {
    useLLMStore.setState({
      generate: vi.fn(async () => ({
        success: true,
        content: '关键事件：A',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      })),
    })
    await generateChapterSummary({ chapterNumber: 7, chapterTitle: '决战', draftContent: '正文', modelId: 'test-model' })
    expect(mockInvoke).toHaveBeenCalledWith(
      'db:log-llm-call',
      expect.objectContaining({
        purpose: 'memory_summary',
        success: 1,
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      }),
    )
  })
})

describe('upsertChapterMemory（按章节号替换/追加 + stale 闭环）', () => {
  const entry = {
    chapterNumber: 3,
    title: '风起',
    keyEvents: '主角觉醒',
    characters: '主角',
    foreshadowing: '古剑',
    newElements: '灵气',
    currentState: '重伤',
  }

  it('追加新章节块到空文件', async () => {
    const res = await upsertChapterMemory(entry, 'chapters-001-015.md')
    expect(res).toEqual({ file: 'chapters-001-015.md', success: true })
    const content = memoryFiles.get('chapters-001-015.md')!
    expect(content).toContain('## 第 3 章 · 风起')
    expect(content).toContain('- 关键事件：主角觉醒')
    expect(content).toContain('- 伏笔：古剑')
  })

  it('替换既有块（仅替换 [idx, nextIdx) 区间，保留后续章节——防 filter 误删）', async () => {
    memoryFiles.set('chapters-001-015.md', [
      '## 第 2 章 · 旧题',
      '- 关键事件：旧事件',
      '',
      '## 第 4 章 · 后续',
      '- 关键事件：后续事件',
    ].join('\n'))
    await upsertChapterMemory(
      { ...entry, chapterNumber: 2, title: '新题', keyEvents: '新事件' },
      'chapters-001-015.md',
    )
    const content = memoryFiles.get('chapters-001-015.md')!
    expect(content).toContain('## 第 2 章 · 新题')
    expect(content).not.toContain('旧事件')
    expect(content).toContain('## 第 4 章 · 后续')
    expect(content).toContain('- 关键事件：后续事件')
  })

  it('写回清除 frontmatter status（stale 闭环：重定稿即恢复非 stale）', async () => {
    memoryFiles.set('chapters-001-015.md', '---\nrange: 001-015\nstatus: stale\n---\n\n## 第 1 章 · 开局\n- 关键事件：旧\n')
    await upsertChapterMemory(
      { ...entry, chapterNumber: 1, title: '开局', keyEvents: '新' },
      'chapters-001-015.md',
    )
    const content = memoryFiles.get('chapters-001-015.md')!
    expect(content).toContain('range: 001-015')
    expect(content).not.toContain('status')
    expect(content).toContain('- 关键事件：新')
  })

  it('写失败返回 success: false（DAG 步骤容错）', async () => {
    mockInvoke.mockImplementation(async (ch: string) => {
      if (ch === 'memory:write') throw new Error('disk full')
      return null
    })
    const res = await upsertChapterMemory(entry, 'chapters-001-015.md')
    expect(res.success).toBe(false)
  })
})

describe('buildVolumeSummaryFile / ensureVolumeSummary（卷级聚合）', () => {
  const volume = { volumeNumber: 1, title: '风起青萍', chapterStart: 1, chapterEnd: 2 }

  it('buildVolumeSummaryFile 组装卷头 + 条目（空字段降级「无」）', () => {
    const out = buildVolumeSummaryFile(volume, [
      { chapterNumber: 1, title: '开局', keyEvents: 'A', characters: '主角', foreshadowing: '', newElements: '', currentState: '' },
      { chapterNumber: 2, title: '转折', keyEvents: 'B', characters: '', foreshadowing: '剑', newElements: '灵气', currentState: '重伤' },
    ])
    expect(out).toContain('volume: 1')
    expect(out).toContain('range: 1-2')
    expect(out).toContain('# 第 1 卷 · 风起青萍')
    expect(out).toContain('## 第 1 章 · 开局')
    expect(out).toContain('- 伏笔：无')
    expect(out).toContain('- 当前状态：无')
    expect(out).toContain('## 第 2 章 · 转折')
  })

  it('进行中卷（chapterEnd=0）直接跳过', async () => {
    const res = await ensureVolumeSummary({ ...volume, chapterEnd: 0 })
    expect(res).toEqual({ file: null, success: false })
    expect(memoryFiles.size).toBe(0)
  })

  it('卷内条目不完整（未覆盖卷范围）→ 跳过', async () => {
    memoryFiles.set('chapters-001-015.md', '\n## 第 1 章 · 开局\n- 关键事件：A\n')
    const res = await ensureVolumeSummary(volume)
    expect(res).toEqual({ file: null, success: false })
    expect(memoryFiles.has('volume-001.md')).toBe(false)
  })

  it('卷内条目完整 → 生成 volume-001.md（零填充防字典序错排）', async () => {
    memoryFiles.set('chapters-001-015.md', [
      '',
      '## 第 1 章 · 开局',
      '- 关键事件：A',
      '- 出场角色：主角',
      '- 伏笔：剑',
      '- 新设定：灵气',
      '- 当前状态：重伤',
      '',
      '## 第 2 章 · 转折',
      '- 关键事件：B',
    ].join('\n'))
    const res = await ensureVolumeSummary(volume)
    expect(res).toEqual({ file: 'volume-001.md', success: true })
    const content = memoryFiles.get('volume-001.md')!
    expect(content).toContain('volume: 1')
    expect(content).toContain('range: 1-2')
    expect(content).toContain('# 第 1 卷 · 风起青萍')
    expect(content).toContain('## 第 1 章 · 开局')
    expect(content).toContain('## 第 2 章 · 转折')
  })

  it('F6：条目散落多窗口文件（卷创建晚于章节定稿的孤儿场景）→ 跨文件收集后聚合成功', async () => {
    // 卷 1-2 创建前：第 1 章落在 chapters-001-015.md，第 2 章落在 chapters-016-030.md（滚动窗口）
    memoryFiles.set('chapters-001-015.md', [
      '',
      '## 第 1 章 · 开局',
      '- 关键事件：A',
    ].join('\n'))
    memoryFiles.set('chapters-016-030.md', [
      '',
      '## 第 2 章 · 转折',
      '- 关键事件：B',
    ].join('\n'))
    const res = await ensureVolumeSummary(volume)
    expect(res).toEqual({ file: 'volume-001.md', success: true })
    const content = memoryFiles.get('volume-001.md')!
    expect(content).toContain('## 第 1 章 · 开局')
    expect(content).toContain('## 第 2 章 · 转折') // 跨文件收集
  })

  it('fix round 2：stale 文件条目不参与聚合（陈旧窗口不得胜出）', async () => {
    // 卷对齐窗口 chapters-001-002.md 新鲜；旧滚动窗口 chapters-001-015.md 已标 stale——
    // 后者字典序靠后（升序扫描最后处理），不过滤时会覆盖胜出 → 卷摘要用旧条目生成
    memoryFiles.set('chapters-001-002.md', [
      '',
      '## 第 1 章 · 开局',
      '- 关键事件：A',
      '',
      '## 第 2 章 · 转折',
      '- 关键事件：B',
    ].join('\n'))
    memoryFiles.set('chapters-001-015.md', [
      '---',
      'range: 001-015',
      'status: stale',
      '---',
      '',
      '## 第 1 章 · 旧开局',
      '- 关键事件：旧A',
      '',
      '## 第 2 章 · 旧转折',
      '- 关键事件：旧B',
    ].join('\n'))
    const res = await ensureVolumeSummary(volume)
    expect(res.success).toBe(true)
    const content = memoryFiles.get('volume-001.md')!
    expect(content).toContain('## 第 1 章 · 开局')
    expect(content).toContain('- 关键事件：A') // 新鲜窗口条目
    expect(content).not.toContain('旧A') // stale 文件条目被排除
    expect(content).not.toContain('旧开局')
  })

  it('F6：同章跨文件重复时较新窗口条目胜出（升序扫描去重）', async () => {
    memoryFiles.set('chapters-001-015.md', [
      '',
      '## 第 1 章 · 开局',
      '- 关键事件：A',
      '',
      '## 第 2 章 · 旧窗口',
      '- 关键事件：旧事件',
    ].join('\n'))
    memoryFiles.set('chapters-013-027.md', [
      '',
      '## 第 2 章 · 新窗口',
      '- 关键事件：新事件',
    ].join('\n'))
    const res = await ensureVolumeSummary(volume)
    expect(res.success).toBe(true)
    const content = memoryFiles.get('volume-001.md')!
    expect(content).toContain('## 第 2 章 · 新窗口')
    expect(content).not.toContain('旧窗口')
  })
})
