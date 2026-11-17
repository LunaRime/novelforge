import { describe, expect, it, vi } from 'vitest'
import { createNovelConfigApplication, NovelConfigBusy, NovelConfigRequestCancelled, NovelConfigSaveRejected } from './novel-config'
import type { NovelConfigPorts } from '../ports/novel-config'

function fixture() {
  let source = { id: 'a', path: '/a', session: 1 }
  let config = { outline: 'original', style: 'simple' }
  const versions: Partial<Record<keyof typeof config, number>> = {}
  const save = vi.fn().mockResolvedValue(true)
  const savePatch = vi.fn().mockResolvedValue(undefined)
  const startWorkflow = vi.fn().mockResolvedValue({ runId: 'run', displayName: 'Config', chapterTag: '' })
  const ports: NovelConfigPorts<typeof config> = {
    scope: () => source, config: () => config, fieldVersions: () => versions,
    update(patch) { config = { ...config, ...patch }; for (const key of Object.keys(patch) as (keyof typeof config)[]) versions[key] = (versions[key] ?? 0) + 1 },
    save, async savePatch(patch, onCommitted) { await savePatch(patch); onCommitted?.() },
    startWorkflow, hasModel: () => true, ownsRun: () => true,
  }
  const app = createNovelConfigApplication(ports)
  return { app, save, savePatch, startWorkflow, get config() { return config }, reopen() { source = { ...source, session: 2 } }, ports }
}
function delayed<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }

