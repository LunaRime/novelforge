// @vitest-environment jsdom
/**
 * VectorConfigSection「本地向量模型」卡片（T5）
 *
 * 覆盖：
 * - 三态徽标（未连接 / 已连接但模型缺失 / 就绪）——由 mock 的 `embedding:local-detect` +
 *   `embedding:local-list-models` 驱动（U3：本地连通性**只**来自 local-detect，不复用 kb:search）
 * - U1 进度条 clamp（percent>100 → 100%；total 缺失 → 不确定态，不显示百分比）
 * - U2 维度不匹配警告（local-test 的 dim vs kb:stats 的 vectorDimension；0 维新库不告警）
 * - U3 / U4 英文技术串只出现在可折叠「原始详情」，主文案走 t()
 * - U5 挂载三路**并行**取数；任一失败不破卡片
 * - 配置写入（开关 / 地址 / 优先级）→ embedding:local-set-config 部分更新 payload
 * - 卸载取消 `embedding:local-pull-progress` 订阅（不泄漏监听器）
 *
 * R1–R3（2026-09-14 真机可用性修复）：
 * - R1 精选清单：四项（名字 / 参数规模 / 定位文案 / 已安装·可下载徽标）全渲染、不可自由输入；
 *   **未安装项点「下载模型」→ pull 的必须是该项**（Finding 1 回归锁，见 §9.7）
 * - R1 兼容：配置里的 model 不在清单内时仍显示且保持选中（不把用户锁在清单外）
 * - R2 地址：默认不渲染排障区与「重置为默认」；可编辑输入收进默认收起的「高级设置」
 * - R3 换模型：与当前不同 + `kb:stats.vectorDimension > 0` → 复用 U2 风格的维度重建提示
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import VectorConfigSection from './VectorConfigSection'
import { t } from '../../shared/locale'
import type { LocalEmbeddingConfig } from '../../shared/ipc-channels'

// ===== IPC 桩（组件与 store 共用同一 mock 模块）=====

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), on: vi.fn() }))

vi.mock('../../services/ipc-client', () => ({
  // isElectron=false：既有 vector-config-store 的自动加载静默返回，测试只观察卡片自身的行为
  ipc: { invoke: mocks.invoke, on: mocks.on, isElectron: false },
}))

type PullProgress = { status: string; completed?: number; total?: number; percent?: number; error?: string }
type Handler = () => unknown
type LocalModel = { name: string; size: number }

const DEFAULT_CONFIG: LocalEmbeddingConfig = {
  enabled: false,
  baseUrl: 'http://localhost:11434',
  model: 'bge-m3',
  preferLocal: true,
}

/**
 * R1 规格锁：内置精选清单**恰好这四项**（名字 / 参数规模 / 定位文案）。
 * 断言用 zh-CN 字面量而非 `t(key)` —— `t()` 在 key 缺失时会原样返回 key 串，
 * 若两边都用 `t()`，漏进字典的 key 也能「通过」（假绿）。
 */
const CATALOG = [
  { name: 'bge-m3', params: '567M', desc: '默认推荐' },
  { name: 'nomic-embed-text', params: '137M', desc: '英文为主' },
  { name: 'mxbai-embed-large', params: '334M', desc: '英文检索质量高' },
  { name: 'all-minilm', params: '23M', desc: '最轻量' },
] as const

let handlers: Record<string, Handler>
let progressHandler: ((p: PullProgress) => void) | null
let unsubSpy: ReturnType<typeof vi.fn>

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
  handlers = {}
  progressHandler = null
  unsubSpy = vi.fn()

  mocks.invoke.mockReset()
  mocks.invoke.mockImplementation(async (channel: string) => {
    const handler = handlers[channel]
    if (!handler) throw new Error(`未 mock 的通道: ${channel}`)
    return handler()
  })

  mocks.on.mockReset()
  mocks.on.mockImplementation((channel: string, cb: (p: PullProgress) => void) => {
    if (channel === 'embedding:local-pull-progress') progressHandler = cb
    return unsubSpy
  })
})

afterEach(() => {
  document.body.innerHTML = ''
})

// ===== 助手 =====

/** 默认三态桩：Ollama 已连接 + 已装模型列表（可被单测覆盖） */
function stubLocal(opts: {
  ok: boolean
  version?: string
  models?: LocalModel[]
  config?: LocalEmbeddingConfig
}): void {
  handlers['embedding:local-get-config'] = () => opts.config ?? DEFAULT_CONFIG
  handlers['embedding:local-detect'] = () => ({ ok: opts.ok, version: opts.version })
  handlers['embedding:local-list-models'] = () => opts.models ?? []
}

