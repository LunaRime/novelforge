/**
 * audits — 生成后审计纯函数库（零 LLM 依赖）
 *
 * 六类审计：重复词 / 章节衔接 / 术语统一 / 蓝图完成度 / 违禁词 / 时间线。
 * 全部为纯函数，输入文本与上下文，输出结构化问题清单。
 * 供后处理步骤（finalize 审计）与 Agent 工具复用。
 */

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

/** 提取 2-3 字中文词（滑窗，跳过标点与空白） */
function extractCnNgrams(text: string, n: 2 | 3): string[] {
  const chars = text.replace(/\s/g, '').split('')
  const out: string[] = []
  for (let i = 0; i <= chars.length - n; i++) {
    // 跳过含标点的窗口
    if (/[，。！？；：""''《》、（）—…·～【】]/.test(chars.slice(i, i + n).join(''))) continue
    out.push(chars.slice(i, i + n).join(''))
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

// ===== 1. 重复词审计（对应"重复水文"） =====

export interface RepetitionAuditOptions {
  /** 同词报警阈值（默认 3） */
  maxRepeat?: number
  /** 报告上限（默认 8） */
  topN?: number
}

/**
 * 检测正文高频重复词（对话区豁免——角色口头禅不算水文）
 */
export function repetitionAudit(text: string, options: RepetitionAuditOptions = {}): AuditResult {
  const { maxRepeat = 3, topN = 8 } = options
  const body = stripDialogue(text)

  const freq = new Map<string, number>()
  for (const word of extractCnNgrams(body, 2)) {
    freq.set(word, (freq.get(word) ?? 0) + 1)
  }
  // 排除常见虚词组合
  const stop = new Set(['一个', '什么', '自己', '没有', '就是', '这个', '那个', '时候', '已经', '知道', '可以', '现在', '起来', '这么', '那么', '他们', '我们', '你们', '怎么', '还是', '因为', '所以', '但是', '如果', '虽然', '然后', '最后'])
  const hits = [...freq.entries()]
    .filter(([w, c]) => c >= maxRepeat && !stop.has(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)

  const issues: AuditIssue[] = hits.map(([w, c]) => ({
    kind: 'repetition',
    severity: c >= maxRepeat + 3 ? 'error' : 'warn',
    message: `「${w}」出现 ${c} 次，建议同义替换`,
  }))

  return {
    passed: issues.length === 0,
    issues,
    summary: issues.length === 0
      ? '重复词检查通过'
      : `发现 ${issues.length} 个高频重复词（阈值 ${maxRepeat} 次）`,
  }
}

// ===== 2. 章节衔接审计（对应"开头跳戏"） =====

export interface ContinuityAuditOptions {
  /** 本章开头取样长度（字符） */
  chapterHeadLen?: number
  /** 上章结尾取样长度（字符） */
  prevTailLen?: number
  /** 最少重叠词数（低于则提示） */
  minOverlap?: number
}

/**
 * 检测本章开头与上章结尾的衔接度（2 字词重叠计数）
 */
export function continuityAudit(
  chapterText: string,
  prevChapterEnding?: string,
  options: ContinuityAuditOptions = {},
): AuditResult {
  const { chapterHeadLen = 100, prevTailLen = 200, minOverlap = 2 } = options
  if (!prevChapterEnding || !prevChapterEnding.trim()) {
    return { passed: true, issues: [], summary: '无上章结尾可对照（首章或数据缺失）' }
  }

  const head = cnBigramSet(chapterText.slice(0, chapterHeadLen))
  const tail = cnBigramSet(prevChapterEnding.slice(-prevTailLen))
  let overlap = 0
  for (const w of tail) if (head.has(w)) overlap++

  const issues: AuditIssue[] = []
  if (overlap < minOverlap) {
    issues.push({
      kind: 'continuity',
      severity: 'warn',
      message: `本章开头与上章结尾衔接词仅 ${overlap} 个（阈值 ${minOverlap}），可能场景跳转生硬`,
    })
  }

  return {
    passed: issues.length === 0,
    issues,
    summary: issues.length === 0 ? `章节衔接正常（重叠词 ${overlap} 个）` : `衔接偏弱（重叠词 ${overlap} 个）`,
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
          message: `「${term}」疑似被少字改写（前缀「${prefix3}」出现 ${prefixCount} 次，完整 ${fullCount} 次）`,
        })
      }
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    summary: issues.length === 0 ? '术语一致性检查通过' : `发现 ${issues.length} 个术语疑似变体`,
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
        message: `蓝图关键事件「${ev.slice(0, 40)}」在正文中未体现`,
      })
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    summary: issues.length === 0 ? '蓝图关键事件全部体现' : `${issues.length} 个关键事件未体现`,
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
        message: `命中违禁词「${w}」${count} 次`,
      })
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    summary: issues.length === 0 ? '违禁词检查通过' : `命中 ${issues.length} 个违禁词`,
  }
}

