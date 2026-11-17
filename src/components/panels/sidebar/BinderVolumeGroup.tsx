import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BinderChapter, ChapterBlueprintScope } from '../../../core'
import { createRendererBinderApplication } from '../../../services/chapters/binder-adapter'
import { useProjectStore } from '../../../stores/project-store'
import { useVolumeStore } from '../../../stores/volume-store'
import { useTranslation } from '../../../hooks/useTranslation'
import { globalEventBus } from '../../../shared/event-bus'
import { renderLog } from '../../../services/render-logger'
import { Button } from '../../ui/Button'
import { toast } from '../../ui/Toast'
import VolumeGroup, { type VolumeChapter } from './VolumeGroup'
import type { VolumeData } from '../../../../electron/repositories/volume-repository'

interface Props {
  projectPath?: string
  totalChapters?: number
  draftsByChapter: Record<number, Array<{ status: string }>>
  onOpenDraft(chapterNumber: number, chapterTitle?: string): void
}

export default function BinderVolumeGroup(props: Props) {
  const project = useProjectStore(s => s.currentProject)
  const session = useProjectStore(s => s.projectSession)
  if (!project) return null
  return <BinderVolumes key={`${project.id}:${project.path}:${session}`} {...props} source={{ id: project.id, path: project.path, session }} />
}

function BinderVolumes({ source, draftsByChapter, ...props }: Props & { source: ChapterBlueprintScope }) {
  const { t } = useTranslation()
  const [application] = useState(() => createRendererBinderApplication(source))
  const [chapters, setChapters] = useState<BinderChapter[]>([])
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const mounted = useRef(true)
  const lifetime = useRef({ generation: 0 })
  const request = useRef(0)
  const busy = useRef(false)
  const active = useCallback(() => {
    if (!mounted.current) return false
    try { application.assertCurrent(); return true } catch { return false }
  }, [application])
  const reload = useCallback(async () => {
    const version = ++request.current
    try {
      const result = await application.load()
      if (!active() || version !== request.current) return false
      setChapters(result); setReady(true); setFailed(false)
      return true
    } catch (error) {
      if (active() && version === request.current) {
        setFailed(true)
        renderLog('error', 'Refresh:Blueprint', String(error))
      }
      return false
    }
  }, [application, active])
  useEffect(() => {
    mounted.current = true
    const lifecycle = lifetime.current
    const generation = ++lifecycle.generation
    // Initial IO completes asynchronously; no state is published during effect setup.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload()
    const off = globalEventBus.on('REFRESH_RESOURCE', ({ resources }) => {
      if (!busy.current && (resources.includes('all') || resources.includes('drafts') || resources.includes('blueprints'))) void reload()
    })
    return () => {
      mounted.current = false; off()
      queueMicrotask(() => { if (generation === lifecycle.generation) application.dispose() })
    }
  }, [application, reload])

  const index = useMemo(() => {
    const byChapter = new Map(chapters.map(chapter => [chapter.chapterNumber, chapter]))
    const entries = Object.entries(draftsByChapter).map(([key, drafts]) => {
      const number = Number(key)
      return { number, blueprint: byChapter.get(number), hasFinalized: drafts.some(draft => draft.status === 'finalized') }
    }).filter(entry => Number.isSafeInteger(entry.number) && entry.number > 0)
      .sort((a, b) => (a.blueprint?.sortOrder ?? Infinity) - (b.blueprint?.sortOrder ?? Infinity) || a.number - b.number)
    const forVolume = (volume: VolumeData): VolumeChapter[] => entries.filter(entry => entry.blueprint
      ? entry.blueprint.volumeNumber === volume.volumeNumber
      : entry.number >= volume.chapterStart && (volume.chapterEnd === 0 || entry.number <= volume.chapterEnd))
      .map(entry => ({ chapterNumber: entry.number, chapterTitle: entry.blueprint?.title ?? '', hasFinalized: entry.hasFinalized }))
    return { forVolume, finalized: (volume: VolumeData) => forVolume(volume).filter(entry => entry.hasFinalized).length }
  }, [chapters, draftsByChapter])


  const reorder = useCallback(async (chapterNumber: number, toVolumeNumber: number, targetIndex?: number) => {
    if (!active() || busy.current || !ready || failed) return
    busy.current = true; setSaving(true); ++request.current
    const started = Date.now()
    try {
      // VolumeGroup indexes visible draft rows; the transaction indexes every blueprint.
      const targetRows = chapters.filter(chapter => chapter.volumeNumber === toVolumeNumber && chapter.chapterNumber !== chapterNumber)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.chapterNumber - b.chapterNumber)
      const volume = useVolumeStore.getState().volumes.find(item => item.volumeNumber === toVolumeNumber)
      const visibleTargets = volume ? index.forVolume(volume).filter(chapter => chapter.chapterNumber !== chapterNumber)
        : targetRows.filter(chapter => (draftsByChapter[chapter.chapterNumber]?.length ?? 0) > 0)
      const nextVisible = targetIndex === undefined ? undefined : visibleTargets.slice(targetIndex)
        .find(chapter => targetRows.some(target => target.chapterNumber === chapter.chapterNumber))
      const absoluteIndex = targetIndex === undefined ? undefined : nextVisible
        ? targetRows.findIndex(chapter => chapter.chapterNumber === nextVisible.chapterNumber) : targetRows.length
      const receipt = await application.reorder({ chapterNumber, toVolumeNumber, targetIndex: absoluteIndex })
      if (!active()) return
      const loaded = await reload()
      if (!active()) return
      renderLog('info', 'Save:Blueprint', `Binder reorder saved (${Date.now() - started}ms)`)
      toast.success(t('save.success'))
      if (receipt.refreshError || !loaded) {
        renderLog('error', 'Refresh:Blueprint', receipt.refreshError || 'Binder projection refresh failed')
        toast.error(t('common.loadFailed'))
      }
      globalEventBus.emit('REFRESH_RESOURCE', { resources: ['drafts'] })
    } catch (error) {
      if (active()) {
        renderLog('error', 'Save:Blueprint', String(error))
        toast.error(t('save.failed').replace('{error}', String(error)))
      }
    } finally {
      busy.current = false
      if (active()) setSaving(false)
    }
  }, [active, application, ready, failed, reload, t, chapters, draftsByChapter, index])


  return <>
    {failed && <div role="alert" className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-error)' }}>
      <span>{t('common.loadFailed')}</span>
      <Button variant="ghost" size="sm" onClick={() => void reload()} disabled={saving}>{t('action.retry')}</Button>
    </div>}
    <VolumeGroup {...props} chaptersForVolume={index.forVolume} finalizedCountForVolume={index.finalized}
      onReorderChapter={ready && !failed && !saving ? reorder : undefined} />
  </>
}
