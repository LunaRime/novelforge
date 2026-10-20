import type { ChangeEvent } from 'react'
import { BrainCircuit, Flame, Gauge, Zap, type LucideIcon } from 'lucide-react'
import { THINKING_LEVELS, thinkingLevelSpec, type ThinkingLevel } from '../../shared/thinking-level'
import { useTranslation } from '../../hooks/useTranslation'

/**
 * 四档思考等级温度计（纯受控组件）。
 *
 * 视觉复用旧六档 Agent 温度计（`.depth-slider` / `.depth-thumb` / `.depth-fill`）：
 * 轨道条 + 温度计填充 + 四个档位节点 + 球头大圆。组件自己不碰任何 store，
 * `value` / `onChange` 由调用方（Agent 合并弹层、状态栏控件）提供。
 */

export interface ThinkingLevelSliderProps {
  value: ThinkingLevel
  onChange: (level: ThinkingLevel) => void
  /** 是否在滑块下方显示当前档位描述（固定两行高度，避免弹层跳动） */
  showDescription?: boolean
}

/** 滑块条高 = 球头大圆直径（thumb 上下限与条贴齐内嵌） */
const TRACK_H = 18
/** 球头半径：端点圆心与条边完全贴合（内切） */
const INSET = TRACK_H / 2

/** 档位图标：低档闪电 → 高档火焰 */
const LEVEL_ICONS: Record<ThinkingLevel, LucideIcon> = {
  off: Zap,
  low: Gauge,
  high: BrainCircuit,
  max: Flame,
}

/** 第 index 档在轨道上的比例（0 → 1） */
function fracOf(index: number): string {
  return (index / (THINKING_LEVELS.length - 1)).toFixed(3)
}

/** 球头圆心位置：calc(9px + (100% - 18px) × frac) */
function centerExpr(index: number): string {
  return `${INSET}px + ((100% - ${INSET * 2}px) * ${fracOf(index)})`
}

function thumbLeftFor(index: number): string {
  return `calc(${centerExpr(index)} - ${TRACK_H / 2}px)`
}

/** 填充右端 = 球头圆心，盖住大圆左半 → 与大圆一体 */
function fillWidthFor(index: number): string {
  return `calc(${centerExpr(index)})`
}

/** 同帧 DOM 直写：球头 + 填充跟随（不经 React 渲染，无帧延迟） */
function applyVisual(input: HTMLInputElement, index: number): void {
  const wrap = input.parentElement
  const thumb = wrap?.querySelector<HTMLElement>('.depth-thumb')
  const fill = wrap?.querySelector<HTMLElement>('.depth-fill')
  if (thumb) thumb.style.left = thumbLeftFor(index)
  if (fill) fill.style.width = fillWidthFor(index)
}

export default function ThinkingLevelSlider({
  value,
  onChange,
  showDescription,
}: ThinkingLevelSliderProps) {
  const { t } = useTranslation()
  // 防御非法/旧档位值：回退默认档规格
  const activeSpec = thinkingLevelSpec(value)
  const activeIndex = Math.max(0, THINKING_LEVELS.findIndex(l => l.id === activeSpec.id))
  const isMax = activeSpec.id === 'max'

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const index = Number(e.target.value) - 1
    const next = THINKING_LEVELS[index]
    if (!next) return
    onChange(next.id)
    applyVisual(e.currentTarget, index)
  }

  return (
    <div>
      {/* group：让键盘焦点环画在可见轨道上，而非 opacity:0 的 range input 上 */}
      <div className="relative group" style={{ height: TRACK_H }}>
        {/* 轨道条（纯背景 + 焦点环） */}
        <div
          className="absolute inset-0 rounded-full group-focus-within:ring-2 group-focus-within:ring-[var(--color-focus-ring)]"
          style={{ backgroundColor: 'var(--color-border)' }}
        />

        {/* 已滑过区域（温度计填充：右端 = 球头圆心，盖住大圆左半 → 与大圆一体） */}
        <div
          className="depth-fill absolute left-0 top-0 bottom-0"
          style={{
            width: fillWidthFor(activeIndex),
            borderRadius: '999px 0 0 999px',
            zIndex: 1,
            background: isMax
              ? 'linear-gradient(to right, rgba(var(--color-warning-rgb), 0.15), rgba(var(--color-warning-rgb), 0.55))'
              : 'linear-gradient(to right, rgba(var(--color-accent-rgb), 0.12), rgba(var(--color-accent-rgb), 0.5))',
          }}
        />

        {/* 四档节点（当前档被球头覆盖 → 隐藏；已滑过 = 实色，未滑到 = 淡色） */}
        {THINKING_LEVELS.map((level, index) => {
          const lit = index <= activeIndex
          const hidden = index === activeIndex
          const Icon = LEVEL_ICONS[level.id]
          return (
            <span
              key={level.id}
              data-thinking-node={level.id}
              aria-hidden="true"
              className="absolute top-1/2 flex pointer-events-none"
              style={{
                left: `calc(${centerExpr(index)})`,
                transform: 'translate(-50%, -50%)',
                zIndex: 2,
                color: level.id === 'max' ? 'var(--color-warning)' : 'var(--color-accent)',
                opacity: hidden ? 0 : (lit ? 0.9 : 0.4),
              }}
            >
              <Icon size={11} strokeWidth={2} />
            </span>
          )
        })}

        {/* 球头大圆：位置 JS 精确计算，z 低于填充 → 左半被填充渐变罩住（一体视觉） */}
        <div
          className={`depth-thumb absolute rounded-full pointer-events-none ${isMax ? 'depth-thumb--max' : ''}`}
          style={{
            width: TRACK_H,
            height: TRACK_H,
            left: thumbLeftFor(activeIndex),
            top: 0,
            zIndex: 0,
            backgroundColor: isMax ? 'var(--color-warning)' : 'var(--color-accent)',
            border: `2px solid ${isMax ? 'var(--color-warning)' : 'var(--color-accent)'}`,
            boxShadow: '0 0 0 1px var(--color-border), 0 2px 6px rgba(0,0,0,0.25)',
          }}
        />

        {/* 交互层：透明 range（仅捕获拖动/点击；opacity 0 不影响交互） */}
        <input
          type="range"
          min={1}
          max={THINKING_LEVELS.length}
          step={1}
          value={activeIndex + 1}
          onChange={handleChange}
          aria-label={t('agent.thinkingLevelTitle')}
          aria-valuetext={t(activeSpec.labelKey)}
          className="depth-slider absolute top-0 bottom-0"
          style={{ left: `${INSET}px`, right: `${INSET}px`, opacity: 0, zIndex: 3 }}
        />
      </div>

      {/* 当前档位描述（固定两行高度 + 截断 → 容器高度恒定，滑块不上下跳动） */}
      {showDescription && (
        <div
          className="mt-2 text-2xs leading-relaxed overflow-hidden"
          style={{
            color: 'var(--color-text-muted)',
            minHeight: 31,
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2,
          }}
        >
          {t(activeSpec.descKey)}
        </div>
      )}
    </div>
  )
}
