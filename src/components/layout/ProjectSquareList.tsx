/**
 * ProjectSquareList — 左侧活动栏（LT）项目方块列表（全新独立组件）
 *
 * 竖排正方形小方块 [[项目一],[项目二],…]（与角色管理图标同尺寸）：
 * - 每个方块显示项目名截断（完整信息在悬停提示）
 * - 最多展示 5 个，更多时列表内部滚动
 * - 悬停提示：项目全名 / 完整路径 / 最近打开时间
 * - 点击方块 → 打开该项目 + 侧边栏切换到「项目工作台」
 *   （聚焦章节蓝图/草稿箱/正式稿，非专注模式）
 */
import { useCallback, useState } from 'react'
import { Trash2, FolderOpen, AlertTriangle } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { useLayoutStore } from '../../stores/layout-store'
import { useEditorStore } from '../../stores/editor-store'
import { ipc } from '../../services/ipc-client'
import { formatLocaleDateTime } from '../../shared/locale'
import { cn } from '../../lib/utils'
import { useTranslation } from '../../hooks/useTranslation'
import { confirmDeleteProject } from '../ui/Confirm'
import { openBuiltinEditor } from '../panels/sidebar/SidebarShared'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'

// ===== 常量 =====

/** 方块列表可见高度（5 个方块 + 间距 + 内边距），超出滚动 */
const LIST_MAX_HEIGHT = 5 * 30 + 4 * 6 + 12

/** 项目色板 — 8 个色相均匀分布，按列表顺序取色（列表内保证不冲突） */
const PROJECT_PALETTE = [15, 45, 90, 140, 190, 240, 285, 330]

/** 取色相（固定饱和度/亮度保证白字可读） */
function projectColor(index: number): string {
  const hue = PROJECT_PALETTE[index % PROJECT_PALETTE.length]
  return `hsl(${hue} 60% 45%)`
}

/** 方块首字/首字母（中文取首字，英文取首字母大写） */
function initialOf(name: string): string {
  const ch = name.trim().charAt(0)
  if (!ch) return '?'
  return /[a-zA-Z]/.test(ch) ? ch.toUpperCase() : ch
}

// ===== 组件 =====

