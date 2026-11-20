import { RefreshCw, Save } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '../../hooks/useTranslation'
import { captureDraftProject } from '../../services/draft-index'
import { mergeRendererRevision } from '../../services/editor/merge-revision'
import { ipc } from '../../services/ipc-client'
import { isValidMemoryContent, stripStatusFrontmatter } from '../../services/memory/memory-codec'
import { renderLog } from '../../services/render-logger'
import { computeTextStats } from '../../services/text-stats'
import { readVelaContent, VELA } from '../../services/vela-protocol'
import { useEditorStore, type EditorTab } from '../../stores/editor-store'
import { useMemoryStore } from '../../stores/memory-store'
import { clearChapterTitleCache } from '../panels/Sidebar'
import { Button } from '../ui/Button'
import { confirm } from '../ui/Confirm'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/Dialog'
import { toast } from '../ui/Toast'
import ArchFileViewer from './ArchFileViewer'
import ChapterCardEditor from './ChapterCardEditor'
import CharacterEditor from './CharacterEditor'
import CodeMirrorEditor from './CodeMirrorEditor'
import DraftEditor from './DraftEditor'
import ManuscriptBoard from './ManuscriptBoard'
import NovelConfigEditor from './NovelConfigEditor'
import ReviewReport from './ReviewReport'
import ThreeWayMerge from './ThreeWayMerge'
import VersionHistory from './VersionHistory'
import WorldBuildingEditor from './WorldBuildingEditor'
import WorldTimelineView from './WorldTimelineView'
import './novel-editor.css'

