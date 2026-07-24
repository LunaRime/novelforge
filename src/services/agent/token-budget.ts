/**
 * NovelForge Token 预算引擎 — 精确的 Token 计数与智能截断
 *
 * 替代所有基于字符长度的截断逻辑，提供：
 * 1. 精确 Token 估算（tiktoken for OpenAI，CJK 感知启发式 for 其他）
 * 2. 语义边界保留截断（句号/段落/换行处截断）
 * 3. 分配式 Token 预算管理
 *
 * 使用 gpt-tokenizer 进行 OpenAI 兼容模型的精确计数。
 */

// ===== 导入 =====

let gptEncoder: {
  encode: (text: string) => number[]
  decode: (tokens: number[]) => string
} | null = null

async function loadEncoder(): Promise<void> {
  if (gptEncoder) return
  try {
    // 动态导入避免阻塞主线程
    const { encode, decode } = await import('gpt-tokenizer')
    gptEncoder = { encode, decode }
  } catch {
    // gpt-tokenizer 不可用时使用启发式
    console.warn('[TokenBudget] gpt-tokenizer 不可用，使用 CJK 启发式估算')
  }
}

// ===== CJK 感知启发式 Token 估算 =====

/**
 * 启发式 Token 计数（当 tiktoken 不可用时）
 *
 * 基于 OpenAI 的经验规则：
 * - 1 个中文字符 ≈ 1.5-2.5 tokens（取决于模型）
 * - 1 个英文单词 ≈ 1-1.3 tokens
 * - 标点和数字 ≈ 1 token
 *
 * 我们使用保守估计以预算为准。
 */
export function estimateTokensHeuristic(text: string): number {
  if (!text) return 0

  let tokens = 0
  const cjkRegex = /[一-鿿㐀-䶿豈-﫿]/g
  const wordRegex = /[a-zA-Z0-9]+/g

  // CJK 字符：每个约 1.5 tokens
  const cjkCount = (text.match(cjkRegex) || []).length
  tokens += Math.ceil(cjkCount * 1.5)

  // 英文/数字词：每个约 1.2 tokens
  const wordCount = (text.match(wordRegex) || []).length
  tokens += Math.ceil(wordCount * 1.2)

  // 剩余字符（空格、标点等）：每个约 1 token
  const remaining = text.replace(cjkRegex, '').replace(wordRegex, '').replace(/\s+/g, '').length
  tokens += remaining

  return Math.max(1, tokens)
}

/**
 * 精确 Token 计数（优先使用 tiktoken，否则启发式）
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function estimateTokens(text: string, _?: string): number {
  if (!text) return 0

  // 优先使用精确编码器
  if (gptEncoder) {
    try {
      return gptEncoder.encode(text).length
    } catch {
      // 编码失败，回退启发式
    }
  }

  return estimateTokensHeuristic(text)
}

// ===== Token 预算截断 =====

/**
 * 在 token 预算内截断文本，保留语义边界。
 *
 * 截断优先级（从优到劣）：
 * 1. 段落边界（双换行）
 * 2. 句子边界（句号、问号、感叹号）
 * 3. 短语边界（逗号、分号）
 * 4. 硬截断（单词边界）
 *
 * 返回的文本保证 ≤ maxTokens。
 */
export function truncateToTokenBudget(
  text: string,
  maxTokens: number,
  modelId?: string,
): string {
  if (!text) return ''
  if (estimateTokens(text, modelId) <= maxTokens) return text

  // 策略 1：段落边界截断
  const paragraphs = text.split(/\n\s*\n/)
  let result = ''
  for (const para of paragraphs) {
    const testResult = result ? result + '\n\n' + para : para
    if (estimateTokens(testResult, modelId) > maxTokens) {
      // 尝试保留到上一个句号
      if (result) {
        const lastPeriod = Math.max(
          result.lastIndexOf('。'),
          result.lastIndexOf('.'),
          result.lastIndexOf('！'),
          result.lastIndexOf('?'),
        )
        if (lastPeriod > result.length * 0.5) {
          result = result.slice(0, lastPeriod + 1)
        }
      }
      break
    }
    result = testResult
  }

  // 如果段落截断后仍然过多（比如单段落很长），按句子截断
  if (estimateTokens(result || text.slice(0, 200), modelId) > maxTokens) {
    const sentences = text.split(/(?<=[。！？.!?])/g)
    result = ''
    for (const sent of sentences) {
      const testResult = result + sent
      if (estimateTokens(testResult, modelId) > maxTokens) break
      result = testResult
    }
  }

  // 最后的兜底：硬截断
  if (!result || estimateTokens(result, modelId) > maxTokens) {
    // 二分查找精确截断点
    let lo = 0
    let hi = text.length
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2)
      if (estimateTokens(text.slice(0, mid), modelId) <= maxTokens) {
        lo = mid
      } else {
        hi = mid - 1
      }
    }
    result = text.slice(0, lo).trimEnd()
  }

  return result
}

// ===== Token 预算管理器 =====

export interface TokenAllocation {
  section: string
  maxTokens: number
  used: number
}

export class TokenBudget {
  readonly maxTokens: number
  private allocations = new Map<string, TokenAllocation>()

  constructor(maxTokens: number) {
    this.maxTokens = maxTokens
  }

  /** 分配一个 token 预算槽 */
  allocate(section: string, maxTokens: number): TokenAllocation {
    const alloc: TokenAllocation = { section, maxTokens, used: 0 }
    this.allocations.set(section, alloc)
    return alloc
  }

  /** 检查文本是否符合预算（不存储） */
  fits(text: string, modelId?: string): boolean {
    return estimateTokens(text, modelId) <= this.remaining
  }

  /** 在预算内截断文本并标记已使用 */
  applyToSection(section: string, text: string, modelId?: string): {
    text: string
    truncated: boolean
    tokensUsed: number
  } {
    const alloc = this.allocations.get(section)
    const budget = alloc?.maxTokens ?? this.remaining
    const estimated = estimateTokens(text, modelId)

    if (estimated <= budget) {
      if (alloc) alloc.used = estimated
      return { text, truncated: false, tokensUsed: estimated }
    }

    const truncated = truncateToTokenBudget(text, budget, modelId)
    const used = estimateTokens(truncated, modelId)
    if (alloc) alloc.used = used
    return { text: truncated, truncated: true, tokensUsed: used }
  }

  /** 获取剩余 tokens */
  get remaining(): number {
    let used = 0
    for (const [, alloc] of this.allocations) {
      used += alloc.used
    }
    return Math.max(0, this.maxTokens - used)
  }

  /** 获取已分配的总 tokens */
  get allocated(): ReadonlyMap<string, TokenAllocation> {
    return this.allocations
  }

  /** 获取使用摘要 */
  getSummary(): string {
    const lines: string[] = [`Token 预算: ${this.maxTokens} (已用 ${this.maxTokens - this.remaining})`]
    for (const [, alloc] of this.allocations) {
      const usagePercent = alloc.maxTokens > 0 ? Math.round((alloc.used / alloc.maxTokens) * 100) : 0
      lines.push(`  ${alloc.section}: ${alloc.used}/${alloc.maxTokens} (${usagePercent}%)`)
    }
    return lines.join('\n')
  }
}

// ===== 懒加载初始化 =====

/** 预加载编码器（在应用启动时调用） */
export async function initTokenEngine(): Promise<void> {
  await loadEncoder()
  const method = gptEncoder ? 'tiktoken (精确)' : 'CJK 启发式'
  console.log(`[TokenEngine] 已初始化，使用 ${method} 计数`)
}
