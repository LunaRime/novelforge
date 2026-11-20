import { useCallback, useMemo, type SetStateAction } from 'react'
import { create } from 'zustand'
import { useAgentStore } from '../../../stores/agent-store'
import { useProjectStore } from '../../../stores/project-store'
import { useWorkflowStore } from '../../../stores/workflow-store'

export function useAgentPanelScope(): string {
  return useProjectStore(projectScope)
}

function projectScope(state: ReturnType<typeof useProjectStore.getState>): string {
  return JSON.stringify([
    state.currentProject?.id, state.currentProject?.path, state.projectSession,
  ])
}

interface DraftState {
  scope: string
  drafts: ReadonlyMap<string | null, string>
}

const useDrafts = create<DraftState>(() => ({ scope: '', drafts: new Map() }))

export function useAgentComposerDraft() {
  const scope = useAgentPanelScope()
  const id = useAgentStore(state => state.activeConversationId)
  const text = useDrafts(state => state.scope === scope ? state.drafts.get(id) ?? '' : '')
  const setText = useCallback((update: SetStateAction<string>) => {
    if (projectScope(useProjectStore.getState()) !== scope) return
    useDrafts.setState(state => {
      const drafts = new Map(state.scope === scope ? state.drafts : undefined)
      const next = typeof update === 'function' ? update(drafts.get(id) ?? '') : update
      if (next) drafts.set(id, next)
      else drafts.delete(id)
      return { scope, drafts }
    })
  }, [scope, id])
  return [text, setText] as const
}

interface TaskNavigation {
  workflow: { scope: string; id: string } | null
  approval: { scope: string; id: string } | null
  output: { scope: string; id: string | null } | null
}

export const useTaskNavigation = create<TaskNavigation>(() => ({ workflow: null, approval: null, output: null }))

export function useScopedWorkflowRuns() {
  const scope = useAgentPanelScope()
  const active = useWorkflowStore(state => state.activeRuns)
  const history = useWorkflowStore(state => state.history)
  const isCurrent = useWorkflowStore(state => state.isRunCurrent)
  return useMemo(() => ({
    scope,
    activeRuns: active.filter(run => isCurrent?.(run.id) ?? true),
    history: history?.filter(run => isCurrent?.(run.id) ?? true) ?? [],
  }), [scope, active, history, isCurrent])
}

export interface ReadingPosition {
  top: number
  following: boolean
}

let readingScope = ''
const readingPositions = new Map<string, ReadingPosition>()

export function readAgentPosition(scope: string, id: string): ReadingPosition | undefined {
  return readingScope === scope ? readingPositions.get(id) : undefined
}

export function rememberAgentPosition(scope: string, id: string, position: ReadingPosition): void {
  if (readingScope !== scope) {
    readingPositions.clear()
    readingScope = scope
  }
  readingPositions.set(id, position)
}
