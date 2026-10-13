/**
 * ProcessGroup — 过程组降噪（线② · dsh 照搬）
 *
 * 连续工具调用自动折叠为一行：运行中「正在读取文件…」→ 结束「已读取文件、执行了命令」
 * （单行动词标题 + 计数）。展开显示各 ToolCallBlock。
 *
 * 对照 dsh `ChatGroupSeat` + `processTitle`（`ui-chat/src/client/chat/ChatGroupSeat.tsx` +
 * `conversation-nodes/step-process.ts`）。
 * NF 落地：一条 assistant 消息的 toolCalls 数组即一组自然过程组（ReAct 循环聚合到单条消息），
 * 纯渲染层降噪，不改数据模型。用 NF 语义令牌，遵循 color-token-standard。
 */
import { useMemo, useState } from 'react'
import { ListChecks } from 'lucide-react'
import { DisclosureRow } from '../../ui/DisclosureRow'
import { TextShimmer } from '../../ui/TextShimmer'
import { Spinner } from '../../ui/Spinner'
import ToolCallBlock from './ToolCallBlock'
import type { ToolCallInfo } from '../../../services/agent/agent-engine'
import { useTranslation } from '../../../hooks/useTranslation'
import type { TextKey } from '../../../shared/locale'

interface Props {
  toolCalls: ToolCallInfo[]
}

/** 工具类别（dsh processActivity 的 NF 简化版） */
type ActivityKind = 'read' | 'write' | 'search' | 'workflow' | 'tools'

function activity(toolName: string): ActivityKind {
  if (['read_file', 'read_characters', 'read_drafts'].includes(toolName)) return 'read'
  if (['write_file', 'edit_file'].includes(toolName)) return 'write'
  if (toolName === 'search_content' || toolName.startsWith('search')) return 'search'
  if (toolName === 'start_workflow' || toolName.includes('workflow')) return 'workflow'
  return 'tools'
}

/** 动词（运行中 / 完成，走 i18n） */
function verb(kind: ActivityKind, t: (key: TextKey) => string): { running: string; done: string } {
  switch (kind) {
    case 'read': return { running: t('process.reading'), done: t('process.readDone') }
    case 'write': return { running: t('process.writing'), done: t('process.writeDone') }
    case 'search': return { running: t('process.searching'), done: t('process.searchDone') }
    case 'workflow': return { running: t('process.workflowRunning'), done: t('process.workflowDone') }
    default: return { running: t('process.working'), done: t('process.workDone') }
  }
}

export default function ProcessGroup({ toolCalls }: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const running = toolCalls.some(tc => tc.status === 'running' || tc.status === 'pending')
  const hasConfirm = toolCalls.some(tc => tc.status === 'waiting_confirm')

  // 类别计数（按首次出现排序）
  const counts = useMemo(() => {
    const map = new Map<ActivityKind, number>()
    for (const tc of toolCalls) {
      const kind = activity(tc.toolName)
      map.set(kind, (map.get(kind) ?? 0) + 1)
    }
    return [...map.entries()]
  }, [toolCalls])

  // 标题：运行中 = 「正在{首个运行中的动词}」；结束 = 前三类「已{动词}、{动词}」+ 计数
  const title = useMemo(() => {
    if (running || hasConfirm) {
      const runningKind = toolCalls.find(tc => tc.status === 'running' || tc.status === 'waiting_confirm')
      const kind = runningKind ? activity(runningKind.toolName) : (counts[0]?.[0] ?? 'tools')
      return verb(kind, t).running
    }
    // 结束：前三类完成动词，顿号连接
    const labels = counts.slice(0, 3).map(([kind]) => verb(kind, t).done)
    return labels.join(t('process.comma'))
  }, [running, hasConfirm, counts, toolCalls, t])

  const collapsedContent = (
    <>
      <span aria-hidden style={{ flex: 'none', width: 2, height: 2, margin: '0 8px', borderRadius: 1, background: 'var(--color-text-muted)' }} />
      <span style={{ flex: 'none', fontSize: 13, lineHeight: '24px', color: 'var(--color-text-muted)' }}>
        <TextShimmer active={running || hasConfirm}>{title}</TextShimmer>
      </span>
      {/* 计数 */}
      <span style={{ flex: 'none', marginLeft: 4, fontSize: 11, lineHeight: '24px', color: 'var(--color-text-muted)', opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>
        {toolCalls.length}
      </span>
    </>
  )

  return (
    <div data-process-group data-state={running ? 'running' : hasConfirm ? 'waiting' : 'done'}>
      <DisclosureRow
        icon={running ? <Spinner size={14} style={{ color: 'var(--color-text-muted)' }} /> : <ListChecks size={14} style={{ color: 'var(--color-text-muted)' }} />}
        title={t('process.title')}
        running={running || hasConfirm}
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => setExpanded(v => !v)}
        collapsedContent={collapsedContent}
      >
        {expanded && (
          <div style={{ paddingLeft: 22, display: 'flex', flexDirection: 'column' }}>
            {toolCalls.map(tc => (
              <ToolCallBlock key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}
      </DisclosureRow>
    </div>
  )
}
