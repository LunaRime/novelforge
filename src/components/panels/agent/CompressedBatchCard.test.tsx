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
import { UI_TEXTS } from '../../../shared/locale'

const storeMock = vi.hoisted(() => ({
  removeCompaction: vi.fn(async () => {}),
  // P1-3：返回失败文案（null = 成功）——卡片据此给内联提示
  regenerateBatchSummary: vi.fn(async (): Promise<string | null> => null),
  generating: false,
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

  it('回执拆段按**全语变体**匹配：存档用 en-US 标题、界面 zh-CN 也能拆出来（切语言不退化）', () => {
    const enHeader = (UI_TEXTS as Record<string, Record<string, string>>)['ccr.receiptsHeader']['en-US']
    const el = render(<CompressedBatchCard batch={batch({
      summary: `${enHeader}\n- write_file → drafts/c1.md (ok)\n\n摘要正文`,
    })} />)
    // 回执头独立成段（text-micro 那行）→ 说明匹配成功；失败时会整条落在摘要正文里
    const headerRow = Array.from(el.querySelectorAll('div.text-micro')).find(d => d.textContent === enHeader)
    expect(headerRow).toBeTruthy()
    const body = el.querySelector('.whitespace-pre-wrap')
    expect(body?.textContent).toContain('摘要正文')
    expect(body?.textContent).not.toContain('write_file')
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

  it('可供性契约（2026-09-27）：通知文案（含计数）即主按钮——可聚焦、可点击展开、无 button 嵌套', async () => {
    const el = render(<CompressedBatchCard batch={batch()} />)
    // 主按钮 = textContent 含真实降幅计数的那个按钮（此前 savedTokens / before → after 在无热区 span 上）
    const main = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes('4000'))!
    expect(main).toBeTruthy()
    main.focus()
    expect(document.activeElement).toBe(main)
    expect(el.querySelectorAll('button button')).toHaveLength(0)
    await act(async () => { main.click() })
    expect(storeMock.loadBatchOriginal).toHaveBeenCalled()
  })

  // ===== P1-3：摘要重生成入口 =====
  it('P1-3：批次失效（invalidated）出现「重生成摘要」→ 调 regenerateBatchSummary', async () => {
    const el = render(<CompressedBatchCard batch={batch({ invalidated: true })} />)
    const btn = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes('重生成'))!
    expect(btn).toBeTruthy()
    await act(async () => { btn.click() })
    expect(storeMock.regenerateBatchSummary).toHaveBeenCalledWith(1)
  })

  it('P1-3：会话级失效（summaryStale）同样给出入口；健康批次不出现', () => {
    const stale = render(<CompressedBatchCard batch={batch()} summaryStale />)
    expect(Array.from(stale.querySelectorAll('button')).some(b => b.textContent?.includes('重生成'))).toBe(true)
  })

  it('P1-3：健康批次不出现重生成入口（避免无失效时误触重算）', () => {
    const el = render(<CompressedBatchCard batch={batch()} />)
    expect(Array.from(el.querySelectorAll('button')).some(b => b.textContent?.includes('重生成'))).toBe(false)
  })

  it('P1-3：重生成失败 → 卡片内联展示 store 返回的文案（不再只进 LogsView）', async () => {
    storeMock.regenerateBatchSummary.mockResolvedValueOnce('摘要重生成失败：分卷已丢失')
    const el = render(<CompressedBatchCard batch={batch({ invalidated: true })} />)
    const btn = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes('重生成'))!
    await act(async () => { btn.click() })
    expect(el.textContent).toContain('摘要重生成失败：分卷已丢失')
  })

  it('P1-3：成功（返回 null）→ 不出现内联错误', async () => {
    const el = render(<CompressedBatchCard batch={batch({ invalidated: true })} />)
    const btn = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes('重生成'))!
    await act(async () => { btn.click() })
    expect(el.textContent).not.toContain('失败')
  })

  // ===== P1-2：保真告警标注 =====
  it('P1-2：保真缺失达阈值 → 卡片出现「可能丢细节」标注（含保留计数）', () => {
    const el = render(<CompressedBatchCard batch={batch({ fidelity: { extracted: 8, retained: 3, ratio: 0.375 } })} />)
    expect(el.textContent).toContain('可能丢细节')
    expect(el.textContent).toContain('3/8')
  })

  it('P1-2：保真达标 → 不标注（旧档案无 fidelity 字段同理，见既有用例）', () => {
    const el = render(<CompressedBatchCard batch={batch({ fidelity: { extracted: 8, retained: 7, ratio: 0.875 } })} />)
    expect(el.textContent).not.toContain('可能丢细节')
  })
})
