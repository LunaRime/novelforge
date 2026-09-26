import { t } from '../../src/shared/locale'
import { closeProjectDatabase, getCurrentProjectPath, getProjectDb } from '../database'
import { logger } from '../utils/logger'

// 导入所有 Repository
import { ProjectCoreRepository, ProjectCoreData } from '../repositories/project-core-repository'
import { BlueprintRepository, BlueprintData } from '../repositories/blueprint-repository'
import { CharacterRepository, CharacterData, CharacterStateData } from '../repositories/character-repository'
import { DraftRepository } from '../repositories/draft-repository'
import { RevisionRepository } from '../repositories/revision-repository'
import { ReviewRepository } from '../repositories/review-repository'
import { PostProcessRepository } from '../repositories/post-process-repository'
import { WorkflowCheckpointRepository } from '../repositories/workflow-checkpoint-repository'
import { createAutomationRepository, type TriggerOutcomeInput } from '../repositories/automation-repository'
import { SEMANTIC_CHAPTER_TRUNCATE } from '../../src/services/automation/types'

// 沿用的旧表
import { LLMHistoryRepository } from '../repositories/llm-repository'
import { VolumeRepository, VolumeData } from '../repositories/volume-repository'
import { PreferenceRepository } from '../repositories/preference-repository'
import { ActivityRepository } from '../repositories/activity-repository'
import { getGlobalUsageStats } from '../repositories/usage-repository'
import { PublicationRepository, type PublicationEntry } from '../repositories/publication-repository'
import { analyzeExternalChapter } from '../../src/services/publication-analysis'
import { SummaryRepository } from '../repositories/summary-repository'
import { guardedHandle } from '../security/ipc-guard'

