import { t } from '../../shared/locale'
import { useLLMStore } from '../../stores/llm-store'
import { requestStreamText } from '../llm/request-stream-text'
import { appendOutputLanguage } from '../prompt-templates'

export interface FileChapterContinuationInput {
  number: number
  title: string
  previous: string
  guidance: string
}

export async function generateFileChapterContinuation(input: FileChapterContinuationInput, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  const modelId = useLLMStore.getState().getModelForPurpose('draft_chapter')
  if (!modelId) throw new Error(t('error.noDefaultModel'))

  // 只使用候选编辑器传入的已保存文稿，避免读取当前 SQLite 项目的正文或设定。
  const content = await requestStreamText({ modelId, stream: true, messages: [
    { role: 'system', content: appendOutputLanguage(t('project.fileEditorContinuationPrompt')) },
    { role: 'user', content: JSON.stringify({ ...input, previous: input.previous.slice(-4000) }) },
  ] }, signal)
  signal.throwIfAborted()
  if (!content.trim()) throw new Error(t('project.fileEditorContinuationFailed'))
  return content
}