function render(): { container: HTMLElement; root: Root } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(<VectorConfigSection />) })
  return { container, root }
}

/** 等一拍：让挂载期的 promise（allSettled）落地 */
async function flush(): Promise<void> {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const el = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text))
  expect(el, `未找到按钮「${text}」`).toBeDefined()
  return el as HTMLButtonElement
}

function click(el: Element): void {
  act(() => { (el as HTMLElement).click() })
}

function query(el: ParentNode, selector: string): HTMLElement | null {
  return el.querySelector(selector) as HTMLElement | null
}

function requireEl(el: ParentNode, selector: string): HTMLElement {
  const found = query(el, selector)
  expect(found, `未找到元素 ${selector}`).not.toBeNull()
  return found as HTMLElement
}

/** 卡片内除可折叠 details 之外的可见文本（用于断言「原始英文串没有当主文案」） */
function textOutsideDetails(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement
  clone.querySelectorAll('details').forEach((d) => d.remove())
  return clone.textContent ?? ''
}

/** React 受控 input：走原生 setter + input 事件（仓库既有做法） */
function typeInto(el: HTMLInputElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** 失焦提交（jsdom 只在已聚焦元素上派发 blur/focusout） */
function blur(el: HTMLElement): void {
  act(() => { el.focus() })
  act(() => { el.blur() })
}

function setConfigCalls(): unknown[][] {
  return mocks.invoke.mock.calls.filter((c) => c[0] === 'embedding:local-set-config')
}

function listModelsCalls(): unknown[][] {
  return mocks.invoke.mock.calls.filter((c) => c[0] === 'embedding:local-list-models')
}

/**
 * R1 之后模型选择从 Radix Select 改成清单行（单选 + 该行自己的「下载模型」按钮），
 * 因此 `openSelect` / `optionOnBody`（Radix Portal 时代的辅助函数）随之下线：
 * 现在按 `aria-label=<模型名>` 定位单选，行容器 = 单选所在的那个 div。
 */
function radioFor(container: HTMLElement, name: string): HTMLInputElement {
  const el = query(container, `input[type="radio"][aria-label="${name}"]`)
  expect(el, `未找到模型单选「${name}」`).not.toBeNull()
  return el as HTMLInputElement
}

/** 模型行容器（包含：单选 + 名称/参数/定位/徽标 + 该行自己的下载按钮） */
function rowFor(container: HTMLElement, name: string): HTMLElement {
  return radioFor(container, name).parentElement as HTMLElement
}

/** 按 summary 文案定位折叠区（「高级设置」等；卡片内还有若干「原始详情」details） */
function detailsBySummary(container: HTMLElement, text: string): HTMLDetailsElement | null {
  const all = [...container.querySelectorAll('details')] as HTMLDetailsElement[]
  return all.find((d) => d.querySelector('summary')?.textContent?.includes(text)) ?? null
}

/** 卡片内所有非单选 `<input>`（R1：模型不可自由输入 → 只应剩 Ollama 地址一个） */
function textInputs(container: HTMLElement): HTMLInputElement[] {
  return ([...container.querySelectorAll('input')] as HTMLInputElement[]).filter(
    (el) => el.type !== 'radio',
  )
}

// ===== 测试 =====

describe('本地向量模型卡片 · 三态徽标', () => {
  it('未连接：徽标「未连接」+ 安装引导，英文 error 只出现在可折叠原始详情', async () => {
    handlers['embedding:local-get-config'] = () => DEFAULT_CONFIG
    handlers['embedding:local-detect'] = () => ({ ok: false, error: 'ECONNREFUSED 127.0.0.1:11434' })
    handlers['embedding:local-list-models'] = () => []
    const { container, root } = render()
    await flush()

    expect(container.textContent).toContain('本地向量模型')
    expect(container.textContent).toContain('未连接')
    expect(container.textContent).toContain('未检测到 Ollama')
    // U4：原始英文技术串只在 details 里，绝不当主文案
    expect(query(container, 'details')?.textContent).toContain('ECONNREFUSED')
    expect(textOutsideDetails(container)).not.toContain('ECONNREFUSED')
    act(() => { root.unmount() })
  })

  it('已连接但模型缺失：提示模型未安装 + 双通道引导（应用内下载 / ollama pull）', async () => {
    stubLocal({ ok: true, version: '0.5.7', models: [{ name: 'llama3', size: 1 }] })
    const { container, root } = render()
    await flush()

    expect(container.textContent).toContain('已连接 0.5.7')
    expect(container.textContent).toContain('模型 bge-m3 未安装')
    expect(container.textContent).toContain('ollama pull bge-m3')
    expect(container.textContent).toContain('下载模型')
    act(() => { root.unmount() })
  })

  it('就绪：已连接 + 模型已装（容忍 :latest 别名）→ 「就绪」', async () => {
    stubLocal({ ok: true, version: '0.5.7', models: [{ name: 'bge-m3:latest', size: 1 }] })
    const { container, root } = render()
    await flush()

    expect(container.textContent).toContain('就绪')
    expect(container.textContent).not.toContain('未安装')
    act(() => { root.unmount() })
  })

  it('T5-M4：配置写 :latest 而列表是规范化后的裸名（方向二）→ 仍判「就绪」，不误报未安装', async () => {
    // Ollama /api/tags 的 name 可能带 :latest（T2 已规范化去掉）；用户手填/配置里仍可能是 bge-m3:latest
    // → 归一化必须**双向**：m.name.replace(:latest) === model.replace(:latest)
    stubLocal({
      ok: true,
      version: '0.5.7',
      models: [{ name: 'bge-m3', size: 1 }],
      config: { ...DEFAULT_CONFIG, model: 'bge-m3:latest' },
    })
    const { container, root } = render()
    await flush()

    expect(container.textContent).toContain('就绪')
    expect(container.textContent).not.toContain('未安装')
    act(() => { root.unmount() })
  })

  it('U3：本地连通性只走 embedding:local-detect，不复用 kb:search 自检', async () => {
    stubLocal({ ok: true, version: '0.5.7', models: [{ name: 'bge-m3', size: 1 }] })
    const { root } = render()
    await flush()

    expect(mocks.invoke).toHaveBeenCalledWith('embedding:local-detect')
    expect(mocks.invoke.mock.calls.map((c) => c[0])).not.toContain('kb:search')
    act(() => { root.unmount() })
  })
})

describe('本地向量模型卡片 · R1 精选清单（不可自由输入）', () => {
  it('清单四项全渲染（名称 + 参数规模 + 定位），状态徽标由 local-list-models 驱动且 :latest 双向归一化', async () => {
    // 列表里 bge-m3 带 :latest、all-minilm 是裸名 —— 两侧都要归一化才都算「已安装」
    stubLocal({
      ok: true,
      version: '0.5.7',
      models: [{ name: 'bge-m3:latest', size: 1 }, { name: 'all-minilm', size: 1 }],
    })
    const { container, root } = render()
    await flush()

    for (const entry of CATALOG) {
      const row = rowFor(container, entry.name)
      expect(row.textContent).toContain(entry.name)
      expect(row.textContent).toContain(entry.params)
      expect(row.textContent).toContain(entry.desc)
    }
    // 徽标：已安装 / 可下载 由 list-models 驱动
    expect(rowFor(container, 'bge-m3').textContent).toContain('已安装')
    expect(rowFor(container, 'all-minilm').textContent).toContain('已安装')
    expect(rowFor(container, 'nomic-embed-text').textContent).toContain('可下载')
    expect(rowFor(container, 'mxbai-embed-large').textContent).toContain('可下载')
    expect(rowFor(container, 'nomic-embed-text').textContent).not.toContain('已安装')
    // 恰好四项：不夹带 list-models 里的其它模型（llama3 既没装也不在清单里，不得出现）
    expect(container.querySelectorAll('input[type="radio"][name="local-embedding-model"]')).toHaveLength(4)
    expect(container.textContent).not.toContain('llama3')
    act(() => { root.unmount() })
  })

  it('反自由输入（用户裁决）：卡片里唯一的非单选输入是 Ollama 地址，模型没有文本框', async () => {
    stubLocal({ ok: true, version: '0.5.7', models: [{ name: 'bge-m3', size: 1 }] })
    const { container, root } = render()
    await flush()

    expect(textInputs(container).map((el) => el.getAttribute('aria-label'))).toEqual(['Ollama 地址'])
    act(() => { root.unmount() })
  })

  it('R1 / Finding 1 回归锁：未安装项点它自己的「下载模型」→ 先把它写成配置 model，再 pull', async () => {
    // 只装了 bge-m3（当前配置），nomic-embed-text 未安装 —— 旧实现下列表里根本不会有它的下载入口，
    // 且「下载模型」只会拉配置里的 bge-m3（§9.7 的通道 A 退化）。
    stubLocal({ ok: true, version: '0.5.7', models: [{ name: 'bge-m3', size: 1 }] })
    handlers['embedding:local-set-config'] = () => ({ success: true })
    handlers['embedding:local-pull'] = () => ({ started: true })
    handlers['kb:stats'] = () => ({ documentCount: 0, totalChunks: 0, vectorDimension: 0 })
    const { container, root } = render()
    await flush()

    click(button(rowFor(container, 'nomic-embed-text'), '下载模型'))
    await flush()

    // `embedding:local-pull` **不收渲染层入参**（T4 契约：baseUrl/model 由主进程读配置）→
    // 想下载「这一项」，就必须在 pull 之前把这一项写成当前配置。顺序断言即本回归锁的判别力：
    // 少了这次写入，主进程拉的就是旧的 bge-m3。
    const channels = mocks.invoke.mock.calls.map((c) => c[0])
    const setIdx = channels.indexOf('embedding:local-set-config')
    const pullIdx = channels.indexOf('embedding:local-pull')
    expect(setConfigCalls().at(-1)?.[1]).toEqual({ model: 'nomic-embed-text' })
    expect(setIdx).toBeGreaterThan(-1)
    expect(pullIdx).toBeGreaterThan(setIdx)
    // 选中态跟随写入（配置即选中）
    expect(radioFor(container, 'nomic-embed-text').checked).toBe(true)
    expect(radioFor(container, 'bge-m3').checked).toBe(false)
    act(() => { root.unmount() })
  })

  it('R1：点当前配置模型自己的「下载模型」→ 不多余写配置，直接 pull', async () => {
    // 刻意**不** stub `embedding:local-set-config`：多写一次配置就会落到「未 mock 的通道」而暴露
    stubLocal({ ok: true, version: '0.5.7', models: [{ name: 'llama3', size: 1 }] })
    handlers['embedding:local-pull'] = () => ({ started: true })
    const { container, root } = render()
    await flush()

    click(button(rowFor(container, 'bge-m3'), '下载模型'))
    await flush()

    expect(setConfigCalls()).toHaveLength(0)
    expect(mocks.invoke).toHaveBeenCalledWith('embedding:local-pull')
    act(() => { root.unmount() })
  })

  it('R1 兼容：配置里的 model 不在清单内（历史配置/手工改过）→ 仍显示、仍选中，不被静默丢弃', async () => {
    stubLocal({
      ok: true,
      version: '0.5.7',
      models: [{ name: 'llama3', size: 1 }],
      config: { ...DEFAULT_CONFIG, model: 'llama3' },
    })
    const { container, root } = render()
    await flush()

    // ① 清单四项照常都在；② 清单外的当前配置作为额外一项出现并被选中
    for (const entry of CATALOG) expect(rowFor(container, entry.name)).toBeTruthy()
    const custom = radioFor(container, 'llama3')
    expect(custom.checked).toBe(true)
    expect(custom.parentElement?.textContent).toContain('不在精选清单')
    act(() => { root.unmount() })
  })
})

describe('本地向量模型卡片 · 配置写入', () => {
  it('开关切换 → local-set-config 部分更新 { enabled }，成功后 UI 跟随', async () => {
    stubLocal({ ok: true, version: '0.5.7', models: [{ name: 'bge-m3', size: 1 }] })
    handlers['embedding:local-set-config'] = () => ({ success: true })
    const { container, root } = render()
    await flush()

    const toggle = requireEl(container, '[role="switch"][aria-label="启用本地向量模型"]')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    click(toggle)
    await flush()

    const call = setConfigCalls().at(-1)
    expect(call?.[0]).toBe('embedding:local-set-config')
    expect(call?.[1]).toEqual({ enabled: true }) // 部分更新，不整份覆盖
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    act(() => { root.unmount() })
  })

  it('地址非法 → 内联提示且不写库；合法 → trim 后 local-set-config { baseUrl }', async () => {
    stubLocal({ ok: true, version: '0.5.7', models: [{ name: 'bge-m3', size: 1 }] })
    handlers['embedding:local-set-config'] = () => ({ success: true })
    const { container, root } = render()
    await flush()

    const input = requireEl(container, 'input[aria-label="Ollama 地址"]') as HTMLInputElement
    typeInto(input, 'not a url')
    blur(input)
    await flush()
    expect(container.textContent).toContain('地址无效')
    expect(setConfigCalls()).toHaveLength(0)

    typeInto(input, '  http://127.0.0.1:12345  ')
    blur(input)
    await flush()
    expect(setConfigCalls().at(-1)?.[1]).toEqual({ baseUrl: 'http://127.0.0.1:12345' })
    expect(container.textContent).not.toContain('地址无效')
    act(() => { root.unmount() })
  })

  it('优先级单选 → local-set-config { preferLocal: false }', async () => {
    stubLocal({ ok: true, version: '0.5.7', models: [{ name: 'bge-m3', size: 1 }] })
    handlers['embedding:local-set-config'] = () => ({ success: true })
    const { container, root } = render()
    await flush()

    const apiRadio = requireEl(container, 'input[type="radio"][aria-label="API 优先"]') as HTMLInputElement
    expect(apiRadio.checked).toBe(false) // 默认本地优先
    click(apiRadio)
    await flush()
    expect(setConfigCalls().at(-1)?.[1]).toEqual({ preferLocal: false })
    act(() => { root.unmount() })
  })

  // T5-Minor 2（R1 后改写）：模型选择从 Radix Select 改成清单行单选，断言本身不变 ——
  // 仍然是「选另一模型 → local-set-config 只带 model 键」的部分更新契约。
  it('R1：点清单里另一模型 → local-set-config { model }（部分更新，只有 model 键）', async () => {
    stubLocal({
      ok: true,
      version: '0.5.7',
      models: [{ name: 'bge-m3', size: 1 }],
    })
    handlers['embedding:local-set-config'] = () => ({ success: true })
    handlers['kb:stats'] = () => ({ documentCount: 0, totalChunks: 0, vectorDimension: 0 })
    const { container, root } = render()
    await flush()

    expect(radioFor(container, 'bge-m3').checked).toBe(true) // 当前值来自 local-get-config

    click(radioFor(container, 'nomic-embed-text'))
    await flush()

    const call = setConfigCalls().at(-1)
    expect(call?.[0]).toBe('embedding:local-set-config')
    expect(call?.[1]).toEqual({ model: 'nomic-embed-text' }) // 部分更新：不得顺带覆盖 enabled/baseUrl/preferLocal
    act(() => { root.unmount() })
  })

  it('R2：地址默认不渲染（无排障区 / 无「重置为默认」），可编辑输入只在默认收起的「高级设置」里', async () => {
    stubLocal({ ok: true, version: '0.5.7', models: [{ name: 'bge-m3', size: 1 }] })
    const { container, root } = render()
    await flush()

    // ① 检测成功（默认地址本来就是对）→ 不出现排障文案、不出现重置按钮
    expect(container.textContent).not.toContain('重置为默认')
    expect(container.textContent).not.toContain('连接失败')
    // ② 地址输入框本身仍在（T5 既有契约的落点），但被收进**默认收起**的「高级设置」
    const advanced = detailsBySummary(container, '高级设置')
    expect(advanced, '未找到「高级设置」折叠区').not.toBeNull()
    expect((advanced as HTMLDetailsElement).open).toBe(false)
    const input = requireEl(container, 'input[aria-label="Ollama 地址"]')
    expect(input.closest('details')).toBe(advanced)
    // ③ 展开后仍可编辑（写配置走同一条 commitBaseUrl 路径）
    handlers['embedding:local-set-config'] = () => ({ success: true })
    act(() => { (advanced as HTMLDetailsElement).open = true })
    expect((advanced as HTMLDetailsElement).open).toBe(true)
    typeInto(input as HTMLInputElement, '  http://192.168.1.9:11434  ')
    blur(input)
    await flush()
    expect(setConfigCalls().at(-1)?.[1]).toEqual({ baseUrl: 'http://192.168.1.9:11434' })
    act(() => { root.unmount() })
  })

  it('R2：检测失败（未连接）→ 显示当前地址作为排障信息 + 「重置为默认」写回默认地址', async () => {
    handlers['embedding:local-get-config'] = () => ({
      ...DEFAULT_CONFIG,
      baseUrl: 'http://127.0.0.1:1234',
    })
    handlers['embedding:local-detect'] = () => ({ ok: false, error: 'ECONNREFUSED 127.0.0.1:1234' })
    handlers['embedding:local-list-models'] = () => []
    handlers['embedding:local-set-config'] = () => ({ success: true })
    const { container, root } = render()
    await flush()

    // 排障信息 = 当前配置里的地址（用户乱改过/端口不对时唯一的线索）
    expect(container.textContent).toContain('http://127.0.0.1:1234')
    const reset = button(container, '重置为默认')
    expect(reset.disabled).toBe(false)
    click(reset)
    await flush()
    expect(setConfigCalls().at(-1)?.[1]).toEqual({ baseUrl: 'http://localhost:11434' })
    act(() => { root.unmount() })
  })
})

describe('本地向量模型卡片 · U1 进度 / U2 维度 / U4 错误面', () => {
  it('U1：percent>100 clamp 到 100%；total 缺失退化为不确定态（不显示百分比）', async () => {
    stubLocal({ ok: true, version: '0.5.7', models: [{ name: 'llama3', size: 1 }] })
    handlers['embedding:local-pull'] = () => ({ started: true })
    const { container, root } = render()
    await flush()

    click(button(container, '下载模型'))
    await flush()
    expect(mocks.invoke).toHaveBeenCalledWith('embedding:local-pull')

    await act(async () => {
      progressHandler?.({ status: 'downloading', completed: 200, total: 100, percent: 150 })
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(requireEl(container, '[role="status"]').textContent).toContain('100%')

    await act(async () => {
      progressHandler?.({ status: 'pulling manifest' }) // Ollama 早期帧：只有 status，无 total
      await new Promise((r) => setTimeout(r, 0))
    })
    const indeterminate = requireEl(container, '[role="status"]').textContent ?? ''
    expect(indeterminate).not.toMatch(/%/)
    expect(indeterminate).toContain('正在下载')
    // T5-Minor 1：模型列表刷新**只**发生在 success 终帧 —— 下载中/不确定态帧都不得触发
    expect(listModelsCalls()).toHaveLength(1)
    act(() => { root.unmount() })
  })

  it('pull 成功终帧（status=success）→ 重新拉模型列表并翻到就绪', async () => {
    let models: LocalModel[] = []
    handlers['embedding:local-get-config'] = () => DEFAULT_CONFIG
    handlers['embedding:local-detect'] = () => ({ ok: true, version: '0.5.7' })
    handlers['embedding:local-list-models'] = () => models
    handlers['embedding:local-pull'] = () => ({ started: true })
    const { container, root } = render()
    await flush()
    expect(container.textContent).toContain('未安装')

    click(button(container, '下载模型'))
    await flush()

    models = [{ name: 'bge-m3', size: 12 }]
    await act(async () => {
      progressHandler?.({ status: 'success' })
      await new Promise((r) => setTimeout(r, 0))
    })

    const listCalls = mocks.invoke.mock.calls.filter((c) => c[0] === 'embedding:local-list-models')
    expect(listCalls.length).toBeGreaterThanOrEqual(2) // 挂载一次 + 终帧后一次
    expect(container.textContent).toContain('就绪')
    act(() => { root.unmount() })
  })

  it('FW-1：pull 失败终帧（status=error）→ 进度条收掉 + 按钮恢复可重试 + t() 主文案 + 原始串只在可折叠详情', async () => {
    stubLocal({ ok: true, version: '0.5.7', models: [{ name: 'llama3', size: 1 }] })
    handlers['embedding:local-pull'] = () => ({ started: true })
    const { container, root } = render()
    await flush()

    click(button(container, '下载模型'))
    await flush()
    // 发起成功 → 进入「下载中」：按钮 disabled（bug 里会永久停在这个假进行态）
    expect(requireEl(container, '[role="status"]')).toBeTruthy()
    expect(button(container, '下载模型').disabled).toBe(true)

    const raw = 'Ollama /api/pull failed: HTTP 500 {"error":"manifest unavailable"}'
    await act(async () => {
      progressHandler?.({ status: 'error', error: raw })
      await new Promise((r) => setTimeout(r, 0))
    })

    // ① 进度条收掉（不再停在最后一帧）② 按钮恢复可点（用户唯一的主动作可以重试）
    expect(query(container, '[role="status"]')).toBeNull()
    expect(button(container, '下载模型').disabled).toBe(false)
    // ③ 主文案走 t()（U4：英文技术串不得当主文案）④ 原始串只在 <details> 里
    expect(textOutsideDetails(container)).toContain(t('localEmbedding.pullFailed'))
    expect(textOutsideDetails(container)).not.toContain('Ollama /api/pull failed')
    expect(query(container, 'details')?.textContent).toContain(raw)
    // 失败不重取模型列表（刷新只发生在 success 终帧）
    expect(mocks.invoke.mock.calls.filter((c) => c[0] === 'embedding:local-list-models')).toHaveLength(1)
    act(() => { root.unmount() })
  })

  it('T5-Minor 3：local-pull 返回 { started:false, error } → 主文案 pullFailed + 原始串只在 details，且从不进「下载中」', async () => {
    stubLocal({ ok: true, version: '0.5.7', models: [{ name: 'llama3', size: 1 }] })
    const raw = 'already in progress'
    handlers['embedding:local-pull'] = () => ({ started: false, error: raw })
    const { container, root } = render()
    await flush()

    click(button(container, '下载模型'))
    await flush()

    // ① 主文案走 t()（U4：英文技术串不得当主文案）② 原始串只在 <details> 里
    expect(textOutsideDetails(container)).toContain(t('localEmbedding.pullFailed'))
    expect(textOutsideDetails(container)).not.toContain(raw)
    expect(query(container, 'details')?.textContent).toContain(raw)
    // ③ started:false → **从未**进入 pulling 态：进度条不存在、按钮保持可点（用户可重试）
    expect(query(container, '[role="status"]')).toBeNull()
    expect(button(container, '下载模型').disabled).toBe(false)
    act(() => { root.unmount() })
  })

  it('测试按钮 → local-test 渲染维度；索引 0 维（新库）不告警', async () => {
    stubLocal({ ok: true, version: '0.5.7', models: [{ name: 'bge-m3', size: 1 }] })
    handlers['embedding:local-test'] = () => ({ success: true, dim: 1024 })
    handlers['kb:stats'] = () => ({ documentCount: 1, totalChunks: 3, vectorDimension: 0 })
    const { container, root } = render()
    await flush()

    click(button(container, '测试模型'))
    await flush()
    expect(mocks.invoke).toHaveBeenCalledWith('embedding:local-test')
    expect(container.textContent).toContain('1024 维')
    expect(container.textContent).not.toContain('维度不匹配')
    act(() => { root.unmount() })
  })

  it('U2：dim 与现有索引维度不一致 → 内联警告（两个维度 + 重建指引）', async () => {
    stubLocal({ ok: true, version: '0.5.7', models: [{ name: 'bge-m3', size: 1 }] })
    handlers['embedding:local-test'] = () => ({ success: true, dim: 1024 })
    handlers['kb:stats'] = () => ({ documentCount: 9, totalChunks: 900, vectorDimension: 1536 })
    const { container, root } = render()
    await flush()

    click(button(container, '测试模型'))
    await flush()
    expect(container.textContent).toContain('维度不匹配')
    expect(container.textContent).toContain('1024')
    expect(container.textContent).toContain('1536')
    expect(container.textContent).toContain('重建')
    act(() => { root.unmount() })
  })

  it('U4：测试失败 → t() 主文案 + 原始英文串只在可折叠详情', async () => {
    stubLocal({ ok: true, version: '0.5.7', models: [{ name: 'bge-m3', size: 1 }] })
    const raw = 'Ollama /api/embed failed: HTTP 404 {"error":"model not found"}'
    handlers['embedding:local-test'] = () => ({ success: false, error: raw })
    const { container, root } = render()
    await flush()

    click(button(container, '测试模型'))
    await flush()
    expect(container.textContent).toContain('测试失败')
    expect(query(container, 'details')?.textContent).toContain(raw)
    expect(textOutsideDetails(container)).not.toContain('Ollama /api/embed failed')
    act(() => { root.unmount() })
  })

  // R3：换模型会改维度，而写入侧有维度守卫（硬拒绝）→ 选择与当前不同的模型时必须提前提示重建。
  it('R3：切到不同模型 + 索引已有向量（vectorDimension>0）→ 复用 U2 告警区的重建提示', async () => {
    stubLocal({ ok: true, version: '0.5.7', models: [{ name: 'bge-m3', size: 1 }] })
    handlers['embedding:local-set-config'] = () => ({ success: true })
    handlers['kb:stats'] = () => ({ documentCount: 9, totalChunks: 900, vectorDimension: 1024 })

    const { container, root } = render()
    await flush()

    expect(container.textContent).not.toContain('切换模型可能改变向量维度')

    // 先制造一条 U2 维度告警当参照（local-test 的 dim ≠ 索引维度）
    handlers['embedding:local-test'] = () => ({ success: true, dim: 768 })
    click(button(container, '测试模型'))
    await flush()
    expect(container.textContent).toContain('维度不匹配')

    click(radioFor(container, 'nomic-embed-text'))
    await flush()

    expect(container.textContent).toContain('切换模型可能改变向量维度')
    expect(container.textContent).toContain('重建')

    // 「不造第二套告警 UI」：R3 提示与 U2 告警同父容器、同行结构（同类名 + 同一风格属性 + 同一个警示图标）
    const r3Row = [...container.querySelectorAll('span')]
      .find((s) => s.textContent === t('localEmbedding.modelSwitchDimWarn'))?.parentElement
    const u2Row = [...container.querySelectorAll('span')]
      .find((s) => s.textContent?.includes('维度不匹配'))?.parentElement
    expect(r3Row, '未找到 R3 提示元素').toBeTruthy()
    expect(u2Row, '未找到 U2 告警元素').toBeTruthy()
    expect(r3Row?.parentElement).toBe(u2Row?.parentElement) // 同一个告警区
    expect(r3Row?.className).toBe(u2Row?.className) // 同一行样式
    expect(r3Row?.getAttribute('style')).toBe(u2Row?.getAttribute('style')) // 同一个 warning 语义色
    expect(r3Row?.querySelector('svg')).not.toBeNull() // 同一个 AlertTriangle 图标位
    act(() => { root.unmount() })
  })

  it('R3：索引为空（vectorDimension=0）→ 换模型不提示重建（避免新库误报）', async () => {
    stubLocal({ ok: true, version: '0.5.7', models: [{ name: 'bge-m3', size: 1 }] })
    handlers['embedding:local-set-config'] = () => ({ success: true })
    handlers['kb:stats'] = () => ({ documentCount: 0, totalChunks: 0, vectorDimension: 0 })
    const { container, root } = render()
    await flush()

    click(radioFor(container, 'nomic-embed-text'))
    await flush()

    expect(setConfigCalls().at(-1)?.[1]).toEqual({ model: 'nomic-embed-text' })
    expect(container.textContent).not.toContain('切换模型可能改变向量维度')
    act(() => { root.unmount() })
  })
})

describe('本地向量模型卡片 · U5 数据来源容错', () => {
  it('挂载时三路并行取数（任一路未返回也不阻塞其它两路）', async () => {
    const pending: Record<string, (v: unknown) => void> = {}
    const hang = (channel: string) => () => new Promise((resolve) => { pending[channel] = resolve })
    handlers['embedding:local-get-config'] = hang('config')
    handlers['embedding:local-detect'] = hang('detect')
    handlers['embedding:local-list-models'] = hang('models')

    const { container, root } = render()
    await flush()

    const channels = mocks.invoke.mock.calls.map((c) => c[0])
    expect(channels).toContain('embedding:local-get-config')
    expect(channels).toContain('embedding:local-detect')
    expect(channels).toContain('embedding:local-list-models')

    await act(async () => {
      pending.config?.(DEFAULT_CONFIG)
      pending.detect?.({ ok: false })
      pending.models?.([])
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(container.textContent).toContain('未连接')
    act(() => { root.unmount() })
  })

  it('local-get-config 失败：卡片照常渲染为「未连接」+ 可折叠详情，写入控件禁用', async () => {
    handlers['embedding:local-get-config'] = () => { throw new Error('config read failed') }
    handlers['embedding:local-detect'] = () => ({ ok: false })
    handlers['embedding:local-list-models'] = () => []
    const { container, root } = render()
    await flush()

    expect(container.textContent).toContain('本地向量模型')
    expect(container.textContent).toContain('未连接')
    expect(query(container, 'details')?.textContent).toContain('config read failed')
    expect(requireEl(container, '[role="switch"][aria-label="启用本地向量模型"]').getAttribute('disabled')).not.toBeNull()
    act(() => { root.unmount() })
  })

  it('local-detect 抛错：卡片照常渲染为「未连接」+ 可折叠详情', async () => {
    handlers['embedding:local-get-config'] = () => DEFAULT_CONFIG
    handlers['embedding:local-detect'] = () => { throw new Error('detect ipc rejected') }
    handlers['embedding:local-list-models'] = () => []
    const { container, root } = render()
    await flush()

    expect(container.textContent).toContain('未连接')
    expect(query(container, 'details')?.textContent).toContain('detect ipc rejected')
    act(() => { root.unmount() })
  })

  it('local-list-models 抛错：按「无已装模型」降级，不破卡片', async () => {
    handlers['embedding:local-get-config'] = () => DEFAULT_CONFIG
    handlers['embedding:local-detect'] = () => ({ ok: true, version: '0.5.7' })
    handlers['embedding:local-list-models'] = () => { throw new Error('tags ipc rejected') }
    const { container, root } = render()
    await flush()

    expect(container.textContent).toContain('模型 bge-m3 未安装')
    expect(query(container, 'details')?.textContent).toContain('tags ipc rejected')
    act(() => { root.unmount() })
  })
})

describe('本地向量模型卡片 · 事件订阅生命周期', () => {
  it('订阅 embedding:local-pull-progress，卸载时 unsubscribe（不泄漏监听器）', async () => {
    stubLocal({ ok: true, version: '0.5.7', models: [{ name: 'bge-m3', size: 1 }] })
    const { root } = render()
    await flush()

    expect(mocks.on).toHaveBeenCalledWith('embedding:local-pull-progress', expect.any(Function))
    expect(unsubSpy).not.toHaveBeenCalled()

    act(() => { root.unmount() })
    expect(unsubSpy).toHaveBeenCalledTimes(1)
  })
})
