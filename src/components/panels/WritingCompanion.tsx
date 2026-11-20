import { Bot, ScrollText, X } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import { useLayoutStore, type RightView } from '../../stores/layout-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { Button } from '../ui/Button'
import AIPanel from './AIPanel'
import AIOutputPanel from './AIOutputPanel'

export default function WritingCompanion() {
  const { t } = useTranslation()
  const view = useLayoutStore(state => state.rightView)
  const setView = useLayoutStore(state => state.setRightView)
  // 只读取输出的活跃状态，流式正文更新无需重绘面板导航。
  const outputActive = useWorkflowStore(state => state.currentRun?.status === 'running' || state.currentRun?.status === 'waiting')
  const views = [
    ['agent', Bot, t('agent.aiPanel'), t('workbench.chat')],
    ['ai-output', ScrollText, t('agent.aiOutput'), t('workbench.output')],
  ] as const satisfies ReadonlyArray<readonly [RightView, typeof Bot, string, string]>

  return (
    <div className="nf-companion">
      {/* 两个视图共用同一组持续挂载的切换按钮，切换内容时保留键盘焦点。 */}
      <div className="nf-workbench-view-header">
        <div className="nf-workbench-view-list" role="group" aria-label={t('panel.ai')}>
          {views.map(([id, Icon, label, shortLabel]) => (
            <Button key={id} type="button" variant="ghost" className="nf-workbench-view"
              active={id === view} aria-pressed={id === view} aria-label={label} title={label}
              badge={id === 'ai-output' && outputActive && view !== id ? 1 : undefined} onClick={() => setView(id)}>
              <Icon size={15} aria-hidden="true" />
              <span className="truncate">{shortLabel}</span>
            </Button>
          ))}
        </div>
        <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0"
          aria-label={t('tip.closePanel')} title={t('tip.closePanel')}
          onClick={() => {
            useLayoutStore.getState().setAIPanelOpen(false)
            document.querySelector<HTMLButtonElement>('[data-workbench-toggle="companion"]')?.focus()
          }}>
          <X size={15} aria-hidden="true" />
        </Button>
      </div>
      <div className="flex-1 min-h-0">
        {view === 'agent' ? <AIPanel /> : <AIOutputPanel />}
      </div>
    </div>
  )
}
