// @vitest-environment jsdom
/**
 * Table — 统计表 / 富文本表格共用（2026-09-25 收敛，批次 4 剩余项 2）
 *
 * 收敛前 `UsageStatsView` 的 StatsTable 与 `MarkdownContent` 的 MarkdownTable
 * 是两份逐字符相同的实现，只有三处差异，本测试把这三处差异钉成显式 prop：
 * ① 行 hover 高亮（Markdown 表格有，统计表没有）
 * ② 单元格不换行（统计表有——日期/数字不该折行；Markdown 表格没有——正文要能折行）
 * ③ 外层间距（`my-2`）——由调用方 className 传，不属组件职责
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { Table } from './Table'

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(node: React.ReactNode): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(node)
  })
  return container.firstElementChild as HTMLElement
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

const HEADERS = ['日期', '字数']
const ROWS = [
  { key: 'a', cells: ['2026-09-01', '1,200'] },
  { key: 'b', cells: ['2026-09-02', '3,400'] },
]

const rowsOf = (el: HTMLElement) => Array.from(el.querySelectorAll('tbody tr'))
const cellsOf = (row: Element) => Array.from(row.querySelectorAll('td'))

describe('Table', () => {
  it('渲染表头与每个单元格', () => {
    const el = render(<Table headers={HEADERS} rows={ROWS} />)
    expect(Array.from(el.querySelectorAll('thead th')).map((th) => th.textContent)).toEqual(HEADERS)
    const rows = rowsOf(el)
    expect(rows).toHaveLength(2)
    expect(cellsOf(rows[0]).map((td) => td.textContent)).toEqual(['2026-09-01', '1,200'])
  })

  it('容器带描边与圆角，且可横向滚动', () => {
    const el = render(<Table headers={HEADERS} rows={ROWS} />)
    expect(el.className).toContain('overflow-x-auto')
    expect(el.className).toContain('rounded-md')
    expect(el.getAttribute('style')).toContain('--color-border')
  })

  it('表头底色与单元格配色走令牌', () => {
    const el = render(<Table headers={HEADERS} rows={ROWS} />)
    const headRow = el.querySelector('thead tr') as HTMLElement
    expect(headRow.getAttribute('style')).toContain('--color-hover')
    const td = cellsOf(rowsOf(el)[0])[0] as HTMLElement
    expect(td.getAttribute('style')).toContain('--color-text-secondary')
  })

  it('末行不画分隔线，其余行有', () => {
    const el = render(<Table headers={HEADERS} rows={ROWS} />)
    const [first, last] = rowsOf(el) as HTMLElement[]
    expect(first.style.borderBottom).toContain('--color-border')
    expect(last.style.borderBottom).toBe('')
  })

  describe('nowrapCells（统计表用：日期与数字不折行）', () => {
    it('默认关闭 —— Markdown 表格的正文要能折行', () => {
      const el = render(<Table headers={HEADERS} rows={ROWS} />)
      expect((cellsOf(rowsOf(el)[0])[0] as HTMLElement).style.whiteSpace).not.toBe('nowrap')
    })

    it('开启后单元格不换行', () => {
      const el = render(<Table headers={HEADERS} rows={ROWS} nowrapCells />)
      for (const td of cellsOf(rowsOf(el)[0])) {
        expect((td as HTMLElement).style.whiteSpace).toBe('nowrap')
      }
    })
  })

  describe('hoverableRows（Markdown 表格用：行悬停高亮）', () => {
    it('默认关闭 —— 统计表行不响应悬停', () => {
      const el = render(<Table headers={HEADERS} rows={ROWS} />)
      const row = rowsOf(el)[0] as HTMLElement
      act(() => {
        row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      })
      expect(row.style.backgroundColor).toBe('')
    })

    it('开启后悬停行加底色', () => {
      const el = render(<Table headers={HEADERS} rows={ROWS} hoverableRows />)
      const row = rowsOf(el)[0] as HTMLElement
      act(() => {
        row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      })
      expect(row.style.backgroundColor).toContain('--color-hover')
    })
  })

  it('className 透传给外层容器（my-2 这类间距由调用方决定）', () => {
    const el = render(<Table headers={HEADERS} rows={ROWS} className="my-2" />)
    expect(el.className).toContain('my-2')
    expect(el.className).toContain('rounded-md')
  })

  it('单元格接受 ReactNode（Markdown 表格传行内解析结果，统计表传纯字符串）', () => {
    const el = render(
      <Table
        headers={['列']}
        rows={[{ key: 'x', cells: [<strong key="b">粗体</strong>] }]}
      />,
    )
    expect(el.querySelector('tbody td strong')?.textContent).toBe('粗体')
  })
})
