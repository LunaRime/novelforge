import { describe, expect, it, vi } from 'vitest'
import { openEditorDocument, EditorOpenScopeChanged } from './open-editor-document'

describe('openEditorDocument', () => {
  it('publishes a resolved document once', async () => {
    const document = { id: 'doc:9', locator: 'vela://draft/9', name: 'Chapter', kind: 'chapter' as const, content: '' }
    const publish = vi.fn()
    const result = await openEditorDocument({ kind: 'latest-draft', chapterNumber: 1 }, {
      scope: () => ({ projectId: 'a', projectPath: '/a', session: 1 }),
      resolve: async () => document, publish,
    })
    expect(result).toEqual({ status: 'opened', document })
    expect(publish).toHaveBeenCalledWith(document)
  })
  it('rejects a late read after the same project path is reopened', async () => {
    let session = 1
    const publish = vi.fn()
    await expect(openEditorDocument({ kind: 'path', locator: '/a/ch.md', name: 'Chapter', documentKind: 'chapter' }, {
      scope: () => ({ projectId: 'a', projectPath: '/a', session }),
      resolve: async (_request, assertCurrent) => {
        await Promise.resolve()
        session++
        assertCurrent()
        throw new Error('unreachable')
      }, publish,
    })).rejects.toBeInstanceOf(EditorOpenScopeChanged)
    expect(publish).not.toHaveBeenCalled()
  })
  it('guards publication even when a reader forgets its post-read check', async () => {
    let path = '/a'
    const publish = vi.fn()
    await expect(openEditorDocument({ kind: 'latest-draft', chapterNumber: 1 }, {
      scope: () => ({ projectId: path, projectPath: path, session: 1 }),
      resolve: async () => { path = '/b'; return { id: 'doc:9', locator: 'vela://draft/9', name: 'Chapter', kind: 'chapter', content: 'old' } },
      publish,
    })).rejects.toBeInstanceOf(EditorOpenScopeChanged)
    expect(publish).not.toHaveBeenCalled()
  })
  it('distinguishes a missing draft from failed reads', async () => {
    const publish = vi.fn()
    const scope = () => ({ projectId: 'a', projectPath: '/a', session: 1 })
    expect(await openEditorDocument({ kind: 'latest-draft', chapterNumber: 1 }, { scope, resolve: async () => null, publish })).toEqual({ status: 'missing' })
    await expect(openEditorDocument({ kind: 'latest-draft', chapterNumber: 1 }, { scope, resolve: async () => { throw new Error('read failed') }, publish })).rejects.toThrow('read failed')
    expect(publish).not.toHaveBeenCalled()
  })
  it('cancels a late failed read instead of surfacing it in the next project', async () => {
    let session = 1
    await expect(openEditorDocument({ kind: 'latest-draft', chapterNumber: 1 }, {
      scope: () => ({ projectId: 'a', projectPath: '/a', session }),
      resolve: async () => { session++; throw new Error('old disk failed') },
      publish: vi.fn(),
    })).rejects.toBeInstanceOf(EditorOpenScopeChanged)
  })
})
