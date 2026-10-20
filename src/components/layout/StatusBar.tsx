import { useState, useEffect, useRef } from 'react'
import { Wifi, BookOpen, DollarSign, CheckCircle2, ZoomIn, ZoomOut, Bot, GitBranch } from 'lucide-react'
import { useLLMStore } from '../../stores/llm-store'
import { useLayoutStore } from '../../stores/layout-store'
import { useEditorStore } from '../../stores/editor-store'
import { t } from '../../shared/locale'
import { useTranslation } from '../../hooks/useTranslation'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useAgentStore } from '../../stores/agent-store'
import { useProjectStore } from '../../stores/project-store'
import { useUsageStore } from '../../stores/usage-store'
import { useThemeStore } from '../../stores/theme-store'
import { useOutsideClick } from '../../hooks/useOutsideClick'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useFloatingPosition } from '../../hooks/useFloatingPosition'
import { confirm } from '../ui/Confirm'
import { PopoverSurface } from '../ui/PopoverSurface'
import { MenuItem } from '../ui/MenuItem'
import NotificationCenter from './NotificationCenter'
import StatusBarThinking from './StatusBarThinking'
import { StatusBarDivider, StatusBarSegment } from './StatusBarSegment'
import type { ModelProfile } from '../../shared/ipc-channels'

/** 底部状态栏 — Cursor / VS Code 口径：24px、深底、多分段、hover 可点击感 */
export default function StatusBar() {
  const models = useLLMStore(s => s.models)
  const defaultModelId = useLLMStore(s => s.defaultModelId)
  const defaultModel = models.find(
    (m) => m.id === defaultModelId && m.purposes?.some((p) => p !== 'embedding')
  )

  return (
    <div
      className="no-select flex items-center justify-between"
      style={{
        height: 'var(--height-statusbar)',  /* 24px */
        backgroundColor: 'var(--color-statusbar)',
        color: 'var(--color-statusbar-text)',
        fontSize: "var(--text-micro)",
        flexShrink: 0,
        borderTop: '1px solid var(--color-border)',
      }}
    >
      {/* 左侧：品牌 + 版本。**项目名不在这里** —— 它已归顶栏（2026-09-25 拍板：
          同一信息只出现一次；顶栏那条同时是任务栏/Alt-Tab 看得到的窗口标题来源，
          见 lib/window-title）。版本号留在状态栏的理由：截图报 bug 时它是必需的。 */}
      <div className="flex items-center h-full">
        <StatusBarSegment title="NovelForge IDE">
          <BookOpen size={11} />
          <span className="font-medium brand-gradient">NovelForge</span>
          <span className="opacity-80 brand-gradient">v{__APP_VERSION__}</span>
        </StatusBarSegment>

        {/* 设置入口已于 2026-09-22 迁到左侧图标栏底部（图标形式）——
            这里的文字入口对非中文使用者不友好，移除避免重复入口 */}

        {/* 当前激活章节的写作信息（章节名 / 字数 / dirty 点）——10-18 评审补齐
            （写作中确认状态无需再把视线移到编辑器头部） */}
        <EditorStatusSegment />
        <BranchStatusSegment />

      </div>

      {/* 右侧：费用 + AI 胶囊 + 思考等级 + 模型名 + 缩放（缩放由 ZoomControl 提供） */}
      <div className="flex items-center h-full">
        <AgentStatusSegment />
        <SessionCost />
        {/* AI 任务胶囊指示器（右下角） */}
        <AITaskCapsule />

        {/* 思考等级（全局四档，取代旧的水温控件） */}
        <StatusBarThinking />

        <ModelPicker models={models} defaultModel={defaultModel} />

        {/* 消息收纳中心（铃铛 + 未读角标）— 落在状态栏最右段、缩放控件左侧 */}
        <NotificationCenter />

        {/* 缩放控制 — 原标题栏控件，标题栏移除后搬入状态栏右侧（VSCode 的缩放也在这个位置） */}
        <StatusBarDivider />
        <ZoomControl />
      </div>
    </div>
  )
}


/**
 * 状态栏左段 —— 当前激活章节的写作信息（章节名 + 字数 + 未保存圆点）。
 *
 * 用三个**独立原子 selector** 订阅（各自返回原始值，值不变不重渲染）：
 *   - name / dirty：从 activeTab 派生，只在切 Tab / 置脏 / 保存时变化；
 *   - activeCharCount：ProseEditorWrapper 在 onCharCountChange 里上抛（随输入实时变）。
 * 整段在键入时只有字数这个 number 变化触发重渲染，不影响状态栏其余分段（模型/思考等级等）。
 */
