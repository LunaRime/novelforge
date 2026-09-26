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
    if (ch === 'memory:list') return [{ file: 'chapters-001-015.md', kind: 'chapters', loadMode: 'auto', brief: '关键事件：主角觉醒', stale: false, mtime: 1 }]
    if (ch === 'memory:read') return '---\nrange: 001-015\n---\n\n## 第 1 章 · 开局\n- 关键事件：主角觉醒'
    return null
  })

  beforeEach(() => {
    mockInvoke.mockImplementation(async (ch: string) => {
      if (ch === 'memory:list') return [{ file: 'chapters-001-015.md', kind: 'chapters', loadMode: 'auto', brief: '关键事件：主角觉醒', stale: false, mtime: 1 }]
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
      if (ch === 'memory:list') return [{ file: 'book-state.md', kind: 'book', loadMode: 'auto', brief: '主角是苏晚晴', stale: false, mtime: 1 }]
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
        { file: 'notes.md', kind: 'unknown', loadMode: 'auto', brief: '私人笔记', stale: false, mtime: 1 },
        { file: 'book-state.md', kind: 'book', loadMode: 'auto', brief: '主角是苏晚晴', stale: false, mtime: 1 },
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

  it('章节文件（auto）只进名字目录：brief 到模型，正文不进（分层后不再节选注入）', async () => {
    mockInvoke.mockImplementation(async (ch: string) => {
      if (ch === 'memory:list') return [{ file: 'chapters-001-015.md', kind: 'chapters', loadMode: 'auto', brief: '关键事件：主角觉醒', stale: false, mtime: 1 }]
      if (ch === 'memory:read') return '---\nrange: 001-015\n---\n\n# 章节记忆 001-015\n\n## 第 15 章 · 标题15\n- 关键事件：主角觉醒'
      return null
    })
    const { memoryM2 } = await buildAgentSystemSegmentsAsync('quick')
    expect(memoryM2).toContain('chapters-001-015')      // 目录里知道它存在
    expect(memoryM2).toContain('关键事件：主角觉醒')     // brief 有信息量
    expect(memoryM2).not.toContain('## 第 15 章')        // 正文不进（要正文用 read_memory）
  })

  it('P3 改造：shared 进名字目录（brief 到模型），正文不再自动注入；unknown 仍排除', async () => {
    mockInvoke.mockImplementation(async (ch: string, file?: string) => {
      if (ch === 'memory:list') return [
        { file: 'shared.md', kind: 'shared', loadMode: 'auto', brief: '用户偏好爽文节奏', stale: false, mtime: 3 },
        { file: 'notes.md', kind: 'unknown', loadMode: 'auto', brief: '私人笔记', stale: false, mtime: 2 },
      ]
      if (ch === 'memory:read') return file === 'shared.md'
        ? buildSharedFile(['用户偏好爽文节奏', '主角名苏晚晴'])
        : '# notes 私人笔记\n不该注入的内容'
      return null
    })
    const { memoryM2 } = await buildAgentSystemSegmentsAsync('quick')
    expect(memoryM2).toContain('用户偏好爽文节奏')   // brief 行
    expect(memoryM2).toContain('[共享]')             // kind 标签
    expect(memoryM2).not.toContain('主角名苏晚晴')   // 目录不含第二条正文
    expect(memoryM2).not.toContain('不该注入的内容')
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

describe('记忆分层注入（C 档第一轮）', () => {
  // ⚠️ 本 describe 自建 mock：既有的 mockInvoke 声明在 M2 那个 describe 内部，此处不在作用域内
  const layerList = (files: Array<{ file: string; kind: string; loadMode: string; brief: string; stale: boolean; mtime: number }>) => files
  let mockInvoke: ReturnType<typeof vi.fn>
  beforeEach(() => {
    mockInvoke = vi.fn(async (ch: string): Promise<unknown> => (ch === 'memory:list' ? [] : null))
    Object.defineProperty(window, 'velaAPI', { value: { invoke: mockInvoke }, configurable: true })
    useAgentStore.setState({ conversations: [], activeConversationId: null })
  })

  it('常驻文件：全文进 memoryResident 段（不节选）+ 逐段明细', async () => {
    const body = '# 全书精要\n\n主角是苏晚晴，复仇线为主。'
    mockInvoke.mockImplementation(async (ch: string, file?: string) => {
      if (ch === 'memory:list') return layerList([{ file: 'book-state.md', kind: 'book', loadMode: 'resident', brief: '主角是苏晚晴', stale: false, mtime: 1 }])
      if (ch === 'memory:read') return file === 'book-state.md' ? `---\nload_mode: resident\n---\n${body}` : null
      return null
    })
    const seg = await buildAgentSystemSegmentsAsync('quick')
    expect(seg.memoryResident).toContain('主角是苏晚晴，复仇线为主。')
    expect(seg.memoryM2).toBe('')                                  // 常驻不进目录
    const detail = seg.segments.find(s => s.key === 'memory-resident')
    expect(detail?.tokens).toBeGreaterThan(0)
    expect(detail?.source).toContain('book-state.md')
  })

  it('常驻合计超硬上限：整段不注入 + 明细面板告警（不静默截断）', async () => {
    mockInvoke.mockImplementation(async (ch: string) => {
      if (ch === 'memory:list') return layerList([{ file: 'a.md', kind: 'book', loadMode: 'resident', brief: 'x', stale: false, mtime: 1 }])
      if (ch === 'memory:read') return `---\nload_mode: resident\n---\n${'详'.repeat(6000)}`
      return null
    })
    const seg = await buildAgentSystemSegmentsAsync('quick')
    expect(seg.memoryResident).toBe('')
    const detail = seg.segments.find(s => s.key === 'memory-resident')
    expect(detail?.tokens).toBe(0)
    expect(detail?.warning).toBeTruthy()
    expect(detail?.warning).toContain('4000')
  })

  it('常驻接近上限：仍注入，但明细带「接近上限」告警', async () => {
    mockInvoke.mockImplementation(async (ch: string) => {
      if (ch === 'memory:list') return layerList([{ file: 'a.md', kind: 'book', loadMode: 'resident', brief: 'x', stale: false, mtime: 1 }])
      if (ch === 'memory:read') return `---\nload_mode: resident\n---\n${'详'.repeat(2000)}`
      return null
    })
    const seg = await buildAgentSystemSegmentsAsync('quick')
    expect(seg.memoryResident).not.toBe('')
    expect(seg.segments.find(s => s.key === 'memory-resident')?.warning).toBeTruthy()
  })

  it('manual 硬门控：@提及 → 本轮注入正文；未提及 → 只有目录行', async () => {
    mockInvoke.mockImplementation(async (ch: string, file?: string) => {
      if (ch === 'memory:list') return layerList([{ file: 'book-state.md', kind: 'book', loadMode: 'manual', brief: '主角是苏晚晴', stale: false, mtime: 1 }])
      if (ch === 'memory:read') return file === 'book-state.md' ? '---\nload_mode: manual\n---\n# 全书精要\n主角是苏晚晴，复仇线为主。' : null
      return null
    })
    const without = await buildAgentSystemSegmentsAsync('quick', '帮我写第 3 章')
    expect(without.memoryM2).toContain('[manual]')          // 目录里知道它存在
    expect(without.memoryM2).not.toContain('复仇线为主')     // 但正文不注入
    const withMention = await buildAgentSystemSegmentsAsync('quick', '参考 @book-state 写第 3 章')
    // 正文进独立的 manual 段（独立预算，不再挂在 M2 上——评审 I1）
    expect(withMention.memoryManual).toContain('复仇线为主')
    expect(withMention.memoryManual).toContain('本轮显式引用')
    // ⚠️ 且**不得**同时留在 M2 里：两处都有会是每轮白烧 ~body 的 token + 提前触发降级链
    //    （C 档第二轮评审 I1：抽取重构曾把 manual 又塞回 M2 的 parts）
    expect(withMention.memoryM2).not.toContain('复仇线为主')
    expect(withMention.memoryM2).toContain('记忆目录')
  })

  it('manual 段独立预算：@ 引用的正文超上限 → 整段不注入 + 明细告警，目录不被连坐丢弃', async () => {
    mockInvoke.mockImplementation(async (ch: string, file?: string) => {
      if (ch === 'memory:list') return layerList([{ file: 'book-state.md', kind: 'book', loadMode: 'manual', brief: '主角是苏晚晴', stale: false, mtime: 1 }])
      if (ch === 'memory:read') return file === 'book-state.md' ? `---\nload_mode: manual\n---\n${'详'.repeat(6000)}` : null
      return null
    })
    const seg = await buildAgentSystemSegmentsAsync('quick', '@book-state')
    expect(seg.memoryM2).not.toContain('详')          // 超限整段不注入（不给半截）
    expect(seg.memoryM2).toContain('记忆目录')         // 目录主体仍注入（不再被 manual 连坐丢弃）
    const detail = seg.segments.find(s => s.key === 'memory-manual')
    expect(detail?.tokens).toBe(0)
    expect(detail?.warning).toBeTruthy()
    expect(detail?.warning).toContain('4000')
  })

  it('stale 优先于分层：stale 的 manual 即使被 @ 也不注入', async () => {
    mockInvoke.mockImplementation(async (ch: string, file?: string) => {
      if (ch === 'memory:list') return layerList([{ file: 'book-state.md', kind: 'book', loadMode: 'manual', brief: 'x', stale: true, mtime: 1 }])
      if (ch === 'memory:read') return file === 'book-state.md' ? '---\nload_mode: manual\n---\n过期正文' : null
      return null
    })
    const seg = await buildAgentSystemSegmentsAsync('quick', '@book-state')
    expect(seg.memoryM2).not.toContain('过期正文')
  })

  it('目录段来源如实报数：被挤出时给「已列/总数」（评审 Minor 7）', async () => {
    mockInvoke.mockImplementation(async (ch: string) => {
      if (ch === 'memory:list') return layerList(Array.from({ length: 80 }, (_, i) => ({
        file: `file-${String(i).padStart(2, '0')}-with-a-long-name.md`, kind: 'auto', loadMode: 'auto', brief: '详'.repeat(150), stale: false, mtime: i,
      })))
      return null
    })
    const seg = await buildAgentSystemSegmentsAsync('quick')
    const source = seg.segments.find(s => s.key === 'memory-catalog')?.source ?? ''
    expect(source).toMatch(/\d+\/80/)
    expect(seg.memoryM2).toContain('还有')   // 未列出的部分有提示
  })

  it('常驻条目读盘失败（已删除）→ 跳过该条不崩，其余条目照常', async () => {
    mockInvoke.mockImplementation(async (ch: string, file?: string) => {
      if (ch === 'memory:list') return layerList([
        { file: 'gone.md', kind: 'book', loadMode: 'resident', brief: 'x', stale: false, mtime: 2 },
        { file: 'ok.md', kind: 'book', loadMode: 'resident', brief: 'y', stale: false, mtime: 1 },
      ])
      if (ch === 'memory:read') return file === 'gone.md' ? null : '---\nload_mode: resident\n---\n还在的记忆'
      return null
    })
    const seg = await buildAgentSystemSegmentsAsync('quick')
    expect(seg.memoryResident).toContain('还在的记忆')
  })
})

describe('assembleFinalPrompt 常驻段独立预算（C 档第一轮修正 1）', () => {
  const big = '内容'.repeat(4000)

  it('常驻段不参与降级链：超限时丢的是 M1 → M2，常驻保留', () => {
    const out = assembleFinalPrompt({ base: '## 身份', memoryM1: `M1=${big}`, memoryM2: `M2=${big}`, memoryResident: `R=常驻原文` })
    expect(out).toContain('R=常驻原文')
    expect(out).not.toContain('M1=')
    expect(out).not.toContain('M2=')
    expect(estimateTokens(out)).toBeLessThanOrEqual(4700 + estimateTokens('R=常驻原文'))
  })

  it('不传常驻段时上限仍为 4700（既有 6 条用例的行为不变）', () => {
    const out = assembleFinalPrompt({ base: '## 身份', memoryM1: `M1=${big}`, memoryM2: `M2=${big}` })
    expect(estimateTokens(out)).toBeLessThanOrEqual(4700)
  })

  it('manual 段也独立预算：超限时丢的仍是 M1 → M2，本轮显式引用的正文保留', () => {
    const out = assembleFinalPrompt({ base: '## 身份', memoryM1: `M1=${big}`, memoryM2: `M2=${big}`, memoryManual: 'MAN=手动引用原文' })
    expect(out).toContain('MAN=手动引用原文')   // 用户显式 @ 的内容不该被静默丢掉
    expect(out).not.toContain('M2=')
    expect(estimateTokens(out)).toBeLessThanOrEqual(4700 + estimateTokens('MAN=手动引用原文'))
  })

  it('manual 在不相关轮次不出现时的行为不变（缺省 = 空段）', () => {
    const withEmpty = assembleFinalPrompt({ base: '## 身份', memoryM1: 'M1=小', memoryM2: 'M2=小', memoryManual: '' })
    const without = assembleFinalPrompt({ base: '## 身份', memoryM1: 'M1=小', memoryM2: 'M2=小' })
    expect(withEmpty).toBe(without)
  })
})
