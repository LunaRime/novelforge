/**
 * AgentMemoryView — AI 面板内嵌记忆列表（CCR P3 Task 3，第二入口）
 *
 * 入口：AgentHeader 工具栏「记忆」按钮 → setMemoryView(true) → AgentConversation
 * 切换渲染本视图；头部返回按钮恢复对话视图。
 * 数据流复用侧栏 MemoryGroup：useMemoryStore（memory:list）+ MemoryList/useMemoryRebuild
 * （卷级/全书真实重建、章节标记 stale）。行点击与侧栏一致：把记忆文件开到**编辑器标签页**
 * 查看/编辑（2026-09-19 真机反馈改造：面板内不再行内展开内容，编辑器是唯一查看/编辑面，
 * 面板自身依旧不提供行内编辑控件）。
 * 评审项 7：无项目打开时显示「打开项目后可查看记忆」提示（memory-store 依赖项目路径，
 * 不报错不空白）。
 */
import { useEffect, useState } from 'react'
import { ChevronRight, RefreshCw } from 'lucide-react'
import { useMemoryStore } from '../../../stores/memory-store'
import { useAgentStore } from '../../../stores/agent-store'
import { useProjectStore } from '../../../stores/project-store'
import { MemoryList } from '../sidebar/MemoryGroup'
import { useMemoryRebuild } from '../../../hooks/useMemoryRebuild'
import { globalEventBus } from '../../../shared/event-bus'
import { useTranslation } from '../../../hooks/useTranslation'
import { toast } from '../../ui/Toast'
import { changeMemoryLoadMode, residentTargets, sumResidentSectionTokens } from '../../../services/memory/load-mode'
import { RESIDENT_MEMORY_BUDGET_TOKENS, RESIDENT_MEMORY_WARN_TOKENS } from '../../../services/agent/memory-layers'
import type { MemoryLoadMode } from '../../../shared/memory-types'

export default function AgentMemoryView() {
  const { t } = useTranslation()
  const setMemoryView = useAgentStore(s => s.setMemoryView)
  const projectPath = useProjectStore(s => s.currentProject?.path)
  const { files, loading, load, refresh } = useMemoryStore()
  const { handleRebuild } = useMemoryRebuild()

  // 挂载 + 项目切换时加载记忆文件列表（与 MemoryGroup 同约定）
  useEffect(() => {
    void load()
  }, [projectPath, load])

  // 定稿/检查点后重载（REFRESH_RESOURCE 'all'/'drafts'）
  useEffect(() => {
    const unsub = globalEventBus.on('REFRESH_RESOURCE', (payload: { resources: string[] }) => {
      if (payload.resources.includes('all') || payload.resources.includes('drafts')) void load()
    })
    return () => { unsub() }
  }, [load])

  // 常驻合计（C 档第一轮）：与注入同口径（同一个 buildResidentSection）——文件列表变化时重算
  const [resident, setResident] = useState<{ tokens: number; overCap: boolean } | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const usage = await sumResidentSectionTokens(residentTargets(files))
        if (!cancelled) setResident(usage)
      } catch {
        if (!cancelled) setResident(null)
      }
    })()
    return () => { cancelled = true }
  }, [files])

  const handleLoadModeChange = async (file: string, mode: MemoryLoadMode) => {
    const res = await changeMemoryLoadMode(file, mode)
    if (res.ok) {
      // 评审 Minor 5：值没变就不给「已更新」的假反馈，也不刷新列表（磁盘没动）
      if (res.changed) {
        toast.success(t('memory.loadModeSaved'))
        await load()
      }
    } else {
      const key = res.reason === 'dirty'
        ? 'memory.loadModeDirty'
        : res.reason === 'openInEditor'
          ? 'memory.loadModeOpenTab'
          : 'memory.loadModeFailed'
      toast.error(t(key).replace('{error}', res.reason))
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* 头部：返回 + 标题 + 数量 + 刷新（参照 AgentHistoryPanel 面板头部） */}
      <div
        className="flex items-center gap-1.5 px-3 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <button
          type="button"
          onClick={() => setMemoryView(false)}
          className="flex items-center gap-1 text-xs font-medium rounded transition-colors"
          style={{ color: 'var(--color-text-secondary)' }}
          title={t('memory.back')}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <ChevronRight size={12} style={{ transform: 'rotate(180deg)' }} />
          <span>{t('memory.menuTitle')}</span>
        </button>
        <span className="ml-auto text-micro" style={{ color: 'var(--color-text-muted)' }}>
          {projectPath ? files.length : '—'}
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
      </div>

      {/* 常驻合计指示（C 档第一轮）：超警告阈值转黄——用户能一眼看到「常驻吃了多少预算」 */}
      {resident && (
        <div
          className="px-3 py-1 text-micro flex-shrink-0"
          style={{
            borderBottom: '1px solid var(--color-border)',
            color: resident.overCap || resident.tokens > RESIDENT_MEMORY_WARN_TOKENS ? 'var(--color-warning)' : 'var(--color-text-muted)',
          }}
        >
          {t('memory.residentTotal')
            .replace('{tokens}', String(resident.tokens))
            .replace('{cap}', String(RESIDENT_MEMORY_BUDGET_TOKENS))}
        </div>
      )}

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {!projectPath ? (
          <div className="flex items-center justify-center h-24 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('memory.openProjectHint')}
          </div>
        ) : files.length === 0 ? (
          <div className="text-micro py-1 opacity-40" style={{ color: 'var(--color-text-muted)' }}>
            {t('memory.empty')}
          </div>
        ) : (
          // key=projectPath：项目切换时重挂载，行级打开状态不跨项目串味
          <MemoryList
            key={projectPath}
            files={files}
            onRebuild={handleRebuild}
            onSaved={refresh}
            showLoadMode
            onLoadModeChange={(file, mode) => void handleLoadModeChange(file, mode)}
          />
        )}
      </div>
    </div>
  )
}