export default function ProjectSquareList() {
  const { t } = useTranslation()
  const recentProjects = useProjectStore(s => s.recentProjects)
  const currentProject = useProjectStore(s => s.currentProject)
  const openProject = useProjectStore(s => s.openProject)
  const deleteProjectFolder = useProjectStore(s => s.deleteProjectFolder)
  const removeRecentProject = useProjectStore(s => s.removeRecentProject)
  // 故事架构未完成提示弹窗（进入工作台前置检查）
  const [archPrompt, setArchPrompt] = useState<{ path: string; name: string; done: number } | null>(null)

  // 过滤：排除当前项目 + 最多展示 5 个
  const targets = recentProjects
    .filter(p => p.path !== currentProject?.path)
    .slice(0, 5)

  // 点击方块：打开该项目 + 进入项目工作台（非专注模式）；
  // 进入后异步检查故事架构完整性（4 项），未完成弹窗提示可跳转填充
  const handleSquareClick = useCallback(async (projectPath: string, projectName: string) => {
    const prevView = useLayoutStore.getState().sidebarView
    const ok = await openProject(projectPath, { keepView: true })
    if (!ok) return
    // 竞态保护：openProject 异步期间用户可能已切换视图（角色管理/项目结构等），
    // 此时不覆盖用户选择、不清 Tab —— 只有视图未被用户改变时才进工作台
    if (useLayoutStore.getState().sidebarView !== prevView) return
    // 切换项目：清空旧项目残留的编辑器 Tab（避免内容错乱）
    useEditorStore.getState().clearTabs()
    useLayoutStore.setState({ sidebarOpen: true, sidebarView: 'workspace' })
    // 前置检查：故事架构未填充完成（<4/4）时弹窗提示（不阻塞工作台进入）
    try {
      const summary = await ipc.invoke('project:get-summary', projectPath)
      if (summary && summary.archGenerated < 4) {
        setArchPrompt({ path: projectPath, name: projectName, done: summary.archGenerated })
      }
    } catch { /* 摘要获取失败不打扰用户 */ }
  }, [openProject])

  // 去填充故事架构：打开世界观/架构编辑器（WorldBuildingEditor）
  const handleGoFill = useCallback(() => {
    setArchPrompt(null)
    openBuiltinEditor('world-building-editor', t('editor.storyArch'), 'world-building')
  }, [t])

  // 删除/移出最近项目（删除文件夹或仅移出列表）
  const handleDelete = useCallback(async (e: React.MouseEvent, projectPath: string) => {
    e.stopPropagation()
    const action = await confirmDeleteProject()
    if (action === 'delete') await deleteProjectFolder(projectPath)
    else if (action === 'remove') await removeRecentProject(projectPath)
  }, [deleteProjectFolder, removeRecentProject])

  return (
    <div className="flex flex-col items-center w-full">
      {/* 方块列表 — 竖排正方形小方块（与角色管理图标同尺寸），最多 5 个可见 */}
      <div
        className="flex flex-col items-center gap-1.5 overflow-y-auto w-full py-1.5"
        style={{ maxHeight: LIST_MAX_HEIGHT }}
      >
        {targets.length === 0 && (
          <div className="text-center py-3 text-[0.6rem] opacity-40" style={{ color: 'var(--color-text-muted)' }}>
            {t('charList.noHistory')}
          </div>
        )}
        {targets.map((p, i) => {
          // 悬停提示：全名/完整路径/最近打开时间（无效时间戳不追加行）
          const timeText = formatLocaleDateTime(p.updatedAt)
          const tipText = `${p.name}\n${p.path}${timeText ? `\n${timeText}` : ''}`
          const color = projectColor(i)
          return (
            <button
              key={p.path}
              type="button"
              onClick={() => handleSquareClick(p.path, p.name)}
              title={tipText}
              className={cn(
                'group relative w-[30px] h-[30px] rounded-md flex items-center justify-center',
                'transition-all duration-150 cursor-pointer select-none overflow-hidden',
                'hover:brightness-110',
              )}
              style={{
                backgroundColor: color,
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15)',
              }}
            >
              {/* 首字/首字母（完整信息在悬停提示） */}
              <span className="text-sm font-bold leading-none text-white drop-shadow-sm">
                {initialOf(p.name)}
              </span>
              {/* 删除/移出（悬停显示，半透明黑底保证彩色底上可见） */}
              <span
                role="button"
                className="absolute top-0 right-0 p-[1px] rounded opacity-0 group-hover:opacity-80 hover:!opacity-100 transition-opacity cursor-pointer"
                style={{ color: '#fff', backgroundColor: 'rgba(0,0,0,0.35)' }}
                onClick={(e) => handleDelete(e, p.path)}
                title={t('project.deleteTooltip')}
              >
                <Trash2 size={8} />
              </span>
            </button>
          )
        })}
      </div>

      {/* 故事架构未完成提示弹窗（进入工作台前置检查） */}
      <Dialog open={!!archPrompt} onOpenChange={(v) => { if (!v) setArchPrompt(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={15} style={{ color: 'var(--color-warning)' }} />
              {t('workspace.archIncomplete')}
            </DialogTitle>
            <DialogDescription>
              <span className="flex items-center gap-1.5">
                <FolderOpen size={12} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
                <span className="truncate font-medium">{archPrompt?.name}</span>
              </span>
              <span className="block mt-1">
                {t('workspace.archPrompt').replace('{done}', String(archPrompt?.done ?? 0))}
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setArchPrompt(null)}
              className="px-3 py-1.5 rounded-lg text-xs transition-colors cursor-pointer"
              style={{ color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-hover)' }}
            >
              {t('action.close')}
            </button>
            <button
              type="button"
              onClick={handleGoFill}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer"
              style={{ color: '#fff', backgroundColor: 'var(--color-accent)' }}
            >
              {t('workspace.goFill')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
