import { useState, useCallback, useRef, useEffect } from 'react'
import { Save, RefreshCw, Sparkles, Loader2, AlertTriangle, FileText } from 'lucide-react'
import { renderIcon } from '../panels/sidebar/SidebarShared'
import { useTranslation } from '../../hooks/useTranslation'

import { useEditorStore } from '../../stores/editor-store'
import ArchitectureConfirmDialog from '../dialogs/ArchitectureConfirmDialog'
import { Button } from '../ui/Button'
import { ipc } from '../../services/ipc-client'
import { readCoreContent, writeCoreContent, VELA } from '../../services/vela-protocol'
import CodeMirrorEditor from './CodeMirrorEditor'
import { useProjectStore } from '../../stores/project-store'
import { useCharacterStore } from '../../stores/character-store'
import { runArchCharacterExtract, createArchitectureWorkflow } from '../../services/workflows/architecture-workflow'
import { useWorkflowStore } from '../../stores/workflow-store'
import { globalEventBus } from '../../shared/event-bus'

type ArchStepKey = 'premise' | 'characters' | 'worldbuilding' | 'synopsis'

/** 与 Sidebar / WorldBuildingEditor 保持一致的架构文件元信息（i18n key 引用） */
const ARCH_META_KEYS: Record<ArchStepKey, { iconName: string; labelKey: string; descKey: string }> = {
  premise: { iconName: 'target', labelKey: 'arch.premise', descKey: 'arch.premiseDesc' },
  characters: { iconName: 'users', labelKey: 'arch.characters', descKey: 'arch.charactersDesc' },
  worldbuilding: { iconName: 'globe', labelKey: 'arch.worldbuilding', descKey: 'arch.worldbuildingDesc' },
  synopsis: { iconName: 'map', labelKey: 'arch.synopsis', descKey: 'arch.synopsisDesc' },
}

function useArchMeta(stepKey: ArchStepKey | null) {
  const { t } = useTranslation()
  if (!stepKey) return null
  const keys = ARCH_META_KEYS[stepKey]
  if (!keys) return null
  return { iconName: keys.iconName, label: t(keys.labelKey as never), desc: t(keys.descKey as never) }
}

/** 从文件路径推断出 ArchStepKey */
function detectStepKey(filePath: string): ArchStepKey | null {
  if (filePath.endsWith('premise.md')) return 'premise'
  if (filePath.endsWith('characters.md')) return 'characters'
  if (filePath.endsWith('worldbuilding.md')) return 'worldbuilding'
  if (filePath.endsWith('synopsis.md')) return 'synopsis'
  return null
}

interface Props {
  filePath: string
  content: string
}

/**
 * 架构文件编辑器（Markdown 文件 WYSIWYG 编辑）
 * - 使用 CodeMirrorEditor（document 模式）+ hideStatusBar，底部栏信息整合到本组件工具栏
 * - 脏状态通过比较内容字符串判断，不依赖 onChange 时机
 */
