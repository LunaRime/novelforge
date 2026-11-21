import { AlertTriangle, CheckCircle2, ChevronRight, Circle, Copy } from 'lucide-react'
import type { ArchitectureStep } from '../../core'
import { useTranslation } from '../../hooks/useTranslation'
import { renderIcon } from '../panels/sidebar/SidebarShared'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'

export interface ArchitectureDocumentItem {
  key: ArchitectureStep
  label: string
  iconName: string
  description: string
  generated: boolean
  wordCount: number
  extractionFailed: boolean
  canExtract: boolean
}

export default function ArchitectureDocumentList({ documents, loading, extracting, onOpen, onCopy, onExtract }: {
  documents: ArchitectureDocumentItem[]
  loading: boolean
  extracting: boolean
  onOpen: (key: ArchitectureStep, label: string) => void
  onCopy: (key: ArchitectureStep) => void
  onExtract: () => void
}) {
  const { t } = useTranslation()
  return (
    <ul className="space-y-2" aria-label={t('arch.document')} aria-busy={loading}>
      {documents.map(doc => {
        const StatusIcon = doc.extractionFailed ? AlertTriangle : doc.generated ? CheckCircle2 : Circle
        const statusColor = doc.extractionFailed ? 'var(--color-error)' : doc.generated ? 'var(--color-success)' : 'var(--color-text-muted)'
        return (
          <li key={doc.key}
            className="flex flex-wrap items-center gap-1 rounded-lg border bg-[var(--color-panel)] p-1"
            style={{ borderColor: doc.extractionFailed ? statusColor : 'var(--color-border)', opacity: loading ? 0.6 : 1 }}>
            <button type="button" aria-label={doc.label} data-tooltip={doc.description} onClick={() => onOpen(doc.key, doc.label)}
              className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-[var(--color-hover)]">
              <span className="shrink-0 text-[var(--color-text-secondary)]" aria-hidden="true"
                data-tooltip={doc.description} data-tooltip-side="right">
                {renderIcon(doc.iconName, 16)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-[var(--color-text)]">{doc.label}</span>
                <span className="block text-xs text-[var(--color-text-muted)]">{doc.description}</span>
                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-micro">
                  <span className="inline-flex items-center gap-1" style={{ color: statusColor }}>
                    <StatusIcon size={12} aria-hidden="true" />
                    {t(doc.extractionFailed ? 'status.failed' : doc.generated ? 'status.generated' : 'status.pendingGen')}
                  </span>
                  {doc.generated && <span className="text-[var(--color-text-muted)]">{doc.wordCount.toLocaleString()} {t('unit.characters')}</span>}
                </span>
              </span>
              <ChevronRight size={14} className="shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
            </button>
            <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0"
              title={t('action.copyPath')} aria-label={`${t('action.copyPath')} ${doc.label}`} onClick={() => onCopy(doc.key)}>
              <Copy size={13} aria-hidden="true" />
            </Button>
            {doc.canExtract && (
              <Button type="button" variant="outline" size="sm" className="mr-1" disabled={extracting}
                title={t('arch.charArchiveEmptyRetry')} onClick={onExtract}>
                {extracting ? <Spinner size={12} /> : <AlertTriangle size={12} aria-hidden="true" />}
                {t(extracting ? 'arch.charExtracting' : 'arch.charExtractBtn')}
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
