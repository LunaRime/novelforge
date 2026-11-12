import type { ProjectData, FileNode, ModelProfile, LLMResponse, NovelConfig } from '../../shared/ipc-channels'
import type { EditorTab } from '../../shared/editor-tab'
import type { AgentConversation } from '../../shared/agent-conversation'
import type { WorkflowRun } from '../../shared/workflow-types'
import type { ModelRouteConfig, CallPurpose } from '../llm/model-router'
import type { NovelConfigScope, RuntimeEvent } from '../../core'
import type { ipc } from '../ipc-client'
import type { ForeshadowingItem } from '../foreshadowing-manager'
import type { skillRegistry } from './skill-registry'

/** Capabilities consumed by the renderer agent. No Zustand state/actions escape this contract. */
export interface AgentRuntimePorts {
  tools: Pick<ReturnType<typeof createToolRegistry>, 'get' | 'listAll' | 'generateToolPrompt'>
  skills?: Pick<typeof skillRegistry, 'get' | 'listAll'>
  io: Pick<typeof ipc, 'invoke'> & {
    readVirtualFile(path: string): Promise<string>
    loadForeshadowing(): Promise<ForeshadowingItem[]>
  }
  project: {
    current(): ProjectData | null
    files(): FileNode[]
    session(): number
    updateConfig(source: NovelConfigScope, patch: Partial<NovelConfig>): Promise<void>
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
  const projectPort = resolveAgentPorts(ports).project
  const project = projectPort.current()
  const id = project?.id
  const path = project?.path
  const session = projectPort.session()
  return {
    project,
    isCurrent: () => {
      const current = projectPort.current()
      return projectPort.session() === session && current?.id === id && current?.path === path
    },
  }
}
/** Late-bound defaults are only for existing application entry points; factories accept explicit ports. */
export const defaultAgentRuntimePorts: AgentRuntimePorts = {
  get tools() { return getAgentRuntimePorts().tools },
  get skills() { return getAgentRuntimePorts().skills },
  get io() { return getAgentRuntimePorts().io },
  get project() { return getAgentRuntimePorts().project },
  get editor() { return getAgentRuntimePorts().editor },
  get workflows() { return getAgentRuntimePorts().workflows },
  get models() { return getAgentRuntimePorts().models },
  get vectors() { return getAgentRuntimePorts().vectors },
  get conversation() { return getAgentRuntimePorts().conversation },
  get drafts() { return getAgentRuntimePorts().drafts },
}
import { createContainer, createRuntime, RuntimeScopeChanged } from '../../core'
import { buildAgentTool, type AgentTool, type createToolRegistry } from './tool-registry'
import { t } from '../../shared/locale'

function resolveAgentPorts(ports: AgentRuntimePorts): AgentRuntimePorts {
  return ports === defaultAgentRuntimePorts ? getAgentRuntimePorts() : ports
}

export function scopedAgentInvoke(runtime: AgentRuntimePorts): typeof ipc.invoke {
  const source = captureAgentProject(runtime)
  return (channel, ...args) => {
    if (!source.isCurrent()) return Promise.reject(new RuntimeScopeChanged())
    return runtime.io.invoke(channel, ...args)
  }
}

/** Each call owns its dependency container and source-project session. */
export function buildRuntimeAgentTool(
  configuredPorts: AgentRuntimePorts,
  definition: Omit<Parameters<typeof buildAgentTool>[0], 'execute'> & {
    execute(args: Record<string, unknown>, ports: Readonly<AgentRuntimePorts>): ReturnType<AgentTool['execute']>
  },
): AgentTool {
  return buildAgentTool({
    ...definition,
    execute: async (args, instance) => {
      const resolved = configuredPorts === defaultAgentRuntimePorts && instance ? instance : resolveAgentPorts(configuredPorts)
      const source = captureAgentProject(resolved)
      const assertCurrent = () => { if (!source.isCurrent()) throw new RuntimeScopeChanged() }
      const io = resolved.io
      const ports = createContainer({
        ...resolved,
        io: io && {
          invoke: (channel, ...args) => { assertCurrent(); return io.invoke(channel, ...args) },
          readVirtualFile: path => { assertCurrent(); return io.readVirtualFile(path) },
          loadForeshadowing: () => { assertCurrent(); return io.loadForeshadowing() },
        } satisfies AgentRuntimePorts['io'],
      })
      const runtime = createRuntime(ports, () => ({ path: ports.project.current()?.path ?? null, session: ports.project.session() }))
      try {
        return await runtime.run(async context => {
          const result = await definition.execute(args, context.ports)
          assertCurrent()
          return result
        })
      }
      catch (error) {
        if (error instanceof RuntimeScopeChanged) return { success: false, content: '', error: t('error.noProject') }
        throw error
      }
    },
  })
}
