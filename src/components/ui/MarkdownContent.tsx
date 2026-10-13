import React, { memo, useRef, useState } from 'react'
import { Brain, ChevronRight } from 'lucide-react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { t } from '../../shared/locale'
import { Table, type TableRow } from './Table'

interface MarkdownContentProps {
  content: string
  streaming?: boolean
}

/**
 * Markdown 渲染组件（含 <think> 思考过程折叠支持）
 * 用于 Agent 对话、AI 输出面板的正文格式化显示。
 * memo：流式输出时历史消息 content 不变 → 跳过整段 markdown 解析与 DOM 重建（渲染卡顿主因）。
 *
 * 渲染内核：react-markdown + remark-gfm（GFM 表格/任务列表/删除线/自动链接），
 * 自定义 components 保持既有视觉（代码块/表格/链接/标题/列表/引用）。
 * 不启用 rehype-raw —— 原始 HTML 不渲染（与旧手写实现一致，规避 XSS）。
 */
export default memo(function MarkdownContent({ content, streaming }: MarkdownContentProps) {
  // 解析 <think> 标签：将内容拆分为 [thinking?, ...markdownSegments]
  const segments = parseThinkSegments(content)

  return (
    <div className="assistant-content w-full">
      {segments.map((seg, i) =>
        seg.type === 'think' ? (
          <ThinkingBlock key={`think-${i}`} content={seg.content} streaming={streaming && i === segments.length - 1} />
        ) : (
          <MarkdownBody key={`md-${i}`} content={seg.content} />
        )
      )}
      {streaming && <StreamingCursor />}
    </div>
  )
})

// ===== react-markdown 正文渲染 =====

/** 递归提取 ReactNode 的纯文本（用于表头） */
function extractText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (React.isValidElement(node)) {
    return extractText((node as React.ReactElement<{ children?: React.ReactNode }>).props.children)
  }
  return ''
}

/** 表格适配：react-markdown 的 <table>（thead/tbody）结构 → 既有 Table 组件 */
type ChildEl = React.ReactElement<{ children?: React.ReactNode }>
function MarkdownTableAdapter({ children }: { children?: React.ReactNode }) {
  let headers: string[] = []
  const rows: TableRow[] = []

  React.Children.forEach(children, (section) => {
    if (!React.isValidElement(section)) return
    const sectionEl = section as ChildEl
    if (sectionEl.type === 'thead') {
      const tr = React.Children.toArray(sectionEl.props.children)[0]
      if (React.isValidElement(tr)) {
        const trEl = tr as ChildEl
        headers = React.Children.toArray(trEl.props.children)
          .filter(c => React.isValidElement(c))
          .map(c => extractText((c as ChildEl).props.children))
      }
    } else if (sectionEl.type === 'tbody') {
      React.Children.forEach(sectionEl.props.children, (tr, ri) => {
        if (!React.isValidElement(tr)) return
        const trEl = tr as ChildEl
        const cells = React.Children.toArray(trEl.props.children)
          .filter(c => React.isValidElement(c))
          .map((c, ci) => <React.Fragment key={ci}>{(c as ChildEl).props.children}</React.Fragment>)
        rows.push({ key: String(ri), cells })
      })
    }
  })

  return <Table className="my-2" hoverableRows headers={headers} rows={rows} />
}

/** 行内代码（保留既有视觉） */
function InlineCode({ children }: { children?: React.ReactNode }) {
  return (
    <code
      className="px-1 py-0.5 rounded text-xs font-mono"
      style={{
        backgroundColor: 'var(--color-hover)',
        color: 'var(--color-accent)',
        border: '1px solid var(--color-border)',
      }}
    >
      {children}
    </code>
  )
}

/** 自定义 components：映射 react-markdown 输出到既有视觉 */
const markdownComponents: Components = {
  code({ className, children }) {
    const match = /language-(\w+)/.exec(className || '')
    if (match) {
      return <CodeBlock lang={match[1]} code={String(children ?? '').replace(/\n$/, '')} />
    }
    return <InlineCode>{children}</InlineCode>
  },
  table({ children }) {
    return <MarkdownTableAdapter>{children}</MarkdownTableAdapter>
  },
  a({ href, children }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: 'var(--color-accent)', textDecoration: 'underline' }}
      >
        {children}
      </a>
    )
  },
  h1: ({ children }) => (
    <div className="font-bold mt-3 mb-1 text-base" style={{ color: 'var(--color-text)' }}>{children}</div>
  ),
  h2: ({ children }) => (
    <div className="font-semibold mt-3 mb-1 text-sm" style={{ color: 'var(--color-text)' }}>{children}</div>
  ),
  h3: ({ children }) => (
    <div className="font-semibold mt-3 mb-1 text-sm" style={{ color: 'var(--color-text)' }}>{children}</div>
  ),
  p: ({ children }) => <p className="my-0.5 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-0.5 pl-4 list-disc">{children}</ul>,
  ol: ({ children }) => <ol className="my-0.5 pl-4 list-decimal">{children}</ol>,
  li: ({ children }) => <li className="my-0.5">{children}</li>,
  blockquote: ({ children }) => (
    <div
      className="pl-3 py-0.5 my-1 text-xs italic"
      style={{ borderLeft: '3px solid var(--color-accent)', color: 'var(--color-text-secondary)' }}
    >
      {children}
    </div>
  ),
  hr: () => <hr className="my-2" style={{ borderColor: 'var(--color-border)' }} />,
  strong: ({ children }) => (
    <strong className="font-semibold" style={{ color: 'var(--color-text)' }}>{children}</strong>
  ),
  em: ({ children }) => <em>{children}</em>,
}

