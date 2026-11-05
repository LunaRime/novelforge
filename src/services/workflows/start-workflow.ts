import { startWorkflow as executeStartWorkflow, WorkflowValidationError, WorkflowStartError, type WorkflowStartRequest } from '../../core'
import { createWorkflowStartPort, type WorkflowAdapterOptions } from './workflow-starter'
import { t } from '../../shared/locale'
import { useProjectStore } from '../../stores/project-store'

export { WorkflowStartError }
export type { WorkflowStartRequest }
export type WorkflowStartOptions = Pick<WorkflowAdapterOptions, 'onGenerated'>

/** Shared application entry for UI, tools and intent routing. */
export async function startWorkflow(request: WorkflowStartRequest, options: WorkflowStartOptions = {}) {
  const project = useProjectStore.getState().currentProject
  if (!project) throw new WorkflowStartError('ERR_GUARD', t('error.noProject'))
  const identity = { id: project.id, path: project.path }
  if ('projectPath' in request && request.projectPath !== identity.path) throw new WorkflowStartError('ERR_GUARD', t('error.noProject'))
  const session = useProjectStore.getState().projectSession
  let projectChanged = false
  const unsubscribe = useProjectStore.subscribe(state => {
    const current = state.currentProject
    if (!current || current.id !== identity.id || current.path !== identity.path || state.projectSession !== session) projectChanged = true
  })
  const assertProject = () => {
    const current = useProjectStore.getState().currentProject
    if (projectChanged || !current || current.id !== identity.id || current.path !== identity.path
      || useProjectStore.getState().projectSession !== session) {
      throw new WorkflowStartError('ERR_GUARD', t('error.noProject'))
    }
  }
  const port = createWorkflowStartPort({ onGenerated: options.onGenerated, assertProject })
  // Capture payload before any asynchronous guard, metadata lookup or module import.
  const captured = structuredClone(request)
  try {
    return await executeStartWorkflow(captured, {
      ...port,
      start: (definition, stepByStep) => {
        assertProject()
        return port.start(definition, stepByStep)
      },
    })
  } catch (error) {
    if (!(error instanceof WorkflowValidationError)) throw error
    const message = error.reason === 'range' ? t('tool.wfRangeInvalid')
      : error.reason === 'range-too-large' ? t('tool.wfRangeTooLarge').replace('{max}', '100')
      : error.reason === 'idea' ? t('tool.wfNeedIdea')
      : error.reason === 'draft' ? t('error.prereqNotMet')
      : t('tool.wfUnsupported').replace('{workflow}', request.workflow)
    throw new WorkflowStartError('ERR_GUARD', message)
  } finally {
    unsubscribe()
  }
}
