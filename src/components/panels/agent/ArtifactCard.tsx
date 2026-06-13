/**
 * ArtifactCard — 产物卡片
 *
 * 当 Agent 创建/修改文件或触发工作流时，
 * 显示可点击的产物卡片，用户可直接跳转到对应资源。
 */
import { FileText, FolderOpen, Play, ExternalLink, BookOpen, Edit3, CheckCircle, UserPlus, FileBarChart, Database, Users } from 'lucide-react'
import type { ToolArtifact } from '../../../services/agent/tool-registry'
import { useEditorStore } from '../../../stores/editor-store'
import { ipc } from '../../../services/ipc-client'

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

/** 产物类型中文标签 */
function typeLabel(type: ToolArtifact['type']): string {
  switch (type) {
    case 'file_created':         return '新建文件'
    case 'file_modified':        return '已修改'
    case 'workflow_started':     return '工作流'
    case 'tab_opened':           return '已打开'
    case 'blueprint_generated':  return '蓝图'
    case 'draft_generated':      return '草稿'
    case 'review_completed':     return '审稿'
    case 'character_extracted':  return '角色'
    case 'summary_updated':      return '摘要'
    case 'verification_report':  return '校验'
    case 'embedding_indexed':    return '向量'
    case 'mutual_review_completed': return '互评'
    default:                     return ''
  }
}

export default function ArtifactCard({ artifact }: Props) {
  const { type, name, path } = artifact

  const handleClick = async () => {
    if (path && (type === 'file_created' || type === 'file_modified' || type === 'tab_opened')) {
      // 先读取文件内容，再打开编辑器（避免空白 Tab）
      let content = ''
      try {
        const result = await ipc.invoke('fs:read-file', path)
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
  }

  return (
    <div className="artifact-card" onClick={handleClick}>
      <div className="artifact-icon">
        <ArtifactIcon type={type} />
      </div>
      <span className="artifact-name">{name}</span>
      <span className="artifact-type">{typeLabel(type)}</span>
    </div>
  )
}
