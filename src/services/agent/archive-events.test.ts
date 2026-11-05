import { describe, expect, it } from 'vitest'
import { decodeArchivedEvents, decodeArchivedMessageEvents } from './archive-events'
import { parseArchive, serializeArchive } from './archive-codec'
import type { AgentConversation, AgentMessage } from '../../shared/agent-conversation'

describe('archive runtime events', () => {
  it('restores all four event families with truthful identities', () => {
    const events = [
      { type: 'document.changed', id: '/project/note.md', path: '/project/note.md' },
      { type: 'chapter.draft_written', chapterId: 'db-draft-7' },
      { type: 'chapter.reviewed', chapterId: 'db-draft-7', score: 8.5 },
      { type: 'workflow.progressed', runId: 'run-3', step: 'completed', pct: 100 },
    ]
    expect(decodeArchivedEvents(events)).toEqual({ artifacts: events, legacyArtifacts: [] })
  })

  it('does not invent identities or mutation facts from old UI cards', () => {
    const restored = decodeArchivedEvents([
      { type: 'workflow_completed', name: 'Old run', metadata: { status: 'success' } },
      { type: 'blueprint_generated', name: 'Chapter 2', metadata: { chapterNumber: 2 } },
      { type: 'review_completed', name: 'Review report' },
    ])
    expect(restored.artifacts).toEqual([])
    expect(restored.legacyArtifacts.map(card => card.name)).toEqual(['Old run', 'Chapter 2', 'Review report'])
  })

  it('rejects malformed events and hostile inherited legacy type names', () => {
    expect(decodeArchivedEvents([
      { type: 'document.changed', id: '' },
      { type: 'chapter.reviewed', chapterId: 'draft-1', score: Number.NaN },
      { type: 'workflow.progressed', runId: 'run', step: 'started', pct: 101 },
      { type: 'workflow.progressed', step: 'started', pct: 0 },
      { type: '__proto__', name: 'bad' }, null,
    ])).toEqual({ artifacts: [], legacyArtifacts: [] })
  })

  it('normalizes corrupt display cards even when no runtime events exist', () => {
    const message = { id: 'm', role: 'assistant', content: 'History', createdAt: 1,
      legacyArtifacts: [{ name: {}, labelKey: 'invalid' }] } as unknown as AgentMessage
    expect(decodeArchivedMessageEvents(message).legacyArtifacts).toBeUndefined()
    const valid = { ...message, legacyArtifacts: [{ name: 'Old', labelKey: 'artifact.fileModified', summary: {} }] } as unknown as AgentMessage
    expect(decodeArchivedMessageEvents(valid).legacyArtifacts).toEqual([{ name: 'Old', labelKey: 'artifact.fileModified' }])
  })

  it('keeps empty-text completion cards across archive round trips and decodes idempotently', () => {
    const old = { id: 'm1', role: 'assistant', content: '', createdAt: 1,
      artifacts: [{ type: 'workflow_completed', name: 'Finished' }] } as unknown as AgentMessage
    const message = decodeArchivedMessageEvents(old)
    expect(decodeArchivedMessageEvents(message)).toEqual(message)
    const archive = { id: 'c1', title: 'Test', messages: [old], modelId: null, createdAt: 1, updatedAt: 1 } as AgentConversation
    const parsed = parseArchive(JSON.stringify(archive))!
    expect(parsed.messages).toHaveLength(1)
    expect(parsed.messages[0].legacyArtifacts?.[0].name).toBe('Finished')
    expect(parseArchive(serializeArchive(parsed))?.messages).toEqual(parsed.messages)
  })
})
