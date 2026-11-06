import type { ChapterBlueprintPorts, ChapterBlueprintSaveReceipt, ChapterBlueprintScope, ChapterBlueprintSort } from '../ports/chapter-blueprints'

export class ChapterBlueprintRequestCancelled extends Error {
  constructor() { super('Chapter blueprint request is no longer current'); this.name = 'ChapterBlueprintRequestCancelled' }
}
export class ChapterBlueprintBusy extends Error {
  constructor() { super('Chapter blueprint write is already in progress'); this.name = 'ChapterBlueprintBusy' }
}

/** One editor session with a latest-request read lane and a shared write mutex. */
export function createChapterBlueprintApplication<C extends { chapterNumber: number }>(ports: ChapterBlueprintPorts<C>, initial: ChapterBlueprintScope | null = ports.scope()) {
  const source = initial ? Object.freeze({ ...initial }) : null
  let disposed = false
  let saving = false
  let loadVersion = 0
  const assertCurrent = () => {
    const current = ports.scope()
    if (disposed || !source || !current || source.id !== current.id || source.path !== current.path || source.session !== current.session) throw new ChapterBlueprintRequestCancelled()
  }
  const save = async (items: C[], batch: boolean): Promise<ChapterBlueprintSaveReceipt> => {
    assertCurrent()
    if (saving) throw new ChapterBlueprintBusy()
    const captured = structuredClone(items)
    const numbers = new Set<number>()
    for (const item of captured) {
      if (!Number.isSafeInteger(item.chapterNumber) || item.chapterNumber <= 0 || numbers.has(item.chapterNumber)) throw new Error('Invalid or duplicate chapter number')
      numbers.add(item.chapterNumber)
    }
    saving = true
    ++loadVersion
    try {
      const success = await (batch ? ports.saveAll(captured) : ports.saveOne(captured[0]))
      assertCurrent()
      if (!success) throw new Error('Chapter blueprint save was rejected')
      try {
        await ports.refreshFileTree()
        assertCurrent()
        return {}
      } catch (error) {
        assertCurrent()
        return { refreshError: error instanceof Error ? error.message : String(error) }
      }
    } catch (error) { assertCurrent(); throw error }
    finally { saving = false }
  }
  return {
    assertCurrent,
    dispose() { disposed = true; ++loadVersion },
    async load(sort?: ChapterBlueprintSort): Promise<{ blueprints: C[]; nextWriteChapter: number }> {
      const version = ++loadVersion
      const check = () => { assertCurrent(); if (version !== loadVersion) throw new ChapterBlueprintRequestCancelled() }
      check()
      const capturedSort = sort ? { ...sort } : undefined
      try {
        const [blueprints, nextWriteChapter] = await Promise.all([ports.readList(capturedSort), ports.readNextWriteChapter()])
        check()
        return { blueprints: structuredClone(blueprints), nextWriteChapter }
      } catch (error) { check(); throw error }
    },
    saveOne(item: C) { return save([item], false) },
    saveAll(items: C[]) { return save(items, true) },
  }
}
