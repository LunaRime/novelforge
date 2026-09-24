import { useRef, useState } from 'react'
import { Bot, Sparkles, PenLine, Sun, Moon, ScrollText, Check } from 'lucide-react'
import { useLayoutStore } from '../../stores/layout-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useThemeStore, type Theme } from '../../stores/theme-store'
import { useTranslation } from '../../hooks/useTranslation'
import { useOutsideClick } from '../../hooks/useOutsideClick'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { t } from '../../shared/locale'

/** 主题图标映射（原标题栏；标题栏移除后随主题切换按钮一起搬来） */
const themeIcons: Record<Theme, typeof Sun> = {
  light: Sun,
  galaxy: Sparkles,
  paper: ScrollText,
  dark: Moon,
}
const themeOrder: Theme[] = ['galaxy', 'dark', 'light', 'paper']

/**
 * 右侧工具窗口栏（RightToolWindowBar）
 * JetBrains 风格：30px 宽，纯图标，激活时右侧 2px 竖线
 * 支持 Agent 面板和 AI 输出面板之间切换。
 *
 * 2026-09-22：标签栏（TitleBar）移除后，**主题切换**与**专注模式**两个按钮搬到这里（底部）；
 * 同时本栏整体是窗口拖拽区之一（`WebkitAppRegion: 'drag'`，栏内交互元素由 index.css 统一恢复 no-drag）。
 */
