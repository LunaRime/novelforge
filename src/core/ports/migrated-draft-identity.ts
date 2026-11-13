export interface MigratedDraftIdentityMap {
  format: 1
  projectId: string
  sourceFingerprint: string
  manifestHash: string
  entries: MigratedDraftIdentity[]
}

export interface MigratedDraftIdentity {
  draftId: number
  chapterId: string
  version: number
  branchId: number | null
  target: { kind: 'current'; locator: string } |
    { kind: 'history'; path: string; fileChapterId: string; fileHash: string }
}
