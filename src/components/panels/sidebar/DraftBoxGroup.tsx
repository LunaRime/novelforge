import { draftUri } from '../../../services/vela-protocol'
/**
 * DraftBoxGroup — 草稿箱折叠组（含章节分组和单条草稿条目）
 */

import { useState, useEffect, useId, useRef } from 'react'
import { CheckCircle2, Circle, FileText, FolderOpen, Copy, Trash2, FilePen } from 'lucide-react'
import { draftListScope, isDraftListCurrent, useDraftStore, type DraftMeta, type DraftsByChapter } from '../../../stores/draft-store'
import { useProjectStore } from '../../../stores/project-store'
import { captureChapterBlueprintScope, readChapterBlueprintSnapshot } from '../../../services/chapters/chapter-blueprint-adapter'
import { renderLog } from '../../../services/render-logger'
import { globalEventBus } from '../../../shared/event-bus'
import { confirm } from '../../ui/Confirm'
import { toast } from '../../ui/Toast'
import { Button } from '../../ui/Button'
import CountBadge from '../../ui/CountBadge'
import { DRAFT_STATUS_LABEL_KEY, DRAFT_STATUS_COLOR } from '../../../shared/draft-status'
import type { TextKey } from '../../../shared/locale'
import { openDraftById, SidebarRowMenu, showSidebarMenu } from './SidebarShared'
import { useTranslation } from '../../../hooks/useTranslation'
import SidebarGroup from './SidebarGroup'
import { useEditorStore } from '../../../stores/editor-store'
import MenuRow from '../../ui/MenuRow'
import type { ContextMenuEntry } from '../../ui/ContextMenu'
import { useNavigationExpansion } from './navigation-session'

// ===== 草稿箱卡片组 =====

const emptyDrafts: DraftsByChapter = {}

export default function DraftBoxGroup() {
  const scope = useProjectStore(state => state.loading ? null : draftListScope(state))
  const draftsByChapter = useDraftStore(state => state.draftsScope === scope ? state.draftsByChapter : emptyDrafts)
  if (!scope) return null
  return <DraftBoxContent key={scope} scope={scope} draftsByChapter={draftsByChapter} />
}

type DraftAction = (draft: DraftMeta, name: string) => Promise<void>

function DraftBoxContent({ scope, draftsByChapter }: { scope: string; draftsByChapter: DraftsByChapter }) {
  const { t } = useTranslation()
  const pendingArchives = useRef(new Set<number>())

  // 所有章节号排序
  const chapterNums = Object.keys(draftsByChapter)
    .map(Number)
    .sort((a, b) => a - b)

  // 筛选出包含非保留（活跃）草稿的实际章节数
  const activeChapterCount = chapterNums.filter(n =>
    (draftsByChapter[n] || []).some(d => d.status !== 'archived')
  ).length

  const [bpTitleMap, setBpTitleMap] = useState<Record<number, string>>({})
  const chaptersDep = chapterNums.join(',')
  useEffect(() => {
    if (!chaptersDep) return
    const source = captureChapterBlueprintScope()
    if (!source || !isDraftListCurrent(scope)) return
    let request = 0
    const loadTitles = async () => {
      const seq = ++request
      if (!isDraftListCurrent(scope)) return
      try {
        const blueprints = await readChapterBlueprintSnapshot(source)
        if (seq !== request || !isDraftListCurrent(scope)) return
        setBpTitleMap(Object.fromEntries(blueprints.filter(bp => bp.title).map(bp => [bp.chapterNumber, bp.title])))
      } catch (error) {
        if (seq === request && isDraftListCurrent(scope)) renderLog('warn', 'Load:DraftBox', String(error))
      }
    }
    void loadTitles()
    const unsubscribe = globalEventBus.on('REFRESH_RESOURCE', ({ resources }) => {
      if (resources.includes('blueprints') || resources.includes('all')) void loadTitles()
    })
    return () => { ++request; unsubscribe() }
  }, [chaptersDep, scope])

  const openDraft: DraftAction = async (draft, name) => {
    if (isDraftListCurrent(scope)) await openDraftById(draft.id, name)
  }

  const archiveDraft: DraftAction = async (draft, name) => {
    if (draft.status === 'finalized' || draft.status === 'archived' || !isDraftListCurrent(scope)
      || pendingArchives.current.has(draft.id)) return
    pendingArchives.current.add(draft.id)
    try {
      const accepted = await confirm(
        t('draftbox.archiveConfirm').replace('{name}', () => name),
        { title: t('dialog.confirmArchive'), confirmText: t('draftbox.archiveAction'), danger: true }
      )
      if (!accepted || !isDraftListCurrent(scope)) return
      await useDraftStore.getState().archiveDraft(draft.id, draft.chapterNumber, scope)
      if (!isDraftListCurrent(scope)) return
      const message = t('draftbox.archiveSuccess')
      renderLog('info', 'Delete:Draft', message)
      toast.success(message)
    } catch (error) {
      if (!isDraftListCurrent(scope)) return
      const message = t('draftbox.archiveFailed').replace('{error}', () => String(error))
      renderLog('error', 'Delete:Draft', message)
      toast.error(message)
    } finally {
      pendingArchives.current.delete(draft.id)
    }
  }

  return (
    <SidebarGroup
      icon={<FilePen size={12} />}
      title={t('draftbox.title')}
      titleHint={t('tip.draftBox')}
      defaultOpen={false}
      navigationKey="draft-box"
      count={activeChapterCount > 0
        ? <CountBadge value={activeChapterCount} unit={t('unit.chapters')} />
        : undefined}
    >
      {chapterNums.length === 0 ? (
        <div className="text-xs py-1" style={{ paddingLeft: 24, color: 'var(--color-text-muted)' }}>
          {t('draftbox.empty')}
        </div>
      ) : (
        chapterNums.map(chNum => (
          <DraftChapterGroup
            key={chNum}
            chapterNumber={chNum}
            drafts={draftsByChapter[chNum] || []}
            bpTitle={bpTitleMap[chNum]}
            onOpen={openDraft}
            onArchive={archiveDraft}
          />
        ))
      )}
    </SidebarGroup>
  )
}

