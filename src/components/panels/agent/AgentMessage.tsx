/**
 * 单条消息渲染组件（升级版）
 *
 * 支持三种渲染模式：
 * - 用户消息：右对齐气泡
 * - 助手消息：左侧 Markdown 风格渲染
 * - Tool 调用：ToolCallBlock / ConfirmCard / ArtifactCard
 */
import type { AgentMessage as AgentMessageType } from '../../../stores/agent-store'
import MarkdownContent, { StreamingCursor } from '../../ui/MarkdownContent'
import ToolCallBlock from './ToolCallBlock'
import ThinkingCollapse from './ThinkingCollapse'
import ConfirmCard from './ConfirmCard'
import ArtifactCard from './ArtifactCard'
// 注：brief 声明使用 ForkRight，实测 lucide-react 1.8.0 无此导出；改用 lucide 规范 fork 图标 GitFork（语义等同「从此分支」）
import { GitFork, Undo2, Copy, ThumbsUp, ThumbsDown } from 'lucide-react'
import { useTranslation } from '../../../hooks/useTranslation'
import { useAgentStore } from '../../../stores/agent-store'
import { formatLocaleTime } from '../../../shared/locale'
import { toast } from '../../ui/Toast'
import '../../../styles/agent-tools.css'

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

/** 复制消息全文（2026-09-22）：成功/失败都给 toast 反馈 */
function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation()
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          toast.success(t('tip.copied'))
        } catch {
          toast.error(t('tip.copyFailed'))
        }
      }}
      className="p-1 rounded cursor-pointer hover:opacity-70"
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
        onClick={() => setMessageFeedback(message.id, 'up')}
        className="p-1 rounded cursor-pointer hover:opacity-70"
        style={{ color: fb === 'up' ? 'var(--color-success)' : 'var(--color-text-muted)' }}
        title={t('agent.feedbackUp')}
      >
        <ThumbsUp size={12} />
      </button>
      <button
        onClick={() => setMessageFeedback(message.id, 'down')}
        className="p-1 rounded cursor-pointer hover:opacity-70"
        style={{ color: fb === 'down' ? 'var(--color-error)' : 'var(--color-text-muted)' }}
        title={t('agent.feedbackDown')}
      >
        <ThumbsDown size={12} />
      </button>
    </>
  )
}

export default function AgentMessage({ message, onFork, onRewind, rewindDisabled }: Props) {
  const { t } = useTranslation()
  const { role, content, createdAt, streaming, toolCalls, artifacts } = message

  // 分支操作区（2026-09-22：由 hover 显隐改为**持续显示**；
  // 用于用户消息时渲染在气泡**外**，不再嵌在对话卡片里）
  const actionArea = onFork || onRewind ? (
    <div className="flex items-center gap-0.5 flex-shrink-0">
      {onFork && (
        <button
          onClick={() => onFork(message.id)}
          className="p-1 rounded hover:opacity-80"
          style={{ color: 'var(--color-text-muted)' }}
          title={t('agent.forkConversation')}
        >
          <GitFork size={12} />
        </button>
      )}
      {onRewind && (
        <button
          onClick={() => onRewind(message.id)}
          disabled={rewindDisabled}
          className="p-1 rounded hover:opacity-80"
          // 禁用态用内联 opacity/cursor（inline 压过 hover:opacity-80 类，hover 时禁用态不失效）
          style={{ color: 'var(--color-text-muted)', opacity: rewindDisabled ? 0.4 : undefined, cursor: rewindDisabled ? 'not-allowed' : undefined }}
          title={rewindDisabled ? t('agent.rewindLastMessage') : t('agent.rewindToHere')}
        >
          <Undo2 size={12} />
        </button>
      )}
    </div>
  ) : null

  if (role === 'user') {
    return (
      <div className="flex flex-col items-end mb-2 group">
        <div
          /* 2026-09-22 UI 重做：rounded-2xl + px-3/py-2 是"聊天 App"手感，
             窄面板 IDE 里改成 rounded-lg + px-2.5/py-1.5，更紧凑、更工具化 */
          className="max-w-[88%] px-2.5 py-1.5 rounded-lg text-xs leading-relaxed break-words whitespace-pre-wrap"
          style={{
            backgroundColor: 'rgba(var(--color-accent-rgb), 0.12)',
            border: '1px solid rgba(var(--color-accent-rgb), 0.2)',
            color: 'var(--color-text)',
          }}
        >
          {content}
        </div>
        {/* 气泡**下方**一排（右对齐）：发送时间 + 复制 + 分支/回退
            （2026-09-22 用户要求：按钮不在气泡内、改到气泡下方，并补时间与复制） */}
        <div className="mt-0.5 flex items-center gap-0.5 px-0.5 text-[0.62rem]" style={{ color: 'var(--color-text-muted)' }}>
          {/* 用户气泡下方只留「时间 + 复制」（2026-09-22 用户指定）；
              分支 / 回退只在模型回复下方出现 */}
          <span className="mr-0.5 tabular-nums">{formatLocaleTime(createdAt)}</span>
          <CopyButton text={content} />
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
        {/* 文本内容（思考块拆分：默认折叠头部 + 正文 markdown） */}
        {content ? (() => {
          const { thinking, rest } = splitThinking(content)
          return (
            <>
              {thinking && <ThinkingCollapse thinking={thinking} />}
              {rest && <MarkdownContent content={rest} streaming={streaming} />}
            </>
          )
        })() : streaming ? (
          <span className="inline-flex items-center h-4">
            <StreamingCursor />
          </span>
        ) : null}

        {/* Tool 调用区块列表 */}
        {toolCalls && toolCalls.length > 0 && (
          <div className="mt-2">
            {toolCalls.map(tc => (
              tc.status === 'waiting_confirm' ? (
                <ConfirmCard key={tc.id} toolCall={tc} />
              ) : (
                <ToolCallBlock key={tc.id} toolCall={tc} />
              )
            ))}
          </div>
        )}

        {/* 产物卡片列表 */}
        {artifacts && artifacts.length > 0 && (
          <div className="mt-2">
            {artifacts.map((a, i) => (
              <ArtifactCard key={`artifact-${i}`} artifact={a} />
            ))}
          </div>
        )}

        {/* 底部操作区（2026-09-22）：复制 + 满意/不满意 + 分支/回退 ——
            放在整条回复（含工具块与产物卡）的**最下方**，不再夹在正文与工具块之间 */}
        <div className="mt-1 flex items-center gap-0.5" style={{ color: 'var(--color-text-muted)' }}>
          <CopyButton text={content} />
          <FeedbackButtons message={message} />
          {actionArea}
        </div>
      </div>
    </div>
  )
}
