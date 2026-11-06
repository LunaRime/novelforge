import { createNovelConfigApplication, type NovelConfigScope, type ConfigGenerationSnapshot } from '../../core'
import type { NovelConfig } from '../../shared/ipc-channels'
import { useProjectStore } from '../../stores/project-store'
import { useLLMStore } from '../../stores/llm-store'
import { startWorkflow } from '../workflows/start-workflow'
import { belongsToWorkflowSource } from '../workflows/workflow-source'

const currentScope = (): NovelConfigScope | null => {
  const { currentProject, projectSession } = useProjectStore.getState()
  return currentProject ? { id: currentProject.id, path: currentProject.path, session: projectSession } : null
}
/** Renderer wiring only; all generation application and conflict decisions live in core. */
export function createRendererNovelConfigApplication(source = currentScope()) {
  return createNovelConfigApplication<NovelConfig>({
    scope: currentScope,
    config: () => useProjectStore.getState().currentProject!.novelConfig,
    fieldVersions: () => useProjectStore.getState().configFieldVersions,
    update: patch => useProjectStore.getState().updateNovelConfig(patch),
    save: config => useProjectStore.getState().saveProject(config),
    hasModel: () => !!useLLMStore.getState().defaultModelId,
    ownsRun: belongsToWorkflowSource,
    startWorkflow,
  }, source)
}

export interface NovelConfigGenerationSession {
  application: ReturnType<typeof createRendererNovelConfigApplication>
  snapshot: ConfigGenerationSnapshot<NovelConfig>
}
export function captureNovelConfigGenerationSession(): NovelConfigGenerationSession {
  const application = createRendererNovelConfigApplication()
  return { application, snapshot: application.snapshot() }
}
