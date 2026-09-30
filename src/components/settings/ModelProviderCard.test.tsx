// @vitest-environment jsdom
/**
 * ModelProviderCard —— 一体卡（2026-09-28 v2）
 *
 * 契约：卡 = 凭据（头）+ 模型行（**倒序**显示——新添加在最上；行带类型标签；操作常驻 32×32）；
 * 行内编辑沿用 ModelForm（切换保护保留）；账户卡的「+ 添加模型」→ ModelPickerDialog 多选采纳
 * （saveProvider 合并 modelNames + specs）；删除账户卡的行 = **取消勾选**（走 saveProvider），
 * 「其他」卡（account=null）删除走 deleteModel 且无添加入口。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { ModelProviderCard } from './ModelProviderCard'
import type { ModelProfile, ProviderAccount } from '../../shared/ipc-channels'

const state = vi.hoisted(() => ({
  defaultModelId: 'gen-1' as string | null,
  defaultEmbeddingModelId: null as string | null,
  saveModel: vi.fn<(m: ModelProfile) => Promise<boolean>>(async () => true),
  deleteModel: vi.fn(async () => {}),
  saveProvider: vi.fn(async () => true),
  setDefaultModel: vi.fn(async () => {}),
  setDefaultEmbeddingModel: vi.fn(async () => {}),
  listProviderModels: vi.fn(async () => ({
    success: true,
    models: [{ id: 'new-a', contextWindow: 1000 }, { id: 'new-b' }],
  })),
}))

vi.mock('../../stores/llm-store', () => ({
  useLLMStore: Object.assign(
    (selector: (s: typeof state) => unknown) => selector(state),
    { getState: () => state },
  ),
}))

const ACCOUNT: ProviderAccount = {
  id: 'acct-1', provider: 'custom', protocol: 'openai',
  apiKey: 'sk-x', baseUrl: 'https://gw.example.com', modelNames: ['gen-1', 'gen-2'],
}

/** 行 fixture：id 与 modelName 对齐名册语义（modelNames 存的是 modelName；显示名同值） */
const makeModel = (id: string, modelName: string, purposes: string[] = ['generation']): ModelProfile => ({
  id, name: modelName, provider: 'custom', protocol: 'openai',
  modelName, apiKey: 'sk-x', baseUrl: 'https://gw.example.com',
  temperature: 0.7, maxTokens: 4096, contextWindow: 4096, purposes,
} as unknown as ModelProfile)

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(account: ProviderAccount | null, models: ModelProfile[]) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(<ModelProviderCard account={account} models={models} />) })
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.clearAllMocks()
  state.saveModel.mockImplementation(async () => true)
})