describe('novel config application', () => {
  it('saves the captured config and rejects reentry while preserving new input', async () => {
    const f = fixture(); const pending = delayed<boolean>(); f.save.mockReturnValue(pending.promise)
    const saving = f.app.save(); f.app.update({ outline: 'new input' })
    await expect(f.app.save()).rejects.toBeInstanceOf(NovelConfigBusy)
    expect(f.save).toHaveBeenCalledWith({ outline: 'original', style: 'simple' })
    pending.resolve(true); await saving
    expect(f.config.outline).toBe('new input')
  })
  it('normalizes false and propagates save errors while releasing the mutex', async () => {
    const f = fixture(); f.save.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('disk'))
    await expect(f.app.save()).rejects.toBeInstanceOf(NovelConfigSaveRejected)
    await expect(f.app.save()).rejects.toThrow('disk')
    await expect(f.app.save()).resolves.toBeUndefined()
  })
  it('detects edits back to the original value and leaves other fields independent', () => {
    const f = fixture(); const snapshot = f.app.snapshot()
    f.app.update({ outline: 'changed' }); f.app.update({ outline: 'original' })
    expect(f.app.applyGenerated({ outline: 'AI' }, snapshot)).toEqual({ status: 'conflict', fields: ['outline'] })
    expect(f.app.applyGenerated({ style: 'AI style' }, snapshot).status).toBe('applied')
  })
  it('undo restores only generated fields and rejects later edits even with equal text', async () => {
    const f = fixture(); const result = f.app.applyGenerated({ outline: 'AI' }, f.app.snapshot())
    if (result.status !== 'applied') throw new Error('expected applied')
    f.app.update({ style: 'new style' })
    await expect(f.app.undo(result.undo)).resolves.toBe(true)
    expect(f.savePatch).toHaveBeenCalledWith({ outline: 'original' })
    expect(f.config).toEqual({ outline: 'original', style: 'new style' })
    await expect(f.app.undo(result.undo)).resolves.toBe(false)
    const second = f.app.applyGenerated({ outline: 'AI' }, f.app.snapshot())
    if (second.status !== 'applied') throw new Error('expected applied')
    f.app.update({ outline: 'AI' }); await expect(f.app.undo(second.undo)).resolves.toBe(false)
  })
  it('retains an undo after explicit rejection and preserves a newer edit during the retry', async () => {
    const f = fixture()
    const generated = f.app.applyGenerated({ outline: 'AI' }, f.app.snapshot())
    if (generated.status !== 'applied') throw new Error('expected applied')
    f.savePatch.mockRejectedValueOnce(new Error('disk rejected'))
    await expect(f.app.undo(generated.undo)).rejects.toThrow('disk rejected')
    expect(f.config.outline).toBe('AI')

    const pending = delayed<void>()
    f.savePatch.mockReturnValueOnce(pending.promise)
    const undo = f.app.undo(generated.undo)
    f.app.update({ outline: 'new edit' })
    pending.resolve()
    await expect(undo).resolves.toBe(true)
    expect(f.config.outline).toBe('new edit')
  })
  it('rejects reopened source sessions, including pending save and old undo tokens', async () => {
    const f = fixture(); const result = f.app.applyGenerated({ outline: 'AI' }, f.app.snapshot())
    if (result.status !== 'applied') throw new Error('expected applied')
    const pending = delayed<boolean>(); f.save.mockReturnValue(pending.promise)
    const saving = f.app.save(); f.reopen(); pending.resolve(true)
    await expect(saving).rejects.toBeInstanceOf(NovelConfigRequestCancelled)
    await expect(f.app.undo(result.undo)).rejects.toBeInstanceOf(NovelConfigRequestCancelled)
    const next = createNovelConfigApplication(f.ports)
    await expect(next.undo(result.undo)).resolves.toBe(false)
    expect(f.app.ownsRun('run')).toBe(false)
  })
  it('keeps snapshots detached and dispatches typed workflow requests', async () => {
    const f = fixture(); const snapshot = f.app.snapshot(); f.app.update({ style: 'new' })
    expect(snapshot.config.style).toBe('simple'); expect(snapshot.fieldVersions).toEqual({})
    await f.app.startField('coreOutline'); await f.app.startBulk('idea', 10, 2000)
    expect(f.startWorkflow).toHaveBeenNthCalledWith(1, { workflow: 'generate_config_field', fieldKey: 'coreOutline' })
    expect(f.startWorkflow).toHaveBeenNthCalledWith(2, { workflow: 'config_generation', idea: 'idea', totalChapters: 10, wordsPerChapter: 2000 })
    f.app.dispose(); expect(() => f.app.update({ style: 'old' })).toThrow(NovelConfigRequestCancelled)
  })
  it('rejects concurrent workflow starts and stale receipts without retaining the start lock', async () => {
    const f = fixture(); const pending = delayed<{ runId: string; displayName: string; chapterTag: string }>()
    f.startWorkflow.mockReturnValueOnce(pending.promise)
    const starting = f.app.startField('coreOutline')
    await expect(f.app.startBulk('idea')).rejects.toBeInstanceOf(NovelConfigBusy)
    pending.resolve({ runId: 'run', displayName: 'Config', chapterTag: '' }); await starting
    await expect(f.app.startBulk('idea')).resolves.toMatchObject({ runId: 'run' })
    const stale = delayed<{ runId: string; displayName: string; chapterTag: string }>()
    f.startWorkflow.mockReturnValueOnce(stale.promise)
    const oldStart = f.app.startField('writingStyle'); f.reopen()
    stale.resolve({ runId: 'old', displayName: 'Config', chapterTag: '' })
    await expect(oldStart).rejects.toBeInstanceOf(NovelConfigRequestCancelled)
  })
  it('preserves unrelated input while a model output waits and refuses foreign source snapshots', async () => {
    const f = fixture(); const captured = f.app.snapshot(); const model = delayed<{ outline: string }>()
    const generation = model.promise.then(patch => f.app.applyGenerated(patch, captured))
    f.app.update({ style: 'user style' }); model.resolve({ outline: 'AI' })
    const result = await generation
    expect(result.status).toBe('applied'); expect(f.config).toEqual({ outline: 'AI', style: 'user style' })
    expect(() => f.app.applyGenerated({ outline: 'wrong project' }, { ...captured, source: { ...captured.source, path: '/b' } })).toThrow(NovelConfigRequestCancelled)
  })
})
