/**
 * SceneList — 章节下的场景卡列表（侧栏「卷 → 章 → 场景」第三层）
 *
 * 交互：
 * - 拖拽行改顺序（dataTransfer 类型 application/x-novelforge-scene）
 * - Alt+↑/↓ 键盘改顺序（与拖拽等价，均走 db:scene-reorder）
 * - 编辑/删除单行；底部「添加场景」
 *
 * 数据：db:scene-list / scene-upsert / scene-delete / scene-reorder。
 * 顺序写库失败时回滚到服务端真实顺序，不做「假成功」。
 */
import { useCallback, useEffect, useState } from 'react'
import { GripVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from '../../../hooks/useTranslation'
import { confirm } from '../../ui/Confirm'
import { toast } from '../../ui/Toast'
import SceneDialog from '../../dialogs/SceneDialog'
import {
  listScenes, deleteScene, reorderScenes, moveScene, type SceneItem,
} from '../../../services/scene-service'

const DRAG_TYPE = 'application/x-novelforge-scene'

const STATUS_COLOR: Record<string, string> = {
  planned: 'var(--color-text-muted)',
  writing: 'var(--color-accent)',
  done: 'var(--color-success)',
}

function statusLabel(t: (key: 'scene.statusPlanned' | 'scene.statusWriting' | 'scene.statusDone') => string, status: string): string {
  if (status === 'writing') return t('scene.statusWriting')
  if (status === 'done') return t('scene.statusDone')
  return t('scene.statusPlanned')
}

interface Props {
  chapterNumber: number
}

export default function SceneList({ chapterNumber }: Props) {
  const { t } = useTranslation()
  const [scenes, setScenes] = useState<SceneItem[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [dialog, setDialog] = useState<{ open: boolean; editing: SceneItem | null }>({ open: false, editing: null })
  const [dragId, setDragId] = useState<number | null>(null)

  const reload = useCallback(async () => {
    try {
      const list = await listScenes(chapterNumber)
      setScenes(list)
      setFailed(false)
    } catch {
      setScenes([])
      setFailed(true)
    }
  }, [chapterNumber])

  // 展开章节时按需加载（远程数据，必须回写本地状态；同 ProjectTree 的既有写法）
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload() }, [reload])

  const applyOrder = useCallback(async (nextIds: number[]) => {
    const current = scenes ?? []
    const byId = new Map(current.map(s => [s.id, s]))
    // 乐观更新：拖拽/键盘立即见效，写库失败再回滚
    setScenes(nextIds.map((id, index) => ({ ...byId.get(id)!, sortOrder: (index + 1) * 10 })))
    const res = await reorderScenes(chapterNumber, nextIds)
    if (!res.success) {
      toast.error(t('scene.saveFailed').replace('{error}', res.error ?? 'DB'))
      await reload()
    }
  }, [scenes, chapterNumber, t, reload])

  const handleMove = useCallback((fromIndex: number, toIndex: number) => {
    const ids = (scenes ?? []).map(s => s.id)
    const next = moveScene(ids, fromIndex, toIndex)
    if (next === ids) return
    void applyOrder(next)
  }, [scenes, applyOrder])

  const handleDrop = useCallback((targetIndex: number) => {
    if (dragId == null) return
    const list = scenes ?? []
    const fromIndex = list.findIndex(s => s.id === dragId)
    setDragId(null)
    if (fromIndex < 0) return
    handleMove(fromIndex, targetIndex)
  }, [dragId, scenes, handleMove])

  const handleDelete = useCallback(async (scene: SceneItem) => {
    const ok = await confirm(
      t('scene.deleteConfirm').replace('{title}', scene.title || t('scene.untitled')),
      { title: t('scene.title'), confirmText: t('action.delete'), danger: true },
    )
    if (!ok) return
    const res = await deleteScene(scene.id)
    if (res.success) {
      await reload()
    } else {
      toast.error(t('scene.deleteFailed').replace('{error}', res.error ?? 'DB'))
    }
  }, [t, reload])

  const nextSortOrder = (scenes ?? []).reduce((max, s) => Math.max(max, s.sortOrder), 0) + 10

  if (scenes === null) {
    return (
      <div className="text-micro py-1 pl-4 opacity-40" style={{ color: 'var(--color-text-muted)' }}>
        {t('scene.title')}…
      </div>
    )
  }

  return (
    <div className="pl-6 pr-1.5 pb-1 space-y-0.5" role="group" aria-label={t('scene.title')}>
      {failed && (
        <div className="flex items-center gap-2 py-1 pl-1.5 text-micro" style={{ color: 'var(--color-error)' }}>
          <span>{t('scene.loadFailed')}</span>
          <button
            type="button"
            onClick={() => { void reload() }}
            className="underline cursor-pointer"
            style={{ color: 'var(--color-accent)' }}
          >
            {t('scene.retry')}
          </button>
        </div>
      )}

      {!failed && scenes.length === 0 && (
        <div className="text-micro py-1 pl-1.5 opacity-40" style={{ color: 'var(--color-text-muted)' }}>
          {t('scene.empty')}
        </div>
      )}

      {scenes.map((scene, index) => (
        <div
          key={scene.id}
          tabIndex={0}
          role="listitem"
          aria-label={`${scene.title || t('scene.untitled')} · ${statusLabel(t, scene.status)}`}
          draggable
          onDragStart={(e) => {
            setDragId(scene.id)
            e.dataTransfer.setData(DRAG_TYPE, String(scene.id))
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragEnd={() => setDragId(null)}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
          }}
          onDrop={(e) => {
            const raw = e.dataTransfer.getData(DRAG_TYPE)
            if (!raw) return
            e.preventDefault()
            e.stopPropagation()
            handleDrop(index)
          }}
          onKeyDown={(e) => {
            if (!e.altKey) return
            if (e.key === 'ArrowUp') { e.preventDefault(); handleMove(index, index - 1) }
            if (e.key === 'ArrowDown') { e.preventDefault(); handleMove(index, index + 1) }
          }}
          className="group flex items-center gap-1 py-0.5 pl-1 pr-0.5 rounded-md text-micro transition-colors hover:bg-[var(--color-hover)] focus-visible:outline focus-visible:outline-1"
          style={{ color: 'var(--color-text-secondary)', opacity: dragId === scene.id ? 0.5 : 1 }}
          title={scene.summary || undefined}
        >
          <GripVertical size={9} className="opacity-0 group-hover:opacity-40 flex-shrink-0" aria-hidden />
          <span
            aria-hidden
            className="flex-shrink-0 rounded-full"
            style={{ width: 5, height: 5, background: STATUS_COLOR[scene.status] ?? STATUS_COLOR.planned }}
          />
          <span className="truncate flex-1">{scene.title || t('scene.untitled')}</span>
          {scene.wordCount > 0 && (
            <span className="flex-shrink-0 opacity-40">{t('scene.wordCount').replace('{n}', String(scene.wordCount))}</span>
          )}
          <button
            type="button"
            onClick={() => setDialog({ open: true, editing: scene })}
            className="flex items-center justify-center rounded hover:bg-[var(--color-hover)] cursor-pointer flex-shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            style={{ width: 20, height: 20, color: 'var(--color-text-muted)' }}
            title={t('scene.editScene')}
            aria-label={t('scene.editScene')}
          >
            <Pencil size={9} />
          </button>
          <button
            type="button"
            onClick={() => { void handleDelete(scene) }}
            className="flex items-center justify-center rounded hover:bg-[var(--color-hover)] cursor-pointer flex-shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            style={{ width: 20, height: 20, color: 'var(--color-text-muted)' }}
            title={t('action.delete')}
            aria-label={t('action.delete')}
          >
            <Trash2 size={9} />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => setDialog({ open: true, editing: null })}
        className="flex items-center gap-1 py-0.5 pl-1 rounded-md text-micro transition-colors cursor-pointer hover:bg-[var(--color-hover)]"
        style={{ color: 'var(--color-text-muted)' }}
        title={t('scene.reorderHint')}
      >
        <Plus size={9} />
        {t('scene.add')}
      </button>

      <SceneDialog
        isOpen={dialog.open}
        onClose={() => setDialog({ open: false, editing: null })}
        chapterNumber={chapterNumber}
        editing={dialog.editing}
        nextSortOrder={nextSortOrder}
        onSaved={() => { void reload() }}
      />
    </div>
  )
}