export default function RightToolWindowBar() {
  const { t: ti } = useTranslation() // 响应式 t：语言切换后新按钮的悬停提示跟随更新
  const aiPanelOpen = useLayoutStore(s => s.aiPanelOpen)
  const rightView = useLayoutStore(s => s.rightView)
  const toggleAIPanel = useLayoutStore(s => s.toggleAIPanel)
  const openRightPanel = useLayoutStore(s => s.openRightPanel)
  const focusMode = useLayoutStore(s => s.focusMode)
  const toggleFocusMode = useLayoutStore(s => s.toggleFocusMode)
  const currentRun = useWorkflowStore((s) => s.currentRun)

  // ── 主题切换（原标题栏逻辑：四主题菜单直选 + 以点击点为圆心的视图过渡动画）──
  const theme = useThemeStore(s => s.theme)
  const setTheme = useThemeStore(s => s.setTheme)
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const themeMenuRef = useRef<HTMLDivElement>(null)
  useOutsideClick(themeMenuRef, () => setThemeMenuOpen(false), themeMenuOpen)
  useEscapeKey(() => setThemeMenuOpen(false), themeMenuOpen)
  const ThemeIcon = themeIcons[theme] || Sun
  const themeLabel = (id: Theme) => id === 'galaxy' ? ti('theme.starry') : id === 'paper' ? ti('theme.paper') : id === 'dark' ? ti('theme.dark') : ti('theme.light')

  const applyThemeWithTransition = (nextTheme: Theme, e: React.MouseEvent) => {
    if (
      !('startViewTransition' in document) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setTheme(nextTheme)
      return
    }
    const x = e.clientX
    const y = e.clientY
    const endRadius = Math.hypot(
      Math.max(x, innerWidth - x),
      Math.max(y, innerHeight - y)
    )
    const transition = (document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } }).startViewTransition!(() => {
      setTheme(nextTheme)
    })
    transition.ready.then(() => {
      const clipPath = [
        `circle(0px at ${x}px ${y}px)`,
        `circle(${endRadius}px at ${x}px ${y}px)`
      ]
      document.documentElement.animate(
        { clipPath },
        { duration: 450, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' }
      )
    })
  }

  /** 工作流活跃时给 AI 输出按钮显示脉冲 */
  const showPulse = currentRun && (currentRun.status === 'running' || currentRun.status === 'waiting')

  /** 点击按钮逻辑：
   *  - 如果面板关闭 → 打开并切到对应视图
   *  - 如果面板已打开且已是此视图 → 关闭面板
   *  - 如果面板已打开但是另一个视图 → 切到此视图
   */
  const handleClick = (view: 'agent' | 'ai-output') => {
    if (!aiPanelOpen) {
      openRightPanel(view)
    } else if (rightView === view) {
      toggleAIPanel()
    } else {
      openRightPanel(view)
    }
  }

  return (
    <div
      className="no-select flex flex-col items-center justify-start h-full py-0.5 gap-0.5"
      style={{
        width: 'var(--width-right-bar)',  /* 30px */
        backgroundColor: 'var(--color-activity-bar)',
        // 与 AI 面板绑定成一张卡片：右两角圆角 + 朝窗口一侧的细边框；左边缘不画线（无缝相接）
        borderTopRightRadius: 6,
        borderBottomRightRadius: 6,
        border: '1px solid var(--color-border)',
        borderLeft: 'none',
        flexShrink: 0,
        // 拖拽区之一（标题栏已移除）：栏内按钮由 index.css 的 [data-activity-bar] 规则恢复 no-drag
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
      data-activity-bar="right"
    >
      {/* AI Agent 面板按钮 */}
      <button
        onClick={() => handleClick('agent')}
        title={t('agent.aiPanel')}
        className="tool-btn"
        style={{
          height: 30,
          boxShadow: aiPanelOpen && rightView === 'agent'
            ? 'inset -2px 0 0 var(--color-activity-indicator)'
            : 'none',
          color: aiPanelOpen && rightView === 'agent'
            ? 'var(--color-activity-icon-active)'
            : 'var(--color-activity-icon)',
        }}
      >
        <Bot size={15} strokeWidth={aiPanelOpen && rightView === 'agent' ? 2 : 1.5} />
      </button>

      {/* AI 输出面板按钮 */}
      <button
        onClick={() => handleClick('ai-output')}
        title={t('agent.aiOutput')}
        className="tool-btn relative"
        style={{
          height: 30,
          boxShadow: aiPanelOpen && rightView === 'ai-output'
            ? 'inset -2px 0 0 var(--color-activity-indicator)'
            : 'none',
          color: aiPanelOpen && rightView === 'ai-output'
            ? 'var(--color-activity-icon-active)'
            : 'var(--color-activity-icon)',
        }}
      >
        <Sparkles size={15} strokeWidth={aiPanelOpen && rightView === 'ai-output' ? 2 : 1.5} />
        {/* 工作流活跃时的脉冲指示点 */}
        {showPulse && !(aiPanelOpen && rightView === 'ai-output') && (
          <span
            className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ backgroundColor: 'var(--color-accent)' }}
          />
        )}
      </button>

      {/* 弹性空隙：把下面两个「全局设置类」按钮压到底部 */}
      <div className="flex-1" />

      {/* 专注写作模式（原标题栏） */}
      <button
        onClick={toggleFocusMode}
        title={`${focusMode ? ti('focus.exit') : ti('focus.enter')} (F11)`}
        className="tool-btn"
        style={{
          height: 30,
          color: focusMode ? 'var(--color-activity-icon-active)' : 'var(--color-activity-icon)',
        }}
      >
        <PenLine size={15} strokeWidth={focusMode ? 2 : 1.5} />
      </button>

      {/* 主题切换（原标题栏）：四主题菜单直选，菜单从按钮**左侧**展开（本栏贴窗口右边） */}
      <div className="relative" ref={themeMenuRef}>
        <button
          onClick={() => setThemeMenuOpen(v => !v)}
          title={ti('theme.label').replace('{theme}', themeLabel(theme))}
          className="tool-btn"
          style={{ height: 30, color: 'var(--color-activity-icon)', anchorName: '--menu-theme' } as React.CSSProperties}
        >
          <ThemeIcon size={15} strokeWidth={1.5} />
        </button>
        {themeMenuOpen && (
          <div
            /* floating-menu：fixed + 锚点定位，浮在整个窗口之上、超界自动翻转
               （本按钮在图标栏底部，原先菜单向下展开会超出窗口底部 58px 被切） */
            className="floating-menu floating-menu--above-end rounded-lg border shadow-lg overflow-hidden py-1"
            style={{
              backgroundColor: 'var(--color-panel)',
              borderColor: 'var(--color-border)',
              minWidth: 128,
              positionAnchor: '--menu-theme',
            } as React.CSSProperties}
          >
            {themeOrder.map(id => {
              const Icon = themeIcons[id]
              const active = theme === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={(e) => { applyThemeWithTransition(id, e); setThemeMenuOpen(false) }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-[var(--color-hover)] cursor-pointer"
                  style={{ color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)' }}
                >
                  <Icon size={12} />
                  <span className="flex-1">{themeLabel(id)}</span>
                  {active && <Check size={10} />}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
