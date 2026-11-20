import { useEffect, useRef, useState } from 'react'
import { Focus, PanelLeft, Search, Sparkles, Zap } from 'lucide-react'
import { useShallow } from 'zustand/shallow'
import appIcon from '../../../build/icon.png'
import { useTranslation } from '../../hooks/useTranslation'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useFloatingPosition } from '../../hooks/useFloatingPosition'
import { useOutsideClick } from '../../hooks/useOutsideClick'
import { THEME_ICONS, THEME_ORDER, themeLabel } from '../../lib/theme-meta'
import { applyThemeWithTransition } from '../../lib/theme-transition'
import { useCommandStore } from '../../stores/command-store'
import { useLayoutStore } from '../../stores/layout-store'
import { useProjectStore } from '../../stores/project-store'
import { formatBinding, shortcutBinding, useShortcutStore } from '../../stores/shortcut-store'
import { useThemeStore } from '../../stores/theme-store'
import { Button } from '../ui/Button'
import { MenuItem } from '../ui/MenuItem'
import { PopoverSurface } from '../ui/PopoverSurface'
import './workbench-header.css'

/** 工作台顶栏统一提供项目身份、命令入口和面板开关。 */
export default function WorkbenchHeader() {
  const { t } = useTranslation()
  const projectName = useProjectStore(state => state.currentProject?.name)
  const openPalette = useCommandStore(state => state.openPalette)
  const shortcut = useShortcutStore(state => formatBinding(shortcutBinding('command-palette', state.bindings)))
  const { focusMode, sidebarOpen, bottomPanelOpen, aiPanelOpen } = useLayoutStore(useShallow(state => ({
    focusMode: state.focusMode, sidebarOpen: state.sidebarOpen,
    bottomPanelOpen: state.bottomPanelOpen, aiPanelOpen: state.aiPanelOpen,
  })))
  const layout = useLayoutStore.getState()
  const focusTitle = t(focusMode ? 'focus.exit' : 'focus.enter')

  return (
    <header className="nf-workbench-header" data-macos={navigator.userAgent.includes('Mac') || undefined}>
      <div className="nf-workbench-header-inner">
        <div className="nf-workbench-project" title={projectName ?? 'NovelForge'}>
          <img src={appIcon} width={28} height={28} alt="" />
          <div className="nf-workbench-identity">
            <span className="nf-workbench-wordmark">NovelForge</span>
            {projectName && <span className="nf-workbench-project-name truncate">{projectName}</span>}
          </div>
        </div>
        <Button type="button" variant="outline" className="nf-workbench-command" onClick={() => openPalette('commands')}
          title={t('command.title')} aria-label={t('command.title')}>
          <Search size={14} aria-hidden="true" />
          <span className="nf-workbench-command-label truncate">{t('command.title')}</span>
          {shortcut && <kbd>{shortcut}</kbd>}
        </Button>
        {/* 面板开关和外观操作各自成组，窗口越窄越优先保留图标和可访问名称。 */}
        <div className="nf-workbench-actions">
          {!focusMode && <>
            <Button type="button" variant="ghost" size="icon" className="nf-workbench-switch size-8"
              aria-expanded={sidebarOpen} aria-label={t('command.toggleSidebar')} title={t('command.toggleSidebar')} onClick={layout.toggleSidebar}>
              <PanelLeft size={16} aria-hidden="true" />
            </Button>
            <Button type="button" variant="ghost" className="nf-workbench-switch" data-workbench-toggle="runtime"
              aria-expanded={bottomPanelOpen} aria-label={t('command.toggleBottom')} title={t('command.toggleBottom')} onClick={layout.toggleBottomPanel}>
              <Zap size={16} aria-hidden="true" />
              <span className="nf-workbench-action-label">{t('panel.tasks')}</span>
            </Button>
            <Button type="button" variant="ghost" className="nf-workbench-switch" data-workbench-toggle="companion"
              aria-expanded={aiPanelOpen} aria-label={t('command.toggleAgent')} title={t('command.toggleAgent')} onClick={layout.toggleAIPanel}>
              <Sparkles size={16} aria-hidden="true" />
              <span className="nf-workbench-action-label">{t('agent.aiPanel')}</span>
            </Button>
          </>}
          <div className="nf-workbench-appearance">
            <Button type="button" variant="ghost" size="icon" className="nf-workbench-switch size-8"
              aria-pressed={focusMode} aria-label={focusTitle} title={focusTitle} onClick={layout.toggleFocusMode}>
              <Focus size={16} aria-hidden="true" />
            </Button>
            <WorkbenchThemeMenu />
          </div>
        </div>
      </div>
    </header>
  )
}

function WorkbenchThemeMenu() {
  const { t } = useTranslation()
  const theme = useThemeStore(state => state.theme)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const menuPosition = useFloatingPosition<HTMLDivElement>(root, open, { placement: 'below', align: 'end' })
  const closeAndFocus = () => { setOpen(false); trigger.current?.focus() }
  // 点击浮层外部时让焦点落到用户点选的控件，Esc 或选定主题后则回到触发按钮。
  useOutsideClick(root, () => setOpen(false), open)
  useEscapeKey(closeAndFocus, open)
  useEffect(() => {
    if (open) list.current?.querySelector('button')?.focus()
  }, [open])

  const Icon = THEME_ICONS[theme] ?? THEME_ICONS.light
  const label = t('theme.label').replace('{theme}', themeLabel(theme, t))
  return (
    <div ref={root}>
      <Button ref={trigger} type="button" variant="ghost" size="icon" className="size-8" active={open}
        aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen(value => !value)}>
        <Icon size={16} aria-hidden="true" />
      </Button>
      {open && <PopoverSurface ref={menuPosition} className="w-40 py-1">
        <div ref={list}>
          {THEME_ORDER.map(id => {
            const ThemeIcon = THEME_ICONS[id]
            return <MenuItem key={id} label={themeLabel(id, t)} icon={<ThemeIcon size={13} />}
              selected={id === theme} onClick={event => { applyThemeWithTransition(id, event); closeAndFocus() }} />
          })}
        </div>
      </PopoverSurface>}
    </div>
  )
}
