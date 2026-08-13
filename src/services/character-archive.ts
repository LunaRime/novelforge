// src/services/character-archive.ts
import { robustParseJSON } from './workflows/workflow-utils'
import { isNoChangeValue, normalizeTagsValue, stripNameAlias, matchCharacterName } from './character-normalize'

export interface ChapterContent { chapterNumber: number; content: string }

/** 角色上下文段（fallback=true 表示非直接出场命中的兜底段，低置信度） */
export interface RoleContextSegment {
  chapterNumber: number
  text: string
  fallback?: boolean
}

/** 上下文抽取选项 */
export interface ContextExtractOptions {
  /** 单段目标窗口字数（默认 800；句边界对齐后向两侧扩展到该大小） */
  windowChars?: number
  /** 最大段数（默认 8；跨章节均匀采样） */
  maxSegments?: number
  /** 额外匹配形态（角色别名/昵称/称号，配合角色卡 aliases 注册表） */
  aliases?: string[]
  /** 全角色注册名（前缀碰撞过滤：短名命中更长注册名开头时跳过） */
  registryNames?: string[]
  /** 无直接命中时返回章节首尾兜底段（默认 false——兜底段低置信度，可能诱导 LLM 编造与原文无关的设定） */
  includeFallback?: boolean
  /** 兜底段数量（默认 2：首章开头 + 末章结尾） */
  fallbackSegments?: number
}

/** 句边界分隔符（中英文句号/感叹/问号/省略号/换行） */
const SENT_BREAK = /[。！？!?…\n]/

/** 向前找最近的句边界索引（不含该字符本身），无则 -1 */
function lastSentenceBreak(text: string, from: number): number {
  for (let i = from; i >= 0; i--) {
    if (SENT_BREAK.test(text[i])) return i
  }
  return -1
}

/** 向后找最近的句边界索引（含该字符），无则 -1 */
function nextSentenceBreak(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (SENT_BREAK.test(text[i])) return i
  }
  return -1
}

/** 收集一个名字在文本中的所有出现位置（升序），前缀碰撞过滤：命中位置被更长注册名覆盖时跳过 */
function collectOccurrences(text: string, form: string, registry: string[]): number[] {
  const hits: number[] = []
  if (!form) return hits
  let idx = text.indexOf(form)
  while (idx !== -1) {
    const covered = registry.some(r => r.length > form.length && text.startsWith(r, idx))
    if (!covered) hits.push(idx)
    idx = text.indexOf(form, idx + form.length)
  }
  return hits
}

/** 句边界对齐窗口：取命中所在的整句；句子短于窗口时向两侧扩展（P1-4：不再硬切句子） */
function sentenceAlignedWindow(text: string, idx: number, formLen: number, windowChars: number): [number, number] {
  const lb = lastSentenceBreak(text, idx - 1)
  const nb = nextSentenceBreak(text, idx + formLen)
  let start = lb === -1 ? 0 : lb + 1
  let end = nb === -1 ? text.length : nb + 1
  if (end - start < windowChars) {
    const need = windowChars - (end - start)
    const padL = Math.min(start, Math.ceil(need / 2))
    const padR = Math.min(text.length - end, need - padL)
    start -= padL
    end += padR
  }
  return [start, end]
}

/** 同章重叠段合并（按 start 排序后延伸 end，P1-4：重复窗口重复计费） */
function mergeOverlaps(segments: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  if (segments.length <= 1) return segments
  const sorted = [...segments].sort((a, b) => a.start - b.start)
  const merged: Array<{ start: number; end: number }> = []
  for (const seg of sorted) {
    const last = merged[merged.length - 1]
    if (last && seg.start <= last.end) {
      last.end = Math.max(last.end, seg.end)
    } else {
      merged.push({ ...seg })
    }
  }
  return merged
}

