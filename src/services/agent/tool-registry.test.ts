import { describe, it, expect, afterEach } from 'vitest'
import { toolRegistry, buildAgentTool } from './tool-registry'
import { MAX_PARALLEL_READ_TOOLS } from './tool-scheduling'
import { t, setCurrentLocale, UI_TEXTS } from '../../shared/locale'

describe('generateToolPrompt 子集（C 档第二轮 T1）', () => {
  const reg = (name: string): void => {
    toolRegistry.register(buildAgentTool({
      name,
      description: `d-${name}`,
      source: 'builtin',
      inputSchema: { type: 'object', properties: { p: { type: 'string', description: 'x' } } },
      requiresConfirmation: false,
      execute: async () => ({ success: true, content: '' }),
    }))
  }

  afterEach(() => { toolRegistry.unregister('reg_test_a'); toolRegistry.unregister('reg_test_b') })

  it('只列给定工具；缺省列全量（子 agent 不该看到它调不了的工具契约）', () => {
    reg('reg_test_a')
    reg('reg_test_b')
    const subset = toolRegistry.generateToolPrompt([toolRegistry.get('reg_test_a')!])
    expect(subset).toContain('reg_test_a')
    expect(subset).not.toContain('reg_test_b')
    const all = toolRegistry.generateToolPrompt()
    expect(all).toContain('reg_test_a')
    expect(all).toContain('reg_test_b')
  })

  it('空子集 → 空串（不产出只有标题的空段）', () => {
    expect(toolRegistry.generateToolPrompt([])).toBe('')
  })
})

describe('F: 工具调用语义 — 一轮多次调用 + 只读并行并发上限', () => {
  const sampleTool = buildAgentTool({
    name: 'sched_test_read',
    description: '只读示例',
    source: 'builtin',
    inputSchema: { type: 'object', properties: { p: { type: 'string', description: 'x' } } },
    requiresConfirmation: false,
    execute: async () => ({ success: true, content: '' }),
  })

  afterEach(() => { setCurrentLocale('zh-CN') })

  it('只读批内并发上限唯一来源 = 10，且被提示词模板消费', () => {
    expect(MAX_PARALLEL_READ_TOOLS).toBe(10)
    const prompt = toolRegistry.generateToolPrompt([sampleTool])
    expect(prompt).toContain(String(MAX_PARALLEL_READ_TOOLS))
    // 占位符必须被替换干净，否则模型会看到 {maxParallel} 字面量
    expect(prompt).not.toContain('{maxParallel}')
    // 三语模板都必须保留占位符（翻译漏掉后注入会静默失效）
    const variants = UI_TEXTS['engine.toolSystemBody']
    for (const locale of ['zh-CN', 'en-US', 'ru-RU'] as const) {
      expect(variants[locale], `missing ${locale}`).toContain('{maxParallel}')
      // 旧「每轮最多一个」的口径不得在任何语言残留
      expect(variants[locale]).not.toMatch(/最多放一个|at most one|не более одного/)
    }
  })

  it('zh-CN：允许同一步（同一条回复）多个 <tool_call>，不再出现「每次回复最多放一个」', () => {
    setCurrentLocale('zh-CN')
    const prompt = toolRegistry.generateToolPrompt([sampleTool])
    expect(prompt).toContain('同一步（同一条回复）可以放多个')
    expect(prompt).toContain('并行')
    expect(prompt).toContain('串行')
    expect(prompt).toContain('同一批最多 10 个')
    expect(prompt).not.toContain('每次回复最多放一个')
    expect(prompt).not.toContain('最多放一个')
    // 有依赖的调用不得同批
    expect(prompt).toContain('有先后依赖的调用')
    // 既有规则保留
    expect(prompt).toContain('<tool_result>')
    expect(prompt).toContain('需要用户确认')
  })

  it('en-US：multiple per step + at most 10 per batch', () => {
    setCurrentLocale('en-US')
    const prompt = toolRegistry.generateToolPrompt([sampleTool])
    expect(prompt).toContain('One step (a single reply) may contain multiple')
    expect(prompt).toContain('in parallel')
    expect(prompt).toContain('serially')
    expect(prompt).toContain('at most 10 per batch')
    expect(prompt).not.toContain('at most one')
  })

  it('ru-RU：несколько вызовов на одном шаге + не более 10 в партии', () => {
    setCurrentLocale('ru-RU')
    const prompt = toolRegistry.generateToolPrompt([sampleTool])
    expect(prompt).toContain('На одном шаге (в одном ответе) можно разместить несколько')
    expect(prompt).toContain('параллельно')
    expect(prompt).toContain('последовательно')
    expect(prompt).toContain('не более 10 в одной партии')
    expect(prompt).not.toContain('не более одного')
  })

  it('agent.maxStepsReached 三语讲「执行步骤」、上限走 {maxSteps} 占位符（不写死 8）', () => {
    const locales = [
      { locale: 'zh-CN' as const, step: '执行步骤', oldPhrase: '最大工具调用次数' },
      { locale: 'en-US' as const, step: 'execution step', oldPhrase: 'maximum tool call limit' },
      { locale: 'ru-RU' as const, step: 'шагов выполнения', oldPhrase: 'лимит вызовов инструментов' },
    ]
    for (const { locale, step, oldPhrase } of locales) {
      setCurrentLocale(locale)
      const text = t('agent.maxStepsReached')
      expect(text, `missing ${locale}`).toBeTruthy()
      expect(text).toContain(step)
      expect(text).not.toContain(oldPhrase)
      // 引擎常量不得写死在文案里：步数上限必须由引擎注入占位符
      expect(text).toContain('{maxSteps}')
      expect(text).not.toMatch(/\b8\b/)
      // 注入后不得残留任何未替换占位符
      expect(text.replace('{maxSteps}', String(8))).not.toMatch(/\{[^}]+\}/)
    }
  })
})
