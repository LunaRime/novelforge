import { describe, it, expect } from 'vitest'
import { createContainer, createRuntime, RuntimeScopeChanged } from './container'

describe('runtime composition', () => {
  it('keeps independent project instances isolated', async () => {
    const a = createRuntime(createContainer({ value: 'A' }), () => ({ path: '/a', session: 1 }))
    const b = createRuntime(createContainer({ value: 'B' }), () => ({ path: '/b', session: 1 }))
    expect(await Promise.all([a.run(async ({ ports }) => ports.value), b.run(async ({ ports }) => ports.value)])).toEqual(['A', 'B'])
  })
  it('rejects stale work when the same path is reopened before a delayed side effect', async () => {
    let session = 1
    let written = false
    const runtime = createRuntime({}, () => ({ path: '/a', session }))
    await expect(runtime.run(async ({ assertCurrent }) => {
      await Promise.resolve()
      session++
      assertCurrent()
      written = true
    })).rejects.toBeInstanceOf(RuntimeScopeChanged)
    expect(written).toBe(false)
  })
})
