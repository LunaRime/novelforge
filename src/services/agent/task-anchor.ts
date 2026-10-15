/**
 * 任务锚点（S2 / W2）——system 尾部一个 ≤120 tokens 的「当前在做什么」锚点。
 *
 * 解决的问题：压缩批从**最旧**消息累积（`selectCompressionBatch`），而注入端的会话摘要（M1）
 * 只有 300 tokens 且要分给"事实/指令/任务/决策"四节——**正在进行的任务**很容易被压进摘要后
 * 变得模糊。强模型尚可推断，弱模型会直接跑偏或过早收尾（这正是"抬高弱模型下限"的主要抓手）。
 *
 * 设计约束（都是刻意的）：
 * - **每轮重建、不进历史、不参与压缩**：锚点由本轮用户消息 + 最近回执现算，永不进入 messages，
 *   因此不可能被压进摘要；`/clear` 后自然消失（消息已清空）。
 * - **硬上限 120 tokens**：它是"提醒"不是"第二份指令"，不能挤占正文与历史预算。
 * - **只在有真实诉求时出现**：斜杠命令（`/clear`、`/skill`）不建锚点——否则会把命令当任务注入。
 * - **只列失败的副作用回执**作为"未完成"：成功的写入不需要提醒（模型已知），失败的写入才是
 *   "打算做但没做"的可信来源（同 target 只留最新，避免了"失败后又成功"的误报）。
 */
import type { AgentMessage } from '../../stores/agent-store'
import { extractSideEffectReceipts } from './archive-codec'
import { estimateTokens, truncateToTokenBudget } from './token-budget'
import { t } from '../../shared/locale'

/** 锚点总预算（tokens）——超出即截断（它是提醒，不参与降级链的丢弃顺序） */
export const TASK_ANCHOR_BUDGET_TOKENS = 120
/** 用户诉求取首句后的最大字符数（超过则省略号截断） */
const REQUEST_MAX_CHARS = 80
/** 回执扫描窗口（只看最近 N 条消息，避免长会话每轮全量扫描） */
const RECENT_MESSAGE_WINDOW = 30
/** "未完成"最多列几条（多于 3 条说明任务本身已失控，列全反而干扰） */
const PENDING_MAX_ITEMS = 3

/** 取首句：按中英句读切分，压平空白，超长截断 */
function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return ''
  const head = flat.match(/^[^。！？!?]{1,400}/)?.[0]?.trim() ?? flat
  const sentence = head || flat
  return sentence.length > REQUEST_MAX_CHARS ? `${sentence.slice(0, REQUEST_MAX_CHARS)}…` : sentence
}

/** 多步请求的显式标记（2 字以上，避免"再见/并排"这类单字误报；三语各取常用连词） */
const MULTI_STEP_MARKERS = [
  '然后', '接着', '之后', '顺便', '以及', '同时', '并且', '另外', '最后',
  'then', 'after that', 'as well as', 'also',
  'затем', 'потом', 'также',
]
/** 超过这个长度视为复合请求（多半含多个诉求），无需连词也能判定 */
const MULTI_STEP_MIN_CHARS = 60

/**
 * 是否为"多步请求"（W4 弱档未完成自检的触发条件之一）。
 * 刻意保守：只认显式连词或明显偏长的请求——宁可漏判（少数请求不被自检），也不要误判
 * （把"你好"当成多步任务，白白多花一轮）。
 */
export function looksMultiStep(text: string): boolean {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!flat) return false
  if (flat.length >= MULTI_STEP_MIN_CHARS) return true
  const lower = flat.toLowerCase()
  return MULTI_STEP_MARKERS.some(marker => lower.includes(marker))
}

/**
 * 构建任务锚点段；无诉求 / 命令轮 → 返回 `''`（调用方据此不注入、不出现在明细段里）。
 */
export function buildTaskAnchor(opts: {
  /** 本轮用户原文（未经 @ 预取增强——诉求应是用户写的东西） */
  userMessage: string
  /** 会话消息（用于取最近的失败回执；调用方传活跃会话的 messages） */
  messages: readonly AgentMessage[]
}): string {
  const raw = (opts.userMessage ?? '').trim()
  if (!raw || raw.startsWith('/')) return ''
  const request = firstSentence(raw)
  if (!request) return ''

  const pending = extractSideEffectReceipts(opts.messages.slice(-RECENT_MESSAGE_WINDOW))
    .filter(r => r.outcome === 'failed')
    .slice(0, PENDING_MAX_ITEMS)

  const header = t('engine.taskAnchorHeader')
  const note = t('engine.taskAnchorNote')
  const requestPrefix = `- ${t('engine.taskAnchorRequest')}`
  // 分隔符用 ASCII（'、' 是中文标点，en/ru 界面下会出现中文符号）
  const pendingLine = pending.length > 0
    ? `- ${t('engine.taskAnchorPending')}${pending.map(r => `${r.tool} → ${r.target}`).join(', ')}`
    : ''

  // ⚠️ 先给「固定部分」留额，只截**诉求**：整段硬截断会把结尾的「非历史」声明一起切掉，
  //    而那句声明正是防止模型把锚点误当用户新指令的关键——不能是第一个被牺牲的。
  const fixed = [header, pendingLine, note].filter(Boolean).join('\n')
  const requestBudget = Math.max(
    16,
    TASK_ANCHOR_BUDGET_TOKENS - estimateTokens(fixed) - estimateTokens(requestPrefix) - 2,
  )
  let requestText = request
  if (estimateTokens(request) > requestBudget) {
    const cut = truncateToTokenBudget(request, Math.max(8, requestBudget - 2))
    requestText = cut.endsWith('…') ? cut : `${cut}…`
  }

  const lines = [header, `${requestPrefix}${requestText}`]
  if (pendingLine) lines.push(pendingLine)
  lines.push(note)

  const text = lines.join('\n')
  return estimateTokens(text) <= TASK_ANCHOR_BUDGET_TOKENS
    ? text
    : truncateToTokenBudget(text, TASK_ANCHOR_BUDGET_TOKENS)
}
