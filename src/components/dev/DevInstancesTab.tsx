import { useCallback, useEffect, useState } from 'react'
import { Copy, Play, RefreshCw, Square, Trash2 } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { EmptyState } from '../ui/EmptyState'
import { Spinner } from '../ui/Spinner'
import { confirm } from '../ui/Confirm'
import { toast } from '../ui/Toast'
import { useTranslation } from '../../hooks/useTranslation'
import { ipc } from '../../services/ipc-client'
import type { DevInstanceInfo } from '../../shared/ipc-channels'

export default function DevInstancesTab({ active }: { active: boolean }) {
  const { t } = useTranslation()
  const [instances, setInstances] = useState<DevInstanceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [project, setProject] = useState('')
  const [port, setPort] = useState('')
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const list = await ipc.invoke('dev:instance-list')
      setInstances(list)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!active) return
    const kickoff = setTimeout(() => { void load() }, 0)
    const timer = setInterval(() => { void load() }, 5000)
    return () => { clearTimeout(kickoff); clearInterval(timer) }
  }, [active, load])

  const start = async () => {
    setStarting(true)
    setError('')
    try {
      const res = await ipc.invoke('dev:instance-start', {
        project: project.trim() || undefined,
        port: port ? Number(port) : undefined,
      })
      if (!res.success) throw new Error(res.error || 'start failed')
      toast.success(t('dev.instanceStarted'))
      setProject('')
      setPort('')
      await load()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      toast.error(t('dev.instanceFailed').replace('{error}', msg))
    } finally {
      setStarting(false)
    }
  }

  const stop = async (id: string) => {
    try {
      const res = await ipc.invoke('dev:instance-stop', id)
      if (!res.success) throw new Error(res.error || 'stop failed')
      toast.success(t('dev.instanceStopped'))
      await load()
    } catch (e) {
      toast.error(t('dev.instanceFailed').replace('{error}', e instanceof Error ? e.message : String(e)))
    }
  }

  const clean = async (id: string) => {
    const ok = await confirm(t('dev.instanceCleanConfirm'), {
      title: t('dev.instanceClean'),
      confirmText: t('dev.instanceClean'),
      danger: true,
    })
    if (!ok) return
    try {
      const res = await ipc.invoke('dev:instance-clean', id)
      if (!res.success) throw new Error(res.error || 'clean failed')
      toast.success(t('dev.instanceCleaned'))
      await load()
    } catch (e) {
      toast.error(t('dev.instanceFailed').replace('{error}', e instanceof Error ? e.message : String(e)))
    }
  }

  const copyCommand = async (instance: DevInstanceInfo) => {
    const command = `node scripts/dev-instance.mjs start --project "${instance.project}" --port ${instance.port}`
    try {
      await navigator.clipboard.writeText(command)
      setCopiedId(instance.id)
      setTimeout(() => setCopiedId(null), 1500)
    } catch {
      setError(command)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-shrink-0 flex-wrap items-end gap-2 px-6 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="min-w-[220px] flex-1">
          <label className="mb-1 block text-micro" style={{ color: 'var(--color-text-muted)' }}>{t('dev.instanceProject')}</label>
          <Input
            value={project}
            onChange={(e) => setProject(e.target.value)}
            placeholder={t('dev.instanceProjectPlaceholder')}
            className="h-7 text-xs"
          />
        </div>
        <div className="w-32">
          <label className="mb-1 block text-micro" style={{ color: 'var(--color-text-muted)' }}>{t('dev.instancePort')}</label>
          <Input
            type="number"
            min={1024}
            max={65535}
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder={t('dev.instancePortPlaceholder')}
            className="h-7 text-xs"
          />
        </div>
        <Button variant="default" size="sm" onClick={() => void start()} disabled={starting}>
          {starting ? <Spinner size={12} /> : <Play size={12} />}
          {starting ? t('dev.instanceStarting') : t('dev.instanceStartAction')}
        </Button>
        <Button variant="ghost" size="icon" onClick={() => void load()} title={t('action.refresh')} aria-label={t('action.refresh')}>
          <RefreshCw size={13} />
        </Button>
      </div>

      {error && (
        <div className="mx-6 mt-3 flex-shrink-0 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 8%, transparent)', color: 'var(--color-error)' }}>
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">
        {loading ? (
          <div className="flex h-full items-center justify-center"><Spinner size={18} /></div>
        ) : instances.length === 0 ? (
          <EmptyState message={t('dev.instanceEmpty')} />
        ) : (
          <div className="space-y-2">
            {instances.map((instance) => (
              <div
                key={instance.id}
                className="rounded-xl p-3"
                style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}
              >
                <div className="flex items-start gap-2">
                  <span
                    className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: instance.alive ? 'var(--color-success)' : 'var(--color-text-muted)' }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs" style={{ color: 'var(--color-text)' }}>{instance.id}</span>
                      <span className="text-micro" style={{ color: instance.alive ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                        {instance.alive ? t('dev.instanceRunning') : t('dev.instanceOffline')}
                      </span>
                    </div>
                    <div className="mt-1 grid gap-x-4 gap-y-0.5 text-micro md:grid-cols-2" style={{ color: 'var(--color-text-muted)' }}>
                      <span>{t('dev.instanceProjectLabel')}: {instance.project}</span>
                      <span>{t('dev.instancePortLabel')}: {instance.port} · {t('dev.instancePidLabel')}: {instance.pid}</span>
                      <span className="truncate md:col-span-2">log: {instance.log}</span>
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => void copyCommand(instance)} title={t('dev.instanceCopy')}>
                      <Copy size={12} />
                      {copiedId === instance.id ? t('dev.instanceCopied') : undefined}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void stop(instance.id)} disabled={!instance.alive}>
                      <Square size={12} />
                      {t('dev.instanceStop')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void clean(instance.id)}>
                      <Trash2 size={12} />
                      {t('dev.instanceClean')}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}