import { describe, it, expect, vi } from 'vitest'
import { createDraftEditorApplication, type DraftEditorPorts } from './draft-editor'
const meta = { id: 7, chapterNumber: 2, version: 1 }
function fixture() {
  let scope = { path: '/a', session: 1 }
  const ports: DraftEditorPorts<typeof meta, { id: number }> = {
    project: () => scope, errors: { changed: 'changed', empty: 'empty', create: 'create failed' },
    metadata: vi.fn(async () => meta), title: vi.fn(async () => 'Title'), pending: vi.fn(async () => []), reviewCount: vi.fn(async () => 0),
    read: vi.fn(async () => 'body'), write: vi.fn(async () => {}), refresh: vi.fn(),
    start: vi.fn(async () => {}), repairGuard: vi.fn(async () => ({ ok: true })),
    merge: vi.fn(async () => ({ success: true })), latestReview: vi.fn(async () => null),
    translate: vi.fn(async () => 'translated'), nextVersion: vi.fn(async () => 2), createTranslation: vi.fn(async () => 9),
  }
  return { ports, change: () => { scope = { path: '/b', session: 2 } }, reopen: () => { scope = { ...scope, session: scope.session + 1 } } }
}
describe('draft editor application', () => {
  it('captures source identity by value even when a port mutates its scope object', async () => {
    const f = fixture(); const scope = { path: '/a', session: 1 }
    f.ports.project = () => scope
    const app = createDraftEditorApplication(f.ports)
    scope.session++
    await expect(app.save('draft', 'body')).rejects.toThrow('changed')
    expect(f.ports.write).not.toHaveBeenCalled()
  })
  it('rejects the same path reopened as a new project session', async () => {
    const f = fixture(); const app = createDraftEditorApplication(f.ports); f.reopen()
    await expect(app.save('draft', 'body')).rejects.toThrow('changed')
    expect(f.ports.write).not.toHaveBeenCalled()
  })
  it('reports committed merge success even when pending projection reload fails', async () => {
    const f = fixture(); const app = createDraftEditorApplication(f.ports)
    f.ports.pending = vi.fn(async () => { throw new Error('reload failed') })
    await expect(app.merge(meta, 'draft', 'revision', 'merged')).resolves.toMatchObject({ success: true, refreshError: 'Error: reload failed' })
  })
  it('does not start repair workflow when guard fails', async () => {
    const f = fixture(); const app = createDraftEditorApplication(f.ports)
    f.ports.repairGuard = vi.fn(async () => ({ ok: false, message: 'not eligible' }))
    await expect(app.repair(meta)).resolves.toEqual({ ok: false, message: 'not eligible' })
    expect(f.ports.start).not.toHaveBeenCalled()
  })
  it('uses the source draft body and explicit review focus', async () => {
    const f = fixture(); const app = createDraftEditorApplication(f.ports)
    await app.workflow('review', 'draft', meta, 'Title', { reviewFocus: 'plot' })
    expect(f.ports.start).toHaveBeenCalledWith({ workflow: 'review', chapterNumber: 2, draft: { draftPath: 'draft', draftContent: 'body', chapterTitle: 'Title', reviewFocus: 'plot' } })
  })
  it('does not dispatch a workflow after source project changes during read', async () => {
    const f = fixture(); const app = createDraftEditorApplication(f.ports)
    f.ports.read = vi.fn(async () => { f.change(); return 'old body' })
    await expect(app.workflow('finalize', 'draft', meta, 'Title')).rejects.toThrow('changed')
    expect(f.ports.start).not.toHaveBeenCalled()
  })
  it('rejects a session retained across confirmation and never reads the new project', async () => {
    const f = fixture(); const app = createDraftEditorApplication(f.ports); f.change()
    await expect(app.workflow('finalize', 'draft', meta, 'Title')).rejects.toThrow('changed')
    expect(f.ports.read).not.toHaveBeenCalled()
  })
  it('does not publish refresh after failed save', async () => {
    const f = fixture(); const app = createDraftEditorApplication(f.ports)
    f.ports.write = vi.fn(async () => { throw new Error('disk full') })
    await expect(app.save('draft', 'new')).rejects.toThrow('disk full')
    expect(f.ports.refresh).not.toHaveBeenCalled()
  })
  it('stops translation before version lookup/create on project switch', async () => {
    const f = fixture(); const app = createDraftEditorApplication(f.ports)
    f.ports.translate = vi.fn(async () => { f.change(); return 'translated' })
    await expect(app.translation(meta, 'body', 'prompt', 'system')).rejects.toThrow('changed')
    expect(f.ports.nextVersion).not.toHaveBeenCalled(); expect(f.ports.createTranslation).not.toHaveBeenCalled()
  })
  it('does not turn failed draft creation into success or refresh', async () => {
    const f = fixture(); const app = createDraftEditorApplication(f.ports)
    f.ports.createTranslation = vi.fn(async () => { throw new Error('create failed') })
    await expect(app.translation(meta, 'body', 'prompt', 'system')).rejects.toThrow('create failed')
    expect(f.ports.refresh).not.toHaveBeenCalled()
  })
})
