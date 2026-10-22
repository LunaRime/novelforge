/**
 * 单条消息渲染组件（升级版）
 *
 * 支持三种渲染模式：
 * - 用户消息：右对齐气泡
 * - 助手消息：左侧 Markdown 风格渲染
 * - Tool 调用：ToolCallBlock / ConfirmCard / ArtifactCard
 */
import { memo } from 'react'
import type { AgentMessage as AgentMessageType } from '../../../stores/agent-store'
import type { ToolCallInfo } from '../../../services/agent/agent-engine'
import MarkdownContent, { StreamingCursor } from '../../ui/MarkdownContent'
import ToolCallBlock from './ToolCallBlock'
import ThinkingCollapse from './ThinkingCollapse'
import ArtifactCard from './ArtifactCard'
import ProcessGroup from './ProcessGroup'
import TurnErrorRow from './TurnErrorRow'
import PlanSteps from './PlanSteps'
// 注：brief 声明使用 ForkRight，实测 lucide-react 1.8.0 无此导出；改用 lucide 规范 fork 图标 GitFork（语义等同「从此分支」）
import { GitFork, Undo2, Copy, ThumbsUp, ThumbsDown } from 'lucide-react'
import { useTranslation } from '../../../hooks/useTranslation'
import { splitMentionRefs } from '../../../services/agent/mention-refs'
import { extractPlanSteps } from '../../../services/agent/plan-steps'
import { openChapterFile } from '../sidebar/SidebarShared'
import { useAgentStore } from '../../../stores/agent-store'
import { formatLocaleTime } from '../../../shared/locale'
import { toast } from '../../ui/Toast'
import '../../../styles/agent-tools.css'

/**
 * 消息操作区单图标按钮统一样式。
 *
 * ⚠️ **2026-10-16 用户裁决：本文件的尺寸改动全部回退**（近 4 周里第三次试改这一处）。
 * 「对话框下面的按钮」不在本次要改的范围内 —— 用户要改的是**历史会话行的选中范围**，
 * 不是消息气泡下面那排按钮。按「用户的裁决 > 通用标准」处理。
 *
 * 现行口径（= 2026-09-22 起的历史形态）：
 * - 尺寸 `22×22`、图标 12px、间距 `gap-0.5`；hover 反馈用 `hover:opacity-70`（不是底色块）；
 * - 与 `card-affordance-standard` §5.2「桌面图标按钮 ≥32×32」**不一致**，属**已裁决的豁免**：
 *   这排按钮是行尾的次级操作、且用户明确要求保持原样。**不要再按标准把它改成 32×32**，
 *   除非用户再次提出（本轮之前已有两次回退记录）。
 */
const ACTION_BTN_SIZE = { width: 22, height: 22 }
const ACTION_BTN = 'flex items-center justify-center rounded cursor-pointer hover:opacity-70'
/** 操作条排布：`gap-0.5`（1.75px）——原样，与按钮 22px 同批 */
const ACTION_BAR = 'flex items-center gap-0.5'

interface Props {
  message: AgentMessageType
  /** 从此消息 fork 新分支（v1：所有可见消息均可——CCR 压缩区无 UI 入口，无需禁用态） */
  onFork?: (messageId: string) => void
  /** 回退到该消息（截断后续，可恢复） */
  onRewind?: (messageId: string) => void
  /** 末条消息禁用回退（F6/D1：无内容可截断——store 静默 no-op，禁用 + 解释性 tooltip 消除无声失败） */
  rewindDisabled?: boolean
}

/**
 * 拆分思考块：匹配 `_思考过程_\n> ...` 前缀（agent-engine 拼装格式），
 * 容错：不匹配则按普通 markdown 处理（thinking=null, rest=content）
 */
function splitThinking(content: string): { thinking: string | null; rest: string } {
  const m = content.match(/^_[^_\n]+_\n>[\s\S]*?(?=\n\n)/)
  if (!m) return { thinking: null, rest: content }
  return { thinking: m[0], rest: content.slice(m[0].length + 2) }
}

