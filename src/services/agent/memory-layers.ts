/**
 * 记忆分层（C 档第一轮）—— 常驻 / 自动 / 手动的装配与匹配**纯函数**。
 *
 * 分工：本模块只做「条目 → 文本/判定」的纯计算（无 IPC，便于单测）；读盘与编排在
 * context-builder（注入）与 read-memory.tool（模型自取）。
 * 参照 Denova internal/book/lore/：resident 全文段 + 非 resident 名字目录 + 分级降级。
 */
import { t } from '../../shared/locale'
import { estimateTokens } from './token-budget'
import type { MemoryLoadMode } from '../../shared/memory-types'

/** 记忆条目（memory:list 的行 + 分层字段；stale 条目由调用方先行过滤） */
export interface MemoryLayerEntry {
  file: string
  kind: 'chapters' | 'volume' | 'book' | 'shared' | 'unknown'
  loadMode: MemoryLoadMode
  brief: string
  range?: string
}

/** 常驻段硬上限：超过 → **整段不入上下文**（不静默截断），明细面板与日志双留痕 */
export const RESIDENT_MEMORY_BUDGET_TOKENS = 4000
/** 常驻段警告阈值：超过 → 明细面板标注「接近上限」（仅提示，不拦） */
export const RESIDENT_MEMORY_WARN_TOKENS = 2000
/** 记忆目录段预算（很小，且是模型发现记忆的唯一途径——与技能目录段同口径） */
export const MEMORY_CATALOG_BUDGET_TOKENS = 800
/** 降级档 2 的 brief 截断长度 */
const CATALOG_BRIEF_MAX_CHARS = 72
/** 「…还有 N 条未列出」尾部提示的预算预留（降级档 2/3 才可能出现；不留预留会让整段超预算） */
const CATALOG_SUFFIX_RESERVE_TOKENS = 30

/** 常驻条目：按**文件名**排序——常驻段位于前缀最前部，mtime 排序会让缓存前缀每轮漂移 */
export function residentEntries(entries: MemoryLayerEntry[]): MemoryLayerEntry[] {
  return entries.filter(e => e.loadMode === 'resident').sort((a, b) => a.file.localeCompare(b.file))
}

/** 目录条目：非 resident；未知前缀文件不进目录（F9 隐式白名单——显式 resident 另行处理） */
export function catalogEntries(entries: MemoryLayerEntry[]): MemoryLayerEntry[] {
  return entries.filter(e => e.loadMode !== 'resident' && e.kind !== 'unknown')
}

/**
 * 常驻段：全文拼接（**不做节选/截断**）+ 来源标注。
 * 超硬上限 → 整段丢弃（text 空、overCap 真），tokens 仍报真实用量供告警文案使用。
 */
export function buildResidentSection(contents: Array<{ file: string; body: string }>): { text: string; tokens: number; overCap: boolean } {
  if (contents.length === 0) return { text: '', tokens: 0, overCap: false }
  const blocks = contents.map(c => `## ${c.file}\n\n${c.body.trim()}`)
  const text = `${t('memory.residentHeader')}\n\n${blocks.join('\n\n')}`
  const tokens = estimateTokens(text)
  return tokens > RESIDENT_MEMORY_BUDGET_TOKENS
    ? { text: '', tokens, overCap: true }
    : { text, tokens, overCap: false }
}

function kindLabel(kind: MemoryLayerEntry['kind']): string {
  switch (kind) {
    case 'chapters': return t('memory.kindChapters')
    case 'volume': return t('memory.kindVolume')
    case 'book': return t('memory.kindBook')
    case 'shared': return t('memory.kindShared')
    default: return t('memory.kindUnknown')
  }
}

function catalogLine(e: MemoryLayerEntry, level: 1 | 2 | 3): string {
  const label = `[${kindLabel(e.kind)}]${e.loadMode === 'manual' ? '[manual]' : ''} ${e.file.replace(/\.md$/, '')}`
  if (level === 3) return `- ${label}`
  const brief = level === 2 && e.brief.length > CATALOG_BRIEF_MAX_CHARS
    ? `${e.brief.slice(0, CATALOG_BRIEF_MAX_CHARS)}…`
    : e.brief
  return brief ? `- ${label}：${brief}` : `- ${label}`
}

