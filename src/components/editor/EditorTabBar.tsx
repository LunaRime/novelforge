import { ArrowLeftRight, BookOpen, Brain, ChevronLeft, ChevronRight, ClipboardCheck, FileText, Globe, History, LayoutGrid, List, Satellite, Settings, Users, X } from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useTranslation } from '../../hooks/useTranslation'
import { countUndecided } from '../../services/diff/hunk-model'
import { useEditorStore, type EditorTab } from '../../stores/editor-store'
import { useProjectStore } from '../../stores/project-store'
import { formatBinding, matchesBinding, shortcutBinding } from '../../stores/shortcut-store'
import { Button } from '../ui/Button'
import './document-toolbar.css'
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/Dialog'

/** 按文档类型显示标签图标。 */
function TabIcon({ type }: { type: EditorTab['type'] }) {
  if (type === 'config') return <Settings size={14} />
  if (type === 'character') return <Users size={14} />
  if (type === 'diff') return <ArrowLeftRight size={14} />
  if (type === 'chapter-card') return <BookOpen size={14} />
  if (type === 'world-building') return <Globe size={14} />
  if (type === 'version-history') return <History size={14} />
  if (type === 'manuscript-board') return <LayoutGrid size={14} />
  if (type === 'world-timeline') return <Globe size={14} />
  if (type === 'review-report') return <ClipboardCheck size={14} />
  if (type === 'memory') return <Brain size={14} />
  if (type === 'publication') return <Satellite size={14} />
  return <FileText size={14} />
}

/**
 * Tab 元数据相等比较 —— 供 Tab 条订阅用。
 * Tab 条只渲染 id/name/type/dirty/pinned，与高频变化的 content/originalContent/inlineSession
 * 无关。首次编辑需要更新未保存状态，后续仅正文变化时标签栏不重渲染。
 */
function tabsMetaEqual(a: EditorTab[], b: EditorTab[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x.id !== y.id || x.name !== y.name || x.type !== y.type || x.dirty !== y.dirty || x.pinned !== y.pinned) {
      return false
    }
  }
  return true
}

interface TabCloseRequest {
  projectSession: number
  tabs: EditorTab[]
}

function closeConfirmedTabs(request: TabCloseRequest) {
  const { tabs, closeTab } = useEditorStore.getState()
  // 草稿 ID 可在不同项目中重复。确认期间若项目切换或标签内容变化，需重新发起关闭。
  if (useProjectStore.getState().projectSession !== request.projectSession) return
  if (!request.tabs.every(tab => tabs.includes(tab))) return
  request.tabs.forEach(tab => closeTab(tab.id))
}

/**
 * Tab 条（独立 memo 组件 + 元数据专属订阅）
 *
 * 标签栏通过元数据订阅跳过正文变化。关闭操作从 store 读取最新的正文和建议状态。
 * 激活标签交给编辑区，以便从知识库切回文档视图。
 */
