/**
 * audits — 生成后审计纯函数库（零 LLM 依赖）
 *
 * 六类审计：重复词 / 章节衔接 / 术语统一 / 蓝图完成度 / 违禁词 / 时间线。
 * 全部为纯函数，输入文本与上下文，输出结构化问题清单。
 * 供后处理步骤（finalize 审计）与 Agent 工具复用。
 */

import { t } from '../../shared/locale'

// ===== 通用类型 =====

export interface AuditIssue {
  kind: 'repetition' | 'continuity' | 'terminology' | 'blueprint' | 'sensitive' | 'timeline'
  severity: 'warn' | 'error'
  message: string
  /** 位置提示（如"第 3/7/12 段"） */
  position?: string
}

export interface AuditResult {
  passed: boolean
  issues: AuditIssue[]
  summary: string
}

/**
 * 跨词边界虚字（助词/量词/数词/介词/连词/副词/方位/语气）——
 * 2-gram 含此类字即视为跨词边界碎片（「了一」「枚碎」「的虚」「第二」），
 * 语言上无实义，不构成水文/衔接/专名信号（用户实测 4 个误报全部由此产生）。
 * 只做**边界模式**判定（首字/尾字位），不逐字过滤——「碎片」「虚脉」等
 * 实词组合不受影响。
 */
const GRAM_BOUNDARY_PREFIX = new Set([
  // '了' 同时在前后位（「走了一程」的「了一」是上一词尾字边界；误伤「了解」可接受——实词报警价值低）
  '了', '的', '枚', '第', '个', '只', '条', '位', '名', '双', '棵', '座', '块', '件', '种', '类', '支', '张', '根', '面',
  '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '百', '千', '万', '两',
  '与', '和', '及', '或', '而', '且', '但', '也', '都', '还', '就', '才', '又', '再', '曾', '已', '将', '会', '能', '要', '可', '很', '最', '更', '太', '没', '别',
  '这', '那', '之', '其', '们', '上', '下', '中', '里', '前', '后', '左', '右', '内', '外', '旁',
  '吗', '呢', '啊', '吧', '呀',
])
const GRAM_BOUNDARY_SUFFIX = new Set([
  '的', '了', '着', '过', '地', '得', '吗', '呢', '啊', '吧', '呀', '么', '们',
])

function isBoundaryNgram(ngram: string): boolean {
  return ngram.length === 2 && (GRAM_BOUNDARY_PREFIX.has(ngram[0]) || GRAM_BOUNDARY_SUFFIX.has(ngram[1]))
}

/** 提取 2-3 字中文词（滑窗，跳过标点与空白；2-gram 过滤跨词边界虚字碎片） */
function extractCnNgrams(text: string, n: 2 | 3): string[] {
  const chars = text.replace(/\s/g, '').split('')
  const out: string[] = []
  for (let i = 0; i <= chars.length - n; i++) {
    // 跳过含标点的窗口
    if (/[，。！？；：""''《》、（）—…·～【】]/.test(chars.slice(i, i + n).join(''))) continue
    const gram = chars.slice(i, i + n).join('')
    if (n === 2 && isBoundaryNgram(gram)) continue
    out.push(gram)
  }
  return out
}

/** 移除对话区（「」/“”）内容，用于非对话词频统计 */
function stripDialogue(text: string): string {
  return text
    .replace(/「[^」]*」/g, ' ')
    .replace(/“[^”]*”/g, ' ')
}

/** 提取正文中的中文 2 字词集合（用于重叠检测） */
function cnBigramSet(text: string): Set<string> {
  return new Set(extractCnNgrams(text, 2))
}

/**
 * 判断 2-gram 是否属于豁免专名（角色名/术语）的组成部分。
 * 「苏晚晴」→ 其 2-gram 为「苏晚」「晚晴」——角色名在正文中高频出现是正常
 * 叙事，不是重复水文；含专名的 2-gram 一律不参与词频/衔接统计。
 */
function isExcludedNgram(ngram: string, excludeWords: string[]): boolean {
  return excludeWords.some(t => t.length >= 2 && t.includes(ngram))
}

