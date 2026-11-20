/**
 * ProjectTree — 项目导航树（侧边栏核心视图）
 *
 * 包含：小说配置、故事架构、章节蓝图、草稿箱、正文章节、全局摘要
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, FolderOpen, FolderTree, BookOpen, LayoutList, LayoutGrid, Globe } from 'lucide-react'
import { useProjectStore } from '../../../stores/project-store'
import { useWorkflowStore } from '../../../stores/workflow-store'
import { draftListScope, useDraftStore, type DraftsByChapter } from '../../../stores/draft-store'
import { useEditorStore } from '../../../stores/editor-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { useMemoryStore } from '../../../stores/memory-store'
import { ipc } from '../../../services/ipc-client'
import { globalEventBus } from '../../../shared/event-bus'
import { Button } from '../../ui/Button'
import CountBadge from '../../ui/CountBadge'
import { EmptyState } from '../../ui/EmptyState'
import { useTranslation } from '../../../hooks/useTranslation'
import { renderLog } from '../../../services/render-logger'

import {
  showSidebarMenu, openBuiltinEditor, openDraftByChapter, openDraftById,
} from './SidebarShared'
import DraftBoxGroup from './DraftBoxGroup'
import ManuscriptGroup from './ManuscriptGroup'
import BinderVolumeGroup from './BinderVolumeGroup'
import PublicationGroup from './PublicationGroup'
import SidebarGroup from './SidebarGroup'

const emptyDrafts: DraftsByChapter = {}

export default function ProjectTree() {
  const { t } = useTranslation()
  const currentProject = useProjectStore(s => s.currentProject)
  const scope = useProjectStore(s => s.loading ? null : draftListScope(s))

  // refreshFileTree / loadAllDrafts 在 refreshAll 内通过 getState() 调用
  // ✅ 只订阅「工作流状态派生 key」（步骤 status 组合）——工作流运行期间
  //    appendText 每 100ms flush 的 activeRuns 引用变化不触发全树重渲染，
  //    只有步骤状态真正变化才刷新（防抖 effect 依赖）
  const workflowKey = useWorkflowStore(s =>
    s.activeRuns.map(r => `${r.id}:${r.status}|${r.steps.map(st => st.status).join(',')}`).join(';'))
  // ✅ 精确订阅，避免 loadAllDrafts 执行后引用变化触发 useCallback/useEffect 循环
  const draftsByChapter = useDraftStore(s => scope && s.draftsScope === scope ? s.draftsByChapter : emptyDrafts)

  // 存储各架构文件是否有实际内容（已生成）
  const [archStatus, setArchStatus] = useState<Record<string, boolean>>({})
  // 章节蓝图数量
  const [blueprintCount, setBlueprintCount] = useState<number>(-1)
  // 世界观实体 / 时间线事件数量（侧栏入口展示）
  const [worldCounts, setWorldCounts] = useState({ entities: 0, events: 0 })

  /** 统一刷新：文件树 + 架构状态 + 草稿列表 + 蓝图数量 */
  // ✅ 用 getState() 获取最新的 action，不作为依赖项，避免重建导致 useEffect 循环
  const refreshAll = useCallback(async () => {
    const source = useProjectStore.getState()
    const refreshScope = draftListScope(source)
    if (!refreshScope || source.loading) return
    useProjectStore.getState().refreshFileTree()
    void useDraftStore.getState().loadAllDrafts().catch(error => renderLog('warn', 'Load:DraftBox', String(error)))
    useMemoryStore.getState().load() // 记忆文件（定稿/失效标记后刷新列表与 stale 徽标）
    // 通过 Service 层获取架构状态和蓝图数量（避免直接 IPC）
    const { checkArchStatus, getBlueprintCount } = await import('../../../services/architecture-service')
    const [status, count, entities, events] = await Promise.all([
      checkArchStatus(),
      getBlueprintCount(),
      ipc.invoke('world:entity-list').catch(() => []),
      ipc.invoke('timeline:event-list').catch(() => []),
    ])
    const current = useProjectStore.getState()
    if (current.loading || draftListScope(current) !== refreshScope) return
    setArchStatus(status)
    setBlueprintCount(count)
    setWorldCounts({ entities: entities.length, events: events.length })
    globalEventBus.emit('REFRESH_RESOURCE', { resources: ['blueprints'] })
  }, [])  // ✅ 空依赖：内部用 getState() 获取最新 action，不依赖闭包

  // 项目切换时刷新
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (scope) void refreshAll()
  }, [scope, refreshAll])

  // 工作流步骤状态或整体状态变化时刷新侧边栏（适配多任务）
  // 合并为单一 effect + 防抖，避免一次步骤完成同时触发多次刷新
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!scope) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      refreshAll()
    }, 80)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [workflowKey, scope, refreshAll])

  if (!currentProject) {
    return (
      <EmptyState
        /* 图标淡度只有一个来源：muted 颜色本身（原实现同时套 muted 色 + opacity-60，且外层 span
           带着无效的 text-4xl —— 与 size={36} 冲突的残留） */
        icon={<FolderOpen size={36} style={{ color: 'var(--color-text-muted)', opacity: 0.6 }} />}
        message={t('empty.pleaseOpenProject')}
        className="p-4 pb-[15vh]"
        opacity={1}
      >
        <span
          className="text-xs text-center mt-0.5"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {t('empty.startCreate')}
        </span>
        {/* 操作按钮 */}
        <div className="flex flex-col gap-2 mt-3 w-full">
          <Button
            variant="default"
            className="w-full"
            onClick={() => useLayoutStore.getState().openNewProject()}
          >
            {t('dialog.newProject')}
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={async () => {
              const folder = await ipc.invoke('dialog:select-folder')
              if (folder) {
                useProjectStore.getState().openProject(folder)
              }
            }}
          >
            {t('action.openProject')}
          </Button>
        </div>
      </EmptyState>
    )
  }

  const p = currentProject.path
  // 改为彻底的数据驱动：从内存的全部草稿中提取 status='finalized' 的草稿
  const manuscriptFiles = Object.values(draftsByChapter)
    .map(drafts => drafts.find(d => d.status === 'finalized'))
    .filter(Boolean)
    .sort((a, b) => a!.chapterNumber - b!.chapterNumber)
    .map(draft => ({
      path: `vela://manuscript/${draft!.id}`, // 诸如 vela://manuscript/42
      name: `chapter_${draft!.chapterNumber}.md`, // 提供格式化的伪文件名供组件适配解析
      isDir: false,
    })) as Array<{ path: string; name: string; isDir: boolean }>

  // 小说配置是否已完成（核心大纲非空视为已完成）
  const nc = currentProject.novelConfig
  const configDone = !!(nc.coreOutline?.trim() || nc.protagonistProfile?.trim())

  const architecture = Object.values(archStatus)
  const archDone = architecture.filter(Boolean).length

  return (
    <div className="text-sm space-y-3">
      {/* 项目名 + 刷新 */}
      <div className="flex items-center justify-between px-3 py-1.5 mb-0.5">
        <span className="font-semibold text-xs truncate" style={{ color: 'var(--color-text)' }}>
          {currentProject.name}
        </span>
        <Button variant="ghost" size="icon" onClick={() => refreshAll()} title={t('action.refresh')}>
          <RefreshCw size={12} />
        </Button>
      </div>

      {/* 1. 小说配置（单行入口块：标题行点击打开配置编辑器） */}
      <SidebarGroup
        icon={<BookOpen size={12} />}
        title={t('editor.novelConfig')}
        collapsible={false}
        count={<CountBadge value={configDone ? t('status.configured') : t('status.pendingConfig')} tone={configDone ? 'success' : 'muted'} />}
        onTitleClick={() => {
          const state = useEditorStore.getState()
          const configTab = state.tabs.find(t => t.type === 'config')
          if (configTab) {
            state.setActiveTab(configTab.id)
          } else {
            state.openFile({ id: 'config', name: t('editor.novelConfig'), type: 'config' })
          }
        }}
        onContextMenu={e => showSidebarMenu([
          {
            key: 'open',
            label: t('action.openConfig'),
            icon: <FolderOpen size={13} />,
            onClick: () => {
              const state = useEditorStore.getState()
              const configTab = state.tabs.find(t => t.type === 'config')
              if (configTab) state.setActiveTab(configTab.id)
              else state.openFile({ id: 'config', name: t('editor.novelConfig'), type: 'config' })
            },
          },
        ], e)}
      />

      <SidebarGroup
        icon={<FolderTree size={12} />}
        title={t('editor.storyArch')}
        collapsible={false}
        count={architecture.length > 0 && <CountBadge value={archDone} total={architecture.length} progress
          tone={archDone === architecture.length ? 'success' : archDone > 0 ? 'warning' : 'muted'} />}
        onTitleClick={() => openBuiltinEditor('world-building-editor', t('editor.storyArch'), 'world-building')}
        titleHint={t('tip.openArchEditor')}
      />

      {/* 世界观与时间线 — 独立单行入口（不再与「故事架构」共用一张卡的两个热区） */}
      <SidebarGroup
        icon={<Globe size={12} />}
        title={t('world.title')}
        collapsible={false}
        count={(
          <span className="flex items-center gap-1">
            <CountBadge value={worldCounts.entities} unit={t('unit.entities')} />
            <CountBadge value={worldCounts.events} unit={t('unit.events')} />
          </span>
        )}
        onTitleClick={() => {
          const state = useEditorStore.getState()
          const existing = state.tabs.find(tab => tab.type === 'world-timeline')
          if (existing) state.setActiveTab(existing.id)
          else state.openFile({ id: 'world-timeline', name: t('world.title'), type: 'world-timeline' })
        }}
      />

      {/* 3. 章节蓝图（单行入口块：标题行点击打开编辑器页） */}
      <SidebarGroup
        icon={<LayoutList size={12} />}
        title={t('mention.blueprint')}
        collapsible={false}
        count={blueprintCount > 0
          ? <CountBadge
              value={blueprintCount}
              total={nc.totalChapters > 0 ? nc.totalChapters : undefined}
              unit={t('unit.chapters')}
              progress={nc.totalChapters > 0}
              tone={blueprintCount >= nc.totalChapters ? 'success' : 'warning'}
            />
          : <CountBadge value={t('status.pendingGen')} />}
        onTitleClick={() => openBuiltinEditor('chapter-card-editor', t('mention.blueprint'), 'chapter-card')}
        actions={(
          <button
            type="button"
            className="flex items-center justify-center rounded hover:bg-[var(--color-hover)] cursor-pointer flex-shrink-0"
            style={{ width: 32, height: 32, color: 'var(--color-text-muted)' }}
            title={t('board.title')}
            onClick={() => {
              const state = useEditorStore.getState()
              const existing = state.tabs.find((tab) => tab.type === 'manuscript-board')
              if (existing) state.setActiveTab(existing.id)
              else state.openFile({ id: 'manuscript-board', name: t('board.title'), type: 'manuscript-board' })
            }}
          >
            <LayoutGrid size={12} />
          </button>
        )}
        onContextMenu={e => showSidebarMenu([
          {
            key: 'open',
            label: t('action.openBlueprint'),
            icon: <FolderOpen size={13} />,
            onClick: () => openBuiltinEditor('chapter-card-editor', t('mention.blueprint'), 'chapter-card'),
          },
        ], e)}
      />

      {/* 3.5 分卷 — 按卷组织章节（可新建/编辑/删除/自动划分；卷内章节直接打开草稿） */}
      <BinderVolumeGroup
        projectPath={p}
        totalChapters={nc.totalChapters}
        onOpenDraft={(chapterNumber, title, draftId) => {
          if (draftId === undefined) { void openDraftByChapter(chapterNumber, title); return }
          const label = t('chapter.label').replace('{n}', String(chapterNumber))
          const name = title ? (title.startsWith(label) ? title : `${label} ${title}`) : label
          void openDraftById(draftId, `${name}（${t('editor.draft')}）`)
        }}
        draftsByChapter={draftsByChapter}
      />

      {/* 3.6 连载监控 — 手动导入平台章节，对比本地定稿相似度 + 审计 */}
      <PublicationGroup projectPath={p} />

      {/* 4. 草稿箱 — 独立分区，按章节分组展示草稿 */}
      <DraftBoxGroup />

      {/* 5. 正文章节 — 仅显示已定稿 */}
      <ManuscriptGroup files={manuscriptFiles} projectPath={p} />
    </div>
  )
}
