/**
 * ArtifactCard — 产物卡片
 *
 * 当 Agent 创建/修改文件或触发工作流时，
 * 显示可点击的产物卡片，用户可直接跳转到对应资源。
 *
 * 2026-09-27 可供性修复（card-affordance-standard §4）：
 *  - 此前是 `<div onClick>`（键盘不可达），且只有 file/tab 三类真有动作——其余产物类型
 *    悬停变色、点下去零响应（"假按钮"）。
 *  - 现按类型接线「点这张卡去哪」：文件类 → 编辑器；blueprint_generated → 跳章节草稿；
 *    workflow_started → 打开底部「任务」面板。
 *  - **没有可达目标的类型不再假装可点**：渲染为静态卡片（无 hover、无手型）。
 */
import { FileText, FolderOpen, Play, ExternalLink, BookOpen, Edit3, CheckCircle, UserPlus, FileBarChart, Database, Users } from 'lucide-react'
import type { ToolArtifact } from '../../../services/agent/tool-registry'
import { useEditorStore } from '../../../stores/editor-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { openDraftByChapter } from '../sidebar/SidebarShared'
import { ipc } from '../../../services/ipc-client'
import { t } from '../../../shared/locale'

interface Props {
  artifact: ToolArtifact
}

/** 根据产物类型选择图标 */
function ArtifactIcon({ type }: { type: ToolArtifact['type'] }) {
  switch (type) {
    case 'file_created':       return <FileText size={13} />
    case 'file_modified':      return <FolderOpen size={13} />
    case 'workflow_started':   return <Play size={13} />
    case 'tab_opened':         return <ExternalLink size={13} />
    case 'blueprint_generated': return <BookOpen size={13} />
    case 'draft_generated':    return <Edit3 size={13} />
    case 'review_completed':   return <CheckCircle size={13} />
    case 'character_extracted': return <UserPlus size={13} />
    case 'summary_updated':    return <FileBarChart size={13} />
    case 'verification_report': return <FileBarChart size={13} />
    case 'embedding_indexed':  return <Database size={13} />
    case 'mutual_review_completed': return <Users size={13} />
    default:                   return <FileText size={13} />
  }
}

/** 产物类型标签（模块级 t() 读取当前 locale） */
function typeLabel(type: ToolArtifact['type']): string {
  switch (type) {
    case 'file_created':         return t('artifact.fileCreated')
    case 'file_modified':        return t('artifact.fileModified')
    case 'workflow_started':     return t('artifact.workflowStarted')
    case 'tab_opened':           return t('artifact.tabOpened')
    case 'blueprint_generated':  return t('artifact.blueprintGenerated')
    case 'draft_generated':      return t('artifact.draftGenerated')
    case 'review_completed':     return t('artifact.reviewCompleted')
    case 'character_extracted':  return t('artifact.characterExtracted')
    case 'summary_updated':      return t('artifact.summaryUpdated')
    case 'verification_report':  return t('artifact.verificationReport')
    case 'embedding_indexed':    return t('artifact.embeddingIndexed')
    case 'mutual_review_completed': return t('artifact.mutualReview')
    default:                     return ''
  }
}

export default function ArtifactCard({ artifact }: Props) {
  const { type, name, path, metadata } = artifact

  /** 文件类产物：先读内容再打开编辑器（避免空白 Tab） */
  const openFileArtifact = async () => {
    let content = ''
    try {
      const result = await ipc.invoke('fs:read-file', path!)
      if (result.success) {
        content = result.content
      }
    } catch {
      // 读取失败时仍然打开，显示空白
    }
    useEditorStore.getState().openFile({
      id: `artifact-${Date.now()}`,
      name,
      type: 'chapter',
      filePath: path,
      content,
    })
  }

  /** 解析该产物的可达目标；null = 没有可达目标（不得渲染可点形态） */
  const action: (() => void) | null = (() => {
    if (path && (type === 'file_created' || type === 'file_modified' || type === 'tab_opened')) {
      return () => void openFileArtifact()
    }
    if (type === 'blueprint_generated') {
      const n = metadata?.chapterNumber
      if (typeof n === 'number') return () => void openDraftByChapter(n, name)
    }
    if (type === 'workflow_started') {
      return () => useLayoutStore.getState().openBottomTab('tasks')
    }
    return null
  })()

  const body = (
    <>
      <div className="artifact-icon">
        <ArtifactIcon type={type} />
      </div>
      <span className="artifact-name">{name}</span>
      <span className="artifact-type">{typeLabel(type)}</span>
    </>
  )

  // 有目标 → 整卡 = 原生 button（键盘可达，hover 反馈 = 热区）；
  // 无目标 → 静态卡片：无 hover、无手型（"没有热区就不许有任何暗示"）
  return action ? (
    <button type="button" className="artifact-card w-full text-left" onClick={action}>
      {body}
    </button>
  ) : (
    <div className="artifact-card artifact-card-static">
      {body}
    </div>
  )
}