const EditorTabBar = memo(function EditorTabBar({ onActivateTab }: { onActivateTab: (id: string) => void }) {
  const { t } = useTranslation()
  const tabs = useStoreWithEqualityFn(useEditorStore, s => s.tabs, tabsMetaEqual)
  const activeTabId = useEditorStore(s => s.activeTabId)

  const tabBarRef = useRef<HTMLDivElement>(null)
  const activeTabRef = useRef<HTMLDivElement>(null)
  const moreButtonRef = useRef<HTMLButtonElement>(null)

  // ===== 三个点菜单状态 =====
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [closeConfirm, setCloseConfirm] = useState<TabCloseRequest | null>(null)
  // ===== Tab 右键菜单状态 =====
  const [tabMenu, setTabMenu] = useState<{
    tabId: string
    position: { x: number; y: number }
  } | null>(null)
  // 批量确认保留发起时的标签快照，包含干净标签、脏稿和有未决建议的标签。
  const [batchCloseConfirm, setBatchCloseConfirm] = useState<TabCloseRequest | null>(null)

  // Tab 条自动滚动到当前活跃 Tab
  useEffect(() => {
    if (activeTabRef.current && tabBarRef.current) {
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      activeTabRef.current.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion ? 'instant' : 'smooth' })
    }
  }, [activeTabId])

  /** 点击左右箭头时切换到上/下一个 Tab（实时取 tabs，避免闭包旧列表） */
  const switchTab = useCallback((direction: 'left' | 'right') => {
    const { tabs: ts, activeTabId: aid } = useEditorStore.getState()
    if (ts.length === 0) return
    const currentIndex = ts.findIndex(t => t.id === aid)
    let nextIndex: number
    if (direction === 'left') {
      nextIndex = currentIndex <= 0 ? ts.length - 1 : currentIndex - 1
    } else {
      nextIndex = currentIndex >= ts.length - 1 ? 0 : currentIndex + 1
    }
    onActivateTab(ts[nextIndex].id)
  }, [onActivateTab])

  /** 尝试关闭 Tab：未保存修改 → 弹确认；inline 会话有未决建议（不 dirty）→ 二次确认；否则直接关 */
  const tryCloseTab = useCallback(async (tabId: string) => {
    const { tabs: ts, closeTab } = useEditorStore.getState()
    const tab = ts.find(t => t.id === tabId)
    if (!tab || tab.pinned) return
    const request = { projectSession: useProjectStore.getState().projectSession, tabs: [tab] }
    if (tab.dirty) {
      setCloseConfirm(request)
      return
    }
    // M-4：pending 建议未处理但 doc 未变（不 dirty）——静默关闭会丢弃建议
    const unhandled = countUndecided(tab.inlineSession)
    if (unhandled > 0) {
      const { confirm } = await import('../ui/Confirm')
      const ok = await confirm(t('inlineAccept.closeConfirm').replace('{n}', String(unhandled)))
      if (ok) closeConfirmedTabs(request)
      return
    }
    closeTab(tabId)
  }, [t])

  /** 尝试批量关闭 Tab：收集待关闭列表，若有 dirty 或有 inline 未决建议的 tab 则弹确认弹窗 */
  const tryBatchClose = useCallback((tabIds: string[]) => {
    const { tabs: ts, closeTab } = useEditorStore.getState()
    const targets = ts.filter(tab => tabIds.includes(tab.id) && !tab.pinned)
    if (targets.some(tab => tab.dirty || countUndecided(tab.inlineSession) > 0)) {
      setBatchCloseConfirm({ projectSession: useProjectStore.getState().projectSession, tabs: targets })
    } else {
      targets.forEach(tab => closeTab(tab.id))
    }
  }, [])

  // 关闭标签快捷键与按钮共用脏稿和未决建议检查。
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (matchesBinding(e, shortcutBinding('close-tab'))) {
        e.preventDefault()
        const { activeTabId: aid } = useEditorStore.getState()
        if (aid) void tryCloseTab(aid)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [tryCloseTab])

  /** 构建 Tab 右键菜单项 */
  const buildTabMenuItems = (tabId: string): ContextMenuEntry[] => {
    const tab = tabs.find(t => t.id === tabId)
    const tabIndex = tabs.findIndex(t => t.id === tabId)
    const hasOthers = tabs.length > 1
    const hasRight = tabIndex < tabs.length - 1

    return [
      {
        key: 'close',
        label: t('action.close'),
        shortcut: formatBinding(shortcutBinding('close-tab')),
        disabled: tab?.pinned,
        onClick: () => tryCloseTab(tabId),
      },
      {
        key: 'close-others',
        label: t('editor.closeOther'),
        disabled: !hasOthers || tab?.pinned,
        onClick: () => {
          const others = tabs.filter(t => t.id !== tabId && !t.pinned).map(t => t.id)
          tryBatchClose(others)
        },
      },
      {
        key: 'close-right',
        label: t('editor.closeRight'),
        disabled: !hasRight,
        onClick: () => {
          const right = tabs.slice(tabIndex + 1).filter(t => !t.pinned).map(t => t.id)
          tryBatchClose(right)
        },
      },
      { key: 'div1', type: 'divider' as const },
      {
        key: 'close-all',
        label: t('editor.closeAll'),
        danger: true,
        onClick: () => {
          const all = tabs.filter(t => !t.pinned).map(t => t.id)
          tryBatchClose(all)
        },
      },
    ]
  }

  /** 构建三个点菜单项（Tab 操作 + 已打开 Tab 列表） */
  const buildMoreMenuItems = (): ContextMenuEntry[] => {
    const hasActive = !!activeTabId
    const activeTab = tabs.find(t => t.id === activeTabId)
    const activeIndex = tabs.findIndex(t => t.id === activeTabId)
    const hasOthers = tabs.length > 1
    const hasRight = activeIndex < tabs.length - 1

    return [
      {
        key: 'close-current',
        label: t('action.close'),
        shortcut: formatBinding(shortcutBinding('close-tab')),
        disabled: !hasActive || activeTab?.pinned,
        onClick: () => { if (activeTabId) tryCloseTab(activeTabId) },
      },
      {
        key: 'close-others',
        label: t('editor.closeOther'),
        disabled: !hasActive || !hasOthers,
        onClick: () => {
          const others = tabs.filter(t => t.id !== activeTabId && !t.pinned).map(t => t.id)
          tryBatchClose(others)
        },
      },
      {
        key: 'close-right',
        label: t('editor.closeRight'),
        disabled: !hasActive || !hasRight,
        onClick: () => {
          const right = tabs.slice(activeIndex + 1).filter(t => !t.pinned).map(t => t.id)
          tryBatchClose(right)
        },
      },
      { key: 'div-close', type: 'divider' as const },
      {
        key: 'close-all',
        label: t('editor.closeAll'),
        danger: true,
        onClick: () => {
          const all = tabs.filter(t => !t.pinned).map(t => t.id)
          tryBatchClose(all)
        },
      },
      // 已打开的 Tab 列表
      ...(tabs.length > 0 ? [
        { key: 'div-list', type: 'divider' as const } as ContextMenuEntry,
        ...tabs.map(t => ({
          key: `goto-${t.id}`,
          label: t.name,
          icon: t.id === activeTabId
            ? <span style={{ color: 'var(--color-accent)', fontWeight: 'bold' }}>●</span>
            : undefined,
          onClick: () => onActivateTab(t.id),
        })),
      ] : []),
    ]
  }

  return (
    <>
      <div className="nf-editor-tabs">
        <div ref={tabBarRef} className="nf-editor-tab-list" role="tablist" aria-label={t('tip.openEditors')}
          onKeyDown={event => {
            // 方向键只接管标签本身，关闭按钮和其他控件继续使用原生键盘行为。
            const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
            if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'tab' || !keys.includes(event.key)) return
            event.preventDefault()
            const index = tabs.findIndex(tab => tab.id === activeTabId)
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
              : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length
            const target = tabs[next]
            if (!target) return
            onActivateTab(target.id)
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
          }}>
          {tabs.map(tab => {
            const active = tab.id === activeTabId
            const closeLabel = tab.dirty ? t('tip.closeWithoutSaving') : t('action.close')
            return (
              <div key={tab.id} ref={active ? activeTabRef : undefined} className="nf-editor-tab" data-active={active} role="presentation">
                <button type="button" role="tab" aria-selected={active} aria-controls="active-editor-document"
                  tabIndex={active ? 0 : -1} className="nf-editor-tab-select" title={tab.name}
                  onClick={() => onActivateTab(tab.id)}
                  onContextMenu={event => {
                    event.preventDefault()
                    onActivateTab(tab.id)
                    setTabMenu({ tabId: tab.id, position: { x: event.clientX, y: event.clientY } })
                  }}>
                  <TabIcon type={tab.type} />
                  <span className="truncate">{tab.name}</span>
                </button>
                <Button type="button" variant="ghost" size="icon" className="nf-editor-tab-close size-8 shrink-0"
                  data-dirty={Boolean(tab.dirty)} title={closeLabel} aria-label={`${closeLabel} ${tab.name}`}
                  onClick={() => tryCloseTab(tab.id)}>
                  {tab.dirty && <span className="nf-document-dirty w-1.5" aria-hidden="true" />}
                  <X size={11} aria-hidden="true" />
                </Button>
              </div>
            )
          })}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {tabs.length > 1 && <>
            <Button type="button" variant="ghost" size="icon" className="size-8"
              title={t('tip.prevEditor')} aria-label={t('tip.prevEditor')} onClick={() => switchTab('left')}>
              <ChevronLeft size={14} aria-hidden="true" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="size-8"
              title={t('tip.nextEditor')} aria-label={t('tip.nextEditor')} onClick={() => switchTab('right')}>
              <ChevronRight size={14} aria-hidden="true" />
            </Button>
          </>}
          <Button ref={moreButtonRef} type="button" variant="ghost" size="icon" className="size-8"
            title={t('tip.openEditors')} aria-label={t('tip.openEditors')} aria-expanded={moreMenuOpen}
            onClick={() => setMoreMenuOpen(open => !open)}>
            <List size={15} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* Tab 右键菜单 */}
      {tabMenu && (
        <ContextMenu
          items={buildTabMenuItems(tabMenu.tabId)}
          position={tabMenu.position}
          onClose={() => setTabMenu(null)}
        />
      )}

      {/* 三个点菜单（已打开的编辑器列表 + Tab 操作） */}
      {/* eslint-disable-next-line react-hooks/refs */}
      {moreMenuOpen && moreButtonRef.current && (() => {
        const rect = moreButtonRef.current!.getBoundingClientRect()
        return (
          <ContextMenu
            items={buildMoreMenuItems()}
            position={{ x: rect.right - 200, y: rect.bottom + 4 }}
            onClose={() => setMoreMenuOpen(false)}
          />
        )
      })()}

      {/* 关闭未保存 Tab 确认弹窗 */}
      <Dialog
        open={closeConfirm !== null}
        onOpenChange={v => !v && setCloseConfirm(null)}
      >
        <DialogContent preventOutsideClose className="max-w-[380px]">
          <DialogHeader>
            <DialogTitle>{t('dialog.closeUnsaved')}</DialogTitle>
            <DialogDescription>
              {t('editor.fileHasUnsaved') + ' «' + (closeConfirm?.tabs[0]?.name ?? '') + '» ' + t('editor.unsavedWarning')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setCloseConfirm(null)}>
              {t('action.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (closeConfirm) closeConfirmedTabs(closeConfirm)
                setCloseConfirm(null)
              }}
            >
              {t('dialog.confirmDiscard')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 批量关闭未保存 Tab 确认弹窗 */}
      <Dialog
        open={batchCloseConfirm !== null}
        onOpenChange={v => !v && setBatchCloseConfirm(null)}
      >
        <DialogContent preventOutsideClose className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t('dialog.closeMultiple')}</DialogTitle>
            <DialogDescription>
              {(() => {
                const targets = batchCloseConfirm?.tabs ?? []
                const dirtyCount = targets.filter(tab => tab.dirty).length
                const total = targets.length
                return dirtyCount > 0
                  ? (t('editor.closingFiles') + ' ' + total + ' ' + t('unit.items') + ', ' + dirtyCount + ' ' + t('editor.unsavedWarning'))
                  : (t('editor.closingFiles') + ' ' + total + ' ' + t('unit.items') + '.')
              })()}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setBatchCloseConfirm(null)}>
              {t('action.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (batchCloseConfirm) closeConfirmedTabs(batchCloseConfirm)
                setBatchCloseConfirm(null)
              }}
            >
              {t('dialog.confirmDiscardClose')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
})

export default EditorTabBar
