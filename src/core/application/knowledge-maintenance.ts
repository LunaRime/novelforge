import type { KnowledgeMaintenancePorts, MaintenanceKind, MaintenanceReceipt } from '../ports/knowledge-maintenance'
import { KnowledgeRequestCancelled } from './knowledge'

export class KnowledgeMaintenanceBusy extends Error {
  constructor() { super('Knowledge maintenance is already running'); this.name = 'KnowledgeMaintenanceBusy' }
}

/** One instance owns a project session, a statistics request lane, and its maintenance mutex. */
export function createKnowledgeMaintenanceApplication(ports: KnowledgeMaintenancePorts, initial = ports.scope()) {
  const source = initial ? { ...initial } : null
  let disposed = false
  let busy = false
  let countVersion = 0
  const assertScope = () => {
    const current = ports.scope()
    if (disposed || !source || !current || source.id !== current.id || source.path !== current.path || source.session !== current.session) throw new KnowledgeRequestCancelled()
  }
  const count = async (): Promise<number> => {
    const version = ++countVersion
    const check = () => {
      assertScope()
      if (version !== countVersion) throw new KnowledgeRequestCancelled()
    }
    check()
    try {
      const value = await ports.vectorlessCount()
      check()
      return value
    } catch (error) { check(); throw error }
  }
  return {
    count,
    async run(kind: MaintenanceKind): Promise<MaintenanceReceipt> {
      assertScope()
      if (busy) throw new KnowledgeMaintenanceBusy()
      busy = true
      try {
        // Already dispatched IO cannot be undone; only publication is cancelled.
        const result = await ports.backfill(kind)
        assertScope()
        if (!result.success) return { result }
        try { return { result, vectorlessCount: await count() } }
        catch (error) {
          assertScope()
          // A newer statistics request only supersedes the projection, not the commit.
          if (error instanceof KnowledgeRequestCancelled) return { result }
          return { result, refreshError: String(error) }
        }
      } catch (error) { assertScope(); throw error }
      finally { busy = false }
    },
    dispose() { disposed = true; countVersion++ },
  }
}
