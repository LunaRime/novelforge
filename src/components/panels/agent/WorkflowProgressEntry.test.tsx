// @vitest-environment jsdom
/**
 * WorkflowProgressEntry — 对话内工作流进度入口契约（线② 2b）
 *
 * 有活跃工作流时渲染单行折叠组（标题 + 步骤计数摘要 + 状态点）；展开显示各 run；
 * 点击 run 跳转底部任务面板。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import WorkflowProgressEntry from './WorkflowProgressEntry'
import type { WorkflowRun } from '../../../stores/workflow-store'
import { t } from '../../../shared/locale'

const mockOpenBottomTab = vi.hoisted(() => vi.fn())

const RUN: WorkflowRun = {
  id: 'run-1',
  type: 'chapter_creation',
  title: '第 1 章创作',
  status: 'running',
  currentStepIndex: 1,
  createdAt: '2026-10-13T10:00:00.000Z',
  steps: [
    { id: 's1', name: '写稿', description: '', status: 'completed', logs: [], result: 'x' },
    { id: 's2', name: '修稿', description: '', status: 'running', logs: [] },
    { id: 's3', name: '审稿', description: '', status: 'pending', logs: [] },
  ],
}

vi.mock('../../../stores/workflow-store', () => ({
  useWorkflowStore: (selector?: (s: unknown) => unknown) => {
    const state = { activeRuns: [RUN] }
    return selector ? selector(state) : state
  },
}))

vi.mock('../../../stores/layout-store', () => ({
  useLayoutStore: (selector?: (s: unknown) => unknown) => {
    const state = { openBottomTab: mockOpenBottomTab }
    return selector ? selector(state) : state
  },
}))

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(node: React.ReactNode): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(node) })
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  mockOpenBottomTab.mockClear()
})

describe('WorkflowProgressEntry — 对话内进度入口（线② 2b）', () => {
  it('有活跃工作流 → 渲染标题「工作流」+ 状态点（running→ongoing）', () => {
    const el = render(<WorkflowProgressEntry />)
    expect(el.textContent).toContain('工作流')
    expect(el.querySelector('svg[data-state="ongoing"]')).toBeTruthy()
  })

  it('running 时自动展开，展开显示各 run（标题 + 步骤进度 + 状态）', () => {
    const el = render(<WorkflowProgressEntry />)
    expect(el.textContent).toContain('第 1 章创作')
    expect(el.textContent).toContain('1/3')
    expect(el.textContent).toContain('执行中')
  })

  it('手动收起 → 行尾摘要改 chip：「步骤 1/3」+「运行中 1」，旧 `·` 串与裸任务数都不再出现', () => {
    const el = render(<WorkflowProgressEntry />)
    // 整行（role=button）toggle 收起
    const row = el.querySelector('[role="button"]') as HTMLElement
    expect(row).toBeTruthy()
    act(() => { row.click() })

    const chips = [...el.querySelectorAll('[data-metric-chip]')] as HTMLElement[]
    expect(chips).toHaveLength(2)
    // 步骤 chip：已完成 / 总数（口径 = 各 run 的 completed 步骤 / 总步骤）
    const steps = chips.find(c => c.textContent?.includes(t('metric.workflowSteps')))!
    expect(steps.querySelector('[data-metric-value]')!.textContent).toBe('1/3')
    expect(steps.getAttribute('title')).toBe(t('metric.workflowStepsHint'))
    // 运行中 chip：并发任务数（= activeRuns.length）—— 原来行尾那个裸数字由它承担，不再重复
    const runningChip = chips.find(c => c.textContent?.includes(t('metric.runningTasks')))!
    expect(runningChip.querySelector('[data-metric-value]')!.textContent).toBe('1')
    expect(runningChip.getAttribute('title')).toBe(t('metric.runningTasksHint'))

    // 行尾只剩状态点（整体状态语义），没有第二个数字
    const tail = el.querySelector('[data-metric-row]')!.nextElementSibling as HTMLElement
    expect(tail.querySelector('svg')).toBeTruthy()
    expect(tail.textContent?.trim()).toBe('')
    // 旧 `·` 串摘要（「已完成 N 步 · 运行中 M」形态）已不再渲染 —— 那条文案本轮已随死 key 一并删除，
    // 留这条字面量断言只为拦"手工回流"
    expect(el.textContent).not.toContain('已完成 1 步')
  })

  it('点击 run → openBottomTab("tasks")', () => {
    const el = render(<WorkflowProgressEntry />)
    const runBtn = [...el.querySelectorAll('button')].find(b => b.textContent?.includes('第 1 章创作'))
    expect(runBtn).toBeTruthy()
    act(() => { runBtn!.click() })
    expect(mockOpenBottomTab).toHaveBeenCalledWith('tasks')
  })

  it('无 button 嵌 button', () => {
    const el = render(<WorkflowProgressEntry />)
    expect(el.querySelectorAll('button button')).toHaveLength(0)
  })
})
