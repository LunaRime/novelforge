import { useEffect, useState } from 'react'
import { Terminal } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '../ui/Dialog'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Spinner } from '../ui/Spinner'
import { EmptyState } from '../ui/EmptyState'
import { useTranslation } from '../../hooks/useTranslation'
import { ipc } from '../../services/ipc-client'
import type { TextKey } from '../../shared/locale'
import type { DevConsoleStatus } from '../../shared/ipc-channels'
import DevInstancesTab from './DevInstancesTab'
import DevIpcTab from './DevIpcTab'
import DevDatabaseTab from './DevDatabaseTab'
import DevLogsTab from './DevLogsTab'
import DevPerformanceTab from './DevPerformanceTab'
import DevAgentTab from './DevAgentTab'
import DevModelsTab from './DevModelsTab'

type DevTab = 'instances' | 'ipc' | 'agent' | 'models' | 'database' | 'logs' | 'performance'

const TABS: Array<{ value: DevTab; key: TextKey }> = [
  { value: 'instances', key: 'dev.consoleTabInstances' },
  { value: 'ipc', key: 'dev.consoleTabIpc' },
  { value: 'agent', key: 'dev.consoleTabAgent' },
  { value: 'models', key: 'dev.consoleTabModels' },
  { value: 'database', key: 'dev.consoleTabDatabase' },
  { value: 'logs', key: 'dev.consoleTabLogs' },
  { value: 'performance', key: 'dev.consoleTabPerformance' },
]

export default function DevConsoleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<DevConsoleStatus | null>(null)
  const [tab, setTab] = useState<DevTab>('instances')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ipc.invoke('dev:console-status')
      .then((next) => {
        if (cancelled) return
        setStatus(next)
        if (next.enabled) void ipc.invoke('dev:ipc-set-enabled', true).catch(() => {})
      })
      .catch((error) => {
        if (!cancelled) setStatus({ enabled: false, reason: String(error) })
      })
    return () => { cancelled = true }
  }, [open])

  const close = () => {
    void ipc.invoke('dev:ipc-set-enabled', false).catch(() => {})
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close() }}>
      <DialogContent className="w-[92vw] max-w-[1100px] h-[82vh] p-0 flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0 pr-12">
          <DialogTitle className="flex items-center gap-2">
            <Terminal size={16} style={{ color: 'var(--color-accent)' }} />
            {t('dev.consoleTitle')}
          </DialogTitle>
          <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('dev.consoleSubtitle')}
          </p>
        </DialogHeader>

        {status?.enabled && (
          <div
            className="flex flex-shrink-0 items-center gap-3 px-6 py-2.5"
            style={{ borderBottom: '1px solid var(--color-border)' }}
          >
            <SegmentedControl size="sm" value={tab} onChange={setTab} items={TABS.map((x) => ({ value: x.value, label: t(x.key) }))} />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden">
          {!status ? (
            <div className="flex h-full items-center justify-center">
              <Spinner size={18} />
            </div>
          ) : !status.enabled ? (
            <div className="flex h-full items-center justify-center p-6">
              <EmptyState message={status.reason || t('dev.consoleDisabled')} />
            </div>
          ) : (
            <>
              {tab === 'instances' && <DevInstancesTab active />}
              {tab === 'ipc' && <DevIpcTab active />}
              {tab === 'database' && <DevDatabaseTab active />}
              {tab === 'logs' && <DevLogsTab active />}
              {tab === 'performance' && <DevPerformanceTab active />}
              {tab === 'agent' && <DevAgentTab active />}
              {tab === 'models' && <DevModelsTab active />}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}