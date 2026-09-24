import { Loader2 } from 'lucide-react'

/**
 * 统一的加载指示器（2026-09-25）。
 *
 * 审计实测此前有 **5 种实现并存**：
 * - `Loader2 + animate-spin`（18 处，正确的那个）
 * - **把「刷新」图标 `RefreshCw` 当 spinner 转**（7 处）—— 语义是"刷新"却用来表示"加载中"，
 *   用户会以为可以点它刷新
 * - 手写 CSS 圆环（ImportNovelDialog）
 * - **emoji spinner 🌀 + animate-spin**（ChapterCreationDialog）
 * - 自定义 CSS 类 `.tool-spinner`（ToolCallBlock，与 Tailwind 的 animate-spin 重复）
 *
 * 统一后只需知道一件事：**加载中 = Spinner**。
 */
export function Spinner({ size = 14, className, style }: {
  size?: number
  /** 附加样式（外边距、透明度等）。旋转由本组件负责，不必再传 animate-spin */
  className?: string
  style?: React.CSSProperties
}) {
  return <Loader2 size={size} className={className ? `animate-spin ${className}` : 'animate-spin'} style={style} />
}