/** 交错时间线的一段：正文段 / 工具批（同一 offset 的调用归为一批） */
type TimelineSegment =
  | { kind: 'text'; text: string }
  | { kind: 'tools'; calls: ToolCallInfo[] }

/** 工具批渲染：连续 ≥2 个沿用 ProcessGroup 降噪，单个走 ToolCallBlock 单行 */
function renderToolBatch(calls: ToolCallInfo[]): React.ReactNode {
  if (calls.length >= 2) return <ProcessGroup toolCalls={calls} />
  return calls.map(tc => <ToolCallBlock key={tc.id} toolCall={tc} />)
}

/**
 * 构建「正文段 → 工具批 → 正文段 …」的交错时间线（2026-10-17，对齐 dsh 的 step 排版）。
 *
 * 引擎解析 tool_call 时把当时的正文累计长度写进 `contentOffset`（同轮多个调用相同），
 * 这里按 offset 把调用切成批、插回对应正文段之后 —— 修复旧渲染「全部正文先渲染、
 * 工具卡全堆到底部」导致的多轮 ReAct 内容与工具错位（看起来是一坨文字 + 一坨工具）。
 *
 * 兼容与容错：
 * - 任一调用没有 `contentOffset`（旧归档 / 旧消息）→ 返回 null，调用方保持原有底部布局；
 * - offset 越界（正文经后处理改写、或思考前缀被拆走后变短）→ clamp 到正文长度，
 *   宁可贴底也不把工具卡放到正文前面；
 * - 空的正文片段（trim 后为空）不产出文本段，避免交错布局多出 8px 空档。
 */
function buildTimeline(rest: string, toolCalls: ToolCallInfo[]): TimelineSegment[] | null {
  if (!toolCalls.some(tc => typeof tc.contentOffset === 'number' && Number.isFinite(tc.contentOffset))) {
    return null
  }
  // 按 clamp 后的 offset 分批：同一轮多个调用 offset 相同 → 同一工具批
  const batches = new Map<number, ToolCallInfo[]>()
  const unpositioned: ToolCallInfo[] = []
  for (const tc of toolCalls) {
    const offset = tc.contentOffset
    if (typeof offset !== 'number' || !Number.isFinite(offset)) {
      unpositioned.push(tc)
      continue
    }
    const clamped = Math.min(Math.max(offset, 0), rest.length)
    const batch = batches.get(clamped)
    if (batch) batch.push(tc)
    else batches.set(clamped, [tc])
  }

  const segments: TimelineSegment[] = []
  let cursor = 0
  for (const offset of [...batches.keys()].sort((a, b) => a - b)) {
    const text = rest.slice(cursor, offset)
    if (text.trim()) segments.push({ kind: 'text', text })
    segments.push({ kind: 'tools', calls: batches.get(offset)! })
    cursor = offset
  }
  const tail = rest.slice(cursor)
  if (tail.trim()) segments.push({ kind: 'text', text: tail })
  // 混入的无 offset 调用（理论上仅半新半旧数据）统一落到末尾，不丢调用
  if (unpositioned.length > 0) segments.push({ kind: 'tools', calls: unpositioned })
  return segments
}

/**
 * 渲染用户消息正文：把 `@` 引用切成可点 chip（约束④「上下文引用可点击跳转」）。
 *
 * - 纯解析在 `services/agent/mention-refs.ts`（无 React/store），此处只负责渲染与跳转
 * - chip 用原生 `<button>`（不是 `<span onClick>`）——键盘可达
 * - 跳转复用侧栏既定入口 `openChapterFile`（`SidebarShared.tsx:113`，内部处理 vela://）
 * - ⚠️ 已知限制：`openChapterFile` 按**当前项目**解析相对路径，跨项目会话点 chip 会读不到文件
 *   （会话与当前项目不一致时 `AgentConversation.tsx` 顶部已有提示条）
 */
