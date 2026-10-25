// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

const { invoke, createBlankChapter, openDraftById } = vi.hoisted(() => ({
  invoke: vi.fn(),
  createBlankChapter: vi.fn(),
  openDraftById: vi.fn(),
}))

vi.mock('../../services/ipc-client', () => ({ ipc: { invoke } }))
vi.mock('../../services/blank-chapter-service', () => ({ createBlankChapter }))
vi.mock('../panels/sidebar/SidebarShared', () => ({ openDraftById }))

import BlankChapterDialog from './BlankChapterDialog'
import { useProjectStore } from '../../stores/project-store'

function render(ui: React.ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(ui) })
  return { container, root }
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function clickByText(text: string): void {
  const el = [...document.body.querySelectorAll('button')].find(n => n.textContent?.trim().includes(text))
  expect(el, `未找到按钮「${text}」`).toBeDefined()
  act(() => { (el as HTMLElement).click() })
}

function makeProject() {
  return {
    id: 'test-id',
    name: '测试项目',
    path: '/tmp/test-project',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    characterStates: '',
    novelConfig: {
      genre: '玄幻', subGenre: '', targetAudience: '', totalChapters: 100, wordsPerChapter: 2000,
      plotStructure: 'three_act', narrativePOV: 'third_limited', coreOutline: '', worldSetting: '',
      goldenFinger: '', protagonistProfile: '', globalGuidance: '', writingStyle: '', referenceWorks: '',
    },
  }
}

async function flush(): Promise<void> {
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

describe('BlankChapterDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    invoke.mockReset()
    createBlankChapter.mockReset()
    openDraftById.mockReset()
    useProjectStore.setState({ currentProject: makeProject() as never })
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db:blueprint-get-all') return [{ chapterNumber: 2 }, { chapterNumber: 1 }]
      if (channel === 'db:draft-get-all-chapter-numbers') return [4]
      return null
    })
  })

  it('默认章号为蓝图/草稿最大值 +1，提交后创建并打开草稿', async () => {
    createBlankChapter.mockResolvedValue({ kind: 'created', chapterNumber: 5, draftId: 42, version: 1, title: '雨夜' })
    openDraftById.mockResolvedValue(true)
    const onClose = vi.fn()
    const { root } = render(<BlankChapterDialog open onClose={onClose} />)
    await flush()

    const numberInput = document.body.querySelector('input[type="number"]') as HTMLInputElement
    expect(numberInput?.value).toBe('5')
    const titleInput = document.body.querySelector('input[placeholder*="雨夜来客"]') as HTMLInputElement
    expect(titleInput).toBeTruthy()
    setInputValue(titleInput, '雨夜')
    clickByText('创建并开始写')
    await flush()

    expect(createBlankChapter).toHaveBeenCalledWith({ chapterNumber: 5, title: '雨夜' })
    expect(openDraftById).toHaveBeenCalledWith({
      draftId: 42, chapterNumber: 5, chapterTitle: '雨夜', version: 1,
    })
    expect(onClose).toHaveBeenCalled()
    act(() => { root.unmount() })
  })

  it('已有草稿时打开最新版本并关闭', async () => {
    createBlankChapter.mockResolvedValue({ kind: 'existing', chapterNumber: 5, draftId: 7, version: 2, title: '' })
    openDraftById.mockResolvedValue(true)
    const onClose = vi.fn()
    const { root } = render(<BlankChapterDialog open onClose={onClose} />)
    await flush()

    clickByText('创建并开始写')
    await flush()

    expect(openDraftById).toHaveBeenCalledWith({
      draftId: 7, chapterNumber: 5, chapterTitle: undefined, version: 2,
    })
    expect(onClose).toHaveBeenCalled()
    act(() => { root.unmount() })
  })

  it('没有项目时显示提示并禁用创建', async () => {
    useProjectStore.setState({ currentProject: null })
    const { root } = render(<BlankChapterDialog open onClose={() => {}} />)
    await flush()

    expect(document.body.textContent).toContain('请先打开项目')
    const create = [...document.body.querySelectorAll('button')].find(n => n.textContent?.includes('创建并开始写')) as HTMLButtonElement
    expect(create?.disabled).toBe(true)
    act(() => { root.unmount() })
  })
})