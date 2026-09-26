/**
 * task — 派发子 agent（C 档第二轮）
 *
 * 薄壳：参数校验 + 归一化；实际编排在 `agent-store.runSubAgentTask`
 * （只有 store 能接触会话、取消控制器与审批卡）。与 `read_project_state` 等同构。
 */
import { t } from '../../../shared/locale'
import { buildAgentTool, toolRegistry } from '../tool-registry'
import { SUBAGENT_CONFIRM_TIMEOUT_MS, SUBAGENT_MAX_MS } from '../subagent/types'

export const taskTool = buildAgentTool({
  name: 'task',
  description: t('tool.taskDesc'),
  source: 'builtin',
  // ⚠️ 工具级超时（C 档第二轮 C1）：派发是**长任务**（子 agent 上限 5 分钟 + 其内部审批卡
  //    另可等 2 分钟），默认全局 30s 会把结论永远切在门外
  timeoutMs: SUBAGENT_MAX_MS + SUBAGENT_CONFIRM_TIMEOUT_MS + 30_000,
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
    // ⚠️ 动态 import（不用顶层静态 import）：`task.tool → agent-store → tools/index → task.tool`
    // 是静态环，在「tools/index 先被求值」的顺序下 `builtinTools` 数组里的 taskTool 会是
    // undefined（registerBuiltinTools 崩在 tool.name 上）。延迟到调用时解析即断开环。
    const { useAgentStore } = await import('../../../stores/agent-store')
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
    // 评审 M2：给的工具名**全部**不存在 → 立即失败。否则白名单的只读交集为空、只剩写工具，
    // 子 agent 被广告一堆它不该用的写工具却看不到任何读工具 —— 白跑一轮还拿不到反馈
    if (tools.length > 0 && tools.every(n => !toolRegistry.get(n))) {
      return {
        success: false,
        content: '',
        error: t('tool.taskUnknownTools')
          .replace('{tools}', tools.join('、'))
          .replace('{available}', toolRegistry.listAll().map(x => x.name).join('、')),
      }
    }
    try {
      const res = await store.runSubAgentTask({
        description,
        prompt: (args.prompt as string | undefined)?.trim(),
        tools: tools.length > 0 ? tools : undefined,
      })
      // 评审 M4：子会话 failed/cancelled → 工具如实报**失败**（spec §3.6：success:false + 原因）；
      // 结论与回放线索仍在文本里（放 error 位，引擎在失败分支注入 error）
      // spec §3.6 末条：产物并入父消息（两条分支都带，父能看到子 agent 改过哪些文件）
      return res.ok
        ? { success: true, content: res.text, artifacts: res.artifacts }
        : { success: false, content: '', error: res.text, artifacts: res.artifacts }
    } catch (e) {
      // 派发失败不静默（模型需知道没派成，才能改道或自己干）
      return { success: false, content: '', error: t('tool.taskFailed').replace('{error}', String(e)) }
    }
  },
})