function renderUserContent(content: string): React.ReactNode {
  const segments = splitMentionRefs(content)
  if (segments.length === 1 && segments[0].kind === 'text') return content
  return segments.map((seg, i) => {
    if (seg.kind === 'text') return <span key={i}>{seg.text}</span>
    return (
      <button
        key={i}
        type="button"
        title={seg.target}
        onClick={() => { void openChapterFile(seg.target, seg.target) }}
        className="inline rounded px-1 cursor-pointer transition-opacity hover:opacity-90"
        style={{
          backgroundColor: 'rgba(var(--color-accent-rgb), 0.18)',
          color: 'var(--color-accent)',
          border: 'none',
          font: 'inherit',
        }}
      >
        {seg.raw}
      </button>
    )
  })
}

/** 复制消息全文（2026-09-22）：成功/失败都给 toast 反馈 */
function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          toast.success(t('tip.copied'))
        } catch {
          toast.error(t('tip.copyFailed'))
        }
      }}
      className={ACTION_BTN}
      style={ACTION_BTN_SIZE}
      title={t('tip.copyMessage')}
    >
      <Copy size={12} />
    </button>
  )
}

/** 满意 / 不满意（2026-09-22）：写入 message.feedback，再点同一档即取消；随会话落盘 */
function FeedbackButtons({ message }: { message: AgentMessageType }) {
  const { t } = useTranslation()
  const setMessageFeedback = useAgentStore(s => s.setMessageFeedback)
  const fb = message.feedback
  return (
    <>
      <button
        type="button"
        onClick={() => setMessageFeedback(message.id, 'up')}
        className={ACTION_BTN}
        style={{ ...ACTION_BTN_SIZE, color: fb === 'up' ? 'var(--color-success)' : 'var(--color-text-muted)' }}
        title={t('agent.feedbackUp')}
      >
        <ThumbsUp size={12} />
      </button>
      <button
        type="button"
        onClick={() => setMessageFeedback(message.id, 'down')}
        className={ACTION_BTN}
        style={{ ...ACTION_BTN_SIZE, color: fb === 'down' ? 'var(--color-error)' : 'var(--color-text-muted)' }}
        title={t('agent.feedbackDown')}
      >
        <ThumbsDown size={12} />
      </button>
    </>
  )
}

