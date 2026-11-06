export interface EditorOpenScope { projectId: string | null; projectPath: string | null; session: number }
export type EditorOpenRequest =
  | { kind: 'latest-draft'; chapterNumber: number; chapterTitle?: string }
  | { kind: 'path'; locator: string; name: string; documentKind: 'chapter' | 'arch-file' }
export interface OpenedEditorDocument {
  id: string
  locator: string
  name: string
  kind: 'chapter' | 'arch-file'
  content: string
  docId?: number
}
export interface EditorOpenPort {
  scope(): EditorOpenScope
  resolve(request: EditorOpenRequest, assertCurrent: () => void): Promise<OpenedEditorDocument | null>
  publish(document: OpenedEditorDocument): void
}
