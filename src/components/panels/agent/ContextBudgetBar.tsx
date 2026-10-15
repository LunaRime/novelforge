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

/** 面板一行最多列几段（其余折成「其它 N 段」——避免窄面板被明细撑高） */
const MAX_ROWS = 6

/**
 * 上下文占用指示器（圆环 + 百分比）
 *
 * - 圆环按占用比例填充，旁边是百分比；占用越高颜色越警示（accent → warning → error）
 * - **点击圆环**展开上下文明细弹层；弹层走 useFloatingPosition 浮在窗口之上 ——
 *   264px 的窄面板里绝对定位会被容器裁掉
 *
 * ⚠️ 2026-10-16 用户要求：明细面板改成 **DSH `ContextMeter` 的同款样式**（可本地特色化）。
 * DSH 原版（`packages/client/ui-conversation/src/client/skeleton/ContextMeter.tsx` + 同名 .module.css）：
 *   ① 标题行 —— 「上下文已用 45%」+ 右侧「~67k / 128k」（占比与数字都 tabular-nums）；
 *   ② **4px 圆角分段条** —— 按各段占比着色（段间 1px 缝），总长 = 占用百分比（上限 100%）；
 *   ③ 明细行 —— `<dl>`，每行「8px 色块 + 段名」左、「~token 数」右，行高 20px、字号 12px、值变主色。
 * 本地特色化（NF 与 DSH 的数据模型不同，不做无意义对齐）：
 *   - DSH 三段（system / tools / messages）→ **NF 四段**（基础 / 记忆 / 历史 / 当前），色块沿用本仓令牌
 *     `--color-accent / --color-info / --color-warning / --color-success`（与圆环同源）；
 *   - **保留** NF 的 token 引擎降级标记、面板值 vs 实发值分列、前缀记账、
 *     逐段告警（⚠ 优先于 ✂）与字符数（挂 `title`，DSH 无对应概念但本仓依赖它定位来源）；
 *   - 明细行数上限 6（其余折「其它 N 段」），比 DSH 更早收口 —— 本仓窄面板放不下更多。
 */