// ===== 6. 时间线审计（对应"时序错乱"） =====

/** 时间词正则：第X天 / 次日 / 翌日 / X天后 / X个月后 / X年后 / 当天 */
const TIME_WORD_REGEX = /(第[一二三四五六七八九十百\d]+天|次日|翌日|第二天|当天|同一天|[\d一二三四五六七八九十百]+[天月年]后|[\d一二三四五六七八九十百]+个?[天月年]前)/g

export interface TimelineAnchor {
  /** 归一化时间值（相对第 1 天的偏移，约数） */
  dayOffset: number
  raw: string
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

/** 提取章节内时间锚点序列（归一化为天偏移） */
export function extractTimelineAnchors(text: string): TimelineAnchor[] {
  const anchors: TimelineAnchor[] = []
  const matches = text.matchAll(TIME_WORD_REGEX)
  for (const m of matches) {
    const raw = m[0]
    let dayOffset: number
    if (raw.startsWith('第')) {
      const num = raw.replace(/^第|天$/g, '')
      dayOffset = cnNumToNum(num)
    } else if (raw === '次日' || raw === '第二天') {
      dayOffset = 2
    } else if (raw === '翌日') {
      dayOffset = 2
    } else if (raw === '当天' || raw === '同一天') {
      dayOffset = 1
    } else if (raw.includes('后')) {
      const num = raw.replace(/[天月年后]/g, '')
      dayOffset = cnNumToNum(num) * (raw.includes('月') ? 30 : raw.includes('年') ? 365 : 1)
    } else if (raw.includes('前')) {
      const num = raw.replace(/[天月年前]/g, '')
      dayOffset = -cnNumToNum(num) * (raw.includes('月') ? 30 : raw.includes('年') ? 365 : 1)
    } else {
      continue
    }
    anchors.push({ dayOffset, raw })
  }
  return anchors
}

/**
 * 单章内时间线检测：时间锚点出现倒序（后出现的时间早于前出现）判矛盾
 */
export function timelineAudit(chapterText: string): AuditResult {
  const anchors = extractTimelineAnchors(chapterText)
  const issues: AuditIssue[] = []

  let last = -Infinity
  for (const a of anchors) {
    if (a.dayOffset < last) {
      issues.push({
        kind: 'timeline',
        severity: 'warn',
        message: `时间线矛盾：「${a.raw}」出现在更早的「已过 ${last} 天」之后`,
      })
    }
    last = Math.max(last, a.dayOffset)
  }

  return {
    passed: issues.length === 0,
    issues,
    summary: issues.length === 0
      ? `时间线检查通过（${anchors.length} 个时间锚点）`
      : `发现 ${issues.length} 处时间线矛盾`,
  }
}

// ===== 聚合 =====

export interface FullAuditInput {
  chapterText: string
  prevChapterEnding?: string
  keyEvents?: string[]
  terms?: string[]
  extraForbiddenWords?: string[]
}

/**
 * 全量审计（后处理管道挂载入口）
 */
export function runAllAudits(input: FullAuditInput): AuditResult {
  const all: AuditResult[] = [
    repetitionAudit(input.chapterText),
    continuityAudit(input.chapterText, input.prevChapterEnding),
    terminologyAudit(input.chapterText, input.terms ?? []),
    blueprintAudit(input.chapterText, input.keyEvents ?? []),
    sensitiveAudit(input.chapterText, input.extraForbiddenWords),
    timelineAudit(input.chapterText),
  ]
  const issues = all.flatMap(r => r.issues)
  const passed = issues.length === 0
  return {
    passed,
    issues,
    summary: passed ? '全部审计通过' : `${issues.length} 个问题（${all.filter(r => !r.passed).length} 类）`,
  }
}
