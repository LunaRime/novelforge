import type { WorkflowReceipt, WorkflowStartRequest } from '../application/start-workflow'
export type ArchitectureStep = 'premise' | 'characters' | 'worldbuilding' | 'synopsis'
export interface ArchitectureScope { id: string; path: string; session: number }
export interface ArchitectureDocumentPorts {
  scope(): ArchitectureScope | null
  ownsRun?(runId: string, source: ArchitectureScope): boolean
  read(locator: string): Promise<string | null>
  write(locator: string, content: string): Promise<boolean>
  readArchitecture(): Promise<Record<ArchitectureStep, string>>
  existingCharacterCount(): Promise<number>
  startWorkflow(request: WorkflowStartRequest): Promise<WorkflowReceipt>
}
