// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { FileProjectEditorDialog } from './FileProjectEditorDialog'
import { globalEventBus } from '../../shared/event-bus'
import { toast } from '../ui/Toast'

const invoke = vi.hoisted(() => vi.fn())
const infer = vi.hoisted(() => vi.fn())
const inferBlueprints = vi.hoisted(() => vi.fn())
const askAgent = vi.hoisted(() => vi.fn())
const generateContinuation = vi.hoisted(() => vi.fn())
vi.mock('../../services/ipc-client', () => ({ ipc: { invoke } }))
vi.mock('../../services/workflows/file-import-inference', () => ({ inferFileImport: infer, inferFileImportBlueprints: inferBlueprints }))
vi.mock('../../services/agent-adapters/file-project-agent', () => ({ askFileProjectAgent: askAgent }))
vi.mock('../../services/workflows/file-chapter-continuation', () => ({ generateFileChapterContinuation: generateContinuation }))
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
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); invoke.mockReset(); infer.mockReset(); inferBlueprints.mockReset(); askAgent.mockReset(); generateContinuation.mockReset() })

test('opens a routed directory through the candidate IPC without another folder picker', async () => {
  invoke.mockResolvedValue({ token: 'session', tabs: [], documents: [], missing: [] })
  await render()
  await act(async () => { globalEventBus.emit('OPEN_FILE_PROJECT_EDITOR', { projectPath: '/candidate' }) })
  expect(invoke).toHaveBeenCalledExactlyOnceWith('project:file-editor-open', '/candidate', [])
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('/candidate')
})

