import type { ConfigGenerationSnapshot, ConfigUndoToken, NovelConfigPorts, NovelConfigScope } from '../ports/novel-config'
import type { ConfigField, WorkflowReceipt, WorkflowStartRequest } from './start-workflow'

export class NovelConfigRequestCancelled extends Error {
  constructor() { super('Novel config request is no longer current'); this.name = 'NovelConfigRequestCancelled' }
}
export class NovelConfigSaveRejected extends Error {
  constructor() { super('Novel config save was rejected'); this.name = 'NovelConfigSaveRejected' }
}
export class NovelConfigBusy extends Error {
  constructor() { super('Novel config operation is already in progress'); this.name = 'NovelConfigBusy' }
}
const sameSource = (a: Readonly<NovelConfigScope>, b: Readonly<NovelConfigScope> | null) => !!b && a.id === b.id && a.path === b.path && a.session === b.session

/** One project session. Config remains in the injected projection; snapshots are transient. */
export function createNovelConfigApplication<C extends object>(ports: NovelConfigPorts<C>, initial = ports.scope()) {
  const source = initial ? Object.freeze({ ...initial }) : null
  let disposed = false
  let saving = false
  let starting = false
  const tokens = new WeakMap<ConfigUndoToken<C>, { patch: Partial<C>; versions: Partial<Record<keyof C, number>> }>()
  const assertCurrent = () => {
    if (disposed || !source || !sameSource(source, ports.scope())) throw new NovelConfigRequestCancelled()
  }
  const snapshot = (): ConfigGenerationSnapshot<C> => {
    assertCurrent()
    return Object.freeze({ source: source!, config: Object.freeze(structuredClone(ports.config())), fieldVersions: Object.freeze({ ...ports.fieldVersions() }) })
  }
  const start = async (request: WorkflowStartRequest): Promise<WorkflowReceipt> => {
    assertCurrent()
    if (starting) throw new NovelConfigBusy()
    starting = true
    try {
      const receipt = await ports.startWorkflow(request)
      assertCurrent()
      return receipt
    } catch (error) { assertCurrent(); throw error }
    finally { starting = false }
  }
  return {
    assertCurrent, snapshot,
    dispose() { disposed = true },
    hasModel() { assertCurrent(); return ports.hasModel() },
    ownsRun(runId: string) { return !disposed && !!source && sameSource(source, ports.scope()) && ports.ownsRun(runId, source) },
    update(patch: Partial<C>) { assertCurrent(); ports.update(patch) },
    async save(): Promise<void> {
      assertCurrent()
      if (saving) throw new NovelConfigBusy()
      const config = structuredClone(ports.config())
      saving = true
      try {
        const success = await ports.save(config)
        assertCurrent()
        if (!success) throw new NovelConfigSaveRejected()
      } catch (error) { assertCurrent(); throw error }
      finally { saving = false }
    },
    applyGenerated(patch: Partial<C>, captured: ConfigGenerationSnapshot<C>): { status: 'applied'; undo: ConfigUndoToken<C> } | { status: 'conflict'; fields: (keyof C)[] } {
      assertCurrent()
      if (!sameSource(source!, captured.source)) throw new NovelConfigRequestCancelled()
      const fields = Object.keys(patch) as (keyof C)[]
      const versions = ports.fieldVersions()
      const conflicts = fields.filter(field => (versions[field] ?? 0) !== (captured.fieldVersions[field] ?? 0))
      if (conflicts.length) return { status: 'conflict', fields: conflicts }
      const current = ports.config()
      const previous: Partial<C> = {}
      for (const field of fields) previous[field] = structuredClone(current[field])
      ports.update(structuredClone(patch))
      const undo: ConfigUndoToken<C> = Object.freeze({ source: source!, fields: Object.freeze([...fields]) })
      const after = ports.fieldVersions()
      const appliedVersions: Partial<Record<keyof C, number>> = {}
      for (const field of fields) appliedVersions[field] = after[field] ?? 0
      tokens.set(undo, { patch: previous, versions: appliedVersions })
      return { status: 'applied', undo }
    },
    undo(token: ConfigUndoToken<C>): boolean {
      assertCurrent()
      const saved = tokens.get(token)
      if (!saved || !sameSource(source!, token.source)) return false
      const current = ports.fieldVersions()
      if (token.fields.some(field => (current[field] ?? 0) !== saved.versions[field])) return false
      ports.update(structuredClone(saved.patch))
      tokens.delete(token)
      return true
    },
    startField(field: ConfigField) { return start({ workflow: 'generate_config_field', fieldKey: field }) },
    startBulk(idea: string, totalChapters?: number, wordsPerChapter?: number) { return start({ workflow: 'config_generation', idea, totalChapters, wordsPerChapter }) },
  }
}
