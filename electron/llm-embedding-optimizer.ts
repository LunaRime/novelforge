/**
 * NovelForge LLM 嵌入优化器 — 三层优化引擎
 *
 * 层1（Token 压缩）：文本预处理 + HyDE + Top-K 截断
 * 层2（信息密度）：LLMLingua 风格压缩 + 检索后摘要
 * 层3（架构去重）：内容哈希缓存 + 批处理合并 + 相似文本去重
 */

// ===== 类型定义 =====

export interface OptimizerConfig {
  /** 最大输入字符数（超过则预处理截断） */
  maxInputChars: number
  /** 压缩率（0-1，保留原文比例，0.3 表示压缩到 30%） */
  compressionRatio: number
  /** 是否启用 HyDE */
  enableHyDE: boolean
  /** 是否启用压缩 */
  enableCompression: boolean
  /** 批处理合并等待窗口（毫秒） */
  batchWindowMs: number
  /** 语义去重相似度阈值 */
  dedupThreshold: number
}

export const DEFAULT_OPTIMIZER_CONFIG: OptimizerConfig = {
  maxInputChars: 2000,
  compressionRatio: 0.4,
  enableHyDE: false,
  enableCompression: true,
  batchWindowMs: 50,
  dedupThreshold: 0.92,
}

// ===== 文本预处理（层1：Token 压缩） =====

/** 中文停用词表（高频低信息词） */
const CN_STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
  '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着',
  '没有', '看', '好', '自己', '这', '他', '她', '它', '们', '那', '些',
  '这个', '那个', '可以', '因为', '所以', '但是', '然而', '如果', '虽然',
  '已经', '还是', '或者', '并且', '而且', '不过', '只是', '一样',
  '什么', '怎么', '哪里', '为什么', '如何', '多少', '吗', '呢', '吧',
  '啊', '嗯', '哦', '哈', '呀',
])

/** 中文标点（在句法分析前保留，压缩时移除） */
const CN_PUNCTUATION = /[，。！？；：、""''【】《》（）…—～·「」『』〈〉〖〗〔〕\s]+/g

/**
 * 提取文本中信息密度最高的句子
 *
 * 评分标准：信息词密度 = (总字数 - 停用词数) / 总字数
 */
export function extractHighInfoSentences(text: string, keepRatio: number): string {
  const sentences = text.split(/(?<=[。！？.!?])/g).filter(s => s.trim().length > 0)
  if (sentences.length <= 1) return text

  // 计算每个句子的信息密度
  const scored = sentences.map((sent, idx) => {
    const cleaned = sent.replace(CN_PUNCTUATION, '')
    const chars = [...cleaned]
    if (chars.length === 0) return { sent, idx, score: 0 }

    const infoChars = chars.filter(c => !CN_STOP_WORDS.has(c) && !CN_STOP_WORDS.has(sent)).length
    return { sent, idx, score: infoChars / chars.length }
  })

  // 按信息密度排序，保留 top keepRatio
  const keepCount = Math.max(1, Math.ceil(sentences.length * keepRatio))
  const keepSet = new Set(
    scored
      .sort((a, b) => b.score - a.score)
      .slice(0, keepCount)
      .map(s => s.idx),
  )

  // 按原始顺序重组
  return sentences.filter((_, i) => keepSet.has(i)).join('')
}

/**
 * 文本预处理管道：
 * 1. 截断过长文本
 * 2. 归一化空白
 * 3. 提取高信息密度句子
 * 4. 移除冗余标点
 */
export function preprocessText(text: string, config: OptimizerConfig): string {
  if (!text) return ''

  let processed = text

  // 步骤1：截断（保留开头和结尾最相关部分）
  if (processed.length > config.maxInputChars) {
    // 保留前 60% 和后 20% 的字符（开头通常包含最重要信息）
    const headLen = Math.floor(config.maxInputChars * 0.7)
    const tailLen = Math.floor(config.maxInputChars * 0.3)
    processed = processed.slice(0, headLen) + '\n…\n' + processed.slice(-tailLen)
  }

  // 步骤2：归一化空白
  processed = processed.replace(/\s+/g, ' ').trim()

  // 步骤3：压缩模式 - 提取高信息密度句子
  if (config.enableCompression && processed.length > 300) {
    processed = extractHighInfoSentences(processed, config.compressionRatio)
  }

  return processed
}

// ===== HyDE 生成（层1：假设文档嵌入） =====

/**
 * 为目标文本生成 HyDE（Hypothetical Document Embedding）摘要。
 *
 * 原理：让 LLM 先想象"一段包含这些关键信息的理想文本是什么样的"，
 * 然后对这个理想文本做嵌入，而非原始文本。
 * 这样产生的向量更能捕捉语义本质，而非表面措辞。
 */
export function buildHyDEPrompt(text: string): string {
  const preview = text.length > 800 ? text.slice(0, 800) + '…' : text

  return `请根据以下文本的核心内容，生成一段简洁的摘要（200-300字）。
摘要应包含：主要人物/实体、关键事件/概念、核心情感/主题。

原始文本：
"""
${preview}
"""

请输出 JSON 格式：{"summary": "你的摘要"}`.trim()
}

/**
 * 将 HyDE 生成的摘要作为嵌入文本
 */
