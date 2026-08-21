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
