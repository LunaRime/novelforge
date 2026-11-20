import type { Meta, StoryObj } from '@storybook/react' // eslint-disable-line storybook/no-renderer-packages
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '../components/ui/Button'
import { useTranslation } from '../hooks/useTranslation'
import './v3-partner-tasks.story.css'

const sample = {
  title: '雾港来信',
  original: '她拆开了信封，看见纸上写着自己的名字。',
  replacement: '蜡封在掌心裂开。潮湿的信纸上，只有她自己的名字。',
  partialOutput: '港钟响过两次，信封是在第二次钟声之后才出现的。',
}

const statusText = {
  running: 'status.running',
  cancelling: 'status.cancelling',
  cancelled: 'status.cancelled',
  proposal: 'status.confirming',
  discarded: 'engine.userRejectedAction',
  staging: 'status.saving',
  staged: 'project.fileEditorAgentStaged',
  applying: 'status.saving',
  saved: 'statusbar.saved',
  indexPending: 'project.fileEditorIndexPending',
} as const

type Phase = keyof typeof statusText
type View = 'partner' | 'tasks'

function V3PartnerTasks({ initialPhase = 'proposal', indexPending = false }: {
  initialPhase?: 'proposal' | 'running'
  indexPending?: boolean
}) {
  const { t } = useTranslation()
  const id = useId()
  const status = useRef<HTMLParagraphElement>(null)
  const partnerButton = useRef<HTMLButtonElement>(null)
  const [view, setView] = useState<View | null>(null)
  const [phase, setPhase] = useState<Phase>(initialPhase)
  const body = phase === 'saved' || phase === 'indexPending' ? sample.replacement : sample.original
  const showProposal = phase === 'proposal' || phase === 'staging' || phase === 'staged' || phase === 'applying'

  // 延迟的合成回执由工作台持有，关闭搭档或切到任务时仍能到达。
  useEffect(() => {
    const receipt = phase === 'cancelling' ? 'cancelled'
      : phase === 'staging' ? 'staged'
      : phase === 'applying' ? (indexPending ? 'indexPending' : 'saved')
      : undefined
    if (!receipt) return
    const timer = window.setTimeout(() => setPhase(receipt), 1200)
    return () => window.clearTimeout(timer)
  }, [phase, indexPending])

  function toggle(next: View) {
    setView(current => (current === next ? null : next))
  }

  function respond(next: Phase) {
    // 决定后按钮会消失，把键盘焦点移到始终可见的任务状态。
    status.current?.focus({ preventScroll: true })
    setPhase(next)
  }

  return (
    <main className="v3-partner-sample" data-phase={phase}>
      <header className="v3-partner-header">
        <h1>{sample.title}</h1>
        <div className="v3-partner-actions">
          <Button ref={partnerButton} size="sm" variant="outline" aria-expanded={view === 'partner'} aria-controls={`${id}-partner`}
            onClick={() => toggle('partner')}>{t('panel.writingPartner')}</Button>
          <Button size="sm" variant="outline" aria-expanded={view === 'tasks'} aria-controls={`${id}-tasks`}
            onClick={() => toggle('tasks')}>{t('panel.tasks')}</Button>
        </div>
        <p ref={status} className="v3-partner-status" role="status" tabIndex={-1}>{t(statusText[phase])}</p>
      </header>
      <div className="v3-partner-main" data-open={view !== null}>
        <article className="v3-partner-manuscript" aria-label={t('chapter.title')}>
          <p>{body}</p>
        </article>
        <section id={`${id}-partner`} className="v3-partner-panel" aria-label={t('panel.writingPartner')} hidden={view !== 'partner'}>
          <h2>{t('panel.writingPartner')}</h2>
          {showProposal && <>
            <h3>{t('project.fileEditorAgentPreview')}</h3>
            <dl className="v3-partner-diff">
              <div><dt>{t('project.fileEditorAgentOriginal')}</dt><dd>{sample.original}</dd></div>
              <div><dt>{t('project.fileEditorAgentReplacement')}</dt><dd>{sample.replacement}</dd></div>
            </dl>
          </>}
          {phase === 'proposal' && <div className="v3-partner-actions">
            <Button size="sm" variant="outline" onClick={() => respond('discarded')}>{t('project.fileEditorAgentDiscard')}</Button>
            <Button size="sm" variant="outline" onClick={() => respond('staging')}>{t('project.fileEditorAgentStage')}</Button>
            <Button size="sm" onClick={() => respond('applying')}>{t('project.fileEditorAgentAccept')}</Button>
          </div>}
          {phase === 'running' && <p>{sample.partialOutput}</p>}
        </section>
        <section id={`${id}-tasks`} className="v3-partner-panel" aria-label={t('panel.tasks')} hidden={view !== 'tasks'}>
          <h2>{t('panel.tasks')}</h2>
          <div className="v3-partner-task">
            <p>{t('editor.aiPolishBtn')}</p>
            {phase === 'proposal' && <Button size="sm" variant="outline" onClick={() => {
              // 从任务进入审批时，焦点交给常驻的搭档入口。
              partnerButton.current?.focus({ preventScroll: true })
              setView('partner')
            }}>
              {t('panel.writingPartner')}
            </Button>}
            {(phase === 'running' || phase === 'cancelling') && <Button size="sm" variant="outline" disabled={phase === 'cancelling'}
              onClick={() => respond('cancelling')}>{t('action.stop')}</Button>}
          </div>
        </section>
      </div>
    </main>
  )
}

const meta = {
  title: 'NovelForge Workbench/V3 Partner Tasks',
  component: V3PartnerTasks,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof V3PartnerTasks>

export default meta
type Story = StoryObj<typeof meta>

export const Proposal: Story = {}
export const Cancellation: Story = { args: { initialPhase: 'running' } }
export const SavedIndexPending: Story = { args: { indexPending: true } }
