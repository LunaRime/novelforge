import { afterEach, describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function check(source: string, area = 'core', agentStoreFiles = 0, filename = 'sample.ts') {
  // Keep fixtures under the repo so Node resolves the installed TypeScript package.
  const root = mkdtempSync(resolve('.tmp-boundary-'))
  roots.push(root)
  mkdirSync(join(root, 'scripts'))
  const directory = join(root, 'src', area)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, filename), source)
  writeFileSync(join(root, 'scripts/check-boundaries.mjs'), readFileSync(resolve('scripts/check-boundaries.mjs')))
  writeFileSync(join(root, 'scripts/boundary-baseline.json'), JSON.stringify({
    coreForbidden: 0, agentStoreFiles, agentStoreRefs: 0,
  }))
  return spawnSync(process.execPath, [join(root, 'scripts/check-boundaries.mjs')], { encoding: 'utf8' })
}

describe('boundary CLI', () => {
  test.each(['../../services/ipc-client', '../../stores/llm-store', '../../services/knowledge-service'])('keeps KnowledgePanel behind knowledge use cases: %s', specifier => {
    const result = check(`import * as io from '${specifier}'`, 'components/panels', 0, 'KnowledgePanel.tsx')
    expect(result.status, result.stdout).toBe(1)
    expect(result.stderr).toContain('knowledge application')
  })
  test('allows knowledge view DTO type imports', () => {
    const result = check(`import type { KBDocument } from '../../services/knowledge-service'`, 'components/panels', 0, 'KnowledgePanel.tsx')
    expect(result.status, result.stderr).toBe(0)
  })
  test.each(['db:draft-update-content', 'db:draft-update-status', 'db:revision-mark-merged'])('keeps merge mutation IPC out of draft-store: %s', channel => {
    const result = check(`ipc.invoke('${channel}', 1)`, 'stores', 0, 'draft-store.ts')
    expect(result.status, result.stdout).toBe(1)
    expect(result.stderr).toContain('draft store projection')
  })
  test('allows draft-store to load projections', () => {
    const result = check(`ipc.invoke('db:draft-list', 1)`, 'stores', 0, 'draft-store.ts')
    expect(result.status, result.stderr).toBe(0)
  })
  test.each(['../../services/ipc-client', '../../stores/llm-store', '../../stores/draft-store', '../../services/workflows/start-workflow'])('keeps DraftEditor behind application ports: %s', specifier => {
    const result = check(`import * as dependency from '${specifier}'`, 'components/editor', 0, 'DraftEditor.tsx')
    expect(result.status, result.stdout).toBe(1)
    expect(result.stderr).toContain('editor application')
  })
  test('allows editor application adapter and UI state', () => {
    const result = check(`import { app } from '../../services/editor/draft-editor-application'
      import { useEditorStore } from '../../stores/editor-store'`, 'components/editor', 0, 'DraftEditor.tsx')
    expect(result.status, result.stderr).toBe(0)
  })
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
