// @vitest-environment jsdom
/**
 * llm-store × 凭据接线（T6 评审 Important：store 层四条新契约此前零覆盖）
 *
 * 四个组件测试都把 `stores/llm-store` 整个 `vi.mock` 掉（断的是 mock 参数，不是 store 行为），
 * 结构上看不见这四条 —— 其中 `saveProvider` 的 reload 判据正是最怕被回退掉的**跨任务携带项**
 * （T5-m2：凭据写盘失败时配置已写，不 reload 会让 UI 停旧态 + 重试草稿无 ref 而派生 `_2`）。
 *
 * 本文件用**真 store** + `ipc.invoke` 打桩，逐条钉住：
 * 1. `saveProvider` 的 reload 判据：`success:false` 但**带 revision** → 照常重载；
 *    无 revision / conflict（一字节没写）→ **不**重载
 * 2. `describeCredentials`：定点（传 refs）= 合并；全量（不传）= 用新结果**替换**（清陈旧 ref）
 * 3. `unsetCredential`：IPC reject 也要兜成 `{success:false}`（不能把异常抛给调用方）
 * 4. `deleteProvider` / `saveModel` 返回**整个结果**（含 error），不是布尔
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

// isElectron: true —— store 的每条 IPC 路径都以此为前提（否则整段直接 return，测试变成假阳性）
vi.mock('../services/ipc-client', () => ({ ipc: { invoke: invokeMock, isElectron: true } }))
vi.mock('../services/render-logger', () => ({ renderLog: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { useLLMStore } from './llm-store'
import type { ProviderAccount } from '../shared/ipc-channels'

const ACCOUNT: ProviderAccount = {
  id: 'acct-1', provider: 'custom', protocol: 'openai',
  apiKeyRef: 'CUSTOM_API_KEY', baseUrl: 'https://gw.example.com', modelNames: ['gen-1'],
}

/** 每个通道的默认应答（单条用例可覆盖）；记录调用顺序用于断言「有没有重载」 */
function stubIPC(handlers: Record<string, (args: unknown[]) => unknown> = {}) {
  invokeMock.mockImplementation(async (channel: string, ...args: unknown[]) => {
    if (handlers[channel]) return handlers[channel](args)
    if (channel === 'llm:list-models') return []
    if (channel === 'llm:list-providers') return { accounts: [], revision: 1 }
    if (channel === 'credential:describe') return {}
    if (channel === 'credential:unset') return { success: true }
    return { success: true }
  })
}

const channels = () => invokeMock.mock.calls.map((c) => c[0] as string)
const reloaded = () => channels().includes('llm:list-providers') && channels().includes('llm:list-models')

beforeEach(() => {
  invokeMock.mockReset()
  stubIPC()
  useLLMStore.setState({
    models: [],
    providers: [],
    providersRevision: 0,
    credentialInfo: {},
  })
})

