// @vitest-environment jsdom
/**
 * NotificationCenter — 状态栏「消息收纳中心」契约（2026-10 六项 UI 改进 · 第 1 项）
 *
 * 覆盖口径（docs/ui-6items-plan.md §2.1）：
 * - 派生式：同一 run 反复 sync 只出一条（按稳定 id 去重）
 * - 未读数 = 未读条目数；**运行中条目不计未读**
 * - 运行中条目永远置顶、不可被移除
 * - 空态文案；无未读不显角标（不显 0）；「全部已读」后角标消失
 * - 分区顺序：正在执行 → 应用更新 → 任务结果
 * - 浮层 Esc 关闭；已读集合持久化（坏 JSON 回落全未读，不崩）
 *
 * 用**真实 store + 直接 setState 摆状态**（与 WorkflowProgressEntry/AgentMessage 同款），
 * 不 mock 选择器 —— 派生逻辑本身就是要被验证的对象。
 * 注意：没有挂载组件时没人订阅来源 store，故摆完状态要显式 `sync()`（setSource 已封装）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import NotificationCenter from './NotificationCenter'
import { countUnread, useNoticeStore } from '../../stores/notice-store'
import { useWorkflowStore, type WorkflowRun } from '../../stores/workflow-store'
import { useUpdateStore } from '../../stores/update-store'

const RUNNING_ID = 'run:r-running:running'
const DONE_ID = 'run:r-done:completed'

function makeRun(id: string, over: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id,
    type: 'chapter_creation',
    title: `任务 ${id}`,
    status: 'completed',
    currentStepIndex: 0,
    createdAt: '2026-10-13T10:00:00.000Z',
    steps: [
      { id: 's1', name: '写稿', description: '', status: 'completed', logs: [] },
      { id: 's2', name: '修稿', description: '', status: 'pending', logs: [] },
    ],
    ...over,
  }
}

const RUNNING_RUN = makeRun('r-running', { status: 'running', currentStepIndex: 1 })

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(<NotificationCenter />) })
  return container
}

/** 摆来源 store 状态并重派生（组件挂载与否都成立：sync 幂等） */
function setSource(mutate: () => void): void {
  act(() => {
    mutate()
    useNoticeStore.getState().sync()
  })
}

/** 打开弹层（弹层未开时容器里只有铃铛一个 button） */
function openPanel(el: HTMLElement): void {
  const bell = el.querySelector('button') as HTMLElement
  expect(bell).toBeTruthy()
  act(() => { bell.click() })
}

function badge(el: HTMLElement): Element | null {
  return el.querySelector('[data-testid="notice-unread-badge"]')
}

