// @vitest-environment jsdom
/**
 * ModelCatalogEditor —— 模型目录区（模型管理 v3 §2.3/§3.3/§5，2026-10-01）。
 *
 * 契约（task-7-brief Step 1 + Resolution 2/3/4/5/6/8）：
 * - **三态**：`value === undefined` = 继承内置目录（显示全集 + meta「默认模型目录」，**无**「恢复默认模型」）；
 *   非空数组 = 自定义；**空数组 = 自定义态但一行不剩**（提交 `[]` → 主进程按继承语义重建全集）
 * - **物化**：继承态下任何增删改 → 先展开全集再施加改动
 * - **行**：id + 显示名常显，[⌄] 行内展开（上下文窗口 / 最大输出 / 输入类型） + 用途标签 + [🗑]
 * - **显示层倒序**（存储序不动）
 * - **校验**：id 空 / trim 后重复、容量非法 → 行号红字 + 上报 invalid
 * - **overrides**：只含**改过的**字段（相对既有条目/内置规格的差异）
 *
 * 组件本身**不碰 store**（纯受控）：provider/existing/value/onChange 全从 props 来 ——
 * 目录区的数据源是账户（在编辑卡里），不是全局模型列表。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import {
  ModelCatalogEditor, catalogModelNames, catalogOverrides, initialCatalogDraft, type ModelDraft,
} from './ModelCatalogEditor'
import { builtinCatalogFor } from '../../shared/provider-presets'
import type { ModelProfile } from '../../shared/ipc-channels'

/** 编辑器本次上报的草稿（= 父级「应用」时会提交的东西） */
let latest: ModelDraft[] | undefined

/**
 * 最小父级（与 ProviderEditorCard 的接线同形）：持有草稿 + 用上报的校验结果门控「应用」。
 * 断言提交形状走 `latest`（编辑器**上报**的值），断言门控走「应用」按钮。
 */
function Harness({ provider, existing, modelNames }: {
  provider: string
  existing?: ModelProfile[]
  modelNames?: string[]
}) {
  // 与 ProviderEditorCard 的接线同形：初值由「账户的 modelNames + 现有派生条目」算出
  const [rows, setRows] = useState<ModelDraft[] | undefined>(
    () => initialCatalogDraft(modelNames, existing ?? []),
  )
  const [valid, setValid] = useState(true)
  return (
    <>
      <ModelCatalogEditor
        provider={provider}
        existing={existing ?? []}
        value={rows}
        onChange={(next) => { latest = next; setRows(next) }}
        onValidityChange={setValid}
      />
      <button disabled={!valid}>应用</button>
    </>
  )
}

function mkModel(over: Partial<ModelProfile> & { id: string; modelName: string }): ModelProfile {
  return {
    name: over.modelName,
    provider: 'openai',
    protocol: 'openai',
    baseUrl: '',
    temperature: 0.7,
    maxTokens: 4096,
    contextWindow: 131_072,
    purposes: ['generation'],
    ...over,
  }
}

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(props: { provider: string; existing?: ModelProfile[]; modelNames?: string[] }) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(<Harness {...props} />) })
  return container
}

beforeEach(() => { latest = undefined })

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
})

// ===== 查询助手 =====

/** 目录行（**DOM 序 = 显示序**）：id 输入框的 aria-label 是「模型 ID {n}」 */
function idInputs(): HTMLInputElement[] {
  return [...container!.querySelectorAll('input[aria-label^="模型 ID "]')] as HTMLInputElement[]
}

/** 某行的显示名输入框（与 id 输入框同行、行号相同） */
function nameInputOf(idInput: HTMLInputElement): HTMLInputElement {
  const n = idInput.getAttribute('aria-label')!.replace('模型 ID ', '')
  return container!.querySelector(`input[aria-label="显示名 ${n}"]`) as HTMLInputElement
}

