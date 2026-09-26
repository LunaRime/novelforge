/**
 * 幂等 TaskRef 与子 agent 白名单构造（C 档第二轮）。
 *
 * 指纹复用 `prefix-accounting` 的 FNV-1a 双拼接（同步零依赖）——这里只需要「去重键」强度，
 * 不需要抗碰撞（同会话内描述不同却同指纹的概率可忽略；真撞了也只是复用一次结果）。
 */
import { computePrefixFingerprint } from '../prefix-accounting'
import { toolRegistry } from '../tool-registry'

/**
 * 子 agent 可请求的写工具（恒在白名单内；**每次调用**都要过父方审批，spec §3.4/§3.5）。
 * 它们是「能力边界」的一部分，不是「自动执行面」——白名单给的是**可请求**，审批卡给的是**可执行**。
 */
export const SUBAGENT_WRITE_TOOLS: readonly string[] = [
  'write_file', 'edit_file', 'open_editor', 'start_workflow', 'update_config', 'index_content', 'call_external_api',
]

/** 子 agent 结构性不可见的工具：禁止递归派发 / 省预算（skill 元工具对子任务无价值） */
const SUBAGENT_EXCLUDED_TOOLS: readonly string[] = ['task', 'skill']

/** 工具集归一（集合语义 + 稳定顺序）：顺序不同的同一集合 = 同一指纹 */
const normalizeTools = (tools: string[]): string[] => [...new Set(tools)].sort()

/**
 * 幂等指纹：同会话 + 同描述 + 同工具集 → 同一个 taskId。
 * 拼接用 `\u0000` 分隔（描述里带逗号/空格也不会与工具集合串味）。
 */
export function computeSubAgentTaskRef(conversationId: string, description: string, tools: string[]): string {
  return computePrefixFingerprint(`${conversationId}\u0000${description}\u0000${normalizeTools(tools).join(',')}`)
}

/** 内置只读工具（排除结构性排除项与写工具；MCP / skill 来源不进子 agent 白名单） */
export function subAgentReadOnlyTools(): string[] {
  return toolRegistry.listAll()
    .filter(t => t.source === 'builtin' && t.isReadOnly)
    .map(t => t.name)
    .filter(n => !SUBAGENT_WRITE_TOOLS.includes(n) && !SUBAGENT_EXCLUDED_TOOLS.includes(n))
}

/**
 * 子 agent 白名单 = 内置只读（∩ 请求子集）+ 写工具恒在。
 * ⚠️ 未知名字**忽略但不影响其余**（Review Focus 1：一个坏名字绝不能让白名单退化成全量——
 * 那等于悄悄放大子 agent 的权限面，是 fail-open 事故）。
 */
export function resolveSubAgentTools(requested?: string[]): string[] {
  const readOnly = subAgentReadOnlyTools()
  const picked = requested && requested.length > 0
    ? readOnly.filter(n => requested.includes(n))
    : readOnly
  return normalizeTools([...picked, ...SUBAGENT_WRITE_TOOLS])
}
