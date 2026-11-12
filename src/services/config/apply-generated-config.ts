import { NovelConfigRequestCancelled, type ConfigGenerationSnapshot } from '../../core'
import type { NovelConfig } from '../../shared/ipc-channels'
import { t } from '../../shared/locale'
import { confirm } from '../../components/ui/Confirm'
import { toast } from '../../components/ui/Toast'
import { renderLog } from '../render-logger'
import type { createRendererNovelConfigApplication } from './novel-config-adapter'
import { ProjectConfigResultUnknown } from './project-config-save'

type Application = ReturnType<typeof createRendererNovelConfigApplication>

/** Renderer feedback for neutral compare/apply/undo results; no independent config mirror. */
export async function applyGeneratedNovelConfig(
  application: Application,
  snapshot: ConfigGenerationSnapshot<NovelConfig>,
  generated: Partial<NovelConfig>,
  options: { label?: string; cancelled?: () => boolean; onApplied?: () => void } = {},
): Promise<'applied' | 'pending' | 'cancelled'> {
  const patch = { ...generated }
  let resolved = false
  let applying = false
  const current = () => {
    try { application.assertCurrent(); return !options.cancelled?.() }
    catch (error) { if (error instanceof NovelConfigRequestCancelled) return false; throw error }
  }
  const failure = (error: unknown, retryUndo?: () => Promise<void>) => {
    if (error instanceof ProjectConfigResultUnknown) {
      renderLog('warn', 'Save:Config', error.message)
      toast.warning(error.message)
      return
    }
    renderLog('error', 'Save:Config', t('log.render.configSaveFailed').replace('{error}', () => String(error)))
    const message = t('save.failed').replace('{error}', () => String(error))
    if (retryUndo) toast.show({ type: 'error', message, actions: [{ label: t('action.undoShort'), onClick: retryUndo }] })
    else toast.error(message)
  }
  const apply = async (expected: ConfigGenerationSnapshot<NovelConfig>): Promise<boolean> => {
    if (!current() || resolved) return false
    const result = application.applyGenerated(patch, expected)
    if (result.status === 'conflict') return false
    resolved = true
    const started = Date.now()
    try { await application.save(patch) }
    catch (error) {
      if (error instanceof NovelConfigRequestCancelled) throw error
      if (current()) failure(error)
      throw error
    }
    if (!current()) return true
    renderLog('info', 'Save:Config', t('log.render.configSaveSuccess').replace('{ms}', String(Date.now() - started)))
    try { options.onApplied?.() }
    catch (error) { renderLog('error', 'Apply:Config', String(error)) }
    if (!current()) return true
    let undoing = false
    const undo = async () => {
      if (undoing || !current()) return
      undoing = true
      try {
        if (!await application.undo(result.undo)) { if (current()) toast.warning(t('novelConfig.undoConflict')); return }
        if (current()) toast.success(options.label ? t('field.aiReverted').replace('{label}', options.label) : t('novelConfig.aiReverted'))
      } catch (error) {
        if (!(error instanceof NovelConfigRequestCancelled) && current()) failure(error, undo)
      } finally { undoing = false }
    }
    toast.show({
      type: 'ai',
      message: options.label ? t('field.aiApplied').replace('{label}', options.label) : t('novelConfig.aiApplied'),
      actions: [{ label: t('action.undoShort'), onClick: undo }],
    })
    return true
  }
  const offer = () => {
    if (!current() || resolved) return
    toast.show({ type: 'warning', message: t('novelConfig.generationConflict'), duration: 0,
      actions: [{ label: t('action.apply'), onClick: async () => {
        if (applying || resolved) return
        applying = true
        try {
          if (!current()) return
          const expected = application.snapshot()
          const accepted = await confirm(t('novelConfig.applyConflictConfirm'), { title: t('field.overwriteTitle') })
          if (!current()) return
          if (!accepted || !await apply(expected)) offer()
        } catch (error) {
          // apply already reports persistence errors; stale callbacks publish nothing.
          if (!(error instanceof NovelConfigRequestCancelled) && !resolved && current()) failure(error)
        } finally { applying = false }
      } }],
    })
  }
  try {
    if (!current()) return 'cancelled'
    if (await apply(snapshot)) return 'applied'
    if (!current()) return 'cancelled'
    offer(); return 'pending'
  } catch (error) {
    if (error instanceof NovelConfigRequestCancelled) return 'cancelled'
    throw error
  }
}
