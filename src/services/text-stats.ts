/**
 * text-stats — 文本统计服务（共享纯函数）
 *
 * LLM 生成小说的字数统计统一口径：
 * - LLM 在生成时不应逐字计数（慢且不可靠），由系统自动统计
 * - 供 Agent 工具 count_characters 与工作流落库 wordCount 共用
 */

/** 文本统计结果 */
export interface TextStats {
  /** 总字符数（含空格/换行/标点） */
  totalChars: number
  /** 非空白字符数 */
  nonWhitespaceChars: number
  /** 汉字数（CJK 统一表意文字） */
  chineseChars: number
  /** 英文/数字单词数 */
  englishWords: number
  /** 中文标点符号数 */
  punctuationCount: number
  /** 行数 */
  lines: number
  /**
   * 小说"有效字数"口径：汉字 + 英文单词（不含标点/空白）。
   * 与网文平台字数统计习惯一致，供字数限制与体量判断使用。
   */
  novelWordCount: number
}

/** 中文标点正则（含全角符号） */
const CN_PUNCT_REGEX = /[，。！？；：""''《》、（）—…·～【】]/g

/**
 * 计算文本统计
 * @param text 待统计文本
 */
export function computeTextStats(text: string): TextStats {
  const totalChars = text.length
  const nonWhitespaceChars = text.replace(/\s/g, '').length
  const chineseChars = (text.match(/[一-鿿]/g) || []).length
  const englishWords = (text.match(/[a-zA-Z0-9]+/g) || []).length
  const punctuationCount = (text.match(CN_PUNCT_REGEX) || []).length
  const lines = text.split('\n').length
  const novelWordCount = chineseChars + englishWords

  return {
    totalChars,
    nonWhitespaceChars,
    chineseChars,
    englishWords,
    punctuationCount,
    lines,
    novelWordCount,
  }
}

/**
 * 将统计格式化为 LLM 可读的结构化文本
 * @param stats 统计结果
 * @param label 统计对象描述（如"第 3 章草稿"）
 */
export function formatTextStats(stats: TextStats, label: string): string {
  return [
    `【${label} 字数统计】`,
    `- 有效字数：${stats.novelWordCount} 字（汉字 ${stats.chineseChars} + 英文/数字 ${stats.englishWords}）`,
    `- 总字符数：${stats.totalChars}（含标点与空白）`,
    `- 非空白字符：${stats.nonWhitespaceChars}`,
    `- 中文标点：${stats.punctuationCount} 个`,
    `- 行数：${stats.lines}`,
  ].join('\n')
}
