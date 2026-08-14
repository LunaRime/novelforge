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
    // 感叹词有限集合，上限 10 防长期运行膨胀（P3 修复：tone/topWords 已有 slice 上限）
    interjections: [...new Set([...existing.interjections, ...newAnalysis.interjections])].slice(0, 10),
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

/** 正则转义（角色名可能含正则特殊字符） */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 将角色声音档案 upsert 到角色 notes（幂等）。
 *
 * 幂等规则：剥离该角色的旧 [VOICE:] 块 → mergeVoiceProfiles 合并新旧档案 → 写回单块。
 * 防止逐章定稿时无条件追加导致：notes 无限膨胀 + 读端（非全局匹配）永远取到最早档案。
 */
export function upsertVoiceProfile(notes: string, profile: CharacterVoiceProfile): string {
  const name = profile.name
  // ⚠️ P2 修复：块结束边界为「下一个 [VOICE:」或「换行后行首不是 {」（JSON 行以 { 开头）——
  //   此前 (?=$) 惰性匹配到字符串末尾：VOICE 块后用户追加的普通文本被当作块内容一并删除；
  //   修正版曾用 \n(?!\[VOICE:)——JSON 行也不以 [VOICE: 开头，头行后即满足，JSON 行残留
  const blockPattern = new RegExp(`\\n?\\[VOICE:${escapeRegExp(name)}\\][\\s\\S]*?(?=\\n\\[VOICE:|\\n(?!\\{))`)
  const oldMatch = notes.match(blockPattern)

  let merged = profile
  if (oldMatch) {
    try {
      // 提取块内 JSON（档案顶层无嵌套对象，可安全取首个 {...}）
      const inner = oldMatch[0].match(/\{[\s\S]*\}/)?.[0]
      if (inner) {
        const old = JSON.parse(inner) as CharacterVoiceProfile
        if (old && Array.isArray(old.topWords)) merged = mergeVoiceProfiles(old, profile)
      }
    } catch { /* 旧档案解析失败时直接用新档案 */ }
  }

  // 剥离旧块并压缩多余空行，保留该角色其他笔记内容
  const stripped = notes.replace(blockPattern, '').replace(/\n{3,}/g, '\n\n').trim()
  // analyzedChapters 重置为本次分析结果，避免 "最新章 + 最新章 + ..." 无限拼接
  merged.analyzedChapters = profile.analyzedChapters
  return (stripped ? stripped + '\n' : '') + `[VOICE:${name}]\n${JSON.stringify(merged)}\n`
}

/**
 * 从角色卡 notes 中加载全部声音档案（[VOICE:角色名] JSON 标记）
 * 供写稿 prompt 注入（防 OOC）与审计复用
 */
export async function loadCharacterVoiceProfiles(): Promise<CharacterVoiceProfile[]> {
  try {
    const { ipc } = await import('./ipc-client')
    const allChars = await ipc.invoke('db:character-get-all') as Array<{ name: string; notes?: string }>
    const profiles: CharacterVoiceProfile[] = []

    for (const c of allChars) {
      if (!c.name || !c.notes) continue
      const p = extractVoiceProfileFromNotes(c.notes, c.name)
      if (p) profiles.push(p)
    }
    return profiles
  } catch {
    return []
  }
}

/**
 * 从单角色 notes 解析其 [VOICE:name] 声音档案（同步；供试演 prompt 注入）。
 * 匹配全部 [VOICE:角色名]\n{JSON}\n 块（P2 修复：此前非全局正则只读首个块——
 * notes 被其他角色名块污染时读到错误档案；且校验块内 name 与角色名一致）
 */
export function extractVoiceProfileFromNotes(notes: string, name: string): CharacterVoiceProfile | null {
  if (!notes || !name) return null
  const matches = notes.matchAll(/\[VOICE:([^\]]+)\]\s*\n?([\s\S]*?)(?=\n\[VOICE:|$)/g)
  for (const match of matches) {
    if (match[1].trim() !== name) continue // 块内 name 与角色名不一致 → 跳过（污染块）
    try {
      const parsed = JSON.parse(match[2].trim()) as Partial<CharacterVoiceProfile>
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.topWords)) {
        return { ...parsed, name: match[1] } as CharacterVoiceProfile
      }
    } catch { /* 单条解析失败跳过 */ }
  }
  return null
}