// ─── 正文章节编辑器包装层（含字数信息栏） ─────────────────────────────────────────────
function ProseEditorWrapper({
  tab,
  onSave,
}: {
  tab: EditorTab
  onSave: (text: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [wordCount, setWordCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const fileName = tab.name
  // 追踪当前编辑器内容，供保存按钮使用（不触发重渲染）
  const currentContentRef = useRef(tab.content ?? '')

  // 卸载时清空状态栏字数（切走/关闭章节后状态栏不再显示旧字数）
  useEffect(() => () => useEditorStore.getState().setActiveCharCount(0), [])

  const handleSave = async (text: string) => {
    setSaving(true)
    try {
      await onSave(text)
    } finally {
      setSaving(false)
    }
  }

  /** 重新读取当前 Tab（DB 草稿或物理文件），不重开 Tab */
  const handleRefresh = async () => {
    if (!tab.filePath || refreshing) return
    if (tab.dirty) {
      const ok = await confirm(t('editor.refreshConfirm'), { title: t('editor.refresh'), confirmText: t('editor.refresh') })
      if (!ok) return
    }
    setRefreshing(true)
    try {
      let text = ''
      if (tab.filePath.startsWith('vela://')) {
        text = await readVelaContent(tab.filePath)
      } else {
        const res = await ipc.invoke('fs:read-file', tab.filePath)
        if (!res.success) throw new Error(res.error ?? t('status.unknown'))
        text = res.content ?? ''
      }
      const store = useEditorStore.getState()
      if (tab.inlineSession) store.endInlineSession(tab.id)
      store.markTabSaved(tab.id)
      store.syncTabContent(tab.id, text)
      currentContentRef.current = text
      const count = computeTextStats(text).novelWordCount
      setWordCount(count)
      store.setActiveCharCount(count)
      toast.success(t('editor.refreshed'))
    } catch (e) {
      toast.error(t('editor.refreshFailed').replace('{error}', String(e)))
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="nf-document-toolbar" role="group" aria-label={t('panel.editor')}>
        {/* 左侧：文件名 */}
        <span className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
          {fileName}
        </span>

        {/* 右侧：字数 + dirty 指示灯 + 保存按钮 */}
        <div className="nf-document-actions">
          {wordCount > 0 && (
            <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
              {wordCount.toLocaleString()} {t('unit.chars')}
            </span>
          )}
          {/* 未保存圆点指示灯 */}
          {tab.dirty && (
            <span
              className="nf-document-dirty"
              title={t('statusbar.unsaved')}
            />
          )}
          {/* 刷新：从 DB/磁盘重新读当前 Tab，不重开文件 */}
          <Button type="button" variant="ghost" size="icon" className="size-8"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            title={t('editor.refresh')}
            aria-label={t('editor.refresh')}
          >
            <RefreshCw size={13} strokeWidth={1.5} className={refreshing ? 'animate-spin' : ''} />
          </Button>
          {/* 保存按钮（有改动时显示） */}
          {tab.dirty && (
            <Button type="button" variant="default" size="icon" className="size-8"
              onClick={() => handleSave(currentContentRef.current)}
              disabled={saving}
              title={t('tip.saveShortcut')}
              aria-label={t('editor.save')}
            >
              <Save size={13} strokeWidth={1.5} />
            </Button>
          )}
        </div>
      </div>

      {/* 编辑器主体 */}
      <div className="flex-1 overflow-hidden">
        <CodeMirrorEditor
          key={tab.id}
          mode="prose"
          paperHeading={tab.type === 'chapter' ? <h1>{tab.name}</h1> : undefined}
          content={tab.content ?? ''}
          filePath={tab.filePath}
          hideStatusBar
          // QA 修复（正式稿只读）：vela://manuscript/{id} 是 DB 定稿行，只读保护定稿内容
          // 不被误改/串库；物理路径终稿文件仍可编辑
          editable={!tab.filePath?.startsWith('vela://manuscript/')}
          onCharCountChange={(n) => {
            setWordCount(n)
            useEditorStore.getState().setActiveCharCount(n)
          }}
          onChange={(text) => {
            // 同步 ref，供保存按钮使用
            currentContentRef.current = text
            // 标记 tab.dirty
            useEditorStore.getState().updateTabContent(tab.id, text)
          }}
          onSave={(text) => handleSave(text)}
        />
      </div>
    </div>
  )
}

// 按文档类型选择视图。正文以标签 ID 为键，同一标签的内容更新会沿用当前实例。
export default function EditorDocumentView({ activeTab, projectPath }: { activeTab?: EditorTab; projectPath?: string }) {
  const { t } = useTranslation()

  return (
    <div className="flex-1 overflow-hidden">
      {activeTab?.type === 'chapter' && activeTab.filePath?.startsWith(VELA.DRAFT) && (
        // 草稿文件：使用 DraftEditor（工具栏含修稿/审稿/定稿按钮）
        <DraftEditor
          key={activeTab.id}
          tabId={activeTab.id}
          filePath={activeTab.filePath}
          content={activeTab.content ?? ''}
        />
      )}
      {activeTab?.type === 'chapter' && !activeTab.filePath?.startsWith(VELA.DRAFT) && (
        // 终稿文件：vela://manuscript/{id}（DB 定稿行）或物理路径 → ProseEditorWrapper（含字数信息栏）
        // 保存链见 onSave：manuscript 前缀写 DB（drafts 行），物理路径才走 fs:write-file
        <ProseEditorWrapper
          key={activeTab.id}
          tab={activeTab}
          onSave={async (text) => {
            if (!activeTab.filePath) return
            // ⚠️ L4 S5：写通道**返回 {success:false} 而不抛错**；而 ProseEditorWrapper.handleSave
            //   是 try/finally（无 catch）。因此这里必须自己兜住失败：否则写盘失败后仍然
            //   markTabSaved() → 页签显示已保存、dirty 被清 → 内容没落盘却无人知晓（静默丢稿）。
            try {
              if (activeTab.filePath.startsWith(VELA.MANUSCRIPT)) {
                // vela://manuscript/{id}：定稿内容在 DB（drafts 行），伪协议无物理文件
                // —— 不能走 fs:write-file（会被当作相对路径写到错误位置，内容丢失）
                const idRaw = activeTab.filePath.replace(VELA.MANUSCRIPT, '')
                if (/^\d+$/.test(idRaw)) {
                  // wordCount 用统一"有效字数"口径
                  const res = await ipc.invoke('db:draft-update-content', parseInt(idRaw, 10), text, computeTextStats(text).novelWordCount)
                  if (!res.success) throw new Error(res.error ?? t('status.unknown'))
                }
              } else {
                const res = await ipc.invoke('fs:write-file', activeTab.filePath, text)
                if (!res.success) throw new Error(res.error ?? t('status.unknown'))
              }
            } catch (e) {
              renderLog('error', 'Save:Editor', t('log.render.draftSaveFailed')
                .replace('{path}', () => activeTab.filePath ?? '')
                .replace('{error}', () => String(e)))
              toast.error(t('save.failed').replace('{error}', () => String(e)))
              return // 未写盘 → 不清 dirty、不同步内容
            }
            // 清除 dirty 标记 + 同步内容 + 刷新章节名缓存
            useEditorStore.getState().markTabSaved(activeTab.id)
            useEditorStore.getState().syncTabContent(activeTab.id, text)
            clearChapterTitleCache(activeTab.filePath)
          }}
        />
      )}
      {activeTab?.type === 'memory' && activeTab.filePath?.startsWith(VELA.MEMORY) && (
        // AI 记忆文件（.novelforge/memory/*.md）：真机反馈「记忆为什么在侧边栏直接打开，
        // 侧边栏那么小的位置」——改为在编辑区整幅打开（侧栏只留导航：列表/重建/删除）。
        // 复用全文编辑器。记忆文件可搜索，多个文件可分别打开和关闭。
        <ProseEditorWrapper
          key={activeTab.id}
          tab={activeTab}
          onSave={async (text) => {
            const file = activeTab.filePath?.slice(VELA.MEMORY.length)
            if (!file) return
            // ⚠️ 结构校验（与侧栏手册保存同一口径）：记忆文件是定稿 DAG 的输入，
            //    坏结构（无章节块、frontmatter 不完整）会让下游块解析静默产生空洞记忆
            //    —— 拒绝落盘并给出可见反馈，绝不静默写坏文件。
            if (!isValidMemoryContent(text)) {
              toast.error(t('memory.invalidFormat'))
              return // 未写盘 → 保持 dirty
            }
            const t0 = Date.now()
            try {
              // stripStatusFrontmatter：手动编辑同 upsert 语义——编辑后不再视为 stale
              const saved = stripStatusFrontmatter(text)
              const res = await ipc.invoke('memory:write', file, saved)
              if (!res.success) throw new Error(t('status.unknown'))
              renderLog('info', 'Save:Memory', t('log.render.memorySaveSuccess')
                .replace('{file}', () => file)
                .replace('{ms}', String(Date.now() - t0)))
              // 保存时仅清除未保存标记。编辑器仍显示用户输入的文本，重开时读取已去掉 status 的文件。
              useEditorStore.getState().markTabSaved(activeTab.id)
              toast.success(t('save.success'))
              // 刷新记忆列表：stale 徽标随写入消失（侧栏与 AI 面板共用 memory-store）
              await useMemoryStore.getState().refresh()
            } catch (e) {
              // 写通道返回 {success:false} 不抛错 → 这里自己兜住，失败不清 dirty（不得假装已保存）
              renderLog('error', 'Save:Memory', t('log.render.memorySaveFailed')
                .replace('{file}', () => file)
                .replace('{error}', () => String(e)))
              toast.error(t('save.failed').replace('{error}', () => String(e)))
            }
          }}
        />
      )}
      {activeTab?.type === 'config' && (
        <NovelConfigEditor />
      )}
      {activeTab?.type === 'outline' && (
        <div className="h-full overflow-y-auto p-6">
          <pre
            className="text-sm whitespace-pre-wrap font-mono leading-6"
            style={{ color: 'var(--color-text)' }}
          >
            {activeTab.content || t('status.loading')}
          </pre>
        </div>
      )}
      {activeTab?.type === 'character' && (
        <CharacterEditor />
      )}
      {activeTab?.type === 'chapter-card' && (
        <ChapterCardEditor />
      )}
      {activeTab?.type === 'world-building' && (
        <WorldBuildingEditor />
      )}
      {activeTab?.type === 'arch-file' && activeTab.filePath && (
        <ArchFileViewer
          key={activeTab.id}
          filePath={activeTab.filePath}
          content={activeTab.content ?? ''}
        />
      )}
      {activeTab?.type === 'version-history' && (
        <VersionHistory />
      )}
      {activeTab?.type === 'manuscript-board' && (
        <ManuscriptBoard />
      )}
      {activeTab?.type === 'world-timeline' && (
        <WorldTimelineView />
      )}
      {activeTab?.type === 'review-report' && activeTab.content && (
        <ReviewReport
          reportText={activeTab.content}
          draftPath={activeTab.filePath}
          chapterNumber={activeTab.chapterNumber}
        />
      )}
      {activeTab?.type === 'publication' && (
        /* 平台章节正文（连载监控）：只读整幅展示 —— 正文随 db:publication-list 已返回，
           侧栏行点击只做导航（与记忆文件同一约定：编辑器是唯一查看面） */
        <div className="h-full overflow-y-auto p-6">
          <div className="text-sm leading-7 whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>
            {activeTab.content || ''}
          </div>
        </div>
      )}
      {/* diff 合并视图 — 统一使用弹出式 Dialog（与 DraftEditor 一致） */}
      <Dialog
        open={activeTab?.type === 'diff' && !!activeTab.originalContent && !!activeTab.content}
        onOpenChange={(v) => {
          if (!v && activeTab?.type === 'diff') {
            useEditorStore.getState().closeTab(activeTab.id)
          }
        }}
      >
        <DialogContent preventOutsideClose
          className="p-0"
          style={{
            width: '90vw',
            maxWidth: '90vw',
            height: '85vh',
            maxHeight: '85vh',
            overflow: 'hidden',
          }}
            >
          <DialogHeader className="px-4 py-0" style={{ height: 38, display: 'flex', alignItems: 'center' }}>
            <DialogTitle className="flex items-center gap-2 text-xs">
              {t('editor.mergeTitleShort').replace('{name}', activeTab?.name ?? '...')}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden" style={{ height: 'calc(85vh - 38px - 1px)' }}>
            {activeTab?.type === 'diff' && activeTab.originalContent && activeTab.content && (
              <ThreeWayMerge
                originalContent={activeTab.originalContent}
                modifiedContent={activeTab.content}
                onComplete={async (mergedText) => {
                  const filePath = activeTab.filePath
                  const chapterNum = activeTab.chapterNumber

                  // 缺上下文就不写库：此前直接进 finally 关 Tab，用户看到「完成」却没落盘
                  if (!filePath) {
                    toast.error(t('editor.mergeMissingContext'))
                    return
                  }
                  try {
                    if (!projectPath) throw new Error(t('error.noProject'))
                    const assertProject = captureDraftProject(projectPath)
                    const result = await mergeRendererRevision({ chapterNumber: chapterNum, draftPath: filePath,
                      revisionPath: activeTab.revisionPath ?? '', content: mergedText, expectedContent: activeTab.originalContent })

                    assertProject()
                    if (result.success) {
                      toast.success('✅ ' + t('editor.mergeComplete'))
                      renderLog('info', 'Save:Draft', t('editor.mergeComplete'))
                      if (result.refreshError) renderLog('error', 'Load:Draft', result.refreshError)
                      useEditorStore.getState().closeTab(activeTab.id)
                    } else {
                      // 失败保留 Tab，避免「合并没有发生但 Tab 关了」的假成功
                      renderLog('error', 'Save:Draft', result.error ?? t('status.unknown'))
                      toast.error(t('error.mergeFailed').replace('{error}', result.error ?? ''))
                    }
                  } catch (e) {
                    renderLog('error', 'Save:Draft', String(e))
                    toast.error(t('error.mergeError').replace('{error}', String(e)))
                  }
                }}
                onCancel={() => useEditorStore.getState().closeTab(activeTab.id)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

    </div>
  )
}
