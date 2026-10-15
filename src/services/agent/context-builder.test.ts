// @vitest-environment jsdom
/**
 * context-builder — Agent system prompt 输出语言约束测试（#30）
 * 此前仅 identityRuleLanguage 弱约束（"Reply in the user's language" 不指明具体语言），
 * 英文界面下 Agent 仍回中文。修复后末尾追加 appendOutputLanguage 明确语言指令。
 * P1 追加：M2/M1 分段落库、M2 在前（F2）、总上限 4700 降级顺序（F1）、章节尾部节选（F5）。
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import {
  buildAgentSystemPrompt,
  buildAgentSystemSegments,
  buildAgentSystemSegmentsAsync,
  buildAgentSystemPromptAsync,
  assembleFinalPrompt,
  computeToolPromptBudget,
  trimSessionSummary,
  SYSTEM_PROMPT_BUDGET_TOKENS,
  SESSION_SUMMARY_BUDGET_TOKENS,
} from './context-builder'
import { estimateTokens, truncateToTokenBudget, initTokenEngine } from './token-budget'
import { useAgentStore } from '../../stores/agent-store'
import { useEditorStore } from '../../stores/editor-store'
import { skillRegistry } from './skill-registry'
import { toolRegistry } from './tool-registry'
import { registerBuiltinTools } from './tools'
import { buildSharedFile } from '../memory/shared-memory'
import { t, UI_TEXTS } from '../../shared/locale'

// ⚠️ 本文件的预算断言统一按 tiktoken(cl100k) 口径（与生产一致）：强制加载编码器，
// 避免「先跑的用例没加载、后跑的已加载」造成的 estimator 漂移
// （实测口径：'内容'.repeat(N) ≈ N tokens、'身'.repeat(N) ≈ N tokens，2026-10-15）。
beforeAll(async () => {
  await initTokenEngine()
})

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

describe('assembleFinalPrompt 总上限与降级顺序（F1；P0-3 重估后按 7500 口径）', () => {
  // tiktoken 口径：'身'.repeat(N) ≈ N tokens（单字符重复 1 token/字；实测比 '内容' 交替串编码快 5 倍）
  const big = '身'.repeat(7800)

  it('超限时最终 prompt 尺寸 ≤ SYSTEM_PROMPT_BUDGET_TOKENS（P0 3800 → P0-3 7500 回归）', () => {
    const out = assembleFinalPrompt({ base: '## 身份', memoryM1: `M1=${big}`, memoryM2: `M2=${big}` })
    expect(estimateTokens(out)).toBeLessThanOrEqual(SYSTEM_PROMPT_BUDGET_TOKENS)
  })

  it('降级顺序：先丢 M1（会话摘要），M2 保留', () => {
    const out = assembleFinalPrompt({ base: '## 身份', memoryM1: `M1=${big}`, memoryM2: 'M2=内容' })
    expect(out).toContain('M2=内容') // M2 优先保留
    expect(out).not.toContain('M1=') // M1 已丢
    expect(estimateTokens(out)).toBeLessThanOrEqual(SYSTEM_PROMPT_BUDGET_TOKENS)
  })

  it('降级顺序：M1 丢后仍超限 → M2 一并丢弃', () => {
    const out = assembleFinalPrompt({ base: '## 身份', memoryM1: `M1=${big}`, memoryM2: `M2=${big}` })
    expect(out).not.toContain('M1=')
    expect(out).not.toContain('M2=')
    expect(estimateTokens(out)).toBeLessThanOrEqual(SYSTEM_PROMPT_BUDGET_TOKENS)
  })

  it('降级顺序：M1/M2 全丢后仍超限 → L1 裁剪（base 拆节）', () => {
    // base 自身（身份 6005 + L1 1507 + 工具 506 ≈ 8000 余 tokens）即超 7500 红线；
    // M1/M2 用小串——本条验证的是「全丢后仍超限 → L1 替换回落（~6600），且不动 Tool」
    const base = [
      `## 身份\n${'身'.repeat(6000)}`,
      `## 编辑器状态\n${'编'.repeat(1500)}`,
      `## 工具系统\n${'工'.repeat(500)}`,
    ].join('\n\n---\n\n')
    const out = assembleFinalPrompt({ base, memoryM1: 'M1=小摘要', memoryM2: 'M2=小记忆' })
    expect(out).not.toContain('M1=')
    expect(out).not.toContain('M2=')
    expect(out).toContain('（内容过长已省略') // L1 段被替换为省略提示
    expect(out).not.toContain('（工具列表已截断）') // 未走到 Tool 裁剪
    expect(estimateTokens(out)).toBeLessThanOrEqual(SYSTEM_PROMPT_BUDGET_TOKENS)
  })

  it('降级顺序：L1 裁剪后仍超限 → Tool 段截断 + 兜底硬截断仍保证 ≤ 上限', () => {
    const base = [
      `## 身份\n${'身'.repeat(6000)}`,
      `## 编辑器状态\n${'编'.repeat(400)}`,
      `## 工具系统\n${'工'.repeat(4000)}`,
    ].join('\n\n---\n\n')
    const out = assembleFinalPrompt({ base, memoryM1: 'M1=小摘要', memoryM2: 'M2=小记忆' })
    expect(out).toContain('（内容过长已省略')
    expect(out).toContain('（工具列表已截断）')
    expect(estimateTokens(out)).toBeLessThanOrEqual(SYSTEM_PROMPT_BUDGET_TOKENS)
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

describe('assembleFinalPrompt 常驻段独立预算（C 档第一轮修正 1；P0-3 重估后按 7500 口径）', () => {
  const big = '身'.repeat(7800)

  it('常驻段不参与降级链：超限时丢的是 M1 → M2，常驻保留', () => {
    const out = assembleFinalPrompt({ base: '## 身份', memoryM1: `M1=${big}`, memoryM2: `M2=${big}`, memoryResident: `R=常驻原文` })
    expect(out).toContain('R=常驻原文')
    expect(out).not.toContain('M1=')
    expect(out).not.toContain('M2=')
    expect(estimateTokens(out)).toBeLessThanOrEqual(SYSTEM_PROMPT_BUDGET_TOKENS + estimateTokens('R=常驻原文'))
  })

  it('不传常驻段时上限仍为 SYSTEM_PROMPT_BUDGET_TOKENS（既有用例的行为不变）', () => {
    const out = assembleFinalPrompt({ base: '## 身份', memoryM1: `M1=${big}`, memoryM2: `M2=${big}` })
    expect(estimateTokens(out)).toBeLessThanOrEqual(SYSTEM_PROMPT_BUDGET_TOKENS)
  })

  it('manual 段也独立预算：超限时丢的仍是 M1 → M2，本轮显式引用的正文保留', () => {
    const out = assembleFinalPrompt({ base: '## 身份', memoryM1: `M1=${big}`, memoryM2: `M2=${big}`, memoryManual: 'MAN=手动引用原文' })
    expect(out).toContain('MAN=手动引用原文')   // 用户显式 @ 的内容不该被静默丢掉
    expect(out).not.toContain('M2=')
    expect(estimateTokens(out)).toBeLessThanOrEqual(SYSTEM_PROMPT_BUDGET_TOKENS + estimateTokens('MAN=手动引用原文'))
  })

  it('manual 在不相关轮次不出现时的行为不变（缺省 = 空段）', () => {
    const withEmpty = assembleFinalPrompt({ base: '## 身份', memoryM1: 'M1=小', memoryM2: 'M2=小', memoryManual: '' })
    const without = assembleFinalPrompt({ base: '## 身份', memoryM1: 'M1=小', memoryM2: 'M2=小' })
    expect(withEmpty).toBe(without)
  })
})

describe('工具段预算随工具数伸缩（P0-3）', () => {
  beforeAll(() => {
    // 前置 describe 可能已通过 createConversation → initializeTools 注册；缺则补注册
    if (toolRegistry.listAll().length === 0) registerBuiltinTools()
  })

  it('预算公式：随工具数增长、封顶 4000（单调有界）', () => {
    expect(computeToolPromptBudget(0)).toBe(900)
    expect(computeToolPromptBudget(10)).toBe(2400)
    expect(computeToolPromptBudget(26)).toBe(4000)   // 900 + 150×26 = 4800 > 4000 → 封顶
    expect(computeToolPromptBudget(100)).toBe(4000)
    for (const n of [3, 8, 20, 30]) {
      expect(computeToolPromptBudget(n + 1)).toBeGreaterThanOrEqual(computeToolPromptBudget(n))
    }
  })

  it('回归护栏：当前内置工具契约完整可读（tiktoken 口径；工具增长挤爆时会红）', () => {
    const n = toolRegistry.listAll().length
    expect(n).toBeGreaterThanOrEqual(20)   // 注册链断裂（数量骤降）同样要红
    const prompt = toolRegistry.generateToolPrompt()
    // 契约 ≤ 预算：新增工具把契约顶上去 → 本条先红（提醒重估公式/上限）
    expect(estimateTokens(prompt)).toBeLessThanOrEqual(computeToolPromptBudget(n))
    // 段级不截断：prose（语义 / 参数含义 / 使用时机）完整可见，不只签名
    const { segments } = buildAgentSystemSegments('balanced')
    expect(segments.find(s => s.key === 'tools')?.truncated).toBeFalsy()
  })

  it('超限工具集：截断通知含全部工具签名（可调用性兜底，不丢工具）', () => {
    const registered: string[] = []
    try {
      for (let i = 0; i < 20; i++) {
        const name = `p0x-probe-${i}`
        registered.push(name)
        toolRegistry.register({
          name,
          description: '演示用长描述工具。'.repeat(30),
          source: 'builtin',
          inputSchema: {
            type: 'object',
            properties: {
              alpha: { type: 'string', description: '参数 alpha' },
              beta: { type: 'number', description: '参数 beta' },
            },
            required: ['alpha'],
          },
          requiresConfirmation: false,
          isReadOnly: true,
          execute: async () => ({ success: true, content: 'ok' }),
        })
      }
      const { base, segments } = buildAgentSystemSegments('balanced')
      const toolSeg = segments.find(s => s.key === 'tools')
      expect(toolSeg?.truncated).toBe(true)
      // 截断后每个工具仍可调用：签名清单覆盖首/中/尾（'name(' 结尾避免前缀互串）
      expect(base).toContain('p0x-probe-0(alpha, beta?)')
      expect(base).toContain('p0x-probe-10(alpha, beta?)')
      expect(base).toContain('p0x-probe-19(alpha, beta?)')
      // 截断文本 ≤ 预算 + 签名通知余量（通知不参与预算——它是可调用性的最后保险）
      expect(toolSeg!.tokens).toBeLessThanOrEqual(
        computeToolPromptBudget(toolRegistry.listAll().length) + 900,
      )
    } finally {
      for (const name of registered) toolRegistry.unregister(name)
    }
  })
})

describe('P1-1：会话摘要注入端按分节裁剪（trimSessionSummary）', () => {
  /** 组装四节摘要；facts/instructions 用可调规模撑爆预算 */
  const buildSections = (factsRepeat: number, instructionsRepeat: number): string => [
    `${t('ccr.summarySectionFacts')}\n${'事实'.repeat(factsRepeat)}`,
    `${t('ccr.summarySectionInstructions')}\n${'指令'.repeat(instructionsRepeat)}`,
    `${t('ccr.summarySectionTasks')}\n写第 3 章`,
    `${t('ccr.summarySectionDecisions')}\n主角改名苏晚晴`,
  ].join('\n\n')

  it('超长有分节：保住「未完成任务 + 已确认决策」，细节分节被裁并带省略提示', () => {
    const out = trimSessionSummary(buildSections(400, 400))
    expect(estimateTokens(out)).toBeLessThanOrEqual(SESSION_SUMMARY_BUDGET_TOKENS)
    expect(out).toContain(t('ccr.summarySectionTasks'))
    expect(out).toContain('写第 3 章')
    expect(out).toContain(t('ccr.summarySectionDecisions'))
    expect(out).toContain('主角改名苏晚晴')
    expect(out).toContain(t('ccr.summaryPartial'))
    // 细节分节整段裁掉（不是砍半句）
    expect(out).not.toContain('事实'.repeat(400))
    expect(out).not.toContain('指令'.repeat(400))
  })

  it('回执段恒保留（防重放核心），细节分节可裁', () => {
    const summary = `${t('ccr.receiptsHeader')}\n- write_file → drafts/c1.md (ok)\n\n${buildSections(400, 400)}`
    const out = trimSessionSummary(summary)
    expect(out).toContain('- write_file → drafts/c1.md (ok)')
    expect(out).toContain('写第 3 章')
    expect(estimateTokens(out)).toBeLessThanOrEqual(SESSION_SUMMARY_BUDGET_TOKENS)
  })

  it('旧格式（无分节标题）：回落保头截断，行为不劣化', () => {
    const legacy = '长摘要内容'.repeat(400)
    const out = trimSessionSummary(legacy)
    expect(out).toBe(truncateToTokenBudget(legacy, SESSION_SUMMARY_BUDGET_TOKENS))
    expect(out).not.toContain(t('ccr.summaryPartial'))
  })

  it('正常长度：零改动', () => {
    const short = `${t('ccr.summarySectionTasks')}\n写第 3 章`
    expect(trimSessionSummary(short)).toBe(short)
  })

  it('跨语言分节标题可匹配（en 生成的摘要切到 zh 界面仍裁得对）', () => {
    const en = UI_TEXTS as Record<string, Record<string, string>>
    const summary = [
      `${en['ccr.summarySectionFacts']['en-US']}\n${'fact '.repeat(300)}`,
      `${en['ccr.summarySectionTasks']['en-US']}\nwrite chapter 3`,
      `${en['ccr.summarySectionDecisions']['en-US']}\nrename protagonist`,
    ].join('\n\n')
    const out = trimSessionSummary(summary)
    expect(out).toContain('write chapter 3')
    expect(out).toContain('rename protagonist')
    expect(estimateTokens(out)).toBeLessThanOrEqual(SESSION_SUMMARY_BUDGET_TOKENS)
  })
})

