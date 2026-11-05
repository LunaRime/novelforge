import type { ProjectData, FileNode, ModelProfile, LLMResponse } from '../../shared/ipc-channels'
import type { EditorTab } from '../../shared/editor-tab'
import type { AgentConversation } from '../../shared/agent-conversation'
import type { WorkflowRun } from '../../shared/workflow-types'
import type { ModelRouteConfig, CallPurpose } from '../llm/model-router'
import type { RuntimeEvent } from '../../core'

/** Capabilities consumed by the renderer agent. No Zustand state/actions escape this contract. */
export interface AgentRuntimePorts {
  project: {
    current(): ProjectData | null
    files(): FileNode[]
    session(): number
  }
  editor: {
    snapshot(): { tabs: EditorTab[]; activeTabId: string | null }
    openFile(tab: EditorTab): void
  }
  workflows: {
    start(request: import('../../core').WorkflowStartRequest): Promise<import('../../core').WorkflowReceipt>
    snapshot(): { currentRun: WorkflowRun | null; activeRuns: WorkflowRun[]; hasActiveRun(): boolean }
    openOutput(): void
  }
  models: {
    snapshot(): { models: ModelProfile[]; modelRoutes: ModelRouteConfig }
    forPurpose(purpose: CallPurpose): string | null
    generate(messages: Array<{ role: 'user' | 'system' | 'assistant'; content: string }>, modelId?: string, options?: { temperature?: number; priority?: number }): Promise<LLMResponse>
  }
  vectors: {
    snapshot(): { vectorModelEnabled: boolean; vectorModuleEnabled: boolean; canUseEmbeddingAPI(): boolean; isAnyVectorAvailable(): boolean }
  }
  conversation: {
    active(): AgentConversation | null
    replaySubAgent(id: string): string | null
    listSubAgents(): string
    runSubAgentTask(input: { description: string; prompt?: string; tools?: string[] }): Promise<{ text: string; ok: boolean; artifacts?: RuntimeEvent[] }>
  }
  drafts: { chapterNumbers(): number[] }
}

let installed: AgentRuntimePorts | undefined
/** Application composition only; tests may install independent fake capabilities. */
export function installAgentRuntimePorts(ports: AgentRuntimePorts): void { installed = ports }
export function getAgentRuntimePorts(): AgentRuntimePorts {
  if (!installed) throw new Error('Agent runtime ports have not been installed')
  return installed
}

/** Retains the source project identity across asynchronous renderer work. */
export function captureAgentProject(ports: AgentRuntimePorts = getAgentRuntimePorts()) {
  const project = ports.project.current()
  const session = ports.project.session()
  return {
    project,
    isCurrent: () => ports.project.session() === session && ports.project.current()?.path === project?.path,
  }
}
/** Late-bound defaults are only for existing application entry points; factories accept explicit ports. */
export const defaultAgentRuntimePorts: AgentRuntimePorts = {
  get project() { return getAgentRuntimePorts().project },
  get editor() { return getAgentRuntimePorts().editor },
  get workflows() { return getAgentRuntimePorts().workflows },
  get models() { return getAgentRuntimePorts().models },
  get vectors() { return getAgentRuntimePorts().vectors },
  get conversation() { return getAgentRuntimePorts().conversation },
  get drafts() { return getAgentRuntimePorts().drafts },
}
import { createContainer, createRuntime, RuntimeScopeChanged } from '../../core'
import { buildAgentTool } from './tool-registry'
import { t } from '../../shared/locale'

/** Each call owns its dependency container and source-project session. */
export function buildRuntimeAgentTool(ports: AgentRuntimePorts, definition: Parameters<typeof buildAgentTool>[0]) {
  const tool = buildAgentTool(definition)
  return {
    ...tool,
    execute: async (args: Record<string, unknown>) => {
      const runtime = createRuntime(createContainer(ports), () => ({ path: ports.project.current()?.path ?? null, session: ports.project.session() }))
      try { return await runtime.run(async () => tool.execute(args)) }
      catch (error) {
        if (error instanceof RuntimeScopeChanged) return { success: false, content: '', error: t('error.noProject') }
        throw error
      }
    },
  }
}
