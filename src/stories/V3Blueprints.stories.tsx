import type { Meta, StoryObj } from '@storybook/react' // eslint-disable-line storybook/no-renderer-packages
import { ChevronLeft, FileText } from 'lucide-react'
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '../components/ui/Button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/Dialog'
import MenuRow from '../components/ui/MenuRow'
import { Textarea } from '../components/ui/Textarea'
import { useTranslation } from '../hooks/useTranslation'
import './v3-blueprints.story.css'

const titles = [
  '雾港来信', '白线以内', '刻错的潮汐表', '盐仓里的访客', '无人认领的灯', '临时船票',
  '堤岸两侧', '风向已改', '退潮前的约定', '废弃的钟楼', '余下的航程', '灯塔换岗',
  '黑潮之后', '没有写完的地图', '旧渡轮的回声', '不归之夜', '最后一班船的乘客名单', '最后一次观测记录与潮水退去后仍然亮着的灯塔',
]

const sampleBlueprints = titles.map((title, index) => ({
  chapterNumber: index + 1,
  title,
  purpose: `围绕「${title}」推进林澈寻找寄信人的线索。`,
}))

type Blueprint = typeof sampleBlueprints[number]
type WriteKind = 'one' | 'all' | 'generated'
type PendingWrite = { kind: WriteKind; rows: Blueprint[] }

