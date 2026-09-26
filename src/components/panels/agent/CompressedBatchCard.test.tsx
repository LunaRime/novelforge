// @vitest-environment jsdom
/**
 * CompressedBatchCard 测试（B 档第二轮 T7）
 *
 * 靶点：卡片此前用「originalTokens − 摘要 tokens」估算节省（不等于真实请求降幅，
 * 也不含注入截断），且展开原文读的是**已被清空**的 inline 数组。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import CompressedBatchCard from './CompressedBatchCard'
import type { CompressedBatch } from '../../../services/agent/archive-codec'

const storeMock = vi.hoisted(() => ({
  removeCompaction: vi.fn(async () => {}),
  loadBatchOriginal: vi.fn(async () => [
    { id: 'o1', role: 'user' as const, content: '被压缩的原文', createdAt: 1 },
  ]),
}))

vi.mock('../../../stores/agent-store', () => ({
  useAgentStore: (selector?: (s: typeof storeMock) => unknown) => (selector ? selector(storeMock) : storeMock),
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

const batch = (over: Partial<CompressedBatch> = {}): CompressedBatch => ({
  batch: 1,
  original: [],
  summary: '摘要内容',
  compressedAt: 1,
  originalTokens: 3000,
  originalBytes: 12000,
  recoverable: true,
  beforeTokens: 4000,
  afterTokens: 500,
  changeTokens: 3500,
  ...over,
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.clearAllMocks()
})

describe('CompressedBatchCard（B 档第二轮 T7）', () => {
  it('展示真实降幅（before → after），而非旧估算', () => {
    const el = render(<CompressedBatchCard batch={batch()} />)
    expect(el.textContent).toContain('4000')
    expect(el.textContent).toContain('500')
  })

  it('回执独立成段展示（不混在摘要正文里）', () => {
    const el = render(<CompressedBatchCard batch={batch({
      summary: '摘要内容\n\n本段已执行的操作（回执）：\n- write_file → drafts/c1.md (ok)',
    })} />)
    expect(el.textContent).toContain('write_file → drafts/c1.md (ok)')
  })

  it('recoverable=false → 展开显示「原文不可用」且不去读分卷', async () => {
    const el = render(<CompressedBatchCard batch={batch({ recoverable: false })} />)
    const btn = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes('展开'))!
    await act(async () => { btn.click() })
    expect(el.textContent).toContain('原文不可用')
    expect(storeMock.loadBatchOriginal).not.toHaveBeenCalled()
  })

  it('展开原文：按需从分卷读（而非读已被清空的 inline 数组）', async () => {
    const el = render(<CompressedBatchCard batch={batch()} />)
    const btn = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes('展开'))!
    await act(async () => { btn.click() })
    expect(storeMock.loadBatchOriginal).toHaveBeenCalled()
  })

  it('「移除该压缩」→ 调 store 的 removeCompaction', async () => {
    const el = render(<CompressedBatchCard batch={batch()} />)
    const btn = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes('移除'))!
    await act(async () => { btn.click() })
    expect(storeMock.removeCompaction).toHaveBeenCalledWith(1)
  })
})
