import { cp, link, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, test, vi } from 'vitest'
import { exportLegacyProject } from '../../src/core/migration/export-legacy-project'
import { FileChapterStore } from '../../src/core/adapters/file-chapter-store'
import { fileRevision, parseChapter } from '../../src/core/adapters/chapter-format'
import type { ProjectChannels } from '../../src/shared/ipc-channels'

const handlers = vi.hoisted(() => new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>())
vi.mock('electron', () => ({}))
vi.mock('better-sqlite3', () => ({
  default: class extends DatabaseSync {
    constructor(path: string, options?: { readonly?: boolean }) {
      super(path, { readOnly: options?.readonly ?? false })
    }
  },
}))
vi.mock('../security/ipc-guard', () => ({ guardedHandle: (key: string, handler: never) => handlers.set(key, handler) }))
vi.mock('./fs-controller', () => ({ assertPathAllowedForIpc: (path: string) => path }))

import { registerFileProjectEditorController } from './file-project-editor-controller'

// 用真实文件与 SQLite 覆盖多次发布和中断恢复，给 Windows CI 的磁盘操作留出余量。
test('restores candidate operations and verifies import snapshots against receipts and session', async () => {
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
        CREATE TABLE project_core (id TEXT PRIMARY KEY, world_setting TEXT, core_outline TEXT,
          protagonist_profile TEXT, writing_style TEXT, updated_at INTEGER);
        INSERT INTO project_core VALUES ('main', 'Manual world', '', NULL, '', 0);
        CREATE TABLE blueprints (chapter_number INTEGER PRIMARY KEY, title TEXT, role TEXT, purpose TEXT,
          key_events TEXT, characters TEXT, suspense_hook TEXT, notes TEXT DEFAULT '');
        INSERT INTO blueprints VALUES (5, 'Manual', '发展', '', '', '[]', '', 'Handwritten');
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
    expect(await invoke('agent-list', opened.token, 0, 1)).toEqual({ chapters: [{ locator, number: 1, title: 'chapter', status: 'draft' }], nextOffset: null })
    expect(await invoke('agent-read', opened.token, locator, 0, 1)).toMatchObject({ locator, content: '2', nextOffset: null, totalChars: 1 })
    expect(await invoke('agent-read', opened.token, 'vela://draft/1', 0, 1)).toMatchObject({ locator: 'doc://history/1', content: '1', readOnly: true })
    const historyBytes = await readFile(join(project, history), 'utf8')
    await writeFile(join(project, history), `${historyBytes}tampered`)
    await expect(invoke('agent-read', opened.token, 'doc://history/1', 0, 1)).rejects.toThrow('unavailable')
    await writeFile(join(project, history), historyBytes)
    await expect(invoke('agent-read', opened.token, '../legacy.db', 0, 1)).rejects.toThrow('Invalid')
    await expect(handlers.get('project:file-editor-agent-read')!({ sender: { id: 2 } }, opened.token, locator, 0, 1)).rejects.toThrow('session')
    const revision = opened.tabs[1].revision
    await expect(invoke('save', opened.token, 'doc://history/1', revision, 'bad')).rejects.toThrow()
    await expect(handlers.get('project:file-editor-save')!({ sender: { id: 2 } }, opened.token, locator, revision, 'bad')).rejects.toThrow()
    expect(await invoke('save', opened.token, locator, revision, 'updated')).toMatchObject({ indexed: true })
    await expect(invoke('save', opened.token, locator, revision, 'stale')).rejects.toThrow()
    registerFileProjectEditorController()
    const restored = await invoke('open', project, opened.tabs.map(tab => tab.locator)) as ProjectChannels['project:file-editor-open']['return']
    expect(restored.tabs).toMatchObject([{ content: '1', readOnly: true }, { content: 'updated' }])
    await expect(invoke('agent-read', opened.token, locator, 0, 1)).rejects.toThrow('session')
    expect(await invoke('agent-read', restored.token, locator, 2, 3)).toMatchObject({ content: 'dat', totalChars: 7, nextOffset: 5 })
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
    const source = [{ title: 'Imported World', content: 'text A' }, { title: 'Imported B', content: 'text B' }]
    expect(await invoke('import-source', reopened.token, 4, source)).toEqual({ projectId, chapters: [] })
    const indexPath = join(project, '.novelforge/file-import-index.v1.db')
    expect(await invoke('index-import', reopened.token, 4, source)).toEqual({ indexed: 0, chunks: 0 })
    await expect(readFile(indexPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(invoke('import', recovered.token, 4, source)).rejects.toThrow('lifecycle session')
    await expect(invoke('import', reopened.token, 4, [source[0], { title: 'Invalid', content: null }])).rejects.toThrow()
    expect(await readdir(join(project, 'chapters'))).not.toContain('0004.md')
    const imported = await invoke('import', reopened.token, 4, source) as { completed: number; firstLocator: string }
    expect(imported).toMatchObject({ completed: 2 })
    registerFileProjectEditorController()
    const withImports = await invoke('open', project, [imported.firstLocator]) as ProjectChannels['project:file-editor-open']['return']
    expect(withImports.tabs).toMatchObject([{ content: 'text A', readOnly: false }])
    expect(await invoke('import', withImports.token, 4, source)).toEqual(imported)
    const importedChapter = async (number: number) => {
      const text = await readFile(join(project, 'chapters', `${String(number).padStart(4, '0')}.md`), 'utf8')
      const { id: chapterId, title, content } = parseChapter(text)
      return { chapterId, number, title, content, revision: fileRevision(text) }
    }
    const snapshot = { projectId, chapters: [await importedChapter(4), await importedChapter(5)] }
    expect(await invoke('import-source', withImports.token, 4, source)).toEqual(snapshot)
    expect(await invoke('index-import', withImports.token, 4, source)).toEqual({ indexed: 2, chunks: 2 })
    expect(await invoke('index-import', withImports.token, 4, source)).toEqual({ indexed: 2, chunks: 2 })
    const index = new DatabaseSync(indexPath)
    try {
      const matches = () => index.prepare(`SELECT c.chapter_number, c.revision, c.content FROM import_fts
        JOIN import_chunks c ON c.id = import_fts.rowid WHERE import_fts MATCH 'text' ORDER BY c.chapter_number`).all()
      const rows = snapshot.chapters.map(({ number, revision, content }) => ({ chapter_number: number, revision, content }))
      expect(matches()).toEqual(rows)
      index.prepare(`INSERT INTO import_chunks (chapter_id, chapter_number, revision, title, ordinal, content, tokens)
        VALUES (?, 4, ?, 'Old', 100, 'old revision', 'world'), (?, 4, ?, 'Other', 0, 'other chapter', 'world')`)
        .run(snapshot.chapters[0].chapterId, '0'.repeat(64), 'ch_00000000', snapshot.chapters[0].revision)
      const context = await invoke('import-inference', withImports.token, 4, source) as ProjectChannels['project:file-editor-import-inference']['return']
      expect(context.revisions).toEqual(snapshot.chapters.map(({ chapterId, revision }) => ({ chapterId, revision })))
      expect(context.excerpts.map(excerpt => excerpt.content)).toEqual(['text A'])
      const blueprintContext = await invoke('import-blueprints', withImports.token, 4, source) as {
        candidates: Array<{ number: number }>; existingChapterNumbers: number[]
      }
      expect(blueprintContext.candidates.map(chapter => chapter.number)).toEqual([4])
      expect(blueprintContext.existingChapterNumbers).toEqual([5])
      const ordinary = new DatabaseSync(join(root, 'ordinary.db'))
      const settings = new DatabaseSync(join(project, '.novelforge/retained.db'))
      try {
        ordinary.exec("CREATE TABLE project_core (world_setting TEXT); INSERT INTO project_core VALUES ('Ordinary world')")
        expect(context.settingsOffer?.occupied).toContain('worldSetting')
        const values = { worldSetting: 'Generated world', coreOutline: 'Generated outline', protagonistProfile: 'Generated hero' }
        const apply = (offerId: string) => invoke('apply-import-settings', withImports.token, offerId, 4, source, values)
        settings.exec("UPDATE project_core SET core_outline = 'edited' WHERE id = 'main'; UPDATE project_core SET core_outline = '' WHERE id = 'main'")
        await expect(apply(context.settingsOffer!.id)).rejects.toThrow('settings changed')
        const next = await invoke('import-inference', withImports.token, 4, source) as typeof context
        await expect(apply(context.settingsOffer!.id)).rejects.toThrow('settings offer')
        const sourcePath = join(project, 'chapters/0005.md')
        const original = await readFile(sourcePath, 'utf8')
        await writeFile(sourcePath, original.replace('text B', 'edited manuscript'))
        await expect(apply(next.settingsOffer!.id)).rejects.toThrow('Imported chapter 5 changed')
        await writeFile(sourcePath, original)
        const read = () => settings.prepare('SELECT world_setting, core_outline, protagonist_profile FROM project_core').get()
        settings.exec(`CREATE TRIGGER interrupt_settings BEFORE UPDATE OF protagonist_profile ON project_core
          BEGIN SELECT RAISE(ABORT, 'settings interrupted'); END`)
        await expect(apply(next.settingsOffer!.id)).rejects.toThrow('settings interrupted')
        expect(read()).toEqual({ world_setting: 'Manual world', core_outline: '', protagonist_profile: null })
        settings.exec('DROP TRIGGER interrupt_settings')
        expect(await apply(next.settingsOffer!.id)).toEqual({ applied: ['coreOutline', 'protagonistProfile'] })
        expect(read()).toEqual({ world_setting: 'Manual world', core_outline: 'Generated outline', protagonist_profile: 'Generated hero' })
        expect(ordinary.prepare('SELECT * FROM project_core').get()).toEqual({ world_setting: 'Ordinary world' })
      } finally { settings.close(); ordinary.close() }
      index.exec(`CREATE TRIGGER fail_second BEFORE INSERT ON import_chunks WHEN NEW.chapter_number = 5
        BEGIN SELECT RAISE(ABORT, 'index interrupted'); END`)
      await expect(invoke('index-import', withImports.token, 4, source)).rejects.toThrow('index interrupted')
      expect(matches()).toEqual(rows)
      const beforeRebuild = index.prepare('SELECT * FROM import_chunks ORDER BY id').all()
      await expect(invoke('rebuild-index', withImports.token)).rejects.toThrow('index interrupted')
      expect(index.prepare('SELECT * FROM import_chunks ORDER BY id').all()).toEqual(beforeRebuild)
      expect(matches()).toEqual(rows)
      index.exec('DROP TRIGGER fail_second')
      await invoke('rebuild-index', withImports.token)
      expect(index.prepare("SELECT chapter_id FROM import_chunks WHERE chapter_id = 'ch_00000000'").all()).toEqual([])
      expect(index.prepare(`SELECT c.content FROM import_fts JOIN import_chunks c ON c.id = import_fts.rowid
        WHERE import_fts MATCH 'world'`).all()).toEqual([{ content: 'text A' }])
    } finally { index.close() }
    await expect(invoke('import-source', reopened.token, 4, source)).rejects.toThrow('lifecycle session')
    await expect(invoke('index-import', reopened.token, 4, source)).rejects.toThrow('lifecycle session')
    await expect(invoke('rebuild-index', reopened.token)).rejects.toThrow('lifecycle session')
    const unsafeSidecar = `${indexPath}-journal`
    await mkdir(unsafeSidecar)
    const { rmdir } = await import('node:fs/promises')
    await expect(invoke('index-import', withImports.token, 4, source)).rejects.toThrow('Unsafe file import index path')
    await expect(invoke('rebuild-index', withImports.token)).rejects.toThrow('Unsafe file import index path')
    await rmdir(unsafeSidecar)
    await expect(invoke('import-source', withImports.token, Number.MAX_SAFE_INTEGER, source)).rejects.toThrow('Invalid file chapter import')
    await expect(invoke('import-source', withImports.token, 4, [source[0], null])).rejects.toThrow('Invalid file chapter import')
    expect(await invoke('import', withImports.token, 4, [source[0], { ...source[1], content: 'different' }]))
      .toEqual({ completed: 1, firstLocator: imported.firstLocator, blockedNumber: 5 })
    expect(await invoke('import-source', withImports.token, 4, [source[0], { ...source[1], content: 'different' }]))
      .toEqual({ projectId, chapters: snapshot.chapters.slice(0, 1) })
    expect(parseChapter(await readFile(join(project, 'chapters/0005.md'), 'utf8')).content).toBe('text B')

    const interruptedImport = new DatabaseSync(join(project, '.novelforge/retained.db'))
    try {
      const secondId = `ch_${fileRevision(JSON.stringify(['import', projectId, 8, source[1].title, source[1].content]))}`
      interruptedImport.exec(`CREATE TRIGGER interrupt BEFORE INSERT ON file_draft_states WHEN NEW.chapter_id = '${secondId}'
        BEGIN SELECT RAISE(ABORT, 'interrupted import'); END`)
      await expect(invoke('import', withImports.token, 7, source)).rejects.toThrow('interrupted import')
      expect(await invoke('import-source', withImports.token, 7, source)).toEqual({ projectId, chapters: [await importedChapter(7)] })
      interruptedImport.exec('DROP TRIGGER interrupt')
    } finally { interruptedImport.close() }
    const beforeReopen = await invoke('import-inference', withImports.token, 4, source) as ProjectChannels['project:file-editor-import-inference']['return']
    const afterImportRecovery = await invoke('open', project, [imported.firstLocator]) as ProjectChannels['project:file-editor-open']['return']
    await expect(invoke('apply-import-settings', afterImportRecovery.token, beforeReopen.settingsOffer!.id, 4, source, { writingStyle: 'old' }))
      .rejects.toThrow('settings offer')
    expect(await invoke('import-source', afterImportRecovery.token, 7, source))
      .toEqual({ projectId, chapters: [await importedChapter(7), await importedChapter(8)] })
    const blueprints = await invoke('import-blueprints', afterImportRecovery.token, 7, source) as { offerId: string }
    const blueprintRows = [7, 8].map(chapterNumber => ({ chapterNumber, title: `Proposed ${chapterNumber}`,
      role: '发展', purpose: 'Advance the plot', keyEvents: '', characters: [], suspenseHook: '' }))
    const applyBlueprints = (items = blueprintRows) => invoke('apply-import-blueprints', afterImportRecovery.token,
      blueprints.offerId, 7, source, items)
    const blueprintDb = new DatabaseSync(join(project, '.novelforge/retained.db'))
    try {
      const chapterPath = join(project, 'chapters/0008.md')
      const bytes = await readFile(chapterPath, 'utf8')
      await writeFile(chapterPath, bytes.replace('text B', 'external edit'))
      await expect(applyBlueprints()).rejects.toThrow('Imported chapter 8 changed')
      await writeFile(chapterPath, bytes)
      await expect(applyBlueprints([{ ...blueprintRows[0], chapterNumber: 5 }])).rejects.toThrow()
      blueprintDb.exec(`CREATE TRIGGER fail_blueprint BEFORE INSERT ON blueprints WHEN NEW.chapter_number = 8
        BEGIN SELECT RAISE(ABORT, 'blueprint interrupted'); END`)
      await expect(applyBlueprints()).rejects.toThrow('blueprint interrupted')
      expect(blueprintDb.prepare('SELECT chapter_number FROM blueprints ORDER BY chapter_number').all()).toEqual([{ chapter_number: 5 }])
      blueprintDb.exec(`DROP TRIGGER fail_blueprint;
        INSERT INTO blueprints VALUES (8, 'Concurrent', '转折', '', '', '[]', '', 'Keep this')`)
      expect(await applyBlueprints()).toEqual({ insertedChapterNumbers: [7], skippedChapterNumbers: [8] })
      expect(blueprintDb.prepare('SELECT title, notes FROM blueprints WHERE chapter_number = 8').get())
        .toEqual({ title: 'Concurrent', notes: 'Keep this' })
    } finally { blueprintDb.close() }

    const otherProject = join(root, 'candidate-copy')
    await cp(project, otherProject, { recursive: true })
    const copyChapter = join(otherProject, 'chapters/0005.md')
    await writeFile(copyChapter, (await readFile(copyChapter, 'utf8')).replace('text B', 'external edit'))
    const readByIds = FileChapterStore.prototype.readByIds
    let markReadFinished!: () => void
    let resumeRead!: () => void
    const readFinished = new Promise<void>(resolve => { markReadFinished = resolve })
    const readResumed = new Promise<void>(resolve => { resumeRead = resolve })
    // 在实际读完原项目后暂停，验证切换项目时旧快照不会交回调用方。
    const delayedRead = vi.spyOn(FileChapterStore.prototype, 'readByIds').mockImplementationOnce(async function (this: FileChapterStore, ids) {
      const chapters = await readByIds.call(this, ids)
      markReadFinished()
      await readResumed
      return chapters
    })
    try {
      const inFlight = invoke('import-source', afterImportRecovery.token, 4, source)
      const rejected = expect(inFlight).rejects.toThrow('session changed')
      await readFinished
      const agentRead = expect(invoke('agent-read', afterImportRecovery.token, imported.firstLocator, 0, 4)).rejects.toThrow('Agent session')
      const copied = await invoke('open', otherProject, []) as ProjectChannels['project:file-editor-open']['return']
      resumeRead()
      await rejected
      await agentRead
      await expect(invoke('import-source', copied.token, 4, source)).rejects.toThrow('Imported chapter 5 changed')
      await expect(invoke('import-inference', copied.token, 4, source)).rejects.toThrow('Imported chapter 5 changed')
      await expect(invoke('index-import', copied.token, 4, source)).rejects.toThrow('Imported chapter 5 changed')
    } finally {
      resumeRead()
      delayedRead.mockRestore()
    }

    const active = await invoke('open', project, [imported.firstLocator]) as ProjectChannels['project:file-editor-open']['return']
    expect(await invoke('import-source', active.token, 4, source)).toEqual(snapshot)
    const currentRevision = active.tabs[0].revision
    const agentTarget = join(project, 'chapters/0004.md')
    const prepare = (revision: string | undefined, original = 'text A', replacement = 'new $& text') =>
      invoke('agent-propose-edit', active.token, imported.firstLocator, revision, original, replacement) as Promise<{ id: string }>
    const resolveEdit = (id: string, decision: string) => invoke('agent-resolve-edit', active.token, id, decision)
    await expect(invoke('agent-propose-edit', active.token, locator, recovered.tabs[0].revision, 'proposal', 'other')).rejects.toThrow()
    await expect(prepare(currentRevision, 'missing')).rejects.toThrow('unique')
    const cancelled = await prepare(currentRevision)
    expect(parseChapter(await readFile(agentTarget, 'utf8')).content).toBe('text A')
    expect(await resolveEdit(cancelled.id, 'discard')).toEqual({ status: 'discarded' })
    await expect(resolveEdit(cancelled.id, 'apply')).rejects.toThrow('proposal')
    const outdated = await prepare(currentRevision)
    const manual = await invoke('save', active.token, imported.firstLocator, currentRevision, 'text A edited') as { revision: string }
    await expect(resolveEdit(outdated.id, 'apply')).rejects.toThrow('changed')
    expect(parseChapter(await readFile(agentTarget, 'utf8')).content).toBe('text A edited')
    const accepted = await prepare(manual.revision)
    const applied = await resolveEdit(accepted.id, 'apply') as { revision: string }
    expect(applied).toMatchObject({ status: 'saved', locator: imported.firstLocator, content: 'new $& text edited' })
    expect(parseChapter(await readFile(agentTarget, 'utf8')).content).toBe('new $& text edited')
    await expect(resolveEdit(accepted.id, 'apply')).rejects.toThrow('proposal')
    const previousPath = join(project, 'chapters/0005.md')
    const previousText = await readFile(previousPath, 'utf8')
    const previousId = parseChapter(previousText).id
    const previousSource = { chapterId: previousId, revision: fileRevision(previousText) }
    const contextDb = new DatabaseSync(join(project, '.novelforge/retained.db'))
    let contextRevision: string
    try {
      contextDb.exec("UPDATE project_core SET world_setting = 'Candidate world' WHERE id = 'main'; INSERT INTO blueprints (chapter_number, title, key_events, notes) VALUES (6, 'The crossing', 'Cross the river', 'Private note')")
      const context = await invoke('continuation-context', active.token, 6, previousSource) as { contextRevision: string }
      expect(context).toEqual({ previous: 'text B', settings: expect.objectContaining({ worldSetting: 'Candidate world' }),
        blueprint: { title: 'The crossing', keyEvents: 'Cross the river' }, contextRevision: expect.stringMatching(/^[a-f0-9]{64}$/) })
      contextDb.exec("UPDATE blueprints SET title = 'Unrelated' WHERE chapter_number = 5")
      expect(await invoke('continuation-context', active.token, 6, previousSource)).toEqual(context)
      const contextual = { ...create, chapterId: 'ch_123456abcdee', number: 6, source: { ...previousSource, contextRevision: context.contextRevision } }
      contextDb.exec("UPDATE blueprints SET key_events = 'Follow the river' WHERE chapter_number = 6")
      await expect(invoke('commit', active.token, contextual)).rejects.toThrow('Continuation context changed')
      const updated = await invoke('continuation-context', active.token, 6, previousSource) as { contextRevision: string }
      expect(updated.contextRevision).not.toBe(context.contextRevision)
      contextDb.exec("UPDATE project_core SET world_setting = 'New world' WHERE id = 'main'")
      await expect(invoke('commit', active.token, { ...contextual, source: { ...previousSource, contextRevision: updated.contextRevision } }))
        .rejects.toThrow('Continuation context changed')
      await expect(readFile(join(project, 'chapters/0006.md'))).rejects.toMatchObject({ code: 'ENOENT' })
      contextRevision = (await invoke('continuation-context', active.token, 6, previousSource) as { contextRevision: string }).contextRevision
    } finally { contextDb.close() }
    const continuation = { ...create, chapterId: 'ch_123456abcdef', number: 6, source: { ...previousSource, contextRevision } }
    await writeFile(previousPath, previousText.replace('text B', 'external edit'))
    await expect(invoke('commit', active.token, continuation)).rejects.toThrow('Source chapter changed')
    await expect(readFile(join(project, 'chapters/0006.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    const updatedContinuation = { ...continuation, source: { ...continuation.source, revision: fileRevision(await readFile(previousPath, 'utf8')) } }
    const published = await invoke('commit', active.token, updatedContinuation)
    await writeFile(previousPath, previousText)
    expect(await invoke('commit', active.token, updatedContinuation)).toEqual(published)
    await expect(invoke('commit', active.token, continuation)).rejects.toThrow('different file commit')
    expect(parseChapter(await readFile(join(project, 'chapters/0006.md'), 'utf8')).content).toBe(create.content)
    const continuationLocator = `doc://chapter/${continuation.chapterId}`
    const native = await invoke('open', project, [continuationLocator]) as ProjectChannels['project:file-editor-open']['return']
    expect(native.tabs[0].lifecycle).toEqual({ canFinalize: true, canArchive: true, canStageRevision: true, pending: [] })
    const draftRevision = native.tabs[0].revision
    const nativeOffer = await invoke('agent-propose-edit', native.token, continuationLocator, draftRevision,
      create.content, 'Edited native draft') as { id: string }
    const stagedRequest = invoke('agent-resolve-edit', native.token, nativeOffer.id, 'stage') as Promise<{ status: string; revisionId: number }>
    await expect(invoke('agent-resolve-edit', native.token, nativeOffer.id, 'apply')).rejects.toThrow('proposal')
    const staged = await stagedRequest
    expect(staged).toEqual({ status: 'staged', revisionId: expect.any(Number) })
    expect(parseChapter(await readFile(join(project, 'chapters/0006.md'), 'utf8')).content).toBe(create.content)
    const stagedWorkspace = await invoke('open', project, [continuationLocator]) as ProjectChannels['project:file-editor-open']['return']
    let stagedToken = stagedWorkspace.token
    expect(stagedWorkspace.tabs[0].lifecycle?.pending).toEqual([{ id: staged.revisionId }])
    const stagedPreview = await invoke('preview', stagedToken, continuation.chapterId, staged.revisionId) as { contentHash: string }
    expect(stagedPreview).toMatchObject({ content: 'Edited native draft', contentHash: fileRevision('Edited native draft') })
    await expect(invoke('preview', stagedToken, imported.firstLocator!.slice('doc://chapter/'.length), staged.revisionId)).rejects.toThrow()
    const mergeNative = { kind: 'merge', chapterId: continuation.chapterId, expectedRevision: draftRevision,
      revisionId: staged.revisionId, proposalHash: stagedPreview.contentHash }
    await expect(invoke('commit', stagedToken, { ...mergeNative, proposalHash: 'a'.repeat(64) })).rejects.toThrow('after preview')
    const interruptedMerge = new DatabaseSync(join(project, '.novelforge/retained.db'))
    try {
      interruptedMerge.exec("CREATE TRIGGER interrupt_revision BEFORE UPDATE ON file_draft_revisions BEGIN SELECT RAISE(ABORT, 'interrupted revision'); END")
      await expect(invoke('commit', stagedToken, mergeNative)).rejects.toThrow('interrupted revision')
      expect(interruptedMerge.prepare('SELECT merged_revision FROM file_draft_revisions WHERE id = ?').get(staged.revisionId))
        .toEqual({ merged_revision: null })
      interruptedMerge.exec('DROP TRIGGER interrupt_revision')
    } finally { interruptedMerge.close() }
    registerFileProjectEditorController()
    const mergedWorkspace = await invoke('open', project, [continuationLocator]) as ProjectChannels['project:file-editor-open']['return']
    stagedToken = mergedWorkspace.token
    expect(mergedWorkspace.tabs[0].lifecycle?.pending).toEqual([])
    const nativeSave = await invoke('commit', stagedToken, mergeNative) as { revision: string }
    expect(await invoke('commit', stagedToken, mergeNative)).toEqual(nativeSave)
    expect(parseChapter(await readFile(join(project, 'chapters/0006.md'), 'utf8'))).toMatchObject({ status: 'revised', content: 'Edited native draft' })
    const staleOffer = await invoke('agent-propose-edit', stagedToken, continuationLocator, nativeSave.revision,
      'Edited native draft', 'Older proposal') as { id: string }
    const stale = await invoke('agent-resolve-edit', stagedToken, staleOffer.id, 'stage') as { revisionId: number }
    const latestDraft = await invoke('save', stagedToken, continuationLocator, nativeSave.revision, 'Latest native draft') as { revision: string }
    await expect(invoke('preview', stagedToken, continuation.chapterId, stale.revisionId)).rejects.toThrow()
    await expect(invoke('commit', stagedToken, { ...mergeNative, expectedRevision: latestDraft.revision,
      revisionId: stale.revisionId, proposalHash: fileRevision('Older proposal') })).rejects.toThrow()
    const finalizeNative = { kind: 'finalize', chapterId: continuation.chapterId, expectedRevision: latestDraft.revision }
    await expect(invoke('commit', stagedToken, { ...finalizeNative, kind: 'merge', revisionId: 4 })).rejects.toThrow()
    const nativeDb = new DatabaseSync(join(project, '.novelforge/retained.db'))
    try {
      nativeDb.exec("CREATE TRIGGER interrupt_native BEFORE UPDATE ON file_draft_states BEGIN SELECT RAISE(ABORT, 'interrupted native draft'); END")
      await expect(invoke('commit', stagedToken, finalizeNative)).rejects.toThrow('interrupted native draft')
      nativeDb.exec('DROP TRIGGER interrupt_native')
    } finally { nativeDb.close() }
    registerFileProjectEditorController()
    const nativeRecovered = await invoke('open', project, [continuationLocator, imported.firstLocator]) as ProjectChannels['project:file-editor-open']['return']
    expect(nativeRecovered.tabs).toMatchObject([
      { content: 'Latest native draft', readOnly: true, lifecycle: { canFinalize: false, canArchive: true, pending: [] } },
      { lifecycle: { canFinalize: true, canArchive: true, pending: [] } },
    ])
    expect(await invoke('commit', nativeRecovered.token, finalizeNative)).toEqual({ status: 'committed', revision: nativeRecovered.tabs[0].revision })
    expect(await invoke('commit', nativeRecovered.token, { kind: 'archive', chapterId: continuation.chapterId, expectedRevision: nativeRecovered.tabs[0].revision }))
      .toMatchObject({ status: 'committed' })
    const archivedNative = await invoke('open', project, [continuationLocator]) as ProjectChannels['project:file-editor-open']['return']
    expect(archivedNative.tabs[0]).toMatchObject({ content: 'Latest native draft', readOnly: true })
    expect(archivedNative.tabs[0].lifecycle).toBeUndefined()
    const oldSession = await invoke('agent-propose-edit', archivedNative.token, imported.firstLocator,
      applied.revision, 'new $& text', 'other') as { id: string }
    const switched = await invoke('open', project, [imported.firstLocator]) as ProjectChannels['project:file-editor-open']['return']
    await expect(invoke('agent-resolve-edit', archivedNative.token, oldSession.id, 'apply')).rejects.toThrow('session')
    await expect(invoke('agent-resolve-edit', switched.token, oldSession.id, 'apply')).rejects.toThrow('proposal')
    expect(parseChapter(await readFile(agentTarget, 'utf8')).content).toBe('new $& text edited')
    const descriptor = join(project, '.novelforge/file-editor.json')
    const candidateDescriptor = await readFile(descriptor, 'utf8')
    expect(switched.canActivate).toBe(true)
    await writeFile(join(project, history), `${historyBytes}damaged`)
    await expect(invoke('activate', switched.token)).rejects.toThrow('target is unavailable')
    expect(await readFile(descriptor, 'utf8')).toBe(candidateDescriptor)
    await writeFile(join(project, history), historyBytes)
    const secondSender = { id: 2, once: vi.fn() }
    const otherWindow = await handlers.get('project:file-editor-open')!({ sender: secondSender }, project, [locator]) as ProjectChannels['project:file-editor-open']['return']
    await invoke('activate', switched.token)
    await expect(handlers.get('project:file-editor-save')!({ sender: secondSender }, otherWindow.token, locator,
      otherWindow.tabs[0].revision, 'stale')).rejects.toThrow('Invalid file editor save')
    registerFileProjectEditorController()
    const activated = await invoke('open', project, [imported.firstLocator]) as ProjectChannels['project:file-editor-open']['return']
    expect(activated.canActivate).toBe(false)
    expect(activated.activation).toMatchObject({ generation: expect.any(String), activatedAt: expect.any(String) })
    const retainedPath = join(project, '.novelforge/retained.db')
    const retainedBytes = await readFile(retainedPath)
    const expectedIndex = await Promise.all((await readdir(join(project, 'chapters')))
      .filter(name => /^\d+\.md$/.test(name)).map(name => importedChapter(Number.parseInt(name, 10))))
    await unlink(indexPath)
    await link(retainedPath, indexPath)
    await expect(invoke('rebuild-index', activated.token)).rejects.toThrow('Unsafe file import index path')
    await unlink(indexPath)
    await expect(readFile(indexPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await invoke('rebuild-index', activated.token)).toEqual({ indexed: expectedIndex.length, chunks: expectedIndex.length })
    const rebuiltIndex = new DatabaseSync(indexPath, { readOnly: true })
    try {
      expect(rebuiltIndex.prepare(`SELECT chapter_id AS chapterId, chapter_number AS number, title, revision, content
        FROM import_chunks ORDER BY chapter_number`).all()).toEqual(expectedIndex.sort((a, b) => a.number - b.number))
    } finally { rebuiltIndex.close() }
    expect(await readFile(retainedPath)).toEqual(retainedBytes)
    expect(await readFile(join(project, history), 'utf8')).toBe(historyBytes)
    await expect(invoke('activate', activated.token)).rejects.toThrow('already active')
    const activationDescriptor = await readFile(descriptor, 'utf8')
    const damaged = JSON.parse(activationDescriptor)
    damaged.activation.manifestHash = '0'.repeat(64)
    await writeFile(descriptor, JSON.stringify(damaged))
    await expect(invoke('open', project, [locator])).rejects.toThrow('Invalid file project activation')
    await writeFile(descriptor, activationDescriptor)
    const restoredActivation = await invoke('open', project, [imported.firstLocator]) as ProjectChannels['project:file-editor-open']['return']
    await rmdir(join(project, '.novelforge/vela.db'))
    await expect(invoke('import-source', restoredActivation.token, 4, source)).rejects.toThrow('candidate changed')
    await expect(invoke('save', restoredActivation.token, imported.firstLocator, restoredActivation.tabs[0].revision, 'missing barrier')).rejects.toThrow('candidate changed')
    await expect(invoke('open', project, [locator])).rejects.toThrow('candidate changed')
  } finally { await rm(root, { recursive: true, force: true }) }
}, 20000)