/**
 * 按角色名（及别名）出现位置抽取上下文段落（P1 升级版，替代原「前 8 个出现点」实现）：
 * - 句边界对齐：命中所在整句优先，句子短于窗口向两侧扩展
 * - 前缀碰撞过滤：「苏晚」命中「苏晚晴」（更长注册名开头）时跳过
 * - 别名形态：aliases 数组一并扫描（昵称/称号/曾用名）
 * - 均匀跨章采样：章节数 ≤ 预算全取；否则等距选章（首章+末章必含），
 *   保证后期章节的角色成长可见（原实现只取前 8 段，后期章节完全不可见）
 * - 重叠段合并：同章相邻段去重
 * - 兜底模式（includeFallback）：无直接命中时返回章节首尾段并标记 fallback
 */
export function extractRoleContextSegments(
  chapters: ChapterContent[],
  name: string,
  options: ContextExtractOptions = {},
): RoleContextSegment[] {
  const windowChars = options.windowChars ?? 800
  const maxSegments = options.maxSegments ?? 8
  const aliases = options.aliases ?? []

  // 前缀碰撞注册表：全角色注册名 + 其剥离形态 + 目标名形态
  const registry = new Set<string>()
  for (const n of options.registryNames ?? []) {
    if (n) {
      registry.add(n)
      const s = stripNameAlias(n)
      if (s) registry.add(s)
    }
  }
  const forms = [...new Set([name, stripNameAlias(name), ...aliases])].filter(Boolean)
  for (const f of forms) registry.add(f)
  const registryList = [...registry]

  // 收集（按章节，段内重叠合并）
  const perChapter = new Map<number, { content: string; ranges: Array<{ start: number; end: number }> }>()
  for (const ch of chapters) {
    const raw: Array<{ start: number; end: number }> = []
    for (const form of forms) {
      for (const idx of collectOccurrences(ch.content, form, registryList)) {
        const [start, end] = sentenceAlignedWindow(ch.content, idx, form.length, windowChars)
        raw.push({ start, end })
      }
    }
    if (raw.length > 0) perChapter.set(ch.chapterNumber, { content: ch.content, ranges: mergeOverlaps(raw) })
  }

  const segments: RoleContextSegment[] = []
  const chapterNumbers = [...perChapter.keys()].sort((a, b) => a - b)
  if (chapterNumbers.length > 0) {
    // 选章：章节数 ≤ 预算全取；否则等距选章（含首章与末章）
    const chosen = new Set<number>()
    if (chapterNumbers.length <= maxSegments) {
      chapterNumbers.forEach(c => chosen.add(c))
    } else {
      for (let i = 0; i < maxSegments; i++) {
        const idx = Math.round((i * (chapterNumbers.length - 1)) / Math.max(1, maxSegments - 1))
        chosen.add(chapterNumbers[idx])
      }
    }
    // 每章取第一段
    for (const cn of chapterNumbers) {
      if (!chosen.has(cn)) continue
      const entry = perChapter.get(cn)!
      if (entry.ranges.length === 0) continue
      const seg = entry.ranges.shift()!
      segments.push({ chapterNumber: cn, text: entry.content.slice(seg.start, seg.end) })
    }
    // 预算未满 → 逐章轮询补充（同章多次出现的场景）
    let remaining = maxSegments - segments.length
    while (remaining > 0) {
      let madeProgress = false
      for (const cn of chapterNumbers) {
        if (remaining === 0) break
        const entry = perChapter.get(cn)!
        if (entry.ranges.length > 0) {
          const seg = entry.ranges.shift()!
          segments.push({ chapterNumber: cn, text: entry.content.slice(seg.start, seg.end) })
          remaining--
          madeProgress = true
        }
      }
      if (!madeProgress) break
    }
  }

  // 兜底：无任何直接命中 → 章节首尾段（低置信度，由调用方决定是否使用）
  if (segments.length === 0 && options.includeFallback && chapters.length > 0) {
    const ordered = [...chapters].sort((a, b) => a.chapterNumber - b.chapterNumber)
    const first = ordered[0]
    segments.push({ chapterNumber: first.chapterNumber, text: first.content.slice(0, windowChars), fallback: true })
    const last = ordered.length > 1 ? ordered[ordered.length - 1] : null
    if (last && (options.fallbackSegments ?? 2) > 1) {
      segments.push({ chapterNumber: last.chapterNumber, text: last.content.slice(-windowChars), fallback: true })
    }
  }

  return segments
}

