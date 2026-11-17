import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '../../hooks/useTranslation'
import { askFileProjectAgent } from '../../services/agent-adapters/file-project-agent'
import { renderLog } from '../../services/render-logger'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'

export function FileProjectAgent({ token, locator, disabled }: { token: string; locator?: string; disabled: boolean }) {
  const { t } = useTranslation()
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [status, setStatus] = useState<'running' | 'failed' | 'cancelled'>()
  const current = useRef<AbortController | undefined>(undefined)

  function cancel() {
    const run = current.current
    current.current = undefined
    run?.abort()
    setStatus('cancelled')
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
    setAnswer('')
    setStatus('running')
    try {
      const result = await askFileProjectAgent(token, locator, message, run.signal)
      if (current.current !== run) return
      setAnswer(result)
      setStatus(undefined)
    } catch (error) {
      if (current.current !== run) return
      renderLog('error', 'FileProjectAgent', String(error))
      setStatus('failed')
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
          <Input aria-label={t('project.fileEditorAgentQuestion')} value={question} readOnly={status === 'running'} onChange={event => setQuestion(event.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={disabled || status === 'running' || !question.trim()}>{t('project.fileEditorAgentAsk')}</Button>
          {status === 'running' && <Button type="button" variant="outline" onClick={cancel}>{t('action.cancel')}</Button>}
        </div>
        {status === 'running' && <p role="status">{t('project.fileEditorAgentRunning')}</p>}
        {status === 'cancelled' && <p role="status">{t('project.fileEditorAgentCancelled')}</p>}
        {status === 'failed' && <p role="alert">{t('project.fileEditorAgentFailed')}</p>}
      </form>
      {answer && <p className="whitespace-pre-wrap break-words">{answer}</p>}
    </details>
  )
}
