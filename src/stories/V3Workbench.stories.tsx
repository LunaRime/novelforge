import type { Meta, StoryObj } from '@storybook/react' // eslint-disable-line storybook/no-renderer-packages
import { BookOpen, Ellipsis, FileText } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import CodeMirrorEditor from '../components/editor/CodeMirrorEditor'
import { Button } from '../components/ui/Button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/Dialog'
import { MenuItem } from '../components/ui/MenuItem'
import MenuRow from '../components/ui/MenuRow'
import { ViewTabs } from '../components/ui/ChoiceControls'
import { useTranslation } from '../hooks/useTranslation'
import './v3-workbench.story.css'

const chapters = [
  { id: 'harbour', title: '雾港来信', readOnly: false, body: '退潮后的石阶露出一条窄缝。林澈蹲下来，从缝里摸到一封湿透的信。\n\n封口的蜡还软，信封却已经浸出一圈盐迹。港钟响了两声，她认出上面是自己的名字。\n\n渡口的最后一盏灯熄了。' },
  { id: 'crossing', title: '渡船离港前的最后一次潮汐观测记录', readOnly: true, body: '船头撞开一片浮木。再回头时，渡口已经消失在雾里。' },
] as const

type ChapterId = typeof chapters[number]['id']
type Mode = 'forge' | 'compose'

const sampleVolumes = [
  { number: 1, chapters: [chapters[0]] },
  { number: 2, chapters: [chapters[1]] },
]

function SampleVolumeNavigation({ selected, onSelect }: { selected: ChapterId; onSelect: (id: ChapterId) => void }) {
  const { t } = useTranslation()
  const id = useId()
  const [expanded, setExpanded] = useState<number[]>([1])

  return sampleVolumes.map(volume => {
    const open = expanded.includes(volume.number)
    const contentId = `${id}-volume-${volume.number}`
    // 卷行只控制展开，当前正文由章节行的稳定 ID 决定。
    return (
      <section key={volume.number}>
        <MenuRow icon={<BookOpen size={14} aria-hidden="true" />} count={volume.chapters.length}
          title={t('volume.ordinal').replace('{n}', String(volume.number))} swap="expand" expanded={open}
          controlsId={contentId} onPrimary={() => setExpanded(previous => previous.includes(volume.number)
            ? previous.filter(number => number !== volume.number) : [...previous, volume.number])} />
        <div id={contentId} className="v3-sample-volume-chapters" hidden={!open}>
          {volume.chapters.map(chapter => (
            <MenuRow key={chapter.id} icon={<FileText size={14} aria-hidden="true" />} title={chapter.title}
              titleHint={chapter.title} swap="nav" active={selected === chapter.id}
              current={selected === chapter.id ? 'page' : undefined} onPrimary={() => onSelect(chapter.id)} />
          ))}
        </div>
      </section>
    )
  })
}

const modes: Array<{ value: Mode; label: string }> = [
  { value: 'forge', label: '构建态' },
  { value: 'compose', label: '写作态' },
]

const versionActions = [
  { id: 'polish', label: 'editor.aiPolishBtn' },
  { id: 'review', label: 'editor.aiReviewBtn' },
  { id: 'finalize', label: 'editor.finalizeBtn' },
] as const

type VersionAction = typeof versionActions[number]

