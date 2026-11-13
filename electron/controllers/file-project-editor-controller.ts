import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { FileChapterStore, MemoryChapterIndex, openProjectInspection, fileRevision,
  createFileEditorOpenPort, openEditorDocument, type MigratedDraftIdentityMap } from '../../src/core'
import type { ProjectChannels } from '../../src/shared/ipc-channels'
import { guardedHandle } from '../security/ipc-guard'
import { assertPathAllowedForIpc } from './fs-controller'
import { createFileDraftLifecycle, type FileDraftCommand } from '../services/file-draft-lifecycle'

const candidateRecord = '.novelforge/file-editor.json'
const identityFile = '.novelforge/draft-identity.json'
const manifestFile = 'migration-manifest.json'
const legacyBarrier = '.novelforge/vela.db'
const retainedFile = '.novelforge/retained.db'
const current = /^doc:\/\/chapter\/(ch_[a-f0-9]{8,64})$/
type OpenResult = ProjectChannels['project:file-editor-open']['return']
type Lifecycle = ReturnType<typeof createFileDraftLifecycle>

interface FileEditorSession {
  token: string
  projectPath: string
  repo: FileChapterStore
  assertCandidate: () => Promise<void>
  withLifecycle?: <T>(work: (lifecycle: Lifecycle) => Promise<T>) => Promise<T>
}

export function registerFileProjectEditorController() {
  const sessions = new Map<number, FileEditorSession>()
  const observed = new WeakSet<object>()
  const requests = new Map<number, string>()

  guardedHandle('project:file-editor-open', async ({ sender }, projectPath: string, locators: string[]): Promise<OpenResult> => {
    if (!Array.isArray(locators) || locators.length > 100 || locators.some(locator => typeof locator !== 'string' || locator.length > 200)) {
      throw new Error('Invalid file editor tabs')
    }
    const path = assertPathAllowedForIpc(projectPath, 'read')
    if (!observed.has(sender)) {
      observed.add(sender)
      sender.once('destroyed', () => { sessions.delete(sender.id); requests.delete(sender.id) })
    }
    const token = randomUUID()
    requests.set(sender.id, token)
    sessions.delete(sender.id)
    const reader = await openProjectInspection(path)
    const recordText = await reader.readText(candidateRecord)
    const record = JSON.parse(recordText)
    const mapping = await reader.readText(identityFile)
    const identity = JSON.parse(mapping) as MigratedDraftIdentityMap
    const manifest = await reader.readText(manifestFile)
    const project = JSON.parse(await reader.readText('novel.json'))
    if (record?.format !== 1 || project?.schemaVersion !== 1 || typeof project.id !== 'string' ||
        record.projectId !== project.id || identity?.format !== 1 || identity.projectId !== project.id ||
        !Array.isArray(identity.entries) || identity.manifestHash !== fileRevision(manifest) ||
        record.identityHash !== fileRevision(mapping) ||
        (record.lifecycle !== undefined && record.lifecycle !== 1)) throw new Error('Invalid file editor candidate')
    const assertCandidate = async () => {
      if (await reader.kind(legacyBarrier) !== 'directory' || await reader.kind('.vela') !== 'missing' ||
          await reader.readText(candidateRecord) !== recordText || await reader.readText(identityFile) !== mapping ||
          await reader.readText(manifestFile) !== manifest ||
          (record.lifecycle === 1 && await reader.kind(retainedFile) !== 'file')) throw new Error('File editor candidate changed')
    }
    await assertCandidate()
    assertPathAllowedForIpc(path, 'write')
    const repo = await FileChapterStore.open({ projectPath: path, projectId: identity.projectId, index: new MemoryChapterIndex() })
    const withLifecycle: FileEditorSession['withLifecycle'] = record.lifecycle === 1 ? async work => {
      await assertCandidate()
      // Open a separately provisioned copy. The migration backup and legacy DB barrier remain untouched.
      const db = new Database(join(path, retainedFile), { fileMustExist: true })
      try {
        return await work(createFileDraftLifecycle(db, repo, identity.projectId, identity.entries, () => {
          if (requests.get(sender.id) !== token) throw new Error('File editor session changed')
        }))
      }
      finally { db.close() }
    } : undefined
    // Resolve pending metadata before returning writable tabs. An ambiguous recovery fails the open.
    if (withLifecycle) await withLifecycle(lifecycle => lifecycle.recover())
    const chapters = await repo.list()
    const documents = [
      ...chapters.map(chapter => ({ locator: `doc://chapter/${chapter.id}`, name: chapter.title || String(chapter.number) })),
      ...identity.entries.filter(entry => entry.target.kind === 'history').map(entry => ({
        locator: `doc://history/${entry.draftId}`,
        name: chapters.find(chapter => chapter.id === entry.chapterId)?.title || String(entry.draftId),
      })),
    ]
    const names = new Map(documents.map(document => [document.locator, document.name]))
    const scope = () => ({ projectId: identity.projectId, projectPath: path, session: requests.get(sender.id) === token ? 1 : 2 })
    const port = await createFileEditorOpenPort({ projectPath: path, identity, repo, scope, publish: () => {} })
    const tabs: OpenResult['tabs'] = []
    const missing: string[] = []
    for (const locator of locators) {
      const result = await openEditorDocument({ kind: 'path', documentKind: 'chapter', locator, name: locator }, port)
      if (result.status === 'missing') { missing.push(locator); continue }
      tabs.push({ ...result.document, name: names.get(result.document.locator) ?? result.document.name })
    }
    if (requests.get(sender.id) !== token) throw new Error('File editor session changed')
    sessions.set(sender.id, { token, projectPath: path, repo, assertCandidate, withLifecycle })
    return { token, tabs, missing, documents }
  })

  guardedHandle('project:file-editor-save', async ({ sender }, token: string, locator: string, revision: string, content: string) => {
    const session = sessions.get(sender.id)
    const id = current.exec(locator)?.[1]
    if (!session || session.token !== token || requests.get(sender.id) !== token ||
        !id || typeof content !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) throw new Error('Invalid file editor save')
    assertPathAllowedForIpc(session.projectPath, 'write')
    await session.assertCandidate()
    const result = await session.repo.withCommitLock(async repo => {
      // A pending cross-store operation must recover before a plain save can advance the file revision.
      if (session.withLifecycle) await session.withLifecycle(async lifecycle => lifecycle.assertIdle())
      const stored = await repo.byId(id)
      if (!stored || stored.revision !== revision || ['finalized', 'archived'].includes(stored.chapter.status)) {
        throw new Error('Chapter changed or is read-only')
      }
      if (requests.get(sender.id) !== token) throw new Error('File editor session changed')
      return repo.save({ ...stored.chapter, content, updatedAt: new Date().toISOString() }, { expectedRevision: revision })
    })
    return { revision: result.revision, indexed: result.indexed }
  })

  guardedHandle('project:file-editor-commit', async ({ sender }, token: string, command: FileDraftCommand) => {
    const session = sessions.get(sender.id)
    if (!session?.withLifecycle || session.token !== token || requests.get(sender.id) !== token) {
      throw new Error('Invalid file editor lifecycle session')
    }
    assertPathAllowedForIpc(session.projectPath, 'write')
    return session.withLifecycle(lifecycle => {
      if (requests.get(sender.id) !== token) throw new Error('File editor session changed')
      return lifecycle.commit(command)
    })
  })

  guardedHandle('project:file-editor-close', ({ sender }, token: string) => {
    if (sessions.get(sender.id)?.token !== token) return
    sessions.delete(sender.id)
    if (requests.get(sender.id) === token) requests.delete(sender.id)
  })
}
