/**
 * task — 派发子 agent（C 档第二轮）
 *
 * 薄壳：参数校验 + 归一化；实际编排在 `agent-store.runSubAgentTask`
 * （只有 store 能接触会话、取消控制器与审批卡）。与 `read_project_state` 等同构。
 */
import { t } from '../../../shared/locale'
import { buildAgentTool } from '../tool-registry'
import { useAgentStore } from '../../../stores/agent-store'

export const taskTool = buildAgentTool({
  name: 'task',
  description: t('tool.taskDesc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      description: { type: 'string', description: t('tool.taskDescription') },
      prompt: { type: 'string', description: t('tool.taskPrompt') },
      tools: { type: 'string', description: t('tool.taskTools') },
      task_id: { type: 'string', description: t('tool.taskId') },
    },
    required: ['description'],
  },
  requiresConfirmation: false,
  execute: async (args) => {
    const store = useAgentStore.getState()
    const taskId = (args.task_id as string | undefined)?.trim()
    if (taskId) {
      const replay = store.replaySubAgent(taskId)
      return replay === null
        ? {
            success: false,
            content: '',
            error: t('tool.taskUnknownId').replace('{id}', taskId).replace('{list}', store.listSubAgents()),
          }
        : { success: true, content: replay }
    }
    const description = (args.description as string | undefined)?.trim()
    if (!description) return { success: false, content: '', error: t('tool.taskNeedDescription') }
    if (!store.getActiveConversation()) return { success: false, content: '', error: t('subagent.noActiveConversation') }
    // ToolInputSchema 不支持数组 → 线上格式是逗号分隔字符串；空/全空白视为「未指定」（用默认白名单）
    const tools = ((args.tools as string | undefined) ?? '').split(',').map(s => s.trim()).filter(Boolean)
    try {
      const text = await store.runSubAgentTask({
        description,
        prompt: (args.prompt as string | undefined)?.trim(),
        tools: tools.length > 0 ? tools : undefined,
      })
      return { success: true, content: text }
    } catch (e) {
      // 派发失败不静默（模型需知道没派成，才能改道或自己干）
      return { success: false, content: '', error: t('tool.taskFailed').replace('{error}', String(e)) }
    }
  },
})
