import { useState, useEffect, useRef } from 'react'
import { Wifi, BookOpen, DollarSign, CheckCircle2, FolderOpen, Thermometer } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { useLLMStore } from '../../stores/llm-store'
import { useLayoutStore } from '../../stores/layout-store'
import { t } from '../../shared/locale'
import { useTranslation } from '../../hooks/useTranslation'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useUsageStore } from '../../stores/usage-store'
import { useOutsideClick } from '../../hooks/useOutsideClick'
import { confirm } from '../ui/Confirm'
import type { ModelProfile } from '../../shared/ipc-channels'

/** 底部状态栏 — JetBrains 风格：22px、深灰底、多分段、hover 可点击感 */
export default function StatusBar() {
  const currentProject = useProjectStore((s) => s.currentProject)
  const models = useLLMStore(s => s.models)
  const defaultModelId = useLLMStore(s => s.defaultModelId)
  const openSettings = useLayoutStore(s => s.openSettings)
  const defaultModel = models.find(
    (m) => m.id === defaultModelId && m.purposes?.some((p) => p !== 'embedding')
  )

  return (
    <div
      className="no-select flex items-center justify-between"
      style={{
        height: 'var(--height-statusbar)',  /* 22px */
        backgroundColor: 'var(--color-statusbar)',
        color: 'var(--color-statusbar-text)',
        fontSize: "0.75rem",
        flexShrink: 0,
        borderTop: '1px solid var(--color-border)',
      }}
    >
      {/* 左侧 */}
      <div className="flex items-center h-full">
        <StatusBarSegment title="NovelForge IDE">
          <BookOpen size={11} />
          <span className="font-medium brand-gradient">NovelForge</span>
          <span className="opacity-80 brand-gradient">v{__APP_VERSION__}</span>
        </StatusBarSegment>

        {currentProject && (
          <>
            <StatusBarDivider />
            <StatusBarSegment title={currentProject.path}>
              <FolderOpen size={11} style={{ opacity: 0.7 }} />
              <span className="opacity-80 max-w-[180px] truncate">{currentProject.name}</span>
            </StatusBarSegment>
          </>
        )}

        <StatusBarDivider />
        <StatusBarSegment
          title={t('settings.title')}
          onClick={openSettings}
        >
          <span className="font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t('settings.title')}</span>
        </StatusBarSegment>

      </div>

      {/* 右侧：费用 + AI 胶囊 + 水温 + 模型名 */}
      <div className="flex items-center h-full">
        <SessionCost />
        {/* AI 任务胶囊指示器（右下角） */}
        <AITaskCapsule />

        {/* 水温控制（当前默认模型 temperature，拖动实时预览 + 防抖保存） */}
        <TemperatureControl defaultModel={defaultModel} />

        {defaultModel ? (
          <StatusBarSegment
            title={`${t('statusbar.currentModel')}: ${defaultModel.modelName}${defaultModel.name !== defaultModel.modelName ? ` (${defaultModel.name})` : ''}`}
            onClick={() => openSettings('llm')}
          >
            <Wifi size={11} />
            <span className="opacity-80 max-w-[120px] truncate">{defaultModel.name}</span>
          </StatusBarSegment>
        ) : (
          <StatusBarSegment
            title={t('statusbar.clickToConfig')}
            onClick={() => openSettings('llm')}
          >
            <span className="opacity-50">{t('statusbar.noModel')}</span>
          </StatusBarSegment>
        )}
      </div>
    </div>
  )
}


// ===== 水温控制（temperature 快速调节）=====

/**
 * 右下角图标式温度控制：
 * - 状态栏段：温度计图标 + 当前温度值，点击弹出滑块面板
 * - 拖动实时预览（本地 state），300ms 防抖后保存到默认模型（llm:save-model）
 * - 预设快捷：0.3 严谨 / 0.7 平衡 / 1.2 创意
 */
