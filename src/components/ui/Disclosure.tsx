import React from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils'

interface Props {
  /** 摘要行文字（整行可点） */
  label: React.ReactNode
  children: React.ReactNode
  /** 默认是否展开（默认收起） */
  defaultOpen?: boolean
  className?: string
}

/**
 * 默认收起的折叠区（「高级设置」这类）。
 *
 * 用原生 `<details>/<summary>`：键盘可达与展开语义由浏览器提供，不需要 JS 状态，
 * 也不会因为重渲染而丢失展开态。
 *
 * ⚠️ **摘要行那四样东西不可省**（2026-09-22 真机反馈「看起来不能点击」的修复）：
 * ① 箭头（展开时 `group-open:rotate-90`）② hover 底色 ③ 负外边距扩大的点击区
 * ④ 次级文字色（此前是 10px + muted，看着像说明文字而不像按钮）。
 * `Disclosure.test.tsx` 逐条钉住了它们 —— 改样式时别把它们删掉。
 */
export function Disclosure({ label, children, defaultOpen = false, className }: Props) {
  return (
    // 只在需要展开时写 open 属性：写 `open={false}` 会让它变成受控的，用户点不开
    <details className={cn('group', className)} {...(defaultOpen ? { open: true } : {})}>
      <summary
        className="cursor-pointer flex items-center gap-1 text-micro font-medium -mx-1.5 px-1.5 py-1 rounded transition-colors select-none hover:bg-[var(--color-hover)]"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        <ChevronRight
          size={11}
          strokeWidth={2}
          className="flex-shrink-0 transition-transform group-open:rotate-90"
        />
        {label}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  )
}
