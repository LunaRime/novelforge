import type { Meta, StoryObj } from '@storybook/react' // eslint-disable-line storybook/no-renderer-packages
import { useId, useState } from 'react'
import CodeMirrorEditor from '../components/editor/CodeMirrorEditor'
import { Button } from '../components/ui/Button'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import './v3-workbench.story.css'

const chapters = [
  { id: 'harbour', title: '雾港来信', readOnly: false, body: '退潮后的石阶露出一条窄缝。林澈蹲下来，从缝里摸到一封湿透的信。\n\n封口的蜡还软，信封却已经浸出一圈盐迹。港钟响了两声，她认出上面是自己的名字。\n\n渡口的最后一盏灯熄了。' },
  { id: 'crossing', title: '渡船离港前的最后一次潮汐观测记录', readOnly: true, body: '船头撞开一片浮木。再回头时，渡口已经消失在雾里。' },
] as const

type ChapterId = typeof chapters[number]['id']
type Mode = 'forge' | 'compose'

const modes: Array<{ value: Mode; label: string }> = [
  { value: 'forge', label: '构建态' },
  { value: 'compose', label: '写作态' },
]

function V3Workbench({ mode: initialMode = 'forge', chapterId = 'harbour', saveFailure = false, dirty = false }: {
  mode?: Mode
  chapterId?: ChapterId
  saveFailure?: boolean
  dirty?: boolean
}) {
  const [mode, setMode] = useState(initialMode)
  const [selected, setSelected] = useState(chapterId)
  const [partnerOpen, setPartnerOpen] = useState(true)
  const [tasksByMode, setTasksByMode] = useState({ forge: true, compose: false })
  const [saved, setSaved] = useState<Partial<Record<ChapterId, string>>>({})
  const [drafts, setDrafts] = useState<Partial<Record<ChapterId, string>>>(dirty ? { harbour: `${chapters[0].body}\n\n她把信收进口袋。` } : {})
  const [failedChapter, setFailedChapter] = useState<ChapterId>()
  const [suggestionOpen, setSuggestionOpen] = useState(false)
  const panelId = useId()
  const chapter = chapters.find(item => item.id === selected) ?? chapters[0]
  const body = drafts[chapter.id] ?? saved[chapter.id] ?? chapter.body
  const changed = body !== (saved[chapter.id] ?? chapter.body)
  const tasksOpen = tasksByMode[mode]

  function save(content: string) {
    if (!changed || chapter.readOnly) return
    // 样板只记录内存中的提交结果，产品的保存与版本校验仍由现有用例负责。
    if (saveFailure) {
      setFailedChapter(chapter.id)
      return
    }
    setSaved(previous => ({ ...previous, [chapter.id]: content }))
    setFailedChapter(undefined)
  }

  return (
    <div className="v3-workbench-sample" data-mode={mode} data-partner={partnerOpen}>
      <header className="v3-sample-header">
        <h1>雾港来信</h1>
        <SegmentedControl items={modes} value={mode} onChange={setMode} />
        <div className="v3-sample-tools">
          <Button variant="outline" size="sm" aria-expanded={partnerOpen} aria-controls={`${panelId}-partner`}
            onClick={() => setPartnerOpen(current => !current)}>写作搭档</Button>
          <Button variant="outline" size="sm" aria-expanded={tasksOpen} aria-controls={`${panelId}-tasks`}
            onClick={() => setTasksByMode(current => ({ ...current, [mode]: !current[mode] }))}>任务</Button>
        </div>
      </header>
      <nav className="v3-sample-context" aria-label="项目章节" hidden={mode === 'compose'}>
        <h2>第一卷</h2>
        {chapters.map(item => (
          <button type="button" key={item.id} aria-current={selected === item.id ? 'page' : undefined} onClick={() => setSelected(item.id)}>
            {item.title}
          </button>
        ))}
      </nav>
      <main className="v3-sample-main">
        <div className="v3-sample-sheet">
          <header className="v3-sample-document">
            <div>
              <h2>{chapter.title}</h2>
              <p aria-live="polite">{chapter.readOnly ? '已定稿，只读' : changed ? '有未保存修改' : '已保存到样本'}</p>
            </div>
            <Button size="sm" disabled={!changed || chapter.readOnly} onClick={() => save(body)}>保存正文</Button>
          </header>
          {failedChapter === chapter.id && <p role="alert" className="v3-sample-error">保存失败，输入已保留。</p>}
          <div className="v3-sample-editor" aria-label="正文编辑区" role="region">
            {/* 工作状态只改变区域样式，正文编辑器仅在切换文档时重建。 */}
            <CodeMirrorEditor key={chapter.id} mode="prose" content={body} editable={!chapter.readOnly}
              onChange={content => setDrafts(previous => ({ ...previous, [chapter.id]: content }))} onSave={save} />
          </div>
        </div>
      </main>
      <aside id={`${panelId}-partner`} className="v3-sample-partner" aria-label="写作搭档" hidden={!partnerOpen}>
        <h2>写作搭档</h2>
        <p>林澈读信前，渡口最后一盏灯熄灭。可以把这处细节留作下一章的线索。</p>
        <Button variant="outline" size="sm" aria-expanded={suggestionOpen}
          onClick={() => setSuggestionOpen(current => !current)}>{suggestionOpen ? '收起建议' : '预览建议'}</Button>
        {suggestionOpen && <blockquote>她还来不及拆信，渡口最后一盏灯便熄了。</blockquote>}
      </aside>
      {/* 两态各自记住任务区开关，并显示同一个运行状态。 */}
      <footer id={`${panelId}-tasks`} className="v3-sample-runtime" hidden={!tasksOpen}>渡口场景连续性检查正在运行</footer>
    </div>
  )
}

const meta = {
  title: 'NovelForge Workbench/V3',
  component: V3Workbench,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof V3Workbench>

export default meta
type Story = StoryObj<typeof meta>

export const Forge: Story = {}
export const Compose: Story = { args: { mode: 'compose' } }
export const ReadOnly: Story = { args: { chapterId: 'crossing' } }
export const SaveFailure: Story = { args: { dirty: true, saveFailure: true } }
