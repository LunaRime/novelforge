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
  /** F9：白名单分类——unknown = 非 book-state/chapters-/volume- 前缀的任意 .md，不参与 M2 注入 */
  kind: 'chapters' | 'volume' | 'book' | 'unknown'
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
  const body = parseMemoryFile(raw)?.body ?? raw
  for (const b of body.split('\n## 第 ').slice(1)) {
    if (/^(\d+) 章 · /.test(b)) return true
  }
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