function V3Blueprints() {
  const { t } = useTranslation()
  const id = useId()
  const [navigation, setNavigation] = useState({ view: 'list', chapterNumber: 1 })
  const [saved, setSaved] = useState(sampleBlueprints)
  const [edits, setEdits] = useState<Partial<Record<number, string>>>({})
  const [pending, setPending] = useState<PendingWrite | null>(null)
  const list = useRef<HTMLElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const nextFocus = useRef<'list' | 'detail' | null>(null)
  const listScroll = useRef(0)
  const writeTrigger = useRef<HTMLButtonElement>(null)
  const selected = saved.find(row => row.chapterNumber === navigation.chapterNumber) ?? saved[0]
  const draft = edits[selected.chapterNumber]
  const changedRows = saved.flatMap(row => {
    const purpose = edits[row.chapterNumber]
    return purpose === undefined ? [] : [{ ...row, purpose }]
  })
  const generatedPurpose = `让「${selected.title}」中的线索来自林澈主动做出的选择，并交代这次选择的代价。`

  // 窄窗切页后恢复列表滚动与焦点，宽窗点选时焦点仍留在列表。
  useLayoutEffect(() => {
    const target = nextFocus.current
    nextFocus.current = null
    if (target === 'list' && list.current) {
      list.current.scrollTop = listScroll.current
      list.current.querySelector<HTMLButtonElement>('button[aria-current="page"]')?.focus({ preventScroll: true })
    }
    if (target === 'detail' && !list.current?.getClientRects().length) title.current?.focus()
  }, [navigation])

  function openDetail(chapterNumber: number) {
    listScroll.current = list.current?.scrollTop ?? 0
    nextFocus.current = 'detail'
    setNavigation({ view: 'detail', chapterNumber })
  }

  function updatePurpose(purpose: string) {
    const chapterNumber = selected.chapterNumber
    setEdits(previous => {
      const next = { ...previous }
      if (purpose === selected.purpose) delete next[chapterNumber]
      else next[chapterNumber] = purpose
      return next
    })
  }

  function previewWrite(trigger: HTMLButtonElement, kind: WriteKind, rows: Blueprint[]) {
    writeTrigger.current = trigger
    setPending({ kind, rows })
  }

  function confirmWrite() {
    if (!pending) return
    const submitted = new Map(pending.rows.map(row => [row.chapterNumber, row]))
    // 模拟回执只确认对话框里展示的快照，其他章节的手动修改仍待保存。
    setSaved(previous => previous.map(row => submitted.get(row.chapterNumber) ?? row))
    setEdits(previous => {
      const next = { ...previous }
      for (const row of submitted.values()) {
        if (next[row.chapterNumber] === row.purpose) delete next[row.chapterNumber]
      }
      return next
    })
    setPending(null)
  }

  return (
    <main className="v3-blueprint-sample" data-view={navigation.view}>
      <header className="v3-blueprint-header">
        <h1>{t('chapter.blueprintTitle')}</h1>
      </header>
      <div className="v3-blueprint-layout">
        <nav ref={list} className="v3-blueprint-list" aria-label={t('chapter.blueprintTitle')}>
          {saved.map(row => (
            <MenuRow key={row.chapterNumber} title={`${row.chapterNumber} ${row.title}`} titleHint={row.title}
              icon={<FileText size={14} aria-hidden="true" />} swap="nav" count={edits[row.chapterNumber] !== undefined ? t('statusbar.unsavedShort') : undefined}
              active={selected.chapterNumber === row.chapterNumber} current={selected.chapterNumber === row.chapterNumber ? 'page' : undefined}
              onPrimary={() => openDetail(row.chapterNumber)} />
          ))}
        </nav>
        <section className="v3-blueprint-detail" aria-labelledby={`${id}-title`}>
          <Button size="sm" variant="outline" className="v3-blueprint-back" onClick={() => {
            nextFocus.current = 'list'
            setNavigation({ view: 'list', chapterNumber: selected.chapterNumber })
          }}><ChevronLeft size={14} aria-hidden="true" />{t('chapter.blueprintTitle')}</Button>
          <div className="v3-blueprint-heading">
            <h2 ref={title} id={`${id}-title`} tabIndex={-1}>{selected.title}</h2>
            <p aria-live="polite">{t(draft === undefined ? 'statusbar.saved' : 'statusbar.unsavedShort')}</p>
          </div>
          <div className="v3-blueprint-field">
            <label htmlFor={`${id}-purpose`}>{t('chapter.purpose')}</label>
            <Textarea ref={field} id={`${id}-purpose`} rows={5} value={draft ?? selected.purpose}
              onChange={event => updatePurpose(event.currentTarget.value)} />
          </div>
          <div className="v3-blueprint-actions">
            <Button size="sm" disabled={draft === undefined} onClick={event => previewWrite(event.currentTarget, 'one', [{ ...selected, purpose: draft ?? selected.purpose }])}>{t('common.save')}</Button>
            <Button size="sm" variant="outline" disabled={changedRows.length === 0} onClick={event => previewWrite(event.currentTarget, 'all', changedRows)}>{t('chapter.saveAll')}</Button>
            <Button size="sm" variant="outline" disabled={draft !== undefined || generatedPurpose === selected.purpose}
              onClick={event => previewWrite(event.currentTarget, 'generated', [{ ...selected, purpose: generatedPurpose }])}>{t('editor.aiPreview')}</Button>
          </div>
        </section>
      </div>
      <Dialog open={pending !== null} onOpenChange={open => { if (!open) setPending(null) }}>
        <DialogContent className="v3-blueprint-dialog" onCloseAutoFocus={event => {
          event.preventDefault()
          // 保存后触发按钮可能禁用，将焦点还给可编辑字段。
          const trigger = writeTrigger.current
          if (trigger && !trigger.disabled) trigger.focus()
          else field.current?.focus()
        }}>
          <DialogHeader>
            <DialogTitle>{t(pending?.kind === 'generated' ? 'editor.aiPreview' : 'dialog.confirmTitle')}</DialogTitle>
            <DialogDescription>{t('chapter.blueprintTitle')}</DialogDescription>
          </DialogHeader>
          <ul className="v3-blueprint-changes">
            {pending?.rows.map(row => (
              <li key={row.chapterNumber}>
                <strong>{row.chapterNumber} {row.title}</strong>
                <p>{row.purpose}</p>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" size="sm">{t('common.cancel')}</Button></DialogClose>
            <Button size="sm" onClick={confirmWrite}>{t(pending?.kind === 'generated' ? 'action.apply' : 'action.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}

const meta = {
  title: 'NovelForge Workbench/V3 Blueprints',
  component: V3Blueprints,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof V3Blueprints>

export default meta
type Story = StoryObj<typeof meta>

export const ListDetail: Story = {}
