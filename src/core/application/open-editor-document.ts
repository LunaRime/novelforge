import type { EditorOpenPort, EditorOpenRequest, OpenedEditorDocument } from '../ports/editor-open'

export class EditorOpenScopeChanged extends Error {
  constructor() { super('Editor open project scope changed'); this.name = 'EditorOpenScopeChanged' }
}
export type EditorOpenResult = { status: 'missing' } | { status: 'opened'; document: OpenedEditorDocument }

/** Read and publish against one source project, including same-path reopen sessions. */
export async function openEditorDocument(request: EditorOpenRequest, ports: EditorOpenPort): Promise<EditorOpenResult> {
  const scope = { ...ports.scope() }
  const assertCurrent = () => {
    const current = ports.scope()
    if (current.projectId !== scope.projectId || current.projectPath !== scope.projectPath || current.session !== scope.session) {
      throw new EditorOpenScopeChanged()
    }
  }
  const captured = { ...request }
  assertCurrent()
  let document: OpenedEditorDocument | null
  try {
    document = await ports.resolve(captured, assertCurrent)
  } catch (error) {
    // A failure from an obsolete project must not become feedback in the next project.
    assertCurrent()
    throw error
  }
  assertCurrent()
  if (!document) return { status: 'missing' }
  ports.publish(document)
  return { status: 'opened', document }
}
