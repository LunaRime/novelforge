import type { TextKey } from '../../shared/locale'
import type { RuntimeEvent } from '../../core/domain/runtime-event'
import type { ArchivedArtifactCard } from '../../shared/archived-artifact'
import type { AgentMessage } from '../../shared/agent-conversation'

const legacyLabels: Record<string, TextKey> = {
  file_created: 'artifact.fileCreated', file_modified: 'artifact.fileModified',
  workflow_started: 'artifact.workflowStarted', workflow_completed: 'artifact.workflowCompleted',
  tab_opened: 'artifact.tabOpened', blueprint_generated: 'artifact.blueprintGenerated',
  draft_generated: 'artifact.draftGenerated', review_completed: 'artifact.reviewCompleted',
  character_extracted: 'artifact.characterExtracted', summary_updated: 'artifact.summaryUpdated',
  verification_report: 'artifact.verificationReport', embedding_indexed: 'artifact.embeddingIndexed',
  mutual_review_completed: 'artifact.mutualReview',
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

/** Old UI cards remain display data, never invented runtime facts. */
export function decodeArchivedEvents(value: unknown): { artifacts: RuntimeEvent[]; legacyArtifacts: ArchivedArtifactCard[] } {
  const artifacts: RuntimeEvent[] = []
  const legacyArtifacts: ArchivedArtifactCard[] = []
  if (!Array.isArray(value)) return { artifacts, legacyArtifacts }
  for (const item of value) {
    if (!record(item)) continue
    const presentation = {
      ...(typeof item.name === 'string' ? { name: item.name } : {}),
      ...(typeof item.path === 'string' ? { path: item.path } : {}),
      ...(typeof item.summary === 'string' ? { summary: item.summary } : {}),
      ...(record(item.metadata) ? { metadata: item.metadata } : {}),
      ...(typeof item.timestamp === 'number' && Number.isFinite(item.timestamp) ? { timestamp: item.timestamp } : {}),
    }
    if (item.type === 'document.changed' && nonempty(item.id)) {
      artifacts.push({ ...presentation, type: item.type, id: item.id })
    } else if (item.type === 'chapter.draft_written' && nonempty(item.chapterId)) {
      artifacts.push({ ...presentation, type: item.type, chapterId: item.chapterId })
    } else if (item.type === 'chapter.reviewed' && nonempty(item.chapterId) && typeof item.score === 'number' && Number.isFinite(item.score)) {
      artifacts.push({ ...presentation, type: item.type, chapterId: item.chapterId, score: item.score })
    } else if (item.type === 'workflow.progressed' && nonempty(item.runId) && nonempty(item.step)
      && typeof item.pct === 'number' && Number.isFinite(item.pct) && item.pct >= 0 && item.pct <= 100) {
      artifacts.push({ ...presentation, type: item.type, runId: item.runId, step: item.step, pct: item.pct })
    } else if (typeof item.type === 'string' && Object.hasOwn(legacyLabels, item.type) && typeof item.name === 'string') {
      legacyArtifacts.push({ name: item.name, labelKey: legacyLabels[item.type], ...(presentation.summary ? { summary: presentation.summary } : {}) })
    }
  }
  return { artifacts, legacyArtifacts }
}

export function decodeArchivedMessageEvents(message: AgentMessage): AgentMessage {
  // Some persisted nested message arrays predate shape validation.
  if (!message || typeof message !== 'object') return message
  const decoded = decodeArchivedEvents(message.artifacts)
  const existing = Array.isArray(message.legacyArtifacts) ? message.legacyArtifacts.filter(card => record(card)
    && typeof card.name === 'string' && typeof card.labelKey === 'string' && Object.values(legacyLabels).includes(card.labelKey))
    .map(card => ({ name: card.name, labelKey: card.labelKey,
      ...(typeof card.summary === 'string' ? { summary: card.summary } : {}) })) : []
  if (message.artifacts === undefined && message.legacyArtifacts === undefined) return message
  const cards = [...existing, ...decoded.legacyArtifacts]
  return { ...message, artifacts: decoded.artifacts, legacyArtifacts: cards.length ? cards : undefined }
}