export default function ContextBudgetBar({ usage, tokenEngineDegraded = false }: {
  usage: ContextUsage | null
  /** S1：token 引擎降级（启发式）——全部预算按保守口径判定，必须在面板可见 */
  tokenEngineDegraded?: boolean
}) {
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
  /** 四段：口径与 computeContextUsage 完全一致（base + memory + history + current），不改数值 */
  const segments = [
    { key: 'base', label: t('ccr.segBase'), value: usage.base, color: 'var(--color-accent)' },
    { key: 'memory', label: t('ccr.segMemory'), value: usage.memory, color: 'var(--color-info)' },
    { key: 'history', label: t('ccr.segHistory'), value: usage.history, color: 'var(--color-warning)' },
    { key: 'current', label: t('ccr.segCurrent'), value: usage.current, color: 'var(--color-success)' },
  ]
  const segmentSum = segments.reduce((sum, s) => sum + s.value, 0)
  const ringColor = pct >= 90 ? 'var(--color-error)' : pct >= 70 ? 'var(--color-warning)' : 'var(--color-accent)'
  // 圆环几何：r = 6.5（16px 视口）→ 周长 2πr
  const R = 6.5
  const C = 2 * Math.PI * R
  const dash = (pct / 100) * C

  /**
   * 分段条宽度（DSH 口径）：总长 = 占用百分比（**上限 100%**，与圆环同源），
   * 各段在其中按占比分配。分母用四段之和 —— 它正是 total（computeContextUsage 同一算式），
   * 但**显式以 segmentSum 归一**：这样即使调用方传了不一致的 total，条也永远是一整条，不会溢出面板。
   */
  const barWidths = segmentSum > 0
    ? segments.map(s => (s.value / segmentSum) * pct)
    : []
  const barParts = segments.filter((_, i) => barWidths[i] > 0)

  /** 明细行：有逐段明细就用明细（信息更细），否则回落四段聚合；超上限折成「其它 N 段」 */
  const detailRows = usage.segments && usage.segments.length > 0
    ? usage.segments.map(seg => ({
        key: seg.key,
        label: t(`context.seg.${seg.key}` as never),
        tokens: seg.tokens,
        chars: seg.chars,
        tone: seg.warning ? 'var(--color-warning)' : seg.truncated ? 'var(--color-warning)' : undefined,
        mark: seg.warning ? '⚠' : seg.truncated ? '✂' : '',
        title: [seg.source, seg.warning].filter(Boolean).join(' — ') || undefined,
      }))
    : segments.map(seg => ({
        key: seg.key,
        label: seg.label,
        tokens: seg.value,
        chars: undefined as number | undefined,
        tone: seg.color,
        mark: '',
        title: t('ccr.barHint'),
      }))
  const shownRows = detailRows.slice(0, MAX_ROWS)
  const restRows = detailRows.length - shownRows.length

  return (
    <div className="p-0" ref={anchorRef}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          title={t('ccr.clickForDetail')}
          aria-haspopup="dialog"
          aria-expanded={open}
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
          <span className="text-micro leading-none tabular-nums">{pct}%</span>
        </button>

        {/* 四段原始值（base,memory,history,current）：供测试等程序化读取 ——
            界面文案会随 UI 迭代变化，靠正则匹配文本太脆 */}
        <span className="hidden" data-budget-segments={segments.map(s => s.value).join(',')} />
      </div>

      {open && (
        <PopoverSurface ref={menuRef} className="p-3" style={{ width: 264 }}>
          {/* ① 标题行（DSH `.header`）：占比在左、数字在右，全部 tabular-nums */}
          <div className="flex items-center gap-1.5 text-xs" role="dialog" aria-label={t('ccr.panelTitle').replace('{percent}', `${pct}%`)}>
            <span style={{ color: 'var(--color-text-muted)' }}>{t('ccr.contextUsage')}</span>
            <span className="font-medium tabular-nums" style={{ color: 'var(--color-text)' }}>{pct}%</span>
            <span
              className="ml-auto font-medium tabular-nums whitespace-nowrap"
              style={{ color: 'var(--color-text)' }}
              title={t('ccr.usedOf')}
            >
              {`~${fmtK(usage.total)} / ${fmtK(usage.modelMax)}`}
            </span>
          </div>

          {/* ② 4px 分段条（DSH `.bar`）：总长 = pct，各段按占比着色，段间 1px 缝 */}
          <div
            data-budget-bar
            className="flex mt-2.5 mb-3 rounded-full overflow-hidden"
            style={{ height: 4, gap: 1, backgroundColor: 'var(--color-hover)' }}
            title={t('ccr.barHint')}
          >
            {barParts.length > 0
              ? barParts.map(seg => {
                  const i = segments.findIndex(s => s.key === seg.key)
                  return (
                    <div
                      key={seg.key}
                      data-budget-bar-part={seg.key}
                      className="h-full rounded-[1px]"
                      style={{ width: `${barWidths[i]}%`, minWidth: barWidths[i] > 0 ? 2 : 0, backgroundColor: seg.color }}
                    />
                  )
                })
              : (
                /* 四段全 0：只画基底，不画任何色条（DSH 的「0% 不许画成实心条」同口径） */
                <div className="h-full w-full" />
              )}
          </div>

          {/* ③ 明细行（DSH `.rows` 的 dl 形态）：色块 + 段名左、token 数右 */}
          <dl className="space-y-0.5" data-budget-rows>
            {shownRows.map(row => (
              <div key={row.key} data-budget-row={row.key} className="flex items-center justify-between gap-3 py-0.5 text-xs" title={row.title}>
                <dt className="flex items-center gap-1.5 min-w-0" style={{ color: 'var(--color-text-secondary)' }}>
                  <span
                    aria-hidden
                    className="flex-shrink-0 rounded-[2px]"
                    style={{ width: 8, height: 8, backgroundColor: row.tone ?? 'var(--color-text-muted)' }}
                  />
                  <span className="truncate">{row.label}</span>
                  {row.mark && (
                    <span className="flex-shrink-0" aria-hidden style={{ color: 'var(--color-warning)' }}>{row.mark}</span>
                  )}
                </dt>
                {/* 值：token 数（主色）；**字符数进 title** —— DSH 无该概念，但本仓靠它定位来源体量 */}
                <dd
                  className="flex-shrink-0 tabular-nums whitespace-nowrap m-0"
                  style={{ color: 'var(--color-text)' }}
                  title={row.chars === undefined ? undefined : `${fmtK(row.tokens)} tokens · ${row.chars} chars`}
                  data-budget-row-value={row.key}
                >
                  {fmtK(row.tokens)}
                </dd>
              </div>
            ))}
            {restRows > 0 && (
              <div className="py-0.5 text-2xs" style={{ color: 'var(--color-text-muted)' }}>
                {t('ccr.moreSegments').replace('{n}', String(restRows))}
              </div>
            )}
          </dl>

          {/* ===== 以下为 NF 保留的口径行（DSH 无对应物）===== */}

          {/* B6 口径诚实：面板值（当前历史全量）与**实发**值（发送前裁剪后）不同时必须分列 */}
          {usage.historySentTokens !== undefined
            && usage.historyPanelTokens !== undefined
            && usage.historySentTokens !== usage.historyPanelTokens && (
            <div className="mt-2 text-micro" style={{ color: 'var(--color-text-muted)' }}>
              {t('ccr.historyPanelVsSent')
                .replace('{panel}', fmtK(usage.historyPanelTokens))
                .replace('{sent}', fmtK(usage.historySentTokens))}
            </div>
          )}

          {/* B4：前缀记账（只记不拦）——变化时给出与上轮的共享字符数 */}
          {usage.prefix && (
            <div
              className="mt-1 text-micro"
              style={{ color: usage.prefix.changed ? 'var(--color-warning)' : 'var(--color-text-muted)' }}
            >
              {usage.prefix.changed
                ? t('ccr.prefixChanged').replace('{n}', String(usage.prefix.sharedChars))
                : t('ccr.prefixStable')}
            </div>
          )}

          {/* S1：token 引擎降级标记 —— 该模式下全部预算按保守口径判定（压缩更早触发），
              不标出来用户只会觉得"压缩怎么这么频繁" */}
          {tokenEngineDegraded && (
            <div className="mt-1 text-micro" style={{ color: 'var(--color-warning)' }}>
              {t('ccr.tokenDegradedBadge')}
            </div>
          )}
        </PopoverSurface>
      )}
    </div>
  )
}
