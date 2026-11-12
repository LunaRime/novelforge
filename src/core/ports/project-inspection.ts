export interface ProjectIssue {
  code: 'unsafe-path' | 'unreadable-path' | 'invalid-project' | 'invalid-manifest' | 'invalid-chapter' |
    'project-mismatch' | 'name-mismatch' | 'duplicate-id' | 'number-conflict' | 'missing-body' |
    'lock-present' | 'temporary-file' | 'database-sidecar' | 'unreadable-database' |
    'database-schema' | 'orphan-reference'
  path: string
  relatedPath?: string
  table?: string
  rowId?: number | string
  field?: string
}

export interface ProjectInspectionReader {
  kind(path: string): Promise<'file' | 'directory' | 'unsafe' | 'missing'>
  list(path: string): Promise<string[]>
  readText(path: string): Promise<string>
  inspectLegacyDatabase(): Promise<ProjectIssue[]>
}

export interface ProjectInspectionReport {
  projectId: string | null
  ok: boolean
  legacyDatabase: 'absent' | 'checked' | 'skipped'
  issues: ProjectIssue[]
}
