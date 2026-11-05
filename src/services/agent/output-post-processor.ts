/**
 * NovelForge Agent 输出后处理器 — 可插拔的文本后处理管道
 *
 * 将 Agent 的原始输出经过一系列处理步骤，提取结构化信息：
 * 1. ThinkingDetectionStep — 检测并折叠 <think> 标签
 * 2. SummaryGenerationStep — 提取内容摘要
 * 3. CodeBlockCleanupStep — 规范化 Markdown 代码块
 * 运行事实只来自成功工具；模型文字不会推断为已持久化的改动。
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import type { RuntimeEvent } from '../../core/domain/runtime-event'
import type { LLMMessage } from './agent-engine'

// ===== 类型定义 =====

/** 后处理上下文 */
export interface PostProcessContext {
  artifacts: RuntimeEvent[]
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
  extractedArtifacts: RuntimeEvent[]
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
  process: async (input, _) => {
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

/** 提取内容摘要 */
const SummaryGenerationStep: PostProcessStep = {
  name: 'summary-generation',
  process: async (input, _) => {
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
  process: async (input, _) => {
    // ⚠️ M 级修复：此前奇数个 ``` 时在文末追加一个——小说对白含字面 ```（如
    //   "他说：```是结束标记吗？"）会给可见正文注入一行不属于内容的字符（内容污染）。
    //   改为只删除「孤立不成对」的整行 ```（行首/行尾独立成行的），绝不追加
    let cleaned = input
    const lines = cleaned.split('\n')
    const backtickLines = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => /^\s*```\s*$/.test(l))
    const isOdd = backtickLines.length % 2 !== 0
    if (isOdd && backtickLines.length > 0) {
      // 奇数个整行 ```：删除最后一个孤立行
      const last = backtickLines[backtickLines.length - 1]
      lines.splice(last.i, 1)
      cleaned = lines.join('\n')
    }

    return {
      output: cleaned,
      metadata: { fixedIncompleteBlocks: isOdd },
    }
  },
}

// ===== 后处理器 =====

export class OutputPostProcessor {
  private steps: PostProcessStep[] = [
    ThinkingDetectionStep,
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

    return {
      cleanedOutput: currentOutput,
      thinkingContent,
      summary,
      extractedArtifacts: [...context.artifacts],
    }
  }
}

/** 全局单例后处理器 */
export const outputPostProcessor = new OutputPostProcessor()
