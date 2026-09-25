import React from 'react'
import { cn } from '../../lib/utils'

/** 一行数据：`key` 供 React 复用，`cells` 与 `headers` 按位置对应 */
export interface TableRow {
  key: string
  cells: React.ReactNode[]
}

interface Props {
  headers: string[]
  /** 单元格内容由调用方决定：统计表传纯字符串，Markdown 表格传行内解析结果 */
  rows: TableRow[]
  /** 行悬停高亮（Markdown 表格用）。统计表不开——数字表格扫读时闪烁反而干扰 */
  hoverableRows?: boolean
  /** 单元格不换行（统计表用：日期与数字折行会破坏列对齐）。Markdown 表格不开——正文要能折行 */
  nowrapCells?: boolean
  className?: string
}

/**
 * 通用表格 —— 描边容器 + 表头底色 + 行分隔线的一整套惯例。
 *
 * 收敛自 `UsageStatsView` 的 StatsTable 与 `MarkdownContent` 的 MarkdownTable：
 * 两份实现逐字符相同，只有三处差异——行 hover、单元格 nowrap、外层间距（`my-2`）。
 * 前两项做成显式 prop，第三项由调用方 className 传（间距不是表格的职责）。
 */
export function Table({
  headers,
  rows,
  hoverableRows = false,
  nowrapCells = false,
  className,
}: Props) {
  return (
    <div
      className={cn('overflow-x-auto rounded-md', className)}
      style={{ border: '1px solid var(--color-border)' }}
    >
      <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ backgroundColor: 'var(--color-hover)' }}>
            {headers.map((h, hi) => (
              /* 用下标而非表头文本作 key：同名列（如两个「字数」）会撞 key */
              <th
                key={hi}
                className="px-3 py-1.5 text-left font-semibold"
                style={{
                  color: 'var(--color-text)',
                  borderBottom: '1px solid var(--color-border)',
                  whiteSpace: 'nowrap',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={row.key}
              style={{
                borderBottom: ri < rows.length - 1 ? '1px solid var(--color-border)' : undefined,
              }}
              onMouseEnter={
                hoverableRows
                  ? (e) => {
                      e.currentTarget.style.backgroundColor = 'var(--color-hover)'
                    }
                  : undefined
              }
              onMouseLeave={
                hoverableRows
                  ? (e) => {
                      e.currentTarget.style.backgroundColor = 'transparent'
                    }
                  : undefined
              }
            >
              {row.cells.map((cell, ci) => (
                <td
                  key={ci}
                  className="px-3 py-1.5"
                  style={{
                    color: 'var(--color-text-secondary)',
                    whiteSpace: nowrapCells ? 'nowrap' : undefined,
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
