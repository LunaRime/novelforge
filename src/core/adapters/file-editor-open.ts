import { resolve } from 'node:path'
import type { StoredChapter } from '../domain/chapter'
import type { EditorOpenPort } from '../ports/editor-open'
import type { MigratedDraftIdentityMap } from '../ports/migrated-draft-identity'
import { fileRevision, parseChapter } from './chapter-format'
import { openProjectInspection } from './file-project-inspection'

const currentLocator = /^doc:\/\/chapter\/(ch_[a-f0-9]{8,64})$/
const legacyLocator = /^vela:\/\/draft\/([1-9][0-9]*)$/
const historyLocator = /^doc:\/\/history\/([1-9][0-9]*)$/

interface Options {
  projectPath: string
  identity: MigratedDraftIdentityMap
  scope: EditorOpenPort['scope']
  repo: { byId(id: string): Promise<Pick<StoredChapter, 'chapter' | 'revision'> | null> }
  publish: EditorOpenPort['publish']
}

/** Opens documents against a verified offline mapping and a single editor session. */
export async function createFileEditorOpenPort({ projectPath, identity, scope, repo, publish }: Options): Promise<EditorOpenPort> {
  const captured = { ...scope() }
  const projectId = identity.projectId
  const matchesScope = () => {
    const active = scope()
    return captured.projectId === projectId && active.projectId === projectId &&
      active.projectPath === captured.projectPath && active.projectPath !== null &&
      resolve(active.projectPath) === resolve(projectPath) && active.session === captured.session
  }
  const reader = await openProjectInspection(projectPath)
  const entries = new Map(structuredClone(identity.entries).map(entry => [entry.draftId, entry]))
  return {
    scope,
    publish,
    async resolve(request, assertCurrent) {
      if (!matchesScope() || request.kind === 'latest-draft' ||
          (request.kind === 'path' && request.documentKind !== 'chapter')) return null
      assertCurrent()
      const locator = request.kind === 'path' ? request.locator : ''
      const chapterId = currentLocator.exec(locator)?.[1]
      const history = historyLocator.exec(locator)
      const draftId = request.kind === 'draft' ? request.draftId : Number((history ?? legacyLocator.exec(locator))?.[1])
      const mapped = entries.get(draftId)
      const target = mapped?.target
      if (target?.kind === 'history') {
        if (!currentLocator.test(`doc://chapter/${target.fileChapterId}`)) return null
        const path = `history/${target.fileChapterId}/${draftId}.md`
        if (target.path !== path || await reader.kind(path) !== 'file') return null
        assertCurrent()
        const text = await reader.readText(path)
        assertCurrent()
        if (fileRevision(text) !== target.fileHash) return null
        const chapter = parseChapter(text)
        if (chapter.projectId !== projectId || chapter.id !== target.fileChapterId || chapter.metadata?.legacyDraftId !== draftId) return null
        const locator = `doc://history/${draftId}`
        return { id: locator, locator, name: request.name, kind: 'chapter', content: chapter.content, readOnly: true }
      }
      const id = chapterId ?? mapped?.chapterId
      if (history || !id) return null
      const stored = await repo.byId(id)
      assertCurrent()
      if (!stored || stored.chapter.projectId !== projectId || stored.chapter.id !== id ||
          (!chapterId && stored.chapter.metadata?.legacyDraftId !== draftId)) return null
      const documentLocator = `doc://chapter/${id}`
      return { id: documentLocator, locator: documentLocator, name: request.name, kind: 'chapter',
        content: stored.chapter.content, readOnly: ['finalized', 'archived'].includes(stored.chapter.status),
        revision: stored.revision }
    },
  }
}
