// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { globalEventBus } from '../../shared/event-bus'
import { t } from '../../shared/locale'
import { EMPTY_CARD, useCharacterStore } from '../../stores/character-store'
import { useProjectStore } from '../../stores/project-store'
import CharacterEditor from './CharacterEditor'

const h = vi.hoisted(() => ({
  invoke: vi.fn(), confirm: vi.fn(), success: vi.fn(), error: vi.fn(), renderLog: vi.fn(),
}))
vi.mock('../../services/ipc-client', async importOriginal => {
  const original = await importOriginal<typeof import('../../services/ipc-client')>()
  return { ...original, ipc: { ...original.ipc, invoke: h.invoke } }
})
vi.mock('../ui/Confirm', () => ({ confirm: h.confirm }))
vi.mock('../ui/Toast', () => ({ toast: { success: h.success, error: h.error } }))
vi.mock('../../services/render-logger', () => ({ renderLog: h.renderLog }))

const scope = { projectPath: '/book', token: 'connection' }
const portable = { file: 'copied.json', name: 'Portable', description: '' }
const target = { ...EMPTY_CARD, name: 'Keep', uid: 'keep', aliases: '["Remove"]', notes: 'Handwritten', status: 'active' }
const source = { ...EMPTY_CARD, name: 'Remove', uid: 'remove', appearance: 'Tall' }
const unrelated = { ...EMPTY_CARD, name: 'Observer', uid: 'observer' }
const refreshFileTree = vi.fn()
const originalRefresh = useProjectStore.getState().refreshFileTree
let box: HTMLElement
let root: Root

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.resetAllMocks()
  refreshFileTree.mockResolvedValue(undefined)
  useCharacterStore.getState().reset()
  useProjectStore.setState({
    currentProject: { id: 'book', name: 'Book', path: scope.projectPath } as never,
    projectSession: 1, loading: false, refreshFileTree,
  })
  h.confirm.mockResolvedValue(true)
  h.invoke.mockImplementation(async (channel: string) => {
    if (channel === 'db:character-edit-snapshot') return { scope, cards: [target, source, unrelated] }
    if (channel === 'templates:list') return [portable]
    return null
  })
  await useCharacterStore.getState().load()
  box = document.createElement('div')
  document.body.appendChild(box)
  root = createRoot(box)
  act(() => root.render(<CharacterEditor />))
})

afterEach(() => {
  act(() => root.unmount())
  box.remove()
  useProjectStore.setState({ currentProject: null, refreshFileTree: originalRefresh })
  useCharacterStore.getState().reset()
  vi.unstubAllGlobals()
})

async function clickButton(label: string) {
  const button = Array.from(box.querySelectorAll('button')).find(b => b.title === label || b.textContent?.trim() === label)
  expect(button).toBeDefined()
  await act(async () => { button!.click() })
}