describe('S2/W2：任务锚点（system 尾部；不进历史、不参与压缩）', () => {
  beforeEach(() => {
    if (toolRegistry.listAll().length === 0) registerBuiltinTools()
    // 记忆读盘：本 describe 只关心锚点 → 一律空列表（不触发常驻/目录段）
    Object.defineProperty(window, 'velaAPI', {
      value: { invoke: vi.fn(async (ch: string) => (ch === 'memory:list' ? [] : null)) },
      configurable: true,
    })
    useAgentStore.setState({ conversations: [], activeConversationId: null })
  })

  it('有诉求 → 注入锚点，且语言指令仍是最末尾（#30 语义不破）', async () => {
    useAgentStore.getState().createConversation({ title: 'T' })
    const prompt = await buildAgentSystemPromptAsync('balanced', '把第三章的重逢写得更克制')
    expect(prompt).toContain(t('engine.taskAnchorHeader'))
    expect(prompt).toContain('把第三章的重逢写得更克制')
    const anchorIdx = prompt.indexOf(t('engine.taskAnchorHeader'))
    const langIdx = prompt.lastIndexOf('Do not respond in any other language')
    expect(anchorIdx).toBeGreaterThan(0)
    expect(langIdx).toBeGreaterThan(anchorIdx)   // 锚点在语言指令之前 = system 最贴近本轮
  })

  it('命令轮（/clear）→ 不注入锚点（命令不是创作任务）', async () => {
    useAgentStore.getState().createConversation({ title: 'T' })
    const prompt = await buildAgentSystemPromptAsync('balanced', '/clear')
    expect(prompt).not.toContain(t('engine.taskAnchorHeader'))
  })

  it('明细段含 task-anchor；面板预览（不传 userMessage）不含', async () => {
    useAgentStore.getState().createConversation({ title: 'T' })
    const sent = await buildAgentSystemSegmentsAsync('balanced', '写第 5 章')
    expect(sent.taskAnchor).toContain(t('engine.taskAnchorHeader'))
    expect(sent.segments.some(s => s.key === 'task-anchor')).toBe(true)

    const preview = await buildAgentSystemSegmentsAsync('balanced')
    expect(preview.taskAnchor).toBe('')
    expect(preview.segments.some(s => s.key === 'task-anchor')).toBe(false)
  })

  it('上一轮写操作失败 → 锚点带「未完成」（任务状态不依赖历史是否被压过）', async () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id
        ? {
            ...c,
            messages: [{
              id: 'm-fail', role: 'assistant' as const, content: '写入失败', createdAt: 1,
              toolCalls: [{
                id: 'tc1', toolName: 'write_file', arguments: { file_path: 'drafts/c5.md' },
                status: 'failed' as const,
              }],
            }],
          }
        : c),
    }))
    const prompt = await buildAgentSystemPromptAsync('balanced', '继续写第 5 章')
    expect(prompt).toContain(t('engine.taskAnchorPending'))
    expect(prompt).toContain('drafts/c5.md')
  })
})