function inputByLabel(label: string): HTMLInputElement | null {
  return container!.querySelector(`input[aria-label="${label}"]`)
}

function buttonByLabel(label: string): HTMLButtonElement | null {
  return container!.querySelector(`button[aria-label="${label}"]`)
}

function buttonByText(text: string): HTMLButtonElement | null {
  return ([...container!.querySelectorAll('button')]
    .find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined) ?? null
}

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function click(el: HTMLElement) {
  act(() => { el.click() })
}

/** 展开第 n 行（显示序，1 起） */
function expand(position: number) {
  const btn = buttonByLabel(`模型选项 ${position}`)
  expect(btn, `未找到第 ${position} 行的展开按钮`).toBeTruthy()
  click(btn!)
}

const isValid = () => (buttonByText('应用') as HTMLButtonElement).disabled === false

describe('ModelCatalogEditor 目录区', () => {
  it('继承态：显示全部内置模型 + meta「默认模型目录」，无「恢复默认模型」', () => {
    const el = render({ provider: 'openai' })
    const catalog = builtinCatalogFor('openai')

    expect(catalog.length).toBeGreaterThan(5) // 防「内置目录变空」把这条断言变成空转
    expect(idInputs()).toHaveLength(catalog.length)
    // 显示层倒序：DOM 首行 = 存储最后一行
    expect(idInputs()[0].value).toBe(catalog[catalog.length - 1])
    expect(idInputs().map((i) => i.value).reverse()).toEqual(catalog)

    expect(el.textContent).toContain('默认模型目录')
    expect(el.textContent).not.toContain('已自定义模型目录')
    expect(buttonByText('恢复默认模型')).toBeNull()
    expect(latest).toBeUndefined() // 继承态 = 草稿就是 undefined（没物化过）
  })

  it('行内展开：容量 placeholder = 继承值格式化（内置规格）；用途标签只读展示', () => {
    render({ provider: 'openai' })
    expect(inputByLabel('上下文窗口 1')).toBeNull() // 收起时没有容量框

    expand(1)
    // openai 的 text-embedding-3-large 排在目录末尾 → 显示层第 1 行是它（向量用途）
    expect(inputByLabel('上下文窗口 1')!.placeholder).toBe('131072')
    expect(inputByLabel('最大输出 token 1')!.placeholder).toBe('131072')
    expect(container!.textContent).toContain('向量')
  })

  it('既有派生条目：placeholder 用**该条目**的值（不是内置规格），用途标签取条目 purposes', () => {
    render({
      provider: 'openai',
      existing: [mkModel({
        id: 'acct::gpt-5.6-sol', modelName: 'gpt-5.6-sol',
        contextWindow: 200_000, maxTokens: 64_000, purposes: ['refinement'],
      })],
      modelNames: ['gpt-5.6-sol'],
    })
    expand(1)
    expect(inputByLabel('上下文窗口 1')!.placeholder).toBe('200K')
    expect(inputByLabel('最大输出 token 1')!.placeholder).toBe('64K')
  })

  it('输入类型沿用既有条目（不是硬编码 text）：条目声明 image → 图片勾上且锁住', () => {
    render({
      provider: 'openai',
      existing: [mkModel({ id: 'acct::gpt-5.6-sol', modelName: 'gpt-5.6-sol', inputTypes: ['image'] })],
      modelNames: ['gpt-5.6-sol'],
    })
    expand(1)
    const text = container!.querySelector('input[aria-label="文本 1"]') as HTMLInputElement
    const image = container!.querySelector('input[aria-label="图片 1"]') as HTMLInputElement

    expect(image.checked).toBe(true)   // 条目的值才是当前生效值
    expect(text.checked).toBe(false)
    expect(image.disabled).toBe(true)  // 只剩一种 → 自己不能再取消
  })

  it('物化：继承态下「添加模型」→ 先展开全集再追加，新行显示在最上', () => {
    render({ provider: 'openai' })
    const before = idInputs().length
    click(buttonByText('添加模型')!)

    expect(latest).toHaveLength(before + 1)          // 全集已物化
    expect(latest![latest!.length - 1].modelName).toBe('')  // 新行在**存储序末尾**
    expect(idInputs()[0].value).toBe('')             // 显示层倒序 → 新行在顶上
    expect(container!.textContent).toContain('已自定义模型目录')
    expect(buttonByText('恢复默认模型')).toBeTruthy()
  })

  it('「恢复默认模型」→ 草稿清为 undefined（回继承）', () => {
    render({ provider: 'openai', modelNames: ['gpt-5.6-sol'] })
    expect(idInputs()).toHaveLength(1)

    click(buttonByText('恢复默认模型')!)
    expect(latest).toBeUndefined()
    expect(idInputs()).toHaveLength(builtinCatalogFor('openai').length) // 行区换回继承全集
    expect(container!.textContent).toContain('默认模型目录')
    expect(buttonByText('恢复默认模型')).toBeNull()
  })

  it('删光行（自定义态）→ 提交 modelNames 为 []；重开显示继承（Review Focus 4 的 UI 面）', () => {
    render({ provider: 'openai', modelNames: ['model-a', 'model-b'] })
    expect(idInputs()).toHaveLength(2)

    click(buttonByLabel('删除模型 1')!)
    click(buttonByLabel('删除模型 1')!)
    expect(latest).toEqual([])                        // 空目录 —— 不拦、不补行
    expect(catalogModelNames(latest)).toEqual([])     // 提交形状：空数组
    expect(idInputs()).toHaveLength(0)
    expect(container!.textContent).toContain('已自定义模型目录') // 仍是自定义态（要保存才回继承）
    expect(container!.textContent).toContain('恢复默认模型目录')  // meta 明说这个空格子意味着什么

    // 重开：modelNames = [] 是「继承」的存储表达 → 又看到全集（空数组不是「一个模型都没有」）
    act(() => root!.unmount())
    container!.remove()
    latest = undefined // 重开是一次新的挂载，上一份草稿不该被当成本次上报
    render({ provider: 'openai', modelNames: [] })
    expect(idInputs()).toHaveLength(builtinCatalogFor('openai').length)
    expect(latest).toBeUndefined()
  })

  it('容量非法：256KK → 行号红字 + 上报 invalid（原文保留上屏，不在输入中途重写）', () => {
    render({ provider: 'openai' })
    expand(1)
    const input = inputByLabel('上下文窗口 1')!
    act(() => { setValue(input, '256KK') })

    expect(inputByLabel('上下文窗口 1')!.value).toBe('256KK') // 按键缓冲：不回落、不清空
    expect(inputByLabel('上下文窗口 1')!.getAttribute('aria-invalid')).toBe('true')
    expect(container!.textContent).toContain('上下文窗口必须是正数')
    expect(isValid()).toBe(false)
  })

  it('非法行改回合法 → 红字消失、恢复可应用；空 = 继承（不是 0）', () => {
    render({ provider: 'openai' })
    expand(1)
    act(() => { setValue(inputByLabel('上下文窗口 1')!, '256KK') })
    expect(isValid()).toBe(false)

    act(() => { setValue(inputByLabel('上下文窗口 1')!, '256K') })
    expect(inputByLabel('上下文窗口 1')!.getAttribute('aria-invalid')).toBeNull()
    expect(isValid()).toBe(true)

    act(() => { setValue(inputByLabel('上下文窗口 1')!, '') })
    expect(isValid()).toBe(true)
    expect(inputByLabel('上下文窗口 1')!.value).toBe('')
  })

  it('id 重复（trim 后同名）→ **存储序后出现者**红字 + 禁应用（第一个是保留者）', () => {
    render({ provider: 'custom', modelNames: ['a', 'b'] })
    // 存储序 [a, b] → 显示序 [b, a]；把顶上的 b 改成「 a 」（带空白 → trim 后与 a 同名）
    act(() => { setValue(idInputs()[0], ' a ') })

    const ids = [...container!.querySelectorAll('input[aria-label^="模型 ID "]')] as HTMLInputElement[]
    expect(ids[0].getAttribute('aria-invalid')).toBe('true')  // 显示首行 = 存储末行 = 刚改的那行
    expect(ids[1].getAttribute('aria-invalid')).toBeNull()    // 先出现的同名者不受牵连
    expect(container!.textContent).toContain('模型 ID 不能重复')
    expect(isValid()).toBe(false)
  })

  it('id 空（trim 后）→ 红字 + 禁应用（新增的空行未填完也算）', () => {
    render({ provider: 'custom', modelNames: ['a'] })
    click(buttonByText('添加模型')!)
    expect(container!.textContent).toContain('模型 ID 不能为空')
    expect(isValid()).toBe(false)

    act(() => { setValue(idInputs()[0], 'b') })
    expect(isValid()).toBe(true)
  })

  it('输入类型：至少留一种（仅剩一种时该框禁用）；改动进 overrides', () => {
    render({ provider: 'openai', modelNames: ['gpt-5.6-sol'] })
    expand(1)
    const text = container!.querySelector('input[aria-label="文本 1"]') as HTMLInputElement
    const image = container!.querySelector('input[aria-label="图片 1"]') as HTMLInputElement

    // 缺省 = 继承 ['text']：文本勾上且**不能再取消**（取消就一种都不剩）
    expect(text.checked).toBe(true)
    expect(image.checked).toBe(false)
    expect(text.disabled).toBe(true)
    expect(image.disabled).toBe(false)

    click(image)
    expect(image.checked).toBe(true)
    expect(text.disabled).toBe(false)          // 有两种了 → 都可以取消
    expect(catalogOverrides(latest, [])).toEqual({ 'gpt-5.6-sol': { inputTypes: ['text', 'image'] } })

    click(text)
    expect(image.checked).toBe(true)
    expect(image.disabled).toBe(true)          // 只剩图片 → 它自己不能再取消
    expect(catalogOverrides(latest, [])).toEqual({ 'gpt-5.6-sol': { inputTypes: ['image'] } })
    expect(isValid()).toBe(true)               // 一种也不剩是不可能的（框被禁）
  })

  it('overrides 提交形状：只含**改过**的字段（未碰的容量/其它行都不出现）', () => {
    render({
      provider: 'openai',
      existing: [mkModel({ id: 'acct::gpt-5.6-sol', modelName: 'gpt-5.6-sol', name: '旧名' })],
    })
    // 找到 gpt-5.6-sol 那一行（显示序倒排，用 id 值定位）
    const row = idInputs().find((i) => i.value === 'gpt-5.6-sol')!
    const position = Number(row.getAttribute('aria-label')!.replace('模型 ID ', ''))
    act(() => { setValue(nameInputOf(row), '新名') })
    expand(position)
    act(() => { setValue(inputByLabel(`上下文窗口 ${position}`)!, '256K') })

    const names = catalogModelNames(latest)
    expect(names).toContain('gpt-5.6-sol')
    expect(names).toHaveLength(builtinCatalogFor('openai').length)  // 物化：整组进了 modelNames
    expect(catalogOverrides(latest, [mkModel({ id: 'acct::gpt-5.6-sol', modelName: 'gpt-5.6-sol', name: '旧名' })]))
      .toEqual({ 'gpt-5.6-sol': { name: '新名', contextWindow: 256_000 } })
    //    ↑ maxTokens 没碰 → 不在 overrides 里（undefined 键不得覆盖条目上的真值）
  })

  it('显示名清空 = 回落模型名（提交时自动填，不报错、不拦应用）', () => {
    const base = [mkModel({ id: 'acct::gpt-5.6-sol', modelName: 'gpt-5.6-sol', name: '旧名' })]
    render({ provider: 'openai', existing: base, modelNames: ['gpt-5.6-sol'] })
    const row = idInputs()[0]

    // 既有显示名**预填在框里**（看得见才清得掉）：清空它 = 显式要求回落模型 ID
    expect(nameInputOf(row).value).toBe('旧名')
    act(() => { setValue(nameInputOf(row), '') })

    expect(isValid()).toBe(true)
    expect(catalogOverrides(latest, base)).toEqual({ 'gpt-5.6-sol': { name: 'gpt-5.6-sol' } })
  })

  it('删除中间一行：按条目定位（倒序显示下不能误删邻行）', () => {
    render({ provider: 'custom', modelNames: ['a', 'b', 'c'] })
    expect(idInputs().map((i) => i.value)).toEqual(['c', 'b', 'a'])

    click(buttonByLabel('删除模型 2')!) // 显示第 2 行 = 存储序的 b
    expect(idInputs().map((i) => i.value)).toEqual(['c', 'a'])
    expect(catalogModelNames(latest)).toEqual(['a', 'c'])
  })
})

