import type { Meta, StoryObj } from '@storybook/react' // eslint-disable-line storybook/no-renderer-packages
import { FileText } from 'lucide-react'
import { memo, useEffect, useId, useState } from 'react'
import CodeMirrorEditor from '../components/editor/CodeMirrorEditor'
import { Button } from '../components/ui/Button'
import MenuRow from '../components/ui/MenuRow'
import { useTranslation } from '../hooks/useTranslation'
import './v3-performance.story.css'

const chapterTitles = ['雾港来信', '港钟响过两次', '退潮前的约定', '渡轮的最后一张船票']
const chapters = Array.from({ length: 1000 }, (_, index) => ({
  number: index + 1,
  title: chapterTitles[index % chapterTitles.length],
}))

const paragraphs = [
  '退潮后的石阶露出一条窄缝。林澈蹲下来，从缝里摸到一封湿透的信。封口的蜡还软，港钟响了两声。',
  '守灯人守在旧门背后，等河面上最后一束光转过去。林澈把手伸进衣袋，摸到了贴着盐粒的信封。',
  '最后一班渡船离岸时，水面只剩一条曲折的白线。有人在对岸招手，她差点以为那是自己的影子。',
]
const excerpt = `${paragraphs.join('\n\n')}\n\n`
const manuscript = excerpt.repeat(Math.ceil(100000 / excerpt.length)).slice(0, 100000)
const messages = Array.from({ length: 499 }, (_, index) => paragraphs[index % paragraphs.length])

const ChapterNavigation = memo(function ChapterNavigation({ selected, onSelect }: {
  selected: number
  onSelect: (chapter: number) => void
}) {
  const { t } = useTranslation()
  return (
    <nav className="v3-load-navigation" aria-label={t('nav.projectTree')}>
      {chapters.map(chapter => (
        <MenuRow key={chapter.number} title={`${chapter.number} ${chapter.title}`} titleHint={chapter.title}
          icon={<FileText size={14} aria-hidden="true" />} swap="nav" active={chapter.number === selected}
          current={chapter.number === selected ? 'page' : undefined} onPrimary={() => onSelect(chapter.number)} />
      ))}
    </nav>
  )
})

const ConversationHistory = memo(function ConversationHistory() {
  return messages.map((text, index) => <p data-history-message key={index}>{text}</p>)
})

function ConversationSample({ id, open }: { id: string; open: boolean }) {
  const { t } = useTranslation()
  const [streaming, setStreaming] = useState(false)
  const [chunks, setChunks] = useState(0)
  // 只保留最近 80 段输出，较长的测量仍会更新末条消息。
  const visibleChunks = Math.min(chunks, 80)
  const output = Array.from({ length: visibleChunks }, (_, index) =>
    paragraphs[(chunks - visibleChunks + index + 1) % paragraphs.length]).join('')

  // 每 150 ms 更新末条消息，历史列表与正文编辑器不订阅这项状态。
  useEffect(() => {
    if (!streaming) return
    const timer = window.setInterval(() => setChunks(previous => previous + 1), 150)
    return () => window.clearInterval(timer)
  }, [streaming])

  return (
    <aside className="v3-load-chat" id={id} hidden={!open} aria-label={t('panel.writingPartner')}>
      <header>
        <h2>{t('panel.writingPartner')}</h2>
        <Button size="sm" variant="outline" aria-pressed={streaming} onClick={() => setStreaming(current => !current)}>
          {t(streaming ? 'action.stop' : 'action.runTest')}
        </Button>
      </header>
      <div className="v3-load-messages">
        <ConversationHistory />
        <p data-stream-message data-chunks={chunks}>{paragraphs[0]}{output}</p>
      </div>
    </aside>
  )
}

function V3Performance() {
  const { t } = useTranslation()
  const chatId = useId()
  const [selected, setSelected] = useState(1)
  const [chatOpen, setChatOpen] = useState(true)
  const [edits, setEdits] = useState<Partial<Record<number, string>>>({})
  const body = edits[selected] ?? (selected === 1 ? manuscript : excerpt)

  return (
    <main className="v3-load-sample" data-chat={chatOpen}>
      <header className="v3-load-header">
        <h1>{chapterTitles[0]}</h1>
        <Button size="sm" variant="outline" aria-expanded={chatOpen} aria-controls={chatId} onClick={() => setChatOpen(current => !current)}>
          {t('panel.writingPartner')}
        </Button>
      </header>
      <div className="v3-load-workspace">
        <ChapterNavigation selected={selected} onSelect={setSelected} />
        <section className="v3-load-sheet" aria-label={t('panel.editor')} data-document-length={body.length}>
          <h2>{selected} {chapters[selected - 1].title}</h2>
          <div className="v3-load-editor">
            {/* 切换搭档面板只影响可用宽度，编辑器按章节身份挂载。 */}
            <CodeMirrorEditor key={selected} mode="prose" content={body}
              onChange={text => setEdits(previous => ({ ...previous, [selected]: text }))} />
          </div>
        </section>
        <ConversationSample id={chatId} open={chatOpen} />
      </div>
    </main>
  )
}

const meta = {
  title: 'NovelForge Workbench/V3 Performance',
  component: V3Performance,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof V3Performance>

export default meta
type Story = StoryObj<typeof meta>

export const LargeProject: Story = {}