async function openTemplate() {
  await clickButton(t('charList.more'))
  await clickButton('Portable')
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

it('applies portable fields in one store update and keeps the selected identity', async () => {
  h.invoke.mockResolvedValueOnce([portable])
    .mockResolvedValueOnce({ name: 'Foreign', uid: 'foreign', notes: 'Portable notes', status: 'dead', tier: 1 })
  const updates = vi.fn()
  const unsubscribe = useCharacterStore.subscribe(updates)
  try {
    await openTemplate()
    expect(updates).toHaveBeenCalledTimes(1)
  } finally {
    unsubscribe()
  }
  expect(useCharacterStore.getState()).toMatchObject({
    selectedName: 'Keep', dirty: true,
    characters: [expect.objectContaining({ name: 'Keep', uid: 'keep', notes: 'Portable notes', tier: 1, status: 'active' }), source, unrelated],
  })
})

it.each(['switch away and back', 'reopen the same project', 'keep typing'])('discards a late template read when the user can %s', async change => {
  const pending = deferred<{ notes: string }>()
  h.invoke.mockResolvedValueOnce([portable]).mockReturnValueOnce(pending.promise)
  await openTemplate()
  expect(h.invoke).toHaveBeenLastCalledWith('templates:get', portable.file)
  act(() => {
    const state = useCharacterStore.getState()
    if (change === 'switch away and back') {
      state.setSelectedName('Remove')
      state.setSelectedName('Keep')
    } else if (change === 'reopen the same project') {
      useProjectStore.setState({ projectSession: 2 })
    } else state.updateField('Keep', 'notes', 'New typing')
  })
  await act(async () => pending.resolve({ notes: 'Late' }))
  expect(useCharacterStore.getState().characters[0].notes).toBe(change === 'keep typing' ? 'New typing' : 'Handwritten')
  expect(h.success).not.toHaveBeenCalled()
})

it('reports a catalogue error, retries on reopen, and keeps the card on failed template save', async () => {
  h.invoke.mockRejectedValueOnce(new Error('permission denied')).mockResolvedValueOnce([])
    .mockResolvedValueOnce({ success: false, error: 'disk full' })
  await clickButton(t('charList.more'))
  expect(box.textContent).toContain(t('template.loadFailed'))
  expect(box.textContent).not.toContain(t('template.empty'))
  await clickButton(t('charList.more'))
  await clickButton(t('charList.more'))
  expect(box.textContent).toContain(t('template.empty'))
  await clickButton(t('template.saveAs'))
  expect(h.error).toHaveBeenCalledWith(expect.stringContaining('disk full'))
  expect(h.success).not.toHaveBeenCalled()
  expect(useCharacterStore.getState().characters[0]).toBe(target)
})

const mergeIntoCurrent = () => clickButton(t('character.mergeIntoCurrent').replace('{name}', source.name))

it('shows a current merge preview and sends no merge when confirmation is declined', async () => {
  h.confirm.mockResolvedValue(false)
  h.invoke.mockClear()
  await mergeIntoCurrent()
  expect(h.invoke.mock.calls).toEqual([['db:character-edit-snapshot']])
  expect(h.confirm).toHaveBeenCalledWith(expect.stringContaining('Remove'), expect.objectContaining({ danger: true }))
  expect(useCharacterStore.getState().characters).toHaveLength(3)
})

it('does not submit a merge when a participant changes during confirmation', async () => {
  const pending = deferred<boolean>()
  h.confirm.mockReturnValue(pending.promise)
  h.invoke.mockClear()
  await mergeIntoCurrent()
  expect(h.confirm).toHaveBeenCalledOnce()
  act(() => useCharacterStore.getState().updateField('Remove', 'notes', 'New typing'))
  await act(async () => pending.resolve(true))
  expect(h.invoke.mock.calls).toEqual([['db:character-edit-snapshot']])
  expect(useCharacterStore.getState().characters[1].notes).toBe('New typing')
})

it('commits fresh scoped cards, keeps unrelated drafts, and reports a failed projection separately', async () => {
  const freshTarget = { ...target, notes: 'Latest from database' }
  const merged = { ...freshTarget, appearance: source.appearance }
  const freshObserver = { ...unrelated, notes: 'Concurrent database notes' }
  h.invoke.mockResolvedValueOnce({ scope, cards: [freshTarget, source, unrelated] })
    .mockResolvedValueOnce({ success: true, cards: [merged, freshObserver] })
  refreshFileTree.mockRejectedValueOnce(new Error('refresh offline'))
  act(() => {
    const state = useCharacterStore.getState()
    state.updateField('Observer', 'relations', '[{"target":"Remove","type":"enemy"},{"target":"Keep","type":"ally"}]')
    state.updateField('Observer', 'notes', 'Unsubmitted notes')
  })
  const refreshEvent = vi.fn()
  const unsubscribe = globalEventBus.on('REFRESH_RESOURCE', refreshEvent)
  try {
    await mergeIntoCurrent()
    expect(refreshEvent).toHaveBeenCalledWith({
      resources: ['blueprints'], characterMerge: { sourceName: 'Remove', targetName: 'Keep' },
    })
  } finally {
    unsubscribe()
  }
  expect(h.invoke).toHaveBeenLastCalledWith('db:character-merge', { scope, target: freshTarget, source })
  expect(useCharacterStore.getState()).toMatchObject({
    baseline: [merged, unrelated],
    characters: [merged, { ...unrelated, notes: 'Unsubmitted notes', relations: '[{"target":"Keep","type":"ally"}]' }],
    dirty: true, selectedName: 'Keep',
  })
  expect(h.success).toHaveBeenCalledOnce()
  expect(h.error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('refresh offline'))
})
