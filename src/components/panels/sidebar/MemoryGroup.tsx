/**
 * MemoryGroup — 作品记忆组（侧栏 AI 记忆查看器，CCR P1 Task 5）
 *
 * 标题行：AI 记忆 + 数量 + 刷新 + 折叠（默认展开）
 * 列表行：kind 徽标（章节/分卷/全书）+ 文件名 + stale「待重建」徽标 + 点击查看 + 重建按钮
 * 查看区：memory:read 内容 pre-wrap 只读（max-h 滚动）
 * 重建（审阅修正——卷级真实重建，非仅标 stale）：
 *   卷级 = 复用 Task 2 卷聚合（章节文件解析 → buildVolumeSummaryFile → memory:write 覆盖，
 *         纯函数零 LLM 即时完成；进行中卷 chapterEnd=0 无聚合入口 → 仅提示不可重建）
 *   章节 = 标记 stale（走下次定稿 DAG 重建）
 *   全书 = P2 真实重建（rebuildBookState 聚合非 stale 卷 / 无分卷聚合最新章节文件）
 * 数据：useMemoryStore（memory:list / memory:read / memory:mark-stale）
 */
import { useEffect, useState } from 'react'
import { Brain, RefreshCw, ChevronDown, ChevronRight, RotateCw, Pencil } from 'lucide-react'
import { useMemoryStore } from '../../../stores/memory-store'
import { useVolumeStore } from '../../../stores/volume-store'
import { ipc } from '../../../services/ipc-client'
import { renderLog } from '../../../services/render-logger'
import { ensureVolumeSummary } from '../../../services/memory/chapter-memory'
import { rebuildBookState } from '../../../services/memory/book-memory'
import { isValidMemoryContent, stripStatusFrontmatter } from '../../../services/memory/memory-codec'
import { toast } from '../../ui/Toast'
import { useTranslation } from '../../../hooks/useTranslation'
import { globalEventBus } from '../../../shared/event-bus'
import type { MemoryFileMeta } from '../../../services/memory/memory-codec'

interface Props {
  /** 项目路径（项目切换时重载） */
  projectPath?: string
}

export default function MemoryGroup({ projectPath }: Props) {
  const { t } = useTranslation()
  const { files, loading, load, refresh } = useMemoryStore()
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

  /** 手动重建入口 */
  const handleRebuild = async (f: MemoryFileMeta) => {
    // 卷级：ensureVolumeSummary 扫描全部 chapters-*.md 收集卷内条目 →
    // buildVolumeSummaryFile 组装 → memory:write 覆盖（纯函数聚合，零 LLM，即时完成）
    if (f.kind === 'volume') {
      const m = f.file.match(/^volume-(\d+)\.md$/)
      if (!m) { toast.error(t('error.unknown')); return }
      const applied = await useVolumeStore.getState().load() // 重建前保证卷数据最新（loadSeq 竞态守卫）
      const volumes = applied ? useVolumeStore.getState().volumes : []
      const vol = volumes.find(v => v.volumeNumber === Number(m[1]))
      if (!vol) { toast.error(t('error.unknown')); return }
      if (vol.chapterEnd === 0) {
        // 进行中卷：卷聚合无入口（ensureVolumeSummary 跳过）——提示走定稿/检查点生成
        toast.success(t('memory.rebuildHint'))
        return
      }
      const res = await ensureVolumeSummary(vol)
      if (res.success) await refresh() // 覆盖写（无 status:stale）→ stale 徽标消失
      // F6：重建失败 = 卷内章节条目不完整（未定稿）——明确指引而非笼统未知错误
      else toast.error(t('memory.rebuildIncomplete'))
      return
    }
    // 全书：P2 真实重建——rebuildBookState 聚合非 stale 卷（无分卷则聚合最新章节文件）→ 覆盖写
    if (f.kind === 'book') {
      const res = await rebuildBookState()
      if (res.success) {
        toast.success(t('memory.rebuildBookDone'))
        await refresh() // 覆盖写（无 status:stale）→ stale 徽标消失
      } else {
        // M6：失败带出 rebuildBookState 的 reason（如 'all volume files stale'）而非吞掉——reason 为内部诊断串，直接拼接展示
        toast.error(res.reason ? `${t('error.unknown')}：${res.reason}` : t('error.unknown'))
      }
      return
    }
    // 章节：标记 stale（章节条目来自定稿 LLM 提取，走下次定稿 DAG；全书走上面的真实重建）
    const res = await ipc.invoke('memory:mark-stale', f.file)
    if (res.success) {
      toast.success(t('memory.rebuildHint'))
      await refresh() // stale 徽标出现
    } else {
      toast.error(t('error.unknown'))
    }
  }

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
        <span className="ml-auto text-[0.7rem]" style={{ color: 'var(--color-text-muted)' }}>
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

      {!open ? null : files.length === 0 ? (
        <div className="text-[0.65rem] py-1 opacity-40" style={{ color: 'var(--color-text-muted)' }}>
          {t('memory.empty')}
        </div>
      ) : (
        // key=projectPath：项目切换时重挂载，行级查看/内容缓存不跨项目串味
        <MemoryList key={projectPath ?? 'none'} files={files} onRebuild={handleRebuild} onSaved={refresh} />
      )}
    </section>
  )
}

// ===== 记忆文件列表 =====

