import { PenTool } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../hooks/useTranslation'
import { ipc } from '../../services/ipc-client'
import { globalEventBus } from '../../shared/event-bus'
import { useEditorStore } from '../../stores/editor-store'
import { useLayoutStore } from '../../stores/layout-store'
import { useProjectStore } from '../../stores/project-store'
import EditorDocumentView from '../editor/EditorDocumentView'
import EditorTabBar from '../editor/EditorTabBar'
import KnowledgeOverview, { type KnowledgeSection } from '../pages/KnowledgeOverview'
import WelcomePage from '../pages/WelcomePage'
import { EmptyState } from '../ui/EmptyState'

interface EditorAreaProps {
  onNewProject: () => void
}

/** 中间主编辑区 */
export default function EditorArea({ onNewProject }: EditorAreaProps) {
  const { t } = useTranslation()
  const currentProject = useProjectStore((s) => s.currentProject)
  const projectSession = useProjectStore(s => s.projectSession)
  const tabs = useEditorStore(s => s.tabs)
  const activeTabId = useEditorStore(s => s.activeTabId)
  const setActiveTab = useEditorStore(s => s.setActiveTab)
  const sidebarView = useLayoutStore((s) => s.sidebarView)

  // 防御性兜底：tabs 有内容但 activeTabId 无效时，激活第一个 tab
  const activeTab = tabs.find((t) => t.id === activeTabId)
  useEffect(() => {
    if (tabs.length > 0 && !activeTab) {
      setActiveTab(tabs[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length, activeTab])

  // 侧栏切到「角色管理」时：自动打开角色编辑器 Tab（图谱/编辑可见，
  // Tab 栏保持可管理 — 其他 Tab 可正常关闭/切换）；
  // 切走角色管理时自动关闭角色 Tab（视图驱动 Tab 的生命周期与视图绑定，
  // 避免残留：切到知识库/工作台后编辑器仍显示角色编辑区）
  useEffect(() => {
    const { tabs: ts, openFile, closeTab } = useEditorStore.getState()
    if (sidebarView === 'characters') {
      if (ts.some(tab => tab.type === 'character')) return
      openFile({ id: 'character-editor', name: t('character.viewProfile'), type: 'character' })
    } else {
      // dirty 的角色 Tab 保留（有未保存修改，避免静默丢内容），仅关闭干净 Tab
      ts.filter(tab => tab.type === 'character' && !tab.dirty).forEach(tab => closeTab(tab.id))
    }
  }, [sidebarView, t])

  // ===== 知识库视图优先 =====
  // 从项目结构/工作台切到知识库时，残留的其他部件 Tab 不再抢占中间区域——
  // 固定显示 KnowledgeOverview（检索界面），无需手动关闭编辑区；
  // Tab 保留在 Tab 栏（dirty 数据安全），用户主动点击 Tab 可切回内容。
  // 视图切换 / 关闭全部 Tab 后回到「视图优先」。
  const [knowledgeTabActive, setKnowledgeTabActive] = useState(false)
  const [knowledgeSection, setKnowledgeSection] = useState<{ session: number; section: KnowledgeSection }>()
  const section = knowledgeSection?.session === projectSession ? knowledgeSection.section : 'overview'
  const selectKnowledgeSection = useCallback((next: KnowledgeSection) => {
    setKnowledgeSection({ session: projectSession, section: next })
  }, [projectSession])

  useEffect(() => globalEventBus.on('OPEN_KNOWLEDGE_SEARCH', () => {
    if (sidebarView !== 'knowledge') return
    selectKnowledgeSection('search')
    setKnowledgeTabActive(false)
  }), [selectKnowledgeSection, sidebarView])

  /** 用户主动激活 Tab（Tab 栏/箭头/菜单 goto）：知识库视图下切到 Tab 内容。稳定引用，供 memo(EditorTabBar) 使用 */
  const onActivateTab = useCallback((id: string) => {
    if (sidebarView === 'knowledge') setKnowledgeTabActive(true)
    useEditorStore.getState().setActiveTab(id)
  }, [sidebarView])

  // 进入知识库视图 → 重置为视图优先（微任务 setState，规避 effect 同步 setState 的级联渲染）
  useEffect(() => {
    if (sidebarView === 'knowledge') {
      Promise.resolve().then(() => setKnowledgeTabActive(false))
    }
  }, [sidebarView])

  // 知识库视图下关闭全部 Tab → 回到视图优先（检索界面）
  useEffect(() => {
    if (sidebarView === 'knowledge' && !activeTabId) {
      Promise.resolve().then(() => setKnowledgeTabActive(false))
    }
  }, [sidebarView, activeTabId])

  // 记忆标签页是**用户点击记忆行**直接打开的（不是程序性后台加载）→ 与「主动点击 Tab」同等对待。
  // 否则在知识库视图下（侧栏为知识库、AI 面板可见）点记忆会开了标签却仍显示检索界面，
  // 看起来像「点了没反应」（review Minor 5）。其他类型的程序化打开仍不抢占视图（见上方注释）。
  useEffect(() => {
    if (sidebarView === 'knowledge' && activeTab?.type === 'memory') {
      Promise.resolve().then(() => setKnowledgeTabActive(true))
    }
  }, [sidebarView, activeTab])

  // ===== 条件渲染 =====

  // 侧栏为「主页」时，中间区域显示欢迎页（有活跃 Tab 时优先显示 Tab 内容）
  if (sidebarView === 'home' && !activeTab) {
    return (
      <WelcomePage
        onNewProject={() => {
          useLayoutStore.getState().openNewProject()
        }}
        onOpenProject={async () => {
          const folder = await ipc.invoke('dialog:select-folder')
          if (folder) {
            useProjectStore.getState().openProject(folder)
          }
        }}
        onImportNovel={() => {
          useLayoutStore.getState().openImportNovel()
        }}
        onOpenSettings={() => {
          useLayoutStore.getState().openSettings()
        }}
        onStartCreate={() => {
          if (useProjectStore.getState().currentProject) useLayoutStore.getState().openChapterCreation()
          else useLayoutStore.getState().openNewProject()
        }}
      />
    )
  }

  // 侧栏为「知识库」时，中间区域固定展示向量数据库查询界面——
  // 残留的其他部件 Tab 不抢占（knowledgeTabActive 仅在用户主动点击 Tab 后置真）
  if (sidebarView === 'knowledge' && !knowledgeTabActive) {
    return <KnowledgeOverview section={section} onSectionChange={selectKnowledgeSection} />
  }

  // 未打开项目时显示欢迎页（有活跃 Tab 时优先显示 Tab 内容，如项目详情 Tab）
  if (!currentProject && !activeTab) {
    return (
      <WelcomePage
        onNewProject={onNewProject}
        onOpenProject={async () => {
          const folder = await ipc.invoke('dialog:select-folder')
          if (folder) {
            useProjectStore.getState().openProject(folder)
          }
        }}
        onImportNovel={() => {
          useLayoutStore.getState().openImportNovel()
        }}
        onOpenSettings={() => {
          useLayoutStore.getState().openSettings()
        }}
        onStartCreate={() => useLayoutStore.getState().openNewProject()}
      />
    )
  }

  // 有项目但没有打开的 Tab
  if (tabs.length === 0) {
    return (
      <div
        className="w-full h-full flex flex-col overflow-hidden"
        style={{ backgroundColor: 'var(--color-editor-bg)' }}
      >
        <div className="flex-1 flex items-center justify-center">
          {/* 图标与文字间距由 EmptyState 的 gap-3（12px）提供，与原 margin-bottom 12px 等值 */}
          <EmptyState
            icon={<PenTool size={36} style={{ color: 'var(--color-text-muted)', opacity: 0.5 }} />}
            message={t('editor.noProject')}
            opacity={0.4}
            className="text-center text-[var(--color-text-secondary)]"
          />
        </div>
      </div>
    )
  }

  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden"
      style={{ backgroundColor: 'var(--color-editor-bg)' }}
    >
      {/* 项目切换时重置标签菜单和确认弹窗。文档视图沿用原有挂载边界。 */}
      <EditorTabBar key={projectSession} onActivateTab={onActivateTab} />

      <div id="active-editor-document" role="tabpanel" aria-label={activeTab?.name} className="flex min-h-0 flex-1 overflow-hidden">
        <EditorDocumentView activeTab={activeTab} projectPath={currentProject?.path} />
      </div>
    </div>
  )
}
