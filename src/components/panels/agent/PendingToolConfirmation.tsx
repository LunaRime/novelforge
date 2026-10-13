/**
 * PendingToolConfirmation — 父 agent 审批卡挂载点（线② · dsh 照搬，接管输入区）
 *
 * 从 active 会话的 messages 里收集 `waiting_confirm` 状态的 toolCall，渲染在
 * 输入区上方（与 SubAgentConfirmCard 同区域）。审批**不进聊天流**（spec §2.6「故意不双渲染」）。
 *
 * requiresConfirmation 工具在 agent-engine 里单独成批、串行确认（agent-engine.ts:348 注释），
 * 故同一时刻至多一个 waiting_confirm —— 直接取第一个即可。
 */
import { useAgentStore } from '../../../stores/agent-store'
import ConfirmCard from './ConfirmCard'
import type { ToolCallInfo } from '../../../services/agent/agent-engine'

export default function PendingToolConfirmation() {
  // selector 返回 store 里的稳定对象引用（或 undefined），不会每帧新建数组触发重渲染
  const pending = useAgentStore((s): ToolCallInfo | undefined => {
    const conv = s.conversations.find(c => c.id === s.activeConversationId)
    if (!conv) return undefined
    for (const m of conv.messages) {
      const tc = (m.toolCalls ?? []).find(t => t.status === 'waiting_confirm')
      if (tc) return tc
    }
    return undefined
  })

  if (!pending) return null
  return <ConfirmCard toolCall={pending} />
}
