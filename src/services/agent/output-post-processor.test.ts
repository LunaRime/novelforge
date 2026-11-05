import { describe, expect, it } from 'vitest'
import { OutputPostProcessor } from './output-post-processor'
import type { RuntimeEvent } from '../../core/domain/runtime-event'

describe('output processing reports facts from tools only', () => {
  it('does not fabricate persisted blueprints or reviews from model text', async () => {
    const result = await new OutputPostProcessor().process('第2章：雪夜\n审稿报告 review report', {
      artifacts: [], messages: [], modelId: 'test',
    })
    expect(result.extractedArtifacts).toEqual([])
    expect(result.cleanedOutput).toContain('第2章')
  })

  it('preserves actual successful tool events while stripping thought tags', async () => {
    const fact: RuntimeEvent = { type: 'document.changed', id: '/p/note.md', name: 'note.md' }
    const result = await new OutputPostProcessor().process('<think>plan</think>Done', {
      artifacts: [fact], messages: [], modelId: 'test',
    })
    expect(result.cleanedOutput).toBe('Done')
    expect(result.extractedArtifacts).toEqual([fact])
    expect(result.thinkingContent).toBe('plan')
  })
})
