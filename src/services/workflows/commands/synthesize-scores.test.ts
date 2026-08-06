import { describe, it, expect, vi } from 'vitest'
import { SynthesizeScoresCommand } from './synthesize-scores.command'
import type { ReviewerOutput } from './spawn-reviewers.command'
import type { CommandExecuteParams } from './base-command'

/**
 * 分数归一化测试（P2 修复）：
 * - LLM 可能返回字符串分数（"8分"/"8.5"）——此前 typeof === 'number' 过滤导致维度静默消失
 * - overallScore 缺失/NaN/字符串——此前 weightedSum=NaN → finalScore=NaN → 报告输出 "NaN"
 */

function makeParams() {
  return {
    step: {},
    context: {} as CommandExecuteParams['context'],
    callbacks: {
      log: vi.fn(),
      setProgress: vi.fn(),
    } as unknown as CommandExecuteParams['callbacks'],
  } satisfies CommandExecuteParams
}

/** 构造 ReviewerOutput（类型声明为 number，运行时可能为字符串——parseJSON 无校验的真实场景） */
function makeOutput(overrides: Partial<ReviewerOutput> = {}): ReviewerOutput {
  return {
    perspective: '剧情逻辑评审',
    scores: { '因果链完整': 8, '时间线无矛盾': 7, '伏笔设置合理': 9, '冲突升级自然': 6 },
    overallScore: 7.5,
    strengths: [],
    weaknesses: [],
    suggestions: [],
    rawResponse: '',
    tokensUsed: 0,
    ...overrides,
  } as unknown as ReviewerOutput
}

describe('SynthesizeScoresCommand 分数归一化', () => {
  it('字符串分数（"8分"/"8.5"）被归一化为数字参与聚合', async () => {
    const outputs = [
      makeOutput({ scores: { '因果链完整': '8分' as unknown as number, '时间线无矛盾': 7, '伏笔设置合理': 9, '冲突升级自然': 6 } }),
      makeOutput({ scores: { '因果链完整': 7, '时间线无矛盾': 8, '伏笔设置合理': 8, '冲突升级自然': 7 } }),
    ]
    const report = await new SynthesizeScoresCommand({
      reviewerOutputs: outputs, draftId: 1, chapterNumber: 3,
    }).execute(makeParams())

    // 字符串 "8分" 参与平均：(8+7)/2 = 7.5
    expect(report.aggregatedScores['因果链完整']).toBeCloseTo(7.5)
    expect(report.finalScore).not.toBeNaN()
  })

  it('缺失/非法 overallScore 被跳过，finalScore 不产生 NaN', async () => {
    const outputs = [
      makeOutput({ overallScore: 8 }),
      makeOutput({ overallScore: Number.NaN }),       // NaN（parseJSON 无校验的真实场景）
      makeOutput({ overallScore: 'N/A' as unknown as number }), // 字符串非法值
    ]
    const params = makeParams()
    const report = await new SynthesizeScoresCommand({
      reviewerOutputs: outputs, draftId: 1, chapterNumber: 3,
    }).execute(params)

    expect(report.finalScore).not.toBeNaN()
    expect(report.finalScore).toBeCloseTo(8)
    // 跳过的评审者产生告警日志（t() 翻译后的中文文案）
    expect(params.callbacks.log).toHaveBeenCalledWith(expect.stringContaining('已跳过'))
  })

  it('全部评审者 overallScore 非法时 finalScore 为 0 而非 NaN', async () => {
    const outputs = [
      makeOutput({ overallScore: Number.NaN }),
      makeOutput({ overallScore: Number.NaN }),
    ]
    const report = await new SynthesizeScoresCommand({
      reviewerOutputs: outputs, draftId: 1, chapterNumber: 3,
    }).execute(makeParams())

    expect(report.finalScore).toBe(0)
  })

  it('正常数字场景（基准回归）', async () => {
    const outputs = [
      makeOutput({ overallScore: 8, scores: { '因果链完整': 8, '时间线无矛盾': 7, '伏笔设置合理': 9, '冲突升级自然': 6 } }),
      makeOutput({ overallScore: 7, scores: { '因果链完整': 7, '时间线无矛盾': 8, '伏笔设置合理': 8, '冲突升级自然': 7 } }),
    ]
    const report = await new SynthesizeScoresCommand({
      reviewerOutputs: outputs, draftId: 1, chapterNumber: 3,
    }).execute(makeParams())

    expect(report.aggregatedScores['因果链完整']).toBeCloseTo(7.5)
    expect(report.finalScore).toBeCloseTo(7.5)
  })
})