async function askAboutManuscript(question: string) {
  await act(async () => document.querySelector('summary')?.click())
  const input = document.querySelector('input[aria-label="project.fileEditorAgentQuestion"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, question)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click('project.fileEditorAgentAsk')
}

test('cancels the candidate Agent and discards its answer when the editor changes project', async () => {
  const locator = 'doc://chapter/ch_12345678'
  invoke.mockImplementation(async (_channel, path) => ({ token: path, missing: [],
    tabs: [{ locator, content: 'saved', revision: 'revision' }], documents: [{ locator, name: 'Current' }] }))
  let complete!: (result: { answer: string }) => void
  askAgent.mockReturnValue(new Promise(resolve => { complete = resolve }))
  await render()
  await act(async () => { globalEventBus.emit('OPEN_FILE_PROJECT_EDITOR', { projectPath: '/candidate' }) })
  await askAboutManuscript('What happens?')
  expect(askAgent).toHaveBeenCalledWith('/candidate', locator, 'What happens?', expect.any(AbortSignal), true)
  const signal = askAgent.mock.lastCall![3] as AbortSignal
  await act(async () => { globalEventBus.emit('OPEN_FILE_PROJECT_EDITOR', { projectPath: '/other' }) })
  expect(signal.aborted).toBe(true)
  await act(async () => { complete({ answer: 'Late manuscript answer' }) })
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('Late manuscript answer')
})

test('previews an Agent edit and only sends approval when the user accepts it', async () => {
  const locator = 'doc://chapter/ch_12345678'
  invoke.mockImplementation(async channel => {
    if (channel === 'project:file-editor-open') return { token: 'session', missing: [],
      tabs: [{ locator, content: 'old text', revision: 'revision' }], documents: [{ locator, name: 'Current' }] }
    if (channel === 'project:file-editor-agent-resolve-edit') return { status: 'saved', locator, content: 'new text', revision: 'next', indexed: true }
  })
  askAgent.mockResolvedValue({ answer: 'One edit proposed.', proposal: {
    id: 'edit-id', locator, revision: 'revision', original: 'old', replacement: 'new',
  } })
  await render()
  await act(async () => { globalEventBus.emit('OPEN_FILE_PROJECT_EDITOR', { projectPath: '/candidate' }) })
  await askAboutManuscript('Revise the wording')
  const panel = document.querySelector('[aria-label="project.fileEditorAgentPreview"]')!
  expect([...panel.querySelectorAll('dd')].map(node => node.textContent)).toEqual(['old', 'new'])
  expect(document.querySelector('textarea')?.value).toBe('old text')
  expect(invoke).toHaveBeenCalledTimes(1)
  await click('project.fileEditorAgentAccept')
  expect(invoke).toHaveBeenLastCalledWith('project:file-editor-agent-resolve-edit', 'session', 'edit-id', 'apply')
  expect(document.querySelector('textarea')?.value).toBe('new text')
  expect(panel.isConnected).toBe(false)
})

test('generates a continuation preview and opens the next chapter after explicit publication', async () => {
  const chapterId = 'ch_12345678'
  const locator = `doc://chapter/${chapterId}`
  const previous = { locator, name: 'Previous', number: 1, revision: 'old revision', content: 'Saved ending' }
  invoke.mockImplementation(async (channel, _scope, argument) => {
    if (channel === 'project:file-editor-commit') return { status: 'committed', revision: 'published revision' }
    if (channel === 'project:file-editor-open' && argument.length) return { token: 'reopened', missing: [],
      tabs: [{ locator: argument.at(-1), content: 'New draft', number: 2, revision: 'published revision' }], documents: [], importStartNumber: 3 }
    return { token: 'session', missing: [], tabs: [previous], documents: [], importStartNumber: 2 }
  })
  generateContinuation.mockResolvedValue({ content: 'New draft', contextRevision: 'context hash' })
  await render()
  await act(async () => { globalEventBus.emit('OPEN_FILE_PROJECT_EDITOR', { projectPath: '/candidate' }) })
  const title = document.querySelector('input[aria-label="project.fileEditorContinuationTitle"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(title, 'Next chapter')
    title.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click('project.fileEditorContinuationGenerate')
  expect(generateContinuation).toHaveBeenCalledWith(expect.objectContaining({ token: 'session', title: 'Next chapter', number: 2,
    source: { chapterId, revision: 'old revision' } }), expect.any(AbortSignal))
  expect(document.querySelector('[aria-label="project.fileEditorContinuationPreview"]')?.textContent).toContain('New draft')
  expect(invoke).toHaveBeenCalledTimes(1)
  await click('project.fileEditorContinuationPublish')
  const command = expect.objectContaining({ kind: 'create', chapterId: expect.stringMatching(/^ch_[a-f0-9]+$/), number: 2,
    title: 'Next chapter', content: 'New draft', source: { chapterId, revision: 'old revision', contextRevision: 'context hash' } })
  expect(invoke).toHaveBeenNthCalledWith(2, 'project:file-editor-commit', 'session', command)
  const newId = invoke.mock.calls[1][2].chapterId
  expect(invoke).toHaveBeenNthCalledWith(3, 'project:file-editor-open', '/candidate', [locator, `doc://chapter/${newId}`])
  expect([...document.querySelectorAll('textarea')].some(field => field.value === 'New draft')).toBe(true)
  expect(document.querySelector('[aria-label="project.fileEditorContinuationPreview"]')).toBeNull()
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
    if (channel === 'project:file-editor-apply-import-settings') return { applied: ['coreOutline'] }
    if (channel === 'project:file-editor-apply-import-blueprints') return { insertedChapterNumbers: [4], skippedChapterNumbers: [] }
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
  const values = { worldSetting: 'A flooded world', coreOutline: 'The flood begins' }
  infer.mockResolvedValueOnce({ values, settingsOffer: { id: 'offer', available: ['worldSetting', 'coreOutline'], occupied: ['worldSetting'] } })
  await click('project.fileEditorInferImport')
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('A flooded world')
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('project.fileEditorSettingOccupied')
  await click('project.fileEditorApplySettings')
  expect(invoke.mock.calls.some(([channel]) => channel === 'project:file-editor-apply-import-settings')).toBe(false)
  await click('dialog.confirm')
  expect(invoke).toHaveBeenLastCalledWith('project:file-editor-apply-import-settings', 'reopened', 'offer', 4,
    [{ title: 'Imported', content: 'text' }], values)
  expect(toast.success).toHaveBeenCalledWith('project.fileEditorSettingsApplied')
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('project.fileEditorSettingApplied')

  const blueprints = [{ chapterNumber: 4, title: 'Flood blueprint', role: '发展', purpose: 'Advance', keyEvents: '', characters: [], suspenseHook: '' }]
  inferBlueprints.mockResolvedValueOnce({ offerId: 'blueprints', items: blueprints, existingChapterNumbers: [] })
  await click('project.fileEditorInferBlueprints')
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Flood blueprint')
  await click('project.fileEditorApplyBlueprints')
  expect(invoke.mock.calls.some(([channel]) => channel === 'project:file-editor-apply-import-blueprints')).toBe(false)
  await click('dialog.confirm')
  expect(invoke).toHaveBeenLastCalledWith('project:file-editor-apply-import-blueprints', 'reopened', 'blueprints', 4,
    [{ title: 'Imported', content: 'text' }], blueprints)
  expect(toast.success).toHaveBeenCalledWith('project.fileEditorBlueprintsApplied')

  let complete!: (result: { values: { worldSetting: string } }) => void
  infer.mockReturnValueOnce(new Promise(resolve => { complete = resolve }))
  await click('project.fileEditorInferImport')
  const signal = infer.mock.lastCall![3] as AbortSignal
  await act(async () => { globalEventBus.emit('OPEN_FILE_PROJECT_EDITOR', { projectPath: '/other' }) })
  expect(signal.aborted).toBe(true)
  await act(async () => { complete({ values: { worldSetting: 'Late result' } }) })
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('Late result')
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
