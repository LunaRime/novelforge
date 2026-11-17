import { t } from '../../shared/locale'
import type { FileAgentEditProposal } from '../../shared/ipc-channels'
import { useLLMStore } from '../../stores/llm-store'
import { runAgentLoop } from '../agent/agent-engine'
import { buildAgentTool, createToolRegistry } from '../agent/tool-registry'
import { ipc } from '../ipc-client'
import { requestStreamText } from '../llm/request-stream-text'
import { appendOutputLanguage } from '../prompt-templates'

function readInteger(input: unknown, minimum: number): number | undefined {
  if (input === undefined) return undefined
  if (typeof input !== 'number' && (typeof input !== 'string' || !input.trim())) throw new Error('Invalid read range')
  const value = Number(input)
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error('Invalid read range')
  return value
}

export async function askFileProjectAgent(token: string, locator: string | undefined, question: string, signal: AbortSignal,
  editable = false): Promise<{ answer: string; proposal?: FileAgentEditProposal }> {
  signal.throwIfAborted()
  const modelId = useLLMStore.getState().getModelForPurpose('agent_chat')
  if (!modelId) throw new Error(t('error.noDefaultModel'))
  const range = {
    offset: { type: 'integer', description: t('project.fileEditorAgentOffset') },
    limit: { type: 'integer', description: t('project.fileEditorAgentLimit') },
  }
  const failed = () => ({ success: false, content: '', error: t('project.fileEditorAgentReadFailed') })
  let revision: string | undefined
  let proposal: FileAgentEditProposal | undefined
  // 此轮拥有独立工具目录，每个工具只持有打开候选项目时签发的会话令牌。
  const definitions = [
    buildAgentTool({
      name: 'list_chapters', description: t('project.fileEditorAgentListTool'), source: 'builtin', requiresConfirmation: false,
      inputSchema: { type: 'object', properties: range },
      async execute(args) {
        try {
          signal.throwIfAborted()
          const { chapters, nextOffset } = await ipc.invoke('project:file-editor-agent-list', token,
            readInteger(args.offset, 0) ?? 0, readInteger(args.limit, 1))
          signal.throwIfAborted()
          return { success: true, content: JSON.stringify({ nextOffset, chapters }) }
        } catch { return failed() }
      },
    }),
    buildAgentTool({
      name: 'read_file', description: t('project.fileEditorAgentReadTool'), source: 'builtin', requiresConfirmation: false,
      inputSchema: { type: 'object', properties: {
        file_path: { type: 'string', description: t('project.fileEditorAgentLocator') }, ...range,
      }, required: ['file_path'] },
      async execute(args) {
        try {
          signal.throwIfAborted()
          if (typeof args.file_path !== 'string' || !args.file_path) return failed()
          const { nextOffset, ...document } = await ipc.invoke('project:file-editor-agent-read', token, args.file_path,
            readInteger(args.offset, 0) ?? 0, readInteger(args.limit, 1))
          signal.throwIfAborted()
          if (document.locator === locator) revision = document.readOnly ? undefined : document.revision
          return { success: true, content: JSON.stringify({ nextOffset, ...document }) }
        } catch { return failed() }
      },
    }),
  ]
  if (editable && locator?.startsWith('doc://chapter/')) definitions.push(buildAgentTool({
    name: 'propose_edit', description: t('project.fileEditorAgentEditTool'), source: 'builtin',
    requiresConfirmation: false, isConcurrencySafe: false,
    inputSchema: { type: 'object', properties: {
      file_path: { type: 'string', description: t('project.fileEditorAgentLocator') },
      original: { type: 'string', description: t('project.fileEditorAgentOriginal') },
      replacement: { type: 'string', description: t('project.fileEditorAgentReplacement') },
    }, required: ['file_path', 'original', 'replacement'] },
    async execute(args) {
      const reject = () => ({ success: false, content: '', error: t('project.fileEditorAgentEditRejected') })
      if (proposal || !revision || args.file_path !== locator || typeof args.original !== 'string' || typeof args.replacement !== 'string') return reject()
      try {
        // 只采用本轮读取工具获取的 revision，模型只能提交待预览的文本。
        signal.throwIfAborted()
        const prepared = await ipc.invoke('project:file-editor-agent-propose-edit', token, locator, revision, args.original, args.replacement)
        if (signal.aborted) {
          await ipc.invoke('project:file-editor-agent-resolve-edit', token, prepared.id, 'discard').catch(() => {})
          return reject()
        }
        proposal = prepared
        return { success: true, content: t('project.fileEditorAgentEditProposed') }
      } catch { return reject() }
    },
  }))
  const tools = createToolRegistry(definitions)
  const source = locator ? `\n${t('project.fileEditorAgentCurrentDocument').replace('{locator}', () => locator)}` : ''
  const prompt = appendOutputLanguage(`${t('project.fileEditorAgentPrompt')}${source}\n\n${tools.generateToolPrompt()}`)
  let answer = ''
  let error: string | undefined
  try {
    await runAgentLoop(prompt, [], question, modelId,
      (messages, id) => requestStreamText({ modelId: id, messages, stream: true }, signal), {
        onTextChunk: () => {}, onToolCallStart: () => {}, onToolCallComplete: () => {},
        onToolCallConfirmRequired: async () => false,
        onDone: text => { answer = text }, onError: failure => { error = failure },
      }, signal, { allowedTools: tools.listAll().map(tool => tool.name) }, { tools })
    signal.throwIfAborted()
    if (error || (!answer.trim() && !proposal)) throw new Error(error ?? t('project.fileEditorAgentFailed'))
    return proposal ? { answer, proposal } : { answer }
  } catch (failure) {
    if (proposal) await ipc.invoke('project:file-editor-agent-resolve-edit', token, proposal.id, 'discard').catch(() => {})
    throw failure
  }
}