describe('目录纯函数（父级提交时用）', () => {
  it('initialCatalogDraft：undefined / 空数组 = 继承（undefined）；非空 = 逐名建行', () => {
    expect(initialCatalogDraft(undefined)).toBeUndefined()
    expect(initialCatalogDraft([])).toBeUndefined()
    expect(initialCatalogDraft(['a', 'b'])).toEqual([{ modelName: 'a' }, { modelName: 'b' }])
  })

  it('catalogModelNames：trim 后出清单；继承态原样 undefined', () => {
    expect(catalogModelNames(undefined)).toBeUndefined()
    expect(catalogModelNames([{ modelName: ' a ' }, { modelName: 'b' }])).toEqual(['a', 'b'])
    expect(catalogModelNames([])).toEqual([])
  })

  it('catalogOverrides：继承态 undefined；无改动 → undefined；非法容量不上报', () => {
    expect(catalogOverrides(undefined, [])).toBeUndefined()
    expect(catalogOverrides([{ modelName: 'a' }], [])).toBeUndefined()
    expect(catalogOverrides([{ modelName: 'a', contextWindowText: '256KK' }], [])).toBeUndefined()
    expect(catalogOverrides([{ modelName: 'a', contextWindowText: '256K', maxTokensText: '8K' }], []))
      .toEqual({ a: { contextWindow: 256_000, maxTokens: 8_000 } })
  })

  it('额外兜底：非法容量在纯函数层也被挡（不依赖 UI 校验就位）', () => {
    // 0 / 负数 / 非整数一律不上报 —— 主进程侧的类型没有约束，别把坏值写进配置文件
    expect(catalogOverrides([{ modelName: 'a', maxTokensText: '0' }], [])).toBeUndefined()
  })
})

describe('ModelCatalogEditor 键盘可达性', () => {
  it('每个开关都是 button（不是 div）：展开/删除/恢复默认/添加都可 Tab 到', () => {
    render({ provider: 'openai', modelNames: ['a'] })
    for (const el of container!.querySelectorAll('button')) {
      expect(el.tagName).toBe('BUTTON')
    }
    expect(buttonByLabel('模型选项 1')!.getAttribute('aria-expanded')).toBe('false')
    expand(1)
    expect(buttonByLabel('模型选项 1')!.getAttribute('aria-expanded')).toBe('true')
  })

  it('禁用态：disabled=true 时所有控件禁用（只读账户不可改目录）', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root!.render(
        <ModelCatalogEditor
          provider="openai" existing={[]} value={undefined}
          onChange={vi.fn()} disabled
        />,
      )
    })
    for (const el of container.querySelectorAll('input, button')) {
      expect((el as HTMLInputElement).disabled, el.getAttribute('aria-label') ?? el.textContent ?? '').toBe(true)
    }
  })
})
