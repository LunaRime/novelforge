import { useLayoutEffect, useRef } from 'react'
import { useAgentStore } from '../../../stores/agent-store'
import ConfirmCard from './ConfirmCard'
import { useAgentPanelScope, useTaskNavigation } from './agent-panel-session'

/** Show only the live approval for this conversation and project session. */
export default function PendingToolConfirmation() {
  const scope = useAgentPanelScope()
  const pending = useAgentStore(state => state.pendingToolApproval)
  const conversation = useAgentStore(state => state.activeConversationId)
  const target = useTaskNavigation(state => state.approval)
  const region = useRef<HTMLDivElement>(null)
  const current = pending?.conversationId === conversation && pending?.isCurrent() ? pending.toolCall : undefined

  useLayoutEffect(() => {
    if (target?.scope !== scope || target.id !== current?.id || !region.current) return
    region.current.focus()
    region.current.scrollIntoView?.({ block: 'nearest' })
    useTaskNavigation.setState({ approval: null })
  }, [scope, target, current?.id])

  return current ? <div ref={region} tabIndex={-1} data-agent-approval={current.id}>
    <ConfirmCard key={current.id} toolCall={current} />
  </div> : null
}
