/* eslint-disable react-refresh/only-export-components */
/**
 * SidebarShared — 侧边栏共享工具函数、类型定义和常量
 *
 * 所有拆分出的子组件共用这些基础设施。
 */

import React from 'react'
import {
  Target, Users, Globe, Map, BookOpen, FolderTree, LayoutList,
  FilePen, PenTool, BrainCircuit, Sparkles, FolderOpen, Zap,
  FileText, MessageCircle, GitCompare, RefreshCw, Ellipsis,
} from 'lucide-react'
import type { ContextMenuEntry } from '../../ui/ContextMenu'
import { Button } from '../../ui/Button'
import { useTranslation } from '../../../hooks/useTranslation'

// ===== 右键菜单状态管理 =====

export interface SidebarMenuState {
  items: ContextMenuEntry[]
  position: { x: number; y: number }
  anchor?: HTMLElement
}

/** 全局单例右键菜单状态 setter（同一时刻只展示一个） */
let _sidebarMenuSetter: ((v: SidebarMenuState | null) => void) | null = null

/** 注册 setter（由 Sidebar 容器调用） */
export function registerMenuSetter(setter: (v: SidebarMenuState | null) => void) {
  _sidebarMenuSetter = setter
}

/** 注销 setter */
export function unregisterMenuSetter() {
  _sidebarMenuSetter = null
}

/** 展示右键菜单 */
export function showSidebarMenu(items: ContextMenuEntry[], e: React.MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  const anchor = e.type === 'click' && e.currentTarget instanceof HTMLElement ? e.currentTarget : undefined
  const bounds = anchor?.getBoundingClientRect()
  _sidebarMenuSetter?.({ items, anchor, position: { x: bounds?.left ?? e.clientX, y: bounds?.bottom ?? e.clientY } })
}

export function SidebarRowMenu({ items }: { items: ContextMenuEntry[] }) {
  const { t } = useTranslation()
  return (
    <Button type="button" variant="ghost" size="icon" className="size-[32px] shrink-0"
      aria-label={t('tip.moreOptions')} title={t('tip.moreOptions')} onClick={event => showSidebarMenu(items, event)}>
      <Ellipsis size={14} aria-hidden="true" />
    </Button>
  )
}

// ===== 辅助打开文件函数 =====

import { useEditorStore } from '../../../stores/editor-store'
import { openRendererEditorDocument } from '../../../services/editor/open-editor-document'
import { EditorOpenScopeChanged, type EditorOpenRequest } from '../../../core'
import { toast } from '../../ui/Toast'
import { t } from '../../../shared/locale'
import { renderLog } from '../../../services/render-logger'

/** UI feedback stays here; resource loading and project isolation live in the application use case. */
async function openDocument(request: EditorOpenRequest): Promise<boolean> {
  try {
    const result = await openRendererEditorDocument(request)
    if (result.status === 'missing') {
      if (request.kind === 'latest-draft') toast.warning(t('workspace.noDraft').replace('{n}', String(request.chapterNumber)))
      if (request.kind === 'draft') toast.warning(t('error.noBaseDraft'))
      return false
    }
    return true
  } catch (error) {
    if (error instanceof EditorOpenScopeChanged) return false
    renderLog('error', 'Open:Editor', String(error))
    toast.error(`${t('common.loadFailed')}: ${String(error)}`)
    return false
  }
}

/** 打开内置编辑器 */
export function openBuiltinEditor(id: string, name: string, type: 'chapter-card' | 'character' | 'world-building') {
  useEditorStore.getState().openFile({ id, name, type })
}

/** 打开指定章最新草稿（工作台/项目结构共用；无草稿时 toast 反馈） */
export function openDraftByChapter(chapterNumber: number, chapterTitle?: string): Promise<boolean> {
  return openDocument({ kind: 'latest-draft', chapterNumber, chapterTitle })
}

export function openDraftById(draftId: number, name: string): Promise<boolean> {
  return openDocument({ kind: 'draft', draftId, name })
}

/** 打开章节文件 */
export async function openChapterFile(filePath: string, name: string) {
  await openDocument({ kind: 'path', locator: filePath, name, documentKind: 'chapter' })
}

/** iconName → Lucide 图标组件映射 */
const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>> = {
  target: Target,
  users: Users,
  globe: Globe,
  map: Map,
  'book-open': BookOpen,
  'folder-tree': FolderTree,
  'layout-list': LayoutList,
  'file-pen': FilePen,
  'pen-tool': PenTool,
  'brain-circuit': BrainCircuit,
  sparkles: Sparkles,
  'folder-open': FolderOpen,
  zap: Zap,
  'file-text': FileText,
  'message-circle': MessageCircle,
  'refresh-cw': RefreshCw,
  'git-compare': GitCompare,
}

/** 根据 iconName 渲染 Lucide 图标；未找到时返回空占位 */
export function renderIcon(iconName: string, size = 14, style?: React.CSSProperties) {
  const Icon = ICON_MAP[iconName]
  if (!Icon) return <span style={{ width: size, height: size, display: 'inline-block', flexShrink: 0, ...style }} />
  return <Icon size={size} style={{ flexShrink: 0, ...style }} />
}

// ===== 从 fileTree 按相对路径找直接子文件 =====


// ===== 通用叶子节点组件 =====

/** 叶子节点（无子级，带可选状态徽章） */
export function LeafItem({
  iconName,
  label,
  desc,
  badge,
  badgeDone,
  badgeColor,
  onClick,
  onContextMenu,
}: {
  iconName: string
  label: string
  desc?: string
  badge?: string
  badgeDone?: boolean
  badgeColor?: string
  onClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}) {
  const content = (
    <>
      <span style={{ width: 12, flexShrink: 0 }} />
      <span className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>{renderIcon(iconName, 14)}</span>
      <span className="text-sm font-medium flex-1 min-w-0 truncate" style={{ color: 'var(--color-text)' }}>{label}</span>
      {badge && (
        <span
          className="text-micro flex-shrink-0 ml-1"
          style={{ color: badgeColor || (badgeDone ? 'var(--color-success)' : 'var(--color-text-muted)') }}
        >
          {badge}
        </span>
      )}
    </>
  )
  return (
    <div
      className="tree-item gap-1.5 select-none"
      // 左缩进交给主按钮（.tree-item 自带 px-2）：这样手型光标与真实可点区完全重合，
      // 且缩进区仍然可点。右侧保留 8px 以免内容贴边——该留白不可点，故 .tree-item
      // 已移除 cursor-pointer（否则留白处会出现手型）。
      style={{ paddingLeft: 0, paddingRight: 8 }}
      onContextMenu={onContextMenu}
      title={desc}
    >
      {/* 2026-09-27 可供性修复：无 onClick 时不得渲染 `disabled` 按钮（"没有点击行为" ≠
          "按钮不可用"，标准 §2 坏形态 3）——改为纯内容 div：无热区、无 hover、无手型。 */}
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="flex items-center gap-1.5 flex-1 min-w-0 h-full text-left cursor-pointer"
          style={{ paddingLeft: 10 }}
        >
          {content}
        </button>
      ) : (
        <div className="flex items-center gap-1.5 flex-1 min-w-0" style={{ paddingLeft: 10 }}>
          {content}
        </div>
      )}
    </div>
  )
}
