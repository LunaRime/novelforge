/**
 * credential-controller — 凭据层 IPC 契约（模型管理 v3 §4.1/§4.4）
 *
 * 覆盖（brief Interfaces 块 + L4 铁律）：
 * - 三条通道全部注册，且**注册走 `guardedHandle`**（来源不可信 → handler 抛错）
 * - `describe` 只回状态，**永不回传值**
 * - `set`：合法值落盘为密文；`keyBlank`/`keyIllegalCharacters` 拒绝；空串 = 不提供（不写盘）；
 *   env 影子拒绝；写盘失败 → `success:false` 而非抛
 * - `unset`：幂等；env 影子拒绝
 *
 * ⚠️ CI 一致性（ci-parity-standard）：本文件 import 到 electron → **必须 `vi.mock('electron')`**；
 *    另打桩 logger（真实 logger 会往 `~/.novelforge/logs/` 写盘）。
 *    凭据文件层用 `__setCredentialFileForTest` 注入 —— **绝不读写真实 `~/.novelforge/credentials.json`**。
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest'

// ===== mock 状态（vi.hoisted：模块工厂先于 import 求值）=====
const h = vi.hoisted(() => ({
  /** 通道 → 真实注册的 handler（由 mock 的 ipcMain.handle 捕获） */
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      h.handlers.set(channel, fn)
    },
    removeHandler: vi.fn(),
  },
  // store → secure-config → safeStorage：可逆打桩（与 credentials.test.ts 同款）
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf-8'),
    decryptString: (b: Buffer) => b.toString('utf-8'),
  },
}))

vi.mock('../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), getLogDir: () => '' },
}))

import { registerCredentialController } from './credential-controller'
import { trustWebContents, resetTrustedWebContentsForTest } from '../security/ipc-guard'
import {
  readCredentialFile,
  readCredentialValue,
  __setCredentialFileForTest,
  __setStoredForTest,
} from '../credentials/store'

const SENDER_ID = 11
/** 伪装成「应用自己的 top frame」（ipc-guard：存活 + top frame + 白名单 + file:// 生产页面） */
const fakeEvent = {
  sender: { id: SENDER_ID, send: vi.fn() },
  senderFrame: { url: 'file:///app/index.html', parent: null },
}

function call(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`通道未注册: ${channel}`)
  // guardedHandle 的来源校验是同步抛（拒绝在 handler 执行之前）→ 同步异常也变成 rejected promise
  try {
    return Promise.resolve(fn(fakeEvent, ...args))
  } catch (e) {
    return Promise.reject(e)
  }
}

/** 每个用例一份注入文件对象（用例以它的 JSON 断言落盘形状） */
let file: Record<string, unknown>

/** 测试专用 ref（避免与真实环境变量撞名；仅 env 影子用例会临时设置） */
const TEST_REF = 'NF_CRED_TEST_KEY'

beforeAll(() => {
  registerCredentialController()
})

beforeEach(() => {
  vi.clearAllMocks()
  resetTrustedWebContentsForTest()
  trustWebContents(SENDER_ID)
  file = {}
  __setCredentialFileForTest(file as never)
  __setStoredForTest({})
})

afterEach(() => {
  delete process.env[TEST_REF]
})

// ===== 注册与收口（L4 铁律）=====

describe('注册与收口', () => {
  it('3 条 credential:* 通道全部注册', () => {
    for (const ch of ['credential:describe', 'credential:set', 'credential:unset']) {
      expect(h.handlers.has(ch), `未注册: ${ch}`).toBe(true)
    }
  })

  it('注册走 guardedHandle：来源不可信 → 拒绝', async () => {
    resetTrustedWebContentsForTest()
    await expect(call('credential:describe', [])).rejects.toThrow(/sender not trusted/)
  })
})

// ===== describe =====

describe('credential:describe', () => {
  it('只回状态且不携带值（describe 后仍看不到明文）', async () => {
    await call('credential:set', TEST_REF, 'sk-secret-value')
    const res = (await call('credential:describe', [TEST_REF, 'NF_CRED_ABSENT'])) as Record<string, unknown>

    expect(res[TEST_REF]).toEqual({ configured: true, source: 'store', writable: true })
    expect(res['NF_CRED_ABSENT']).toEqual({ configured: false, writable: true })
    expect(JSON.stringify(res)).not.toContain('sk-secret-value')
    expect(file && JSON.stringify(file)).not.toContain('sk-secret-value')
  })

  it('env 影子 → configured:true/source:env/writable:false', async () => {
    process.env[TEST_REF] = 'sk-from-env'
    const res = (await call('credential:describe', [TEST_REF])) as Record<string, unknown>
    expect(res[TEST_REF]).toEqual({ configured: true, source: 'env', writable: false })
  })
})

