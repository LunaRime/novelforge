import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '../../hooks/useTranslation'
import { renderLog } from '../../services/render-logger'
import { generateFileChapterContinuation } from '../../services/workflows/file-chapter-continuation'
import type { FileDraftCommand } from '../../shared/ipc-channels'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'

export type ContinuationCommand = Extract<FileDraftCommand, { kind: 'create' }>

export function FileChapterContinuation({ token, number, source, disabled, onPublish }: {
  token: string; number: number; source: NonNullable<ContinuationCommand['source']>; disabled: boolean
  onPublish: (command: ContinuationCommand) => Promise<void>
}) {
  const { t } = useTranslation()
  const [title, setTitle] = useState('')
  const [guidance, setGuidance] = useState('')
  const [proposal, setProposal] = useState<ContinuationCommand>()
  const [status, setStatus] = useState<'running' | 'failed'>()
  const current = useRef<AbortController | undefined>(undefined)

  function abort() {
    const run = current.current
    current.current = undefined
    run?.abort()
  }

  // 父编辑器按项目、章节及正文版本挂载，切换来源时取消正在生成的预览。
  useEffect(() => () => {
    const run = current.current
    current.current = undefined
    run?.abort()
  }, [])

  async function generate() {
    const chapterTitle = title.trim()
    if (disabled || proposal || current.current || !chapterTitle) return
    const run = new AbortController()
    current.current = run
    setStatus('running')
    try {
      const { content, contextRevision } = await generateFileChapterContinuation({ token, source, number, title: chapterTitle, guidance: guidance.trim() }, run.signal)
      if (current.current !== run) return
      // 创建请求保持稳定，预览仅保存在界面内，确认时才发送写入命令。
      setProposal({ kind: 'create', chapterId: `ch_${crypto.randomUUID().replaceAll('-', '')}`,
        number, title: chapterTitle, content, createdAt: new Date().toISOString(), source: { ...source, contextRevision } })
      setStatus(undefined)
    } catch (error) {
      if (current.current !== run) return
      renderLog('error', 'FileChapterContinuation', String(error))
      setStatus('failed')
    } finally { if (current.current === run) current.current = undefined }
  }

  return (
    <details className="text-sm">
      <summary>{t('project.fileEditorContinuation').replace('{number}', String(number))}</summary>
      <form className="flex flex-col gap-2" onSubmit={event => { event.preventDefault(); void generate() }}>
        <label className="flex flex-col gap-1">
          {t('project.fileEditorContinuationTitle')}
          <Input aria-label={t('project.fileEditorContinuationTitle')} value={title} maxLength={200}
            readOnly={status === 'running' || Boolean(proposal)} onChange={event => setTitle(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          {t('project.fileEditorContinuationGuidance')}
          <Textarea value={guidance} maxLength={4000} readOnly={status === 'running' || Boolean(proposal)}
            onChange={event => setGuidance(event.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          {!proposal && <Button type="submit" disabled={disabled || status === 'running' || !title.trim()}>{t('project.fileEditorContinuationGenerate')}</Button>}
          {status === 'running' && <Button type="button" variant="outline" onClick={() => { abort(); setStatus(undefined) }}>{t('action.cancel')}</Button>}
        </div>
        {status === 'running' && <p role="status">{t('status.loading')}</p>}
        {status === 'failed' && <p role="alert">{t('project.fileEditorContinuationFailed')}</p>}
      </form>
      {proposal && <section className="mt-2 flex flex-col gap-2" aria-label={t('project.fileEditorContinuationPreview')}>
        <h3 className="font-medium">{t('project.fileEditorContinuationPreview')}</h3>
        <p className="max-h-60 overflow-auto whitespace-pre-wrap break-words">{proposal.content}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={disabled} onClick={() => void onPublish(proposal)}>{t('project.fileEditorContinuationPublish')}</Button>
          <Button type="button" variant="outline" disabled={disabled} onClick={() => setProposal(undefined)}>{t('project.fileEditorAgentDiscard')}</Button>
        </div>
      </section>}
    </details>
  )
}
