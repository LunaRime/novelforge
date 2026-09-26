import type { AgentMessage, AgentConversation, RewoundBranch } from '../../stores/agent-store'
import { toolRegistry } from './tool-registry'
import { estimateTokens } from './token-budget'
import { sanitizeMessageList } from './conversation-recovery'
import { computePrefixFingerprint } from './prefix-accounting'
import { MAX_SUB_SESSIONS, MAX_SUBAGENT_MESSAGES, type SubAgentSession } from './subagent/types'
import { t } from '../../shared/locale'

export interface CompressedBatch {
  batch: number
  /** ⚠️ 兼容旧档案：旧档案的原文内联于此；新档案恒为 `[]`（原文在分卷文件里） */
  original: AgentMessage[]
  summary: string
  compressedAt: number
  originalTokens: number
  /** 原文字节数（分卷内该批次的体量；0 = 分卷不可用） */
  originalBytes?: number
  /** 原文消息条数（原文不再内联，卡片"已折叠 N 条历史"用它；旧档案回落到 original.length） */
  originalCount?: number
  /** 原文可在分卷中恢复（展开原文 / 重生成摘要的前提） */
  recoverable?: boolean
  /** 真实降幅（面板展示；旧档案无此字段时回落到 originalTokens - estimateTokens(summary)） */
  beforeTokens?: number
  afterTokens?: number
  changeTokens?: number
  /** 产物依赖的历史指纹（历史变更后失配 → invalidated） */
  dependencyHash?: string
  invalidated?: boolean
}

/**
 * 会话依赖指纹（B7）：压缩产物（摘要/批次）是基于**当时的非 system 历史**生成的。
 * 历史变更（rewind / 恢复原文 / 编辑消息）后重算比对，失配即标 `invalidated` —— 失效产物**不注入**上下文。
 */
export function computeConversationDependencyHash(conv: { messages: AgentMessage[] }): string {
  const ids = conv.messages.filter(m => m.role !== 'system').map(m => m.id)
  return computePrefixFingerprint(ids.join('|'))
}

/** 副作用回执（B5）：随压缩保留，供后续轮次核对"这批做过什么" */
export interface SideEffectReceipt {
  tool: string
  target: string
  outcome: 'ok' | 'failed'
  artifactPaths: string[]
}

/** 回执上限：条数与字节（超出丢最旧） */
const RECEIPT_MAX_ITEMS = 32
const RECEIPT_MAX_BYTES = 32 * 1024

/**
 * 从被压缩的消息里抽副作用回执。
 * - 只抽**已结束**的工具调用（pending/running 没有结论）
 * - **同 target 只留最新** —— 防重放的核心：旧回执会让模型以为写入还没发生
 * - 上限 32 条 / 32KB，超出丢最旧
 */
export function extractSideEffectReceipts(messages: AgentMessage[]): SideEffectReceipt[] {
  const byKey = new Map<string, SideEffectReceipt>()
  for (const m of messages) {
    for (const tc of m.toolCalls ?? []) {
      if (tc.status !== 'completed' && tc.status !== 'failed') continue
      // 只抽**有副作用**的工具（评审 I5）：否则一批 40 次 read_file 会把
      // 真正的写入回执挤出 32 条上限。未知工具保守跳过。
      const tool = toolRegistry.get(tc.toolName)
      if (tool?.isReadOnly !== false) continue

      const args = (tc.arguments ?? {}) as Record<string, unknown>
      const target = String(args.file_path ?? args.path ?? tc.toolName)
      const artifactPaths = (m.artifacts ?? [])
        .map(a => (a as { path?: string }).path)
        .filter((p): p is string => typeof p === 'string' && p.length > 0)
      // 去重键用 **target**（不含工具名）：`write_file f` 后再 `edit_file f` 是同一条
      // 最终态，两条并存会让模型以为写入还没发生（评审 I5：防重放核心）
      byKey.set(target, {
        tool: tc.toolName,
        target,
        outcome: tc.status === 'failed' ? 'failed' : 'ok',
        artifactPaths: [...new Set(artifactPaths)],
      })
    }
  }
  const capped: SideEffectReceipt[] = []
  let bytes = 0
  for (const receipt of [...byKey.values()].slice(-RECEIPT_MAX_ITEMS)) {
    const size = JSON.stringify(receipt).length
    if (bytes + size > RECEIPT_MAX_BYTES) break
    capped.push(receipt)
    bytes += size
  }
  return capped
}

/**
 * CCR 压缩批次选择：从最旧消息累积进 batch，rest 保留最新消息直到预算。
 * 保证：非 system 消息顺序不变（batch 在前 rest 在后拼接 = 原序）；rest 至少 1 条；
 * system 消息永不进入 batch（预算耗尽未及遍历时从 batch 移回 rest 头部）。
 */
