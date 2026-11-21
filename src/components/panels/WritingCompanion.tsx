import { MessageSquare, ScrollText, Sparkles, X } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import { useLayoutStore, type RightView } from '../../stores/layout-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { Button } from '../ui/Button'
import AIPanel from './AIPanel'
import AIOutputPanel from './AIOutputPanel'
import './runtime-panels.css'

export default function WritingCompanion() {
  const { t } = useTranslation()
  const view = useLayoutStore(state => state.rightView)
  const setView = useLayoutStore(state => state.setRightView)
  // 只读取输出的活跃状态，流式正文更新无需重绘面板导航。
  const outputActive = useWorkflowStore(state => state.activeRuns.some(run =>
    (run.status === 'running' || run.status === 'waiting') && (state.isRunCurrent?.(run.id) ?? true)))
  const views = [
    ['agent', MessageSquare, t('agent.aiPanel'), t('agent.conversationShort')],
    ['ai-output', ScrollText, t('agent.aiOutput'), t('workbench.output')],
  ] as const satisfies ReadonlyArray<readonly [RightView, typeof MessageSquare, string, string]>

  return (
    <section className="nf-companion" aria-label={t('panel.writingPartner')}>
      <header className="nf-companion-heading">
        <span className="nf-companion-mark"><Sparkles size={16} aria-hidden="true" /></span>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold" title={t('panel.writingPartner')}>{t('panel.writingPartner')}</h2>
        <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0"
          aria-label={t('tip.closePanel')} title={t('tip.closePanel')}
          onClick={() => {
            useLayoutStore.getState().setAIPanelOpen(false)
            document.querySelector<HTMLButtonElement>('[data-workbench-toggle="companion"]')?.focus()
          }}>
          <X size={15} aria-hidden="true" />
        </Button>
      </header>
      {/* 视图开关保持挂载，关闭后仍可通过运行身份召回对话和输出。 */}
      <div className="nf-workbench-view-header nf-companion-views">
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
      </div>
      <div className="flex-1 min-h-0">
        {view === 'agent' ? <AIPanel /> : <AIOutputPanel />}
      </div>
    </section>
  )
}