function MemoryList({ files, onRebuild, onSaved }: {
  files: MemoryFileMeta[]
  onRebuild: (f: MemoryFileMeta) => void
  onSaved: () => Promise<void>
}) {
  return (
    <div className="space-y-1">
      {files.map(f => (
        <MemoryRow key={f.file} meta={f} onRebuild={() => onRebuild(f)} onSaved={onSaved} />
      ))}
    </div>
  )
}

// ===== 记忆文件行 =====

function MemoryRow({ meta, onRebuild, onSaved }: {
  meta: MemoryFileMeta
  onRebuild: () => void
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState<string | null>(null)
  // 手动编辑三态（Task 5）：查看（只读）→ 编辑（textarea draft）→ 保存/取消
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const kindLabel = meta.kind === 'chapters'
    ? t('memory.kindChapters')
    : meta.kind === 'volume'
      ? t('memory.kindVolume')
      : meta.kind === 'book'
        ? t('memory.kindBook')
        : t('memory.kindUnknown') // F9：未知前缀文件（用户手放 notes.md 等）

  /** 行点击切换查看（memory:read 只读；首次展开才读取） */
  const toggleView = () => {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (content === null) {
      ipc.invoke('memory:read', meta.file)
        .then(raw => setContent(raw ?? ''))
        .catch(() => setContent(''))
    }
  }

  /** 进入编辑：draft 从查看内容初始化 */
  const startEdit = () => {
    setDraft(content ?? '')
    setEditing(true)
  }

  /**
   * 保存：结构校验（无章节块且 frontmatter 不完整 → toast 阻止）→ 清除 frontmatter status
   * （同 upsert 语义，编辑后不再视为 stale）→ memory:write → 成功回查看态 + 刷新 stale 徽标。
   */
  const handleSave = async () => {
    if (!isValidMemoryContent(draft)) {
      toast.error(t('memory.invalidFormat'))
      return
    }
    const t0 = Date.now()
    setSaving(true)
    try {
      const saved = stripStatusFrontmatter(draft)
      const res = await ipc.invoke('memory:write', meta.file, saved)
      if (!res.success) throw new Error(t('status.unknown'))
      renderLog('info', 'Save:Memory', t('log.render.memorySaveSuccess')
        .replace('{file}', () => meta.file)
        .replace('{ms}', String(Date.now() - t0)))
      setContent(saved)
      setEditing(false)
      toast.success(t('save.success'))
      await onSaved()
    } catch (e) {
      renderLog('error', 'Save:Memory', t('log.render.memorySaveFailed')
        .replace('{file}', () => meta.file)
        .replace('{error}', () => String(e)))
      toast.error(t('save.failed').replace('{error}', () => String(e)))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border" style={{ borderColor: 'var(--color-border)' }}>
      <div
        className="flex items-center gap-1.5 px-1.5 py-1.5 cursor-pointer select-none"
        onClick={toggleView}
      >
        {open
          ? <ChevronDown size={10} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          : <ChevronRight size={10} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />}
        <span
          className="text-[0.6rem] px-1 py-0.5 rounded flex-shrink-0"
          style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-muted)' }}
        >
          {kindLabel}
        </span>
        <span className="text-xs truncate flex-1" style={{ color: 'var(--color-text)' }}>
          {meta.file}
        </span>
        {meta.stale && (
          <span
            className="text-[0.6rem] px-1 py-0.5 rounded flex-shrink-0"
            style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-warning)' }}
          >
            {t('memory.stale')}
          </span>
        )}
        <button
          type="button"
          className="p-0.5 rounded hover:bg-[var(--color-hover)] cursor-pointer flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ color: 'var(--color-text-muted)' }}
          title={t('memory.rebuild')}
          disabled={editing}
          onClick={(e) => { e.stopPropagation(); onRebuild() }}
        >
          <RotateCw size={10} />
        </button>
      </div>

      {/* 查看/编辑区：默认只读（pre-wrap），「编辑」→ textarea 三态（Task 5） */}
      {open && (
        <div className="px-2 pb-2">
          {editing ? (
            <>
              <textarea
                className="w-full whitespace-pre-wrap max-h-40 overflow-y-auto rounded p-2 text-[0.65rem] leading-relaxed resize-y focus:outline-none"
                style={{ color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-hover)' }}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                autoFocus
              />
              <div className="flex justify-end gap-1.5 mt-1">
                <button
                  type="button"
                  className="text-[0.6rem] px-1.5 py-0.5 rounded hover:bg-[var(--color-hover)] cursor-pointer"
                  style={{ color: 'var(--color-text-muted)' }}
                  onClick={() => setEditing(false)}
                >
                  {t('action.cancel')}
                </button>
                <button
                  type="button"
                  className="text-[0.6rem] px-1.5 py-0.5 rounded hover:bg-[var(--color-hover)] cursor-pointer disabled:opacity-60"
                  style={{ color: 'var(--color-accent)' }}
                  disabled={saving}
                  onClick={() => void handleSave()}
                >
                  {t('action.save')}
                </button>
              </div>
            </>
          ) : (
            <>
              <pre
                className="whitespace-pre-wrap max-h-40 overflow-y-auto rounded p-2 text-[0.65rem] leading-relaxed"
                style={{ color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-hover)' }}
              >
                {content ?? ''}
              </pre>
              <div className="flex justify-end mt-1">
                <button
                  type="button"
                  className="flex items-center gap-1 text-[0.6rem] px-1.5 py-0.5 rounded hover:bg-[var(--color-hover)] cursor-pointer"
                  style={{ color: 'var(--color-text-muted)' }}
                  onClick={startEdit}
                >
                  <Pencil size={10} />
                  {t('action.edit')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
