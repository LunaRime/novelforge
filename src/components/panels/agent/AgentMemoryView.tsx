/**
 * AgentMemoryView — AI 面板内嵌记忆查看器（CCR P3 Task 3，第二入口）
 *
 * 入口：AgentHeader 工具栏「记忆」按钮 → setMemoryView(true) → AgentConversation
 * 切换渲染本视图；头部返回按钮恢复对话视图。
 * 数据流复用侧栏 MemoryGroup：useMemoryStore（memory:list）+ MemoryList/useMemoryRebuild
 * （memory:read 展开查看 + 卷级/全书真实重建/章节标记 stale）——只读（无行内编辑，
 * 编辑模式为侧栏入口 P2 Task 5），布局适配 AI 面板宽度。
 * 评审项 7：无项目打开时显示「打开项目后可查看记忆」提示（memory-store 依赖项目路径，
 * 不报错不空白）。
 */
import { useEffect } from 'react'
import { ChevronRight, RefreshCw } from 'lucide-react'
import { useMemoryStore } from '../../../stores/memory-store'
import { useAgentStore } from '../../../stores/agent-store'
import { useProjectStore } from '../../../stores/project-store'
import { MemoryList } from '../sidebar/MemoryGroup'
import { useMemoryRebuild } from '../../../hooks/useMemoryRebuild'
import { globalEventBus } from '../../../shared/event-bus'
import { useTranslation } from '../../../hooks/useTranslation'

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
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {!projectPath ? (
          <div className="flex items-center justify-center h-24 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('memory.openProjectHint')}
          </div>
        ) : files.length === 0 ? (
          <div className="text-[0.65rem] py-1 opacity-40" style={{ color: 'var(--color-text-muted)' }}>
            {t('memory.empty')}
          </div>
        ) : (
          // key=projectPath：项目切换时重挂载，行级查看/内容缓存不跨项目串味
          <MemoryList
            key={projectPath}
            files={files}
            onRebuild={handleRebuild}
            onSaved={refresh}
            editable={false}
          />
        )}
      </div>
    </div>
  )
}