/** 档案 10 字段键(mergeFields 白名单) */
export const ARCHIVE_FIELDS = ['gender', 'age', 'appearance', 'personality', 'background', 'abilities', 'motivation', 'relationships', 'arc', 'notes'] as const

/** 任一档案字段为空/哨兵 → 需要生成(前置过滤省 token) */
export function hasBlankArchiveFields(char: Record<string, unknown>): boolean {
  return ARCHIVE_FIELDS.some(f => {
    const v = String(char[f] ?? '').trim()
    return v === '' || isNoChangeValue(v)
  })
}

/** LLM JSON 输出 → 档案字段白名单归一化;非法 → null */
export function parseArchiveJson(raw: string, charName: string): Record<string, string> | null {
  void charName // 签名保留 charName(接口契约),当前实现不依赖角色名
  const parsed = robustParseJSON(raw, false)
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const f of ARCHIVE_FIELDS) {
    const v = obj[f]
    if (v === undefined || v === null) continue
    const s = String(v).trim()
    if (s && !isNoChangeValue(s)) out[f] = s
  }
  if (obj.tags !== undefined && obj.tags !== null) {
    // 直接传原始值:normalizeTagsValue 的 Array.isArray 分支对数组元素逐个归一化
    // (不走分隔符 split——含逗号的元素不会被拆碎,与 architecture-workflow
    // createCharacterExtractSteps 的 Array.isArray 分支对齐)
    const tags = normalizeTagsValue(obj.tags)
    if (tags) out.tags = tags
  }
  return Object.keys(out).length > 0 ? out : null
}

/** 批量档案提取的单个角色结果 */
export interface BatchArchiveItem {
  /** 角色规范名（DB 主键） */
  name: string
  /** 解析后的档案字段（null = 该角色解析失败/无输出） */
  archive: Record<string, string> | null
}

/**
 * 批量提取 LLM 输出解析（P1-3）：
 * - 主形态：JSON 对象，键为角色名（含别名/括号形态，经 matchCharacterName 反查）；
 * - 兜底形态：JSON 数组（每元素含 name 字段），逐卡匹配到目标角色；
 * - 其他输出 → 全部角色返回 null（由调用方触发批次重试）。
 *
 * ⚠️ robustParseJSON 的 preferArray 陷阱：对象形态含嵌套数组（tags）时
 * preferArray=true 会截到内层数组，因此数组分支必须校验"元素都是含 name 的卡片"，
 * 否则回落到对象形态解析。
 */
export function parseBatchArchiveJson(
  raw: string,
  chars: Array<{ name: string; aliases?: unknown }>,
): BatchArchiveItem[] {
  // 1) 数组形态优先（元素必须都是含 name 的卡片对象）
  const arrParsed = robustParseJSON(raw, true)
  if (Array.isArray(arrParsed)) {
    const cards = arrParsed.filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    if (cards.length > 0 && cards.every(c => c.name !== undefined)) {
      return chars.map(char => {
        const card = cards.find(c => matchCharacterName(chars, String(c.name ?? ''))?.name === char.name)
        if (!card) return { name: char.name, archive: null }
        return { name: char.name, archive: parseArchiveJson(JSON.stringify(card), char.name) }
      })
    }
  }

  // 2) 对象形态（键=角色名，值=档案对象）
  const parsed = robustParseJSON(raw, false)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>
    const keys = Object.keys(obj)
    return chars.map(char => {
      // 键反查：精确 → 别名/括号形态（matchCharacterName 语义）
      const key = keys.find(k => matchCharacterName(chars, k)?.name === char.name)
      if (key === undefined) return { name: char.name, archive: null }
      const value = obj[key]
      if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
        return { name: char.name, archive: null }
      }
      return { name: char.name, archive: parseArchiveJson(JSON.stringify(value), char.name) }
    })
  }

  // 3) 非法输出 → 全部 null（触发批次重试）
  return chars.map(char => ({ name: char.name, archive: null }))
}
