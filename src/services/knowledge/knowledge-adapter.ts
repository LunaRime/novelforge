import { createKnowledgeApplication, type KnowledgePorts } from '../../core'
import { useProjectStore } from '../../stores/project-store'
import { useLLMStore } from '../../stores/llm-store'
import { ipc } from '../ipc-client'
import { readDocument } from '../editor/open-editor-document'
import { t } from '../../shared/locale'

const currentScope: KnowledgePorts['scope'] = () => {
  const { currentProject, projectSession } = useProjectStore.getState()
  return currentProject ? { id: currentProject.id, path: currentProject.path, session: projectSession } : null
}
export function createRendererKnowledgeApplication(source = currentScope()) {
  return createKnowledgeApplication({
    scope: currentScope,
    load: async () => {
      const [documents, stats] = await Promise.all([ipc.invoke('kb:list-documents'), ipc.invoke('kb:stats')])
      return { documents, stats }
    },
    search: (query, topK) => ipc.invoke('kb:search', query, topK),
    read: readDocument,
    generate: async (content, systemPrompt) => {
      const result = await useLLMStore.getState().generate([{ role: 'system', content: systemPrompt }, { role: 'user', content }])
      if (!result.success || !result.content?.trim()) throw new Error(result.error || t('knowledge.searchEmpty'))
      return result.content
    },
    remove: async id => {
      const result = await ipc.invoke('kb:remove-document', id)
      if (!result.success) throw new Error(t('status.unknown'))
    },
  }, source)
}
