import { CreateIcon } from '../ui/ActionIcons'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Bot, BookOpen, Brain, ChevronRight, Globe, FilePlus2, FolderOpen, Focus,
  Gauge, History, Import, Keyboard, LayoutGrid, Maximize2, Minus, PanelBottom,
  PanelLeft, Search, Settings2, Sparkles, Sun, Terminal, TextCursorInput,
  Palette, Users, Wand2, X, ZoomIn,
} from 'lucide-react'
import { useCommandStore } from '../../stores/command-store'
import { useLayoutStore, type SidebarView } from '../../stores/layout-store'
import { useEditorStore } from '../../stores/editor-store'
import { useEditorPrefsStore } from '../../stores/editor-prefs-store'
import { useThemeStore, type Theme } from '../../stores/theme-store'
import { useTranslation } from '../../hooks/useTranslation'
import { ipc } from '../../services/ipc-client'
import { SHORTCUT_DEFINITIONS, formatBinding, shortcutBinding, useShortcutStore } from '../../stores/shortcut-store'
import { useDevConsoleStore } from '../../stores/dev-console-store'
import { focusWorkbenchEditor } from '../../lib/workbench-focus'
import { Button } from '../ui/Button'
import './command-palette.css'

interface CommandItem {
  id: string
  label: string
  category: string
  shortcut?: string
  icon: ReactNode
  keywords?: string
  run: () => void
}

interface ShortcutItem {
  id: string
  label: string
  shortcut: string
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="nf-command-key">{children}</kbd>
}

function openVersionHistory(name: string) {
  const store = useEditorStore.getState()
  const existing = store.tabs.find((tab) => tab.type === 'version-history')
  if (existing) {
    store.setActiveTab(existing.id)
    return
  }
  store.openFile({ id: 'version-history', name, type: 'version-history' })
}

function openWorldTimeline(name: string) {
  const store = useEditorStore.getState()
  const existing = store.tabs.find((tab) => tab.type === 'world-timeline')
  if (existing) { store.setActiveTab(existing.id); return }
  store.openFile({ id: 'world-timeline', name, type: 'world-timeline' })
}

function openManuscriptBoard(name: string) {
  const store = useEditorStore.getState()
  const existing = store.tabs.find((tab) => tab.type === 'manuscript-board')
  if (existing) {
    store.setActiveTab(existing.id)
    return
  }
  store.openFile({ id: 'manuscript-board', name, type: 'manuscript-board' })
}

/**
 * Cmd+K 命令面板 —— 键盘优先的统一入口。
 *
 * 设计取舍：
 * - 只做「动词」（打开/切换/设置），不做设置项镜像；设置内部仍有独立搜索。
 * - 搜索同时匹配标题、分组与关键词，中英输入都能命中（关键词里补了英文别名）。
 * - 执行后立即关闭，避免遮住结果；需要确认的操作（如打开项目）由各自主流程负责。
 */
export default function CommandPalette() {
  const open = useCommandStore((s) => s.open)
  const mode = useCommandStore((s) => s.mode)
  useEffect(() => {
    if (!open) return
    const origin = document.activeElement
    const fromWorkbench = origin?.closest('[data-workbench]')
    return () => {
      // 命令可能关闭原控件所在的面板，原控件卸载后将焦点还给编辑区。
      if (document.activeElement !== document.body || !(origin instanceof HTMLElement) || origin === document.body) return
      if (origin.isConnected) origin.focus({ preventScroll: true })
      else if (fromWorkbench) focusWorkbenchEditor()
    }
  }, [open])
  if (!open) return null
  // key 让每次打开/切换模式都从空查询、第一项开始，不需要在 effect 里清状态
  return <PalettePanel key={mode} mode={mode} />
}

