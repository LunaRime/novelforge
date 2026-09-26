/**
 * 子 agent 派发（C 档第二轮）——类型与预算常量。
 * 设计依据：`docs/superpowers/specs/2026-09-26-multi-agent-dispatch-design.md`
 */
import type { AgentMessage } from '../../../stores/agent-store'
import type { ToolArtifact } from '../tool-registry'
import type { ToolCallInfo } from '../agent-engine'

export type SubAgentStatus = 'running' | 'completed' | 'failed' | 'cancelled'

/** 派发请求（工具参数归一化后的形状） */
export interface SubAgentTask {
  /** 幂等指纹 —— 同时用作 `SubAgentSession.id`（会话内 taskId→会话一对一，见计划头的实现修正） */
  taskId: string
  description: string
  prompt: string
  /** 委派白名单（引擎级 fail-closed；含只读子集 + 恒在的写工具） */
  allowedTools: string[]
  modelId: string
}

/** 子会话（挂在 `conversation.subSessions`，随归档落盘） */
export interface SubAgentSession {
  id: string
  taskId: string
  description: string
  prompt: string
  allowedTools: string[]
  status: SubAgentStatus
  /** 子转录（与父消息同形状，复用既有渲染；空白起步，不含父历史） */
  messages: AgentMessage[]
  toolCalls: ToolCallInfo[]
  artifacts: ToolArtifact[]
  /** 完整结论（未截断；注入父端的版本另经截断，见 runner.formatSubAgentResult） */
  result: string
  error?: string
  startedAt: number
  endedAt?: number
}

/** 单会话子会话数上限（超出丢最旧） */
export const MAX_SUB_SESSIONS = 20
/** 单子会话转录消息数上限 */
export const MAX_SUBAGENT_MESSAGES = 60
/** 注入父端的结果截断上限 */
export const SUBAGENT_RESULT_MAX_TOKENS = 1200
/** 子 agent 系统提示词预算 */
export const SUBAGENT_PROMPT_BUDGET_TOKENS = 3000
/** 单次派发墙钟上限（超时中断 → failed） */
export const SUBAGENT_MAX_MS = 300_000
/** 父方审批卡超时（到点自动拒绝：无人场不悬挂） */
export const SUBAGENT_CONFIRM_TIMEOUT_MS = 120_000