describe('saveProvider 的 reload 判据（T5-m2 携带项）', () => {
  it('凭据写盘失败（success:false **带 revision** = 配置已写）→ 照常重载两边', async () => {
    stubIPC({
      'llm:save-provider': () => ({ success: false, error: 'disk full', revision: 9 }),
    })

    const result = await useLLMStore.getState().saveProvider(ACCOUNT, undefined, 7, 'sk-abc')

    expect(result).toEqual({ success: false, error: 'disk full', revision: 9 })
    expect(reloaded()).toBe(true)
    // 重载要带出新 revision（否则用户重试时还拿旧版本号撞 conflict）
    expect(useLLMStore.getState().providersRevision).toBe(1) // 打桩返回的 list-providers revision
  })

  it('普通失败（无 revision）→ 不重载（主进程一个字节都没写）', async () => {
    stubIPC({ 'llm:save-provider': () => ({ success: false, error: 'keyIllegalCharacters' }) })

    await useLLMStore.getState().saveProvider(ACCOUNT, undefined, 7, 'sk-密钥')

    expect(channels()).toEqual(['llm:save-provider'])
  })

  it('conflict → 不重载（写入被拒，UI 要停在用户眼前这份草稿上）', async () => {
    stubIPC({ 'llm:save-provider': () => ({ success: false, conflict: true, error: 'provider/conflict' }) })

    const result = await useLLMStore.getState().saveProvider(ACCOUNT, undefined, 6, undefined)

    expect(result.conflict).toBe(true)
    expect(channels()).toEqual(['llm:save-provider'])
  })

  it('成功 → 重载两边 + 顺带刷新凭据状态（灯跟着钥匙走）', async () => {
    stubIPC({
      'llm:save-provider': () => ({ success: true, revision: 8 }),
      'llm:list-providers': () => ({ accounts: [ACCOUNT], revision: 8 }),
      'credential:describe': () => ({ CUSTOM_API_KEY: { configured: true, source: 'store', writable: true } }),
    })

    await useLLMStore.getState().saveProvider(ACCOUNT, undefined, 7, 'sk-abc')

    expect(reloaded()).toBe(true)
    expect(useLLMStore.getState().providersRevision).toBe(8)
    expect(invokeMock).toHaveBeenCalledWith('credential:describe', ['CUSTOM_API_KEY'])
    expect(useLLMStore.getState().credentialInfo.CUSTOM_API_KEY.configured).toBe(true)
  })
})

describe('describeCredentials 的合并/替换语义', () => {
  it('定点（传 refs）→ 合并：不动其它 ref 的已知状态', async () => {
    useLLMStore.setState({
      credentialInfo: { B_API_KEY: { configured: true, source: 'store', writable: true } },
    })
    stubIPC({
      'credential:describe': () => ({ A_API_KEY: { configured: false, writable: true } }),
    })

    await useLLMStore.getState().describeCredentials(['A_API_KEY'])

    expect(invokeMock).toHaveBeenCalledWith('credential:describe', ['A_API_KEY'])
    expect(useLLMStore.getState().credentialInfo).toEqual({
      A_API_KEY: { configured: false, writable: true },
      B_API_KEY: { configured: true, source: 'store', writable: true },
    })
  })

  it('全量（不传 refs）→ 替换：refs 取自当前账户，结果里没有的陈旧 ref 被清掉', async () => {
    useLLMStore.setState({
      providers: [ACCOUNT],
      // 陈旧项：账户已换过 ref（或上一个账户被删），缓存里还留着
      credentialInfo: { STALE_API_KEY: { configured: true, source: 'store', writable: true } },
    })
    stubIPC({
      'credential:describe': () => ({ CUSTOM_API_KEY: { configured: true, source: 'env', writable: false } }),
    })

    await useLLMStore.getState().describeCredentials()

    expect(invokeMock).toHaveBeenCalledWith('credential:describe', ['CUSTOM_API_KEY'])
    expect(useLLMStore.getState().credentialInfo).toEqual({
      CUSTOM_API_KEY: { configured: true, source: 'env', writable: false },
    })
  })

  it('全量且一个 ref 都没有 → 清空缓存（删光账户后旧灯色不许滞留）', async () => {
    useLLMStore.setState({
      providers: [],
      credentialInfo: { STALE_API_KEY: { configured: true, source: 'store', writable: true } },
    })

    await useLLMStore.getState().describeCredentials()

    expect(useLLMStore.getState().credentialInfo).toEqual({})
    expect(channels()).not.toContain('credential:describe') // 没有 ref 就不发空查询
  })

  it('describe 失败 → 只降级（记日志、不抛、不动缓存；调用方仍能继续跑删除流程）', async () => {
    useLLMStore.setState({
      credentialInfo: { A_API_KEY: { configured: true, source: 'store', writable: true } },
    })
    stubIPC({
      'credential:describe': () => { throw new Error('main process gone') },
    })

    await expect(useLLMStore.getState().describeCredentials(['A_API_KEY'])).resolves.toBeUndefined()
    expect(useLLMStore.getState().credentialInfo).toEqual({
      A_API_KEY: { configured: true, source: 'store', writable: true },
    })
  })
})

