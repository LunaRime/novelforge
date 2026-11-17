import type { WorkflowReceipt, WorkflowStartRequest } from '../application/start-workflow'

export interface NovelConfigScope { id: string; path: string; session: number }
export type ConfigFieldVersions<C extends object> = Partial<Record<keyof C, number>>
export interface ConfigGenerationSnapshot<C extends object> {
  readonly source: Readonly<NovelConfigScope>
  readonly config: Readonly<C>
  readonly fieldVersions: Readonly<ConfigFieldVersions<C>>
}
/** Opaque receipt: only the issuing application can use it once. */
export interface ConfigUndoToken<C extends object> { readonly source: Readonly<NovelConfigScope>; readonly fields: readonly (keyof C)[] }
export interface NovelConfigPorts<C extends object> {
  scope(): NovelConfigScope | null
  config(): C
  fieldVersions(): ConfigFieldVersions<C>
  update(patch: Partial<C>): void
  save(config: C): Promise<boolean>
  savePatch(patch: Partial<C>, onCommitted?: () => void): Promise<void>
  hasModel(): boolean
  ownsRun(runId: string, source: NovelConfigScope): boolean
  startWorkflow(request: WorkflowStartRequest): Promise<WorkflowReceipt>
}
