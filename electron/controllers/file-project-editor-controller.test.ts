import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, test, vi } from 'vitest'
import { exportLegacyProject } from '../../src/core/migration/export-legacy-project'
import { fileRevision, parseChapter } from '../../src/core/adapters/chapter-format'
import type { ProjectChannels } from '../../src/shared/ipc-channels'

const handlers = vi.hoisted(() => new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>())
vi.mock('electron', () => ({}))
vi.mock('better-sqlite3', () => ({ default: DatabaseSync }))
vi.mock('../security/ipc-guard', () => ({ guardedHandle: (key: string, handler: never) => handlers.set(key, handler) }))
vi.mock('./fs-controller', () => ({ assertPathAllowedForIpc: (path: string) => path }))

import { registerFileProjectEditorController } from './file-project-editor-controller'

test('opens, saves, and restores candidate tabs via IPC with revision and sender checks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-file-editor-ipc-'))
  try {
    const project = join(root, 'project')
    const projectId = 'project'
    await exportLegacyProject({ destination: project, projectId, source: {
      listDrafts: async () => [1, 2, 3].map(id => ({ id, chapterNumber: id === 3 ? 3 : 1, version: id, branchId: null,
        status: id === 3 ? 'archived' : 'draft', title: 'chapter', content: String(id), contentHash: '', createdAt: 1, updatedAt: 2 })),
      backup: async path => { await writeFile(path, 'fixture') },
    } })
    const chapterId = parseChapter(await readFile(join(project, 'chapters/0001.md'), 'utf8')).id
    const [archivedId] = (await readdir(join(project, 'history'))).filter(id => id !== chapterId)
    const history = `history/${chapterId}/1.md`
    const archivedHistory = `history/${archivedId}/3.md`
    const manifest = await readFile(join(project, 'migration-manifest.json'), 'utf8')
    const locator = `doc://chapter/${chapterId}`
    const mapping = JSON.stringify({ format: 1, projectId, manifestHash: fileRevision(manifest), entries: [
      { draftId: 1, chapterId, version: 1, branchId: null,
        target: { kind: 'history', path: history, fileChapterId: chapterId, fileHash: fileRevision(await readFile(join(project, history), 'utf8')) } },
      { draftId: 2, chapterId, version: 2, branchId: null, target: { kind: 'current', locator } },
      { draftId: 3, chapterId: archivedId, version: 3, branchId: null,
        target: { kind: 'history', path: archivedHistory, fileChapterId: archivedId,
          fileHash: fileRevision(await readFile(join(project, archivedHistory), 'utf8')) } },
    ] })
    await mkdir(join(project, '.novelforge/vela.db'), { recursive: true })
    await writeFile(join(project, '.novelforge/draft-identity.json'), mapping)
    const db = new DatabaseSync(join(project, '.novelforge/retained.db'))
    try {
      db.exec(`
        CREATE TABLE contents (id INTEGER PRIMARY KEY, body TEXT);
        CREATE TABLE drafts (id INTEGER PRIMARY KEY, chapter_number INTEGER, content_id INTEGER);
        CREATE TABLE revisions (id INTEGER PRIMARY KEY, base_draft_id INTEGER, content_id INTEGER,
          status TEXT, merged_to_draft_id INTEGER, updated_at INTEGER);
        INSERT INTO contents VALUES (1, 'proposal');
        INSERT INTO drafts VALUES (3, 3, NULL);
        INSERT INTO revisions VALUES (4, 2, 1, 'pending', NULL, 0);
      `)
    } finally { db.close() }
    await writeFile(join(project, '.novelforge/file-editor.json'), JSON.stringify({ format: 1, projectId, identityHash: fileRevision(mapping), lifecycle: 1 }))
    const sender = { id: 1, once: vi.fn() }
    const invoke = (key: string, ...args: unknown[]) => handlers.get(`project:file-editor-${key}`)!({ sender }, ...args)
    registerFileProjectEditorController()
    const opened = await invoke('open', project, ['vela://draft/1', locator]) as ProjectChannels['project:file-editor-open']['return']
    expect(opened.tabs).toMatchObject([{ content: '1', readOnly: true }, { content: '2', readOnly: false }])
    const revision = opened.tabs[1].revision
    await expect(invoke('save', opened.token, 'doc://history/1', revision, 'bad')).rejects.toThrow()
    await expect(handlers.get('project:file-editor-save')!({ sender: { id: 2 } }, opened.token, locator, revision, 'bad')).rejects.toThrow()
    expect(await invoke('save', opened.token, locator, revision, 'updated')).toMatchObject({ indexed: true })
    await expect(invoke('save', opened.token, locator, revision, 'stale')).rejects.toThrow()
    registerFileProjectEditorController()
    const restored = await invoke('open', project, opened.tabs.map(tab => tab.locator)) as ProjectChannels['project:file-editor-open']['return']
    expect(restored.tabs).toMatchObject([{ content: '1', readOnly: true }, { content: 'updated' }])
    await expect(invoke('save', opened.token, locator, revision, 'old session')).rejects.toThrow()
    expect(restored.tabs[1].lifecycle?.pending).toEqual([{ id: 4 }])
    const preview = await invoke('preview', restored.token, chapterId, 4) as ProjectChannels['project:file-editor-preview']['return']
    expect(preview.content).toBe('proposal')
    const merge = { kind: 'merge', chapterId, expectedRevision: restored.tabs[1].revision, revisionId: 4 }
    await expect(invoke('commit', restored.token, { ...merge, proposalHash: '0'.repeat(64) })).rejects.toThrow('after preview')
    const merged = await invoke('commit', restored.token, { ...merge, proposalHash: preview.contentHash }) as ProjectChannels['project:file-editor-commit']['return']
    const retained = new DatabaseSync(join(project, '.novelforge/retained.db'))
    try { retained.exec("CREATE TRIGGER interrupt BEFORE UPDATE ON file_draft_states BEGIN SELECT RAISE(ABORT, 'interrupted'); END") }
    finally { retained.close() }
    await expect(invoke('commit', restored.token, { kind: 'finalize', chapterId, expectedRevision: merged.revision })).rejects.toThrow('interrupted')
    const repaired = new DatabaseSync(join(project, '.novelforge/retained.db'))
    try { repaired.exec('DROP TRIGGER interrupt') } finally { repaired.close() }
    registerFileProjectEditorController()
    const recovered = await invoke('open', project, [locator]) as ProjectChannels['project:file-editor-open']['return']
    expect(recovered.tabs).toMatchObject([{ content: 'proposal', readOnly: true }])
    await expect(invoke('save', recovered.token, locator, recovered.tabs[0].revision, 'finalized')).rejects.toThrow('read-only')
    expect(await invoke('commit', recovered.token, { kind: 'archive', chapterId, expectedRevision: recovered.tabs[0].revision }))
      .toMatchObject({ status: 'committed' })
    const create = { kind: 'create', chapterId: 'ch_abcd1234', number: 2, title: 'New chapter', content: 'first draft',
      createdAt: '2026-01-01T00:00:00.000Z' }
    await expect(invoke('commit', opened.token, create)).rejects.toThrow('lifecycle session')
    await expect(invoke('commit', recovered.token, { ...create, number: 3 })).rejects.toThrow('migration history')
    await expect(invoke('commit', recovered.token, { ...create, chapterId: archivedId })).rejects.toThrow('migration history')
    const interrupted = new DatabaseSync(join(project, '.novelforge/retained.db'))
    try {
      interrupted.exec("CREATE TRIGGER interrupt BEFORE INSERT ON file_draft_states BEGIN SELECT RAISE(ABORT, 'interrupted'); END")
      await expect(invoke('commit', recovered.token, create)).rejects.toThrow('interrupted')
      interrupted.exec('DROP TRIGGER interrupt')
    } finally { interrupted.close() }
    registerFileProjectEditorController()
    const newLocator = `doc://chapter/${create.chapterId}`
    const reopened = await invoke('open', project, [newLocator]) as ProjectChannels['project:file-editor-open']['return']
    expect(reopened.documents).toContainEqual({ locator: newLocator, name: create.title })
    expect(reopened.tabs).toMatchObject([{ content: create.content, readOnly: false }])
    expect(await invoke('commit', reopened.token, create)).toEqual({ status: 'committed', revision: reopened.tabs[0].revision })
    await expect(invoke('commit', reopened.token, { ...create, content: 'different request' })).rejects.toThrow()
    const source = [{ title: 'Imported A', content: 'text A' }, { title: 'Imported B', content: 'text B' }]
    await expect(invoke('import', recovered.token, 4, source)).rejects.toThrow('lifecycle session')
    await expect(invoke('import', reopened.token, 4, [source[0], { title: 'Invalid', content: null }])).rejects.toThrow()
    expect(await readdir(join(project, 'chapters'))).not.toContain('0004.md')
    const imported = await invoke('import', reopened.token, 4, source) as { completed: number; firstLocator: string }
    expect(imported).toMatchObject({ completed: 2 })
    registerFileProjectEditorController()
    const withImports = await invoke('open', project, [imported.firstLocator]) as ProjectChannels['project:file-editor-open']['return']
    expect(withImports.tabs).toMatchObject([{ content: 'text A', readOnly: false }])
    expect(await invoke('import', withImports.token, 4, source)).toEqual(imported)
    expect(await invoke('import', withImports.token, 4, [source[0], { ...source[1], content: 'different' }]))
      .toEqual({ completed: 1, firstLocator: imported.firstLocator, blockedNumber: 5 })
    expect(parseChapter(await readFile(join(project, 'chapters/0005.md'), 'utf8')).content).toBe('text B')
    const { rmdir } = await import('node:fs/promises')
    await rmdir(join(project, '.novelforge/vela.db'))
    await expect(invoke('save', withImports.token, imported.firstLocator, withImports.tabs[0].revision, 'missing barrier')).rejects.toThrow('candidate changed')
    await expect(invoke('open', project, [locator])).rejects.toThrow('candidate changed')
  } finally { await rm(root, { recursive: true, force: true }) }
})
