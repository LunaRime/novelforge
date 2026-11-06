import { useState, useCallback, useRef, useEffect } from 'react'
import { Save, RefreshCw, Sparkles, AlertTriangle, FileText } from 'lucide-react'
import { Spinner } from '../ui/Spinner'
import { renderIcon } from '../panels/sidebar/SidebarShared'
import { useTranslation } from '../../hooks/useTranslation'

import { useEditorStore } from '../../stores/editor-store'
import ArchitectureConfirmDialog from '../dialogs/ArchitectureConfirmDialog'
import { Button } from '../ui/Button'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'
import { renderLog } from '../../services/render-logger'
import { ArchitectureRequestCancelled, type ArchitectureScope } from '../../core'
import { createRendererArchitectureDocumentApplication } from '../../services/architecture/architecture-adapter'
import CodeMirrorEditor from './CodeMirrorEditor'
import { useProjectStore } from '../../stores/project-store'
import { useCharacterStore } from '../../stores/character-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { globalEventBus } from '../../shared/event-bus'

import { detectStepKey, type ArchStepKey } from './arch-step-key'

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
  const project = useProjectStore(s => s.currentProject)
  const session = useProjectStore(s => s.projectSession)
  const source = project ? { id: project.id, path: project.path, session } : null
  return <ArchitectureDocumentView key={`${project?.id}:${project?.path}:${session}:${filePath}`} filePath={filePath} content={initialContent} source={source} genre={project?.novelConfig.genre ?? ''} />
}

