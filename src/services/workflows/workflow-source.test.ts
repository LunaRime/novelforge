import { describe, expect, it } from 'vitest'
import { belongsToWorkflowSource, registerWorkflowSource } from './workflow-source'

describe('workflow runtime source attribution', () => {
  it('copies the source and requires matching id, path and session', () => {
    const source = { id: 'project-a', path: '/a', session: 3 }
    registerWorkflowSource('owned-run', source, ['owned-run'])
    source.session = 4
    expect(belongsToWorkflowSource('owned-run', { id: 'project-a', path: '/a', session: 3 })).toBe(true)
    expect(belongsToWorkflowSource('owned-run', source)).toBe(false)
    expect(belongsToWorkflowSource('owned-run', { id: 'project-b', path: '/a', session: 3 })).toBe(false)
    expect(belongsToWorkflowSource('owned-run', { id: 'project-a', path: '/b', session: 3 })).toBe(false)
    expect(belongsToWorkflowSource('unknown-run', source)).toBe(false)
  })

  it('retains active and historical runs and drops only IDs outside the store retention', () => {
    const source = { id: 'retention-project', path: '/retention', session: 1 }
    registerWorkflowSource('active', source, ['active'])
    registerWorkflowSource('history', source, ['active', 'history'])
    const retained = ['active', 'history']
    for (let index = 0; index < 70; index++) {
      const id = `parallel-${index}`
      retained.push(id)
      registerWorkflowSource(id, source, retained)
    }
    expect(belongsToWorkflowSource('active', source)).toBe(true)
    expect(belongsToWorkflowSource('history', source)).toBe(true)
    registerWorkflowSource('new-run', source, ['active', 'new-run'])
    expect(belongsToWorkflowSource('active', source)).toBe(true)
    expect(belongsToWorkflowSource('history', source)).toBe(false)
    expect(belongsToWorkflowSource('parallel-69', source)).toBe(false)
    expect(belongsToWorkflowSource('new-run', source)).toBe(true)
  })
})