// ===== 1. 重复词审计（对应"重复水文"） =====

/** 水文检测白名单（用户可配置的豁免） */
export interface AuditWhitelist {
  /** 词/2-gram 豁免（如 "缓缓"——作者标志性文风） */
  words?: string[]
  /** 句首模式豁免（如 "只见"——本作叙事习惯） */
  patterns?: string[]
  /** 完整句子豁免（故意复用的句子，如口号/咒语） */
  sentences?: string[]
}

export interface RepetitionAuditOptions {
  /**
   * 同词报警阈值。默认按章节长度动态计算：max(10, 字数/300)——
   * 短文本下限 10 次（下限 8 曾误报「小屋」8 次等场景词）；正文越长阈值越高
   * （固定阈值 3 会把「世界」11 次这类正常语境词误报为水文）
   */
  maxRepeat?: number
  /** 报告上限（默认 8） */
  topN?: number
  /** 豁免词（角色名/术语等专名——正文高频出现是正常叙事，不参与统计） */
  excludeWords?: string[]
  /**
   * 本书历史章节基线词频（buildBaselineFreqs 输出）。
   * 根源性判定：**不识别"什么是专名"，而是问"这个词在这本书里通常出现
   * 多少次"**——专名/场景词/常用词在本书稳定高频（基线高 → 天然豁免），
   * 真正的水文是"本章异常高频"（超基线 ×2）。报警条件：
   * `本章频次 ≥ max(绝对下限 8, 基线 × 2)`；无基线（首章）回退动态阈值。
   */
  baselineFreqs?: Record<string, number>
  /** 短句（4-30 字）完全重复 ≥N 次报警（默认 3）——AI 复读/复制粘贴典型信号 */
  sentenceRepeatThreshold?: number
  /** 句首 3 字模板重复 ≥N 次报警（默认 6）——句式单调/水文节奏 */
  sentenceStartThreshold?: number
  /** 白名单：words 并入词频豁免；patterns 豁免句首；sentences 豁免完整句 */
  whitelist?: AuditWhitelist
}

/** 按句末标点切分句子（保留对话引导语） */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？；])/)
    .map(s => s.replace(/[。！？；]+$/, '').trim())
    .filter(s => s.length > 0)
}