const buttonByLabel = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`)]

/** 点确认框（命令式 Confirm 挂 body 末尾）的确认按钮并等退出动画 */
async function confirmDialog(confirmText = '删除') {
  await act(async () => {
    const box = document.body.lastElementChild as HTMLElement
    const okBtn = [...box.querySelectorAll('button')].find(b => b.textContent?.trim() === confirmText)
    okBtn!.click()
    await new Promise(r => setTimeout(r, 300))
  })
}

describe('ModelProviderCard 一体卡', () => {
  it('行倒序显示（新添加的在最上）', () => {
    const el = render(ACCOUNT, [makeModel('m1', 'gen-1'), makeModel('m2', 'gen-2')])
    const text = el.textContent ?? ''
    expect(text.indexOf('gen-2')).toBeLessThan(text.indexOf('gen-1'))
  })

  it('行带类型标签：embedding 行显示「向量」', () => {
    const el = render(ACCOUNT, [makeModel('emb-1', 'bge-m3', ['embedding'])])
    expect(el.textContent).toContain('向量')
  })

  it('行操作按钮常驻 32×32 + aria-label（编辑/删除；非默认行含设默认）', () => {
    render(ACCOUNT, [makeModel('m2', 'gen-2')])
    const ops = ['设为默认', '编辑', '删除'].flatMap(buttonByLabel)
    expect(ops).toHaveLength(3)
    for (const b of ops) {
      expect(b.className).not.toContain('opacity-0')
      expect(b.style.width).toBe('32px')
      expect(b.style.height).toBe('32px')
    }
  })

  it('行内编辑：点「编辑」→ 该位展开表单，卡内其余行仍在', () => {
    const el = render(ACCOUNT, [makeModel('m1', 'gen-1'), makeModel('m2', 'gen-2')])
    act(() => { buttonByLabel('编辑')[0].click() })
    expect(el.textContent).toContain('编辑：') // ModelForm 标题
    const rows = [...el.querySelectorAll('button[aria-label="编辑"]')]
    expect(rows.length).toBeGreaterThanOrEqual(1) // 其余行的编辑按钮还在
  })

  it('账户卡删除行 = 取消勾选（有确认）：saveProvider 收到移除该模型名的 modelNames', async () => {
    render(ACCOUNT, [makeModel('m1', 'gen-1'), makeModel('m2', 'gen-2')])
    await act(async () => {
      buttonByLabel('删除')[0].click() // 倒序后第一个 = gen-2
      await new Promise(r => setTimeout(r, 10))
    })
    await confirmDialog()
    expect(state.deleteModel).not.toHaveBeenCalled()
    expect(state.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'acct-1', modelNames: ['gen-1'] }),
      undefined,
    )
  })

  it('「+ 添加模型」→ Picker 拉取 → 采纳 → saveProvider 合并 modelNames + specs', async () => {
    const el = render({ ...ACCOUNT, modelNames: ['gen-1'] }, [makeModel('m1', 'gen-1')])
    act(() => {
      const add = [...el.querySelectorAll('button')].find(b => b.textContent?.includes('添加模型'))
      add!.click()
    })
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    // Picker 已在 body（Dialog Portal）：勾选 new-a 后采纳
    const boxes = [...document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    act(() => { boxes[0].click() })
    await act(async () => {
      const adopt = [...document.body.querySelectorAll('button')].find(b => b.textContent?.includes('采用所选'))
      adopt!.click()
      await new Promise(r => setTimeout(r, 10))
    })
    expect(state.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({ modelNames: ['gen-1', 'new-a'] }),
      { 'new-a': { contextWindow: 1000 } },
    )
  })

  it('删除被引用的行（当前默认模型）→ 引用检查拦下：确认框都不出现（复核 I1 回归锁）', async () => {
    state.defaultModelId = 'm2' // m2 正被引为默认模型
    render(ACCOUNT, [makeModel('m1', 'gen-1'), makeModel('m2', 'gen-2')])
    await act(async () => {
      buttonByLabel('删除')[0].click() // 倒序后第一个 = gen-2（m2）
      await new Promise(r => setTimeout(r, 10))
    })
    // 被引用 → 在确认之前直接拦下（确认框不应出现，也不应写任何东西）
    const box = document.body.lastElementChild as HTMLElement
    const hasConfirm = [...box.querySelectorAll('button')].some(b => b.textContent?.trim() === '删除')
    expect(hasConfirm).toBe(false)
    expect(state.saveProvider).not.toHaveBeenCalled()
    expect(state.deleteModel).not.toHaveBeenCalled()
    state.defaultModelId = 'gen-1'
  })

  it('删账户卡的**最后一个**模型 → 确认后被阻止：不写盘 + toast 说明（v3 T2 fix round 1）', async () => {
    render({ ...ACCOUNT, modelNames: ['gen-1'] }, [makeModel('m1', 'gen-1')])
    await act(async () => {
      buttonByLabel('删除')[0].click()
      await new Promise(r => setTimeout(r, 10))
    })
    await confirmDialog()

    // 空 modelNames 现在是「继承内置目录」→ 送上去会把整目录（含刚删的这个）重新物化出来
    expect(state.saveProvider).not.toHaveBeenCalled()
    expect(state.deleteModel).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('至少保留一个模型')
  })

  it('「其他」卡（account=null）：无「添加模型」入口；删除走 deleteModel', async () => {
    const el = render(null, [makeModel('orphan-1', 'orphan-model')])
    expect([...el.querySelectorAll('button')].some(b => b.textContent?.includes('添加模型'))).toBe(false)
    await act(async () => {
      buttonByLabel('删除')[0].click()
      await new Promise(r => setTimeout(r, 10))
    })
    await confirmDialog()
    expect(state.deleteModel).toHaveBeenCalledWith('orphan-1')
    expect(state.saveProvider).not.toHaveBeenCalled()
  })
})
