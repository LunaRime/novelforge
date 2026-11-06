export type MaintenanceKind = 'vectors' | 'tokens'

export interface MaintenanceResult {
  success: boolean
  processed: number
  failed: number
  error?: string
  errorCode?: 'dim-mismatch'
}

export interface KnowledgeMaintenancePorts {
  scope(): { id: string; path: string; session: number } | null
  vectorlessCount(): Promise<number>
  backfill(kind: MaintenanceKind): Promise<MaintenanceResult>
}

export interface MaintenanceReceipt {
  result: MaintenanceResult
  vectorlessCount?: number
  refreshError?: string
}