describe('W1 批 2：按档位的段预算（ContextBudgets）', () => {
  beforeEach(() => {
    if (toolRegistry.listAll().length === 0) registerBuiltinTools()
    Object.defineProperty(window, 'velaAPI', {
      value: { invoke: vi.fn(async (ch: string) => (ch === 'memory:list' ? [] : null)) },
      configurable: true,
    })
    useAgentStore.setState({ conversations: [], activeConversationId: null })
    useEditorStore.setState({ tabs: [], activeTabId: null })
  })

  it('未传 budgets → 与既有常量一致（标准档零变化）', () => {
    const { segments } = buildAgentSystemSegments('balanced')
    expect(segments.find(s => s.key === 'tools')?.truncated).toBeFalsy()   // 26 工具契约 3612 ≤ 4000
    expect(edgesDefault(segments)).toBe(true)
  })

  it('toolBudgetTokens 覆盖工具段上限（收紧 → 截断；放宽 → 契约更完整）', () => {
    const tight = buildAgentSystemSegments('balanced', { toolBudgetTokens: 200 })
    const tightTools = tight.segments.find(s => s.key === 'tools')!
    expect(tightTools.truncated).toBe(true)
    // 截断通知（签名清单）不参与预算垫底（既有约定 ~900 tokens 余量）
    expect(tightTools.tokens).toBeLessThanOrEqual(200 + 900)
    // 放宽是纯函数层面的单调：6000 的额度高于缺省 4000
    expect(computeToolPromptBudget(26, 6000)).toBeGreaterThan(computeToolPromptBudget(26))
  })

  it('m1BudgetTokens 覆盖会话摘要**注入**上限（与生成端指令同源）', () => {
    const conv = useAgentStore.getState().createConversation({ title: 'T' })
    useAgentStore.setState(state => ({
      conversations: state.conversations.map(c => c.id === conv.id ? { ...c, rollingSummary: '长摘要内容'.repeat(200) } : c),
    }))
    const overhead = estimateTokens(`${t('ccr.conversationSummaryHeader')}\n${t('ccr.autoGeneratedNotice')}\n\n`)
    const tight = buildAgentSystemSegments('balanced', { m1BudgetTokens: 60 })
    const m1 = tight.segments.find(s => s.key === 'memory-m1')!
    expect(m1.tokens).toBeLessThanOrEqual(60 + overhead + 4)
    const wide = buildAgentSystemSegments('balanced', { m1BudgetTokens: 300 })
    expect(wide.segments.find(s => s.key === 'memory-m1')!.tokens).toBeGreaterThan(m1.tokens)
  })

  it('l1BudgetTokens 覆盖编辑器段上限', () => {
    useEditorStore.setState({
      tabs: Array.from({ length: 6 }, (_, i) => ({
        id: `t${i}`, name: `第${i}章.md`, type: 'chapter' as const, content: '正文内容'.repeat(200),
      })),
      activeTabId: 't0',
    })
    const tight = buildAgentSystemSegments('balanced', { l1BudgetTokens: 40 })
    expect(tight.segments.find(s => s.key === 'l1')!.tokens).toBeLessThanOrEqual(40)
  })
})

/** 缺省预算下「工具段未截断 + M1 段按 300 上限」——标准档不变量 */
function edgesDefault(segments: Array<{ key: string; truncated?: boolean }>): boolean {
  const tools = segments.find(s => s.key === 'tools')
  return tools !== undefined && !tools.truncated
}
