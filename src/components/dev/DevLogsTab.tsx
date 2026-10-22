import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { EmptyState } from '../ui/EmptyState'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Spinner } from '../ui/Spinner'
import { useTranslation } from '../../hooks/useTranslation'
import { ipc } from '../../services/ipc-client'
import type { LogEnvMode, LogFileInfo } from '../../shared/ipc-channels'

type LevelFilter = 'all' | 'info' | 'warn' | 'error'

export default function DevLogsTab({ active }: { active: boolean }) {
  const { t } = useTranslation()
  const [env, setEnv] = useState<LogEnvMode>('release')
  const [files, setFiles] = useState<Record<LogEnvMode, LogFileInfo[]>>({ dev: [], release: [] })
  const [selected, setSelected] = useState('')
  const [content, setContent] = useState('')
  const [level, setLevel] = useState<LevelFilter>('all')
  const [search, setSearch] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadFiles = useCallback(async () => {
    try {
      const groups = await ipc.invoke('log:list-files')
      const next: Record<LogEnvMode, LogFileInfo[]> = { dev: [], release: [] }
      for (const group of groups) next[group.env] = group.files
      const preferred: LogEnvMode = next.dev.length > 0 ? 'dev' : 'release'
      setFiles(next)
      setEnv(preferred)
      setSelected((prev) => {
        const current = next[preferred] ?? []
        return current.some((f) => f.name === prev) ? prev : (current[0]?.name ?? '')
      })
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadContent = useCallback(async () => {
    if (!selected) { setContent(''); return }
    try {
      const res = await ipc.invoke('log:read-file', env, selected, 1000)
      if (res.success) {
        setContent(res.content ?? '')
        setError('')
      } else {
        setError(res.error ?? '')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [env, selected])

  useEffect(() => {
    if (!active) return
    const kickoff = setTimeout(() => { void loadFiles() }, 0)
    return () => clearTimeout(kickoff)
  }, [active, loadFiles])

  useEffect(() => {
    if (!active || !selected) return
    const kickoff = setTimeout(() => { void loadContent() }, 0)
    const timer = autoRefresh ? setInterval(() => { void loadContent() }, 2000) : null
    return () => {
      clearTimeout(kickoff)
      if (timer) clearInterval(timer)
    }
  }, [active, selected, loadContent, autoRefresh])

  const lines = useMemo(() => {
    const all = content.split(/\r?\n/)
    const filtered = all.filter((line) => {
      if (level !== 'all') {
        const match = line.match(/\[(DEBUG|INFO|WARN|ERROR)\s*\]/i)
        if (!match || match[1].toLowerCase() !== level) return false
      }
      if (search && !line.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
    return filtered.slice(-500)
  }, [content, level, search])

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2 px-6 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <SegmentedControl
          size="sm"
          value={env}
          onChange={(next) => {
            setEnv(next)
            setSelected(files[next][0]?.name ?? '')
          }}
          items={[
            { value: 'dev', label: t('dev.logEnvDev') },
            { value: 'release', label: t('dev.logEnvRelease') },
          ]}
        />
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="h-7 min-w-[220px] rounded-md border px-2 text-xs"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-panel)', color: 'var(--color-text)' }}
        >
          {(files[env] ?? []).map((file) => (
            <option key={file.name} value={file.name}>{file.name}</option>
          ))}
        </select>
        <SegmentedControl
          size="sm"
          value={level}
          onChange={setLevel}
          items={[
            { value: 'all', label: t('log.filterAll') },
            { value: 'info', label: t('log.filterInfo') },
            { value: 'warn', label: t('log.filterWarn') },
            { value: 'error', label: t('log.filterError') },
          ]}
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('dev.logSearchPlaceholder')}
          className="h-7 w-48 text-xs"
        />
        <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--color-accent)]" />
          {t('dev.logAutoRefresh')}
        </label>
        <Button variant="ghost" size="icon" onClick={() => void loadContent()} title={t('action.refresh')} aria-label={t('action.refresh')}>
          <RefreshCw size={13} />
        </Button>
      </div>

      {error && (
        <div className="mx-6 mt-3 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 8%, transparent)', color: 'var(--color-error)' }}>
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-6 py-3">
        {loading ? (
          <div className="flex h-full items-center justify-center"><Spinner size={18} /></div>
        ) : !selected ? (
          <EmptyState message={t('dev.logEmpty')} />
        ) : lines.length === 0 ? (
          <EmptyState message={t('dev.logEmpty')} />
        ) : (
          <pre className="whitespace-pre-wrap break-all font-mono text-micro leading-5" style={{ color: 'var(--color-text-secondary)' }}>
            {lines.join('\n')}
          </pre>
        )}
      </div>
    </div>
  )
}