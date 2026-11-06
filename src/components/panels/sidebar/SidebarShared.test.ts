import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openArchFile, openChapterFile, openDraftByChapter } from './SidebarShared'
import { EditorOpenScopeChanged } from '../../../core'
import { t } from '../../../shared/locale'

const { open, warning, error, log } = vi.hoisted(() => ({ open: vi.fn(), warning: vi.fn(), error: vi.fn(), log: vi.fn() }))
vi.mock('../../../services/editor/open-editor-document', () => ({ openRendererEditorDocument: open }))
vi.mock('../../ui/Toast', () => ({ toast: { warning, error } }))
vi.mock('../../../services/render-logger', () => ({ renderLog: log }))

beforeEach(() => vi.clearAllMocks())

describe('sidebar document opening feedback', () => {
  it('shows the missing-draft warning only for a successful missing lookup', async () => {
    open.mockResolvedValue({ status: 'missing' })
    expect(await openDraftByChapter(4)).toBe(false)
    expect(warning).toHaveBeenCalledWith(t('workspace.noDraft').replace('{n}', '4'))
    expect(error).not.toHaveBeenCalled()
  })
  it('distinguishes actual read failures from missing drafts', async () => {
    open.mockRejectedValue(new Error('disk unavailable'))
    expect(await openDraftByChapter(4)).toBe(false)
    expect(warning).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('disk unavailable'))
    expect(log).toHaveBeenCalledWith('error', 'Open:Editor', expect.stringContaining('disk unavailable'))
  })
  it('silently abandons a source-project change without opening or displaying a false missing warning', async () => {
    open.mockRejectedValue(new EditorOpenScopeChanged())
    expect(await openDraftByChapter(4)).toBe(false)
    expect(warning).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })
  it('handles read failures for fire-and-forget chapter and architecture callers', async () => {
    open.mockRejectedValue(new Error('read failed'))
    await expect(openChapterFile('/a/ch.md', 'Chapter')).resolves.toBeUndefined()
    await expect(openArchFile('vela://core/premise', 'Premise')).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledTimes(2)
  })
})