// ===== 单章草稿分组 =====

function DraftChapterGroup({
  chapterNumber,
  drafts,
  bpTitle,
  onOpen,
  onArchive,
}: {
  chapterNumber: number
  drafts: DraftMeta[]
  bpTitle?: string
  onOpen: DraftAction
  onArchive: DraftAction
}) {
  const { t } = useTranslation()
  const [open, toggle] = useNavigationExpansion(`drafts:${chapterNumber}`)
  const groupId = useId()

  // 将 archived 草稿折叠，只显示活跃草稿（非 archived）
  const activeDrafts = drafts.filter(d => d.status !== 'archived')
  const archivedDrafts = drafts.filter(d => d.status === 'archived')
  const [showArchived, setShowArchived] = useState(false)

  // 已定稿的草稿存在时，章节显示绿色标记
  const hasFinalized = drafts.some(d => d.status === 'finalized')
  const baseTitle = bpTitle || ''
  // 前缀判断与显示用同一语言文案（此前硬编码中文「第{n}章」，英文/俄文界面下匹配不到前缀导致重复）
  const chLabel = t('chapter.label').replace('{n}', String(chapterNumber))
  const displayTitle = baseTitle.startsWith(chLabel) ? baseTitle : (baseTitle ? `${chLabel} ${baseTitle}` : chLabel)

  return (
    <div>
      <MenuRow
        icon={hasFinalized ? <CheckCircle2 size={10} className="shrink-0 text-[var(--color-success)]" />
          : <Circle size={6} className="shrink-0 text-[var(--color-text-muted)]" />}
        title={displayTitle}
        titleHint={displayTitle}
        count={<CountBadge value={activeDrafts.length} unit={t('unit.drafts')} />}
        onPrimary={toggle}
        swap="expand"
        expanded={open}
        controlsId={groupId}
      />
      <div id={groupId} hidden={!open}>
        {open && <>
          {activeDrafts.map(draft => (
            <DraftItem
              key={draftUri(draft.id)}
              draft={draft}
              chapterTitleText={displayTitle}
              onOpen={onOpen}
              onArchive={onArchive}
            />
          ))}

          {/* 显示归档草稿的切换按钮 */}
          {archivedDrafts.length > 0 && (
            <div
              className="flex items-center gap-1 select-none"
              style={{ paddingLeft: 54 }}
            >
              {/* 2026-09-25 重构：切换此前在 `<div onClick>` 上 —— 键盘完全够不到。 */}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowArchived(v => !v)}
                className="h-auto min-h-5 w-full justify-start whitespace-normal px-1.5 py-0.5 text-left text-micro leading-tight text-[var(--color-text-muted)]"
              >
                {showArchived ? t('draftbox.hideArchived') : t('draftbox.showArchived').replace('{n}', String(archivedDrafts.length))}
              </Button>
            </div>
          )}
          {showArchived && archivedDrafts.map(draft => (
            <DraftItem
              key={draftUri(draft.id)}
              draft={draft}
              chapterTitleText={displayTitle}
              onOpen={onOpen}
              onArchive={onArchive}
              archived
            />
          ))}
        </>}
      </div>
    </div>
  )
}

// ===== 单条草稿条目 =====

function DraftItem({
  draft,
  chapterTitleText,
  archived = false,
  onOpen,
  onArchive,
}: {
  draft: DraftMeta
  chapterTitleText: string
  archived?: boolean
  onOpen: DraftAction
  onArchive: DraftAction
}) {
  const { t } = useTranslation()
  const name = `${chapterTitleText} v${draft.version}`
  const openDraft = () => onOpen(draft, name)
  const isFinalized = draft.status === 'finalized'

  const isCurrent = useEditorStore(state => state.activeTabId === `doc:${draft.id}`)
  const status = t(DRAFT_STATUS_LABEL_KEY[draft.status] as TextKey) || draft.status
  const menu: ContextMenuEntry[] = [
    { key: 'open', label: t('action.openDraft'), icon: <FolderOpen size={13} />, onClick: openDraft },
    { key: 'div1', type: 'divider' },
    { key: 'copy-path', label: t('action.copyPath'), icon: <Copy size={13} />,
      onClick: () => navigator.clipboard.writeText(draftUri(draft.id)).catch(() => { }) },
    { key: 'div2', type: 'divider' },
    { key: 'delete', label: t('action.deleteDraft'), icon: <Trash2 size={13} />,
      danger: true, disabled: isFinalized || archived, onClick: () => onArchive(draft, name) },
  ]
  return (
    <div className={archived ? 'pl-4 opacity-60' : 'pl-4'}>
      <MenuRow
        icon={<FileText size={11} className="shrink-0 text-[var(--color-text-muted)]" />}
        title={t('draftbox.label').replace('{version}', String(draft.version))}
        titleHint={t('draftbox.tooltip').replace('{title}', chapterTitleText)
          .replace('{version}', String(draft.version)).replace('{status}', status)}
        count={<span style={{ color: DRAFT_STATUS_COLOR[draft.status] || 'var(--color-text-muted)' }}>{status}</span>}
        onPrimary={openDraft}
        active={isCurrent}
        current={isCurrent ? 'page' : undefined}
        onContextMenu={event => showSidebarMenu(menu, event)}
        actions={<SidebarRowMenu items={menu} />}
      />
    </div>
  )
}