function PalettePanel({ mode }: { mode: 'commands' | 'shortcuts' }) {
  const { t } = useTranslation()
  const bindings = useShortcutStore(s => s.bindings)
  const devConsoleEnabled = useDevConsoleStore(s => s.enabled)
  const close = useCommandStore((s) => s.closePalette)
  const openPalette = useCommandStore((s) => s.openPalette)

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const selectionSource = useRef<'keyboard' | 'pointer'>('keyboard')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [])

  const sidebar = (view: SidebarView) => () => {
    useLayoutStore.getState().showSidebarView(view)
  }
  const sc = useCallback((id: string) => formatBinding(shortcutBinding(id, bindings)), [bindings])

  const commands = useMemo<CommandItem[]>(() => {
    const layout = useLayoutStore.getState()
    const prefs = useEditorPrefsStore.getState()
    const theme = useThemeStore.getState()

    const themeCommand = (id: string, label: string, value: Theme, icon: ReactNode): CommandItem => ({
      id,
      label,
      category: t('command.group.theme'),
      icon,
      run: () => theme.setTheme(value),
    })

    return [
      {
        id: 'new-project', label: t('dialog.newProject'), category: t('command.group.general'),
        shortcut: sc('new-project'), icon: <FilePlus2 size={15} />, keywords: 'new project 新建',
        run: () => layout.openNewProject(),
      },
      {
        id: 'open-project', label: t('action.openProject'), category: t('command.group.general'),
        shortcut: sc('open-project'), icon: <FolderOpen size={15} />, keywords: 'open folder 打开 项目',
        run: async () => {
          const folder = await ipc.invoke('dialog:select-folder')
          if (folder) {
            const { useProjectStore } = await import('../../stores/project-store')
            await useProjectStore.getState().openProject(folder)
          }
        },
      },
      {
        id: 'import-novel', label: t('dialog.importNovel'), category: t('command.group.general'),
        icon: <Import size={15} />, keywords: 'import 导入 小说',
        run: () => layout.openImportNovel(),
      },
      {
        id: 'new-chapter', label: t('chapter.newChapter'), category: t('command.group.general'),
        icon: <CreateIcon size={15} />, keywords: 'chapter 新建章节',
        run: () => layout.openChapterCreation(),
      },
      ...(__DEV_CONSOLE__ && devConsoleEnabled ? [{
        id: 'dev-console', label: t('dev.consoleTitle'), category: t('command.group.general'),
        icon: <Terminal size={15} />, keywords: 'developer console devtools debug ipc db 开发者 控制台',
        run: () => layout.openDevConsole(),
      }] : []),
      {
        id: 'activity', label: t('panel.activityShort'), category: t('command.group.general'),
        icon: <Gauge size={15} />, keywords: 'writing stats 统计',
        run: () => layout.openActivityDialog(),
      },
      {
        id: 'version-history', label: t('version.history'), category: t('command.group.general'),
        icon: <History size={15} />, keywords: 'version diff rollback 版本 回滚',
        run: () => openVersionHistory(t('version.history')),
      },
      {
        id: 'world-timeline', label: t('world.entities') + ' / ' + t('world.timeline'), category: t('command.group.general'),
        icon: <Globe size={15} />, keywords: 'world entities timeline 世界观 时间线 实体',
        run: () => openWorldTimeline(t('world.entities')),
      },
      {
        id: 'manuscript-board', label: t('board.title'), category: t('command.group.general'),
        icon: <LayoutGrid size={15} />, keywords: 'chapters outline cards 章节 大纲 卡片',
        run: () => openManuscriptBoard(t('board.title')),
      },
      {
        id: 'settings', label: t('settings.title'), category: t('command.group.general'),
        shortcut: sc('settings'), icon: <Settings2 size={15} />, keywords: 'preferences 设置',
        run: () => layout.openSettings(),
      },

      {
        id: 'toggle-sidebar', label: t('command.toggleSidebar'), category: t('command.group.view'),
        shortcut: sc('toggle-sidebar'), icon: <PanelLeft size={15} />, keywords: 'sidebar 侧栏',
        run: () => layout.toggleSidebar(),
      },
      {
        id: 'show-project', label: t('nav.projectTree'), category: t('command.group.view'),
        icon: <BookOpen size={15} />, keywords: 'project tree 项目结构',
        run: sidebar('project'),
      },
      {
        id: 'show-knowledge', label: t('nav.knowledgeBase'), category: t('command.group.view'),
        icon: <BookOpen size={15} />, keywords: 'knowledge 知识库',
        run: sidebar('knowledge'),
      },
      {
        id: 'show-characters', label: t('nav.characters'), category: t('command.group.view'),
        icon: <Users size={15} />, keywords: 'characters 角色',
        run: sidebar('characters'),
      },
      {
        id: 'toggle-agent', label: t('command.toggleAgent'), category: t('command.group.view'),
        shortcut: sc('toggle-agent'), icon: <Bot size={15} />, keywords: 'agent ai chat 智能体',
        run: () => layout.toggleAIPanel(),
      },
      {
        id: 'toggle-bottom', label: t('command.toggleBottom'), category: t('command.group.view'),
        shortcut: sc('toggle-bottom'), icon: <PanelBottom size={15} />, keywords: 'bottom panel tasks 底栏',
        run: () => layout.toggleBottomPanel(),
      },
      {
        id: 'show-tasks', label: t('panel.tasks'), category: t('command.group.view'),
        icon: <PanelBottom size={15} />, keywords: 'tasks workflow 任务',
        run: () => layout.openBottomTab('tasks'),
      },
      {
        id: 'show-logs', label: t('panel.log'), category: t('command.group.view'),
        icon: <PanelBottom size={15} />, keywords: 'logs 日志',
        run: () => layout.openBottomTab('log'),
      },
      {
        id: 'focus-mode', label: t('command.focusMode'), category: t('command.group.view'),
        shortcut: sc('focus-mode'), icon: <Focus size={15} />, keywords: 'focus zen 专注',
        run: () => layout.toggleFocusMode(),
      },
      {
        id: 'typewriter', label: t('command.typewriter'), category: t('command.group.editor'),
        icon: <TextCursorInput size={15} />, keywords: 'typewriter scroll 40% 打字机',
        run: () => prefs.toggleTypewriter(),
      },
      {
        id: 'paragraph-focus', label: t('command.paragraphFocus'), category: t('command.group.editor'),
        icon: <Wand2 size={15} />, keywords: 'paragraph highlight 段落 高亮',
        run: () => prefs.toggleParagraphFocus(),
      },
      {
        id: 'font-17', label: t('command.fontSize').replace('{size}', '17'), category: t('command.group.editor'),
        icon: <TextCursorInput size={15} />, keywords: 'font size 17 字号',
        run: () => prefs.setProseFontSize(17),
      },
      {
        id: 'font-18', label: t('command.fontSize').replace('{size}', '18'), category: t('command.group.editor'),
        icon: <TextCursorInput size={15} />, keywords: 'font size 18 字号',
        run: () => prefs.setProseFontSize(18),
      },
      {
        id: 'measure-720', label: t('command.measure').replace('{size}', '720'), category: t('command.group.editor'),
        icon: <Minus size={15} />, keywords: 'width 720 栏宽',
        run: () => prefs.setMeasureWidth(720),
      },
      {
        id: 'measure-760', label: t('command.measure').replace('{size}', '760'), category: t('command.group.editor'),
        icon: <Maximize2 size={15} />, keywords: 'width 760 栏宽',
        run: () => prefs.setMeasureWidth(760),
      },
      {
        id: 'measure-800', label: t('command.measure').replace('{size}', '800'), category: t('command.group.editor'),
        icon: <Maximize2 size={15} />, keywords: 'width 800 栏宽',
        run: () => prefs.setMeasureWidth(800),
      },

      themeCommand('theme-light', t('theme.light'), 'light', <Sun size={15} />),
      themeCommand('theme-galaxy', t('theme.starry'), 'galaxy', <Sparkles size={15} />),
      themeCommand('theme-paper', t('theme.paper'), 'paper', <BookOpen size={15} />),
      themeCommand('theme-dark', t('theme.dark'), 'dark', <Brain size={15} />),
      themeCommand('theme-custom', t('theme.custom'), 'custom', <Palette size={15} />),
      {
        id: 'zoom-in', label: t('zoom.in'), category: t('command.group.theme'),
        shortcut: sc('zoom-in'), icon: <ZoomIn size={15} />,
        run: () => useThemeStore.getState().zoomIn(),
      },
      {
        id: 'zoom-out', label: t('zoom.out'), category: t('command.group.theme'),
        shortcut: sc('zoom-out'), icon: <Minus size={15} />,
        run: () => useThemeStore.getState().zoomOut(),
      },
      {
        id: 'zoom-reset', label: t('zoom.reset'), category: t('command.group.theme'),
        shortcut: sc('zoom-reset'), icon: <Gauge size={15} />,
        run: () => useThemeStore.getState().zoomReset(),
      },
      {
        id: 'shortcuts', label: t('command.shortcuts'), category: t('command.group.help'),
        shortcut: sc('shortcuts-help'), icon: <Keyboard size={15} />, keywords: 'keyboard shortcuts 快捷键',
        run: () => openPalette('shortcuts'),
      },
    ]
  }, [t, openPalette, sc, devConsoleEnabled])

  const shortcuts = useMemo<ShortcutItem[]>(() => [
    ...SHORTCUT_DEFINITIONS.map(def => ({
      id: def.id,
      label: t(def.labelKey),
      shortcut: formatBinding(shortcutBinding(def.id, bindings)),
    })),
    { id: 'palette-nav', label: t('command.shortcut.nav'), shortcut: '↑ ↓ / Enter' },
  ], [t, bindings])

  const normalized = query.trim().toLowerCase()
  const filteredCommands = useMemo(() => {
    if (!normalized) return commands
    return commands.filter((cmd) =>
      `${cmd.label} ${cmd.category} ${cmd.keywords ?? ''}`.toLowerCase().includes(normalized),
    )
  }, [commands, normalized])
  const filteredShortcuts = useMemo(() => {
    if (!normalized) return shortcuts
    return shortcuts.filter((item) => item.label.toLowerCase().includes(normalized))
  }, [shortcuts, normalized])

  const itemCount = mode === 'shortcuts' ? filteredShortcuts.length : filteredCommands.length
  const safeSelected = Math.min(selected, Math.max(0, itemCount - 1))

  useEffect(() => {
    if (selectionSource.current === 'pointer') return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-command-index="${safeSelected}"]`)
    // jsdom 没有 scrollIntoView；浏览器/Electron 有，测试环境跳过即可
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  }, [safeSelected, normalized])

  const runCommand = (cmd: CommandItem) => {
    close()
    // 微任务让关闭动画/状态先落定，再执行可能打开新弹窗的命令
    void Promise.resolve().then(cmd.run)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    // 输入法确认候选词时，方向键和回车仍由输入法处理。
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key === 'Tab') {
      // 结果由搜索框的方向键选中，Tab 在搜索框和标题栏操作之间循环。
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-command-control]'))
      const controlIndex = controls.indexOf(document.activeElement as HTMLElement)
      const nextIndex = (controlIndex + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
      event.preventDefault()
      controls[nextIndex]?.focus()
      return
    }
    if (event.target !== inputRef.current || itemCount === 0) return
    selectionSource.current = 'keyboard'
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelected((i) => (i + 1) % itemCount)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelected((i) => (i - 1 + itemCount) % itemCount)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (mode === 'shortcuts') {
        if (filteredShortcuts[safeSelected]?.id === 'shortcuts') openPalette('commands')
        return
      }
      const cmd = filteredCommands[safeSelected]
      if (cmd) runCommand(cmd)
    }
  }

  const rows: ReactNode[] = []
  let lastCategory = ''
  if (mode === 'shortcuts') {
    filteredShortcuts.forEach((item, index) => {
      rows.push(
        <div key={item.id} id={`${listId}-${index}`} role="option" aria-selected={index === safeSelected}
          data-command-index={index} className="nf-command-row nf-command-shortcut">
          <span className="nf-command-label">{item.label}</span>
          <Kbd>{item.shortcut || t('shortcut.unassigned')}</Kbd>
        </div>,
      )
    })
  } else {
    filteredCommands.forEach((cmd, index) => {
      if (cmd.category !== lastCategory) {
        lastCategory = cmd.category
        rows.push(<div key={`cat-${cmd.category}-${index}`} role="presentation" className="nf-command-group">{cmd.category}</div>)
      }
      rows.push(
        <button
          key={cmd.id}
          id={`${listId}-${index}`}
          type="button"
          role="option"
          aria-selected={index === safeSelected}
          data-command-index={index}
          tabIndex={-1}
          className="nf-command-row"
          onPointerMove={() => {
            selectionSource.current = 'pointer'
            setSelected(index)
          }}
          onMouseDown={event => event.preventDefault()}
          onClick={() => runCommand(cmd)}
        >
          <span className="nf-command-icon" aria-hidden="true">{cmd.icon}</span>
          <span className="nf-command-label">{cmd.label}</span>
          {cmd.shortcut && <Kbd>{cmd.shortcut}</Kbd>}
          <ChevronRight className="nf-command-arrow" size={13} aria-hidden="true" />
        </button>,
      )
    })
  }

  const title = t(mode === 'shortcuts' ? 'command.shortcutsTitle' : 'command.title')
  const placeholder = t(mode === 'shortcuts' ? 'command.shortcutsSearch' : 'command.placeholder')

  return (
    <div className="nf-command-overlay" role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
      <div className="nf-command-panel" role="dialog" aria-modal="true" aria-label={title} onKeyDown={onKeyDown}>
        <div className="nf-command-header">
          <div className="nf-command-search">
            <Search size={16} aria-hidden="true" />
            <input
              ref={inputRef}
              data-command-control
              role="combobox"
              aria-expanded={true}
              aria-autocomplete="list"
              aria-controls={listId}
              aria-activedescendant={itemCount > 0 ? `${listId}-${safeSelected}` : undefined}
              value={query}
              onChange={event => {
                selectionSource.current = 'keyboard'
                setQuery(event.target.value)
                setSelected(0)
              }}
              placeholder={placeholder}
              aria-label={placeholder}
            />
          </div>
          {mode === 'shortcuts' && (
            <Button data-command-control type="button" variant="ghost" size="sm" onClick={() => openPalette('commands')}>
              {t('command.backToCommands')}
            </Button>
          )}
          <Button data-command-control type="button" variant="ghost" size="icon" onClick={close}
            aria-label={t('action.close')} title={t('action.close')}>
            <X size={16} aria-hidden="true" />
          </Button>
        </div>

        <div id={listId} ref={listRef} className="nf-command-results" role="listbox" aria-label={title}>{rows}</div>
        {itemCount === 0 && <p className="nf-command-empty" role="status">{t('command.empty')}</p>}

        <footer className="nf-command-footer">
          <span><Kbd>↑</Kbd><Kbd>↓</Kbd>{t('command.hintNavigate')}</span>
          {mode === 'commands' && <span><Kbd>Enter</Kbd>{t('command.hintRun')}</span>}
          <span><Kbd>Esc</Kbd>{t('command.hintClose')}</span>
        </footer>
      </div>
    </div>
  )
}