function TemperatureControl({
  defaultModel,
}: {
  defaultModel: ModelProfile | undefined
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [tempDraft, setTempDraft] = useState<number>(defaultModel?.temperature ?? 0.7)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useOutsideClick(panelRef, () => setOpen(false), open)

  // 打开面板时同步当前模型温度（保存成功后 loadModels 刷新引用）
  const handleToggle = () => {
    if (!open && defaultModel) setTempDraft(defaultModel.temperature ?? 0.7)
    setOpen(v => !v)
  }

  const handleTempChange = (v: number) => {
    const rounded = Math.round(v * 100) / 100
    setTempDraft(rounded)
    if (!defaultModel) return
    // 防抖：拖动时只更新本地预览，停顿 300ms 后写盘
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void useLLMStore.getState().saveModel({ ...defaultModel, temperature: rounded })
    }, 300)
  }

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
  }, [])

  if (!defaultModel) return null

  const presets = [
    { label: t('statusbar.temperatureLow'), value: 0.3 },
    { label: t('statusbar.temperatureMid'), value: 0.7 },
    { label: t('statusbar.temperatureHigh'), value: 1.2 },
  ]

  return (
    <div ref={panelRef} className="relative">
      <StatusBarSegment
        title={`${t('statusbar.temperature')}: ${(defaultModel.temperature ?? 0.7).toFixed(2)}`}
        onClick={handleToggle}
      >
        <Thermometer size={11} />
        <span className="opacity-80 tabular-nums">{(defaultModel.temperature ?? 0.7).toFixed(2)}</span>
      </StatusBarSegment>

      {open && (
        <div
          className="absolute bottom-[calc(100%+6px)] right-0 z-[var(--z-dropdown)] py-2 px-3 rounded-lg shadow-lg"
          style={{
            width: 200,
            backgroundColor: 'var(--color-sidebar)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          }}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[0.7rem] font-medium" style={{ color: 'var(--color-text)' }}>
              {t('statusbar.temperature')}
            </span>
            <span className="text-[0.7rem] tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
              {tempDraft.toFixed(2)}
            </span>
          </div>

          {/* 温度滑块 */}
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={tempDraft}
            onChange={e => handleTempChange(parseFloat(e.target.value))}
            style={{
              width: '100%',
              accentColor: 'var(--color-accent)',
              cursor: 'pointer',
            }}
          />

          {/* 预设快捷 */}
          <div className="flex items-center gap-1 mt-2">
            {presets.map(p => (
              <button
                key={p.value}
                type="button"
                onClick={() => handleTempChange(p.value)}
                className="flex-1 py-0.5 rounded text-[0.65rem] transition-colors cursor-pointer"
                style={{
                  color: tempDraft === p.value ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                  backgroundColor: tempDraft === p.value ? 'rgba(var(--color-accent-rgb), 0.1)' : 'transparent',
                }}
                onMouseEnter={e => {
                  if (tempDraft !== p.value) e.currentTarget.style.backgroundColor = 'var(--color-hover)'
                }}
                onMouseLeave={e => {
                  if (tempDraft !== p.value) e.currentTarget.style.backgroundColor = 'transparent'
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
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
      <span className="font-mono text-[0.62rem] flex-shrink-0 opacity-80">
        {completed}/{total}
      </span>
    </div>
  )
}


/** 状态栏分段（可点击） */
function StatusBarSegment({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode
  title?: string
  onClick?: () => void
}) {
  return (
    <div
      className="flex items-center gap-1 px-2 h-full cursor-default transition-colors"
      title={title}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      onMouseEnter={e => {
        if (onClick) {
          e.currentTarget.style.backgroundColor = 'rgba(var(--color-accent-rgb), 0.08)'
        }
      }}
      onMouseLeave={e => {
        e.currentTarget.style.backgroundColor = 'transparent'
      }}
    >
      {children}
    </div>
  )
}

/** 状态栏分隔符 */
function StatusBarDivider() {
  return (
    <span style={{ opacity: 0.25, fontSize: "0.75rem", userSelect: 'none' }}>|</span>
  )
}
