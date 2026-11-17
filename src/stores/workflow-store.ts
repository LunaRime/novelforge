import { useStore } from 'zustand'
import { useProjectStore } from './project-store'
import { registerWorkflowSource } from '../services/workflows/workflow-source'
import { renderLog } from '../services/render-logger'
import { ipc } from '../services/ipc-client'
import { sanitizeCheckpointData } from '../services/agent/conversation-recovery'
import { mirrorStepAppend, deleteRunOutput, readStepOutputTail } from '../services/workflow-output'
import { createWorkflowRuntime } from '../services/workflows/workflow-runtime'

export type { CheckpointData, StepStatus, WorkflowStatus, WorkflowStep, WorkflowRun, WorkflowType, StepExecutor, WorkflowContext, StepCallbacks, WorkflowCompleteAction, WorkflowParams, WorkflowDefinition } from '../shared/workflow-types'

const CHECKPOINT_KEY = 'vela-workflow-checkpoint'

const runtime = createWorkflowRuntime({
  project: {
    current: () => {
      const { currentProject, projectSession } = useProjectStore.getState()
      return { id: currentProject?.id ?? null, path: currentProject?.path ?? null, session: projectSession }
    },
    subscribe: listener => useProjectStore.subscribe(listener),
  },
  checkpoint: {
    async read(isCurrent) {
      try {
        if (!isCurrent()) return null
        const result = await ipc.invoke('db:checkpoint-load')
        if (!isCurrent()) return null
        if (result.data) return result.data
        const raw = localStorage.getItem(CHECKPOINT_KEY)
        const legacy = raw ? sanitizeCheckpointData(JSON.parse(raw)) : null
        if (legacy?.activeRuns.length) void ipc.invoke('db:checkpoint-save', legacy).catch(() => {})
        return legacy
      } catch {
        return null
      }
    },
    write: data => { void ipc.invoke('db:checkpoint-save', data).catch(() => {}) },
    clear: explicit => {
      if (explicit) {
        try { localStorage.removeItem(CHECKPOINT_KEY) } catch { /* storage may be disabled */ }
      }
      void ipc.invoke('db:checkpoint-clear').catch(() => {})
    },
  },
  output: { append: mirrorStepAppend, delete: deleteRunOutput, read: readStepOutputTail },
  rehydrate: async () => (await import('../services/workflows/workflow-registry')).rehydrateWorkflow,
  registerSource: registerWorkflowSource,
  emitComplete: event => {
    void import('../shared/event-bus').then(({ globalEventBus }) => globalEventBus.emit('WORKFLOW_COMPLETE', event)).catch(() => {})
  },
  showTasks: () => {
    void import('./layout-store').then(({ useLayoutStore }) => {
      useLayoutStore.getState().openBottomTab('tasks')
      useLayoutStore.getState().openRightPanel('ai-output')
    }).catch(() => {})
  },
  log: (level, message) => renderLog(level, 'Workflow', message),
})

const { store } = runtime
type WorkflowState = ReturnType<typeof store.getState>
function useRuntimeStore(): WorkflowState
function useRuntimeStore<Selection>(selector: (state: WorkflowState) => Selection): Selection
function useRuntimeStore<Selection>(selector?: (state: WorkflowState) => Selection) {
  return useStore(store, selector ?? ((state: WorkflowState) => state as Selection))
}

export const useWorkflowStore = Object.assign(useRuntimeStore, store)
export const executeRunFromIndex = runtime.executeRunFromIndex

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', runtime.persistCheckpoint)
}
