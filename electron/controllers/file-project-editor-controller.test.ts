import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, vi } from 'vitest'
import { exportLegacyProject } from '../../src/core/migration/export-legacy-project'
import { fileRevision } from '../../src/core/adapters/chapter-format'
import type { ProjectChannels } from '../../src/shared/ipc-channels'

const handlers = vi.hoisted(() => new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>())
vi.mock('electron', () => ({}))
vi.mock('../security/ipc-guard', () => ({ guardedHandle: (key: string, handler: never) => handlers.set(key, handler) }))
vi.mock('./fs-controller', () => ({ assertPathAllowedForIpc: (path: string) => path }))

import { registerFileProjectEditorController } from './file-project-editor-controller'

test('opens, saves, and restores candidate tabs via IPC with revision and sender checks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nf-file-editor-ipc-'))
  try {
    const project = join(root, 'project')
    const projectId = 'project'
    await exportLegacyProject({ destination: project, projectId, source: {
      listDrafts: async () => [1, 2].map(id => ({ id, chapterNumber: 1, version: id, branchId: null,
        status: 'draft', title: 'chapter', content: String(id), contentHash: '', createdAt: 1, updatedAt: 2 })),
      backup: async path => { await writeFile(path, 'fixture') },
    } })
    const [chapterId] = await readdir(join(project, 'history'))
    const history = `history/${chapterId}/1.md`
    const manifest = await readFile(join(project, 'migration-manifest.json'), 'utf8')
    const locator = `doc://chapter/${chapterId}`
    const mapping = JSON.stringify({ format: 1, projectId, manifestHash: fileRevision(manifest), entries: [
      { draftId: 1, chapterId, version: 1, branchId: null,
        target: { kind: 'history', path: history, fileChapterId: chapterId, fileHash: fileRevision(await readFile(join(project, history), 'utf8')) } },
      { draftId: 2, chapterId, version: 2, branchId: null, target: { kind: 'current', locator } },
    ] })
    await mkdir(join(project, '.novelforge/vela.db'), { recursive: true })
    await writeFile(join(project, '.novelforge/draft-identity.json'), mapping)
    await writeFile(join(project, '.novelforge/file-editor.json'), JSON.stringify({ format: 1, projectId, identityHash: fileRevision(mapping) }))
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
    const { rmdir } = await import('node:fs/promises')
    await rmdir(join(project, '.novelforge/vela.db'))
    await expect(invoke('save', restored.token, locator, restored.tabs[1].revision, 'missing barrier')).rejects.toThrow('candidate changed')
    await expect(invoke('open', project, [locator])).rejects.toThrow('candidate changed')
  } finally { await rm(root, { recursive: true, force: true }) }
})