export function registerDatabaseController() {
  guardedHandle('db:close', async () => {
    closeProjectDatabase()
    return { success: true }
  })

  // ============================================================
  // 1. project_core — 项目主台账
  // ============================================================
  guardedHandle('db:project-core-get', async () => {
    return ProjectCoreRepository.get()
  })

  guardedHandle('db:project-core-update', async (_event, data: Partial<ProjectCoreData>) => {
    try {
      ProjectCoreRepository.update(data)
      return { success: true }
    } catch (err) {
      logger.error('DB:Controller', t('log.dbController.projectCoreUpdateFailed').replace('{err}', String(err)))
      return { success: false, error: String(err) }
    }
  })

  // ============================================================
  // 2. blueprints — 章节蓝图
  // ============================================================
  guardedHandle('db:blueprint-get-all', async () => {
    return BlueprintRepository.getAll()
  })

  guardedHandle('db:blueprint-get', async (_event, chapterNumber: number) => {
    return BlueprintRepository.getByChapter(chapterNumber)
  })

  guardedHandle('db:blueprint-upsert', async (_event, data: BlueprintData) => {
    try {
      BlueprintRepository.upsert(data)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  guardedHandle('db:blueprint-upsert-many', async (_event, items: BlueprintData[]) => {
    try {
      BlueprintRepository.upsertMany(items)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  guardedHandle('db:blueprint-update-notes', async (_event, chapterNumber: number, notes: string) => {
    try {
      BlueprintRepository.updateNotes(chapterNumber, notes)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  guardedHandle('db:blueprint-delete', async (_event, chapterNumber: number) => {
    try {
      BlueprintRepository.delete(chapterNumber)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  guardedHandle('db:blueprint-get-all-sorted', async (_event, config: { key: string; direction: string }) => {
    return BlueprintRepository.getAllSorted(config as { key: 'chapter_number' | 'priority' | 'role' | 'custom'; direction: 'asc' | 'desc' })
  })

  guardedHandle('db:blueprint-get-gaps', async (_event, totalChapters: number) => {
    return BlueprintRepository.getGaps(totalChapters)
  })

  guardedHandle('db:blueprint-update-sort-order', async (_event, orders: Array<{ chapterNumber: number; sortOrder: number }>) => {
    try {
      BlueprintRepository.updateSortOrder(orders)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  guardedHandle('db:blueprint-update-priority', async (_event, chapterNumber: number, priority: number) => {
    try {
      BlueprintRepository.updatePriority(chapterNumber, priority)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  guardedHandle('db:blueprint-update-priority-batch', async (_event, items: Array<{ chapterNumber: number; priority: number }>) => {
    try {
      BlueprintRepository.updatePriorityBatch(items)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ============================================================
  // 3. characters — 角色卡
  // ============================================================
  guardedHandle('db:character-get-all', async () => {
    return CharacterRepository.getAll()
  })

  guardedHandle('db:character-upsert', async (_event, data: CharacterData) => {
    try {
      CharacterRepository.upsert(data)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  guardedHandle('db:character-save-all', async (_event, items: CharacterData[]) => {
    try {
      CharacterRepository.saveAll(items)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  guardedHandle('db:character-delete', async (_event, name: string) => {
    try {
      CharacterRepository.delete(name)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  guardedHandle('db:character-merge', async (_event, target: string, source: string) => {
    try {
      CharacterRepository.mergeCharacters(target, source)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  guardedHandle('db:character-update-appearance-stats', async (_event, name: string, stats: { appearCount: number; firstChapter: number; lastChapter: number }) => {
    try {
      CharacterRepository.updateAppearanceStats(name, stats)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  guardedHandle('db:character-update-state', async (_event, name: string, state: CharacterStateData, extra?: { tags?: string | null; motivation?: string | null }) => {
    try {
      CharacterRepository.updateState(name, state, extra)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  guardedHandle('db:character-merge-fields', async (_event, name: string, fields: Record<string, string>) => {
    try {
      CharacterRepository.mergeFields(name, fields)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ============================================================
  // 4. drafts — 草稿
  // ============================================================
  guardedHandle('db:draft-create', async (_event, params: {
    chapterNumber: number
    version: number
    source: 'write' | 'rewrite' | 'translation'
    content: string
    wordCount: number
  }) => {
    try {
      const id = DraftRepository.create(params)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  guardedHandle('db:draft-list', async (_event, chapterNumber: number) => {
    return DraftRepository.listByChapter(chapterNumber)
  })

  // ===== 连载监控（手动导入平台章节，本地优先——不自动抓取） =====

  guardedHandle('db:publication-list', async (): Promise<PublicationEntry[]> => {
    return PublicationRepository.getAll()
  })

  guardedHandle('db:publication-save', async (_event, input: { chapterNumber: number; title: string; content: string; terms?: string[] }) => {
    try {
      // 本地定稿对比：同章最新定稿全文（无定稿则仅审计）
      let localContent: string | null = null
      const finalized = DraftRepository.getFinalizedByChapter(input.chapterNumber)
      if (finalized) {
        const full = DraftRepository.getFull(finalized.id)
        if (full) localContent = full.content
      }
      const report = analyzeExternalChapter(input.content, localContent, input.terms ?? [])
      PublicationRepository.upsert({
        chapterNumber: input.chapterNumber,
        externalTitle: input.title,
        externalContent: input.content,
        importedAt: Date.now(),
        similarity: report.similarity,
        auditIssues: report.auditIssues.length,
      })
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  guardedHandle('db:publication-delete', async (_event, chapterNumber: number): Promise<{ success: boolean }> => {
    try {
      PublicationRepository.delete(chapterNumber)
      return { success: true }
    } catch {
      return { success: false }
    }
  })

  guardedHandle('db:draft-get-meta', async (_event, id: number) => {
    return DraftRepository.getMeta(id)
  })

  guardedHandle('db:draft-get-full', async (_event, id: number) => {
    return DraftRepository.getFull(id)
  })

  guardedHandle('db:draft-get-latest', async (_event, chapterNumber: number) => {
    return DraftRepository.getLatestByChapter(chapterNumber)
  })

  guardedHandle('db:draft-get-finalized', async (_event, chapterNumber: number) => {
    return DraftRepository.getFinalizedByChapter(chapterNumber)
  })

  guardedHandle('db:draft-get-max-finalized-chapter', async () => {
    return DraftRepository.getMaxFinalizedChapter()
  })

  guardedHandle('db:draft-get-all-chapter-numbers', async () => {
    return DraftRepository.getAllChapterNumbers()
  })

  guardedHandle('db:draft-next-version', async (_event, chapterNumber: number) => {
    return DraftRepository.getNextVersion(chapterNumber)
  })

  guardedHandle('db:draft-update-status', async (_event, id: number, status: string, wordCount?: number) => {
    try {
      DraftRepository.updateStatus(id, status, wordCount)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  guardedHandle('db:draft-update-content', async (_event, id: number, content: string, wordCount: number) => {
    try {
      DraftRepository.updateContent(id, content, wordCount)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ============================================================
  // 5. revisions — 修稿
  // ============================================================
  guardedHandle('db:revision-create', async (_event, params: {
    baseDraftId: number
    revisionIndex: number
    revisionType: 'refine' | 'review-fix'
    userPrompt?: string
    reviewSourceId?: number
    content: string
    wordCount: number
  }) => {
    try {
      const id = RevisionRepository.create(params)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  guardedHandle('db:revision-list', async (_event, baseDraftId: number) => {
    return RevisionRepository.listByDraft(baseDraftId)
  })

  guardedHandle('db:revision-get-pending', async (_event, baseDraftId: number) => {
    return RevisionRepository.getPending(baseDraftId)
  })

  guardedHandle('db:revision-get-full', async (_event, id: number) => {
    return RevisionRepository.getFull(id)
  })

  guardedHandle('db:revision-next-index', async (_event, baseDraftId: number) => {
    return RevisionRepository.getNextIndex(baseDraftId)
  })

  guardedHandle('db:revision-mark-merged', async (_event, id: number, mergedToDraftId: number) => {
    try {
      RevisionRepository.markMerged(id, mergedToDraftId)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  guardedHandle('db:revision-mark-discarded', async (_event, id: number) => {
    try {
      RevisionRepository.markDiscarded(id)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ============================================================
  // checkpoint — 工作流 checkpoint（L2：迁 DB，跨项目隔离）
  // ============================================================
  guardedHandle('db:checkpoint-save', async (_event, data: unknown) => {
    try {
      WorkflowCheckpointRepository.save(JSON.stringify(data ?? {}))
      return { success: true }
    } catch (err) { return { success: false, error: String(err) } }
  })
  guardedHandle('db:checkpoint-load', async () => {
    try {
      const raw = WorkflowCheckpointRepository.load()
      return { success: true, data: raw ? JSON.parse(raw) : null }
    } catch (err) { return { success: false, error: String(err) } }
  })
  guardedHandle('db:checkpoint-clear', async () => {
    try {
      WorkflowCheckpointRepository.clear()
      return { success: true }
    } catch (err) { return { success: false, error: String(err) } }
  })

  // ============================================================
  // automation — 写作自动化（D 档：任务 / 收件箱 / 运行记录）
  // 注：仓库实例内部每次 getProjectDb() 取当前项目库，项目切换自动跟随，无需重建
  // ============================================================
  const automationRepo = createAutomationRepository()

  guardedHandle('db:automation-list', async () => {
    try { return { success: true, tasks: automationRepo.listTasks() } }
    catch (err) { return { success: false, error: String(err) } }
  })
  guardedHandle('db:automation-save', async (_event, task: unknown) => {
    try { automationRepo.saveTask(task as Parameters<typeof automationRepo.saveTask>[0]); return { success: true } }
    catch (err) { return { success: false, error: String(err) } }
  })
  guardedHandle('db:automation-delete', async (_event, id: string) => {
    try { automationRepo.deleteTask(id); return { success: true } }
    catch (err) { return { success: false, error: String(err) } }
  })
  guardedHandle('db:automation-set-enabled', async (_event, id: string, enabled: boolean) => {
    try { automationRepo.setEnabled(id, enabled, Date.now()); return { success: true } }
    catch (err) { return { success: false, error: String(err) } }
  })
  guardedHandle('db:automation-trigger-states', async () => {
    try {
      const states: Record<string, unknown> = {}
      for (const task of automationRepo.listTasks()) states[task.id] = automationRepo.getTriggerState(task.id)
      return { success: true, states }
    } catch (err) { return { success: false, error: String(err) } }
  })
  guardedHandle('db:automation-apply-outcome', async (_event, input: unknown) => {
    try { automationRepo.applyTriggerOutcome(input as TriggerOutcomeInput); return { success: true } }
    catch (err) { return { success: false, error: String(err) } }
  })
  guardedHandle('db:automation-inbox-list', async () => {
    try { return { success: true, items: automationRepo.listInbox() } }
    catch (err) { return { success: false, error: String(err) } }
  })
  guardedHandle('db:automation-inbox-update', async (_event, id: string, patch: unknown) => {
    try { automationRepo.updateInboxStatus(id, patch as Parameters<typeof automationRepo.updateInboxStatus>[1]); return { success: true } }
    catch (err) { return { success: false, error: String(err) } }
  })
  guardedHandle('db:automation-run-append', async (_event, run: unknown) => {
    try { automationRepo.appendRun(run as Parameters<typeof automationRepo.appendRun>[0]); return { success: true } }
    catch (err) { return { success: false, error: String(err) } }
  })
  guardedHandle('db:automation-run-update', async (_event, id: string, patch: unknown) => {
    try { automationRepo.updateRun(id, patch as Parameters<typeof automationRepo.updateRun>[1]); return { success: true } }
    catch (err) { return { success: false, error: String(err) } }
  })
  guardedHandle('db:automation-running-runs', async () => {
    try { return { success: true, runs: automationRepo.getRunningRuns() } }
    catch (err) { return { success: false, error: String(err) } }
  })
  guardedHandle('db:automation-finalized-chapters', async () => {
    try { return { success: true, chapters: DraftRepository.listFinalizedChapters() } }
    catch (err) { return { success: false, error: String(err) } }
  })
  guardedHandle('db:automation-chapter-texts', async () => {
    try { return { success: true, texts: DraftRepository.getFinalizedChapterTexts(SEMANTIC_CHAPTER_TRUNCATE) } }
    catch (err) { return { success: false, error: String(err) } }
  })

  // ============================================================
  // 6. reviews — 审稿
  // ============================================================
  guardedHandle('db:review-create', async (_event, params: {
    baseDraftId: number
    reviewIndex: number
    content: string
  }) => {
    try {
      const id = ReviewRepository.create(params)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  guardedHandle('db:review-list', async (_event, baseDraftId: number) => {
    return ReviewRepository.listByDraft(baseDraftId)
  })

  guardedHandle('db:review-get-latest', async (_event, baseDraftId: number) => {
    return ReviewRepository.getLatestByDraft(baseDraftId)
  })

  guardedHandle('db:review-get-full', async (_event, id: number) => {
    return ReviewRepository.getFull(id)
  })

  guardedHandle('db:review-next-index', async (_event, baseDraftId: number) => {
    return ReviewRepository.getNextIndex(baseDraftId)
  })

  // ============================================================
  // 6b. evaluation_scores — AI 互评
  // ============================================================
  guardedHandle('db:evaluation-create', async (_event, params: {
    draftId: number
    perspective: string
    scores: string
    overallScore: number
    strengths: string
    weaknesses: string
    suggestions: string
    rawResponse: string
    tokensUsed: number
  }) => {
    try {
      const db = getProjectDb()
      if (!db) return { success: false, error: t('error.dbNotConnected') }

      const result = db.prepare(`
        INSERT INTO evaluation_scores (
          draft_id, reviewer_perspective, scores, overall_score,
          strengths, weaknesses, suggestions, raw_response, tokens_used
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        params.draftId, params.perspective, params.scores,
        params.overallScore, params.strengths, params.weaknesses,
        params.suggestions, params.rawResponse, params.tokensUsed,
      )

      return { success: true, id: result.lastInsertRowid as number }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  guardedHandle('db:evaluation-list-by-draft', async (_event, draftId: number) => {
    const db = getProjectDb()
    if (!db) return []

    return db.prepare(
      'SELECT * FROM evaluation_scores WHERE draft_id = ? ORDER BY created_at DESC'
    ).all(draftId)
  })

  // ============================================================
  // 7. post_process — 后处理跑批
  // ============================================================
  guardedHandle('db:post-process-create-run', async (_event, params: {
    triggerSourceType: string
    triggerSourceId: string
    sourceLabel: string
    steps: Array<{ key: string; label: string; critical: boolean }>
  }) => {
    try {
      const id = PostProcessRepository.createRun(params)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  guardedHandle('db:post-process-get-latest-run', async (_event, sourceType: string, sourceId: string) => {
    return PostProcessRepository.getLatestRun(sourceType, sourceId)
  })

  guardedHandle('db:post-process-get-steps', async (_event, runId: string) => {
    return PostProcessRepository.getSteps(runId)
  })

  guardedHandle('db:post-process-mark-step-ok', async (_event, runId: string, stepKey: string) => {
    try {
      PostProcessRepository.markStepOk(runId, stepKey)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  guardedHandle('db:post-process-mark-step-failed', async (_event, runId: string, stepKey: string, errorMsg: string) => {
    try {
      PostProcessRepository.markStepFailed(runId, stepKey, errorMsg)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  guardedHandle('db:post-process-is-all-passed', async (_event, sourceType: string, sourceId: string) => {
    return PostProcessRepository.isAllCriticalPassed(sourceType, sourceId)
  })

  // ============================================================
  // 沿用旧表
  // ============================================================
  guardedHandle('db:log-llm-call', async (_event, call) => {
    try {
      LLMHistoryRepository.logCall(call)
      return { success: true }
    } catch (error) {
      logger.error('DB:Controller', t('log.dbController.logLlmCallFailed').replace('{err}', String(error)))
      return { success: false }
    }
  })

  guardedHandle('db:get-llm-stats', async () => {
    return LLMHistoryRepository.getStats()
  })

  // 用量统计（当前项目维度：purpose/模型两维度 + 合计；区间过滤毫秒时间戳；无项目返回空聚合）
  guardedHandle('db:usage-stats', async (_event, range: { from: number; to: number }) => {
    return LLMHistoryRepository.getUsageStats(range.from, range.to)
  })

  // 全局用量统计（跨项目聚合：最近项目 + 当前项目逐项目只读；主进程 60s 缓存）
  guardedHandle('db:usage-stats-global', async () => {
    return getGlobalUsageStats(getCurrentProjectPath() ?? undefined)
  })

  guardedHandle('db:get-llm-history', async (_event, limit?: number) => {
    return LLMHistoryRepository.getHistory(limit ?? 50)
  })

  guardedHandle('db:get-daily-activity', async (_event, days?: number, projectPath?: string, currentProjectPath?: string) => {
    return ActivityRepository.getDailyActivity(days ?? 90, projectPath, currentProjectPath)
  })

  guardedHandle('db:save-summary-snapshot', async (_event, chapterNumber: number, characterStates: string) => {
    SummaryRepository.saveSnapshot(chapterNumber, characterStates)
    return { success: true }
  })

  guardedHandle('db:get-latest-summary', async () => {
    return SummaryRepository.getLatestSnapshot()
  })

  // ============================================================
  // 13. volumes — 分卷（长篇小说按卷组织章节）
  // ============================================================
  guardedHandle('db:volume-get-all', async () => {
    return VolumeRepository.getAll()
  })

  guardedHandle('db:volume-get-by-chapter', async (_event, chapterNumber: number) => {
    return VolumeRepository.getByChapter(chapterNumber)
  })

  guardedHandle('db:volume-upsert', async (_event, data: VolumeData) => {
    try {
      VolumeRepository.upsert(data)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  guardedHandle('db:volume-delete', async (_event, volumeNumber: number) => {
    try {
      VolumeRepository.delete(volumeNumber)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ============================================================
  // 14. preferences — 偏好记忆（AI 文本 → 用户替换对）
  // ============================================================
  guardedHandle('db:preference-record', async (_event, aiText: string, userText: string, chapterNumber?: number) => {
    try {
      PreferenceRepository.record(aiText, userText, chapterNumber)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  guardedHandle('db:preference-get-top', async (_event, limit: number, recentChapters?: number) => {
    return PreferenceRepository.getTop(limit ?? 5, recentChapters)
  })
}
