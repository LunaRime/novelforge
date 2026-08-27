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
import { GitFork, Undo2 } from 'lucide-react'
import { useTranslation } from '../../../hooks/useTranslation'
import type { TextKey } from '../../../shared/locale'
import '../../../styles/agent-tools.css'

interface Props {
  message: AgentMessageType
  /** 从此消息 fork 新分支（v1：所有可见消息均可——CCR 压缩区无 UI 入口，无需禁用态） */
  onFork?: (messageId: string) => void
  /** 回退到该消息（截断后续，可恢复） */
  onRewind?: (messageId: string) => void
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

export default function AgentMessage({ message, onFork, onRewind }: Props) {
  const { t } = useTranslation()
  const { role, content, streaming, toolCalls, artifacts } = message

  // 分支操作区（C1 hover 模式：固定容器 + opacity 过渡，无 display 切换，零布局跳动）
  const actionArea = onFork || onRewind ? (
    <div className="flex items-center gap-0.5 mr-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
      {onFork && (
        <button
          onClick={() => onFork(message.id)}
          className="p-1 rounded hover:opacity-80"
          style={{ color: 'var(--color-text-muted)' }}
          title={t('agent.forkConversation' as TextKey)}
        >
          <GitFork size={12} />
        </button>
      )}
      {onRewind && (
        <button
          onClick={() => onRewind(message.id)}
          className="p-1 rounded hover:opacity-80"
          style={{ color: 'var(--color-text-muted)' }}
          title={t('agent.rewindToHere' as TextKey)}
        >
          <Undo2 size={12} />
        </button>
      )}
    </div>
  ) : null

  if (role === 'user') {
    return (
      <div className="flex justify-end mb-2 group">
        <div
          className="max-w-[88%] px-3 py-2 rounded-2xl text-xs leading-relaxed break-words whitespace-pre-wrap"
          style={{
            backgroundColor: 'rgba(var(--color-accent-rgb), 0.12)',
            border: '1px solid rgba(var(--color-accent-rgb), 0.2)',
            color: 'var(--color-text)',
          }}
        >
          {content}
          {/* 操作区：气泡右下角 */}
          {actionArea && (
            <div className="flex justify-end">{actionArea}</div>
          )}
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

        {/* 操作区：消息左下角（MarkdownContent 之后、toolCalls 之前） */}
        {actionArea}

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
      </div>
    </div>
  )
}