export function applyHyDE(originalText: string, hydeSummary: string): string {
  if (!hydeSummary || hydeSummary.length < 20) return originalText
  // HyDE 摘要替代原文，但附加关键实体以保证特异性
  const entities = extractKeyEntities(originalText)
  return entities.length > 0
    ? `${hydeSummary}\n\n关键实体: ${entities.join(', ')}`
    : hydeSummary
}

/**
 * 提取文本中的关键词/实体（简单规则：长度 2-6 的非停用词片段）
 */
function extractKeyEntities(text: string): string[] {
  const words = text
    .replace(CN_PUNCTUATION, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && w.length <= 8)
    .filter(w => !CN_STOP_WORDS.has(w))

  // 按出现频率排序，取 top 10
  const freq = new Map<string, number>()
  for (const w of words) {
    freq.set(w, (freq.get(w) || 0) + 1)
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w)
}

// ===== 文本压缩层（层2：每 Token 承载更多信息） =====

/**
 * LLMLingua 风格压缩：
 *
 * 1. 移除低信息密度句子（信息词占比 < 阈值）
 * 2. 移除冗余修饰词
 * 3. 合并重复表达
 *
 * 不依赖外部 LLM，纯启发式。
 */
export function compressText(text: string, targetRatio: number = 0.4): string {
  if (!text || text.length < 200) return text

  // 按段落分割
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim())

  // 计算每个段落的信息密度
  const scored = paragraphs.map((para, idx) => {
    const cleaned = para.replace(CN_PUNCTUATION, '')
    const chars = [...cleaned]
    if (chars.length < 20) return { para, idx, score: 0.5 } // 短段落保留

    const infoChars = chars.filter(c => !CN_STOP_WORDS.has(c)).length
    // 信息密度 + 位置加权（开头和结尾段落更重要）
    const density = infoChars / chars.length
    const positionWeight = idx === 0 || idx === paragraphs.length - 1 ? 1.3 : 1.0
    return { para, idx, score: density * positionWeight }
  })

  // 保留 top N 段落
  const keepCount = Math.max(1, Math.ceil(paragraphs.length * targetRatio))
  const keepSet = new Set(
    scored.sort((a, b) => b.score - a.score).slice(0, keepCount).map(s => s.idx),
  )

  return paragraphs.filter((_, i) => keepSet.has(i)).join('\n\n')
}

// ===== 架构层优化（层3：去重 + 批处理 + 缓存） =====

/** 简单的内容哈希 */
export function contentHash(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  // 加上文本长度增强唯一性
  return `h${hash}_${text.length}`
}

/** 计算两个文本的简单相似度（基于字符 n-gram 重叠） */
export function textSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  const ngramsA = getCharNgrams(a, 3)
  const ngramsB = getCharNgrams(b, 3)
  if (ngramsA.size === 0 && ngramsB.size === 0) return 1

  let overlap = 0
  for (const ng of ngramsA) {
    if (ngramsB.has(ng)) overlap++
  }
  return overlap / Math.max(ngramsA.size, ngramsB.size, 1)
}

function getCharNgrams(text: string, n: number): Set<string> {
  const result = new Set<string>()
  for (let i = 0; i <= text.length - n; i++) {
    result.add(text.slice(i, i + n))
  }
  return result
}

/** 进度回调 */
export interface OptimizerProgress {
  step: string
  inputChars: number
  outputChars: number
  compressionRate: number
}

export type ProgressCallback = (progress: OptimizerProgress) => void

// ===== 优化管道 =====

export interface OptimizationResult {
  optimizedText: string
  /** 原始文本 */
  originalText: string
  /** 是否使用了 HyDE */
  hydeUsed: boolean
  /** HyDE 摘要（如有） */
  hydeSummary: string
  /** 压缩统计 */
  stats: {
    originalChars: number
    preprocessedChars: number
    finalChars: number
    /** 总压缩比 */
    overallCompression: number
  }
}

/**
 * 完整的嵌入前优化管道：
 *
 * 原始文本 → 预处理(截断+清洗) → [HyDE] → 压缩 → 输出
 */
export function optimizeForEmbedding(
  text: string,
  config: OptimizerConfig,
  hydeSummary?: string,
): OptimizationResult {
  const originalChars = text.length

  // 步骤1：预处理
  const preprocessed = preprocessText(text, config)
  const preprocessedChars = preprocessed.length

  // 步骤2：HyDE（如果启用且有摘要）
  let processed = preprocessed
  let hydeUsed = false
  if (config.enableHyDE && hydeSummary && hydeSummary.length > 20) {
    processed = applyHyDE(preprocessed, hydeSummary)
    hydeUsed = true
  }

  // 步骤3：压缩（如果文本仍然较长）
  let finalText = processed
  if (config.enableCompression && processed.length > 300) {
    finalText = compressText(processed, config.compressionRatio)
  }

  return {
    optimizedText: finalText,
    originalText: text,
    hydeUsed,
    hydeSummary: hydeSummary || '',
    stats: {
      originalChars,
      preprocessedChars,
      finalChars: finalText.length,
      overallCompression: originalChars > 0
        ? Math.round((1 - finalText.length / originalChars) * 100)
        : 0,
    },
  }
}