function V3Workbench({ mode: initialMode = 'forge', chapterId = 'harbour', saveFailure = false, dirty = false, showVersionActions = false, showVolumeNavigation = false }: {
  mode?: Mode
  chapterId?: ChapterId
  saveFailure?: boolean
  dirty?: boolean
  showVersionActions?: boolean
  showVolumeNavigation?: boolean
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState(initialMode)
  const [selected, setSelected] = useState(chapterId)
  const [partnerOpen, setPartnerOpen] = useState(true)
  const [tasksByMode, setTasksByMode] = useState({ forge: true, compose: false })
  const [saved, setSaved] = useState<Partial<Record<ChapterId, string>>>({})
  const [drafts, setDrafts] = useState<Partial<Record<ChapterId, string>>>(dirty ? { harbour: `${chapters[0].body}\n\n她把信收进口袋。` } : {})
  const [failedChapter, setFailedChapter] = useState<ChapterId>()
  const [suggestionOpen, setSuggestionOpen] = useState(false)
  const [activeAction, setActiveAction] = useState<VersionAction>()
  const [finalizedChapter, setFinalizedChapter] = useState<ChapterId>()
  const panelId = useId()
  const menuId = `${panelId}-version-actions`
  const menuAnchor = `--v3-version-${panelId.replace(/[^\w-]/g, '')}`
  const menu = useRef<HTMLDivElement>(null)
  const moreButton = useRef<HTMLButtonElement>(null)
  const actionTrigger = useRef<HTMLButtonElement>(null)
  const documentTitle = useRef<HTMLHeadingElement>(null)
  const chapter = chapters.find(item => item.id === selected) ?? chapters[0]
  const title = showVersionActions && chapter.id === 'harbour'
    ? '雾港退潮前的最后一封信与消失的渡口灯塔' : chapter.title
  const body = drafts[chapter.id] ?? saved[chapter.id] ?? chapter.body
  const changed = body !== (saved[chapter.id] ?? chapter.body)
  const readOnly = chapter.readOnly || finalizedChapter === chapter.id
  const tasksOpen = tasksByMode[mode]

  function save(content: string) {
    if (!changed || readOnly) return
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
        <ViewTabs items={modes} value={mode} onChange={setMode} />
        <div className="v3-sample-tools">
          <Button variant="outline" size="sm" aria-expanded={partnerOpen} aria-controls={`${panelId}-partner`}
            onClick={() => setPartnerOpen(current => !current)}>写作搭档</Button>
          <Button variant="outline" size="sm" aria-expanded={tasksOpen} aria-controls={`${panelId}-tasks`}
            onClick={() => setTasksByMode(current => ({ ...current, [mode]: !current[mode] }))}>任务</Button>
        </div>
      </header>
      <nav className="v3-sample-context" aria-label={t('nav.projectTree')} hidden={mode === 'compose'}>
        {/* 写作态隐藏导航，保留当前卷的展开状态供回切时使用。 */}
        {showVolumeNavigation ? <SampleVolumeNavigation selected={selected} onSelect={setSelected} /> : (
          <>
            <h2>第一卷</h2>
            {chapters.map(item => (
              <button type="button" key={item.id} aria-current={selected === item.id ? 'page' : undefined} onClick={() => setSelected(item.id)}>
                {item.title}
              </button>
            ))}
          </>
        )}
      </nav>
      <main className="v3-sample-main">
        <div className="v3-sample-sheet">
          <header className="v3-sample-document">
            <div>
              <h2 ref={documentTitle} tabIndex={-1}>{title}</h2>
              <p aria-live="polite">{readOnly ? t('status.readOnly') : changed ? t('statusbar.unsavedShort') : t('statusbar.saved')}</p>
            </div>
            <div className="v3-sample-tools">
              <Button size="sm" disabled={!changed || readOnly} onClick={() => save(body)}>{t('common.save')}</Button>
              {showVersionActions && !readOnly && (
                <>
                  <div className="v3-sample-version-inline">
                    {versionActions.map(action => (
                      <Button key={action.id} size="sm" variant="outline" disabled={action.id === 'finalize' && changed}
                        onClick={event => { actionTrigger.current = event.currentTarget; setActiveAction(action) }}>
                        {t(action.label)}
                      </Button>
                    ))}
                  </div>
                  <div className="v3-sample-version-overflow">
                    {/* 原生浮层进入顶层，窄窗滚动容器不会裁掉操作项。 */}
                    <Button ref={moreButton} size="icon" variant="outline" popoverTarget={menuId} aria-controls={menuId}
                      aria-label={t('tip.moreOptions')} title={t('tip.moreOptions')} style={{ anchorName: menuAnchor }}>
                      <Ellipsis size={16} aria-hidden="true" />
                    </Button>
                    <div ref={menu} id={menuId} popover="auto" className="floating-menu v3-sample-version-menu"
                      style={{ positionAnchor: menuAnchor }}>
                      {versionActions.map(action => (
                        <MenuItem key={action.id} label={t(action.label)} disabled={action.id === 'finalize' && changed}
                          onClick={() => {
                            actionTrigger.current = moreButton.current
                            menu.current?.hidePopover()
                            setActiveAction(action)
                          }} />
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </header>
          {failedChapter === chapter.id && <p role="alert" className="v3-sample-error">保存失败，输入已保留。</p>}
          <div className="v3-sample-editor" aria-label="正文编辑区" role="region">
            {/* 工作状态只改变区域样式，正文编辑器仅在切换文档时重建。 */}
            <CodeMirrorEditor key={chapter.id} mode="prose" content={body} editable={!readOnly}
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
      <Dialog open={!!activeAction} onOpenChange={open => { if (!open) setActiveAction(undefined) }}>
        <DialogContent className="v3-sample-version-dialog" onCloseAutoFocus={event => {
          event.preventDefault()
          // 定稿或调整宽度可能移除触发按钮，此时焦点回到文档标题。
          const trigger = actionTrigger.current
          if (trigger?.getClientRects().length) trigger.focus()
          else documentTitle.current?.focus()
        }}>
          <DialogHeader>
            <DialogTitle>{activeAction?.id === 'finalize' ? t('dialog.confirmFinalize') : activeAction && t(activeAction.label)}</DialogTitle>
            <DialogDescription>{title}</DialogDescription>
          </DialogHeader>
          {activeAction?.id === 'polish' && <p className="v3-sample-version-preview">{body}{'\n\n她攥紧湿透的来信，望向对岸。'}</p>}
          {activeAction?.id === 'review' && <p className="v3-sample-version-preview">{t('codeEditor.aiPreview')}{'\n渡口最后一盏灯熄灭的时间与港钟响起的时间一致。'}</p>}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" size="sm">{t('common.cancel')}</Button></DialogClose>
            {activeAction?.id === 'finalize' && <DialogClose asChild>
              {/* 定稿只标记已保存的合成稿，方便在样板中核对只读状态。 */}
              <Button size="sm" onClick={() => setFinalizedChapter(chapter.id)}>{t('editor.finalizeBtn')}</Button>
            </DialogClose>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
export const VersionActions: Story = { args: { dirty: true, showVersionActions: true } }
export const VolumeNavigation: Story = { args: { dirty: true, showVolumeNavigation: true } }
