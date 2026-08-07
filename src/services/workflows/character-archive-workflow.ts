// src/services/workflows/character-archive-workflow.ts
import { ipc } from '../ipc-client'
import { t } from '../../shared/locale'
import { useLLMStore } from '../../stores/llm-store'
import { getPromptTemplate } from '../prompt-templates'
import { PostProcessPromptBuilder } from '../prompts/prompt-builder'
import { extractRoleContextSegments, hasBlankArchiveFields, parseArchiveJson } from '../character-archive'
import type { CharacterData } from '../../../electron/repositories/character-repository'

/**
 * 定稿正文 → 角色档案 工作流
 * 逐角色从已定稿章节中提取该角色出现的相关段落，调用 LLM 生成静态档案，
 * 通过 db:character-merge-fields 仅填充空白字段（非空保旧），完成后刷新角色卡。
 */
async function callLLMForArchive(builder: { build: () => string; getSystemRole: () => string }, callbacks: { appendText: (t: string) => void }): Promise<string> {
  const llmStore = useLLMStore.getState()
  if (!llmStore.defaultModelId) throw new Error(t('error.noDefaultModel'))
  let full = ''
  await new Promise<void>((resolve, reject) => {
    llmStore.generateStream(
      [
        { role: 'system', content: builder.getSystemRole() },
        { role: 'user', content: builder.build() },
      ],
      { onChunk: c => { full += c; callbacks.appendText(c) }, onDone: () => resolve(), onError: e => reject(new Error(e)) },
      undefined,
      { responseFormat: { type: 'json_object' } },
    )
  })
  return full
}

export function runCharacterArchive(_projectPath: string, nameFilter?: string): void {
  import('../../stores/workflow-store').then(async ({ useWorkflowStore }) => {
    await useWorkflowStore.getState().startWorkflow({
      type: 'post_process',
      title: t('workflow.archiveTitle'),
      steps: [{
        name: t('workflow.archiveSteps'),
        description: t('workflow.archiveStepsDesc'),
        executor: async (_step, _ctx, callbacks) => {
          const allChars = (await ipc.invoke('db:character-get-all')) as unknown as CharacterData[]
          const targets = nameFilter ? allChars.filter(c => c.name === nameFilter) : allChars
          const pending = targets.filter(c => hasBlankArchiveFields(c as unknown as Record<string, unknown>))
          const skipped = targets.length - pending.length
          if (skipped > 0) {
            callbacks.log(t('log.archiveSkipped').replace('{n}', String(skipped)))
          }
          if (pending.length === 0) {
            callbacks.log(t('log.archiveAllComplete'))
            return
          }
          callbacks.log(t('log.archiveStart').replace('{n}', String(pending.length)))

          // 全部定稿章节正文（draft-get-finalized 仅返回 meta，正文经 draft-get-full 按 id 补取）
          const chapterNumbers = (await ipc.invoke('db:draft-get-all-chapter-numbers')) as number[]
          const chapters: Array<{ chapterNumber: number; content: string }> = []
          for (const n of [...chapterNumbers].sort((a, b) => a - b)) {
            const meta = await ipc.invoke('db:draft-get-finalized', n) as { id: number; content?: string } | null
            if (!meta) continue
            const full = await ipc.invoke('db:draft-get-full', meta.id) as { content?: string } | null
            if (full?.content) chapters.push({ chapterNumber: n, content: full.content })
          }
          if (chapters.length === 0) throw new Error(t('error.noFinalizedChapters'))

          let failed = 0
          for (const char of pending) {
            try {
              const segments = extractRoleContextSegments(chapters, char.name)
              if (segments.length === 0) {
                callbacks.log(t('log.archiveNoMention').replace('{name}', char.name))
                continue
              }
              const template = getPromptTemplate('extract_from_finalized')
              if (!template) throw new Error(t('error.templateNotFound').replace('{name}', 'extract_from_finalized'))
              const segText = segments.map(s => `[第${s.chapterNumber}章]\n${s.text}`).join('\n\n---\n\n')
              const builder = new PostProcessPromptBuilder(template)
                .withCharacterName(char.name)
                .withChaptersSegments(segText)
              const raw = await callLLMForArchive(builder, callbacks)
              const parsed = parseArchiveJson(raw, char.name)
              if (!parsed) {
                failed++
                callbacks.log(t('log.archiveParseFailed').replace('{name}', char.name))
                continue
              }
              const result = await ipc.invoke('db:character-merge-fields', char.name, parsed)
              if (!result.success) {
                failed++
                callbacks.log(t('log.archiveCharFailed').replace('{name}', char.name).replace('{error}', () => result.error || String(result)))
                continue
              }
              callbacks.log(t('log.archiveDone').replace('{name}', char.name))
            } catch (e) {
              failed++
              callbacks.log(t('log.archiveCharFailed').replace('{name}', char.name).replace('{error}', () => String(e)))
            }
          }
          if (failed > 0) callbacks.log(t('log.archiveFailedSummary').replace('{n}', String(failed)))
          // 刷新角色卡（定稿档案写入后各面板重载角色数据）
          const { globalEventBus } = await import('../../shared/event-bus')
          globalEventBus.emit('REFRESH_RESOURCE', { resources: ['characterCards'] })
        },
      }],
    })
  })
}
