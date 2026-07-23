/**
 * NovelForge 角色声音分析器 — 保持长篇角色说话风格一致性
 *
 * 定稿后自动分析每个角色的对话特征：
 * 1. 语气倾向（冷酷/温柔/热血/冷静...）
 * 2. 常用词汇和句式
 * 3. 句长偏好
 * 4. 敬语使用
 *
 * 写稿时自动注入角色声音指纹到 prompt，确保角色说话风格前后一致。
 */

// ===== 类型定义 =====

export interface CharacterVoiceProfile {
  /** 角色名 */
  name: string
  /** 语气标签 */
  tone: string[]
  /** 高频词 Top-20 */
  topWords: string[]
  /** 平均句长（字数） */
  avgSentenceLength: number
  /** 典型句式（2-3 句） */
  sampleLines: string[]
  /** 敬语使用频率 (0-1) */
  formalityLevel: number
  /** 感叹词偏好 */
  interjections: string[]
  /** 分析来源章节范围 */
  analyzedChapters: string
  /** 最后更新时间 */
  updatedAt: string
}

/** 角色声音卡（可注入 prompt） */
export interface CharacterVoiceCard {
  name: string
  profile: CharacterVoiceProfile | null
}

// ===== 分析逻辑 =====

/**
 * 从章节文本中提取角色对话并分析声音特征
 */
export function analyzeCharacterVoice(
  chapterContent: string,
  characterName: string,
): CharacterVoiceProfile {
  // 提取该角色的所有对话行
  const dialogueLines = extractDialogue(chapterContent, characterName)

  if (dialogueLines.length === 0) {
    return createEmptyProfile(characterName)
  }

  // 分析
  const tone = analyzeTone(dialogueLines)
  const topWords = extractTopWords(dialogueLines, 20)
  const avgSentenceLength = Math.round(
    dialogueLines.reduce((s, l) => s + l.length, 0) / dialogueLines.length,
  )
  const sampleLines = selectSampleLines(dialogueLines, 3)
  const formalityLevel = calculateFormality(dialogueLines)
  const interjections = extractInterjections(dialogueLines)

  return {
    name: characterName,
    tone,
    topWords,
    avgSentenceLength,
    sampleLines,
    formalityLevel,
    interjections,
    analyzedChapters: '最新章',
    updatedAt: new Date().toISOString(),
  }
}

/**
 * 合并新旧声音档案（增量更新）
 */
export function mergeVoiceProfiles(
  existing: CharacterVoiceProfile,
  newAnalysis: CharacterVoiceProfile,
): CharacterVoiceProfile {
  // 合并 topWords：保留旧的 + 添加新的，去重后按频率排序
  const wordFreq = new Map<string, number>()
  for (const w of existing.topWords) wordFreq.set(w, (wordFreq.get(w) || 0) + 1)
  for (const w of newAnalysis.topWords) wordFreq.set(w, (wordFreq.get(w) || 0) + 2) // 新词权重更高
  const mergedWords = [...wordFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([w]) => w)

  return {
    ...existing,
    tone: [...new Set([...existing.tone, ...newAnalysis.tone])].slice(0, 5),
    topWords: mergedWords,
    avgSentenceLength: Math.round(
      (existing.avgSentenceLength * 0.6 + newAnalysis.avgSentenceLength * 0.4),
    ),
    sampleLines: newAnalysis.sampleLines.length > 0
      ? newAnalysis.sampleLines
      : existing.sampleLines,
    formalityLevel: existing.formalityLevel * 0.6 + newAnalysis.formalityLevel * 0.4,
    interjections: [...new Set([...existing.interjections, ...newAnalysis.interjections])],
    analyzedChapters: `${existing.analyzedChapters} + ${newAnalysis.analyzedChapters}`,
    updatedAt: new Date().toISOString(),
  }
}

/**
 * 将角色声音档案格式化为 prompt 注入文本
 */
export function formatVoiceForPrompt(profiles: CharacterVoiceProfile[]): string {
  if (profiles.length === 0) return ''

  const parts = ['## 角色声音一致性参考']

  for (const p of profiles) {
    const toneStr = p.tone.join('、')
    const wordsStr = p.topWords.slice(0, 10).join('、')
    const samplesStr = p.sampleLines.map(l => `"${l}"`).join('；')
    const formalityStr = p.formalityLevel > 0.6 ? '偏正式' : p.formalityLevel > 0.3 ? '适中' : '偏随意'

    parts.push(
      `**${p.name}**: 语气[${toneStr}] | 常用词[${wordsStr}] | ` +
      `句长约${p.avgSentenceLength}字 | 语体[${formalityStr}]` +
      (samplesStr ? `\n  典型对话: ${samplesStr}` : ''),
    )
  }

  return parts.join('\n')
}