export default function ArchFileViewer({ filePath, content: initialContent }: Props) {
  const { t } = useTranslation()
  const stepKey = detectStepKey(filePath)
  const meta = useArchMeta(stepKey)

  // 磁盘上的内容（已保存的基准）
  const savedContentRef = useRef(initialContent)
  // 编辑器当前内容（用 ref 而非 state，避免每次键入都重渲染导致光标跳末尾）
  const currentContentRef = useRef(initialContent)
  // 传给 CodeMirrorEditor 的初始内容（只有『外部重载』时才更新，不随用户键入变化）
  const [editorContent, setEditorContent] = useState(initialContent)

  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showDialog, setShowDialog] = useState(false)
  const [checkingArch, setCheckingArch] = useState(false)
  const [fullArchStatus, setFullArchStatus] = useState<Record<string, boolean>>({})
  const [extracting, setExtracting] = useState(false)

  const characterCount = useCharacterStore(s => s.characters.length)
  const isArchRunning = useWorkflowStore(s => s.isTypeRunning('architecture_generation'))

  // 中文字数（由 CodeMirrorEditor 回调更新）
  const [charCount, setCharCount] = useState(0)

  // 脚状态（独立 state，不跟着 content 走）
  const [isDirty, setIsDirty] = useState(false)

  // 外部内容更新时的热重载（拦截 store.syncTabContent 带来的 props.content 更新）
  useEffect(() => {
    if (initialContent !== savedContentRef.current && initialContent !== currentContentRef.current) {
      savedContentRef.current = initialContent
      currentContentRef.current = initialContent
      setEditorContent(initialContent)
      setIsDirty(false)
    }
  }, [initialContent])


  // 内容变化回调：更新 ref，不触发重渲染，避免 content prop 回传导致光标跳末尾
  const handleChange = useCallback((md: string) => {
    currentContentRef.current = md
    const dirty = md !== savedContentRef.current
    setIsDirty(dirty)
    // 同步 editor-store 的 tab.dirty，供标题栏警示灯、Tab 圆点、关闭确认使用
    if (dirty) {
      useEditorStore.getState().updateTabContent(filePath, md)
    } else {
      useEditorStore.getState().syncTabContent(filePath, md)
    }
  }, [filePath])

  /** 保存（统一走 vela://core/ DB 路径） */
  const handleSave = useCallback(async (md: string) => {
    setSaving(true)
    try {
      let success = true
      if (filePath.startsWith(VELA.CORE)) {
        success = await writeCoreContent(filePath, md)
      } else {
        // DB 化后架构文件不应有物理路径；如果意外触发，尝试 FS 写入兜底
        console.warn('[ArchFileViewer] 非预期的物理路径保存:', filePath)
        const res = await ipc.invoke('fs:write-file', filePath, md)
        success = res.success !== false
      }
      if (success) {
        savedContentRef.current = md
        setIsDirty(false)
        useEditorStore.getState().markTabSaved(filePath)
      }
    } finally {
      setSaving(false)
    }
  }, [filePath])

  /** 从 DB 重新加载（AI 生成后刷新用） */
  const handleReload = useCallback(async () => {
    setLoading(true)
    let newContent = ''
    if (filePath.startsWith(VELA.CORE)) {
      newContent = await readCoreContent(filePath)
    } else {
      // DB 化后架构文件不应有物理路径
      console.warn('[ArchFileViewer] 非预期的物理路径刷新:', filePath)
      const res = await ipc.invoke('fs:read-file', filePath)
      if (res.success) newContent = res.content
    }
    savedContentRef.current = newContent
    currentContentRef.current = newContent
    setEditorContent(newContent)
    setIsDirty(false)
    useEditorStore.getState().markTabSaved(filePath)
    setLoading(false)
  }, [filePath])

  // 监听架构生成完成事件，自动刷新当前页面
  useEffect(() => {
    return globalEventBus.on('WORKFLOW_COMPLETE', (payload) => {
      if (payload.type === 'architecture_generation') {
        handleReload()
      }
    })
  }, [handleReload])

  /** 确认后启动架构生成工作流 */
  const handleConfirm = async (selectedSteps: ArchStepKey[], stepGuidance: Record<string, string>) => {
    useWorkflowStore.getState().startWorkflow(createArchitectureWorkflow({ selectedSteps, stepGuidance }))
  }

  const handleOpenDialog = async () => {
    if (!stepKey) return
    setCheckingArch(true)
    const core = await ipc.invoke('db:project-core-get')
    const status: Record<string, boolean> = {
      premise: !!core?.premise && core.premise.length > 50 && !core.premise.includes('待生成'),
      characters: !!core?.charactersArch && core.charactersArch.length > 50 && !core.charactersArch.includes('待生成'),
      worldbuilding: !!core?.worldbuilding && core.worldbuilding.length > 50 && !core.worldbuilding.includes('待生成'),
      synopsis: !!core?.synopsis && core.synopsis.length > 50 && !core.synopsis.includes('待生成'),
    }

    // 对于当前文件，如果编辑器内已修改但未保存，也暂时以前面的基准为准即可
    const EditorContentLen = currentContentRef.current.length;
    if (EditorContentLen > 50 && !currentContentRef.current.includes('待生成')) {
      status[stepKey] = true
    }
    setFullArchStatus(status)
    setCheckingArch(false)
    setShowDialog(true)
  }

  const generated = initialContent.length > 50 && !initialContent.includes('待生成')

  const handleExtractCharacters = useCallback(async () => {
    const project = useProjectStore.getState().currentProject
    if (!project || extracting) return
    setExtracting(true)
    try {
      const core = await ipc.invoke('db:project-core-get')
      const charArch = core?.charactersArch ?? ''
      if (charArch.length < 50) {
        setExtracting(false)
        return
      }
      runArchCharacterExtract(project.path, charArch, project.novelConfig.genre)

      // 通过 EventBus 监听提取完成事件
      const unsub1 = globalEventBus.on('ARCH_POSTPROCESS_UPDATED', () => {
        setExtracting(false)
        unsub1()
        unsub2()
      })
      const unsub2 = globalEventBus.on('CHARACTER_EXTRACT_FAILED', () => {
        setExtracting(false)
        unsub1()
        unsub2()
      })

    } catch (e) {
      console.error('角色卡提取失败', e)
      setExtracting(false)
    }
  }, [extracting])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 工具栏（背景与编辑区一致，内嵌在内容区中而非独立标题栏） */}
      <div
        className="flex items-center justify-between gap-2 px-3 h-9 flex-shrink-0"
        style={{
          borderBottom: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-editor-bg)',
        }}
      >
        {/* 左侧：Emoji + 标题 + 描述 */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="flex-shrink-0" style={{ color: 'var(--color-text-muted)', opacity: 0.6 }}>{meta ? renderIcon(meta.iconName, 14) : <FileText size={14} />}</span>
          <span className="text-xs font-medium flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
            {meta?.label ?? t('arch.document')}
          </span>
          {meta && (
            <span className="text-xs truncate hidden sm:inline" style={{ color: 'var(--color-text-muted)' }}>
              — {meta.desc}
            </span>
          )}
        </div>

        {/* 右侧：字数 + 状态 + 操作按钮 */}
        <div className="flex items-center gap-2 flex-shrink-0">

          {/* 字数 */}
          {charCount > 0 && (
            <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
              {charCount.toLocaleString()} 字
            </span>
          )}

          {/* 保存状态 */}
          {saving && (
            <span className="text-xs" style={{ color: 'var(--color-accent)' }}>{t('editor.saving')}</span>
          )}
          {isDirty && !saving && (
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: 'var(--color-warning)' }} title={t('arch.unsavedChanges')} />
          )}

          {/* 刷新按钮 */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleReload}
            title={t('arch.reloadFromDisk')}
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </Button>

          {/* 保存按钮（有修改时才显示） */}
          {isDirty && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSave(currentContentRef.current)}
              disabled={saving}
              title={t('arch.save')}
            >
              <Save size={12} />
              保存
            </Button>
          )}

          {/* 角色卡提取按钮（仅角色图谱页面显式且为空时、且不在架构生成中时才显示） */}
          {stepKey === 'characters' && generated && characterCount === 0 && !isArchRunning && (
            <Button
              size="sm"
              disabled={extracting}
              onClick={handleExtractCharacters}
              className="gap-1.5 bg-gradient-to-r from-red-500 to-orange-500 text-white shadow-sm hover:from-red-600 hover:to-orange-600 border-none hover:shadow hover:-translate-y-[0.5px] transition-all"
              title={t('arch.charExtractFailed')}
            >
              {extracting
                ? <RefreshCw size={12} className="animate-spin opacity-90" />
                : <AlertTriangle size={12} className="opacity-90" />
              }
              {extracting ? t('arch.extracting') : t('arch.extractChars')}
            </Button>
          )}

          {/* AI 生成按钮 */}
          {stepKey && (
            <Button
              variant="ai"
              size="sm"
              onClick={handleOpenDialog}
              disabled={checkingArch}
              title={`AI ${generated ? '重新生成' : '生成'}「${meta?.label}」`}
            >
              {checkingArch ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {generated ? t('arch.aiRegenerate') : t('arch.aiGenerate')}
            </Button>
          )}
        </div>
      </div>

      {/* CodeMirrorEditor document 模式，隐藏底部栏（信息已整合到上方工具栏） */}
      <div className="flex-1 overflow-hidden">
        <CodeMirrorEditor
          mode="document"
          content={editorContent}
          filePath={filePath}
          onChange={handleChange}
          onSave={handleSave}
          onCharCountChange={setCharCount}
          hideStatusBar
          placeholder={t('arch.emptyHint')}
        />
      </div>

      {/* AI 生成确认弹窗 */}
      {stepKey && (
        <ArchitectureConfirmDialog
          isOpen={showDialog}
          onClose={() => setShowDialog(false)}
          archStatus={fullArchStatus}
          initialSelectedSteps={[stepKey]}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  )
}
