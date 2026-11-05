import { afterEach, describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function check(source: string, area = 'core', agentStoreFiles = 0) {
  // Keep fixtures under the repo so Node resolves the installed TypeScript package.
  const root = mkdtempSync(resolve('.tmp-boundary-'))
  roots.push(root)
  mkdirSync(join(root, 'scripts'))
  const directory = join(root, 'src', area)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'sample.ts'), source)
  writeFileSync(join(root, 'scripts/check-boundaries.mjs'), readFileSync(resolve('scripts/check-boundaries.mjs')))
  writeFileSync(join(root, 'scripts/boundary-baseline.json'), JSON.stringify({
    coreForbidden: 0, agentStoreFiles, agentStoreRefs: 0,
  }))
  return spawnSync(process.execPath, [join(root, 'scripts/check-boundaries.mjs')], { encoding: 'utf8' })
}

describe('boundary CLI', () => {
  test('rejects external imports of core internals', () => {
    const result = check(`import type { Chapter } from '../../core/domain/chapter'`, 'services')
    expect(result.status, result.stdout).toBe(1)
    expect(result.stderr).toContain('core public entry')
  })
  test('counts store access even without a direct store import', () => {
    const result = check(`const store = useProjectStore.getState()`, 'services/agent')
    expect(result.status, result.stdout).toBe(1)
    expect(result.stderr).toContain('agentStoreRefs 回升：0 → 1')
  })
  test('rejects workflow factory construction in UI components', () => {
    const result = check(`import { createChapterWorkflow } from '../../services/workflows/chapter-workflow'
      const definition = createChapterWorkflow({ chapterNumber: 1 })`, 'components/editor')
    expect(result.status, result.stdout).toBe(1)
    expect(result.stderr).toContain('UI workflow')
  })
  test('allows UI to call the application workflow entry', () => {
    const result = check(`import { startWorkflow } from '../../services/workflows/start-workflow'
      startWorkflow({workflow:'generate_draft', chapterNumber:1})`, 'components/editor')
    expect(result.status, result.stderr).toBe(0)
  })
  test('ignores comments and string literals that describe imports', () => {
    const result = check(`// import React from 'react'
      /* require('electron') */
      const description = "import x from 'zustand'"`)
    expect(result.status, result.stderr).toBe(0)
  })

  test.each(['@/stores', '@/components', '../../stores', '../../components/index'])('rejects directory entry import %s', specifier => {
    const result = check(`import * as dependency from '${specifier}'`)
    expect(result.status, result.stdout).toBe(1)
    expect(result.stderr).toContain(specifier)
  })

  test.each([`import('electron')`, `require('zustand')`, `export { x } from 'react'`])('rejects dependency syntax %s', source => {
    const result = check(source)
    expect(result.status, result.stdout).toBe(1)
  })

  test('counts getState calls with whitespace and optional chaining, ignoring comments', () => {
    const result = check(`import { useDraftStore } from '@/stores/draft-store'
      useDraftStore.getState ()
      useDraftStore?.getState\n ()
      useDraftStore.getState\n ()
      // useDraftStore.getState()
      const text = 'useDraftStore.getState()'`, 'services/agent', 1)
    expect(result.status, result.stdout).toBe(1)
    expect(result.stderr).toContain('agentStoreRefs 回升：0 → 3')
  })
})
