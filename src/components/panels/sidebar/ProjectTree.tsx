/**
 * ProjectTree — 项目导航树（侧边栏核心视图）
 *
 * 包含：小说配置、故事架构、章节蓝图、草稿箱、正文章节、全局摘要
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, CheckCircle2, Circle, FolderOpen, Copy, FolderTree, BookOpen, LayoutList } from 'lucide-react'
import { useProjectStore } from '../../../stores/project-store'
import { useWorkflowStore } from '../../../stores/workflow-store'
import { useDraftStore } from '../../../stores/draft-store'
import { useEditorStore } from '../../../stores/editor-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { ipc } from '../../../services/ipc-client'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { useTranslation } from '../../../hooks/useTranslation'

import {
  getArchFiles, renderIcon, showSidebarMenu,
  openArchFile, openBuiltinEditor, openDraftByChapter,
} from './SidebarShared'
import DraftBoxGroup from './DraftBoxGroup'
import ManuscriptGroup from './ManuscriptGroup'
import VolumeGroup from './VolumeGroup'
import SidebarGroup from './SidebarGroup'

export default function ProjectTree() {
  const { t } = useTranslation()
  const currentProject = useProjectStore(s => s.currentProject)

  // refreshFileTree / loadAllDrafts 在 refreshAll 内通过 getState() 调用
  // ✅ 只订阅「工作流状态派生 key」（步骤 status 组合）——工作流运行期间
  //    appendText 每 100ms flush 的 activeRuns 引用变化不触发全树重渲染，
  //    只有步骤状态真正变化才刷新（防抖 effect 依赖）
  const workflowKey = useWorkflowStore(s =>
    s.activeRuns.map(r => `${r.id}:${r.status}|${r.steps.map(st => st.status).join(',')}`).join(';'))
  // ✅ 精确订阅，避免 loadAllDrafts 执行后引用变化触发 useCallback/useEffect 循环
  const draftsByChapter = useDraftStore(s => s.draftsByChapter)

  // 存储各架构文件是否有实际内容（已生成）
  const [archStatus, setArchStatus] = useState<Record<string, boolean>>({})
  // 章节蓝图数量
  const [blueprintCount, setBlueprintCount] = useState<number>(-1)

  /** 统一刷新：文件树 + 架构状态 + 草稿列表 + 蓝图数量 */
  // ✅ 用 getState() 获取最新的 action，不作为依赖项，避免重建导致 useEffect 循环
  const refreshAll = useCallback(async () => {

    useProjectStore.getState().refreshFileTree()
    useDraftStore.getState().loadAllDrafts()
    // 通过 Service 层获取架构状态和蓝图数量（避免直接 IPC）
    const { checkArchStatus, getBlueprintCount } = await import('../../../services/architecture-service')
    const [status, count] = await Promise.all([
      checkArchStatus(),
      getBlueprintCount(),
    ])
    setArchStatus(status)
    setBlueprintCount(count)
  }, [])  // ✅ 空依赖：内部用 getState() 获取最新 action，不依赖闭包

  // 项目切换时刷新
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (currentProject) refreshAll()
  }, [currentProject?.path, refreshAll]) // eslint-disable-line react-hooks/exhaustive-deps -- currentProject 对象引用变化不每次都需重跑

  // 工作流步骤状态或整体状态变化时刷新侧边栏（适配多任务）
  // 合并为单一 effect + 防抖，避免一次步骤完成同时触发多次刷新
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!currentProject) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      refreshAll()
    }, 80)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // ✅ 依赖 path 字符串而非 currentProject 对象引用
    //    避免 updateNovelConfig 改变对象引用后触发不必要的 refreshAll
  }, [workflowKey, currentProject?.path, refreshAll]) // eslint-disable-line react-hooks/exhaustive-deps -- currentProject 对象引用变化不触发，仅 path 变化需响应

  if (!currentProject) {
    return (
      <EmptyState
        icon={<span className="text-4xl opacity-60" style={{ color: 'var(--color-text-muted)' }}><FolderOpen size={36} /></span>}
        message={t('project.noProject')}
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

  // 故事架构进度（翻译后的列表用于 UI 展示）
  const archFiles = getArchFiles(t)

  // 故事架构进度
  const archDone = archFiles.filter(f => archStatus[f.key]).length

  return (
    <div className="text-sm space-y-2">
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
        count={
          <span style={{ color: configDone ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
            {configDone ? t('status.configured') : t('status.pendingConfig')}
          </span>
        }
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

      {/* 2. 故事架构 — 点击标题行打开编辑器，子文件仍可单独点开 */}
      <WorldBuildingGroup archStatus={archStatus} archDone={archDone} archFiles={archFiles} />

      {/* 3. 章节蓝图（单行入口块：标题行点击打开编辑器页） */}
      <SidebarGroup
        icon={<LayoutList size={12} />}
        title={t('mention.blueprint')}
        collapsible={false}
        count={
          <span style={{
            color: blueprintCount >= nc.totalChapters
              ? 'var(--color-success)'
              : blueprintCount > 0
                ? 'var(--color-warning, #eab308)'
                : 'var(--color-text-muted)',
          }}
          >
            {blueprintCount > 0 ? `${blueprintCount}/${nc.totalChapters} ${t('unit.chapters')}` : t('status.pendingGen')}
          </span>
        }
        onTitleClick={() => openBuiltinEditor('chapter-card-editor', t('mention.blueprint'), 'chapter-card')}
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
      <VolumeGroup
        projectPath={p}
        totalChapters={nc.totalChapters}
        chaptersForVolume={(v) => Object.entries(draftsByChapter)
          .map(([num, drafts]) => {
            const n = parseInt(num, 10)
            return { n, drafts }
          })
          .filter(({ n }) => n >= v.chapterStart && (v.chapterEnd === 0 || n <= v.chapterEnd))
          .map(({ n, drafts }) => {
            // 最新草稿 = 数组首位（loadAllDrafts 按 version 降序）
            const latest = drafts[0]
            return {
              chapterNumber: n,
              chapterTitle: latest?.chapterTitle || '',
              hasFinalized: drafts.some(d => d.status === 'finalized'),
            }
          })
          .sort((a, b) => a.chapterNumber - b.chapterNumber)}
        finalizedCountForVolume={(v) => Object.entries(draftsByChapter)
          .filter(([num, drafts]) => {
            const n = parseInt(num, 10)
            return n >= v.chapterStart && (v.chapterEnd === 0 || n <= v.chapterEnd) && drafts.some(d => d.status === 'finalized')
          }).length}
        onOpenDraft={(n, title) => { void openDraftByChapter(n, title) }}
      />

      {/* 4. 草稿箱 — 独立分区，按章节分组展示草稿 */}
      <DraftBoxGroup draftsByChapter={draftsByChapter} />

      {/* 5. 正文章节 — 仅显示已定稿 */}
      <ManuscriptGroup files={manuscriptFiles} projectPath={p} />
    </div>
  )
}


// ===== 故事架构折叠组 =====

function WorldBuildingGroup({
  archStatus,
  archDone,
  archFiles,
}: {
  archStatus: Record<string, boolean>
  archDone: number
  archFiles: Array<{ key: string; fileName: string; label: string; iconName: string; desc: string }>
}) {
  const { t } = useTranslation()

  const allDone = archDone === archFiles.length

  return (
    <SidebarGroup
      icon={<FolderTree size={12} />}
      title={t('editor.storyArch')}
      count={
        <span style={{
          color: allDone
            ? 'var(--color-success)'
            : archDone > 0
              ? 'var(--color-warning, #eab308)'
              : 'var(--color-text-muted)',
        }}
        >
          {archDone}/{archFiles.length}
        </span>
      }
      onTitleClick={() => openBuiltinEditor('world-building-editor', t('editor.storyArch'), 'world-building')}
      titleHint={t('tip.openArchEditor')}
    >
      {/* 子文件列表（点击直接在 Markdown 编辑器打开） */}
      <div className="mt-1">
        {archFiles.map(f => {
          const isGenerated = archStatus[f.key]
          const filePath = `vela://core/${f.key}`
          return (
            <ArchFileRow
              key={f.key}
              f={f}
              filePath={filePath}
              isGenerated={isGenerated}
            />
          )
        })}
      </div>
    </SidebarGroup>
  )
}

/** 单个架构文件行 */
function ArchFileRow({
  f,
  filePath,
  isGenerated,
}: {
  f: { key: string; iconName: string; label: string; desc: string }
  filePath: string
  isGenerated: boolean
}) {
  const { t } = useTranslation()
  return (
    <div
      className="tree-item gap-1.5 cursor-pointer select-none"
      style={{ paddingLeft: 26 }}
      onClick={() => openArchFile(filePath, `${f.label}`)}
      onContextMenu={e => showSidebarMenu([
        {
          key: 'open',
          label: t('action.openFile'),
          icon: <FolderOpen size={13} />,
          onClick: () => openArchFile(filePath, `${f.label}`),
        },
        { key: 'div1', type: 'divider' as const },
        {
          key: 'copy-path',
          label: t('action.copyPath'),
          icon: <Copy size={13} />,
          onClick: () => navigator.clipboard.writeText(filePath).catch(() => { }),
        },
      ], e)}
      title={f.desc}
    >
      {isGenerated
        ? <CheckCircle2 size={10} style={{ flexShrink: 0, color: 'var(--color-success)' }} />
        : <Circle size={6} style={{ flexShrink: 0, fill: 'transparent', stroke: 'var(--color-text-muted)' }} />
      }
      <span className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>{renderIcon(f.iconName, 13)}</span>
      <span
        className="text-sm flex-1 truncate"
        style={{ color: isGenerated ? 'var(--color-text)' : 'var(--color-text-secondary)' }}
      >
        {f.label}
      </span>
      {!isGenerated && (
        <span className="text-[0.7rem] flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
          {t('status.pendingGen')}
        </span>
      )}
    </div>
  )
}
