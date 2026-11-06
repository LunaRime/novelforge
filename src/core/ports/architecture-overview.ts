import type { ArchitectureScope, ArchitectureStep } from './architecture-document'

export type ArchitectureFieldRead = { status: 'ready'; content: string } | { status: 'missing' } | { status: 'failed'; error: string }
export type ArchitectureFieldOverview = { status: 'ready'; generated: boolean; wordCount: number } | { status: 'missing' } | { status: 'failed'; error: string }
export interface ArchitectureOverviewResult {
  fields: Record<ArchitectureStep, ArchitectureFieldOverview>
  postProcess: { status: 'ready'; allCriticalPassed: boolean | null } | { status: 'failed'; error: string }
}
export interface ArchitectureOverviewPorts {
  scope(): ArchitectureScope | null
  readFields(): Promise<Record<ArchitectureStep, ArchitectureFieldRead>>
  readPostProcess(): Promise<boolean | null>
}
