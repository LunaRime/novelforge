/**
 * 凭据层 store / resolve 单测（模型管理 v3 §4.2/§4.4）
 *
 * ⚠️ CI 一致性（ci-parity-standard）：本文件 import 到 electron（`secure-config` → `safeStorage`）
 *    → **必须 `vi.mock('electron')`**；另打桩 logger（真实 logger 会往 `~/.novelforge/logs/` 写盘）。
 *
 * 覆盖三段：
 *  ① `resolve/describe` 纯核心（注入源）—— env 优先、影子只命中同名 ref、解密失败不崩；
 *  ② store 文件层——写→读往返 + 落盘是 `ENC:` 密文（注入文件对象，不触真实 IO）；
 *  ③ 真实加解密链路——`safeStorage` 解不开时按「未配置」处理（Review Focus 3）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ===== mock 状态（vi.hoisted：模块工厂先于 import 求值）=====
const h = vi.hoisted(() => ({
  /** safeStorage 打桩：默认可用 + 可逆（decrypt = encrypt 的逆，保证往返用例真实） */
  available: true,
  encryptString: vi.fn((s: string) => Buffer.from(s, 'utf-8')),
  decryptString: vi.fn((buf: Buffer) => buf.toString('utf-8')),
}))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => h.available,
    encryptString: (s: string) => h.encryptString(s),
    decryptString: (b: Buffer) => h.decryptString(b),
  },
}))

vi.mock('../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), getLogDir: () => '' },
}))

import { logger } from '../utils/logger'
import { resolveFrom, describeFrom, resolveCredential, resolveModelKey } from './resolve'
import {
  readCredentialFile,
  writeCredentialFile,
  readCredentialValue,
  setStoredValue,
  unsetStoredValue,
  __setCredentialFileForTest,
  __setStoredForTest,
} from './store'

/** 假环境变量表 → EnvSource */
const env = (vars: Record<string, string>) => (name: string) => vars[name]
/** 假存储表 → StoredSource */
const stored = (vars: Record<string, string>) => (ref: string) => vars[ref]

beforeEach(() => {
  vi.clearAllMocks()
  h.available = true
  h.encryptString.mockImplementation((s: string) => Buffer.from(s, 'utf-8'))
  h.decryptString.mockImplementation((buf: Buffer) => buf.toString('utf-8'))
  __setCredentialFileForTest({ version: 1, refs: {} })
  __setStoredForTest({})
})

// ===== ① resolve / describe 纯核心 =====

describe('resolve（env 优先）', () => {
  it('env 非空 → 命中且 source=env', () => {
    expect(resolveFrom('OPENAI_API_KEY', env({ OPENAI_API_KEY: 'sk-env' }), stored({ OPENAI_API_KEY: 'sk-store' })))
      .toEqual({ value: 'sk-env', source: 'env' })
  })

  it('env 影子只命中同名 ref（多账户）：_2 不受影响', () => {
    expect(resolveFrom('OPENAI_API_KEY_2', env({ OPENAI_API_KEY: 'sk-env' }), stored({ OPENAI_API_KEY_2: 'sk-2' })))
      .toEqual({ value: 'sk-2', source: 'store' })
  })

  it('env 为空串/未设 → 回落 store；两者皆无 → undefined', () => {
    expect(resolveFrom('X', env({ X: '  ' }), stored({ X: 'sk' }))).toEqual({ value: 'sk', source: 'store' })
    expect(resolveFrom('Y', env({}), stored({}))).toBeUndefined()
  })

  it('密文损坏（解密抛错）→ undefined 不崩', () => {
    const broken = () => { throw new Error('decrypt failed') }
    expect(() => resolveFrom('Z', env({}), broken)).not.toThrow()
    expect(resolveFrom('Z', env({}), broken)).toBeUndefined()
  })

  it('store 为空串/纯空白 → 视为未配置（空串不是密钥）', () => {
    expect(resolveFrom('E', env({}), stored({ E: '   ' }))).toBeUndefined()
  })

  it('describe：configured/source/writable（env 影子 writable=false）', () => {
    const d = describeFrom(['A', 'B'], env({ A: 'sk-a' }), stored({ B: 'sk-b' }))
    expect(d.A).toEqual({ configured: true, source: 'env', writable: false })
    expect(d.B).toEqual({ configured: true, source: 'store', writable: true })
  })

  it('describe：未配置 → configured=false 且 writable=true（可写）；env 置空串不算影子', () => {
    const d = describeFrom(['N', 'BLANK'], env({ BLANK: '  ' }), stored({}))
    expect(d.N).toEqual({ configured: false, writable: true })
    expect(d.BLANK).toEqual({ configured: false, writable: true })
  })

  it('describe：某一项解密抛错 → 该项按未配置，其它项不受影响', () => {
    const broken = (ref: string) => {
      if (ref === 'BAD') throw new Error('decrypt failed')
      return 'sk-ok'
    }
    const d = describeFrom(['BAD', 'OK'], env({}), broken)
    expect(d.BAD).toEqual({ configured: false, writable: true })
    expect(d.OK).toEqual({ configured: true, source: 'store', writable: true })
  })
})

