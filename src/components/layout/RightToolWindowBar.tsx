import { useRef, useState } from 'react'
import { Bot, Sparkles, PenLine, Sun } from 'lucide-react'
import { useLayoutStore } from '../../stores/layout-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useThemeStore } from '../../stores/theme-store'
import { applyThemeWithTransition } from '../../lib/theme-transition'
import { THEME_ICONS, THEME_ORDER, themeLabel } from '../../lib/theme-meta'
import { useTranslation } from '../../hooks/useTranslation'
import { useOutsideClick } from '../../hooks/useOutsideClick'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { t } from '../../shared/locale'
import { PopoverSurface } from '../ui/PopoverSurface'
import { MenuItem } from '../ui/MenuItem'

// 主题图标 / 展示顺序 / 名称取值统一在 ../../lib/theme-meta（与「设置 → 编辑器」的主题卡片同源）

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
  // 过渡实现已抽到 ../../lib/theme-transition（设置 → 编辑器的主题卡片共用同一实现）
  const theme = useThemeStore(s => s.theme)
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const themeMenuRef = useRef<HTMLDivElement>(null)
  useOutsideClick(themeMenuRef, () => setThemeMenuOpen(false), themeMenuOpen)
  useEscapeKey(() => setThemeMenuOpen(false), themeMenuOpen)
  const ThemeIcon = THEME_ICONS[theme] || Sun

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
        borderTopRightRadius: 'var(--radius-md)',
        borderBottomRightRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        borderLeft: 'none',
        flexShrink: 0,
        // 拖拽区之一（标题栏已移除）：栏内按钮由 index.css 的 [data-activity-bar] 规则恢复 no-drag
        //
        // ⚠️ Windows 的窗口控件覆盖层**不在这里留位** —— 那必须做在 App 最外层容器上，
        // 否则覆盖层会压住本栏最上面那个按钮、且底色对不上（2026-09-25 真机踩过）。
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
        <Bot size={14} strokeWidth={aiPanelOpen && rightView === 'agent' ? 2 : 1.5} />
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
        <Sparkles size={14} strokeWidth={aiPanelOpen && rightView === 'ai-output' ? 2 : 1.5} />
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
        <PenLine size={14} strokeWidth={focusMode ? 2 : 1.5} />
      </button>

      {/* 主题切换（原标题栏）：四主题菜单直选，菜单从按钮**左侧**展开（本栏贴窗口右边）
          ⚠️ `w-full` 不可省：容器是 `flex flex-col items-center`，flex item 默认按内容宽度收缩，
          而本按钮外面比其它按钮多包了一层 div（承载菜单锚点 ref）—— 少了它，
          这层 div 会缩到图标宽（~14px），内部 `.tool-btn` 的 `width:100%` 只换来 14px，
          悬浮底色便盖不满整条（左图标栏的分组容器同样都显式写了 w-full）。 */}
      <div className="relative w-full" ref={themeMenuRef}>
        <button
          onClick={() => setThemeMenuOpen(v => !v)}
          title={ti('theme.label').replace('{theme}', themeLabel(theme, ti))}
          className="tool-btn"
          style={{ height: 30, color: 'var(--color-activity-icon)', anchorName: '--menu-theme' } as React.CSSProperties}
        >
          <ThemeIcon size={14} strokeWidth={1.5} />
        </button>
        {themeMenuOpen && (
          /* 按钮在图标栏底部：向下展开会超出窗口底部 58px 被切 → 一律向上展开 */
          <PopoverSurface
            anchorName="--menu-theme"
            className="overflow-hidden py-1"
            style={{ minWidth: 128 }}
          >
            {THEME_ORDER.map(id => {
              const Icon = THEME_ICONS[id]
              return (
                <MenuItem
                  key={id}
                  icon={<Icon size={12} />}
                  label={themeLabel(id, ti)}
                  selected={theme === id}
                  onClick={(e) => { applyThemeWithTransition(id, e); setThemeMenuOpen(false) }}
                />
              )
            })}
          </PopoverSurface>
        )}
      </div>
    </div>
  )
}
