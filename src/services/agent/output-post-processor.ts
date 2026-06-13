/**
 * Vela Agent 输出后处理器 — 可插拔的文本后处理管道
 *
 * 将 Agent 的原始输出经过一系列处理步骤，提取结构化信息：
 * 1. ThinkingDetectionStep — 检测并折叠 <think> 标签
 * 2. ArtifactExtractionStep — 扫描输出中的结构化产物
 * 3. SummaryGenerationStep — 提取内容摘要
 * 4. CodeBlockCleanupStep — 规范化 Markdown 代码块
 */

import type { ToolArtifact } from './tool-registry'
import type { LLMMessage } from './agent-engine'

// ===== 类型定义 =====

/** 后处理上下文 */
export interface PostProcessContext {
  artifacts: ToolArtifact[]
  messages: LLMMessage[]
  modelId: string
}

/** 后处理结果 */
export interface PostProcessResult {
  /** 清洗后的输出文本 */
  cleanedOutput: string
  /** 折叠出的思考内容 */
  thinkingContent: string
  /** 输出的摘要（前 200 字符） */
  summary: string
  /** 从输出中提取的产物 */
  extractedArtifacts: ToolArtifact[]
}

/** 后处理步骤接口 */
export interface PostProcessStep {
  /** 步骤名称 */
  name: string
  /** 处理函数 */
  process: (
    input: string,
    context: PostProcessContext,
  ) => Promise<{ output: string; metadata: Record<string, unknown> }>
}

// ===== 内置步骤 =====

/** 检测并折叠 <think> 标签 */
const ThinkingDetectionStep: PostProcessStep = {
  name: 'thinking-detection',
  process: async (input, _context) => {
    const thinkRegex = /<think>([\s\S]*?)<\/think>/gi
    let thinkingContent = ''
    const matches = input.matchAll(thinkRegex)
    for (const match of matches) {
      thinkingContent += match[1].trim() + '\n\n'
    }

    // 移除 <think> 标签，保留其余内容
    const cleaned = input
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<\/?think>/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

    return {
      output: cleaned,
      metadata: {
        thinkingContent: thinkingContent.trim(),
        hadThinking: thinkingContent.length > 0,
      },
    }
  },
}

/** 扫描输出中的结构化产物 */
const ArtifactExtractionStep: PostProcessStep = {
  name: 'artifact-extraction',
  process: async (input, _context) => {
    const extracted: ToolArtifact[] = []

    // 检测可能含有的蓝图/章节标记
    const chapterMatch = input.match(/第(\d+)章\s*[:：]?\s*(.+)/g)
    if (chapterMatch && chapterMatch.length > 0) {
      for (const cm of chapterMatch) {
        const numMatch = cm.match(/第(\d+)章/)
        if (numMatch) {
          extracted.push({
            type: 'blueprint_generated',
            name: cm.trim(),
            summary: `章节蓝图: ${cm.trim()}`,
            metadata: { chapterNumber: parseInt(numMatch[1], 10) },
            timestamp: Date.now(),
          })
        }
      }
      // 限制最多提取 10 章，避免产物爆炸
      if (extracted.length > 10) {
        extracted.splice(10)
      }
    }

    // 检测审稿报告标记
    if (
      input.includes('审稿报告') ||
      input.includes('review report') ||
      input.includes('一致性审查')
    ) {
      extracted.push({
        type: 'review_completed',
        name: '审稿报告',
        summary: '已完成一致性审查',
        timestamp: Date.now(),
      })
    }

    return {
      output: input,
      metadata: { extractedArtifacts: extracted },
    }
  },
}

/** 提取内容摘要 */
const SummaryGenerationStep: PostProcessStep = {
  name: 'summary-generation',
  process: async (input, _context) => {
    // 取前 200 字符作为摘要，在第一个句号或换行处截断
    let summary = input.slice(0, 200).replace(/\s+/g, ' ').trim()
    const sentenceEnd = Math.max(
      summary.lastIndexOf('。'),
      summary.lastIndexOf('.'),
      summary.lastIndexOf('\n'),
    )
    if (sentenceEnd > 50) {
      summary = summary.slice(0, sentenceEnd + 1)
    }
    if (summary.length >= 200) {
      summary += '…'
    }

    return {
      output: input,
      metadata: { summary },
    }
  },
}

/** 规范化 Markdown 代码块 */
const CodeBlockCleanupStep: PostProcessStep = {
  name: 'code-block-cleanup',
  process: async (input, _context) => {
    // 修复不完整的代码块标记
    let cleaned = input
    // 统计 ``` 数量，如果奇数则补一个
    const backtickCount = (cleaned.match(/```/g) || []).length
    if (backtickCount % 2 !== 0) {
      cleaned += '\n```'
    }

    return {
      output: cleaned,
      metadata: { fixedIncompleteBlocks: backtickCount % 2 !== 0 },
    }
  },
}

// ===== 后处理器 =====

export class OutputPostProcessor {
  private steps: PostProcessStep[] = [
    ThinkingDetectionStep,
    ArtifactExtractionStep,
    SummaryGenerationStep,
    CodeBlockCleanupStep,
  ]

  /** 注册自定义步骤 */
  addStep(step: PostProcessStep, before?: string): void {
    if (before) {
      const idx = this.steps.findIndex((s) => s.name === before)
      if (idx >= 0) {
        this.steps.splice(idx, 0, step)
        return
      }
    }
    this.steps.push(step)
  }

  /** 移除步骤 */
  removeStep(name: string): void {
    this.steps = this.steps.filter((s) => s.name !== name)
  }

  /** 获取步骤列表 */
  getStepNames(): string[] {
    return this.steps.map((s) => s.name)
  }

  /**
   * 执行后处理管道
   *
   * @param rawOutput Agent 的原始输出文本
   * @param context 后处理上下文（产物、消息历史等）
   * @returns 结构化处理结果
   */
  async process(
    rawOutput: string,
    context: PostProcessContext,
  ): Promise<PostProcessResult> {
    let currentOutput = rawOutput
    const metadata: Record<string, unknown> = {}

    for (const step of this.steps) {
      try {
        const result = await step.process(currentOutput, context)
        currentOutput = result.output
        Object.assign(metadata, result.metadata)
      } catch (error) {
        console.warn(
          `[OutputPostProcessor] 步骤 "${step.name}" 失败，跳过:`,
          error,
        )
      }
    }

    const thinkingContent = (metadata.thinkingContent as string) || ''
    const summary = (metadata.summary as string) || currentOutput.slice(0, 200)
    const extractedArtifacts =
      (metadata.extractedArtifacts as ToolArtifact[]) || []

    return {
      cleanedOutput: currentOutput,
      thinkingContent,
      summary,
      extractedArtifacts: [...context.artifacts, ...extractedArtifacts],
    }
  }
}

/** 全局单例后处理器 */
export const outputPostProcessor = new OutputPostProcessor()
