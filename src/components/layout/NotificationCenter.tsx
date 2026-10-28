/**
 * 状态栏「消息收纳中心」入口 + 弹层（2026-10 六项 UI 改进 · 第 1 项）
 *
 * 入口在状态栏**最右段、缩放控件左侧**：铃铛 + 未读角标（无未读不显「0」）。
 * 弹层朝上展开（状态栏在窗口底部），分区顺序即优先级：
 *
 *   1. 正在执行 —— `workflow-store.activeRuns` 实时派生，**永远置顶、不可移除、不计未读**
 *   2. 任务结果 —— `workflow-store.history` 的完成 / 失败，可「查看输出」
 *
 * 应用更新不进入通知中心（2026-10-20）：状态栏 `StatusBarUpdate` 是唯一操作面。
 *
 * 条目派生全部在 `stores/notice-store`（派生式，不在业务代码里 push 通知）；
 * 本组件只做三件事：订阅来源 store → 触发 `sync()` → 渲染。文案一律走 `t()`。
 *
 * 尺寸口径：状态栏只有 22px，入口**按分段语言撑满整条高度**（宽度 ≥32px），
 * 不把 32×32 方块硬塞进去；弹层内的图标按钮才是 32×32。
 */
import { useEffect, useRef, useState } from 'react'
import {
  Bell, Check, CheckCircle2, X, XCircle,
} from 'lucide-react'
import {
  countUnread, UNREAD_BADGE_MAX, useNoticeStore,
  type ResultNotice, type RunningNotice, type RunningNoticeStatus,
} from '../../stores/notice-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useLayoutStore } from '../../stores/layout-store'
import { useTranslation } from '../../hooks/useTranslation'
import { useOutsideClick } from '../../hooks/useOutsideClick'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useFloatingPosition } from '../../hooks/useFloatingPosition'
import { PopoverSurface } from '../ui/PopoverSurface'
import { ProgressBar } from '../ui/ProgressBar'
import type { TextKey } from '../../shared/locale'

/** 弹层尺寸（口径：宽 ~320、最大高 ~360、内部滚动） */
const PANEL_WIDTH = 320
const PANEL_MAX_HEIGHT = 360
/** 列表区最大高度 = 弹层高 - 头部（滚动落在列表上，头部常驻） */
const LIST_MAX_HEIGHT = 306

/** 运行中条目的三态文案 key */
const RUN_STATUS_KEY: Record<RunningNoticeStatus, TextKey> = {
  running: 'notice.runStatusRunning',
  waiting: 'notice.runStatusWaiting',
  paused: 'notice.runStatusPaused',
}

export default function NotificationCenter() {
  const { t } = useTranslation()
  const unread = useNoticeStore((s) => countUnread(s.items))
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  // 状态栏在窗口底部 → 朝上展开、右对齐（与 ModelPicker / 水温面板同款）
  const panelRef = useFloatingPosition<HTMLDivElement>(anchorRef, open, { placement: 'above', align: 'end' })

  useOutsideClick(anchorRef, () => setOpen(false), open)
  useEscapeKey(() => setOpen(false), open)

  // 订阅工作流 store：任一变化就重派生。sync() 幂等且无变化不写 state，
  // 故工作流每写一条日志都触发它也不会造成多余渲染。
  useEffect(() => {
    const sync = useNoticeStore.getState().sync
    sync()
    return useWorkflowStore.subscribe(sync)
  }, [])

  const label = unread > 0 ? t('notice.bell').replace('{n}', String(unread)) : t('notice.bellNone')

  return (
    <div ref={anchorRef} className="relative h-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        // 热区 = 状态栏分段的高度（撑满整条）+ 宽度 ≥32px；视觉尺寸仍是 11px 图标
        className="relative flex items-center justify-center h-full transition-colors hover:bg-[var(--color-hover)]"
        style={{
          minWidth: 32,
          padding: 0,
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
        }}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
      >
        <Bell size={11} strokeWidth={1.5} />
        {unread > 0 && (
          <span
            data-testid="notice-unread-badge"
            aria-hidden="true"
            className="absolute tabular-nums pointer-events-none"
            style={{
              top: 1,
              right: 3,
              minWidth: 14,
              height: 13,
              padding: '0 3px',
              borderRadius: 7,
              fontSize: 9,
              lineHeight: '13px',
              fontWeight: 600,
              textAlign: 'center',
              // 反色：角标底用 accent，字用状态栏底色 —— 四套主题下都对得上
              color: 'var(--color-statusbar)',
              backgroundColor: 'var(--color-accent)',
            }}
          >
            {unread > UNREAD_BADGE_MAX ? t('notice.unreadMany') : unread}
          </span>
        )}
      </button>

      {open && (
        <PopoverSurface
          ref={panelRef}
          style={{ width: PANEL_WIDTH, maxHeight: PANEL_MAX_HEIGHT, overflow: 'hidden' }}
        >
          <NoticePanel onClose={() => setOpen(false)} />
        </PopoverSurface>
      )}
    </div>
  )
}