export default memo(function AgentMessage({ message, onFork, onRewind, rewindDisabled }: Props) {
  const { t } = useTranslation()
  const { role, content, createdAt, streaming, toolCalls, artifacts, error } = message

  // 分支操作区（2026-09-22：由 hover 显隐改为**持续显示**；
  // 用于用户消息时渲染在气泡**外**，不再嵌在对话卡片里）
  const actionArea = onFork || onRewind ? (
    <div className={`${ACTION_BAR} flex-shrink-0`}>
      {onFork && (
        <button
          type="button"
          onClick={() => onFork(message.id)}
          className={ACTION_BTN}
          style={{ ...ACTION_BTN_SIZE, color: 'var(--color-text-muted)' }}
          title={t('agent.forkConversation')}
        >
          <GitFork size={12} />
        </button>
      )}
      {onRewind && (
        <button
          type="button"
          onClick={() => onRewind(message.id)}
          disabled={rewindDisabled}
          className={ACTION_BTN}
          // 禁用态用内联 opacity/cursor（inline 压过 hover:opacity-70 类，hover 时禁用态不失效）
          style={{ ...ACTION_BTN_SIZE, color: 'var(--color-text-muted)', opacity: rewindDisabled ? 0.4 : undefined, cursor: rewindDisabled ? 'not-allowed' : undefined }}
          title={rewindDisabled ? t('agent.rewindLastMessage') : t('agent.rewindToHere')}
        >
          <Undo2 size={12} />
        </button>
      )}
    </div>
  ) : null

  if (role === 'user') {
    return (
      <div className="mb-3 group" data-role="user" data-layout="log">
        {/* 操作日志式：左对齐、标签 + 正文竖线，不使用聊天气泡 */}
        <div className="mb-1 flex items-center gap-2 text-2xs" style={{ color: 'var(--color-text-muted)' }}>
          <span className="font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t('agent.you')}</span>
          <span className="tabular-nums">{formatLocaleTime(createdAt)}</span>
          <CopyButton text={content} />
        </div>
        <div
          className="text-xs leading-relaxed break-words whitespace-pre-wrap"
          style={{
            borderLeft: '2px solid var(--color-border)',
            paddingLeft: 10,
            color: 'var(--color-text)',
          }}
        >
          {renderUserContent(content)}
        </div>
      </div>
    )
  }

  // 助手消息
  return (
    <div className="flex justify-start mb-2 group">
      <div
        className="max-w-full text-xs leading-relaxed break-words w-full"
        style={{ color: 'var(--color-text)' }}
      >
        {/* Turn 级错误行（线②）：失败回执走专用错误行，不写正文 markdown */}
        {error && <TurnErrorRow message={error.message} code={error.code} />}

        {/* 正文与工具调用（交错时间线，2026-10-17）：
            - 有 contentOffset（引擎按轮写入）→ 按 offset 把工具批插回对应正文段之后（dsh 的 step 节奏）；
            - 旧归档无 offset → 保持原底部布局（全部正文在前后接工具块）；
            - waiting_confirm 的审批卡已接管输入区，由 PendingToolConfirmation 渲染，流内不双渲染 */}
        {!error && (() => {
          const { thinking, rest } = splitThinking(content)
          const processCalls = (toolCalls ?? []).filter(tc => tc.status !== 'waiting_confirm')
          const { steps: planSteps, rest: planRest } = extractPlanSteps(rest, {
            finalize: !streaming && processCalls.some(tc => tc.status === 'completed'),
          })
          const timeline = processCalls.length > 0 ? buildTimeline(planRest, processCalls) : null

          // 交错时间线：正文段与工具批统一 8px（gap-2）节奏，空正文段不占间距
          if (timeline) {
            const lastIndex = timeline.length - 1
            // 光标只跟最后一个正文段走；末段是工具批时在整条时间线尾部补光标
            const cursorAtEnd = streaming && timeline[lastIndex]?.kind !== 'text'
            return (
              <>
                {thinking && <ThinkingCollapse thinking={thinking} streaming={streaming} />}
                <PlanSteps steps={planSteps} />
                <div className="flex flex-col gap-2" data-agent-timeline="interleaved">
                  {timeline.map((seg, i) =>
                    seg.kind === 'text' ? (
                      <MarkdownContent key={`text-${i}`} content={seg.text} streaming={streaming && i === lastIndex} />
                    ) : (
                      <div key={`tools-${i}`}>{renderToolBatch(seg.calls)}</div>
                    )
                  )}
                  {cursorAtEnd && (
                    <span className="inline-flex items-center h-4">
                      <StreamingCursor />
                    </span>
                  )}
                </div>
              </>
            )
          }

          // 旧布局（旧归档无 contentOffset / 无工具调用）
          return (
            <>
              {thinking && <ThinkingCollapse thinking={thinking} streaming={streaming} />}
              <PlanSteps steps={planSteps} />
              {planRest ? (
                <>
                  <MarkdownContent content={planRest} streaming={streaming} />
                </>
              ) : streaming ? (
                <span className="inline-flex items-center h-4">
                  <StreamingCursor />
                </span>
              ) : null}
              {processCalls.length > 0 && (
                <div className="mt-2">{renderToolBatch(processCalls)}</div>
              )}
            </>
          )
        })()}

        {/* 产物卡片列表 */}
        {artifacts && artifacts.length > 0 && (
          <div className="mt-2">
            {artifacts.map((a, i) => (
              <ArtifactCard key={`artifact-${i}`} artifact={a} />
            ))}
          </div>
        )}

        {/* 底部操作区（2026-09-22）：复制 + 满意/不满意 + 分支/回退 ——
            放在整条回复（含工具块与产物卡）的**最下方**，不再夹在正文与工具块之间。
            ⚠️ 2026-10-16 用户裁决：这排按钮**改回原样式**（22×22 + gap-0.5 + hover:opacity-70），
            它不在本次「历史会话行选中范围」的改动范围内 —— 见文件顶部 ACTION_BTN 的注释 */}
        <div className={`mt-1 ${ACTION_BAR}`} style={{ color: 'var(--color-text-muted)' }}>
          <CopyButton text={content} />
          <FeedbackButtons message={message} />
          {actionArea}
        </div>
      </div>
    </div>
  )
})
