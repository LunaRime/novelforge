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

import { t } from '../../shared/locale'

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

// ===== 两段式估算（C1，§三.9 剩余）：粗估（内容类型系数表）→ 预算闸门 → 精确编码 =====

/** 文本主导类型——粗估系数表按键。裁决点（2026-08-29 C1）：纯函数拿不到文件名/扩展名，
 * 系数表按「内容类型」（CJK 占比 / 拉丁词密度）分键；扩展名维度若需要留给有文件名的调用方。 */
export type RoughTextKind = 'cjk' | 'latin' | 'mixed'

export interface RoughTokenEstimate {
  kind: RoughTextKind
  /** 粗估 token 数（保守偏大——宁大勿小：粗估 ≤ maxTokens/4 短路时，精确数必然也 ≤ 预算） */
  tokens: number
}

// 粗估系数表（保守上界取向，与 estimateTokensHeuristic 的 CJK×1.5 中文口径一致）：
// - cjk：中文字符 ×1.5 + 词 ×1.3 + 其余字符（含空格/标点）×1
// - latin：词 ×1.4（cl100k 英文 ~1.2-1.4/词，取上界）+ 其余字符（含空格/标点）×1
// - mixed：全字符 ×1.25
const ROUGH_CJK_PER_CHAR = 1.5
const ROUGH_WORD_IN_CJK = 1.3
const ROUGH_WORD_LATIN = 1.4
const ROUGH_MIXED_PER_CHAR = 1.25
/** kind=cjk 判定阈值：CJK 字符占比（优先判定——中文是产品主语言） */
const ROUGH_CJK_MIN_RATIO = 0.35
/** kind=latin 判定阈值：拉丁词字符占比 */
const ROUGH_LATIN_MIN_RATIO = 0.5

/**
 * 阶段 1：粗估（单趟扫描、不建 match 数组、不拼接中间串——超大文本不爆内存/GC）。
 * 与启发式的差异：启发式对非词剩余字符剔空格（空格 0 token），粗估把空格按 1 token 计——
 * 粗估是保守（偏大）估计；tokens 值差异仅在粗估 > maxTokens/4 会触发阶段 2 精确计数时才有意义。
 */
export function roughEstimateTokens(text: string): RoughTokenEstimate {
  if (!text) return { kind: 'mixed', tokens: 0 }

  const len = text.length
  // 局部正则实例（共享 /g 实例有 lastIndex 状态，跨调用复用易踩坑；此处新建开销可忽略）
  const cjkRe = /[一-鿿㐀-䶿豈-﫿]/g
  const wordRe = /[a-zA-Z0-9]+/g
  let cjk = 0
  let words = 0
  let wordChars = 0
  let m: RegExpExecArray | null
  while ((m = cjkRe.exec(text))) cjk++
  while ((m = wordRe.exec(text))) {
    words++
    wordChars += m[0].length
  }

  const cjkRatio = cjk / len
  const wordRatio = wordChars / len

  let kind: RoughTextKind
  let tokens: number
  if (cjkRatio >= ROUGH_CJK_MIN_RATIO) {
    kind = 'cjk'
    tokens = Math.ceil(cjk * ROUGH_CJK_PER_CHAR) + Math.ceil(words * ROUGH_WORD_IN_CJK) + (len - cjk - wordChars)
  } else if (wordRatio >= ROUGH_LATIN_MIN_RATIO) {
    kind = 'latin'
    tokens = Math.ceil(words * ROUGH_WORD_LATIN) + (len - wordChars)
  } else {
    kind = 'mixed'
    tokens = Math.ceil(len * ROUGH_MIXED_PER_CHAR)
  }
  return { kind, tokens: Math.max(1, tokens) }
}

/**
 * 阶段 2 门控的两段式估算（预算口径）：
 * 1. 粗估 ≤ maxTokens/4 → 直接返回粗估值——粗估保守偏大 ⇒ 精确数必然 ≤ 预算，
 *    跳过精确编码 / 全量启发式（预算截断的二分查找热路径收益最大）；
 * 2. 粗估 > maxTokens/4 → 精确编码（encoder 已加载时），否则回退既有启发式（行为兼容）。
 */
export function estimateTokensWithBudget(text: string, maxTokens: number): number {
  if (!text) return 0
  const gate = Math.floor(maxTokens / 4)
  if (gate >= 1) {
    const rough = roughEstimateTokens(text)
    if (rough.tokens <= gate) return rough.tokens
  }
  // 精确编码器优先（与 estimateTokens 同路径）
  if (gptEncoder) {
    try {
      return gptEncoder.encode(text).length
    } catch {
      // 编码失败，回退启发式
    }
  }
  return estimateTokensHeuristic(text)
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
 * 内部比较走 estimateTokensWithBudget（C1 两段式：粗估 ≤ maxTokens/4 短路，避免
 * 二分/逐段循环对每段做精确编码）——截断结果与纯 estimateTokens 比较语义等价
 * （粗估保守偏大：短路成立时精确数必然 ≤ maxTokens/4 ≤ maxTokens，接受/拒绝方向不变）。
 * 返回的文本保证 ≤ maxTokens。
 */
export function truncateToTokenBudget(
  text: string,
  maxTokens: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _modelId?: string,
): string {
  if (!text) return ''
  if (estimateTokensWithBudget(text, maxTokens) <= maxTokens) return text

  // 策略 1：段落边界截断
  const paragraphs = text.split(/\n\s*\n/)
  let result = ''
  for (const para of paragraphs) {
    const testResult = result ? result + '\n\n' + para : para
    if (estimateTokensWithBudget(testResult, maxTokens) > maxTokens) {
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
  if (estimateTokensWithBudget(result || text.slice(0, 200), maxTokens) > maxTokens) {
    const sentences = text.split(/(?<=[。！？.!?])/g)
    result = ''
    for (const sent of sentences) {
      const testResult = result + sent
      if (estimateTokensWithBudget(testResult, maxTokens) > maxTokens) break
      result = testResult
    }
  }

  // 最后的兜底：硬截断
  if (!result || estimateTokensWithBudget(result, maxTokens) > maxTokens) {
    // 二分查找精确截断点
    let lo = 0
    let hi = text.length
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2)
      if (estimateTokensWithBudget(text.slice(0, mid), maxTokens) <= maxTokens) {
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
    const lines: string[] = [t('engine.tokenBudgetSummary')
      .replace('{max}', String(this.maxTokens))
      .replace('{used}', String(this.maxTokens - this.remaining))]
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
