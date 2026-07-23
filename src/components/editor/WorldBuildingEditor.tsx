import { useState, useEffect, useCallback } from 'react'
import { Sparkles, CheckCircle2, Circle, RefreshCw, FileText, BookOpen, AlertTriangle, FolderTree } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { useCharacterStore } from '../../stores/character-store'
import { renderIcon } from '../panels/sidebar/SidebarShared'
import { useTranslation } from '../../hooks/useTranslation'
import type { TextKey } from '../../shared/locale'

import ArchitectureConfirmDialog from '../dialogs/ArchitectureConfirmDialog'

import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { VELA } from '../../services/vela-protocol'
import { ipc } from '../../services/ipc-client'

import { ARCH_CHARACTER_SCOPE, runArchCharacterExtract, createArchitectureWorkflow } from '../../services/workflows/architecture-workflow'
import { readPostProcessStatus, type PostProcessStatus } from '../../services/workflows/workflow-utils'
import { globalEventBus } from '../../shared/event-bus'

type ArchStepKey = 'premise' | 'characters' | 'worldbuilding' | 'synopsis'

type ArchFileItem = {
  key: ArchStepKey
  fileName: string
  label: string
  iconName: string
  desc: string
}

function getArchFiles(t: (key: TextKey) => string): ArchFileItem[] {
  return [
    { key: 'premise', fileName: 'premise.md', label: t('arch.storyPremise'), iconName: 'target', desc: t('arch.premiseFileDesc') },
    { key: 'characters', fileName: 'characters.md', label: t('arch.characterMap'), iconName: 'users', desc: t('arch.characterFileDesc') },
    { key: 'worldbuilding', fileName: 'worldbuilding.md', label: t('arch.worldBuilding'), iconName: 'globe', desc: t('arch.worldBuildingFileDesc') },
    { key: 'synopsis', fileName: 'synopsis.md', label: t('arch.plotOutline'), iconName: 'map', desc: t('arch.synopsisFileDesc') },
  ]
}

