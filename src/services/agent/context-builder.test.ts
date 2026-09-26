// @vitest-environment jsdom
/**
 * context-builder — Agent system prompt 输出语言约束测试（#30）
 * 此前仅 identityRuleLanguage 弱约束（"Reply in the user's language" 不指明具体语言），
 * 英文界面下 Agent 仍回中文。修复后末尾追加 appendOutputLanguage 明确语言指令。
 * P1 追加：M2/M1 分段落库、M2 在前（F2）、总上限 4700 降级顺序（F1）、章节尾部节选（F5）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildAgentSystemPrompt,
  buildAgentSystemSegments,
  buildAgentSystemSegmentsAsync,
  buildAgentSystemPromptAsync,
  assembleFinalPrompt,
} from './context-builder'
import { estimateTokens } from './token-budget'
import { useAgentStore } from '../../stores/agent-store'
import { skillRegistry } from './skill-registry'
import { buildSharedFile } from '../memory/shared-memory'

describe('buildAgentSystemPrompt 输出语言约束', () => {
  it('末尾包含明确输出语言指令', () => {
    const prompt = buildAgentSystemPrompt('quick')
    expect(prompt).toContain('[System] 请始终使用')
    expect(prompt).toContain('Do not respond in any other language')
    // 语言指令位于末尾（优先级最高）
    expect(prompt.trim().endsWith('Do not respond in any other language.')).toBe(true)
  })
})

describe('buildAgentSystemSegments M1 会话摘要', () => {
  it('无滚动摘要时不注入记忆节', () => {
    useAgentStore.setState({ conversations: [], activeConversationId: null })
    const { memory } = buildAgentSystemSegments('quick')
    expect(memory).toBe('')
  })

  it('有滚动摘要时注入「自动生成」标注节', () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? { ...c, rollingSummary: '用户要求写甜文，已确认主角性格' } : c),
    }))
    const { memory } = buildAgentSystemSegments('quick')
    expect(memory).toContain('用户要求写甜文，已确认主角性格')
    expect(memory).toContain('自动生成') // 标注非用户输入
  })

  it('超 300 tokens 预算时记忆节被裁剪', () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? { ...c, rollingSummary: '长摘要'.repeat(400) } : c),
    }))
    const { memory } = buildAgentSystemSegments('quick')
    expect(memory.length).toBeLessThan(600)
  })

  it('语言指令保持在最终 prompt 最末尾（#30 语义不变）', () => {
    const prompt = buildAgentSystemPrompt('quick')
    expect(prompt.trim().endsWith('Do not respond in any other language.')).toBe(true)
  })
})

describe('M2 作品记忆节（P1）', () => {
  const mockInvoke = vi.fn(async (ch: string): Promise<unknown> => {
    if (ch === 'memory:list') return [{ file: 'chapters-001-015.md', kind: 'chapters', stale: false, mtime: 1 }]
    if (ch === 'memory:read') return '---\nrange: 001-015\n---\n\n## 第 1 章 · 开局\n- 关键事件：主角觉醒'
    return null
  })

  beforeEach(() => {
    mockInvoke.mockImplementation(async (ch: string) => {
      if (ch === 'memory:list') return [{ file: 'chapters-001-015.md', kind: 'chapters', stale: false, mtime: 1 }]
      if (ch === 'memory:read') return '---\nrange: 001-015\n---\n\n## 第 1 章 · 开局\n- 关键事件：主角觉醒'
      return null
    })
    Object.defineProperty(window, 'velaAPI', { value: { invoke: mockInvoke }, configurable: true })
    useAgentStore.setState({ conversations: [], activeConversationId: null })
  })

  it('有记忆文件时 memoryM2 段含 M2 节', async () => {
    const { memoryM2 } = await buildAgentSystemSegmentsAsync('quick')
    expect(memoryM2).toContain('作品记忆')
    expect(memoryM2).toContain('主角觉醒')
  })

  it('读取失败降级：memoryM2 为空（仅 M1，不阻塞）', async () => {
    mockInvoke.mockResolvedValue(null)
    const { memoryM2 } = await buildAgentSystemSegmentsAsync('quick')
    expect(memoryM2).toBe('')
  })

  it('M2 作品记忆段位于 M1 会话摘要段之前（F2：M2 稳定在前）', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? { ...c, rollingSummary: '用户要求写甜文，已确认主角性格' } : c),
    }))
    mockInvoke.mockImplementation(async (ch: string) => {
      if (ch === 'memory:list') return [{ file: 'book-state.md', kind: 'book', stale: false, mtime: 1 }]
      if (ch === 'memory:read') return '---\n---\n\n# 全书精要\n主角是苏晚晴'
      return null
    })
    const { memoryM1, memoryM2 } = await buildAgentSystemSegmentsAsync('quick')
    expect(memoryM1).toContain('用户要求写甜文')
    expect(memoryM2).toContain('苏晚晴')
    // 最终拼装顺序：base → M2 → M1（M1 索引须大于 M2）
    const prompt = await buildAgentSystemPromptAsync('quick')
    const m2Idx = prompt.indexOf('苏晚晴')
    const m1Idx = prompt.indexOf('用户要求写甜文')
    expect(m2Idx).toBeGreaterThan(0)
    expect(m1Idx).toBeGreaterThan(m2Idx)
  })

  it('kind=unknown 文件（用户手放 notes.md）不参与 M2 节选（F9）', async () => {
    mockInvoke.mockImplementation(async (ch: string, file?: string) => {
      if (ch === 'memory:list') return [
        { file: 'notes.md', kind: 'unknown', stale: false, mtime: 1 },
        { file: 'book-state.md', kind: 'book', stale: false, mtime: 1 },
      ]
      if (ch === 'memory:read') return file === 'notes.md'
        ? '# notes 私人笔记\n不该注入的内容'
        : '---\n---\n\n# 全书精要\n主角是苏晚晴'
      return null
    })
    const { memoryM2 } = await buildAgentSystemSegmentsAsync('quick')
    expect(memoryM2).toContain('苏晚晴') // book 正常注入
    expect(memoryM2).not.toContain('不该注入的内容') // unknown 文件内容被排除
  })

  it('章节文件尾部节选：满窗口时注入最新章节而非最早章节（F5）', async () => {
    const blocks: string[] = []
    for (let n = 1; n <= 15; n++) {
      blocks.push([
        `## 第 ${n} 章 · 标题${n}`,
        `- 关键事件：第${n}章事件${'详'.repeat(60)}`,
        `- 出场角色：角色${n}`,
        `- 伏笔：伏笔${n}`,
        `- 新设定：设定${n}`,
        `- 当前状态：状态${n}`,
      ].join('\n'))
    }
    mockInvoke.mockImplementation(async (ch: string) => {
      if (ch === 'memory:list') return [{ file: 'chapters-001-015.md', kind: 'chapters', stale: false, mtime: 1 }]
      if (ch === 'memory:read') return `---\nrange: 001-015\n---\n\n# 章节记忆 001-015\n\n${blocks.join('\n\n')}`
      return null
    })
    const { memoryM2 } = await buildAgentSystemSegmentsAsync('quick')
    expect(memoryM2).toContain('## 第 15 章 · 标题15') // 最新章节在节选内
    expect(memoryM2).toContain('## 第 14 章 · 标题14')
    expect(memoryM2).not.toContain('## 第 1 章 · 标题1') // 最早章节被丢弃
    expect(memoryM2).not.toContain('## 第 2 章 · 标题2')
  })

  it('P3：kind=shared 文件参与 M2 节选（unknown 仍不注入）', async () => {
    mockInvoke.mockImplementation(async (ch: string, file?: string) => {
      if (ch === 'memory:list') return [
        { file: 'shared.md', kind: 'shared', stale: false, mtime: 3 },
        { file: 'notes.md', kind: 'unknown', stale: false, mtime: 2 },
      ]
      if (ch === 'memory:read') return file === 'shared.md'
        ? buildSharedFile(['用户偏好爽文节奏', '主角名苏晚晴'])
        : '# notes 私人笔记\n不该注入的内容'
      return null
    })
    const { memoryM2 } = await buildAgentSystemSegmentsAsync('quick')
    expect(memoryM2).toContain('用户偏好爽文节奏') // shared 注入
    expect(memoryM2).toContain('主角名苏晚晴')
    expect(memoryM2).not.toContain('不该注入的内容') // unknown 文件仍被排除
  })

  it('P3：shared 段保底——book 占满预算时 shared 保底配额仍注入', async () => {
    const bigBook = `# 全书精要\n${'详'.repeat(1200)}` // 启发式 >800 tokens，单段必触发截断
    mockInvoke.mockImplementation(async (ch: string, file?: string) => {
      if (ch === 'memory:list') return [
        { file: 'shared.md', kind: 'shared', stale: false, mtime: 1 },
        { file: 'book-state.md', kind: 'book', stale: false, mtime: 1 },
      ]
      if (ch === 'memory:read') return file === 'shared.md'
        ? buildSharedFile(['用户偏好爽文节奏'])
        : bigBook
      return null
    })
    const { memoryM2 } = await buildAgentSystemSegmentsAsync('quick')
    expect(memoryM2).toContain('用户偏好爽文节奏') // shared 没被 book 挤出
    expect(memoryM2).toContain('全书精要') // book 仍有节选
  })
})

describe('技能目录段（B 档第一轮）', () => {
  // 用 project 来源：目录按 项目>用户>内置 排序，测试技能才能稳定排在（可能残留的）内置技能之前
  const reg = (name: string, displayName: string, userInvocable = true) =>
    skillRegistry.register({
      metadata: { name, displayName, description: `描述-${name}`, userInvocable },
      content: `正文-${name}`,
      source: 'project',
      baseDir: '',
      filePath: `/tmp/${name}/SKILL.md`,
    })

  beforeEach(() => {
    reg('cb-skill-x', '目录技能X')
    reg('cb-skill-hidden', '目录技能Hidden', false)
  })

  it('系统提示词含技能目录段（displayName 与 name）', () => {
    // 诊断：注册表内容（失败时会打印实际值）
    expect(skillRegistry.listAll().map(s => s.metadata.name)).toContain('cb-skill-x')
    const { base } = buildAgentSystemSegments('balanced')
    // 诊断：目录段是否被 push（文案随 locale 变化，用宽匹配）
    expect(base).toMatch(/可用技能|Available skills|Доступные навыки/)
    expect(base).toContain('目录技能X')
    expect(base).toContain('cb-skill-x')
  })

  it('userInvocable:false 的技能也在目录里（该字段只约束 /命令）', () => {
    const { base } = buildAgentSystemSegments('balanced')
    expect(base).toContain('cb-skill-hidden')
  })

  it('目录段超预算时截断并提示剩余数量', () => {
    for (let i = 0; i < 60; i++) {
      reg(`cb-bulk-${i}`, `批量技能${i}`, true)
    }
    const { base } = buildAgentSystemSegments('balanced')
    expect(base).toMatch(/还有|and \d+ more/)   // 剩余提示（三语文案之一）
  })

  it('工具提示词里不再出现 skill__ 前缀（收敛为元工具）', () => {
    const { base } = buildAgentSystemSegments('balanced')
    expect(base).not.toContain('skill__')
  })

  it('单条超长描述不会清空目录（跳过长行而非中断，评审 I2）', () => {
    // 隔离环境：清空后只留"一条超长 + 一条正常"，且长描述排最前（同 source 按注册序）
    skillRegistry.clear()
    skillRegistry.register({
      metadata: { name: 'cb-huge-desc', displayName: '超长描述技能', description: '很长的描述'.repeat(200), userInvocable: true },
      content: '正文',
      source: 'project',
      baseDir: '',
      filePath: '/tmp/cb-huge-desc/SKILL.md',
    })
    skillRegistry.register({
      metadata: { name: 'cb-normal', displayName: '正常技能', description: '短描述', userInvocable: true },
      content: '正文',
      source: 'project',
      baseDir: '',
      filePath: '/tmp/cb-normal/SKILL.md',
    })
    const { base } = buildAgentSystemSegments('balanced')
    // break 会让长描述把预算吃光 → 后面的正常技能全消失；正确实现应跳过长行
    expect(base).toContain('cb-normal')
  })
})

describe('上下文逐段明细（B 档第二轮 T5）', () => {
  it('逐段给出 key / tokens / chars', () => {
    const { segments } = buildAgentSystemSegments('balanced')
    const keys = segments.map(s => s.key)
    expect(keys).toContain('identity')
    expect(keys).toContain('tools')
    for (const seg of segments) {
      expect(seg.tokens).toBeGreaterThan(0)
      expect(seg.chars).toBeGreaterThan(0)
    }
  })

  it('关键段带来源描述（明细面板要能回答"这段来自哪"）', () => {
    const { segments } = buildAgentSystemSegments('balanced')
    expect(segments.find(s => s.key === 'tools')?.source).toBeTruthy()
    expect(segments.find(s => s.key === 'skill-catalog')?.source).toBeTruthy()
  })

  it('未触发截断的段不标 truncated', () => {
    const { segments } = buildAgentSystemSegments('balanced')
    expect(segments.find(s => s.key === 'identity')?.truncated).toBeFalsy()
  })
})

describe('assembleFinalPrompt 总上限与降级顺序（F1）', () => {
  const big = '内容'.repeat(4000) // 启发式 ~6000 tokens

  it('超限时最终 prompt 尺寸 ≤ 4700（新上限，P0 3800 回归）', () => {
    const out = assembleFinalPrompt({ base: '## 身份', memoryM1: `M1=${big}`, memoryM2: `M2=${big}` })
    expect(estimateTokens(out)).toBeLessThanOrEqual(4700)
  })

  it('降级顺序：先丢 M1（会话摘要），M2 保留', () => {
    const out = assembleFinalPrompt({ base: '## 身份', memoryM1: `M1=${big}`, memoryM2: 'M2=内容' })
    expect(out).toContain('M2=内容') // M2 优先保留
    expect(out).not.toContain('M1=') // M1 已丢
    expect(estimateTokens(out)).toBeLessThanOrEqual(4700)
  })

  it('降级顺序：M1 丢后仍超限 → M2 一并丢弃', () => {
    const out = assembleFinalPrompt({ base: '## 身份', memoryM1: `M1=${big}`, memoryM2: `M2=${big}` })
    expect(out).not.toContain('M1=')
    expect(out).not.toContain('M2=')
    expect(estimateTokens(out)).toBeLessThanOrEqual(4700)
  })

  it('降级顺序：M1/M2 全丢后仍超限 → L1 裁剪（base 拆节）', () => {
    // 身份 3000 + 编辑器 1800 + 工具 900 = 5700；L1 替换后 3915 ≤ 4700 → 不需 Tool 裁剪
    const base = [
      `## 身份\n${'身'.repeat(2000)}`,
      `## 编辑器状态\n${'编'.repeat(1200)}`,
      `## 工具系统\n${'工'.repeat(600)}`,
    ].join('\n\n---\n\n')
    const out = assembleFinalPrompt({ base, memoryM1: `M1=${big}`, memoryM2: `M2=${big}` })
    expect(out).not.toContain('M1=')
    expect(out).not.toContain('M2=')
    expect(out).toContain('（内容过长已省略') // L1 段被替换为省略提示
    expect(out).not.toContain('（工具列表已截断）') // 未走到 Tool 裁剪
    expect(estimateTokens(out)).toBeLessThanOrEqual(4700)
  })

  it('降级顺序：L1 裁剪后仍超限 → Tool 段截断 + 兜底硬截断仍保证 ≤ 4700', () => {
    const base = [
      `## 身份\n${'身'.repeat(3000)}`,
      `## 编辑器状态\n${'编'.repeat(1000)}`,
      `## 工具系统\n${'工'.repeat(2000)}`,
    ].join('\n\n---\n\n')
    const out = assembleFinalPrompt({ base, memoryM1: `M1=${big}`, memoryM2: `M2=${big}` })
    expect(out).toContain('（内容过长已省略')
    expect(out).toContain('（工具列表已截断）')
    expect(estimateTokens(out)).toBeLessThanOrEqual(4700)
  })

  it('未超限时不裁剪（M1/M2 均保留）', () => {
    const out = assembleFinalPrompt({ base: '## 身份', memoryM1: 'M1=小摘要', memoryM2: 'M2=小记忆' })
    expect(out).toContain('M1=小摘要')
    expect(out).toContain('M2=小记忆')
  })
})
