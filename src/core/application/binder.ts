import type { BinderChapter, BinderPorts, BinderReorderParams, BinderReorderReceipt, BinderScope } from '../ports/binder'

export class BinderRequestCancelled extends Error {
  constructor() { super('Binder request is no longer current'); this.name = 'BinderRequestCancelled' }
}
export class BinderBusy extends Error {
  constructor() { super('Binder reorder is already in progress'); this.name = 'BinderBusy' }
}

/** One binder session: latest read wins, and writes share a mutex through refresh. */
export function createBinderApplication(ports: BinderPorts, initial: BinderScope | null = ports.scope()) {
  const source = initial ? Object.freeze({ ...initial }) : null
  let disposed = false
  let writing = false
  let loadVersion = 0
  const assertCurrent = () => {
    const current = ports.scope()
    if (disposed || !source || !current || source.id !== current.id || source.path !== current.path || source.session !== current.session) throw new BinderRequestCancelled()
  }
  return {
    assertCurrent,
    dispose() { disposed = true; ++loadVersion },
    async load(): Promise<BinderChapter[]> {
      const version = ++loadVersion
      const check = () => { assertCurrent(); if (version !== loadVersion) throw new BinderRequestCancelled() }
      check()
      try { const chapters = await ports.readList(); check(); return structuredClone(chapters) }
      catch (error) { check(); throw error }
    },
    async reorder(params: BinderReorderParams): Promise<BinderReorderReceipt> {
      assertCurrent()
      if (writing) throw new BinderBusy()
      const captured = { ...params }
      if (!Number.isSafeInteger(captured.chapterNumber) || captured.chapterNumber <= 0
        || (captured.toVolumeNumber !== null && (!Number.isSafeInteger(captured.toVolumeNumber) || captured.toVolumeNumber <= 0))
        || (captured.targetIndex !== undefined && (!Number.isSafeInteger(captured.targetIndex) || captured.targetIndex < 0))) throw new Error('Invalid binder reorder parameters')
      writing = true
      ++loadVersion
      try {
        const success = await ports.reorder(captured)
        assertCurrent()
        if (success !== true) throw new Error('Binder reorder was rejected')
        try { await ports.refresh(); assertCurrent(); return {} }
        catch (error) { assertCurrent(); return { refreshError: error instanceof Error ? error.message : String(error) } }
      } catch (error) { assertCurrent(); throw error }
      finally { writing = false }
    },
  }
}
