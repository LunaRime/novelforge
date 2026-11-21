import { markdownLanguage } from '@codemirror/lang-markdown'

export const UNDERLINE_OPEN = '<u>'
export const UNDERLINE_CLOSE = '</u>'

interface UnderlineSpan {
  from: number
  to: number
}

interface UnderlineChange extends UnderlineSpan {
  insert: string
}

type MarkdownTree = ReturnType<typeof markdownLanguage.parser.parse>

/** 只识别同一行内容器里的成对标记，保留代码、转义和其他 HTML 的原文。 */
export function markdownUnderlineSpans(source: string, tree?: MarkdownTree): UnderlineSpan[] {
  if (!source.includes(UNDERLINE_OPEN) || !source.includes(UNDERLINE_CLOSE)) return []
  const spans: UnderlineSpan[] = []
  const opens = new Map<string, number[]>()
  const parsed = tree ?? markdownLanguage.parser.parse(source)
  parsed.iterate({
    enter(node) {
      if (node.name !== 'HTMLTag') return
      const marker = source.slice(node.from, node.to)
      if (marker !== UNDERLINE_OPEN && marker !== UNDERLINE_CLOSE) return
      const parent = node.node.parent
      if (!parent) return
      const key = `${parent.type.id}:${parent.from}:${parent.to}`
      const pending = opens.get(key) ?? []
      if (marker === UNDERLINE_OPEN) {
        pending.push(node.from)
        opens.set(key, pending)
      } else {
        const from = pending.pop()
        if (from !== undefined) spans.push({ from, to: node.to })
        if (pending.length === 0) opens.delete(key)
      }
    },
  })
  return spans.sort((a, b) => a.from - b.from)
}

/** 纯文本导出及定稿保存校验共用，移除标记时保留被划线文字。 */
export function stripMarkdownUnderline(source: string): string {
  if (!source.includes(UNDERLINE_OPEN)) return source
  const markers = markdownUnderlineSpans(source).flatMap(({ from, to }) => [
    { from, to: from + UNDERLINE_OPEN.length },
    { from: to - UNDERLINE_CLOSE.length, to },
  ]).sort((a, b) => a.from - b.from)
  if (markers.length === 0) return source
  let result = ''
  let offset = 0
  for (const marker of markers) {
    result += source.slice(offset, marker.from)
    offset = marker.to
  }
  return result + source.slice(offset)
}

/** 在选区覆盖的正文块内成对插入标记，保留段落边界及标题、列表等块语法。 */
export function toggleMarkdownUnderline(source: string, from: number, to: number): UnderlineChange[] {
  if (from >= to) return []
  const tree = markdownLanguage.parser.parse(source)
  const spans = markdownUnderlineSpans(source, tree)
  const ranges: UnderlineSpan[] = []
  tree.iterate({
    from, to,
    enter(node) {
      const isHeading = /^(ATX|Setext)Heading/.test(node.name)
      if (!isHeading && !['Paragraph', 'TableCell', 'Task'].includes(node.name)) return
      let start = Math.max(from, node.from)
      let end = Math.min(to, node.to)
      for (let marker = node.node.firstChild; marker; marker = marker.nextSibling) {
        if (marker.name === 'TaskMarker' || (marker.name === 'HeaderMark' && marker.from === node.from) ||
            (marker.name === 'QuoteMark' && marker.from <= start && start < marker.to)) {
          start = Math.max(start, marker.to)
        } else if (marker.name === 'HeaderMark') {
          end = Math.min(end, marker.from)
        }
      }
      if (start >= end) return false
      const selected = source.slice(start, end)
      if (!selected.trim()) return false
      start += selected.length - selected.trimStart().length
      end -= selected.length - selected.trimEnd().length

      ranges.push({ from: start, to: end })
      return false
    },
  })

  const marked = ranges.map(range => spans.find(span =>
    (range.from === span.from && range.to === span.to) ||
    (range.from === span.from + UNDERLINE_OPEN.length && range.to === span.to - UNDERLINE_CLOSE.length)))
  const changes: UnderlineChange[] = []
  if (marked.every(span => span !== undefined)) {
    for (const span of marked) {
      changes.push({ from: span.from, to: span.from + UNDERLINE_OPEN.length, insert: '' },
        { from: span.to - UNDERLINE_CLOSE.length, to: span.to, insert: '' })
    }
  } else {
    for (const range of ranges) {
      if (spans.some(span => span.from <= range.from && span.to >= range.to)) continue
      changes.push({ from: range.from, to: range.from, insert: UNDERLINE_OPEN },
        { from: range.to, to: range.to, insert: UNDERLINE_CLOSE })
    }
  }
  if (changes.length === 0) return changes
  let candidate = ''
  let offset = 0
  for (const { from, to, insert } of changes) {
    candidate += source.slice(offset, from) + insert
    offset = to
  }
  candidate += source.slice(offset)
  // 选区跨越一半行内语法时可能生成无法配对的标记，保留原文供作者重新选择。
  return stripMarkdownUnderline(candidate) === stripMarkdownUnderline(source) ? changes : []
}
