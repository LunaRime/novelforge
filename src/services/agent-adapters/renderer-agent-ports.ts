import { useProjectStore } from '../../stores/project-store'
import { useEditorStore } from '../../stores/editor-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useLayoutStore } from '../../stores/layout-store'
import { useLLMStore } from '../../stores/llm-store'
import { useVectorConfigStore } from '../../stores/vector-config-store'
import { useAgentStore } from '../../stores/agent-store'
import { useDraftStore } from '../../stores/draft-store'
import { installAgentRuntimePorts, type AgentRuntimePorts } from '../agent/runtime-ports'
import { startWorkflow } from '../workflows/start-workflow'

export function createRendererAgentPorts(): AgentRuntimePorts {
  return {
    project: {
      current: () => useProjectStore.getState().currentProject,
      files: () => useProjectStore.getState().fileTree,
      session: () => useProjectStore.getState().projectSession,
    },
    editor: {
      snapshot: () => { const { tabs, activeTabId } = useEditorStore.getState(); return { tabs, activeTabId } },
      openFile: tab => useEditorStore.getState().openFile(tab),
    },
    workflows: {
      start: request => startWorkflow(request),
      snapshot: () => { const { currentRun, activeRuns, hasActiveRun } = useWorkflowStore.getState(); return { currentRun, activeRuns, hasActiveRun } },
      openOutput: () => useLayoutStore.getState().openRightPanel('ai-output'),
    },
    models: {
      snapshot: () => { const { models, modelRoutes } = useLLMStore.getState(); return { models, modelRoutes } },
      forPurpose: purpose => useLLMStore.getState().getModelForPurpose(purpose),
      generate: (messages, modelId, options) => useLLMStore.getState().generate(messages, modelId, options),
    },
    vectors: {
      snapshot: () => {
        const { vectorModelEnabled, vectorModuleEnabled, canUseEmbeddingAPI, isAnyVectorAvailable } = useVectorConfigStore.getState()
        return { vectorModelEnabled, vectorModuleEnabled, canUseEmbeddingAPI, isAnyVectorAvailable }
      },
    },
    conversation: {
      active: () => useAgentStore.getState().getActiveConversation(),
      replaySubAgent: id => useAgentStore.getState().replaySubAgent(id),
      listSubAgents: () => useAgentStore.getState().listSubAgents(),
      runSubAgentTask: input => useAgentStore.getState().runSubAgentTask(input),
    },
    drafts: { chapterNumbers: () => Object.keys(useDraftStore.getState().draftsByChapter).map(Number) },
  }
}
export function installRendererAgentPorts(): void { installAgentRuntimePorts(createRendererAgentPorts()) }