/** 弹层内容：只在这里订阅 items（入口按钮只订阅未读数，列表变化不牵动状态栏） */
function NoticePanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const items = useNoticeStore((s) => s.items)
  const markAllRead = useNoticeStore((s) => s.markAllRead)
  const unread = countUnread(items)

  const running = items.filter((i): i is RunningNotice => i.kind === 'running')
  const results = items.filter((i): i is ResultNotice => i.kind === 'result')

  return (
    <div
      role="dialog"
      aria-label={t('notice.title')}
      className="flex flex-col"
      style={{ maxHeight: PANEL_MAX_HEIGHT }}
    >
      <div
        className="flex items-center justify-between gap-2 px-3 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <span className="text-micro font-medium" style={{ color: 'var(--color-text)' }}>
          {t('notice.title')}
        </span>
        <div className="flex items-center gap-1 ml-auto">
          {unread > 0 && (
            <TextAction label={t('notice.markAllRead')} icon={<Check size={11} />} onClick={markAllRead} />
          )}
          {/* 显式关闭出口：此前只有 Esc/点外部（审计 P1-A3 同类问题） */}
          <button
            type="button"
            onClick={onClose}
            aria-label={t('action.close')}
            title={t('action.close')}
            className="flex items-center justify-center rounded hover:bg-[var(--color-hover)] cursor-pointer"
            style={{ width: 20, height: 20, color: 'var(--color-text-muted)' }}
          >
            <X size={11} />
          </button>
        </div>
      </div>

      <div style={{ overflowY: 'auto', maxHeight: LIST_MAX_HEIGHT }}>
        {items.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{t('notice.empty')}</div>
            <div className="mt-1 text-2xs" style={{ color: 'var(--color-text-muted)' }}>{t('notice.emptyHint')}</div>
          </div>
        ) : (
          <>
            {running.length > 0 && (
              <Section title={t('notice.runningSection')}>
                {running.map((item) => <RunningRow key={item.id} item={item} onNavigate={onClose} />)}
              </Section>
            )}
            {results.length > 0 && (
              <Section title={t('notice.resultSection')}>
                {results.map((item) => <ResultRow key={item.id} item={item} onNavigate={onClose} />)}
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ===== 通用小件 =====

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-1">
      <div className="px-3 py-1 text-2xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
        {title}
      </div>
      {children}
    </div>
  )
}

/**
 * 行外壳：行本身不可点（动作都在行内按钮上），故**不给整行 hover 底色** ——
 * 否则行内图标按钮的 `hover:bg-[var(--color-hover)]` 与行底色同值，点上去看不出反馈。
 * 左侧小圆点 = 未读标记（已读/运行中条目留位但透明，保证各分区文字对齐）。
 */
function NoticeRow({ unread, danger, children }: {
  unread: boolean
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-1.5 px-3 py-2">
      <span
        aria-hidden="true"
        className="flex-shrink-0 rounded-full"
        style={{
          width: 5,
          height: 5,
          marginTop: 5,
          backgroundColor: unread
            ? (danger ? 'var(--color-error)' : 'var(--color-accent)')
            : 'transparent',
        }}
      />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

/** 文字型动作按钮（下载 / 重启安装 / 查看输出 / 全部已读）：高 22px，非 32×32 图标位 */
function TextAction({ label, icon, onClick, tone = 'accent' }: {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  tone?: 'accent' | 'muted'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex items-center gap-1 rounded transition-colors hover:bg-[var(--color-hover)]"
      style={{
        height: 22,
        padding: '0 6px',
        background: 'transparent',
        border: 'none',
        flexShrink: 0,
        cursor: 'pointer',
        fontSize: 'var(--text-2xs)',
        color: tone === 'muted' ? 'var(--color-text-secondary)' : 'var(--color-accent)',
      }}
    >
      {icon}
      {label}
    </button>
  )
}

/** 图标型动作按钮：热区 32×32（图标视觉 12px 不变） */
function IconAction({ label, onClick, children }: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex items-center justify-center rounded transition-colors hover:bg-[var(--color-hover)]"
      style={{
        width: 32,
        height: 32,
        padding: 0,
        flexShrink: 0,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: 'var(--color-text-secondary)',
      }}
    >
      {children}
    </button>
  )
}

/** 单条「标记已读 / 移除」（未读时才给「标记已读」；运行中条目不会用到本组件） */
function RowActions({ id, unread }: { id: string; unread: boolean }) {
  const { t } = useTranslation()
  const markRead = useNoticeStore((s) => s.markRead)
  const dismiss = useNoticeStore((s) => s.dismiss)
  return (
    <div className="flex items-center gap-0.5 flex-shrink-0">
      {unread && (
        <IconAction label={t('notice.markRead')} onClick={() => markRead(id)}>
          <Check size={12} />
        </IconAction>
      )}
      <IconAction label={t('notice.dismiss')} onClick={() => dismiss(id)}>
        <X size={12} />
      </IconAction>
    </div>
  )
}

// ===== 三种行 =====

/** 正在执行：标题 + 当前步骤 + 进度条 + 状态；「任务面板」跳底部任务页 */
function RunningRow({ item, onNavigate }: { item: RunningNotice; onNavigate: () => void }) {
  const { t } = useTranslation()
  return (
    <NoticeRow unread={false}>
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="flex-shrink-0 rounded-full animate-pulse"
          style={{ width: 5, height: 5, backgroundColor: 'var(--color-accent)' }}
        />
        <span className="flex-1 truncate text-xs" style={{ color: 'var(--color-text)' }} title={item.title}>
          {item.title}
        </span>
        <span className="flex-shrink-0 tabular-nums text-2xs" style={{ color: 'var(--color-text-muted)' }}>
          {t('notice.step').replace('{done}', String(item.stepDone)).replace('{total}', String(item.stepTotal))}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-2">
        <span className="flex-1 truncate text-2xs" style={{ color: 'var(--color-text-muted)' }} title={item.stepName}>
          {t(RUN_STATUS_KEY[item.status])}{item.stepName ? ` · ${item.stepName}` : ''}
        </span>
        <TextAction
          label={t('notice.viewTasks')}
          onClick={() => {
            useLayoutStore.getState().openBottomTab('tasks')
            onNavigate()
          }}
        />
      </div>
      <ProgressBar className="mt-1" value={item.percent} height={2} />
    </NoticeRow>
  )
}

/** 任务结果：完成 / 失败，「查看输出」打开右侧 AI 输出面板 */
function ResultRow({ item, onNavigate }: { item: ResultNotice; onNavigate: () => void }) {
  const { t } = useTranslation()
  const failed = item.variant === 'failed'
  return (
    <NoticeRow unread={item.unread} danger={failed}>
      <div className="flex items-start gap-1.5">
        <span
          className="flex-shrink-0"
          style={{ marginTop: 1, color: failed ? 'var(--color-error)' : 'var(--color-success)' }}
        >
          {failed ? <XCircle size={12} /> : <CheckCircle2 size={12} />}
        </span>
        <span
          className="flex-1 truncate text-xs"
          style={{ color: 'var(--color-text)' }}
          title={t(failed ? 'notice.runFailed' : 'notice.runDone').replace('{title}', item.title)}
        >
          {item.title}
        </span>
        <RowActions id={item.id} unread={item.unread} />
      </div>
      <div className="mt-0.5 flex items-center gap-2">
        <span className="flex-1 text-2xs" style={{ color: failed ? 'var(--color-error)' : 'var(--color-text-muted)' }}>
          {t(failed ? 'notice.runFailedLabel' : 'notice.runDoneLabel')}
        </span>
        <TextAction
          label={t('notice.viewOutput')}
          onClick={() => {
            useLayoutStore.getState().openRightPanel('ai-output')
            onNavigate()
          }}
        />
      </div>
    </NoticeRow>
  )
}
