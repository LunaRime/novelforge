import type { ToolCallInfo } from '../services/agent/agent-engine'
import type { RuntimeEvent } from '../core/domain/runtime-event'
import type { ArchivedArtifactCard } from './archived-artifact'
import type { CompressedBatch } from '../services/agent/archive-codec'
import type { SubAgentSession } from '../services/agent/subagent/types'

/** 对话模式：Planning（深度推理）/ Fast（快速执行） */
/** 思考等级（6 级）：quick → swift → balanced → reflective → deep → max */
export type AgentMode = 'quick' | 'swift' | 'balanced' | 'reflective' | 'deep' | 'max'

/** 单条消息 */
export interface AgentMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: number
  /** 是否正在流式生成中 */
  streaming?: boolean
  /** Tool 调用信息（Agent 回复时） */
  toolCalls?: ToolCallInfo[]
  /** 产物列表（Agent 创建/修改的文件、触发的工作流等） */
  artifacts?: RuntimeEvent[]
  legacyArtifacts?: ArchivedArtifactCard[]
  /** 用户反馈（2026-09-22）：对模型回复满意/不满意；再次点击同一档即取消。随会话一起落盘 */
  feedback?: 'up' | 'down'
  /** Turn 级错误（线②）：有值 = 该 assistant 消息是失败回执，渲染为专用错误行 */
  error?: { message: string; code?: string }
}

/** fork/rewind 分支：rewind 归档（可恢复） */
export interface RewoundBranch {
  messageId: string
  messages: AgentMessage[]
  rewoundAt: number
}

/**
 * 本轮**实发口径**观测（P0-1 面板闭环）：预算条明细里「面板 X · 实发 Y」的数据源。
 * 仅内存态（不随 archive 落盘——体积与恢复语义都不值得），切换会话 / 历史变更时清空。
 */
export interface SendObservation {
  /** 实发历史 token（发送前按预算裁剪后的真实值） */
  historySentTokens: number
  /** 同一时刻面板口径的历史 token（裁剪前全量；与实发不等时 UI 分列展示） */
  panelHistoryTokens: number
  /** 前缀记账（与上轮比较；无上轮基线时缺省——首轮不渲染该行） */
  prefix?: { changed: boolean; sharedChars: number }
  at: number
}

/** 单个会话 */
export interface AgentConversation {
  id: string
  /** 会话标题（取自第一条用户消息前 20 个字符） */
  title: string
  messages: AgentMessage[]
  createdAt: number
  updatedAt: number
  /**
   * 会话创建时的模式快照——**仅归档兼容**（旧 archive 仍带此字段），
   * 运行时不再读取：路由与 system prompt 由全局思考等级决定。
   * @deprecated 待旧归档彻底淘汰后移除
   */
  mode?: AgentMode
  /** 当前会话使用的模型 ID（null 表示使用默认） */
  modelId: string | null
  /** 角色试演：绑定的角色名（Agent 以该角色身份回复；无此字段为普通会话） */
  roleplayCharacter?: string
  /** CCR：已压缩批次（保留 2-3 代原文，供压缩卡片展开恢复） */
  compressed?: CompressedBatch[]
  /** CCR：滚动摘要（M1，注入 system 尾部标注节） */
  rollingSummary?: string
  /** C 档第二轮：子 agent 会话（派发转录；随归档落盘，/clear 一并清空） */
  subSessions?: SubAgentSession[]
  /** B7 失效语义：历史已变动，该摘要与当前历史不符 —— 不注入上下文 */
  rollingSummaryInvalidated?: boolean
  /** 创建时项目快照（仅展示与恢复提示，P0 不做按快照注入） */
  projectPath?: string
  projectName?: string
  /** fork 自哪个会话（无此字段为根会话） */
  parentId?: string
  /** fork 起点消息 id（该消息及之前的历史已复制进新会话） */
  forkMessageId?: string
  /** rewind 归档：被截断消息，可 restoreRewound 恢复 */
  rewound?: RewoundBranch[]
  /** 归档（2026-09-22）：默认从历史列表隐藏，可切换显示 */
  archived?: boolean
  /** 置顶（2026-09-22）：排在同工作区（同项目）最前 */
  pinned?: boolean
}