/** 用 react-markdown 渲染单段 markdown 正文 */
function MarkdownBody({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {content}
    </ReactMarkdown>
  )
}

// ===== 代码块组件 =====

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const codeRef = useRef<HTMLElement>(null)

  const handleCopy = () => {
    navigator.clipboard.writeText(code).catch(() => {})
  }

  return (
    <div
      className="my-2 rounded-lg overflow-hidden"
      style={{ border: '1px solid var(--color-border)' }}
    >
      {/* 代码块标题栏 */}
      <div
        className="flex items-center justify-between px-3 py-1.5"
        style={{
          backgroundColor: 'var(--color-hover)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <span className="text-micro font-mono" style={{ color: 'var(--color-text-muted)' }}>
          {lang || 'text'}
        </span>
        <button
          onClick={handleCopy}
          className="text-micro px-2 py-0.5 rounded transition-opacity hover:opacity-100 opacity-60"
          style={{ color: 'var(--color-text-secondary)' }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-border)')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          {t('action.copy')}
        </button>
      </div>
      {/* 代码内容 */}
      <pre
        className="p-3 text-xs leading-relaxed font-mono whitespace-pre-wrap break-all"
        style={{
          backgroundColor: 'var(--color-editor-bg)',
          color: 'var(--color-text)',
          margin: 0,
        }}
      >
        <code ref={codeRef}>{code}</code>
      </pre>
    </div>
  )
}

// ===== 流式光标 =====

/** 流式生成时末尾显示的闪烁光标 */
export function StreamingCursor() {
  return (
    <span
      className="inline-block w-[3px] h-3 ml-0.5 rounded align-middle"
      style={{
        backgroundColor: 'var(--color-accent)',
        animation: 'agent-cursor-blink 0.8s ease-in-out infinite',
      }}
    />
  )
}

// ===== ThinkingBlock — 可折叠的思考过程区块 =====

function ThinkingBlock({ content, streaming }: { content: string; streaming?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const trimmed = content.trim()
  if (!trimmed && !streaming) return null

  return (
    <div
      className="my-2 rounded-lg overflow-hidden transition-all duration-200"
      style={{
        border: '1px solid var(--color-border)',
        backgroundColor: 'rgba(var(--color-accent-rgb), 0.03)',
      }}
    >
      {/* 头部：点击可展开/折叠 */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors"
        style={{ color: 'var(--color-text-muted)' }}
        onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
        onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
      >
        <Brain size={13} style={{ color: 'var(--color-accent)', opacity: 0.7 }} />
        <span className="font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {streaming ? t('markdown.thinking') : t('markdown.thoughtProcess')}
        </span>
        {streaming && (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full ml-1"
            style={{
              backgroundColor: 'var(--color-accent)',
              animation: 'tool-pulse 1.2s ease-in-out infinite',
            }}
          />
        )}
        <ChevronRight
          size={12}
          className="ml-auto transition-transform duration-200"
          style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
        />
      </button>

      {/* 内容区（折叠/展开） */}
      {expanded && (
        <div
          className="px-3 pb-2 text-xs leading-relaxed"
          style={{
            color: 'var(--color-text-muted)',
            borderTop: '1px solid var(--color-border)',
            maxHeight: 300,
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {trimmed}
        </div>
      )}
    </div>
  )
}

// ===== <think> 标签解析 =====

interface ContentSegment {
  type: 'think' | 'markdown'
  content: string
}

/**
 * 将内容按 <think>...</think> 标签拆分为段落
 * 支持流式场景下未闭合的 <think> 标签
 */
function parseThinkSegments(content: string): ContentSegment[] {
  const segments: ContentSegment[] = []
  const thinkOpenRegex = /<think>/gi
  const thinkCloseRegex = /<\/think>/gi

  let lastIndex = 0
  let openMatch: RegExpExecArray | null

  while ((openMatch = thinkOpenRegex.exec(content)) !== null) {
    // 提取 <think> 之前的 markdown 内容
    if (openMatch.index > lastIndex) {
      const md = content.slice(lastIndex, openMatch.index).trim()
      if (md) segments.push({ type: 'markdown', content: md })
    }

    // 查找对应的 </think>
    thinkCloseRegex.lastIndex = openMatch.index + openMatch[0].length
    const closeMatch = thinkCloseRegex.exec(content)

    if (closeMatch) {
      // 找到闭合标签
      const thinkContent = content.slice(openMatch.index + openMatch[0].length, closeMatch.index)
      segments.push({ type: 'think', content: thinkContent })
      lastIndex = closeMatch.index + closeMatch[0].length
      thinkOpenRegex.lastIndex = lastIndex
    } else {
      // 未闭合（流式场景）—— 将剩余全部作为思考内容
      const thinkContent = content.slice(openMatch.index + openMatch[0].length)
      segments.push({ type: 'think', content: thinkContent })
      lastIndex = content.length
      break
    }
  }

  // 剩余的 markdown 内容
  if (lastIndex < content.length) {
    const md = content.slice(lastIndex).trim()
    if (md) segments.push({ type: 'markdown', content: md })
  }

  // 如果没有 <think> 标签，直接返回整体
  if (segments.length === 0) {
    segments.push({ type: 'markdown', content })
  }

  return segments
}
