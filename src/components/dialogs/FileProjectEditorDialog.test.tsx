// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { FileProjectEditorDialog } from './FileProjectEditorDialog'
import { globalEventBus } from '../../shared/event-bus'
import { toast } from '../ui/Toast'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('../../services/ipc-client', () => ({ ipc: { invoke } }))
vi.mock('../../services/render-logger', () => ({ renderLog: vi.fn() }))
vi.mock('../../hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../ui/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

let root: Root
let host: HTMLDivElement
async function render() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<FileProjectEditorDialog />))
}
async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find(item => item.textContent === label)!
  await act(async () => button.click())
}
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); invoke.mockReset() })

test('opens a routed directory through the candidate IPC without another folder picker', async () => {
  invoke.mockResolvedValue({ token: 'session', tabs: [], documents: [], missing: [] })
  await render()
  await act(async () => { globalEventBus.emit('OPEN_FILE_PROJECT_EDITOR', { projectPath: '/candidate' }) })
  expect(invoke).toHaveBeenCalledExactlyOnceWith('project:file-editor-open', '/candidate', [])
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('/candidate')
})

test('previews selected files and opens the imported chapter only after confirmation', async () => {
  const locator = 'doc://chapter/ch_12345678'
  const chapter = { number: 1, title: 'Imported', content: 'text', wordCount: 4 }
  let indexAttempts = 0
  invoke.mockImplementation(async (channel, ...args) => {
    if (channel === 'dialog:select-novel-files') return ['/selected.txt']
    if (channel === 'import:split-chapters') return { success: true, chapters: [chapter], totalWords: 4 }
    if (channel === 'project:file-editor-import') return { completed: 1, firstLocator: locator }
    if (channel === 'project:file-editor-index-import') {
      if (++indexAttempts === 1) throw new Error('index failed')
      return { indexed: 1, chunks: 1 }
    }
    if (channel === 'project:file-editor-open') {
      const tabs = (args[1] as string[]).map(locator => ({ locator, content: 'text', revision: 'revision' }))
      return { token: tabs.length ? 'reopened' : 'session', missing: [], importStartNumber: 4, tabs,
        documents: tabs.map(tab => ({ locator: tab.locator, name: 'Imported' })) }
    }
  })
  await render()
  await act(async () => { globalEventBus.emit('OPEN_FILE_PROJECT_EDITOR', { projectPath: '/candidate' }) })
  await click('project.fileEditorImport')
  expect(invoke).toHaveBeenCalledWith('import:split-chapters', ['/selected.txt'])
  expect(invoke.mock.calls.some(([channel]) => channel === 'project:file-editor-import')).toBe(false)
  await click('import.startImport')
  expect(invoke).toHaveBeenCalledWith('project:file-editor-import', 'session', 4, [{ title: 'Imported', content: 'text' }])
  expect(invoke).toHaveBeenCalledWith('project:file-editor-open', '/candidate', [locator])
  expect(document.querySelector('textarea')?.value).toBe('text')
  await click('project.fileEditorIndexImport')
  expect(toast.error).toHaveBeenCalledWith('project.fileEditorIndexFailed')
  expect(document.querySelector('textarea')?.value).toBe('text')
  await click('project.fileEditorIndexImport')
  expect(invoke).toHaveBeenLastCalledWith('project:file-editor-index-import', 'reopened', 4, [{ title: 'Imported', content: 'text' }])
  expect(invoke.mock.calls.filter(([channel]) => channel === 'project:file-editor-import')).toHaveLength(1)
  expect(toast.success).toHaveBeenCalledWith('project.fileEditorIndexDone')
})

test('keeps unsaved file text when another project is routed to the editor', async () => {
  const locator = 'doc://chapter/ch_12345678'
  invoke.mockResolvedValue({ token: 'session', tabs: [{ locator, content: 'saved', revision: 'revision' }],
    documents: [{ locator, name: 'Chapter' }], missing: [] })
  await render()
  await act(async () => { globalEventBus.emit('OPEN_FILE_PROJECT_EDITOR', { projectPath: '/candidate' }) })
  const body = document.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(body, 'unsaved')
    body.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { globalEventBus.emit('OPEN_FILE_PROJECT_EDITOR', { projectPath: '/other' }) })
  expect(body.value).toBe('unsaved')
  expect(invoke).toHaveBeenCalledExactlyOnceWith('project:file-editor-open', '/candidate', [])
})