// ===== ①b resolveModelKey（模型条目 → 请求要用的密钥，v3 §4.4）=====
//
// 契约：`resolveCredential(apiKeyRef) ?? apiKey ?? ''` —— ref 命中（env 非空 → store 非空）
// 优先，否则**回落条目上的明文**（T4 迁移前凭据库为空，全部走这条路 → 行为零变化）。
// 测试辅助 `__setStoredForTest(map)` 注入 store 内存缓存（T1 store.ts 提供，与本文件 store 段共用）。

describe('resolveModelKey（ref 优先、明文回落）', () => {
  it('resolveModelKey：ref 命中优先于明文', () => {
    __setStoredForTest({ R: 'sk-ref' })
    expect(resolveModelKey({ apiKeyRef: 'R', apiKey: 'sk-plain' })).toBe('sk-ref')
  })

  it('resolveModelKey：无 ref / ref 未配置 → 回落明文；两者皆无 → 空串', () => {
    expect(resolveModelKey({ apiKey: 'sk-plain' })).toBe('sk-plain')
    expect(resolveModelKey({ apiKeyRef: 'MISSING', apiKey: 'sk-plain' })).toBe('sk-plain')
    expect(resolveModelKey({})).toBe('')
  })
})

// ===== ② store 文件层（注入件，不触真实 IO）=====

describe('store 文件层', () => {
  it('写→读往返（值以 ENC: 前缀落盘）', () => {
    const file: Record<string, unknown> = {}
    __setCredentialFileForTest(file as never)
    setStoredValue('K', 'sk-123')
    expect(readCredentialValue('K')).toBe('sk-123')
    expect(JSON.stringify(file)).toContain('ENC:')
    expect(JSON.stringify(file)).not.toContain('sk-123')
  })

  it('readCredentialFile：形状不符（缺 refs / 非对象）→ 回退空结构，不崩', () => {
    __setCredentialFileForTest({} as never)
    expect(readCredentialFile()).toEqual({ version: 1, refs: {} })
    __setCredentialFileForTest(null as never)
    expect(readCredentialFile()).toEqual({ version: 1, refs: {} })
  })

  it('writeCredentialFile：注入件原地更新（用例以注入对象的 JSON 断言落盘形状）', () => {
    const file: Record<string, unknown> = { version: 1, refs: {} }
    __setCredentialFileForTest(file as never)
    writeCredentialFile({ version: 1, refs: { A: 'ENC:x' } })
    expect(file).toEqual({ version: 1, refs: { A: 'ENC:x' } })
  })

  it('unset 幂等：删已存值后再删不报错，且键消失', () => {
    const file: Record<string, unknown> = {}
    __setCredentialFileForTest(file as never)
    setStoredValue('K', 'sk-123')
    unsetStoredValue('K')
    expect(readCredentialValue('K')).toBeUndefined()
    expect(JSON.stringify(file)).not.toContain('ENC:')
    expect(() => unsetStoredValue('K')).not.toThrow()
  })

  it('set 覆盖已存值（同 ref 只保留最新）', () => {
    const file: Record<string, unknown> = {}
    __setCredentialFileForTest(file as never)
    setStoredValue('K', 'sk-old')
    setStoredValue('K', 'sk-new')
    expect(readCredentialValue('K')).toBe('sk-new')
    expect(Object.keys(readCredentialFile().refs)).toEqual(['K'])
  })

  it('__setStoredForTest 直接注入明文缓存（T3 resolveModelKey 用）', () => {
    __setStoredForTest({ R: 'sk-ref' })
    expect(readCredentialValue('R')).toBe('sk-ref')
    expect(resolveCredential('R')).toBe('sk-ref')
  })
})

// ===== ③ 真实加解密链路（safeStorage 解不开 → 未配置，Review Focus 3）=====

describe('真实加解密链路', () => {
  it('写盘值走 encryptApiKey；读回值走 decryptApiKey', () => {
    const file: Record<string, unknown> = {}
    __setCredentialFileForTest(file as never)
    setStoredValue('K', 'sk-123')
    expect(h.encryptString).toHaveBeenCalledWith('sk-123')
    expect(readCredentialValue('K')).toBe('sk-123')
  })

  it('密文损坏（safeStorage 抛错）→ readCredentialValue 返回 undefined + 错误日志，resolve 视为未配置', () => {
    const file: Record<string, unknown> = {}
    __setCredentialFileForTest(file as never)
    setStoredValue('K', 'sk-123') // 先写一条合法密文
    h.decryptString.mockImplementation(() => { throw new Error('wrong machine') })
    __setCredentialFileForTest(file as never) // 重新注入 = 清缓存 → 强制从文件层解密

    expect(() => readCredentialValue('K')).not.toThrow()
    expect(readCredentialValue('K')).toBeUndefined()
    expect(resolveCredential('K')).toBeUndefined()
    expect(logger.error).toHaveBeenCalled() // 解不开必须留痕（否则只剩「请求 401」这一条线索）
  })

  it('明文残留（无 ENC: 前缀）不当作损坏：按明文返回（迁移期兜底）', () => {
    __setCredentialFileForTest({ version: 1, refs: { K: 'sk-legacy-plain' } } as never)
    expect(readCredentialValue('K')).toBe('sk-legacy-plain')
  })
})
