/**
 * 轻量行级 diff（确认卡预览用）。
 *
 * 不替代编辑器里的三栏合并：这里只要「批准写入前看见会改哪几行」，
 * 因此用 LCS 生成 same/add/del 序列，并对超大文本设上限，避免确认卡卡死。
 */

export type DiffLineType = 'same' | 'add' | 'del'

export interface DiffLine {
  type: DiffLineType
  text: string
}

const MAX_LINES = 1200

export function simpleLineDiff(before: string, after: string): DiffLine[] {
  const a = before.split(/\r?\n/)
  const b = after.split(/\r?\n/)

  // 超大文件只展示尾部摘要，避免 O(n*m) 拖死渲染进程
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    const head = (lines: string[], type: DiffLineType): DiffLine[] =>
      lines.slice(0, 20).map((text) => ({ type, text }))
    return [
      ...head(a, 'del'),
      { type: 'same', text: `… (${a.length} → ${b.length} lines; diff preview truncated)` },
      ...head(b, 'add'),
    ]
  }

  const n = a.length
  const m = b.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: 'del', text: a[i] })
      i++
    } else {
      out.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] })
  while (j < m) out.push({ type: 'add', text: b[j++] })
  return out
}
