import { createKnowledgeMaintenanceApplication, type KnowledgeMaintenancePorts } from '../../core'
import { useProjectStore } from '../../stores/project-store'
import { backfillTokens, backfillVectors, getVectorlessCount } from '../knowledge-service'

const currentScope: KnowledgeMaintenancePorts['scope'] = () => {
  const { currentProject, projectSession } = useProjectStore.getState()
  return currentProject ? { id: currentProject.id, path: currentProject.path, session: projectSession } : null
}

export function createRendererKnowledgeMaintenanceApplication(source = currentScope()) {
  return createKnowledgeMaintenanceApplication({
    scope: currentScope,
    vectorlessCount: getVectorlessCount,
    backfill: kind => kind === 'vectors' ? backfillVectors() : backfillTokens(),
  }, source)
}