export function selectCompressionBatch(
  messages: AgentMessage[],
  budgetTokens: number,
): { batch: AgentMessage[]; rest: AgentMessage[] } {
  const rest: AgentMessage[] = []
  let used = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'system') {
      rest.unshift(m)
      continue
    }
    const t = estimateTokens(m.content)
    if (rest.length > 0 && used + t > budgetTokens) break
    rest.unshift(m)
    used += t
  }
  const batch = messages.slice(0, messages.length - rest.length)
  // system 永不进入 batch：预算耗尽提前 break 时，把 batch 中的 system 移回 rest 头部
  const sysFromBatch = batch.filter(m => m.role === 'system')
  if (sysFromBatch.length > 0) {
    rest.unshift(...sysFromBatch)
    return { batch: batch.filter(m => m.role !== 'system'), rest }
  }
  return { batch, rest }
}

/** 序列化为 JSON 字符串（UTF-8 写盘由调用方保证） */
export function serializeArchive(conv: AgentConversation): string {
  return JSON.stringify(conv, null, 2)
}

/**
 * 解析 archive 文件；损坏 JSON 返回 null；缺字段降级默认；手改/损坏形状逐条防御（messages/compressed/rewound）。
 * 解析后追加会话恢复净化（conversation-recovery）：崩溃残片（tool/think 标签、空白占位、陈旧 streaming）
 * 在恢复时清理；正常归档零改动（净化只命中残片形态——正常写入链已在落盘前全量清洗）。
 */
export function parseArchive(raw: string): AgentConversation | null {
  try {
    const data = JSON.parse(raw) as Partial<AgentConversation>
    if (!data || typeof data.id !== 'string' || typeof data.title !== 'string') return null
    // ⚠️ P0 修复：手改/损坏归档的形状防御——messages 逐条校验 content 字符串
    //    （非法条过滤，防止渲染层 m.content 崩溃）；compressed 条目 original
    //    非数组时置空（CompressedBatchCard 展开依赖 original.length/map）
    const messages: AgentMessage[] = Array.isArray(data.messages)
      ? data.messages.filter(
          m => !!m && typeof m === 'object' && typeof (m as { content?: unknown }).content === 'string'
        )
      : []
    const compressed: CompressedBatch[] = Array.isArray(data.compressed)
      ? (data.compressed as unknown as CompressedBatch[])
          .filter(b => !!b && typeof b === 'object' && typeof b.summary === 'string')
          .map(b => ({
            ...b,
            original: Array.isArray(b.original)
              ? b.original.filter(
                  m => !!m && typeof m === 'object' && typeof (m as { content?: unknown }).content === 'string'
                )
              : [],
          }))
      : []
    // ⚠️ F5 防御（同 messages/compressed 模式）：rewound 逐条形状校验——messageId 字符串 + messages
    //    数组，否则整条过滤（损坏 arch 的 restoreRewound 对 spread undefined 会 throw）；
    //    条目内 messages 再逐条过滤 content 字符串
    const rewound: RewoundBranch[] = Array.isArray(data.rewound)
      ? (data.rewound as unknown as RewoundBranch[])
          .filter(e => !!e && typeof e === 'object'
            && typeof (e as { messageId?: unknown }).messageId === 'string'
            && Array.isArray((e as { messages?: unknown }).messages))
          .map(e => ({
            ...e,
            messages: (e.messages as unknown as AgentMessage[]).filter(
              m => !!m && typeof m === 'object' && typeof (m as { content?: unknown }).content === 'string'
            ),
          }))
      : []
    // C 档第二轮：子会话（形状防御 + 净化 + 上限裁剪，同 messages/compressed/rewound 模式）
    const subSessions: SubAgentSession[] = Array.isArray(data.subSessions)
      ? (data.subSessions as unknown as SubAgentSession[])
          .filter(s => !!s && typeof s === 'object' && typeof (s as { id?: unknown }).id === 'string'
            && Array.isArray((s as { messages?: unknown }).messages))
          .map(s => ({
            ...s,
            // 评审 I4：半途崩溃/退出留下的 running 归一为 cancelled —— 否则重启后卡片永远
            // 「执行中」（取消按钮点了没反应，activeSubAgents 重启后为空），且幂等检查会
            // 永久返回「该子任务已在执行中」= 这个子任务在本会话里再也跑不了
            status: s.status === 'running' ? 'cancelled' : s.status,
            error: s.status === 'running' ? t('subagent.interrupted') : s.error,
            toolCalls: Array.isArray(s.toolCalls) ? s.toolCalls : [],
            artifacts: Array.isArray(s.artifacts) ? s.artifacts : [],
            allowedTools: Array.isArray(s.allowedTools) ? s.allowedTools : [],
            result: typeof s.result === 'string' ? s.result : '',
            messages: sanitizeMessageList(s.messages).slice(-MAX_SUBAGENT_MESSAGES),
          }))
          .sort((a, b) => b.startedAt - a.startedAt)
          .slice(0, MAX_SUB_SESSIONS)
      : []
    // C4 会话恢复净化：形状防御之后再净化（四处消息数组同口径——CC §三.8 对齐）
    return {
      ...data,
      messages: sanitizeMessageList(messages),
      compressed: compressed.map(b => ({ ...b, original: sanitizeMessageList(b.original) })),
      rewound: rewound.map(e => ({ ...e, messages: sanitizeMessageList(e.messages) })),
      subSessions,
    } as AgentConversation
  } catch {
    return null
  }
}