describe('unsetCredential', () => {
  it('成功 → 定点刷新该 ref 的状态（删完立刻变「未配置」）', async () => {
    useLLMStore.setState({ credentialInfo: { A_API_KEY: { configured: true, source: 'store', writable: true } } })
    stubIPC({
      'credential:unset': () => ({ success: true }),
      'credential:describe': () => ({ A_API_KEY: { configured: false, writable: true } }),
    })

    const result = await useLLMStore.getState().unsetCredential('A_API_KEY')

    expect(result).toEqual({ success: true })
    expect(invokeMock).toHaveBeenCalledWith('credential:unset', 'A_API_KEY')
    expect(invokeMock).toHaveBeenCalledWith('credential:describe', ['A_API_KEY'])
    expect(useLLMStore.getState().credentialInfo.A_API_KEY.configured).toBe(false)
  })

  it('失败（主进程拒因）→ 原样带回 error，且不去刷新状态', async () => {
    stubIPC({ 'credential:unset': () => ({ success: false, error: 'envShadowed' }) })

    const result = await useLLMStore.getState().unsetCredential('A_API_KEY')

    expect(result).toEqual({ success: false, error: 'envShadowed' })
    expect(channels()).not.toContain('credential:describe')
  })

  it('IPC 本身 reject（超时/主进程异常）→ 兜成 {success:false}，不把异常抛给调用方', async () => {
    stubIPC({
      'credential:unset': () => { throw new Error('ipc timeout') },
    })

    await expect(useLLMStore.getState().unsetCredential('A_API_KEY'))
      .resolves.toEqual({ success: false, error: 'Error: ipc timeout' })
  })
})

describe('返回值形状（评审 m5：error 要能被消费）', () => {
  it('deleteProvider 失败 → 带回主进程的原因，且不重载', async () => {
    stubIPC({ 'llm:delete-provider': () => ({ success: false, error: 'provider not found' }) })

    const result = await useLLMStore.getState().deleteProvider('acct-1')

    expect(result).toEqual({ success: false, error: 'provider not found' })
    expect(reloaded()).toBe(false)
  })

  it('deleteProvider 成功 → 重载两边并清掉三层路由里的残留 id', async () => {
    useLLMStore.setState({ modelRoutes: { elite: ['gone'], standard: [], budget: [], strategy: 'dynamic' } })
    stubIPC({
      'llm:delete-provider': () => ({ success: true }),
      'llm:list-models': () => [{ id: 'alive' }],
    })

    const result = await useLLMStore.getState().deleteProvider('acct-1')

    expect(result).toEqual({ success: true })
    expect(reloaded()).toBe(true)
    expect(useLLMStore.getState().modelRoutes).toEqual({
      elite: [], standard: [], budget: [], strategy: 'dynamic', // strategy 不得被冲掉（评审 I2）
    })
  })

  it('saveModel 失败 → 带回拒因码（不是布尔 false，否则调用方只能弹「未知错误」）', async () => {
    stubIPC({ 'llm:save-model': () => ({ success: false, error: 'keyBlank' }) })

    const result = await useLLMStore.getState().saveModel({ id: 'm1' } as never, '   ')

    expect(result).toEqual({ success: false, error: 'keyBlank' })
    expect(channels()).not.toContain('llm:list-models') // 失败不重载
  })

  it('saveModel 成功 → 重载模型列表', async () => {
    stubIPC({ 'llm:save-model': () => ({ success: true }) })

    const result = await useLLMStore.getState().saveModel({ id: 'm1' } as never)

    expect(result).toEqual({ success: true })
    expect(channels()).toContain('llm:list-models')
  })
})
