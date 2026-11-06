import type { ArchitectureScope } from '../../core'

// Runtime-only attribution follows the workflow store's active/history retention.
const sources = new Map<string, ArchitectureScope>()

export function registerWorkflowSource(runId: string, source: ArchitectureScope, retainedRunIds: Iterable<string>): void {
  const retained = new Set(retainedRunIds)
  for (const id of sources.keys()) {
    if (!retained.has(id)) sources.delete(id)
  }
  sources.set(runId, { ...source })
}

export function belongsToWorkflowSource(runId: string, source: ArchitectureScope): boolean {
  const owner = sources.get(runId)
  return !!owner && owner.id === source.id && owner.path === source.path && owner.session === source.session
}
