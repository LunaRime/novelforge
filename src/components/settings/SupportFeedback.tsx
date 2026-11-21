import { useState } from 'react'
import { ExternalLink, FileArchive, MessageSquareText } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import { ipc } from '../../services/ipc-client'
import type { LogChannels } from '../../shared/ipc-channels'
import { Button } from '../ui/Button'
import { SemanticLabel } from '../ui/SemanticLabel'
import { Spinner } from '../ui/Spinner'

/** 导出附件与打开议题是独立动作，由用户检查本地文件后选择是否附上。 */
export default function SupportFeedback() {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<LogChannels['log:export-feedback']['return']>()
  const [issueFailed, setIssueFailed] = useState(false)

  const save = async () => {
    if (busy) return
    setResult(undefined)
    setBusy(true)
    try {
      setResult(await ipc.invoke('log:export-feedback'))
    } catch {
      setResult({ status: 'failed' })
    } finally {
      setBusy(false)
    }
  }

  const openIssues = async () => {
    setIssueFailed(false)
    try {
      const response = await ipc.invoke('log:open-issues')
      if (!response.success) setIssueFailed(true)
    } catch {
      setIssueFailed(true)
    }
  }

  return (
    <section className="nf-settings-panel flex flex-col gap-3">
      <header className="flex items-start gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-[var(--color-editor-bg)] text-[var(--color-accent)]">
          <MessageSquareText size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">{t('support.feedback')}</h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">{t('support.feedbackDescription')}</p>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={() => void save()} disabled={busy || !ipc.isElectron}>
          {busy ? <Spinner size={14} /> : <FileArchive size={15} aria-hidden="true" />}
          {t(busy ? 'support.feedbackCollecting' : 'support.feedbackExport')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => void openIssues()} disabled={!ipc.isElectron}>
          <ExternalLink size={14} aria-hidden="true" />{t('support.openIssues')}
        </Button>
      </div>
      {result?.status === 'saved' && (
        <div role="status" className="min-w-0 rounded-md bg-[var(--color-editor-bg)] px-3 py-2 text-xs text-[var(--color-success)]">
          <SemanticLabel name="success">{t('support.feedbackSaved').replace('{count}', String(result.count))}</SemanticLabel>
          <p className="mt-1 break-all text-[var(--color-text-secondary)]">{result.path}</p>
        </div>
      )}
      {result?.status === 'empty' && <p role="status" className="text-xs text-[var(--color-text-muted)]">{t('support.feedbackEmpty')}</p>}
      {result?.status === 'failed' && <p role="alert" className="text-xs text-[var(--color-error)]">{t('support.feedbackFailed')}</p>}
      {issueFailed && <p role="alert" className="text-xs text-[var(--color-error)]">{t('support.openIssuesFailed')}</p>}
    </section>
  )
}