// ===== 内部工具函数 =====

/** 提取指定角色的对话行 */
function extractDialogue(content: string, name: string): string[] {
  const lines: string[] = []

  // 匹配 "角色名说：..." 或 "角色名道：..." 模式
  const regex = new RegExp(
    `${name}[说问道喊叫嚷叹怒笑哭]\\s*[：:]\\s*[""](.+?)[""]`,
    'g',
  )
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    lines.push(match[1].trim())
  }

  // 也匹配直接引号格式
  const altRegex = new RegExp(`[""](.+?)[""]\\s*${name}[说问道]`, 'g')
  while ((match = altRegex.exec(content)) !== null) {
    lines.push(match[1].trim())
  }

  return lines.filter(l => l.length > 2)
}

/** 分析语气 */
function analyzeTone(lines: string[]): string[] {
  const tones: string[] = []
  const allText = lines.join(' ')

  const tonePatterns: Record<string, RegExp> = {
    '冷酷': /冷[冷漠淡]|无情|杀[意气]|寒[气意]|冰[冷寒]/,
    '温柔': /温柔|轻声|柔和|温暖|体贴|关怀/,
    '热血': /冲[啊呀]|来吧|战斗|绝不|拼了|燃/,
    '冷静': /冷静|沉着|淡定|思索|分析/,
    '傲娇': /哼[！!]|笨蛋|谁[要会]|才不|别[误会想]/,
    '幽默': /哈哈|笑[死了]|搞笑|吐槽|幽默/,
    '严肃': /严肃|认真|重要|必须|责任/,
    '悲伤': /哭[了泣]|伤心|难过|痛苦|泪水/,
  }

  for (const [tone, pattern] of Object.entries(tonePatterns)) {
    if (pattern.test(allText)) tones.push(tone)
  }

  return tones.length > 0 ? tones : ['中性']
}

/** 提取高频词 */
function extractTopWords(lines: string[], count: number): string[] {
  const freq = new Map<string, number>()
  const stopWords = new Set([
    '的', '了', '是', '我', '你', '他', '她', '不', '就', '也', '都', '要',
    '说', '在', '有', '人', '这', '那', '什么', '怎么', '吗', '呢', '啊',
  ])

  for (const line of lines) {
    // 简单分词（2-4 字片段）
    for (let i = 0; i <= line.length - 2; i++) {
      for (let len = 2; len <= 4 && i + len <= line.length; len++) {
        const word = line.slice(i, i + len)
        if (stopWords.has(word)) continue
        freq.set(word, (freq.get(word) || 0) + 1)
      }
    }
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([w]) => w)
}

/** 选择代表性句子 */
function selectSampleLines(lines: string[], count: number): string[] {
  // 选择长度适中的句子（排除太短和太长的）
  const filtered = lines
    .map((l, i) => ({ line: l, idx: i, len: l.length }))
    .filter(l => l.len >= 5 && l.len <= 40)
    .sort((a, b) => a.len - b.len)

  // 均匀采样
  if (filtered.length <= count) return filtered.map(l => l.line)
  const step = Math.floor(filtered.length / count)
  return Array.from({ length: count }, (_, i) => filtered[i * step]?.line || '').filter(Boolean)
}

/** 计算正式度 */
function calculateFormality(lines: string[]): number {
  let formalScore = 0
  const formalWords = ['您', '请', '抱歉', '感谢', '麻烦', '能否', '可否', '谨', '恭']
  const casualWords = ['哈', '嘿', '操', '靠', '妈的', '卧槽', '牛逼', '老铁']

  for (const line of lines) {
    for (const w of formalWords) if (line.includes(w)) formalScore += 0.1
    for (const w of casualWords) if (line.includes(w)) formalScore -= 0.1
  }

  return Math.max(0, Math.min(1, 0.5 + formalScore / Math.max(lines.length, 1)))
}

/** 提取感叹词 */
function extractInterjections(lines: string[]): string[] {
  const interjections = ['哈', '哼', '嗯', '哦', '啊', '哎', '喂', '切', '呸', '艹']
  const found = new Set<string>()

  for (const line of lines) {
    for (const interj of interjections) {
      if (line.includes(interj + interj) || line.startsWith(interj)) {
        found.add(interj)
      }
    }
  }

  return [...found]
}

function createEmptyProfile(name: string): CharacterVoiceProfile {
  return {
    name,
    tone: ['未分析'],
    topWords: [],
    avgSentenceLength: 0,
    sampleLines: [],
    formalityLevel: 0.5,
    interjections: [],
    analyzedChapters: '无',
    updatedAt: new Date().toISOString(),
  }
}
