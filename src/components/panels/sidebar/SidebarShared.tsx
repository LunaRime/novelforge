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
  FileText, MessageCircle, GitCompare, RefreshCw,
} from 'lucide-react'
import type { ContextMenuEntry } from '../../ui/ContextMenu'
import type { TextKey } from '../../../shared/locale'

// ===== 右键菜单状态管理 =====

export interface SidebarMenuState {
  items: ContextMenuEntry[]
  position: { x: number; y: number }
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
  _sidebarMenuSetter?.({ items, position: { x: e.clientX, y: e.clientY } })
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

/** Opening again preserves unsaved content through the central editor tab policy. */
export async function openArchFile(filePath: string, name: string) {
  await openDocument({ kind: 'path', locator: filePath, name, documentKind: 'arch-file' })
}

/** 打开内置编辑器 */
export function openBuiltinEditor(id: string, name: string, type: 'chapter-card' | 'character' | 'world-building') {
  useEditorStore.getState().openFile({ id, name, type })
}

/** 打开指定章最新草稿（工作台/项目结构共用；无草稿时 toast 反馈） */
export function openDraftByChapter(chapterNumber: number, chapterTitle?: string): Promise<boolean> {
  return openDocument({ kind: 'latest-draft', chapterNumber, chapterTitle })
}

/** 打开章节文件 */
export async function openChapterFile(filePath: string, name: string) {
  await openDocument({ kind: 'path', locator: filePath, name, documentKind: 'chapter' })
}

// ===== 架构文件元信息 =====

export interface ArchFile {
  key: string
  fileName: string
  label: string
  iconName: string
  desc: string
}

export const ARCH_FILES: ArchFile[] = [
  { key: 'premise', fileName: 'premise.md', label: '故事前提', iconName: 'target', desc: 'Logline、核心冲突、金手指定位' },
  { key: 'characters', fileName: 'characters.md', label: '角色图谱', iconName: 'users', desc: '角色弧光、关系网、矛盾交织' },
  { key: 'worldbuilding', fileName: 'worldbuilding.md', label: '世界观', iconName: 'globe', desc: '核心规则、阶层断层、深层危机' },
  { key: 'synopsis', fileName: 'synopsis.md', label: '情节大纲', iconName: 'map', desc: '三幕式情节骨架' },
]

/** 返回翻译后的架构文件列表（保留原 ARCH_FILES 作为未翻译 fallback） */
export function getArchFiles(t: (key: TextKey) => string): ArchFile[] {
  return [
    { key: 'premise', fileName: 'premise.md', label: t('arch.storyPremise') || ARCH_FILES[0].label, iconName: 'target', desc: t('arch.storyPremiseDesc') || ARCH_FILES[0].desc },
    { key: 'characters', fileName: 'characters.md', label: t('arch.characterMap') || ARCH_FILES[1].label, iconName: 'users', desc: t('arch.characterMapDesc') || ARCH_FILES[1].desc },
    { key: 'worldbuilding', fileName: 'worldbuilding.md', label: t('arch.worldBuilding') || ARCH_FILES[2].label, iconName: 'globe', desc: t('arch.worldBuildingDesc') || ARCH_FILES[2].desc },
    { key: 'synopsis', fileName: 'synopsis.md', label: t('arch.plotOutline') || ARCH_FILES[3].label, iconName: 'map', desc: t('arch.plotOutlineDesc') || ARCH_FILES[3].desc },
  ]
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