beforeEach(() => {
  localStorage.clear()
  // seeded: true = 按「非首次运行」摆状态（大多数用例关心的是常规派生路径）；
  // 首次运行 seed 的两个用例会显式置回 false 并保留空的 localStorage
  useNoticeStore.setState({ items: [], readIds: [], dismissedIds: [], seeded: true })
  useWorkflowStore.setState({ activeRuns: [], history: [] })
  useUpdateStore.setState({ status: 'idle', updateInfo: null, downloadProgress: null, error: null })
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('NotificationCenter — 派生与未读', () => {
  it('同一 run 反复 sync 只派生一条（按 id 去重）', () => {
    setSource(() => useWorkflowStore.setState({ history: [makeRun('r-done'), makeRun('r-done')] }))
    act(() => {
      useNoticeStore.getState().sync()
      useNoticeStore.getState().sync()
    })

    const items = useNoticeStore.getState().items
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe(DONE_ID)
    expect(countUnread(items)).toBe(1)
  })

  it('运行中条目置顶、不可移除、且不计未读', () => {
    setSource(() => {
      useWorkflowStore.setState({ activeRuns: [RUNNING_RUN], history: [makeRun('r-done')] })
    })

    const items = useNoticeStore.getState().items
    expect(items[0].id).toBe(RUNNING_ID)
    expect(items[0].kind).toBe('running')
    expect(items[0].pinned).toBe(true)
    // 只有结果条目算未读；运行中条目没有「已读」语义
    expect(countUnread(items)).toBe(1)

    // 移除运行中条目 → 仍在列表里
    act(() => { useNoticeStore.getState().dismiss(RUNNING_ID) })
    expect(useNoticeStore.getState().items.some((i) => i.id === RUNNING_ID)).toBe(true)

    // 全部已读 → 未读归零，运行中条目依旧在
    act(() => { useNoticeStore.getState().markAllRead() })
    expect(countUnread(useNoticeStore.getState().items)).toBe(0)
    expect(useNoticeStore.getState().items.some((i) => i.id === RUNNING_ID)).toBe(true)
  })

  it('已移除的结果条目不再出现，也不会被下一次 sync 派生回来', () => {
    setSource(() => useWorkflowStore.setState({ history: [makeRun('r-done')] }))
    act(() => { useNoticeStore.getState().dismiss(DONE_ID) })
    act(() => { useNoticeStore.getState().sync() })

    expect(useNoticeStore.getState().items.some((i) => i.id === DONE_ID)).toBe(false)
    expect(countUnread(useNoticeStore.getState().items)).toBe(0)
  })

  it('已读集合写进 localStorage「vela-notice」', () => {
    setSource(() => useWorkflowStore.setState({ history: [makeRun('r-done')] }))
    act(() => { useNoticeStore.getState().markAllRead() })

    const raw = localStorage.getItem('vela-notice')
    expect(raw).toBeTruthy()
    expect((JSON.parse(raw as string) as { read: string[] }).read).toContain(DONE_ID)
  })
})

describe('NotificationCenter — 首次运行 seed', () => {
  it('真正首次运行（无 vela-notice 键）：已存在的条目一次性记为已读，角标不显示', () => {
    // beforeEach 已清空 localStorage → 无键 = 真正首次运行
    act(() => {
      useWorkflowStore.setState({ history: [makeRun('r-old'), makeRun('r-old2')] })
      useNoticeStore.setState({ seeded: false })
    })

    const el = render()
    expect(badge(el)).toBeNull()
    expect(countUnread(useNoticeStore.getState().items)).toBe(0)

    const raw = localStorage.getItem('vela-notice')
    expect(raw).toBeTruthy()
    const persisted = JSON.parse(raw as string) as { read: string[] }
    expect(persisted.read).toContain('run:r-old:completed')
    expect(persisted.read).toContain('run:r-old2:completed')
  })

  it('seed 只作用于「启动前已存在」的条目：之后新完成的 run 照常未读', () => {
    act(() => {
      useWorkflowStore.setState({ history: [makeRun('r-old')] })
      useNoticeStore.setState({ seeded: false })
    })

    const el = render()
    expect(badge(el)).toBeNull() // 旧条目已 seed

    // 本次会话新完成的 run（history 最新在前）→ 未读角标出现
    setSource(() => useWorkflowStore.setState({ history: [makeRun('r-new'), makeRun('r-old')] }))
    expect(badge(el)?.textContent).toBe('1')
  })

  it('键已存在（含空数组）→ 不 seed，尊重用户已读状态', () => {
    localStorage.setItem('vela-notice', JSON.stringify({ read: [], dismissed: [] }))
    act(() => {
      useWorkflowStore.setState({ history: [makeRun('r-old')] })
      useNoticeStore.setState({ seeded: false })
    })

    const el = render()
    expect(badge(el)?.textContent).toBe('1')
  })
})

describe('NotificationCenter — 入口与弹层', () => {
  it('空态：无未读不显角标，弹层显示空态文案', () => {
    const el = render()
    expect(badge(el)).toBeNull()

    openPanel(el)
    expect(el.textContent).toContain('暂无通知')
    expect(el.querySelectorAll('[data-testid="notice-unread-badge"]')).toHaveLength(0)
  })

  it('未读角标显示条目数；「全部已读」后角标消失', () => {
    const el = render()
    setSource(() => {
      useWorkflowStore.setState({ history: [makeRun('r-done')] })
    })

    expect(badge(el)?.textContent).toBe('1')

    openPanel(el)
    const markAll = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('全部已读'))
    expect(markAll).toBeTruthy()
    act(() => { markAll!.click() })

    expect(badge(el)).toBeNull()
  })

  it('入口按钮带 aria-label / title（未读时含条数）', () => {
    const el = render()
    setSource(() => useWorkflowStore.setState({ history: [makeRun('r-done')] }))

    const bell = el.querySelector('button') as HTMLElement
    expect(bell.getAttribute('aria-label')).toContain('1')
    expect(bell.getAttribute('title')).toBe(bell.getAttribute('aria-label'))
  })

  it('分区顺序：正在执行 → 任务结果', () => {
    const el = render()
    setSource(() => {
      useWorkflowStore.setState({ activeRuns: [RUNNING_RUN], history: [makeRun('r-done')] })
    })

    openPanel(el)

    const text = el.textContent ?? ''
    const iRunning = text.indexOf('正在执行')
    const iResult = text.indexOf('任务结果')
    expect(iRunning).toBeGreaterThanOrEqual(0)
    expect(iResult).toBeGreaterThan(iRunning)
    // 运行中行 = 当前步骤 + 步骤计数
    expect(text).toContain('修稿')
    expect(text).toContain('1/2 步')
  })

  it('应用更新不再进入通知中心', () => {
    setSource(() => {
      useUpdateStore.setState({ status: 'available', updateInfo: { version: '9.9.9' } as never })
    })
    const el = render()
    openPanel(el)
    expect(el.textContent).not.toContain('应用更新')
  })

  it('弹层 Esc 可关（浮层四件套之一）', () => {
    const el = render()
    openPanel(el)
    expect(el.querySelector('[role="dialog"]')).toBeTruthy()

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(el.querySelector('[role="dialog"]')).toBeNull()
  })

  it('弹层内图标按钮热区 32×32 且带 aria-label', () => {
    const el = render()
    setSource(() => useWorkflowStore.setState({ history: [makeRun('r-done')] }))
    openPanel(el)

    const dismiss = el.querySelector('button[aria-label="移除该通知"]') as HTMLElement
    expect(dismiss).toBeTruthy()
    expect(dismiss.style.width).toBe('32px')
    expect(dismiss.style.height).toBe('32px')
  })

  it('「查看输出」跳转后关闭弹层', () => {
    const el = render()
    setSource(() => useWorkflowStore.setState({ history: [makeRun('r-done')] }))
    openPanel(el)

    const viewOutput = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('查看输出'))
    expect(viewOutput).toBeTruthy()
    act(() => { viewOutput!.click() })

    expect(el.querySelector('[role="dialog"]')).toBeNull()
  })
})

describe('notice-store — 持久化降级（重置模块注册表后重新求值）', () => {
  it('合法 JSON 读回已读/已移除；坏 JSON 回落空集合且不抛', async () => {
    localStorage.setItem('vela-notice', JSON.stringify({
      read: ['run:a:completed'],
      dismissed: ['run:b:failed'],
    }))
    vi.resetModules()
    const ok = await import('../../stores/notice-store')
    expect(ok.useNoticeStore.getState().readIds).toEqual(['run:a:completed'])
    expect(ok.useNoticeStore.getState().dismissedIds).toEqual(['run:b:failed'])

    localStorage.setItem('vela-notice', '{ not json at all')
    vi.resetModules()
    const bad = await import('../../stores/notice-store')
    expect(bad.useNoticeStore.getState().readIds).toEqual([])
    expect(bad.useNoticeStore.getState().dismissedIds).toEqual([])
  })
})
