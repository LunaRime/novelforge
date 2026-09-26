import { DEFAULT_MEMORY_LOAD_MODE, normalizeLoadMode, type MemoryLoadMode } from '../../src/shared/memory-types'

// 主进程与渲染层都从这里取分层类型（渲染侧的 src/services/memory/memory-codec.ts 整体 re-export 本文件）
export { MEMORY_LOAD_MODES, DEFAULT_MEMORY_LOAD_MODE, normalizeLoadMode } from '../../src/shared/memory-types'
export type { MemoryLoadMode } from '../../src/shared/memory-types'

export interface ChapterSummaryEntry {
  chapterNumber: number
  title: string
  keyEvents: string
  characters: string
  foreshadowing: string
  newElements: string
  currentState: string
}

export interface MemoryFileMeta {
  file: string
  /** F9：白名单分类——unknown = 非 book-state/chapters-/volume-/shared 的任意 .md，不参与 M2 注入 */
  kind: 'chapters' | 'volume' | 'book' | 'shared' | 'unknown'
  /** C 档第一轮：分层（frontmatter load_mode；缺省/非法 → auto） */
  loadMode: MemoryLoadMode
  /** C 档第一轮：目录行摘要（正文首个非标题行，≤120 字符） */
  brief: string
  range?: string
  stale: boolean
  mtime: number
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export function parseMemoryFile(raw: string): { frontmatter: Record<string, string>; body: string } | null {
  if (!raw.trim()) return null
  const m = raw.match(FM_RE)
  if (!m) return { frontmatter: {}, body: raw }
  const frontmatter: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':')
    if (idx > 0) frontmatter[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return { frontmatter, body: raw.slice(m[0].length) }
}

export function isStale(raw: string): boolean {
  const parsed = parseMemoryFile(raw)
  return parsed?.frontmatter.status === 'stale'
}

export function markStaleFrontmatter(raw: string): string {
  const parsed = parseMemoryFile(raw)
  if (!parsed) return '---\nstatus: stale\n---\n'
  if (parsed.frontmatter.status === 'stale') return raw // 幂等
  const fm = ['---', ...Object.entries(parsed.frontmatter).map(([k, v]) => `${k}: ${v}`), 'status: stale', '---', ''].join('\n')
  return fm + parsed.body
}

/** 单章条目块（无 frontmatter/文件标题——upsert 替换与卷聚合共用，审阅修正） */
export function buildChapterEntryBlock(e: ChapterSummaryEntry): string {
  return [
    `## 第 ${e.chapterNumber} 章 · ${e.title || '（无题）'}`,
    `- 关键事件：${e.keyEvents || '无'}`,
    `- 出场角色：${e.characters || '无'}`,
    `- 伏笔：${e.foreshadowing || '无'}`,
    `- 新设定：${e.newElements || '无'}`,
    `- 当前状态：${e.currentState || '无'}`,
  ].join('\n')
}

export function buildChapterSummaryFile(range: string, entries: ChapterSummaryEntry[]): string {
  const lines = [
    '---', `range: ${range}`, '---', '',
    `# 章节记忆 ${range}`,
  ]
  for (const e of entries) {
    lines.push('', buildChapterEntryBlock(e))
  }
  return lines.join('\n')
}

/**
 * 手动编辑保存前结构校验（Task 5 审阅修正）：内容必须能解析出章节块（「## 第 N 章」至少
 * 1 块——与 ensureVolumeSummary/rebuildBookState 的块解析同口径）或 frontmatter 完整
 * （--- 闭合块 + 正文空 / 以块前缀开头——首块无前导 \n 时下游 split 解析不出，不得放行）。
 * 否则坏格式文件会让下游块解析静默失败产生空洞记忆。
 */
export function isValidMemoryContent(raw: string): boolean {
  if (!raw.trim()) return false
  const parsed = parseMemoryFile(raw)
  const body = parsed?.body ?? raw
  for (const b of body.split('\n## 第 ').slice(1)) {
    if (/^(\d+) 章 · /.test(b)) return true
  }
  // P3 shared 分支：type: shared 显式声明 → 放行（shared 无章节块，章节校验不适用；
  // 下游 parseSharedFile 宽容提取「- 」行，坏格式仅丢事实行、不导致块解析崩溃）
  if (parsed?.frontmatter.type === 'shared') return true
  // FM 分支约束（T5-2 审阅修正）：正文为空或仅以块前缀开头，否则 body 非空且无块时
  // 下游 split 连首块都解析不出 → 静默丢首章，与无 frontmatter 的「首行即块」判无效同口径
  return FM_RE.test(raw) && (body.trim() === '' || body.startsWith('\n## 第 '))
}

/**
 * 清除 frontmatter status（手动编辑保存同 upsert 语义：编辑后的文件不再被视为 stale）。
 * 无 status（或无 frontmatter）时幂等原样返回；status 为唯一字段时移除整个 frontmatter 块。
 */
export function stripStatusFrontmatter(raw: string): string {
  const parsed = parseMemoryFile(raw)
  if (!parsed) return raw
  const entries = Object.entries(parsed.frontmatter).filter(([k]) => k !== 'status')
  if (entries.length === Object.keys(parsed.frontmatter).length) return raw
  const fm = entries.length > 0
    ? `---\n${entries.map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n`
    : ''
  return `${fm}${parsed.body}`
}

/** 记忆目录 brief 的字符上限（Denova 目录只放一行摘要的 NF 版） */
export const MEMORY_BRIEF_MAX_CHARS = 120

/** 围栏行（空 frontmatter 的 `---` 残留不是内容，更不该当 brief——评审 Minor 9） */
const isFenceLine = (s: string): boolean => /^-{3,}$/.test(s)

/**
 * 目录/常驻展示用的 brief：正文首个非空非标题行，剥列表符（`- `）后截断。
 * - 标题行（`# 全书精要`）没有信息量，故只在整段没有正文行时回落标题文本——
 *   shared.md 因此得到「用户偏好爽文节奏」这样的首条事实，而不是文件名；
 * - **章节文件取最后一个章节块**（最近章节）——长书里每个区间文件的头部是区间最早章，
 *   而 brief 是 auto 分层下模型唯一拿到的东西，取旧状态会被当现状（同 F5 的取向，评审 Minor 8）；
 * - 空 frontmatter（`---\n---`，FM_RE 不认）留下的围栏行直接跳过（评审 Minor 9）。
 */
export function extractMemoryBrief(raw: string): string {
  const parsed = parseMemoryFile(raw)
  const body = parsed?.body ?? raw
  const marks = body.split('\n## 第 ')
  const scope = marks.length > 1 ? `## 第 ${marks[marks.length - 1]}` : body
  const pick = (text: string): string => {
    let heading = ''
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || isFenceLine(trimmed)) continue
      if (trimmed.startsWith('#')) {
        if (!heading) heading = trimmed.replace(/^#+\s*/, '')
        continue
      }
      return trimmed.replace(/^[-*]\s+/, '')
    }
    return heading
  }
  // 最后一块只有标题（无正文行）时回落整篇
  const brief = pick(scope) || pick(body)
  return brief.length > MEMORY_BRIEF_MAX_CHARS ? `${brief.slice(0, MEMORY_BRIEF_MAX_CHARS)}…` : brief
}

/**
 * 写入 load_mode（读-改-写：保留其他 frontmatter 键与正文逐字不动）。
 * `auto` 表示**删除该键**——缺省即 auto，不留冗余行（同 stripStatusFrontmatter 的处置）。
 * 空内容/无 frontmatter 均安全；已是目标值时原样返回（幂等，避免无谓写盘）。
 */
export function setLoadModeFrontmatter(raw: string, mode: MemoryLoadMode): string {
  const parsed = parseMemoryFile(raw)
  if (!parsed) return raw
  const declared = parsed.frontmatter.load_mode
  if (mode === DEFAULT_MEMORY_LOAD_MODE ? declared === undefined : normalizeLoadMode(declared) === mode) {
    return raw
  }
  const entries = Object.entries(parsed.frontmatter).filter(([k]) => k !== 'load_mode')
  if (mode !== DEFAULT_MEMORY_LOAD_MODE) entries.push(['load_mode', mode])
  const fm = entries.length > 0
    ? `---\n${entries.map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n`
    : ''
  return `${fm}${parsed.body}`
}
