import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '../../hooks/useTranslation'
import { askFileProjectAgent } from '../../services/agent-adapters/file-project-agent'
import { ipc } from '../../services/ipc-client'
import { renderLog } from '../../services/render-logger'
import type { FileAgentEditProposal } from '../../shared/ipc-channels'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'

export function FileProjectAgent({ token, locator, disabled, editableRevision, onApply, onStage }: {
  token: string; locator?: string; disabled: boolean; editableRevision?: string
  onApply: (proposal: FileAgentEditProposal) => Promise<boolean>
  onStage?: (proposal: FileAgentEditProposal) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [proposal, setProposal] = useState<FileAgentEditProposal>()
  const [status, setStatus] = useState<'running' | 'cancelling' | 'failed' | 'cancelled'>()
  const current = useRef<AbortController | undefined>(undefined)
  const canApply = proposal?.locator === locator && proposal?.revision === editableRevision
  const busy = status === 'running' || status === 'cancelling'

  function discard() {
    if (!proposal) return
    setProposal(undefined)
    void ipc.invoke('project:file-editor-agent-resolve-edit', token, proposal.id, 'discard').catch(error => {
      renderLog('warn', 'FileProjectAgent', String(error))
    })
  }

  async function resolve(action: (proposal: FileAgentEditProposal) => Promise<boolean>) {
    if (!proposal || disabled || !canApply) return
    if (await action(proposal)) setProposal(undefined)
  }

  function cancel() {
    const run = current.current
    if (!run || run.signal.aborted) return
    setStatus('cancelling')
    run.abort()
  }

  // 父编辑器以会话令牌为键，切换项目或关闭编辑器时撤销旧轮次。
  useEffect(() => () => {
    const run = current.current
    current.current = undefined
    run?.abort()
  }, [])

  async function ask() {
    const message = question.trim()
    if (!message || disabled || current.current) return
    const run = new AbortController()
    current.current = run
    discard()
    setAnswer('')
    setStatus('running')
    try {
      const result = await askFileProjectAgent(token, locator, message, run.signal, Boolean(editableRevision))
      if (current.current !== run) return
      run.signal.throwIfAborted()
      setAnswer(result.answer)
      setProposal(result.proposal)
      setStatus(undefined)
    } catch (error) {
      if (current.current !== run) return
      if (run.signal.aborted) setStatus('cancelled')
      else {
        renderLog('error', 'FileProjectAgent', String(error))
        setStatus('failed')
      }
    } finally {
      if (current.current === run) current.current = undefined
    }
  }

  return (
    <details className="text-sm">
      <summary>{t('project.fileEditorAgentTitle')}</summary>
      <form className="flex flex-col gap-2" onSubmit={event => { event.preventDefault(); void ask() }}>
        <label className="flex flex-col gap-1">
          {t('project.fileEditorAgentQuestion')}
          <Input aria-label={t('project.fileEditorAgentQuestion')} value={question} readOnly={busy} onChange={event => setQuestion(event.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={disabled || busy || !question.trim()}>{t('project.fileEditorAgentAsk')}</Button>
          {busy && <Button type="button" variant="outline" aria-disabled={status === 'cancelling'} onClick={cancel}>{t('action.cancel')}</Button>}
        </div>
        {status === 'running' && <p role="status">{t('project.fileEditorAgentRunning')}</p>}
        {status === 'cancelling' && <p role="status">{t('status.cancelling')}</p>}
        {status === 'cancelled' && <p role="status">{t('project.fileEditorAgentCancelled')}</p>}
        {status === 'failed' && <p role="alert">{t('project.fileEditorAgentFailed')}</p>}
      </form>
      {answer && <p className="whitespace-pre-wrap break-words">{answer}</p>}
      {proposal && <section className="mt-2 flex flex-col gap-2" aria-label={t('project.fileEditorAgentPreview')}>
        <h3 className="font-medium">{t('project.fileEditorAgentPreview')}</h3>
        <dl className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 16rem), 1fr))' }}>
          <div><dt>{t('project.fileEditorAgentOriginal')}</dt><dd className="max-h-40 overflow-auto whitespace-pre-wrap break-words">{proposal.original}</dd></div>
          <div><dt>{t('project.fileEditorAgentReplacement')}</dt><dd className="max-h-40 overflow-auto whitespace-pre-wrap break-words">{proposal.replacement || t('project.fileEditorAgentDeletion')}</dd></div>
        </dl>
        {!canApply && <p role="status">{t('project.fileEditorAgentEditStale')}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={disabled || !canApply} onClick={() => void resolve(onApply)}>{t('project.fileEditorAgentAccept')}</Button>
          {onStage && <Button type="button" variant="outline" disabled={disabled || !canApply}
            onClick={() => void resolve(onStage)}>{t('project.fileEditorAgentStage')}</Button>}
          <Button type="button" variant="outline" disabled={disabled} onClick={discard}>{t('project.fileEditorAgentDiscard')}</Button>
        </div>
      </section>}
    </details>
  )
}
