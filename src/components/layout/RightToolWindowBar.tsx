import { Bot, Sparkles } from 'lucide-react'
import { useLayoutStore, type BottomTab } from '../../stores/layout-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { t } from '../../shared/locale'

/**
 * 右侧工具窗口栏（RightToolWindowBar）
 * JetBrains 风格：30px 宽，纯图标，激活时右侧 2px 竖线
 * 控制底部面板的 Agent 对话 / AI 输出两个 Tab（2026-08-03 起面板位于底部）
 */
export default function RightToolWindowBar() {
  const bottomPanelOpen = useLayoutStore(s => s.bottomPanelOpen)
  const bottomTab = useLayoutStore(s => s.bottomTab)
  const toggleBottomPanel = useLayoutStore(s => s.toggleBottomPanel)
  const openBottomTab = useLayoutStore(s => s.openBottomTab)
  const currentRun = useWorkflowStore((s) => s.currentRun)

  /** 工作流活跃时给 AI 输出按钮显示脉冲 */
  const showPulse = currentRun && (currentRun.status === 'running' || currentRun.status === 'waiting')

  /** 点击按钮逻辑（映射到底部面板 Tab）：
   *  - 如果底部面板关闭 → 打开并切到对应 Tab
   *  - 如果已打开且已是此 Tab → 关闭面板
   *  - 如果已打开但是另一个 Tab → 切到此 Tab
   */
  const handleClick = (tab: BottomTab) => {
    if (!bottomPanelOpen) {
      openBottomTab(tab)
    } else if (bottomTab === tab) {
      toggleBottomPanel()
    } else {
      openBottomTab(tab)
    }
  }

  const isAgentActive = bottomPanelOpen && bottomTab === 'agent'
  const isOutputActive = bottomPanelOpen && bottomTab === 'ai-output'

  return (
    <div
      className="no-select flex flex-col items-center justify-start h-full py-0.5 gap-0.5"
      style={{
        width: 'var(--width-right-bar)',  /* 30px */
        backgroundColor: 'var(--color-activity-bar)',
        borderLeft: '1px solid var(--color-border)',
        flexShrink: 0,
      }}
    >
      {/* AI Agent 对话按钮 */}
      <button
        onClick={() => handleClick('agent')}
        title={t('agent.aiPanel')}
        className="tool-btn"
        style={{
          height: 30,
          boxShadow: isAgentActive
            ? 'inset -2px 0 0 var(--color-activity-indicator)'
            : 'none',
          color: isAgentActive
            ? 'var(--color-activity-icon-active)'
            : 'var(--color-activity-icon)',
        }}
      >
        <Bot size={15} strokeWidth={isAgentActive ? 2 : 1.5} />
      </button>

      {/* AI 输出按钮 */}
      <button
        onClick={() => handleClick('ai-output')}
        title={t('agent.aiOutput')}
        className="tool-btn relative"
        style={{
          height: 30,
          boxShadow: isOutputActive
            ? 'inset -2px 0 0 var(--color-activity-indicator)'
            : 'none',
          color: isOutputActive
            ? 'var(--color-activity-icon-active)'
            : 'var(--color-activity-icon)',
        }}
      >
        <Sparkles size={15} strokeWidth={isOutputActive ? 2 : 1.5} />
        {/* 工作流活跃时的脉冲指示点 */}
        {showPulse && !isOutputActive && (
          <span
            className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ backgroundColor: 'var(--color-accent)' }}
          />
        )}
      </button>
    </div>
  )
}
