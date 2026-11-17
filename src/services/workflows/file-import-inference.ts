import type { GeneratedBlueprintFields } from '../../core'
import type { FileImportChapter, FileImportExcerpt, FileImportSettings, FileImportSettingsOffer, LLMRequest, ProjectChannels } from '../../shared/ipc-channels'
import { t } from '../../shared/locale'
import { STRUCTURED_JSON_TEMPERATURE } from '../../shared/thinking-level'
import { useLLMStore } from '../../stores/llm-store'
import { normalizeBlueprintRole } from '../blueprint-role'
import { ipc } from '../ipc-client'
import { getPromptTemplate } from '../prompt-templates'
import { ImportPromptBuilder } from '../prompts/prompt-builder'
import { robustParseJSON, stripThinkingTags } from './workflow-utils'

const fields = ['worldSetting', 'coreOutline', 'protagonistProfile', 'writingStyle'] as const
export interface FileImportInference {
  values: FileImportSettings
  settingsOffer?: FileImportSettingsOffer
}

export interface FileImportBlueprintInference {
  items: GeneratedBlueprintFields[]
  existingChapterNumbers: number[]
  offerId?: string
}

function generatePreview(request: LLMRequest, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID()
    let started = false
    const stop = () => {
      if (started) void ipc.invoke('llm:cancel', requestId).catch(() => {})
    }
    const onAbort = () => {
      cleanup()
      stop()
      reject(signal.reason)
    }
    const fail = (error: unknown) => { cleanup(); reject(error) }
    const done = ipc.on('llm:stream-done', event => {
      if (event.requestId !== requestId) return
      cleanup()
      resolve(event.fullText)
    })
    const failed = ipc.on('llm:stream-error', event => {
      if (event.requestId === requestId) fail(new Error(event.error))
    })
    function cleanup() {
      signal.removeEventListener('abort', onAbort)
      done()
      failed()
    }
    signal.addEventListener('abort', onAbort, { once: true })
    // 先订阅结果再发起推演。若启动回执晚于取消，收到回执时补发取消。
    void ipc.invoke('llm:generate-stream', requestId, request).then(result => {
      started = result?.started === true
      if (signal.aborted) stop()
      else if (!started) fail(new Error(t('project.fileEditorInferenceFailed')))
    }).catch(fail)
  })
}

async function assertImportSource(token: string, firstNumber: number, chapters: FileImportChapter[], signal: AbortSignal,
  source: Pick<ProjectChannels['project:file-editor-import-inference']['return'], 'projectId' | 'revisions'>) {
  signal.throwIfAborted()
  // 模型完成时再次核验原会话和整批 revision，避免展示生成期间已过期的正文推演。
  const current = await ipc.invoke('project:file-editor-import-source', token, firstNumber, chapters)
  signal.throwIfAborted()
  if (current.projectId !== source.projectId || current.chapters.length !== source.revisions.length ||
      source.revisions.some(({ chapterId, revision }, index) => {
        const chapter = current.chapters[index]
        return chapter.chapterId !== chapterId || chapter.revision !== revision
      })) throw new Error(t('error.requestCancelled'))
}

export async function inferFileImport(token: string, firstNumber: number, chapters: FileImportChapter[],
  signal: AbortSignal): Promise<FileImportInference> {
  signal.throwIfAborted()
  const modelId = useLLMStore.getState().getModelForPurpose('extract_json')
  if (!modelId) throw new Error(t('error.noDefaultModel'))
  const source = await ipc.invoke('project:file-editor-import-inference', token, firstNumber, chapters)
  signal.throwIfAborted()
  const formatExcerpt = ({ number, title, content }: FileImportExcerpt) => `${number}. ${title}\n${content}`
  const prompt = new ImportPromptBuilder({
    key: 'file_import_inference_preview', name: t('project.fileEditorInferImport'), description: '',
    content: t('project.fileEditorInferPrompt'), variables: { sample_content: '' },
  }).withSampleContent([...source.samples, ...source.excerpts].map(formatExcerpt).join('\n\n')).build()
  const raw = await generatePreview({ modelId, messages: [
    { role: 'system', content: t('role.editorAnalyst') }, { role: 'user', content: prompt },
  ], stream: true, responseFormat: { type: 'json_object' }, temperature: STRUCTURED_JSON_TEMPERATURE,
  maxTokens: 1800, thinking: false }, signal)
  await assertImportSource(token, firstNumber, chapters, signal, source)

  const parsed = robustParseJSON(stripThinkingTags(raw))
  const values: FileImportSettings = {}
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const field of fields) {
      const content = (parsed as Record<string, unknown>)[field]
      if (typeof content === 'string' && content.trim()) values[field] = content.trim()
    }
  }
  if (!Object.keys(values).length) throw new Error(t('project.fileEditorInferenceFailed'))
  return { values, settingsOffer: source.settingsOffer }
}

export async function inferFileImportBlueprints(token: string, firstNumber: number, chapters: FileImportChapter[],
  signal: AbortSignal, onProgress: (completed: number, total: number) => void): Promise<FileImportBlueprintInference> {
  signal.throwIfAborted()
  const source = await ipc.invoke('project:file-editor-import-blueprints', token, firstNumber, chapters)
  signal.throwIfAborted()
  const result: FileImportBlueprintInference = { items: [], existingChapterNumbers: source.existingChapterNumbers, offerId: source.offerId }
  if (!source.candidates.length) return result
  const modelId = useLLMStore.getState().getModelForPurpose('blueprint_gen')
  if (!modelId) throw new Error(t('error.noDefaultModel'))
  const template = getPromptTemplate('infer_single_chapter_blueprint')
  if (!template) throw new Error(t('project.fileEditorBlueprintInferenceFailed'))

  onProgress(0, source.candidates.length)
  for (const chapter of source.candidates) {
    // 可信章号直接填进模板的 JSON 示例，正文与标题继续由 Builder 包裹为引用内容。
    const builder = new ImportPromptBuilder({ ...template, content: template.content.replaceAll('{{chapter_number}}', String(chapter.number)) })
      .withChapterContent(chapter.content).withChapterTitle(chapter.title).withNovelConfigSummary('')
    const raw = await generatePreview({ modelId, messages: [
      { role: 'system', content: builder.getSystemRole() || t('role.novelAnalyst') }, { role: 'user', content: builder.build() },
    ], stream: true, responseFormat: { type: 'json_object' }, temperature: STRUCTURED_JSON_TEMPERATURE,
    maxTokens: 900, thinking: false }, signal)
    signal.throwIfAborted()
    const parsed = robustParseJSON(stripThinkingTags(raw))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(t('project.fileEditorBlueprintInferenceFailed'))
    const row = parsed as Record<string, unknown>
    const text = (field: string) => typeof row[field] === 'string' ? row[field].trim() : ''
    const characters = (Array.isArray(row.characters) ? row.characters : text('characters').split(/[,，、;；]+/))
      .filter((name): name is string => typeof name === 'string' && name.trim() !== '').map(name => name.trim())
    const title = text('title')
    const purpose = text('purpose')
    const keyEvents = text('keyEvents')
    const suspenseHook = text('suspenseHook')
    if (!title && !purpose && !keyEvents && !suspenseHook && !characters.length) throw new Error(t('project.fileEditorBlueprintInferenceFailed'))
    result.items.push({ chapterNumber: chapter.number, title: title || chapter.title, role: normalizeBlueprintRole(text('role')),
      purpose, keyEvents, characters, suspenseHook })
    onProgress(result.items.length, source.candidates.length)
  }
  await assertImportSource(token, firstNumber, chapters, signal, source)
  return result
}