/** 故事架构编辑器 — 显示四个架构文件状态，并提供 AI 生成入口 */
export default function WorldBuildingEditor() {
  // ✅ 精确订阅，避免 novelConfig 等变化导致不必要的 loadStatus 重建
  const currentProject = useProjectStore(s => s.currentProject)
  const characters = useCharacterStore(s => s.characters)
  // 角色数据由 ProjectService 统一加载，组件只消费
  const characterCount = characters.length
  const [archStatus, setArchStatus] = useState<Record<string, boolean>>({})
  const [wordCounts, setWordCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [showArchDialog, setShowArchDialog] = useState(false)
  const [extracting, setExtracting] = useState(false)
  // 用于强制刷新 PostProcessStatusPanel 的 key
  const [, setPostProcessKey] = useState(0)
  // 角色卡后处理状态（用于控制卡片边框颜色）
  const [charExtractStatus, setCharExtractStatus] = useState<PostProcessStatus | null>(null)

  const { t } = useTranslation()
  const archFiles = getArchFiles(t)

  /** 加载各架构文件状态（通过 Service 层获取，不直接调 IPC） */
  const loadStatus = useCallback(async () => {
    if (!currentProject) return
    setLoading(true)
    const { checkArchStatusWithWordCount } = await import('../../services/architecture-service')
    const { status, wordCounts: counts } = await checkArchStatusWithWordCount()
    setArchStatus(status)
    setWordCounts(counts)
    setLoading(false)
  }, [currentProject?.path])

  useEffect(() => { loadStatus() }, [loadStatus])

  /** 加载角色卡后处理状态 */
  const loadCharExtractStatus = useCallback(async () => {
    if (!currentProject) return
    const s = await readPostProcessStatus(currentProject.path, ARCH_CHARACTER_SCOPE)
    setCharExtractStatus(s)
  }, [currentProject?.path])

  useEffect(() => { loadCharExtractStatus() }, [loadCharExtractStatus])

  // 监听 EventBus 事件，刷新后处理状态面板
  useEffect(() => {
    const unsub1 = globalEventBus.on('ARCH_POSTPROCESS_UPDATED', () => {
      setPostProcessKey(k => k + 1)
      loadCharExtractStatus()
      setExtracting(false)
    })
    const unsub2 = globalEventBus.on('CHARACTER_EXTRACT_FAILED', () => {
      setPostProcessKey(k => k + 1)
      loadCharExtractStatus()
      setExtracting(false)
    })
    // 每步架构文件写完后实时刷新状态
    const unsub3 = globalEventBus.on('ARCH_FILE_UPDATED', () => {
      loadStatus()
    })
    // 整个工作流完成后也刷新一次
    const unsub4 = globalEventBus.on('WORKFLOW_COMPLETE', (payload) => {
      if (payload.type === 'architecture_generation') {
        loadStatus()
      }
    })
    return () => { unsub1(); unsub2(); unsub3(); unsub4() }
  }, [loadCharExtractStatus, loadStatus])



  /** 从角色图谱提取角色卡（首次提取 / 重新提取） */
  const handleExtractCharacters = useCallback(async () => {
    if (!currentProject || extracting) return
    setExtracting(true)
    try {
      const core = await ipc.invoke('db:project-core-get')
      const charArch = core?.charactersArch ?? ''
      if (charArch.length < 50) {
        console.error('角色图谱不存在或内容不完整')
        setExtracting(false)
        return
      }
      runArchCharacterExtract(currentProject.path, charArch, currentProject.novelConfig.genre)
    } catch (e) {
      console.error('角色卡提取失败', e)
      setExtracting(false)
    }
  }, [currentProject, extracting])

  /** 打开单个架构文件（arch-file 类型；若 tab 已存在则刷新磁盘内容） */
  const openArchFile = async (f: ArchFileItem) => {
    if (!currentProject) return
    const filePath = `${VELA.CORE}${f.key}`
    const core = (await ipc.invoke('db:project-core-get')) as Record<string, unknown> | null
    const propertyKey = f.key === 'characters' ? 'charactersArch' : f.key
    const content = (core && (core[propertyKey] as string)) || ''

    const { useEditorStore } = await import('../../stores/editor-store')
    const store = useEditorStore.getState()
    const existingTab = store.tabs.find(t => t.id === filePath)
    if (existingTab) {
      // tab 已存在：切换 + 静默刷新磁盘内容（不标记脚数据）
      store.setActiveTab(filePath)
      store.syncTabContent(filePath, content)
    } else {
      store.openFile({
        id: filePath,
        name: `${f.label}`,
        type: 'arch-file',
        filePath,
        content,
      })
    }
  }

  /** 确认后启动架构工作流 */
  const handleConfirm = async (selectedSteps: ArchStepKey[], stepGuidance: Record<string, string>) => {
    const { useWorkflowStore } = await import('../../stores/workflow-store')
    useWorkflowStore.getState().startWorkflow(createArchitectureWorkflow({ selectedSteps, stepGuidance }))
  }

  if (!currentProject) {
    return (
      <div className="h-full flex flex-col overflow-hidden bg-[var(--color-bg)]">
        <div
          className="flex items-center justify-between gap-2 px-3 h-9 flex-shrink-0"
          style={{
            borderBottom: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-editor-bg)',
          }}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-medium truncate text-[var(--color-text-secondary)]">
              {t('editor.storyArch')}
            </span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto relative">
          <EmptyState icon={<BookOpen size={36} />} message={t('empty.pleaseOpenProject')} opacity={0.4} />
        </div>
      </div>
    )
  }

  const generatedCount = archFiles.filter(f => archStatus[f.key]).length

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 顶部工具栏 */}
      <div
        className="flex items-center justify-between gap-2 px-3 h-10 flex-shrink-0 border-b"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-sidebar)' }}
      >
        <div className="flex items-center gap-1.5">
          <FolderTree size={14} style={{ color: 'var(--color-text-muted)' }} />
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            {t('editor.storyArch')}
          </span>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('arch.progress').replace('{n}', String(generatedCount)).replace('{total}', String(archFiles.length))}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={loadStatus}
            title={t('tip.refreshStatus')}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </Button>
          {/* AI 生成架构 — 与小说配置/章节蓝图保持一致的按钮位置 */}
          <Button
            variant="ai"
            size="sm"
            onClick={() => setShowArchDialog(true)}
            title={t('tip.regenerateArch')}
          >
            <Sparkles size={12} />
            {t('arch.aiGenBtn')}
          </Button>
        </div>
      </div>

      {/* 文件卡片列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {archFiles.map(f => {
          const generated = archStatus[f.key]
          const words = wordCounts[f.key] ?? 0
          const isCharacters = f.key === 'characters'
          // 角色图谱卡片：提取失败时显示红色警告
          const charExtractFailed = isCharacters && charExtractStatus && !charExtractStatus.allCriticalPassed
          // 动态边框颜色：提取失败 → 红 | 已生成 → 绿 | 未生成 → 默认
          const cardBorderColor = charExtractFailed
            ? 'var(--color-error, #ef4444)'
            : generated
              ? 'var(--color-success)'
              : 'var(--color-border)'
          return (
            <div key={f.key} className="space-y-2">
              <div
                className="rounded-lg border p-4 flex items-center gap-4 cursor-pointer transition-all"
                style={{
                  borderColor: cardBorderColor,
                  backgroundColor: charExtractFailed ? 'rgba(239, 68, 68, 0.03)' : 'var(--color-panel)',
                  opacity: loading ? 0.6 : 1,
                }}
                onClick={() => openArchFile(f)}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-accent)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = cardBorderColor}
                title={`${t('tip.clickView')} — ${f.desc}`}
              >
                {/* 状态图标 */}
                {generated
                  ? <CheckCircle2 size={18} style={{ flexShrink: 0, color: 'var(--color-success)' }} />
                  : <Circle size={18} style={{ flexShrink: 0, color: 'var(--color-text-muted)' }} />
                }

                {/* 图标 */}
                <span className="flex-shrink-0" style={{ color: generated ? 'var(--color-text-secondary)' : 'var(--color-text-muted)' }}>{renderIcon(f.iconName, 24)}</span>

                {/* 标题 + 描述 */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                    {f.label}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                    {f.desc}
                  </div>
                </div>

                {/* 右侧状态标签 / 字数 / 提取按钮 */}
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  {generated ? (
                    <>
                      <span className="text-[0.7rem] px-1.5 py-0.5 rounded font-medium bg-green-500/10 text-green-600 dark:text-green-400">
                        {t('status.generated')}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        {words.toLocaleString()} {t('unit.characters')}
                      </span>
                    </>
                  ) : (
                    <span
                      className="text-[0.7rem] px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: 'rgba(var(--color-accent-rgb,99 102 241),0.1)', color: 'var(--color-accent)' }}
                    >
                      {t('status.pendingGen')}
                    </span>
                  )}
                  {/* 角色图谱已生成但角色卡为空时，显示重新提取按钮（带质感的警告色） */}
                  {isCharacters && generated && !loading && characterCount === 0 && (
                    <Button
                      size="sm"
                      disabled={extracting}
                      className="gap-1.5 mt-0.5 bg-gradient-to-r from-red-500 to-orange-500 text-white shadow-sm hover:from-red-600 hover:to-orange-600 border-none hover:shadow hover:-translate-y-[0.5px] transition-all"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleExtractCharacters()
                      }}
                      title={t('arch.charArchiveEmptyRetry')}
                    >
                      {extracting
                        ? <RefreshCw size={12} className="animate-spin opacity-90" />
                        : <AlertTriangle size={12} className="opacity-90" />
                      }
                      {extracting ? t('arch.charExtracting') : t('arch.charExtractBtn')}
                    </Button>
                  )}
                  {/* 查看箭头提示 */}
                  {generated && !(isCharacters && !loading && characterCount === 0) && (
                    <span className="text-[0.7rem] flex items-center gap-0.5" style={{ color: 'var(--color-text-muted)' }}>
                      <FileText size={10} /> {t('tip.clickView')}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* AI 生成架构确认弹窗 */}
      <ArchitectureConfirmDialog
        isOpen={showArchDialog}
        onClose={() => setShowArchDialog(false)}
        archStatus={archStatus}
        onConfirm={handleConfirm}
      />
    </div>
  )
}