/** 句首 3 字模式（跳过前导引号/空白） */
function sentenceStart3(sentence: string): string {
  return sentence.replace(/^[\s“「"'‘]+/, '').slice(0, 3)
}

/**
 * 对话引导语（人称 + 说/道/问/答等）——正常对话节奏，不算句式单调。
 * 精确判断为"句首 3 字模板以任一引导词开头"（如"他说了"命中"他说"）。
 */
const DIALOG_LEADS = ['他说', '她说', '他道', '她道', '我道', '你道', '问道', '答道', '应道', '笑道', '喊道', '叫道', '心想', '暗道', '低语', '忽然道', '冷冷道']

/**
 * 水文与重复结构检测（词频审计升级版）。
 *
 * 三维信号：
 * 1. **词频堆砌**（原有）：2-gram 高频 + 跨章基线（超基线 ×2 才算异常）
 * 2. **句子重复**：完全相同句子反复出现——AI 复读/复制粘贴的典型信号。
 *    短句（4-30 字）≥3 次、长句（>30 字）≥2 次报警（长句复读更可疑）。
 * 3. **句首模板**：同一句首 3 字模式反复——句式单调/水文节奏。
 *    对话引导语（他说/她道…）与白名单 patterns 豁免。
 *
 * 白名单（AuditWhitelist）：words 并入词频豁免（作者标志性文风）、
 * patterns 豁免句首模板（本作叙事习惯）、sentences 豁免完整句（口号/咒语等故意复用）。
 */
export function waterAudit(text: string, options: RepetitionAuditOptions = {}): AuditResult {
  const {
    maxRepeat = Math.max(10, Math.floor(text.length / 300)),
    topN = 8,
    excludeWords = [],
    baselineFreqs,
    sentenceRepeatThreshold = 3,
    sentenceStartThreshold = 6,
    whitelist,
  } = options
  const body = stripDialogue(text)
  const issues: AuditIssue[] = []

  // ===== 1. 词频堆砌 =====
  // 白名单词（作者标志性文风）用替换式豁免：整词从正文剔除后再统计——
  // 「缓缓」不仅自身不报，其相邻 2-gram（「他缓」「缓起」）也不产生信号
  let freqSource = body
  for (const w of whitelist?.words ?? []) {
    if (w && w.length >= 2) freqSource = freqSource.split(w).join(' ')
  }
  const freq = new Map<string, number>()
  for (const word of extractCnNgrams(freqSource, 2)) {
    if (isExcludedNgram(word, excludeWords)) continue
    freq.set(word, (freq.get(word) ?? 0) + 1)
  }
  // 排除常见虚词组合与高频语境词（「世界」等场景词重复不构成水文）
  const stop = new Set(['一个', '什么', '自己', '没有', '就是', '这个', '那个', '时候', '已经', '知道', '可以', '现在', '起来', '这么', '那么', '他们', '我们', '你们', '怎么', '还是', '因为', '所以', '但是', '如果', '虽然', '然后', '最后', '世界', '整个', '地方', '东西', '感觉', '看见', '看到', '想到', '心里', '脸上', '声音', '样子', '事情', '眼前', '周围'])
  const hits = [...freq.entries()]
    .filter(([w, c]) => {
      if (stop.has(w) || isExcludedNgram(w, excludeWords)) return false
      const base = baselineFreqs?.[w] ?? 0
      if (base > 0) return c >= Math.max(8, base * 2) // 有基线：超本书均值 2 倍且过绝对下限
      return c >= maxRepeat // 无基线（首章/少章）：动态阈值
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
  for (const [w, c] of hits) {
    issues.push({
      kind: 'repetition',
      severity: c >= maxRepeat + 3 ? 'error' : 'warn',
      message: t('audit.wordRepeat').replace('{word}', w).replace('{n}', String(c)),
    })
  }

  // ===== 2. 句子重复（AI 复读典型信号） =====
  const sentences = splitSentences(body)
  const sentFreq = new Map<string, number>()
  for (const s of sentences) {
    if (s.length < 4 || s.length > 80) continue // 太短/太长的句子无检测意义
    if (whitelist?.sentences?.includes(s)) continue
    sentFreq.set(s, (sentFreq.get(s) ?? 0) + 1)
  }
  const sentHits = [...sentFreq.entries()]
    .filter(([s, c]) => c >= (s.length > 30 ? 2 : sentenceRepeatThreshold)) // 长句复读更可疑
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
  for (const [s, c] of sentHits) {
    issues.push({
      kind: 'repetition',
      severity: 'error', // 整句复读是强水文信号
      message: t('audit.sentenceRepeat').replace('{n}', String(c)).replace('{sentence}', s.length > 30 ? s.slice(0, 30) + '…' : s),
    })
  }

  // ===== 3. 句首模板（句式单调） =====
  const startFreq = new Map<string, number>()
  for (const s of sentences) {
    if (s.length < 6) continue // 太短的句子不参与句式统计
    const start3 = sentenceStart3(s)
    if (start3.length < 2) continue
    if (isExcludedNgram(start3, excludeWords)) continue // 角色名开头的句子（"苏晚向前"）正常
    if (whitelist?.words?.some(w => w.length >= 2 && start3.includes(w))) continue // 白名单文风词开头的句子
    if (DIALOG_LEADS.some(lead => start3.startsWith(lead))) continue // 对话引导语正常
    if (whitelist?.patterns?.some(p => start3.startsWith(p))) continue
    startFreq.set(start3, (startFreq.get(start3) ?? 0) + 1)
  }
  const startHits = [...startFreq.entries()]
    .filter(([, c]) => c >= sentenceStartThreshold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
  for (const [st, c] of startHits) {
    issues.push({
      kind: 'repetition',
      severity: 'warn',
      message: t('audit.sentenceStart').replace('{pattern}', st).replace('{n}', String(c)),
    })
  }

  // 汇总：错误级优先
  issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))

  return {
    passed: issues.length === 0,
    issues,
    summary: issues.length === 0
      ? t('audit.waterPassed')
      : t('audit.waterFound').replace('{n}', String(issues.length)),
  }
}

/** 兼容旧名：词频审计 = 水文检测的子集（保留导出防破坏） */
export const repetitionAudit = waterAudit

// ===== 1.5 基线频率与设定专名（重复词审计的数据源） =====

/**
 * 从本书已定稿章节正文构建 2-gram 基线频率表。
 * - 每章独立统计（章节长度波动天然归一化）
 * - 只在 ≥2 章出现的词才入表（跨章稳定词——角色名/术语/场景词/常用词
 *   每章都出现属"本书正常密度"；单章偶然词是本章特有，不构成基线）
 * - 值 = 出现章的平均频次
 * - 少于 2 章返回 {}（调用方回退动态阈值）
 */
export function buildBaselineFreqs(chapters: string[]): Record<string, number> {
  const perChapter = chapters
    .filter(ch => ch && ch.trim())
    .map(ch => {
      const m = new Map<string, number>()
      for (const w of extractCnNgrams(stripDialogue(ch), 2)) {
        m.set(w, (m.get(w) ?? 0) + 1)
      }
      return m
    })
  if (perChapter.length < 2) return {}

  const appearChapters = new Map<string, number>()
  const totalFreq = new Map<string, number>()
  for (const m of perChapter) {
    for (const [w, c] of m) {
      appearChapters.set(w, (appearChapters.get(w) ?? 0) + 1)
      totalFreq.set(w, (totalFreq.get(w) ?? 0) + c)
    }
  }
  const baseline: Record<string, number> = {}
  for (const [w, appear] of appearChapters) {
    if (appear >= 2) baseline[w] = totalFreq.get(w)! / appear
  }
  return baseline
}

/** 世界观提取专用通用词表（设定文本高频的普通词，非专名，混入豁免会让水文检测失效） */
const SETTING_COMMON_WORDS = new Set([
  '世界', '大陆', '天地', '整个', '修炼', '境界', '强者', '实力', '灵力', '灵气', '气息',
  '体内', '身体', '灵魂', '精神', '意识', '力量', '宗门', '家族', '帝国', '王朝', '城池',
  '山脉', '森林', '天空', '地面', '身上', '心中', '眼前', '周围', '时候', '现在', '知道',
  '可以', '没有', '就是', '什么', '自己', '一个', '已经', '他们', '我们', '怎么', '因为',
  '所以', '但是', '如果', '然后', '最后', '突然', '缓缓', '淡淡', '冷冷', '微微', '轻轻',
  '声音', '样子', '事情', '地方', '东西', '感觉', '看见', '想到', '心里', '脸上', '这个',
  '那个', '起来', '这么', '那么', '还是', '虽然',
])

/**
 * 从世界观/设定文本提取专名候选（首章无基线时的兜底豁免词）。
 * 高置信来源：引号/书名号内词（设定作者标注专名的惯例，如「武魂」体系、《魂殿》秘辛）；
 * 低置信来源：全文高频 2-3 字词（≥3 次，过滤通用词表）。
 * 上限 60 防膨胀；普通词混入在"首章兜底"场景可接受——宁可少报不误报。
 */
export function extractSettingNouns(worldText: string): string[] {
  if (!worldText.trim()) return []
  const nouns = new Set<string>()
  // 1. 引号/书名号内（2-8 字、不含标点）
  for (const m of worldText.matchAll(/[「《]([^」》\s，。！？；：、（）—…·～【】]{2,8})[」》]/g)) {
    nouns.add(m[1])
  }
  // 2. 全文高频 2-3 字词（≥3 次，过滤通用词）
  const freq = new Map<string, number>()
  for (const w of [...extractCnNgrams(worldText, 2), ...extractCnNgrams(worldText, 3)]) {
    freq.set(w, (freq.get(w) ?? 0) + 1)
  }
  for (const [w, c] of freq) {
    if (c >= 3 && !SETTING_COMMON_WORDS.has(w) && !nouns.has(w)) nouns.add(w)
  }
  return [...nouns].slice(0, 60)
}

// ===== 2. 章节衔接审计（对应"开头跳戏"） =====

export interface ContinuityAuditOptions {
  /** 本章开头取样长度（字符） */
  chapterHeadLen?: number
  /** 上章结尾取样长度（字符） */
  prevTailLen?: number
  /** 最少重叠词数（低于则提示） */
  minOverlap?: number
  /** 豁免词（角色名/术语——两章都提主角不算衔接信号） */
  excludeWords?: string[]
}

/**
 * 检测本章开头与上章结尾的衔接度（2 字词重叠计数；专名重叠不计——两章都出现
 * 主角名不代表衔接，真正衔接靠场景/动作词）
 */
export function continuityAudit(
  chapterText: string,
  prevChapterEnding?: string,
  options: ContinuityAuditOptions = {},
): AuditResult {
  const { chapterHeadLen = 100, prevTailLen = 200, minOverlap = 2, excludeWords = [] } = options
  if (!prevChapterEnding || !prevChapterEnding.trim()) {
    return { passed: true, issues: [], summary: t('audit.noPrevEnding') }
  }

  const head = new Set(
    [...cnBigramSet(chapterText.slice(0, chapterHeadLen))].filter(w => !isExcludedNgram(w, excludeWords)),
  )
  const tail = new Set(
    [...cnBigramSet(prevChapterEnding.slice(-prevTailLen))].filter(w => !isExcludedNgram(w, excludeWords)),
  )
  let overlap = 0
  for (const w of tail) if (head.has(w)) overlap++

  const issues: AuditIssue[] = []
  if (overlap < minOverlap) {
    issues.push({
      kind: 'continuity',
      severity: 'warn',
      message: t('audit.continuityWeak')
        .replace('{n}', String(overlap))
        .replace('{threshold}', String(minOverlap)),
    })
  }

  return {
    passed: issues.length === 0,
    issues,
    summary: issues.length === 0
      ? t('audit.continuityOk').replace('{n}', String(overlap))
      : t('audit.continuityPoor').replace('{n}', String(overlap)),
  }
}

// ===== 3. 术语统一审计（对应"人名/地名不一致"） =====

/**
 * 检测术语（角色名/专有名词）在正文中的完整出现与疑似变体写法。
 * 变体判定：以术语前 2 字为前缀、长度差 ≤1 的相邻 token。
 */
export function terminologyAudit(text: string, terms: string[]): AuditResult {
  const issues: AuditIssue[] = []
  const cleanTerms = terms.filter(t => t && t.length >= 2)

  for (const term of cleanTerms) {
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const fullCount = (text.match(new RegExp(esc(term), 'g')) || []).length

    // 疑似变体判定：术语前 3 字前缀的出现次数 > 完整术语出现次数
    // （"上官婉"出现 3 次而"上官婉儿"只出现 2 次 → 有 1 处被少字改写）
    // 前缀本身是完整术语的一部分，prefixCount >= fullCount 恒成立；严格大于才报
    const prefix3 = term.slice(0, 3)
    if (prefix3.length === 3 && fullCount > 0) {
      const prefixCount = (text.match(new RegExp(esc(prefix3), 'g')) || []).length
      if (prefixCount > fullCount) {
        issues.push({
          kind: 'terminology',
          severity: 'warn',
          message: t('audit.termVariant')
            .replace('{term}', term)
            .replace('{prefix}', prefix3)
            .replace('{prefixCount}', String(prefixCount))
            .replace('{fullCount}', String(fullCount)),
        })
      }
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    summary: issues.length === 0 ? t('audit.termPassed') : t('audit.termFound').replace('{n}', String(issues.length)),
  }
}

// ===== 4. 蓝图完成度审计（对应"漏写关键事件"） =====

/**
 * 检测本章关键事件（blueprints.key_events）是否在正文中体现。
 * 每个事件提取 2 字核心词（跳过停用词），全部未命中则判缺失。
 */
export function blueprintAudit(chapterText: string, keyEvents: string[]): AuditResult {
  const body = stripDialogue(chapterText)
  const bodySet = cnBigramSet(body)
  const stop = new Set(['一个', '什么', '自己', '没有', '就是', '这个', '那个', '时候', '已经', '知道', '可以', '现在', '起来', '他们', '我们', '你们', '怎么', '然后', '最后', '本章', '关键', '事件', '重要', '剧情'])

  const issues: AuditIssue[] = []
  for (const ev of keyEvents) {
    if (!ev || !ev.trim()) continue
    const words = extractCnNgrams(ev.replace(/[，。！？；：""''《》、（）—…·～【】]/g, ''), 2)
      .filter(w => !stop.has(w))
    const hit = words.some(w => bodySet.has(w))
    if (!hit) {
      issues.push({
        kind: 'blueprint',
        severity: 'warn',
        message: t('audit.blueprintMissing').replace('{event}', ev.slice(0, 40)),
      })
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    summary: issues.length === 0 ? t('audit.blueprintOk') : t('audit.blueprintFound').replace('{n}', String(issues.length)),
  }
}

// ===== 5. 违禁词审计（对应"平台合规"） =====

/** 内置基础违禁词表（平台通用规则；扩展词表通过 extraWords 参数或后续配置注入） */
export const BUILTIN_FORBIDDEN_WORDS: string[] = [
  '血腥', '色情描写', '涉政', '分裂', '赌博网址',
]

/**
 * 检测违禁词命中（可注入扩展词表）
 */
export function sensitiveAudit(
  text: string,
  extraWords: string[] = [],
  builtin: string[] = BUILTIN_FORBIDDEN_WORDS,
): AuditResult {
  const issues: AuditIssue[] = []
  // 去重：内置词表与扩展词表可能重复，避免重复命中
  const words = [...new Set([...builtin, ...extraWords].filter(w => w && w.trim()))]

  for (const w of words) {
    let idx = text.indexOf(w)
    let count = 0
    while (idx >= 0) { count++; idx = text.indexOf(w, idx + w.length) }
    if (count > 0) {
      issues.push({
        kind: 'sensitive',
        severity: 'error',
        message: t('audit.sensitiveHit').replace('{word}', w).replace('{n}', String(count)),
      })
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    summary: issues.length === 0 ? t('audit.sensitivePassed') : t('audit.sensitiveFound').replace('{n}', String(issues.length)),
  }
}

// ===== 6. 时间线审计（对应"时序错乱"） =====

/**
 * 时间词正则（仅保留可判定的绝对锚点）：
 * - 「当天/同一天」**不参与检测**——指代性锚点（指前文某天），出现顺序
 *   「已过 2 天」之后合法（"当天"指代那 2 天之后的当天），无法判断矛盾
 * - 「X天前」**不参与检测**——闪回/倒叙是正常叙事手法，不构成时序矛盾
 * - 「X天后」为相对增量（当前进度 + X），见 extractTimelineAnchors
 */
const TIME_WORD_REGEX = /(第[一二三四五六七八九十百\d]+天|次日|翌日|第二天|[\d一二三四五六七八九十百]+[天月年]后)/g

export interface TimelineAnchor {
  /** 归一化时间值（相对第 1 天的偏移，约数） */
  dayOffset: number
  raw: string
  /** true = 相对增量（X天后/月后/年后）：从当前时间进度推进，不参与倒序比较 */
  delta?: boolean
}

/** 中文数字 → 数字 */
function cnNumToNum(cn: string): number {
  const map: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 百: 100 }
  if (/^\d+$/.test(cn)) return parseInt(cn, 10)
  if (map[cn]) return map[cn]
  if (cn.startsWith('十')) return 10 + (map[cn[1]] ?? 0)
  if (cn.endsWith('十')) return (map[cn[0]] ?? 0) * 10
  if (cn.includes('十')) {
    const [a, b] = cn.split('十')
    return (map[a] ?? 0) * 10 + (map[b] ?? 0)
  }
  return 0
}

/** 提取章节内时间锚点序列（归一化为天偏移；对话区豁免——台词里的"第三天"不算叙事时间） */
export function extractTimelineAnchors(text: string): TimelineAnchor[] {
  const anchors: TimelineAnchor[] = []
  const matches = stripDialogue(text).matchAll(TIME_WORD_REGEX)
  for (const m of matches) {
    const raw = m[0]
    let dayOffset: number
    let delta = false
    if (raw.startsWith('第')) {
      const num = raw.replace(/^第|天$/g, '')
      dayOffset = cnNumToNum(num)
    } else if (raw === '次日' || raw === '第二天' || raw === '翌日') {
      dayOffset = 2
    } else if (raw.includes('后')) {
      // 相对增量：从当前时间进度推进（正文「3天后」= 上一锚点 + 3 天）
      const num = raw.replace(/[天月年后]/g, '')
      dayOffset = cnNumToNum(num) * (raw.includes('月') ? 30 : raw.includes('年') ? 365 : 1)
      delta = true
    } else {
      continue
    }
    anchors.push({ dayOffset, raw, delta })
  }
  return anchors
}

/**
 * 单章内时间线检测：绝对锚点（第X天/次日）出现倒序判矛盾。
 * 相对增量（X天后）从当前进度推进，不参与倒序比较。
 */
export function timelineAudit(chapterText: string): AuditResult {
  const anchors = extractTimelineAnchors(chapterText)
  const issues: AuditIssue[] = []

  let last = -Infinity
  for (const a of anchors) {
    if (a.delta) {
      // 相对增量：线性推进（首次出现时直接作为绝对进度）
      last = last === -Infinity ? a.dayOffset : last + a.dayOffset
      continue
    }
    if (a.dayOffset < last) {
      issues.push({
        kind: 'timeline',
        severity: 'warn',
        message: t('audit.timelineConflict').replace('{time}', a.raw).replace('{n}', String(last)),
      })
    }
    last = Math.max(last, a.dayOffset)
  }

  return {
    passed: issues.length === 0,
    issues,
    summary: issues.length === 0
      ? t('audit.timelineOk').replace('{n}', String(anchors.length))
      : t('audit.timelineFound').replace('{n}', String(issues.length)),
  }
}

// ===== 聚合 =====

export interface FullAuditInput {
  chapterText: string
  prevChapterEnding?: string
  keyEvents?: string[]
  /** 豁免词（角色名 + 世界观专名）：重复/衔接审计跳过 */
  terms?: string[]
  extraForbiddenWords?: string[]
  /** 本书历史章节基线词频（buildBaselineFreqs 输出）——重复审计超基线才报警 */
  baselineFreqs?: Record<string, number>
  /** 水文检测白名单（用户配置：作者文风词/句首模式/故意复用的句子） */
  whitelist?: AuditWhitelist
}

/**
 * 全量审计（后处理管道挂载入口）
 * terms（角色名等专名）同时作为重复词/衔接审计的豁免词——专名高频出现
 * 是正常叙事，不该被当成"重复水文"或"衔接信号"；
 * baselineFreqs（本书历史章节基线）——稳定高频词（专名/场景词/常用词）
 * 只有超出基线密度才算异常；
 * whitelist（用户白名单）——作者标志性文风豁免。
 */
export function runAllAudits(input: FullAuditInput): AuditResult {
  const terms = input.terms ?? []
  const all: AuditResult[] = [
    waterAudit(input.chapterText, { excludeWords: terms, baselineFreqs: input.baselineFreqs, whitelist: input.whitelist }),
    continuityAudit(input.chapterText, input.prevChapterEnding, { excludeWords: terms }),
    terminologyAudit(input.chapterText, terms),
    blueprintAudit(input.chapterText, input.keyEvents ?? []),
    sensitiveAudit(input.chapterText, input.extraForbiddenWords),
    timelineAudit(input.chapterText),
  ]
  const issues = all.flatMap(r => r.issues)
  const passed = issues.length === 0
  return {
    passed,
    issues,
    summary: passed
      ? t('audit.allPassed')
      : t('audit.allFound')
          .replace('{n}', String(issues.length))
          .replace('{m}', String(all.filter(r => !r.passed).length)),
  }
}