// ===== set =====

describe('credential:set', () => {
  it('合法值 → success:true，且落盘是 ENC: 密文', async () => {
    await expect(call('credential:set', TEST_REF, 'sk-abc123')).resolves.toEqual({ success: true })
    expect(JSON.stringify(file)).toContain('ENC:')
    expect(JSON.stringify(file)).not.toContain('sk-abc123')
  })

  it('keyBlank / keyIllegalCharacters → success:false + 拒因码，且不写盘', async () => {
    await expect(call('credential:set', TEST_REF, '   ')).resolves.toEqual({ success: false, error: 'keyBlank' })
    await expect(call('credential:set', TEST_REF, 'sk-密钥')).resolves.toEqual({ success: false, error: 'keyIllegalCharacters' })
    await expect(call('credential:set', TEST_REF, 'OPENAI_API_KEY=sk-x')).resolves.toEqual({ success: false, error: 'keyIllegalCharacters' })
    expect(JSON.stringify(file)).not.toContain('ENC:')
  })

  it('存的是 trim 后的值（校验判 trim 后的串 → 落库必须同一个值）', async () => {
    await expect(call('credential:set', TEST_REF, '  sk-abc\t ')).resolves.toEqual({ success: true })
    expect(readCredentialValue(TEST_REF)).toBe('sk-abc')
    expect(JSON.stringify(file)).toContain('ENC:')
  })

  it('空串 = 不提供：success:true 且保留已存值（不覆盖、不清空）', async () => {
    await call('credential:set', TEST_REF, 'sk-keep')
    const before = JSON.stringify(file)
    await expect(call('credential:set', TEST_REF, '')).resolves.toEqual({ success: true })
    expect(JSON.stringify(file)).toBe(before)
  })

  it('env 影子 → success:false/envShadowed，且不写盘', async () => {
    process.env[TEST_REF] = 'sk-from-env'
    await expect(call('credential:set', TEST_REF, 'sk-abc')).resolves.toEqual({ success: false, error: 'envShadowed' })
    expect(JSON.stringify(file)).not.toContain('ENC:')
  })

  it('写盘失败（IO 抛错）→ success:false + error，而不是把异常抛给渲染层', async () => {
    // 注入对象在 version 赋值上抛错 —— 等价于 writeJsonFile 的磁盘满/权限不足
    const throwing: Record<string, unknown> = { refs: {} }
    Object.defineProperty(throwing, 'version', {
      get: () => 1,
      set: () => { throw new Error('disk full') },
      configurable: true,
    })
    __setCredentialFileForTest(throwing as never)

    await expect(call('credential:set', TEST_REF, 'sk-abc')).resolves.toEqual({ success: false, error: 'disk full' })
  })
})

// ===== unset =====

describe('credential:unset', () => {
  it('删除已存值 → success:true，describe 变回未配置', async () => {
    await call('credential:set', TEST_REF, 'sk-abc')
    await expect(call('credential:unset', TEST_REF)).resolves.toEqual({ success: true })
    expect(JSON.stringify(file)).not.toContain('ENC:')
    const res = (await call('credential:describe', [TEST_REF])) as Record<string, unknown>
    expect(res[TEST_REF]).toEqual({ configured: false, writable: true })
  })

  it('幂等：不存在也 success:true（删除流程可重试）', async () => {
    await expect(call('credential:unset', TEST_REF)).resolves.toEqual({ success: true })
    await expect(call('credential:unset', TEST_REF)).resolves.toEqual({ success: true })
    expect(JSON.stringify(file)).not.toContain('ENC:')
  })

  it('env 影子 → success:false/envShadowed（目标达不到就不谎报成功）', async () => {
    process.env[TEST_REF] = 'sk-from-env'
    await expect(call('credential:unset', TEST_REF)).resolves.toEqual({ success: false, error: 'envShadowed' })
  })
})

// 保持 readCredentialFile 被使用（导入即断言文件层确实可读，防「注入没生效」的假绿）
it('文件层注入生效（脚手架自检）', () => {
  expect(readCredentialFile()).toEqual({ version: 1, refs: {} })
})
