import { useRef, useState } from 'react'
import type { ContextUsage } from '../../../services/agent/context-usage'
import { t } from '../../../shared/locale'
import { useFloatingPosition } from '../../../hooks/useFloatingPosition'
import { PopoverSurface } from '../../ui/PopoverSurface'
import { useOutsideClick } from '../../../hooks/useOutsideClick'
import { useEscapeKey } from '../../../hooks/useEscapeKey'

/** 数字缩写：131072 → 131k、2584 → 2.6k（窄面板下省宽度） */
function fmtK(n: number): string {
  if (n < 1000) return String(n)
  const k = n / 1000
  return `${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}k`
}

/**
 * 上下文占用指示器（2026-09-22 由水平分段条改为**圆环 + 百分比**）
 *
 * - 圆环按占用比例填充，旁边是百分比；占用越高颜色越警示（accent → warning → error）
 * - **点击圆环**展开该对话的上下文明细（四段 token + 合计 / 模型上限）；
 *   弹层走 useFloatingPosition 浮在窗口之上 —— 264px 的窄面板里绝对定位会被容器裁掉
 */
export default function ContextBudgetBar({ usage }: { usage: ContextUsage | null }) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const menuRef = useFloatingPosition<HTMLDivElement>(anchorRef, open, { placement: 'above', align: 'end' })
  // 2026-09-25 补：此前这是全仓唯一**既无 Esc 也无点击外部**的自绘浮层——
  // 唯一关闭方式是再点一次圆环，而菜单浮在窗口之上、盖住别处，用户很容易以为它关不掉。
  // 菜单与触发按钮同在 anchorRef 容器内 → 容器内点击不算"外部"，点别处才关。
  useOutsideClick(anchorRef, () => setOpen(false), open)
  useEscapeKey(() => setOpen(false), open)

  if (!usage || usage.modelMax <= 0) return null

  const pct = Math.min(100, Math.round((usage.total / usage.modelMax) * 100))
  const segments = [
    { label: t('ccr.segBase'), value: usage.base, color: 'var(--color-accent)' },
    { label: t('ccr.segMemory'), value: usage.memory, color: 'var(--color-info)' },
    { label: t('ccr.segHistory'), value: usage.history, color: 'var(--color-warning)' },
    { label: t('ccr.segCurrent'), value: usage.current, color: 'var(--color-success)' },
  ]
  const ringColor = pct >= 90 ? 'var(--color-error)' : pct >= 70 ? 'var(--color-warning)' : 'var(--color-accent)'
  // 圆环几何：r = 6.5（16px 视口）→ 周长 2πr
  const R = 6.5
  const C = 2 * Math.PI * R
  const dash = (pct / 100) * C

  return (
    <div className="p-0" ref={anchorRef}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          title={t('ccr.clickForDetail')}
          className="flex items-center gap-1.5 rounded px-0.5 cursor-pointer transition-colors hover:bg-[var(--color-hover)]"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" className="flex-shrink-0" aria-hidden>
            {/* 底环用 --color-border（比 --color-bg-hover 明显，低占用时圆环才看得出来） */}
            <circle cx="8" cy="8" r={R} fill="none" stroke="var(--color-border)" strokeWidth="2" />
            <circle
              cx="8" cy="8" r={R} fill="none"
              stroke={ringColor}
              strokeWidth="2"
              strokeDasharray={`${dash} ${C - dash}`}
              strokeLinecap="round"
              transform="rotate(-90 8 8)"
            />
          </svg>
          <span className="text-micro leading-none">{pct}%</span>
        </button>

        {/* 四段原始值（base,memory,history,current）：供测试等程序化读取 ——
            界面文案会随 UI 迭代变化，靠正则匹配文本太脆 */}
        <span className="hidden" data-budget-segments={segments.map(s => s.value).join(',')} />
      </div>

      {open && (
        <PopoverSurface
          ref={menuRef}
          className="min-w-[184px]"
          style={{ padding: '8px 10px' }}
        >
          <div className="mb-1.5 text-micro font-medium" style={{ color: 'var(--color-text)' }}>
            {t('ccr.contextUsage')}
          </div>

          {/* B6：逐段明细 —— 每段给出 token 与**字符数**，来源挂在 title（悬停可查"这段来自哪"） */}
          {usage.segments && usage.segments.length > 0 ? (
            <div className="mb-1">
              {usage.segments.map(seg => (
                <div
                  key={seg.key}
                  className="flex items-center justify-between gap-3 text-micro leading-relaxed"
                  style={{ color: 'var(--color-text-secondary)' }}
                  title={seg.source}
                >
                  <span className="truncate">
                    {t(`context.seg.${seg.key}` as never)}
                    {/* C 档第一轮：常驻段告警（接近上限 / 超上限未注入）——悬停给原因，
                        比 ✂（截断）更严重故优先显示 */}
                    {seg.warning
                      ? <span title={seg.warning} style={{ color: 'var(--color-warning)' }}> ⚠</span>
                      : seg.truncated ? ' ✂' : ''}
                  </span>
                  <span className="flex-shrink-0 font-mono">{fmtK(seg.tokens)} · {seg.chars}</span>
                </div>
              ))}
            </div>
          ) : (
            segments.map(seg => (
              <div
                key={seg.label}
                className="flex items-center justify-between gap-3 text-micro leading-relaxed"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: seg.color }} />
                  {seg.label}
                </span>
                <span>{seg.value}</span>
              </div>
            ))
          )}

          {/* B6 口径诚实：面板值（当前历史全量）与**实发**值（发送前裁剪后）不同时必须分列 */}
          {usage.historySentTokens !== undefined
            && usage.historyPanelTokens !== undefined
            && usage.historySentTokens !== usage.historyPanelTokens && (
            <div className="text-micro" style={{ color: 'var(--color-text-muted)' }}>
              {t('ccr.historyPanelVsSent')
                .replace('{panel}', fmtK(usage.historyPanelTokens))
                .replace('{sent}', fmtK(usage.historySentTokens))}
            </div>
          )}

          {/* B4：前缀记账（只记不拦）——变化时给出与上轮的共享字符数 */}
          {usage.prefix && (
            <div
              className="text-micro"
              style={{ color: usage.prefix.changed ? 'var(--color-warning)' : 'var(--color-text-muted)' }}
            >
              {usage.prefix.changed
                ? t('ccr.prefixChanged').replace('{n}', String(usage.prefix.sharedChars))
                : t('ccr.prefixStable')}
            </div>
          )}

          <div
            className="mt-1.5 pt-1.5 flex items-center justify-between gap-3 text-micro"
            style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          >
            <span>{t('ccr.total')}</span>
            <span>{fmtK(usage.total)}/{fmtK(usage.modelMax)} ({pct}%)</span>
          </div>
        </PopoverSurface>
      )}
    </div>
  )
}