function ArchitectureDocumentView({ filePath, content: initialContent, source, genre }: Props & { source: ArchitectureScope | null; genre: string }) {
  const { t } = useTranslation()
  const stepKey = detectStepKey(filePath)
  const meta = useArchMeta(stepKey)
  const [application] = useState(() => createRendererArchitectureDocumentApplication(filePath, source))
  const mounted = useRef(true)
  const lifetime = useRef({ generation: 0 })
  const active = useCallback(() => {
    if (!mounted.current) return false
    try { application.assertCurrent(); return true } catch { return false }
  }, [application])
  const savedContentRef = useRef(initialContent)
  const currentContentRef = useRef(initialContent)
  const editVersion = useRef(0)
  const saveBusy = useRef(false)
  const reloadVersion = useRef(0)
  const dialogVersion = useRef(0)
  const extractingBusy = useRef(false)
  const generationRun = useRef<string | null>(null)
  const extractionRun = useRef<string | null>(null)
  const [editorContent, setEditorContent] = useState(initialContent)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showDialog, setShowDialog] = useState(false)
  const [checkingArch, setCheckingArch] = useState(false)
  const [fullArchStatus, setFullArchStatus] = useState<Record<string, boolean>>({})
  const [extracting, setExtracting] = useState(false)
  const [extractionRunId, setExtractionRunId] = useState<string | null>(null)
  const extractionOutcome = useWorkflowStore(s => extractionRunId
    ? (s.activeRuns.find(run => run.id === extractionRunId)?.status ?? s.history.find(run => run.id === extractionRunId)?.status ?? 'missing')
    : null)
  const characterCount = useCharacterStore(s => s.characters.length)
  const isArchRunning = useWorkflowStore(s => s.isTypeRunning('architecture_generation'))
  const [charCount, setCharCount] = useState(0)
  const [isDirty, setIsDirty] = useState(false)

  useEffect(() => {
    mounted.current = true
    const lifecycle = lifetime.current
    const generation = ++lifecycle.generation
    return () => {
      mounted.current = false
      queueMicrotask(() => { if (!mounted.current && lifecycle.generation === generation) application.dispose() })
    }
  }, [application])
  useEffect(() => {
    if (saveBusy.current || currentContentRef.current !== savedContentRef.current) return
    if (initialContent !== savedContentRef.current) {
      editVersion.current++; reloadVersion.current++
      savedContentRef.current = initialContent; currentContentRef.current = initialContent
      setEditorContent(initialContent); setIsDirty(false); setLoading(false)
    }
  }, [initialContent])

  const handleChange = useCallback((md: string) => {
    if (!mounted.current || (source && !active())) return
    editVersion.current++
    currentContentRef.current = md
    const dirty = md !== savedContentRef.current
    setIsDirty(dirty)
    if (dirty) useEditorStore.getState().updateTabContent(filePath, md)
    else {
      useEditorStore.getState().syncTabContent(filePath, md)
      useEditorStore.getState().markTabSaved(filePath)
    }
  }, [filePath, source, active])

  const handleSave = useCallback(async (md: string) => {
    if (saveBusy.current || !active()) return
    saveBusy.current = true; reloadVersion.current++
    const t0 = Date.now()
    setSaving(true); setLoading(false)
    try {
      await application.save(md)
      if (!active()) return
      savedContentRef.current = md
      const dirty = currentContentRef.current !== md
      setIsDirty(dirty)
      if (dirty) useEditorStore.getState().updateTabContent(filePath, currentContentRef.current)
      else useEditorStore.getState().markTabSaved(filePath)
      renderLog('info', 'Save:Arch', t('log.render.archSaveSuccess').replace('{path}', () => filePath).replace('{ms}', String(Date.now() - t0)))
      toast.success(t('save.success'))
    } catch (error) {
      if (!active() || error instanceof ArchitectureRequestCancelled) return
      renderLog('error', 'Save:Arch', t('log.render.archSaveFailed').replace('{path}', () => filePath).replace('{error}', () => String(error)))
      toast.error(t('save.failed').replace('{error}', String(error)))
    } finally {
      saveBusy.current = false
      if (active()) setSaving(false)
    }
  }, [application, active, filePath, t])

  const handleReload = useCallback(async (manual = true) => {
    if (!active() || saveBusy.current) return
    const version = ++reloadVersion.current
    const editing = editVersion.current
    try {
      if (currentContentRef.current !== savedContentRef.current) {
        if (!manual || !await confirm(t('editor.refreshConfirm'), { title: t('dialog.unsavedTitle') })) return
      }
      if (!active() || version !== reloadVersion.current || editing !== editVersion.current || saveBusy.current) return
      setLoading(true)
      const result = await application.read()
      if (!active() || version !== reloadVersion.current || editing !== editVersion.current || saveBusy.current) return
      if (result.status === 'missing') throw new Error(t('tool.readFileFailed'))
      savedContentRef.current = result.content; currentContentRef.current = result.content
      setEditorContent(result.content); setIsDirty(false)
      useEditorStore.getState().syncTabContent(filePath, result.content)
      useEditorStore.getState().markTabSaved(filePath)
    } catch (error) {
      if (!active() || version !== reloadVersion.current || error instanceof ArchitectureRequestCancelled) return
      renderLog('error', 'Load:Arch', String(error)); toast.error(t('common.loadFailed'))
    } finally {
      if (active() && version === reloadVersion.current) setLoading(false)
    }
  }, [application, active, filePath, t])

  useEffect(() => globalEventBus.on('WORKFLOW_COMPLETE', payload => {
    if (!active() || !payload.runId) return
    if (payload.type === 'architecture_generation' && (payload.runId === generationRun.current || application.ownsRun(payload.runId))) {
      generationRun.current = null
      if (payload.status !== 'failed') void handleReload(false)
    }
    if (payload.type === 'post_process' && payload.runId === extractionRun.current) {
      extractionRun.current = null; extractingBusy.current = false; setExtracting(false); setExtractionRunId(null)
      if (payload.status === 'failed') toast.error(t('arch.charExtractFailed'))
    }
  }), [application, active, handleReload, t])

  useEffect(() => {
    if (!extractionRunId || !['completed', 'failed', 'missing'].includes(extractionOutcome ?? '')) return
    queueMicrotask(() => {
      if (!active() || extractionRun.current !== extractionRunId) return
      extractingBusy.current = false; setExtracting(false); setExtractionRunId(null)
    })
  }, [extractionRunId, extractionOutcome, active])

  const handleConfirm = async (selectedSteps: ArchStepKey[], stepGuidance: Record<string, string>) => {
    if (!active()) return
    try {
      const receipt = await application.generate(selectedSteps, stepGuidance)
      if (active()) { generationRun.current = receipt.runId; setShowDialog(false) }
    } catch (error) {
      if (!active() || error instanceof ArchitectureRequestCancelled) return
      renderLog('error', 'Generate:Arch', String(error)); toast.error(String(error))
    }
  }
  const handleOpenDialog = async () => {
    if (!stepKey || !active()) return
    const version = ++dialogVersion.current
    setCheckingArch(true)
    try {
      const status = await application.status()
      if (!active() || version !== dialogVersion.current) return
      const content = currentContentRef.current
      if (content.length > 50 && !content.includes('待生成')) status[stepKey] = true
      setFullArchStatus(status); setShowDialog(true)
    } catch (error) {
      if (!active() || version !== dialogVersion.current || error instanceof ArchitectureRequestCancelled) return
      renderLog('error', 'Load:Arch', String(error)); toast.error(t('common.loadFailed'))
    } finally {
      if (active() && version === dialogVersion.current) setCheckingArch(false)
    }
  }
  const generated = editorContent.length > 50 && !editorContent.includes('待生成')
  const handleExtractCharacters = useCallback(async () => {
    if (!active() || extractingBusy.current) return
    extractingBusy.current = true; setExtracting(true)
    let started = false
    try {
      const existing = await application.existingCharacterCount()
      if (!active()) return
      if (existing > 0 && !await confirm(t('character.extractConfirm'), { title: t('character.extractConfirmTitle') })) return
      if (!active()) return
      const result = await application.extract(genre)
      if (!active()) return
      if (result.status === 'started') { started = true; extractionRun.current = result.runId; setExtractionRunId(result.runId) }
    } catch (error) {
      if (!active() || error instanceof ArchitectureRequestCancelled) return
      renderLog('error', 'Extract:Arch', String(error)); toast.error(t('arch.charExtractFailed'))
    } finally {
      if (!started) {
        extractingBusy.current = false
        if (active()) setExtracting(false)
      }
    }
  }, [application, active, genre, t])

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
              {charCount.toLocaleString()} {t('unit.chars')}
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
            onClick={() => void handleReload()}
            title={t('arch.reloadFromDisk')}
            disabled={loading || saving}
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
              {t('action.save')}
            </Button>
          )}

          {/* 角色卡提取按钮（仅角色图谱页面显式且为空时、且不在架构生成中时才显示） */}
          {stepKey === 'characters' && generated && characterCount === 0 && !isArchRunning && (
            <Button
              size="sm"
              disabled={extracting}
              onClick={handleExtractCharacters}
              className="gap-1.5 bg-gradient-to-r from-[var(--color-error)] to-[var(--color-warning)] text-white shadow-[var(--shadow-sm)] hover:brightness-90 border-none hover:shadow hover:-translate-y-[0.5px] transition-all"
              title={t('arch.charExtractFailed')}
            >
              {extracting
                ? <Spinner size={12} className="opacity-90" />
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
              title={`AI ${generated ? t('archive.regenerate') : t('archive.generate')}「${meta?.label}」`}
            >
              {checkingArch ? <Spinner size={12}  /> : <Sparkles size={12} />}
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
