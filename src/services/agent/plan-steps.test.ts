import { describe, expect, it } from 'vitest'
import { extractPlanSteps } from './plan-steps'

describe('extractPlanSteps', () => {
  it('按顺序提取任务清单并识别三态', () => {
    const result = extractPlanSteps([
      '我先读一下大纲。',
      '',
      '- [x] 读取章节蓝图',
      '- [~] 改写第一段',
      '- [ ] 校对时间线',
      '',
      '然后开始写。',
    ].join('\n'))

    expect(result.steps.map((s) => [s.title, s.status])).toEqual([
      ['读取章节蓝图', 'done'],
      ['改写第一段', 'active'],
      ['校对时间线', 'pending'],
    ])
    expect(result.rest).toContain('我先读一下大纲。')
    expect(result.rest).toContain('然后开始写。')
    expect(result.rest).not.toContain('- [x]')
  })

  it('普通列表/正文不误判', () => {
    const content = '普通说明\n\n- 这不是任务清单\n- [链接](https://example.com)'
    const result = extractPlanSteps(content)
    expect(result.steps).toEqual([])
    expect(result.rest).toBe(content)
  })

  it('保留消息里的其它 Markdown', () => {
    const result = extractPlanSteps('**标题**\n\n- [ ] 第一步\n\n> 引用')
    expect(result.rest).toContain('**标题**')
    expect(result.rest).toContain('> 引用')
  })

  it('模型重复输出计划时取最后一个清单块（不把进度分母翻倍）', () => {
    const result = extractPlanSteps([
      '- [ ] 读取草稿',
      '- [ ] 统计段落',
      '',
      '开始执行。',
      '',
      '- [x] 读取草稿',
      '- [x] 统计段落',
    ].join('\n'))
    expect(result.steps.map((s) => [s.title, s.status])).toEqual([
      ['读取草稿', 'done'],
      ['统计段落', 'done'],
    ])
  })

  it('本轮已结束且确有工具执行 → 未勾选步骤收敛为 done', () => {
    const result = extractPlanSteps('- [ ] 读取草稿\n- [ ] 统计段落', { finalize: true })
    expect(result.steps.map((s) => s.status)).toEqual(['done', 'done'])
  })
})
