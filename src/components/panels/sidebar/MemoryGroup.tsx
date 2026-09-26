/**
 * MemoryGroup — 作品记忆组（侧栏 AI 记忆导航，CCR P1 Task 5）
 *
 * 标题行：AI 记忆 + 数量 + 刷新 + 折叠（默认展开）
 * 列表行：kind 徽标（章节/分卷/全书/共享/其他）+ 文件名 + stale「待重建」徽标 + 重建按钮 + 删除按钮
 * 行点击：在**编辑器标签页**打开该记忆文件（vela://memory/<file>，全宽 / 正常字号 / 可搜索 /
 *   可关闭 / 可多开）——真机反馈（2026-09-19）「每个小说章节 AI 记忆为什么就在侧边栏直接打开，
 *   为什么不在编辑栏打开？侧边栏那么小的位置」。侧栏只做导航（列表/重建/删除/刷新），
 *   查看与编辑统一在编辑区（编辑区保存链见 EditorArea 的 vela://memory/ 分支：结构校验 → 去
 *   status → memory:write → 刷新列表）。
 * 重建（审阅修正——卷级真实重建，非仅标 stale）：
 *   卷级 = 复用 Task 2 卷聚合（章节文件解析 → buildVolumeSummaryFile → memory:write 覆盖，
 *         纯函数零 LLM 即时完成；进行中卷 chapterEnd=0 无聚合入口 → 仅提示不可重建）
 *   章节 = 标记 stale（走下次定稿 DAG 重建）
 *   全书 = P2 真实重建（rebuildBookState 聚合非 stale 卷 / 无分卷聚合最新章节文件）
 * 数据：useMemoryStore（memory:list / memory:read / memory:mark-stale）
 */
import { useEffect, useState } from 'react'
import { Brain, RefreshCw, ChevronDown, ChevronRight, RotateCw, Trash2, AlertCircle } from 'lucide-react'
import { useMemoryStore } from '../../../stores/memory-store'
import { useEditorStore } from '../../../stores/editor-store'
import { ipc } from '../../../services/ipc-client'
import { VELA, readVelaContent } from '../../../services/vela-protocol'
import { renderLog } from '../../../services/render-logger'
import { toast } from '../../ui/Toast'
import { confirm } from '../../ui/Confirm'
import { useTranslation } from '../../../hooks/useTranslation'
import { useMemoryRebuild } from '../../../hooks/useMemoryRebuild'
import { globalEventBus } from '../../../shared/event-bus'
import { SegmentedControl } from '../../ui/SegmentedControl'
import type { MemoryFileMeta } from '../../../services/memory/memory-codec'
import type { MemoryLoadMode } from '../../../shared/memory-types'

interface Props {
  /** 项目路径（项目切换时重载） */
  projectPath?: string
}