// ===== 内部工具函数 =====

/** 引号字符类（半角 + 中文左右引号——原实现漏左引号“，中文对话全漏提） */
const QUOTES = '["“”]'

/** 说话动词组（中英文；英文需 i 标志匹配 said/says 等） */
const SPEECH_VERBS = '(?:[说问道喊叫嚷叹怒笑哭]|said|says|asked|replied|whispered|shouted|murmured)'

/** 提取指定角色的对话行 */
function extractDialogue(content: string, name: string): string[] {
  const lines: string[] = []
  const escaped = escapeRegExp(name)
  // 名字与说话动词之间允许空格（英文 "苏晚 said:" / 中文 "苏晚 说："）
  const nameVerb = `${escaped}\\s*${SPEECH_VERBS}`

  // 模式1：匹配 "角色名说：..." 或 "角色名道：..." 模式（中英文动词）
  const regex = new RegExp(
    `${nameVerb}\\s*[：:]\\s*${QUOTES}(.+?)${QUOTES}`,
    'gi',
  )
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    lines.push(match[1].trim())
  }

  // 模式2：直接引号在前、说话人在后（中间无标点）
  const altRegex = new RegExp(`${QUOTES}(.+?)${QUOTES}\\s*${nameVerb}`, 'gi')
  while ((match = altRegex.exec(content)) !== null) {
    lines.push(match[1].trim())
  }

  // 模式3（P2-2）：引号段与说话人之间允许标点/空格/助词——
  // 原模式2 中间出现「。」「，」「着」等即漏提（"走吧。" 苏晚说着）
  const spacedRegex = new RegExp(
    `${QUOTES}(.+?)${QUOTES}[，。！？!?…\\s、，]*${nameVerb}`,
    'gi',
  )
  while ((match = spacedRegex.exec(content)) !== null) {
    lines.push(match[1].trim())
  }

  return [...new Set(lines)].filter(l => l.length > 2)
}

/** 分析语气 */
function analyzeTone(lines: string[]): string[] {
  const tones: string[] = []
  const allText = lines.join(' ')

  const tonePatterns: Record<string, RegExp> = {
    // P2-2：检测词补英/俄（大小写不敏感）；tone 标签保持中文（prompt 数据）
    '冷酷': /冷[冷漠淡]|无情|杀[意气]|寒[气意]|冰[冷寒]|cold|cruel|ruthless|холод|жесток/i,
    '温柔': /温柔|轻声|柔和|温暖|体贴|关怀|gentle|soft|tender|kind|нежн|мягк|добр/i,
    '热血': /冲[啊呀]|来吧|战斗|绝不|拼了|燃|fight|never give up|fire|пыл|бой|борьб/i,
    '冷静': /冷静|沉着|淡定|思索|分析|calm|rational|serene|composed|спокойн|рассуд|анализ/i,
    '傲娇': /哼[！!]|笨蛋|谁[要会]|才不|别[误会想]|tsundere/i,
    '幽默': /哈哈|笑[死了]|搞笑|吐槽|幽默|funny|joke|humor|hilarious|шутк|смешн/i,
    '严肃': /严肃|认真|重要|必须|责任|serious|important|strict|duty|серьёз|важн|долг/i,
    '悲伤': /哭[了泣]|伤心|难过|痛苦|泪水|sad|cry|tears|grief|груст|печал|слёз|гор/i,
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
    // P2-2：英文高频停用词（英文对话分词片段）
    'the', 'and', 'you', 'your', 'that', 'this', 'with', 'have', 'are', 'was',
    'were', 'for', 'but', 'not', 'they', 'she', 'his', 'her', 'them', 'what',
    'will', 'would', 'can', 'could', 'should', 'just', 'like', 'know', 'said',
    'yeah', 'well', 'look', 'really', 'right', 'want', 'need', 'think', 'go',
    'come', 'see', 'let', 'gonna', 'okay', 'ok',
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
