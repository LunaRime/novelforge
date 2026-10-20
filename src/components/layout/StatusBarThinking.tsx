import { useRef, useState } from 'react'
import { useThinkingStore } from '../../stores/thinking-store'
import { thinkingLevelSpec } from '../../shared/thinking-level'
import { useTranslation } from '../../hooks/useTranslation'
import { useOutsideClick } from '../../hooks/useOutsideClick'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useFloatingPosition } from '../../hooks/useFloatingPosition'
import { PopoverSurface } from '../ui/PopoverSurface'
import ThinkingLevelSlider, { ThinkingLevelIcon } from '../ui/ThinkingLevelSlider'
import { StatusBarSegment } from './StatusBarSegment'

/**
 * 状态栏思考等级控件 —— 全局四档（off/low/high/max）的快捷入口。
 *
 * 思考等级是全局配置：所有 LLM 调用的温度与 Agent 的提示词强度都由它决定，
 * 因此常驻状态栏（与 Agent 输入框的合并弹窗读写同一个 thinking-store）。
 * 点开是共享的四档温度计滑块 + 当前档位描述；Esc / 点击外部关闭。
 */
export default function StatusBarThinking() {
  const { t } = useTranslation()
  const level = useThinkingStore(s => s.level)
  const setLevel = useThinkingStore(s => s.setLevel)
  const [open, setOpen] = useState(false)

  // 锚点包住触发器 + 浮层（浮层 position: fixed 但仍是 DOM 子节点）：
  // 点击滑块内部不算「外部点击」，不会误关
  const anchorRef = useRef<HTMLDivElement>(null)
  const popoverRef = useFloatingPosition<HTMLDivElement>(anchorRef, open, {
    placement: 'above',
    align: 'end',
  })

  useOutsideClick(anchorRef, () => setOpen(false), open)
  useEscapeKey(() => setOpen(false), open)

  const spec = thinkingLevelSpec(level)

  return (
    <div ref={anchorRef} className="relative h-full">
      <StatusBarSegment
        title={`${t('agent.thinkingLevelTitle')}: ${t(spec.labelKey)}`}
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ThinkingLevelIcon level={spec.id} />
        <span>{t(spec.labelKey)}</span>
      </StatusBarSegment>

      {open && (
        <PopoverSurface ref={popoverRef} className="p-3" style={{ width: 210 }}>
          <ThinkingLevelSlider value={level} onChange={setLevel} showDescription />
        </PopoverSurface>
      )}
    </div>
  )
}
