// @vitest-environment jsdom
/**
 * AutomationSection — 设置页「自动化」分区（D 档 T9）
 *
 * 表单是按目标类型 / 触发器类型**条件展开**的；保存时产出的 AutomationTask 形状必须与
 * scheduler/executor 消费的契约一致（targetType + targetRef + triggers[]）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import AutomationSection from './AutomationSection'
import type { AutomationTask } from '../../services/automation/types'

const store = vi.hoisted(() => ({
  tasks: [] as AutomationTask[],
  loadAll: vi.fn(async () => {}),
  // 泛型声明参数类型（供 mock.calls 取用）；实现不读取参数以避免 unused-vars
  saveTask: vi.fn<(task: AutomationTask) => Promise<void>>(async () => {}),
  deleteTask: vi.fn(async () => {}),
  setEnabled: vi.fn(async () => {}),
  runNow: vi.fn(async () => {}),
}))

vi.mock('../../stores/automation-store', () => ({
  useAutomationStore: (selector?: (s: typeof store) => unknown) => (selector ? selector(store) : store),
}))

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(<AutomationSection />) })
  return container
}

const findButton = (text: string) =>
  Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes(text))

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  store.tasks = []
  vi.clearAllMocks()
})

describe('AutomationSection', () => {
  it('无任务时显示空态与「新建」入口', () => {
    const el = render()
    expect(el.textContent).toContain('还没有自动化任务')
    expect(findButton('新建自动化')).toBeTruthy()
  })

  it('已有任务 → 渲染名称、目标与启停开关', () => {
    store.tasks = [{
      id: 'a1', name: '每3章后处理', enabled: true,
      targetType: 'workflow', targetRef: '{"type":"post_process"}',
      sessionStrategy: 'per_run',
      triggers: [{ id: 't1', type: 'chapter_batch', enabled: true, chapterBatchSize: 3 }],
      defaultActionPolicy: 'confirm', createdAt: 1, updatedAt: 1,
    }]
    const el = render()
    expect(el.textContent).toContain('每3章后处理')
    expect(el.textContent).toContain('每 3 章')
  })

  it('点「新建自动化」→ 出现表单（名称 + 目标类型 + 触发器类型 + 处置方式）', () => {
    const el = render()
    act(() => findButton('新建自动化')!.click())
    expect(el.textContent).toContain('名称')
    expect(el.textContent).toContain('执行目标')
    expect(el.textContent).toContain('触发器')
    expect(el.textContent).toContain('处置方式')
  })

  it('保存 → saveTask 收到形状正确的任务（含 triggers 数组与策略）', async () => {
    render()
    act(() => findButton('新建自动化')!.click())
    const nameInput = document.querySelector<HTMLInputElement>('input[data-field="name"]')!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(nameInput, '测试任务')
      nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { findButton('保存')!.click() })
    expect(store.saveTask).toHaveBeenCalledTimes(1)
    const saved = store.saveTask.mock.calls[0][0] as unknown as AutomationTask
    expect(saved.name).toBe('测试任务')
    expect(Array.isArray(saved.triggers)).toBe(true)
    expect(saved.triggers.length).toBeGreaterThan(0)
    expect(['auto_run', 'confirm', 'notify_only']).toContain(saved.defaultActionPolicy)
  })

  it('启停开关 → 调 setEnabled', () => {
    store.tasks = [{
      id: 'a1', name: '任务', enabled: true, targetType: 'agent', targetRef: '写下一章',
      sessionStrategy: 'per_run', triggers: [{ id: 't1', type: 'manual', enabled: true }],
      defaultActionPolicy: 'notify_only', createdAt: 1, updatedAt: 1,
    }]
    render()
    const sw = document.querySelector<HTMLButtonElement>('button[role="switch"]')!
    act(() => sw.click())
    expect(store.setEnabled).toHaveBeenCalledWith('a1', false)
  })
})