export default function MemoryGroup({ projectPath }: Props) {
  const { t } = useTranslation()
  const { files, loading, loadFailed, load, refresh } = useMemoryStore()
  const { handleRebuild } = useMemoryRebuild()
  const [open, setOpen] = useState(true)

  // 挂载 + 项目切换时加载记忆文件列表
  useEffect(() => {
    void load()
  }, [projectPath, load])

  // 定稿/检查点后重载（chapter-workflow 完成时发 REFRESH_RESOURCE 'all'，记忆文件随定稿 DAG 更新）
  useEffect(() => {
    const unsub = globalEventBus.on('REFRESH_RESOURCE', (payload: { resources: string[] }) => {
      if (payload.resources.includes('all') || payload.resources.includes('drafts')) void load()
    })
    return () => { unsub() }
  }, [load])

  return (
    <section
      className="rounded-xl border p-2.5"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-panel)' }}
    >
      {/* 头部：与 VolumeGroup 同构（icon + title + ml-auto 数量 + muted 操作按钮 + 折叠按钮最后） */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <Brain size={12} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
        <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
          {t('memory.groupTitle')}
        </span>
        <span className="ml-auto text-micro" style={{ color: 'var(--color-text-muted)' }}>
          {files.length}
        </span>
        <button
          type="button"
          onClick={() => void load()}
          className="p-0.5 rounded hover:bg-[var(--color-hover)] cursor-pointer flex-shrink-0"
          style={{ color: 'var(--color-text-muted)' }}
          title={t('action.refresh')}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="p-0.5 rounded hover:bg-[var(--color-hover)] cursor-pointer flex-shrink-0"
          style={{ color: 'var(--color-text-muted)' }}
          title={open ? t('action.close') : t('action.open')}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      </div>

      {!open ? null : loadFailed ? (
        /* 错误态与空态必须分开：失败渲染成「暂无记忆」会让用户以为本来就没有 */
        <div className="flex items-center gap-1.5 py-1 text-micro" style={{ color: 'var(--color-text-muted)' }}>
          <AlertCircle size={11} style={{ color: 'var(--color-error)', flexShrink: 0 }} />
          <span>{t('common.loadFailed')}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="ml-auto px-1.5 py-0.5 rounded hover:bg-[var(--color-hover)] cursor-pointer flex-shrink-0"
            style={{ color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
          >
            {t('action.retry')}
          </button>
        </div>
      ) : files.length === 0 ? (
        <div className="text-micro py-1 opacity-40" style={{ color: 'var(--color-text-muted)' }}>
          {t('memory.empty')}
        </div>
      ) : (
        // key=projectPath：项目切换时重挂载，行级打开状态不跨项目串味
        <MemoryList key={projectPath ?? 'none'} files={files} onRebuild={handleRebuild} onSaved={refresh} />
      )}
    </section>
  )
}

// ===== 记忆文件列表（侧栏与 AI 面板共享，P3 Task 3） =====

export function MemoryList({ files, onRebuild, onSaved, showLoadMode, onLoadModeChange }: {
  files: MemoryFileMeta[]
  onRebuild: (f: MemoryFileMeta) => void
  onSaved: () => Promise<void>
  /** C 档第一轮：AI 面板的记忆视图开启加载方式选择器（侧栏不传——264px 放不下） */
  showLoadMode?: boolean
  onLoadModeChange?: (file: string, mode: MemoryLoadMode) => void
}) {
  return (
    <div className="space-y-1">
      {files.map(f => (
        <MemoryRow key={f.file} meta={f} onRebuild={() => onRebuild(f)} onSaved={onSaved}
          showLoadMode={showLoadMode} onLoadModeChange={onLoadModeChange} />
      ))}
    </div>
  )
}

// ===== 记忆文件行 =====

function MemoryRow({ meta, onRebuild, onSaved, showLoadMode, onLoadModeChange }: {
  meta: MemoryFileMeta
  onRebuild: () => void
  onSaved: () => Promise<void>
  /** C 档第一轮：显示加载方式三态选择器（常驻 / 自动 / 手动） */
  showLoadMode?: boolean
  onLoadModeChange?: (file: string, mode: MemoryLoadMode) => void
}) {
  const { t } = useTranslation()

  const kindLabel = meta.kind === 'chapters'
    ? t('memory.kindChapters')
    : meta.kind === 'volume'
      ? t('memory.kindVolume')
      : meta.kind === 'book'
        ? t('memory.kindBook')
        : meta.kind === 'shared' // P3：跨会话可复用事实（shared.md）
          ? t('memory.kindShared')
          : t('memory.kindUnknown') // F9：未知前缀文件（用户手放 notes.md 等）

  /**
   * 行点击 → 在编辑器标签页打开（编辑器是唯一查看/编辑面）：
   * tab id / filePath = vela://memory/<file>，内容经 vela-protocol 的 memory 分支读主进程；
   * 同一文件的重复点击由 editor-store 按 filePath 去重（dirty 时保留未保存编辑，仅激活）。
   */
  const openInEditor = async () => {
    const filePath = `${VELA.MEMORY}${meta.file}`
    let content = ''
    try {
      content = await readVelaContent(filePath)
    } catch (e) {
      // IPC 不可用/超时：仍打开标签页（内容空），失败只进控制台——不产生 unhandled rejection。
      // 文件不存在由主进程 memory:read 返回 null 表达（readVelaContent 归零为空串），不走这里。
      console.warn('[MemoryGroup] 读取记忆文件失败:', e)
    }
    useEditorStore.getState().openFile({
      id: filePath,
      name: meta.file,
      type: 'memory',
      filePath,
      content,
    })
  }

  /**
   * 删除（memory:delete）：破坏性操作 → confirm 二次确认 + toast + renderLog。
   * 路径安全由主进程 safeFile（白名单正则）兜底，前端传的是列表回读的 meta.file。
   */
  const handleDelete = async () => {
    const ok = await confirm(t('memory.deleteConfirm'), { danger: true })
    if (!ok) return
    try {
      const res = await ipc.invoke('memory:delete', meta.file)
      if (!res.success) throw new Error(t('status.unknown'))
      renderLog('info', 'Save:Memory', t('log.render.memoryDeleteSuccess').replace('{file}', () => meta.file))
      toast.success(t('memory.deleted'))
      await onSaved()
    } catch (e) {
      toast.error(t('memory.deleteFailed').replace('{error}', () => String(e)))
    }
  }

  return (
    <div className="rounded-lg border" style={{ borderColor: 'var(--color-border)' }}>
      {/* 2026-09-25 重构：行点击此前在 `<div onClick>` 上 —— 键盘完全够不到，
          而它内部**本来就含**重建/删除按钮，外层直接换 `<button>` 会 button 嵌 button。
          做法：kind 徽标 + 文件名 + stale 徽标包进主按钮，重建/删除降为兄弟节点
          （不再需要 stopPropagation，外层已无点击处理器）。 */}
      <div
        className="flex items-center gap-1.5 px-1.5 py-1.5 select-none hover:bg-[var(--color-hover)]"
        title={meta.file}
      >
        <button
          type="button"
          onClick={() => void openInEditor()}
          className="flex items-center gap-1.5 flex-1 min-w-0 h-full text-left enabled:cursor-pointer"
        >
          <span
            className="text-2xs px-1 py-0.5 rounded flex-shrink-0"
            style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-muted)' }}
          >
            {kindLabel}
          </span>
          <span className="text-xs truncate flex-1" style={{ color: 'var(--color-text)' }}>
            {meta.file}
          </span>
          {meta.stale && (
            <span
              className="text-2xs px-1 py-0.5 rounded flex-shrink-0"
              style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-warning)' }}
            >
              {t('memory.stale')}
            </span>
          )}
        </button>
        <button
          type="button"
          className="p-0.5 rounded hover:bg-[var(--color-hover)] cursor-pointer flex-shrink-0"
          style={{ color: 'var(--color-text-muted)' }}
          title={t('memory.rebuild')}
          onClick={() => onRebuild()}
        >
          <RotateCw size={10} />
        </button>
        <button
          type="button"
          className="p-0.5 rounded hover:bg-[var(--color-hover)] cursor-pointer flex-shrink-0"
          style={{ color: 'var(--color-text-muted)' }}
          title={t('action.delete')}
          onClick={() => void handleDelete()}
        >
          <Trash2 size={10} />
        </button>
      </div>
      {/* C 档第一轮：加载方式三态（仅 AI 面板记忆视图；侧栏 264px 放不下）。
          与上面行容器是兄弟节点 —— 不嵌进行主按钮（button 嵌 button 非法 HTML），
          故不影响侧栏「每行 3 按钮」的既有契约。 */}
      {showLoadMode && (
        <div className="px-1.5 pb-1.5" style={{ borderTop: '1px solid var(--color-border)' }}>
          <SegmentedControl
            size="sm"
            fill
            value={meta.loadMode}
            // 点当前档位是 no-op（SegmentedControl 不判 active）——不写盘、不 toast（评审 Minor 5）
            onChange={(mode) => { if (mode !== meta.loadMode) onLoadModeChange?.(meta.file, mode) }}
            items={[
              { value: 'resident', label: t('memory.loadModeResident'), title: t('memory.loadModeResidentHint') },
              { value: 'auto', label: t('memory.loadModeAuto'), title: t('memory.loadModeAutoHint') },
              { value: 'manual', label: t('memory.loadModeManual'), title: t('memory.loadModeManualHint') },
            ]}
          />
        </div>
      )}
    </div>
  )
}
