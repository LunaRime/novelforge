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
