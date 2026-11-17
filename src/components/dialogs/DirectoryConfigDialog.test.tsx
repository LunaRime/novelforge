// @vitest-environment jsdom
/**
 * DirectoryConfigDialog — 蓝图生成配置弹窗测试
 *
 * 验证：
 * - 默认单次生成：confirm 后 generationMode='single' 且无 batchChapterCount
 * - 切换分批生成 + 每批章数：confirm 后 generationMode='batch' + batchChapterCount 正确传递
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import DirectoryConfigDialog from './DirectoryConfigDialog'
import { useProjectStore } from '../../stores/project-store'
import type { DirectoryWorkflowParams } from '../../services/workflows/directory-workflow'

// mock IPC（volume-store.load 使用 db:volume-get-all 等通道）
vi.mock('../../services/ipc-client', () => ({
  ipc: { invoke: vi.fn(async () => []) },
}))

function render(ui: React.ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(ui) })
  return { container, root }
}

function clickByText(text: string): void {
  // 限定 button/label（label 内含输入框文本，需 includes 匹配）
  const el = [...document.body.querySelectorAll('button, label')].find(n =>
    n.textContent?.trim().includes(text),
  ) as HTMLElement | undefined
  expect(el, `未找到文本「${text}」`).toBeDefined()
  act(() => { el!.click() })
}

describe('DirectoryConfigDialog 生成方式', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    useProjectStore.setState({
      currentProject: {
        id: 'test-id',
        name: '测试项目',
        path: 'E:\\test\\project',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        characterStates: '',
        novelConfig: {
          genre: '玄幻',
          subGenre: '',
          targetAudience: '',
          totalChapters: 100,
          wordsPerChapter: 2000,
          plotStructure: 'three_act',
          narrativePOV: 'third_limited',
          coreOutline: '',
          worldSetting: '',
          goldenFinger: '',
          protagonistProfile: '',
          globalGuidance: '',
          writingStyle: '',
          referenceWorks: '',
        },
      },
    })
  })

  it('全书范围使用默认数量并可通过工作流参数校验', () => {
    const onConfirm = vi.fn()
    const { root } = render(<DirectoryConfigDialog isOpen onClose={() => {}} existingCount={2} onConfirm={onConfirm} />)
    clickByText('全量生成（共 100 章）')
    clickByText('覆盖模式')
    const start = [...document.body.querySelectorAll('button')].find(button => button.textContent?.trim() === '开始生成')
    expect(start).toBeDefined()
    act(() => { start!.click() })
    expect(onConfirm.mock.calls[0][0].mode).toBe('full')
    expect(onConfirm.mock.calls[0][0].expectedTotalChapters).toBe(100)
    expect(onConfirm.mock.calls[0][0].count).toBeUndefined()
    act(() => { root.unmount() })
  })

  it('按数量续写让工作流从实际目录末尾推导起点', () => {
    const onConfirm = vi.fn()
    const { root } = render(<DirectoryConfigDialog isOpen onClose={() => {}} existingCount={2} onConfirm={onConfirm} />)
    const start = [...document.body.querySelectorAll('button')].find(button => button.textContent?.trim() === '开始生成')
    expect(start).toBeDefined()
    act(() => { start!.click() })
    expect(onConfirm.mock.calls[0][0]).toMatchObject({ mode: 'append', count: 50 })
    expect(onConfirm.mock.calls[0][0].startChapter).toBeUndefined()
    act(() => { root.unmount() })
  })

  it('默认单次生成：confirm 后 generationMode=single 且无 batchChapterCount', () => {
    let captured: DirectoryWorkflowParams | null = null
    const { root } = render(
      <DirectoryConfigDialog
        isOpen
        onClose={() => {}}
        existingCount={0}
        onConfirm={(p) => { captured = p }}
      />,
    )

    clickByText('开始生成')

    expect(captured).not.toBeNull()
    expect(captured!.generationMode).toBe('single')
    expect(captured!.batchChapterCount).toBeUndefined()
    act(() => { root.unmount() })
  })

  it('切换分批生成 + 每批 15 章：confirm 后参数正确传递', () => {
    let captured: DirectoryWorkflowParams | null = null
    const { root } = render(
      <DirectoryConfigDialog
        isOpen
        onClose={() => {}}
        existingCount={0}
        onConfirm={(p) => { captured = p }}
      />,
    )

    clickByText('分批生成')

    // 修改每批章数输入框为 15（受控组件需 native setter 触发 onChange）
    // 注意：对话框内有多个 number input（范围区 frontN + 每批章数），必须在「分批生成」label 内查找
    const batchLabel = [...document.body.querySelectorAll('label')].find(n =>
      n.textContent?.includes('分批生成'),
    )
    expect(batchLabel).toBeDefined()
    const input = batchLabel!.querySelector('input') as HTMLInputElement | undefined
    expect(input).toBeDefined()
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setter.call(input, '15')
      input!.dispatchEvent(new Event('input', { bubbles: true }))
    })

    clickByText('开始生成')

    expect(captured).not.toBeNull()
    expect(captured!.generationMode).toBe('batch')
    expect(captured!.batchChapterCount).toBe(15)
    act(() => { root.unmount() })
  })

  it('每批章数空/非法输入回退为 10', () => {
    let captured: DirectoryWorkflowParams | null = null
    const { root } = render(
      <DirectoryConfigDialog
        isOpen
        onClose={() => {}}
        existingCount={0}
        onConfirm={(p) => { captured = p }}
      />,
    )

    clickByText('分批生成')

    const batchLabel = [...document.body.querySelectorAll('label')].find(n =>
      n.textContent?.includes('分批生成'),
    )
    expect(batchLabel).toBeDefined()
    const input = batchLabel!.querySelector('input') as HTMLInputElement | undefined
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setter.call(input, '0') // 非法值
      input!.dispatchEvent(new Event('input', { bubbles: true }))
      input!.blur() // 触发 onBlur 回退
    })

    clickByText('开始生成')

    expect(captured!.generationMode).toBe('batch')
    expect(captured!.batchChapterCount).toBe(10)
    act(() => { root.unmount() })
  })
})
