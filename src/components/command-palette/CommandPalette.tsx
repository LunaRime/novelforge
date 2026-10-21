import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Bot, BookOpen, Brain, ChevronDown, Globe, FilePlus2, FolderOpen, Focus,
  Gauge, History, Import, Keyboard, LayoutGrid, Maximize2, Minus, PanelBottom,
  PanelLeft, Plus, Search, Settings2, Sparkles, Sun, TextCursorInput,
  Users, Wand2, ZoomIn,
} from 'lucide-react'
import { useCommandStore } from '../../stores/command-store'
import { useLayoutStore, type SidebarView } from '../../stores/layout-store'
import { useEditorStore } from '../../stores/editor-store'
import { useEditorPrefsStore } from '../../stores/editor-prefs-store'
import { useThemeStore, type Theme } from '../../stores/theme-store'
import { useTranslation } from '../../hooks/useTranslation'
import { ipc } from '../../services/ipc-client'

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

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)
const MOD = isMac ? '⌘' : 'Ctrl'

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 18,
        height: 18,
        padding: '0 4px',
        borderRadius: 4,
        border: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-bg)',
        color: 'var(--color-text-muted)',
        fontFamily: 'var(--font-sans)',
        fontSize: 10.5,
        lineHeight: 1,
      }}
    >
      {children}
    </kbd>
  )
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
  if (!open) return null
  // key 让每次打开/切换模式都从空查询、第一项开始，不需要在 effect 里清状态
  return <PalettePanel key={mode} mode={mode} />
}

