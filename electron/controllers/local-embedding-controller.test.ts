/**
 * local-embedding-controller — 本地 Ollama 向量档 IPC（T4）
 *
 * 覆盖（brief Step 1 + L4 铁律）：
 * - 6 条通道全部注册，且**注册走 `guardedHandle`**（来源不可信时 handler 抛错，而非裸 ipcMain.handle）
 * - `local-detect` / `local-list-models` / `local-test` 转发 T2 模块并返回其结构
 * - `local-pull` **立即返回**（不等待下载完成），进度帧经 `event.sender.send('embedding:local-pull-progress')` 推送；
 *   同一 (baseUrl, model) 已在拉取中 → `{ started:false }`
 * - `local-get-config` / `local-set-config` 真实读写往返（不覆盖其它全局配置字段）
 *
 * ⚠️ CI 一致性（ci-parity-standard）：本文件 import 到 electron → **必须 `vi.mock('electron')`**；
 *    另 mock `node:os` homedir 到临时目录，绝不读写真实 `~/.novelforge`。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'

// ===== mock 状态（vi.hoisted：模块工厂先于 import 求值）=====

const h = vi.hoisted(() => ({
  /** 临时假 home（不建目录，由 writeJsonFile 自行 mkdir） */
  home: `${process.env.TEMP ?? process.env.TMP ?? process.cwd()}/nf-local-emb-ctl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  /** 通道 → 真实注册的 handler（由 mock 的 ipcMain.handle 捕获） */
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  senderSend: vi.fn(),
  detectOllama: vi.fn(),
  listOllamaModels: vi.fn(),
  pullModel: vi.fn(),
  embedLocal: vi.fn(),
  installModel: vi.fn(),
  createElectronTransport: vi.fn(() => ({ request: vi.fn() })),
}))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  const homedir = () => h.home
  return { ...actual, homedir, default: { ...actual, homedir } }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      h.handlers.set(channel, fn)
    },
    removeHandler: vi.fn(),
  },
  dialog: { showOpenDialog: vi.fn() },
}))

vi.mock('../ollama-embedding', () => ({
  detectOllama: h.detectOllama,
  listOllamaModels: h.listOllamaModels,
  pullModel: h.pullModel,
  embedLocal: h.embedLocal,
}))

// 智能下载（T4 接线）：真实实现要 electron 的 net/session，且已在 T1-T3 单测覆盖；
// 这里只验**接线契约**——成功即终结、失败必回退
vi.mock('../model-installer', () => ({ installModel: h.installModel }))
vi.mock('../net/electron-net-transport', () => ({ createElectronTransport: h.createElectronTransport }))

// 真实 logger 会往 `~/.novelforge/logs/` 写盘（本文件 homedir 已改为临时假 home → ENOENT）
// 且日志内容无断言 → 打桩
vi.mock('../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), getLogDir: () => '' },
}))

import { GLOBAL_CONFIG_PATH, VELA_HOME, writeJsonFile } from '../utils/config-utils'
import { trustWebContents, resetTrustedWebContentsForTest } from '../security/ipc-guard'
import { registerLocalEmbeddingController } from './local-embedding-controller'

// ===== 测试脚手架 =====

const SENDER_ID = 7
/** 伪装成「应用自己的 top frame」（ipc-guard §4.4：存活 + top frame + 白名单 + file:// 生产页面） */
const fakeEvent = {
  sender: { id: SENDER_ID, send: h.senderSend },
  senderFrame: { url: 'file:///app/index.html', parent: null },
}

function call(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`通道未注册: ${channel}`)
  // guardedHandle 的来源校验是**同步抛**（拒绝在 handler 执行之前）→ 同步异常也要变成 rejected promise
  try {
    return Promise.resolve(fn(fakeEvent, ...args))
  } catch (e) {
    return Promise.reject(e)
  }
}

function readRawGlobalConfig(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf-8')) as Record<string, unknown>
}

/** 让下一次（或已发生的）pull 的 onProgress 回调可被测试驱动 */
function captureProgressCallback(): (p: unknown) => void {
  const args = h.pullModel.mock.calls[h.pullModel.mock.calls.length - 1] as unknown[]
  return args[2] as (p: unknown) => void
}

/** 等一整个宏任务：让 `pullModel(...).then/.catch/.finally` 链全部落地 */
function settle(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0) })
}

beforeAll(() => {
  registerLocalEmbeddingController()
})

beforeEach(() => {
  vi.clearAllMocks()
  resetTrustedWebContentsForTest()
  trustWebContents(SENDER_ID)
  fs.rmSync(h.home, { recursive: true, force: true })
  // 缺省让智能下载失败 → 既有用例走的都是「回退 pullModel」这条路径（= 本功能上线前的行为）
  h.installModel.mockResolvedValue({ success: false, error: 'stub: 智能下载未在本用例启用' })
})

afterEach(() => {
  fs.rmSync(h.home, { recursive: true, force: true })
})

// ===== 用例 =====

describe('注册与收口（L4 铁律 4/6）', () => {
  it('6 条 embedding:local-* 通道全部注册', () => {
    for (const ch of [
      'embedding:local-detect',
      'embedding:local-list-models',
      'embedding:local-pull',
      'embedding:local-test',
      'embedding:local-get-config',
      'embedding:local-set-config',
    ]) {
      expect(h.handlers.has(ch), `未注册: ${ch}`).toBe(true)
    }
  })

  it('注册走 guardedHandle：来源不在白名单 → 拒绝（不是裸 ipcMain.handle 的裸奔行为）', async () => {
    resetTrustedWebContentsForTest() // 清空白名单 → 无任何可信来源
    await expect(call('embedding:local-detect')).rejects.toThrow(/sender not trusted/)
  })
})

describe('embedding:local-detect（转发 detectOllama）', () => {
  it('返回 detectOllama 的结构（ok/version）', async () => {
    h.detectOllama.mockResolvedValue({ ok: true, version: '0.5.7' })

    await expect(call('embedding:local-detect')).resolves.toEqual({ ok: true, version: '0.5.7' })
    expect(h.detectOllama).toHaveBeenCalledTimes(1)
    expect(h.detectOllama.mock.calls[0][0]).toBe('http://localhost:11434') // 取自全局配置默认值
  })

  it('不可用 → 原样透传 { ok:false, error }（三态不抛）', async () => {
    h.detectOllama.mockResolvedValue({ ok: false, error: 'fetch failed' })

    await expect(call('embedding:local-detect')).resolves.toEqual({ ok: false, error: 'fetch failed' })
  })
})

describe('embedding:local-list-models', () => {
  it('转发 listOllamaModels 的数组结构', async () => {
    h.listOllamaModels.mockResolvedValue([{ name: 'bge-m3:latest', size: 1234 }])

    await expect(call('embedding:local-list-models')).resolves.toEqual([{ name: 'bge-m3:latest', size: 1234 }])
    expect(h.listOllamaModels.mock.calls[0][0]).toBe('http://localhost:11434')
  })
})

describe('embedding:local-test（真实探测维度）', () => {
  it('用 embedLocal([\'测试文本\'], baseUrl, model) → { success:true, dim }', async () => {
    h.embedLocal.mockResolvedValue([new Array(1024).fill(0.1)])

    await expect(call('embedding:local-test')).resolves.toEqual({ success: true, dim: 1024 })
    expect(h.embedLocal).toHaveBeenCalledTimes(1)
    const [texts, baseUrl, model] = h.embedLocal.mock.calls[0] as [string[], string, string]
    expect(texts).toEqual(['测试文本'])
    expect(baseUrl).toBe('http://localhost:11434')
    expect(model).toBe('bge-m3')
  })

  it('embedLocal 抛错（T2 契约）→ { success:false, error }，不向渲染层抛', async () => {
    h.embedLocal.mockRejectedValue(new Error('Ollama /api/embed failed: HTTP 404'))

    const res = (await call('embedding:local-test')) as { success: boolean; dim?: number; error?: string }
    expect(res.success).toBe(false)
    expect(res.dim).toBeUndefined()
    expect(res.error).toContain('HTTP 404')
  })

  it('返回空向量（0 维）→ success:false（不把 0 维当成可用维度上报）', async () => {
    h.embedLocal.mockResolvedValue([[]])

    const res = (await call('embedding:local-test')) as { success: boolean; dim?: number; error?: string }
    expect(res.success).toBe(false)
    expect(res.dim).toBeUndefined()
    expect(res.error).toBeTruthy()
  })
})

describe('embedding:local-pull（仅发起，立即返回 + 进度事件）', () => {
  it('pull 未完成时立即返回 { started:true }（不等下载，避开 30s IPC 超时）', async () => {
    let release: (v: { success: boolean }) => void = () => {}
    const pending = new Promise<{ success: boolean }>((resolve) => { release = resolve })
    h.pullModel.mockReturnValue(pending)

    await expect(call('embedding:local-pull')).resolves.toEqual({ started: true })
    await settle() // 智能下载先跑一轮（本用例里它失败）才轮到回退
    expect(h.pullModel).toHaveBeenCalledTimes(1)
    expect(h.pullModel.mock.calls[0][0]).toBe('http://localhost:11434')
    expect(h.pullModel.mock.calls[0][1]).toBe('bge-m3')

    release({ success: true })
    await pending
  })

  it('onProgress 帧经 event.sender.send(\'embedding:local-pull-progress\') 推送给渲染层', async () => {
    let release: (v: { success: boolean }) => void = () => {}
    const pending = new Promise<{ success: boolean }>((resolve) => { release = resolve })
    h.pullModel.mockReturnValue(pending)

    await call('embedding:local-pull')
    await settle() // 等智能下载先失败，回退的 pullModel 已被调用
    const onProgress = captureProgressCallback()
    onProgress({ status: 'pulling manifest' })
    onProgress({ status: 'downloading', completed: 512, total: 1024, percent: 50 })

    expect(h.senderSend).toHaveBeenNthCalledWith(1, 'embedding:local-pull-progress', { status: 'pulling manifest' })
    expect(h.senderSend).toHaveBeenNthCalledWith(2, 'embedding:local-pull-progress', {
      status: 'downloading', completed: 512, total: 1024, percent: 50,
    })

    // 收尾：让进行中的拉取结束（清掉 in-flight 标记，避免污染后续用例）
    release({ success: true })
    await pending
  })

  it('FW-1：pull 结束但失败（res.success=false）→ 补发终态 error 帧（渲染层否则永久停在「下载中」）', async () => {
    h.pullModel.mockResolvedValue({ success: false, error: 'Ollama /api/pull failed: HTTP 500' })

    await call('embedding:local-pull')
    await settle()

    // T2 的 pullModel 只把 {"error"} 帧消费成返回值（ollama-embedding.ts:174-177），
    // 渲染层看不到 → 必须由控制器从自己的 .then 合成一条终态帧
    expect(h.senderSend).toHaveBeenCalledWith('embedding:local-pull-progress', {
      status: 'error',
      error: 'Ollama /api/pull failed: HTTP 500',
    })
  })

  it('FW-1：pull 直接抛错（reject）→ 同样补发终态 error 帧（原文经 safeErrorMessage）', async () => {
    h.pullModel.mockRejectedValue(new Error('socket hang up'))

    await call('embedding:local-pull')
    await settle()

    expect(h.senderSend).toHaveBeenCalledWith('embedding:local-pull-progress', {
      status: 'error',
      error: 'socket hang up',
    })
  })

  it('同一 (baseUrl, model) 已在拉取中 → 第二次 { started:false }（防连点重复下载）', async () => {
    let release: (v: { success: boolean }) => void = () => {}
    const pending = new Promise<{ success: boolean }>((resolve) => { release = resolve })
    h.pullModel.mockReturnValue(pending)

    await expect(call('embedding:local-pull')).resolves.toEqual({ started: true })
    await settle()

    const second = (await call('embedding:local-pull')) as { started: boolean; error?: string }
    expect(second.started).toBe(false)
    expect(second.error).toBeTruthy()
    expect(h.pullModel).toHaveBeenCalledTimes(1) // 未重复发起

    // ⚠️ 必须放行：pullsInFlight 是模块级状态，悬挂的拉取会让**后续用例**全部拿到 {started:false}
    release({ success: true })
    await settle()
  })
})

describe('embedding:local-get-config / local-set-config（读全局配置）', () => {
  it('未配置 → 返回默认值（enabled=false，不误开本地档）', async () => {
    await expect(call('embedding:local-get-config')).resolves.toEqual({
      enabled: false,
      baseUrl: 'http://localhost:11434',
      model: 'bge-m3',
      preferLocal: true,
    })
  })

  it('set → get 往返；且不覆盖其它全局配置字段（合并写回）', async () => {
    writeJsonFile(GLOBAL_CONFIG_PATH, { theme: 'light', editorFontSize: 18 })

    await expect(call('embedding:local-set-config', {
      enabled: true, baseUrl: 'http://127.0.0.1:11500', model: 'nomic-embed-text',
    })).resolves.toEqual({ success: true })

    await expect(call('embedding:local-get-config')).resolves.toEqual({
      enabled: true,
      baseUrl: 'http://127.0.0.1:11500',
      model: 'nomic-embed-text',
      preferLocal: true, // 未传 → 保留默认（本地优先）
    })

    const raw = readRawGlobalConfig()
    expect(raw.theme).toBe('light') // 既有字段未被覆盖
    expect(raw.editorFontSize).toBe(18)
  })

  it('部分更新（只改 preferLocal）→ 其它字段保持已存值', async () => {
    writeJsonFile(GLOBAL_CONFIG_PATH, {
      localEmbedding: { enabled: true, baseUrl: 'http://127.0.0.1:11500', model: 'nomic-embed-text', preferLocal: true },
    })

    await call('embedding:local-set-config', { preferLocal: false })

    await expect(call('embedding:local-get-config')).resolves.toEqual({
      enabled: true,
      baseUrl: 'http://127.0.0.1:11500',
      model: 'nomic-embed-text',
      preferLocal: false,
    })
  })

  it('set 的非法值（空 baseUrl / 非 boolean enabled）不写坏配置：读回仍是可用值', async () => {
    await call('embedding:local-set-config', { baseUrl: '', enabled: 'yes' })

    const cfg = (await call('embedding:local-get-config')) as { enabled: boolean; baseUrl: string; model: string }
    expect(cfg.enabled).toBe(false) // 非严格真值不启用
    expect(cfg.baseUrl).toBe('http://localhost:11434') // 空串回退默认
    expect(cfg.model).toBe('bge-m3')
    expect(fs.existsSync(VELA_HOME)).toBe(true)
  })
})

describe('embedding:local-pull（T4：智能下载 → 失败回退）', () => {
  /** 取最近一次 installModel 的 options（用它能驱动 onProgress / onSwitch） */
  function captureInstallOptions(): {
    name: string
    onProgress?: (p: Record<string, unknown>) => void
    onSwitch?: (from: Record<string, unknown>, to: Record<string, unknown>) => void
  } {
    const args = h.installModel.mock.calls[h.installModel.mock.calls.length - 1] as unknown[]
    return args[1] as ReturnType<typeof captureInstallOptions>
  }

  /** 让 installModel 挂起（下载中），返回放行函数 */
  function holdInstall(): () => void {
    let release: (v: unknown) => void = () => {}
    h.installModel.mockReturnValue(new Promise((resolve) => { release = resolve }))
    return () => release({ success: true })
  }

  it('智能下载成功 → 只发 success 帧，且不回退 pullModel', async () => {
    h.installModel.mockResolvedValue({ success: true, usedPath: { id: 'proxy', label: '127.0.0.1:7897' } })

    await call('embedding:local-pull')
    await settle()

    expect(h.senderSend).toHaveBeenCalledWith('embedding:local-pull-progress', { status: 'success' })
    expect(h.pullModel).not.toHaveBeenCalled()
  })

  it('模型名走配置（渲染层不传），且传入的 deps 能查回模型列表', async () => {
    h.installModel.mockResolvedValue({ success: true })

    await call('embedding:local-pull')
    await settle()

    expect(captureInstallOptions().name).toBe('bge-m3')
    const deps = h.installModel.mock.calls[0][0] as { listModels: () => Promise<unknown> }
    await deps.listModels()
    expect(h.listOllamaModels).toHaveBeenCalledWith('http://localhost:11434')
  })

  it('智能下载失败 → 回退 Ollama 自身 pull（回退是设计的一部分）', async () => {
    h.installModel.mockResolvedValue({ success: false, error: '模型目录不可写' })
    h.pullModel.mockResolvedValue({ success: true })

    await call('embedding:local-pull')
    await settle()

    expect(h.pullModel).toHaveBeenCalledTimes(1)
  })

  it('智能下载抛错（契约外）→ 同样回退，不把用户的老路径一并堵死', async () => {
    h.installModel.mockRejectedValue(new Error('boom'))
    h.pullModel.mockResolvedValue({ success: true })

    await call('embedding:local-pull')
    await settle()

    expect(h.pullModel).toHaveBeenCalledTimes(1)
  })

  it('进度帧带路径与实测速率，percent 由 completed/total 算出', async () => {
    const release = holdInstall()
    await call('embedding:local-pull')

    captureInstallOptions().onProgress?.({
      completed: 50, total: 200, bytesPerSec: 1_500_000, pathId: 'proxy', pathLabel: '127.0.0.1:7897',
    })

    expect(h.senderSend).toHaveBeenCalledWith('embedding:local-pull-progress', {
      status: 'downloading',
      completed: 50,
      total: 200,
      percent: 25,
      path: 'proxy',
      pathLabel: '127.0.0.1:7897',
      bytesPerSec: 1_500_000,
      switchedFrom: undefined,
    })
    release()
    await settle()
  })

  it('换路不单独发帧：switchedFrom 附在换路后的第一帧（独立帧会把 percent 冲成 0，进度条跳回起点）', async () => {
    const release = holdInstall()
    await call('embedding:local-pull')
    const opts = captureInstallOptions()

    opts.onSwitch?.({ id: 'direct', label: 'direct' }, { id: 'proxy', label: '127.0.0.1:7897' })
    expect(h.senderSend).not.toHaveBeenCalled() // 换路本身不推帧

    opts.onProgress?.({ completed: 10, total: 100, pathId: 'proxy', pathLabel: '127.0.0.1:7897' })
    expect(h.senderSend).toHaveBeenNthCalledWith(1, 'embedding:local-pull-progress',
      expect.objectContaining({ completed: 10, percent: 10, switchedFrom: 'direct' }))

    // 一次性标记：下一帧不再带
    opts.onProgress?.({ completed: 20, total: 100, pathId: 'proxy', pathLabel: '127.0.0.1:7897' })
    expect(h.senderSend).toHaveBeenNthCalledWith(2, 'embedding:local-pull-progress',
      expect.objectContaining({ completed: 20, percent: 20, switchedFrom: undefined }))

    release()
    await settle()
  })
})