function renderCatalog(list: MemoryLayerEntry[], level: 1 | 2 | 3): { text: string; omitted: number } {
  const hint = level === 1 ? '' : level === 2 ? t('memory.catalogHintTruncated') : t('memory.catalogHintNamesOnly')
  const head = hint ? `${t('memory.catalogHeader')}\n${hint}` : t('memory.catalogHeader')
  // 档 2/3 可能带尾部「还有 N 条」提示，其预算先预留（档 1 无提示、不预留）
  let used = estimateTokens(head) + (level === 1 ? 0 : CATALOG_SUFFIX_RESERVE_TOKENS)
  const lines: string[] = []
  let omitted = 0
  for (const e of list) {
    const line = catalogLine(e, level)
    const cost = estimateTokens(line) + 1 // +1 ≈ 换行
    if (used + cost > MEMORY_CATALOG_BUDGET_TOKENS) { omitted++; continue } // 跳过而非中断（技能目录的 I2 教训）
    lines.push(line)
    used += cost
  }
  const suffix = omitted > 0 ? `\n${t('memory.catalogOmitted').replace('{n}', String(omitted))}` : ''
  return { text: `${head}\n${lines.join('\n')}${suffix}`, omitted }
}

/**
 * 名字目录：三级降级 —— ① brief 全 → ② brief 截 72 + 提示 → ③ 仅名字 + 提示。
 * 取第一个「无条目被挤出」的档位；三档都挤不完则用第三档并附「还有 N 条」。
 */
export function buildMemoryCatalog(entries: MemoryLayerEntry[]): { text: string; level: 1 | 2 | 3 } {
  const list = catalogEntries(entries)
  if (list.length === 0) return { text: '', level: 1 }
  for (const level of [1, 2, 3] as const) {
    const r = renderCatalog(list, level)
    if (r.omitted === 0) return { text: r.text, level }
  }
  return { text: renderCatalog(list, 3).text, level: 3 }
}

/** @ 提及 token（与 intent-router.parseMentions 阶段 2 同字符类，故用户输入习惯一致） */
const MENTION_TOKEN_RE = /@([^\s，。！？；：、（）《》【】·—…""'']+)/g

/**
 * manual 硬门控的判定：本轮消息是否**显式引用**了某条手动记忆（@文件名 / @去后缀名）。
 * 零 LLM 成本、零 IPC；只认完整 token 相等（`@book` 不会命中 `book-state`）。
 * 注：记忆文件在 `.novelforge/` 下，不在项目文件树的 @ 菜单里——这里是**独立判定**，
 * 不依赖 parseMentions（后者搜的是项目文件树）。
 */
export function matchMentionedManuals(userText: string, entries: MemoryLayerEntry[]): string[] {
  if (!userText) return []
  const manuals = entries.filter(e => e.loadMode === 'manual')
  if (manuals.length === 0) return []
  const tokens = new Set<string>()
  MENTION_TOKEN_RE.lastIndex = 0 // 共享 /g 实例有 lastIndex 状态，跨调用必须重置
  let m: RegExpExecArray | null
  while ((m = MENTION_TOKEN_RE.exec(userText)) !== null) tokens.add(m[1].toLowerCase())
  if (tokens.size === 0) return []
  return manuals
    .filter(e => tokens.has(e.file.toLowerCase()) || tokens.has(e.file.replace(/\.md$/, '').toLowerCase()))
    .map(e => e.file)
    .sort((a, b) => a.localeCompare(b))
}

/** 关键词打分（Denova 思路的 NF 版）：文件名 > 类型 > brief > 正文命中次数 */
export function scoreMemoryEntry(e: MemoryLayerEntry, body: string, keyword: string): number {
  const k = keyword.trim().toLowerCase()
  if (!k) return 0
  let score = 0
  if (e.file.toLowerCase().includes(k)) score += 4
  if (e.kind.toLowerCase().includes(k)) score += 3
  if (e.brief.toLowerCase().includes(k)) score += 2
  const hay = body.toLowerCase()
  let hits = 0
  let idx = hay.indexOf(k)
  while (idx >= 0 && hits < 10) {
    hits++
    idx = hay.indexOf(k, idx + k.length)
  }
  if (hits > 0) score += 1 + Math.min(hits, 3) * 0.1
  return score
}

/** 正文中首批命中行的提示（read_memory 关键词结果给出「在哪」） */
export function findLineHint(body: string, keyword: string, maxChars = 80): string {
  const k = keyword.trim().toLowerCase()
  if (!k) return ''
  for (const line of body.split('\n')) {
    const text = line.trim()
    if (text && text.toLowerCase().includes(k)) {
      return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
    }
  }
  return ''
}
