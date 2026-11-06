import { createKnowledgeExportApplication, type KnowledgeExportPorts } from '../../core'
import { useProjectStore } from '../../stores/project-store'
import { ipc } from '../ipc-client'

const currentScope: KnowledgeExportPorts['scope'] = () => {
  const { currentProject, projectSession } = useProjectStore.getState()
  return currentProject ? { id: currentProject.id, path: currentProject.path, session: projectSession } : null
}
export function createRendererKnowledgeExportApplication(source = currentScope()) {
  return createKnowledgeExportApplication({
    scope: currentScope,
    title: async chapter => (await ipc.invoke('db:blueprint-get', chapter))?.title,
  }, source)
}