function EditorStatusSegment() {
  const { t } = useTranslation()
  const name = useEditorStore(s => {
    const tab = s.tabs.find(x => x.id === s.activeTabId)
    return tab && tab.type === 'chapter' ? tab.name : ''
  })
  const dirty = useEditorStore(s => {
    const tab = s.tabs.find(x => x.id === s.activeTabId)
    return tab ? tab.type === 'chapter' && !!tab.dirty : false
  })
  const charCount = useEditorStore(s => s.activeCharCount)
  // 初次打开草稿时 CodeMirror 尚未触发 onCharCountChange（只在上抛路径更新），
  // 状态栏不能因此空着——用当前 tab 内容长度兜底，保存/切换后仍以实时上抛值优先。
  const fallbackCharCount = useEditorStore(s => {
    const tab = s.tabs.find(x => x.id === s.activeTabId)
    return tab && tab.type === 'chapter' ? (tab.content?.length ?? 0) : 0
  })
  const effectiveCharCount = charCount > 0 ? charCount : fallbackCharCount

  if (!name) return null

  return (
    <StatusBarSegment title={`${name}${charCount > 0 ? ` · ${charCount.toLocaleString()} ${t('unit.chars')}` : ''}`}>
      <span className="truncate max-w-[180px]">{name}</span>
      {effectiveCharCount > 0 && (
        <span className="tabular-nums">{effectiveCharCount.toLocaleString()} {t('unit.chars')}</span>
      )}
      <span
        className="inline-flex items-center gap-1 flex-shrink-0"
        style={{ color: dirty ? 'var(--color-warning)' : 'var(--color-text-muted)' }}
      >
        {dirty ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--color-warning)' }} />
            {t('statusbar.unsavedShort')}
          </>
        ) : (
          <>
            <CheckCircle2 size={10} />
            {t('statusbar.saved')}
          </>
        )}
      </span>
    </StatusBarSegment>
  )
}

/** 版本线（分支）常显段：当前章节的版本/分支入口，点击打开版本历史与 diff。 */
function BranchStatusSegment() {
  const { t } = useTranslation()
  const hasProject = useProjectStore((s) => !!s.currentProject)
  const chapterName = useEditorStore((s) => {
    const tab = s.tabs.find((x) => x.id === s.activeTabId)
    return tab?.type === 'chapter' ? tab.name : ''
  })
  if (!hasProject && !chapterName) return null

  const openHistory = () => {
    const store = useEditorStore.getState()
    const existing = store.tabs.find((tab) => tab.type === 'version-history')
    if (existing) store.setActiveTab(existing.id)
    else store.openFile({ id: 'version-history', name: t('version.history'), type: 'version-history' })
  }

  return (
    <StatusBarSegment title={chapterName ? t('statusbar.branchTip') : t('version.history')} onClick={openHistory}>
      <GitBranch size={11} />
      <span>{t('statusbar.branchMain')}</span>
    </StatusBarSegment>
  )
}