function PalettePanel({ mode }: { mode: 'commands' | 'shortcuts' }) {
  const { t } = useTranslation()
  const close = useCommandStore((s) => s.closePalette)
  const openPalette = useCommandStore((s) => s.openPalette)

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [])

  const sidebar = (view: SidebarView) => () => {
    useLayoutStore.getState().showSidebarView(view)
  }

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
        shortcut: `${MOD} N`, icon: <FilePlus2 size={15} />, keywords: 'new project 新建',
        run: () => layout.openNewProject(),
      },
      {
        id: 'open-project', label: t('action.openProject'), category: t('command.group.general'),
        shortcut: `${MOD} O`, icon: <FolderOpen size={15} />, keywords: 'open folder 打开 项目',
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
        icon: <Plus size={15} />, keywords: 'chapter 新建章节',
        run: () => layout.openChapterCreation(),
      },
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
        shortcut: `${MOD} ,`, icon: <Settings2 size={15} />, keywords: 'preferences 设置',
        run: () => layout.openSettings(),
      },

      {
        id: 'toggle-sidebar', label: t('command.toggleSidebar'), category: t('command.group.view'),
        shortcut: `${MOD} B`, icon: <PanelLeft size={15} />, keywords: 'sidebar 侧栏',
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
        shortcut: `${MOD} ⇧ A`, icon: <Bot size={15} />, keywords: 'agent ai chat 智能体',
        run: () => layout.toggleAIPanel(),
      },
      {
        id: 'toggle-bottom', label: t('command.toggleBottom'), category: t('command.group.view'),
        shortcut: `${MOD} J`, icon: <PanelBottom size={15} />, keywords: 'bottom panel tasks 底栏',
        run: () => layout.toggleBottomPanel(),
      },
      {
        id: 'focus-mode', label: t('command.focusMode'), category: t('command.group.view'),
        shortcut: 'F11', icon: <Focus size={15} />, keywords: 'focus zen 专注',
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
      {
        id: 'zoom-in', label: t('zoom.in'), category: t('command.group.theme'),
        shortcut: `${MOD} +`, icon: <ZoomIn size={15} />,
        run: () => useThemeStore.getState().zoomIn(),
      },
      {
        id: 'zoom-out', label: t('zoom.out'), category: t('command.group.theme'),
        shortcut: `${MOD} -`, icon: <Minus size={15} />,
        run: () => useThemeStore.getState().zoomOut(),
      },
      {
        id: 'zoom-reset', label: t('zoom.reset'), category: t('command.group.theme'),
        shortcut: `${MOD} 0`, icon: <Gauge size={15} />,
        run: () => useThemeStore.getState().zoomReset(),
      },
      {
        id: 'shortcuts', label: t('command.shortcuts'), category: t('command.group.help'),
        shortcut: '?', icon: <Keyboard size={15} />, keywords: 'keyboard shortcuts 快捷键',
        run: () => openPalette('shortcuts'),
      },
    ]
  }, [t, openPalette])

  const shortcuts = useMemo<ShortcutItem[]>(() => [
    { id: 'cmdk', label: t('command.title'), shortcut: `${MOD} K` },
    { id: 'save', label: t('action.save'), shortcut: `${MOD} S` },
    { id: 'search', label: t('command.shortcut.search'), shortcut: `${MOD} F` },
    { id: 'new-project', label: t('dialog.newProject'), shortcut: `${MOD} N` },
    { id: 'open-project', label: t('action.openProject'), shortcut: `${MOD} O` },
    { id: 'settings', label: t('settings.title'), shortcut: `${MOD} ,` },
    { id: 'sidebar', label: t('command.toggleSidebar'), shortcut: `${MOD} B` },
    { id: 'agent', label: t('command.toggleAgent'), shortcut: `${MOD} ⇧ A` },
    { id: 'bottom', label: t('command.toggleBottom'), shortcut: `${MOD} J` },
    { id: 'focus', label: t('command.focusMode'), shortcut: 'F11' },
    { id: 'shortcuts', label: t('command.shortcuts'), shortcut: '?' },
    { id: 'palette-nav', label: t('command.shortcut.nav'), shortcut: '↑ ↓ / Enter' },
  ], [t])

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
    const el = listRef.current?.querySelector<HTMLElement>(`[data-command-index="${safeSelected}"]`)
    // jsdom 没有 scrollIntoView；浏览器/Electron 有，测试环境跳过即可
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  }, [safeSelected])

  const runCommand = (cmd: CommandItem) => {
    close()
    // 微任务让关闭动画/状态先落定，再执行可能打开新弹窗的命令
    void Promise.resolve().then(cmd.run)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key === 'Tab') {
      // 命令面板只有一个真实输入面：Tab 不把焦点丢到背后的编辑器
      event.preventDefault()
      inputRef.current?.focus()
      return
    }
    if (itemCount === 0) return
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
    rows.push(
      <div key="shortcuts-title" style={{ padding: '10px 14px 6px', fontSize: 11, color: 'var(--color-text-muted)' }}>
        {t('command.shortcutsTitle')}
      </div>,
    )
    filteredShortcuts.forEach((item, index) => {
      rows.push(
        <div
          key={item.id}
          data-command-index={index}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            height: 34, padding: '0 12px', margin: '0 4px', borderRadius: 6,
            backgroundColor: index === safeSelected ? 'var(--color-active)' : 'transparent',
            color: 'var(--color-text-secondary)',
            fontSize: 12,
          }}
        >
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
          <Kbd>{item.shortcut}</Kbd>
        </div>,
      )
    })
  } else {
    filteredCommands.forEach((cmd, index) => {
      if (cmd.category !== lastCategory) {
        lastCategory = cmd.category
        rows.push(
          <div key={`cat-${cmd.category}-${index}`} style={{ padding: '8px 14px 4px', fontSize: 11, color: 'var(--color-text-muted)' }}>
            {cmd.category}
          </div>,
        )
      }
      rows.push(
        <button
          key={cmd.id}
          type="button"
          data-command-index={index}
          onMouseEnter={() => setSelected(index)}
          onClick={() => runCommand(cmd)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, width: 'calc(100% - 8px)',
            height: 34, padding: '0 10px', margin: '0 4px', borderRadius: 6, border: 'none',
            backgroundColor: index === safeSelected ? 'var(--color-active)' : 'transparent',
            color: index === safeSelected ? 'var(--color-text)' : 'var(--color-text-secondary)',
            fontSize: 12, textAlign: 'left', cursor: 'pointer',
          }}
        >
          <span style={{ display: 'inline-flex', color: 'var(--color-text-muted)' }}>{cmd.icon}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cmd.label}</span>
          {cmd.shortcut && <Kbd>{cmd.shortcut}</Kbd>}
          {index === safeSelected && <ChevronDown size={12} style={{ transform: 'rotate(-90deg)', color: 'var(--color-text-muted)' }} />}
        </button>,
      )
    })
  }

  return (
    <div
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 'var(--z-modal)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '12vh',
        backgroundColor: 'var(--color-backdrop)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('command.title')}
        onKeyDown={onKeyDown}
        style={{
          width: 'min(640px, calc(100vw - 32px))',
          maxHeight: 'min(620px, 68vh)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          backgroundColor: 'var(--color-panel)',
          border: '1px solid var(--color-border)',
          borderRadius: 10,
          boxShadow: 'var(--shadow-popover)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', height: 46, borderBottom: '1px solid var(--color-border)' }}>
          <Search size={15} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setSelected(0) }}
            placeholder={mode === 'shortcuts' ? t('command.shortcutsSearch') : t('command.placeholder')}
            aria-label={t('command.placeholder')}
            style={{
              flex: 1, minWidth: 0, height: '100%', border: 'none', outline: 'none',
              backgroundColor: 'transparent', color: 'var(--color-text)', fontSize: 13,
            }}
          />
          {mode === 'shortcuts' && (
            <button
              type="button"
              onClick={() => openPalette('commands')}
              style={{ border: 'none', background: 'transparent', color: 'var(--color-text-muted)', fontSize: 11, cursor: 'pointer' }}
            >
              {t('command.backToCommands')}
            </button>
          )}
        </div>

        <div ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 0 6px' }}>
          {itemCount === 0 ? (
            <div style={{ padding: '28px 14px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>
              {t('command.empty')}
            </div>
          ) : rows}
        </div>

        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '0 14px', height: 32, flexShrink: 0,
            borderTop: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)', fontSize: 11,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Kbd>↑</Kbd><Kbd>↓</Kbd>{t('command.hintNavigate')}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Kbd>Enter</Kbd>{t('command.hintRun')}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Kbd>Esc</Kbd>{t('command.hintClose')}</span>
          <span style={{ flex: 1 }} />
          <span>{t('command.footer')}</span>
        </div>
      </div>
    </div>
  )
}
