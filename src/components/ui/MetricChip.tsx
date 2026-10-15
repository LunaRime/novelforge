/**
 * MetricChip — 指标 chip 原语（六项 UI 改进 §2.4「指标行按功能个性化」）
 *
 * 为什么需要：同类信息此前是「压缩 0 · 跳过 0 · 截断 0 · 保真告警 0 · 移除 0 · 重生成 0」
 * 这样一条 `·` 串 —— 六个**语义完全不同**的计数被拍平成同等权重的纯文本：
 * 分不清哪个是好事、哪个是告警，也看不出学习是否在起效；数值用正文比例字宽，多行时对不齐。
 *
 * 形态约定 —— **一个指标 = 一个 chip**：
 * - 视觉：小圆角片（`rounded-md` / 高 20px / `px-1.5`），图标（12px 档）+
 *   标签（`text-micro`，`--color-text-muted`）+ 数值（`font-mono` + `tabular-nums`，等宽对齐）；
 * - `tone` **只影响数值与图标的颜色**（片底与描边保持中性，避免一行里色块互抢）：
 *   neutral=`--color-text-secondary` / good=`--color-success` / warn=`--color-warning` /
 *   bad=`--color-error`。颜色一律走语义令牌（color-token-standard）。
 * - `title` 是**解释型** tooltip（这个数是什么、来自哪），不是可点暗示 —— 故不加 hover 底色、
 *   不加 `cursor-pointer`（ui-interaction-standard §4：解释型 title 不算可点暗示）。
 *
 * 三处同族站点共用本语言：自学习压缩统计（`ContextCompactionSection`）/
 * 工作流进度（`WorkflowProgressEntry`）/ 上下文明细（`ContextBudgetBar`）。
 */
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

/** 语气：只决定「这个数是好 / 中性 / 要留意」的着色，不改变形状 */
export type MetricTone = 'neutral' | 'good' | 'warn' | 'bad'

/** tone → 语义令牌（禁止硬编码色；neutral 用次级文字色，与标签的 muted 拉开一档） */
const TONE_COLOR: Record<MetricTone, string> = {
  neutral: 'var(--color-text-secondary)',
  good: 'var(--color-success)',
  warn: 'var(--color-warning)',
  bad: 'var(--color-error)',
}

interface MetricChipProps {
  /** 语义图标（12px 档，lucide）；与数值同色 */
  icon?: ReactNode
  /** 指标名（如「截断」）——固定 muted，语义色只留在数值与图标上 */
  label: string
  /** 指标值（数字或已格式化的节点）；等宽 + tabular-nums，多行数值竖向对齐 */
  value: ReactNode
  /** 语气（默认 neutral） */
  tone?: MetricTone
  /** 解释型 tooltip：这个数是什么、来自哪 */
  title?: string
  /** 布局用附加类（如 `w-full` 让数值右贴成明细行） */
  className?: string
}

export function MetricChip({ icon, label, value, tone = 'neutral', title, className }: MetricChipProps) {
  const toneColor = TONE_COLOR[tone]
  return (
    <span
      data-metric-chip
      data-tone={tone}
      title={title}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-md px-1.5 text-micro leading-none whitespace-nowrap',
        className,
      )}
      style={{
        height: 20,
        border: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-panel)',
      }}
    >
      {icon != null && (
        <span data-metric-icon className="inline-flex flex-shrink-0 items-center" style={{ color: toneColor }}>
          {icon}
        </span>
      )}
      <span data-metric-label className="min-w-0 truncate" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </span>
      {/* marginLeft auto：窄片（内容宽）无自由空间 → 退化为 gap-1；
          `w-full` 明细行则把数值推到右端（label 左 / 值右），不必各自写 justify-between */}
      <span
        data-metric-value
        className="flex-shrink-0 font-mono font-medium tabular-nums"
        style={{ color: toneColor, marginLeft: 'auto' }}
      >
        {value}
      </span>
    </span>
  )
}

/** 指标行：横向分组（`flex-wrap`，窄容器下自动折行）；三处站点共用同一行语言 */
export function MetricRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span data-metric-row className={cn('inline-flex flex-wrap items-center gap-1.5', className)}>
      {children}
    </span>
  )
}