test('previews a proposal, commits its reviewed body, and refreshes after finalization', async () => {
  const locator = 'doc://chapter/ch_12345678'
  let finalized = false
  invoke.mockImplementation(async (channel, ...args) => {
    if (channel === 'dialog:select-folder') return '/candidate'
    if (channel === 'project:file-editor-open') return { token: 'session', missing: [],
      documents: [{ locator, name: 'Current' }],
      tabs: (args[1] as string[]).map(() => ({ locator, content: finalized ? 'proposal' : 'old',
        revision: finalized ? 'new' : 'revision', readOnly: finalized,
        lifecycle: { canFinalize: !finalized, canArchive: true, pending: finalized ? [] : [{ id: 4 }] } })),
    }
    if (channel === 'project:file-editor-preview') return { content: 'proposal', contentHash: 'proposal-hash' }
    if (channel === 'project:file-editor-commit') {
      if (args[1].kind === 'finalize') finalized = true
      return { status: 'committed', revision: 'new' }
    }
  })
  await render()
  await click('project.fileEditor')
  await click('project.fileEditorChoose')
  await click('project.fileEditorPreview')
  expect(document.querySelector('pre')?.textContent).toBe('proposal')
  await click('project.fileEditorMerge')
  await click('dialog.confirm')
  expect(invoke).toHaveBeenCalledWith('project:file-editor-commit', 'session', {
    kind: 'merge', chapterId: 'ch_12345678', expectedRevision: 'revision', revisionId: 4, proposalHash: 'proposal-hash',
  })
  await click('project.fileEditorFinalize')
  await click('dialog.confirm')
  expect(document.querySelector('textarea')?.readOnly).toBe(true)
  await click('project.fileEditorArchive')
  await click('action.cancel')
  expect(invoke.mock.calls.filter(([channel]) => channel === 'project:file-editor-commit')).toHaveLength(2)
  await click('project.fileEditorArchive')
  await click('dialog.confirm')
  expect(invoke).toHaveBeenCalledWith('project:file-editor-commit', 'session', {
    kind: 'archive', chapterId: 'ch_12345678', expectedRevision: 'new',
  })
})

test('saves with the displayed revision and restores the selected read-only document on reopen', async () => {
  const current = 'doc://chapter/ch_12345678'
  const history = 'doc://history/1'
  const documents = [{ locator: current, name: 'Current' }, { locator: history, name: 'History' }]
  let content = 'current draft'
  invoke.mockImplementation(async (channel, ...args) => {
    if (channel === 'dialog:select-folder') return '/candidate'
    if (channel === 'project:file-editor-open') return {
      token: 'session', documents, missing: [],
      tabs: (args[1] as string[]).map(locator => locator === current
        ? { locator, content, revision: 'revision' }
        : { locator, content: 'old draft', readOnly: true }),
    }
    if (channel === 'project:file-editor-save') { content = args[3]; return { revision: 'updated', indexed: true } }
  })
  const launch = async () => {
    await click('project.fileEditor')
    await click('project.fileEditorChoose')
    return document.querySelector<HTMLTextAreaElement>('textarea')!
  }
  await render()
  const body = await launch()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(body, 'saved draft')
    body.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click('action.save')
  expect(invoke).toHaveBeenCalledWith('project:file-editor-save', 'session', current, 'revision', 'saved draft')
  const select = document.querySelector('select')!
  await act(async () => { select.value = history; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(body.readOnly && body.value === 'old draft').toBe(true)
  await act(async () => root.unmount())
  host.remove()
  await render()
  const restored = await launch()
  expect(restored.value).toBe('old draft')
  expect(restored.readOnly).toBe(true)
  expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
})
