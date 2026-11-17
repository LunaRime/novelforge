import { t } from '../../shared/locale'
import type { FileContinuationSource } from '../../shared/ipc-channels'
import { useLLMStore } from '../../stores/llm-store'
import { ipc } from '../ipc-client'
import { requestStreamText } from '../llm/request-stream-text'
import { appendOutputLanguage } from '../prompt-templates'

export interface FileChapterContinuationInput {
  token: string
  source: FileContinuationSource
  number: number
  title: string
  guidance: string
}

export async function generateFileChapterContinuation({ token, source, number, title, guidance }: FileChapterContinuationInput,
  signal: AbortSignal): Promise<{ content: string; contextRevision: string }> {
  signal.throwIfAborted()
  const modelId = useLLMStore.getState().getModelForPurpose('draft_chapter')
  if (!modelId) throw new Error(t('error.noDefaultModel'))

  // 会话令牌和版本仅用于本地读取和提交，模型只接收创作所需的内容。
  const { previous, settings, blueprint, contextRevision } = await ipc.invoke('project:file-editor-continuation-context', token, number, source)
  signal.throwIfAborted()
  const content = await requestStreamText({ modelId, stream: true, messages: [
    { role: 'system', content: appendOutputLanguage(t('project.fileEditorContinuationPrompt')) },
    { role: 'user', content: JSON.stringify({ number, title, guidance, previous, settings, blueprint }) },
  ] }, signal)
  signal.throwIfAborted()
  if (!content.trim()) throw new Error(t('project.fileEditorContinuationFailed'))
  return { content, contextRevision }
}
