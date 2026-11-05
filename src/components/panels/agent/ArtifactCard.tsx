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
import { FileText, Play, Edit3, CheckCircle, XCircle } from 'lucide-react'
import type { RuntimeEvent } from '../../../core/domain/runtime-event'
import { useEditorStore } from '../../../stores/editor-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { ipc } from '../../../services/ipc-client'
import { isVelaProtocol, readVelaContent } from '../../../services/vela-protocol'
import { t } from '../../../shared/locale'

interface Props {
  artifact: RuntimeEvent
}

function ArtifactIcon({ artifact }: { artifact: RuntimeEvent }) {
  switch (artifact.type) {
    case 'document.changed': return <FileText size={13} />
    case 'chapter.draft_written': return <Edit3 size={13} />
    case 'chapter.reviewed': return <CheckCircle size={13} />
    case 'workflow.progressed': return artifact.step === 'failed' ? <XCircle size={13} />
      : artifact.step === 'completed' ? <CheckCircle size={13} /> : <Play size={13} />
  }
}
function typeLabel(event: RuntimeEvent): string {
  switch (event.type) {
    case 'document.changed': return t('artifact.fileModified')
    case 'chapter.draft_written': return t('artifact.draftGenerated')
    case 'chapter.reviewed': return t('artifact.reviewCompleted')
    case 'workflow.progressed': return t(event.step === 'started' ? 'artifact.workflowStarted' : 'artifact.workflowCompleted')
  }
}

export default function ArtifactCard({ artifact }: Props) {
  const { type, path } = artifact
  const name = artifact.name ?? (type === 'workflow.progressed' ? artifact.runId : type === 'document.changed' ? artifact.id : artifact.chapterId)

  /** 文件类产物：先读内容再打开编辑器（避免空白 Tab） */
  const openFileArtifact = async () => {
    if (!path) return
    let content = ''
    try {
      if (isVelaProtocol(path)) {
        content = await readVelaContent(path)
      } else {
        const result = await ipc.invoke('fs:read-file', path)
        if (result.success) content = result.content
      }
    } catch {
      // 读取失败时仍然打开，显示空白
    }
    useEditorStore.getState().openFile({
      id: path,
      name,
      type: 'chapter',
      filePath: path,
      content,
    })
  }

  /** 解析该产物的可达目标；null = 没有可达目标（不得渲染可点形态） */
  const action: (() => void) | null = (() => {
    if (path && type === 'document.changed') return () => void openFileArtifact()
    if (type === 'workflow.progressed') {
      return artifact.step === 'started'
        ? () => useLayoutStore.getState().openBottomTab('tasks')
        : () => useLayoutStore.getState().openRightPanel('ai-output')
    }
    return null
  })()

  const body = (
    <>
      <div className="artifact-icon">
        <ArtifactIcon artifact={artifact} />
      </div>
      <span className="artifact-name">{name}</span>
      <span className="artifact-type">{typeLabel(artifact)}</span>
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
