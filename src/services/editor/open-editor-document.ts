import { openEditorDocument, type EditorOpenPort, type EditorOpenRequest, type OpenedEditorDocument } from '../../core'
import { useProjectStore } from '../../stores/project-store'
import { useEditorStore } from '../../stores/editor-store'
import { ipc } from '../ipc-client'
import { CORE_FIELD_MAP, VELA, draftUri } from '../vela-protocol'
import { t } from '../../shared/locale'

const readFailure = () => new Error(t('tool.readFileFailed'))

/** Renderer IO adapter: each read boundary is checked before another project-scoped IPC. */
export function createRendererEditorOpenPort(): EditorOpenPort {
  return {
    scope: () => {
      const state = useProjectStore.getState()
      return { projectId: state.currentProject?.id ?? null, projectPath: state.currentProject?.path ?? null, session: state.projectSession }
    },
    resolve: async (request, assertCurrent) => {
      assertCurrent()
      if (request.kind === 'latest-draft') {
        if (!useProjectStore.getState().currentProject) throw new Error(t('error.noProject'))
        const draft = await ipc.invoke('db:draft-get-latest', request.chapterNumber)
        assertCurrent()
        if (!draft) return null
        const locator = draftUri(draft.id)
        const full = await ipc.invoke('db:draft-get-full', draft.id)
        assertCurrent()
        if (!full || typeof full.content !== 'string') throw readFailure()
        const label = t('chapter.label').replace('{n}', String(request.chapterNumber))
        const title = request.chapterTitle
        const titlePart = title && !title.startsWith(label) ? ` ${title}` : (title ?? '')
        return { id: `doc:${draft.id}`, docId: draft.id, locator, name: `${label}${titlePart}（${t('editor.draft')}）`, kind: 'chapter', content: full.content }
      }
      const content = await readDocument(request.locator, assertCurrent)
      assertCurrent()
      return { id: request.locator, locator: request.locator, name: request.name, kind: request.documentKind, content }
    },
    publish: (document: OpenedEditorDocument) => useEditorStore.getState().openFile({
      id: document.id, docId: document.docId, filePath: document.locator,
      type: document.kind, name: document.name, content: document.content,
    }),
  }
}

export async function readDocument(locator: string, assertCurrent: () => void): Promise<string> {
  assertCurrent()
  if (locator.startsWith('vela://') && !useProjectStore.getState().currentProject) throw new Error(t('error.noProject'))
  const match = /^vela:\/\/(draft|manuscript|revision|review)\/([1-9]\d*)$/.exec(locator)
  if (match) {
    const id = Number(match[2])
    if (!Number.isSafeInteger(id)) throw readFailure()
    const result = match[1] === 'draft' || match[1] === 'manuscript'
      ? await ipc.invoke('db:draft-get-full', id)
      : match[1] === 'revision' ? await ipc.invoke('db:revision-get-full', id)
        : await ipc.invoke('db:review-get-full', id)
    assertCurrent()
    if (!result || typeof result.content !== 'string') throw readFailure()
    return result.content
  }
  if (locator.startsWith(VELA.CORE)) {
    const field = CORE_FIELD_MAP[locator.slice(VELA.CORE.length)]
    if (!field) throw readFailure()
    const data = await ipc.invoke('db:project-core-get')
    assertCurrent()
    if (!data) throw readFailure()
    const content = (data as unknown as Record<string, unknown>)[field]
    if (content == null) return ''
    if (typeof content !== 'string') throw readFailure()
    return content
  }
  if (locator.startsWith(VELA.MEMORY)) {
    const content = await ipc.invoke('memory:read', locator.slice(VELA.MEMORY.length))
    assertCurrent()
    if (typeof content !== 'string') throw readFailure()
    return content
  }
  if (locator.startsWith('vela://')) throw readFailure()
  const result = await ipc.invoke('fs:read-file', locator)
  assertCurrent()
  if (!result.success || typeof result.content !== 'string') throw new Error(result.error ?? t('tool.readFileFailed'))
  return result.content
}

export function openRendererEditorDocument(request: EditorOpenRequest) {
  return openEditorDocument(request, createRendererEditorOpenPort())
}