/** Agent 常显段：空闲/生成中一眼可见，点击聚焦右侧 Agent 面板。 */
function AgentStatusSegment() {
  const { t } = useTranslation()
  const generating = useAgentStore((s) => s.generating)
  const openRightPanel = useLayoutStore((s) => s.openRightPanel)

  return (
    <StatusBarSegment
      title={generating ? t('statusbar.agentWorkingTip') : t('statusbar.agentIdleTip')}
      onClick={() => openRightPanel('agent')}
    >
      <Bot size={11} style={{ color: generating ? 'var(--color-accent)' : undefined }} />
      <span>Agent</span>
      <span style={{ color: generating ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>
        {generating ? t('statusbar.agentWorking') : t('statusbar.agentIdle')}
      </span>
    </StatusBarSegment>
  )
}

/**
 * 右下角的**模型选择器**（2026-09-25）。
 *
 * 此前这一段只显示当前模型、点击是「打开设置 → 模型页」—— 换模型要翻进设置里找。
 * 改成直接列出可选的生成模型，点一下即切换（`setDefaultModel` 会持久化到 config.json）。
 * 浮层底部保留「管理模型…」入口，需要增删改时仍能一步到位。
 */
function ModelPicker({
  models,
  defaultModel,
}: {
  models: ModelProfile[]
  defaultModel: ModelProfile | undefined
}) {
  const { t } = useTranslation()
  const openSettings = useLayoutStore((s) => s.openSettings)
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  // 状态栏在窗口底部 → 朝上展开（与思考等级弹层同款）
  const menuRef = useFloatingPosition<HTMLDivElement>(panelRef, open, { placement: 'above', align: 'end' })

  useOutsideClick(panelRef, () => setOpen(false), open)
  useEscapeKey(() => setOpen(false), open)

  // 只列**生成类**模型：embedding 模型不能用于对话，列进来点了会报错
  const chatModels = models.filter((m) => m.purposes?.some((p) => p !== 'embedding'))

  const choose = (id: string) => {
    useLLMStore.getState().setDefaultModel(id)
    setOpen(false)
  }

  return (
    <div ref={panelRef} className="relative">
      <StatusBarSegment
        title={
          defaultModel
            ? `${t('statusbar.selectModel')}: ${defaultModel.modelName}`
            : t('statusbar.clickToConfig')
        }
        onClick={() => setOpen((v) => !v)}
      >
        <Wifi size={11} />
        <span className={`opacity-80 max-w-[120px] truncate ${defaultModel ? '' : 'opacity-50'}`}>
          {defaultModel ? defaultModel.name : t('statusbar.noModel')}
        </span>
      </StatusBarSegment>

      {open && (
        <PopoverSurface
          ref={menuRef}
          className="py-1"
          style={{ width: 240, maxHeight: 280, overflowY: 'auto' }}
        >
          {chatModels.length === 0 ? (
            <div className="px-3 py-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {t('statusbar.noModel')}
            </div>
          ) : (
            chatModels.map((m) => (
              <MenuItem
                key={m.id}
                label={m.name}
                selected={m.id === defaultModel?.id}
                onClick={() => choose(m.id)}
              />
            ))
          )}
          <div style={{ borderTop: '1px solid var(--color-border)', margin: '4px 0' }} />
          <MenuItem
            label={t('statusbar.manageModels')}
            onClick={() => {
              setOpen(false)
              openSettings('llm')
            }}
          />
        </PopoverSurface>
      )}
    </div>
  )
}

// ===== AI 任务胶囊指示器（Layer 1）=====

/**
 * StatusBar 中心区域的 AI 工作流胶囊
 * - 无任务时不渲染
 * - 有任务时显示步骤名 + 微型进度条 + 百分比
 * - 多任务时显示 "N个任务运行中"
 * - 完成后短暂显示 ✅ 然后淡出
 */
/** 会话费用显示（点击重置需二次确认，避免误触清零统计） */
function SessionCost() {
  const cost = useUsageStore(s => s.getFormattedCost())
  const cacheHits = useUsageStore(s => s.cacheHits)
  const sessionCost = useUsageStore(s => s.sessionCost)

  if (sessionCost < 0.001) return null

  const handleReset = async () => {
    const ok = await confirm(t('statusbar.resetCostConfirm'), {
      title: t('statusbar.resetCostTitle'),
      confirmText: t('action.reset'),
      danger: true,
    })
    if (ok) useUsageStore.getState().resetSession()
  }

  return (
    <div
      className="flex items-center gap-1 px-2 h-full text-xs cursor-pointer"
      style={{ color: 'var(--color-statusbar-text)' }}
      title={`${t('statusbar.cacheHit')}: ${cacheHits} ${t('statusbar.calls')} | ${t('statusbar.clickReset')}`}
      onClick={handleReset}
    >
      <DollarSign size={10} className="opacity-60" />
      <span className="opacity-80 tabular-nums">{cost}</span>
    </div>
  )
}

function AITaskCapsule() {
  // ✅ 使用 selector 精确订阅，避免 globalLogs 等高频字段导致被动重渲染
  const activeRuns = useWorkflowStore(s => s.activeRuns)
  const getActiveStepInfo = useWorkflowStore(s => s.getActiveStepInfo)
  // 使用 string 而非 object，避免引用变化导致不必要的 effect 重触发
  const [completedTitle, setCompletedTitle] = useState<string | null>(null)

  // 监听任务从有到无的转换，短暂显示完成态
  useEffect(() => {
    if (activeRuns.length === 0 && completedTitle) {
      const timer = setTimeout(() => setCompletedTitle(null), 1800)
      return () => clearTimeout(timer)
    }
  }, [activeRuns.length, completedTitle])

  // 监听任务完成事件：当活跃列表刚变为空时触发（只依赖 activeRuns.length）
  useEffect(() => {
    if (activeRuns.length > 0) return // 还有活跃任务，不做操作
    const { history } = useWorkflowStore.getState()
    if (history.length > 0) {
      const latest = history[0]
      if (latest.status === 'completed') {
        // ✅ 使用函数式更新，只有值实际不同时才触发重渲染
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCompletedTitle(prev => {
          const newTitle = latest.title
          return prev === newTitle ? prev : newTitle
        })
      }
    }
  }, [activeRuns.length])

  const stepInfo = getActiveStepInfo()

  // 完成态渲染
  if (!stepInfo && completedTitle) {
    return (
      <div
        className="ai-task-capsule ai-task-capsule--complete"
        onClick={() => useLayoutStore.getState().openRightPanel('ai-output')}
      >
        <CheckCircle2 size={10} />
        <span className="truncate">{completedTitle.replace(/^[^\s]+\s/, '')}{' '}{t('statusbar.done')}</span>
      </div>
    )
  }

  // 无任务
  if (!stepInfo) return null

  const { stepName, progress, total, completed } = stepInfo

  // 多任务模式
  if (activeRuns.length > 1) {
    return (
      <div
        className="ai-task-capsule"
        onClick={() => useLayoutStore.getState().openRightPanel('ai-output')}
        title={t('statusbar.clickToViewProgress')}
      >
        {/* 脉冲圆点 */}
        <span
          className="w-[5px] h-[5px] rounded-full animate-pulse flex-shrink-0"
          style={{ backgroundColor: 'var(--color-accent)' }}
        />
        <span>{activeRuns.length}{t('statusbar.tasksRunning')}</span>
      </div>
    )
  }

  // 单任务模式：步骤名 + 微型进度条 + 百分比
  const effectiveProgress = Math.max(5, progress)
  return (
    <div
      className="ai-task-capsule"
      onClick={() => useLayoutStore.getState().openRightPanel('ai-output')}
      title={t('statusbar.clickToViewAIDetail')}
    >
      {/* 脉冲圆点 */}
      <span
        className="w-[5px] h-[5px] rounded-full animate-pulse flex-shrink-0"
        style={{ backgroundColor: 'var(--color-accent)' }}
      />
      {/* 步骤名（截断） */}
      <span className="truncate max-w-[120px]">{stepName}</span>
      {/* 微型进度条 */}
      <div
        style={{
          width: 40,
          height: 2,
          borderRadius: 1,
          backgroundColor: 'rgba(var(--color-accent-rgb), 0.2)',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${effectiveProgress}%`,
            backgroundColor: 'var(--color-accent)',
            borderRadius: 1,
            transition: 'width 0.5s ease',
          }}
        />
      </div>
      {/* 进度百分比 */}
      <span className="font-mono text-2xs flex-shrink-0 opacity-80">
        {completed}/{total}
      </span>
    </div>
  )
}


/**
 * 缩放控制 — 原标题栏控件，标题栏移除后搬到状态栏右侧（VSCode 的缩放同样在状态栏）。
 * 快捷键（Ctrl/⌘ + = / - / 0）由 App.tsx 统一注册，此处只是可视化入口。
 */
function ZoomControl() {
  const { t } = useTranslation()
  // 原子 selector：仅订阅缩放相关字段，不随主题/字体等无关字段变化重渲染
  const zoom = useThemeStore(s => s.zoom)
  const zoomIn = useThemeStore(s => s.zoomIn)
  const zoomOut = useThemeStore(s => s.zoomOut)
  const zoomReset = useThemeStore(s => s.zoomReset)
  const mod = navigator.userAgent.includes('Mac') ? '⌘' : 'Ctrl'
  const zoomLabel = `${Math.round(zoom * 100)}%`
  const btn: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    minWidth: 16,
    padding: 0,
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: 'inherit',
    opacity: 0.75,
    transition: 'opacity var(--transition-fast)',
  }
  return (
    <div className="flex items-center h-full gap-0.5 px-1">
      <button
        onClick={zoomOut}
        title={`${t('zoom.out')} (${mod}+-)`}
        style={btn}
        onMouseEnter={e => { e.currentTarget.style.opacity = '1' }}
        onMouseLeave={e => { e.currentTarget.style.opacity = '0.75' }}
      >
        <ZoomOut size={11} strokeWidth={1.5} />
      </button>
      {/* 百分比：点击重置为 100%；非 100% 时用强调色提示已缩放 */}
      <button
        onClick={zoomReset}
        title={`${t('zoom.reset')} (${mod}+0)`}
        style={{
          ...btn,
          minWidth: 34,
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-2xs)',
          fontVariantNumeric: 'tabular-nums',
          color: zoom !== 1.0 ? 'var(--color-accent)' : 'inherit',
          opacity: 1,
        }}
      >
        {zoomLabel}
      </button>
      <button
        onClick={zoomIn}
        title={`${t('zoom.in')} (${mod}+=)`}
        style={btn}
        onMouseEnter={e => { e.currentTarget.style.opacity = '1' }}
        onMouseLeave={e => { e.currentTarget.style.opacity = '0.75' }}
      >
        <ZoomIn size={11} strokeWidth={1.5} />
      </button>
    </div>
  )
}
