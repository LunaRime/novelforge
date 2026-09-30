/**
 * providers.json 的文件层契约（模型管理 v3 §3.1「升 v2 + 读兼容旧数组形」）
 *
 * 只管一件事：**盘上形状 ↔ 逻辑状态**的换算与坏形状降级。冲突/revision 语义在
 * `llm-controller.providers.test.ts`（那是控制器的职责）。
 *
 * ⚠️ 走 `__setConfigFilesForTest` 注入内存文件层 —— 本文件绝不碰真实 `~/.novelforge/providers.json`。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { PROVIDERS_CONFIG_PATH, readProvidersFile, writeProvidersFile, __setConfigFilesForTest } from './config-utils'
import type { ProviderAccount } from '../../src/shared/ipc-channels'

const ACC: ProviderAccount = {
  id: 'a1',
  provider: 'openai',
  protocol: 'openai',
  apiKeyRef: 'OPENAI_API_KEY',
  baseUrl: 'https://api.openai.com',
  modelNames: ['gpt-5.6-sol'],
}

let files: Map<string, unknown>

beforeEach(() => {
  files = new Map()
  __setConfigFilesForTest(files)
})

describe('readProvidersFile', () => {
  it('文件不存在 → { revision: 0, accounts: [] }', () => {
    expect(readProvidersFile()).toEqual({ revision: 0, accounts: [] })
  })

  it('v1 裸数组形 → revision 视作 0（老用户零感知）', () => {
    files.set(PROVIDERS_CONFIG_PATH, [ACC])
    expect(readProvidersFile()).toEqual({ revision: 0, accounts: [ACC] })
  })

  it('v2 形 → 原样读出 revision 与 accounts', () => {
    files.set(PROVIDERS_CONFIG_PATH, { version: 2, revision: 7, accounts: [ACC] })
    expect(readProvidersFile()).toEqual({ revision: 7, accounts: [ACC] })
  })

  describe('坏形状逐字段降级（配置损坏不该让应用起不来，也不该被当成有效数据用）', () => {
    it('accounts 非数组 → 空数组；revision 仍可用', () => {
      files.set(PROVIDERS_CONFIG_PATH, { version: 2, revision: 3, accounts: 'oops' })
      expect(readProvidersFile()).toEqual({ revision: 3, accounts: [] })
    })

    it('revision 非自然数（负数/小数/字符串）→ 回落 0', () => {
      for (const bad of [-1, 1.5, '3', null]) {
        files.set(PROVIDERS_CONFIG_PATH, { version: 2, revision: bad, accounts: [ACC] })
        expect(readProvidersFile(), `revision=${String(bad)}`).toEqual({ revision: 0, accounts: [ACC] })
      }
    })

    it('既非数组也非对象（字符串/数字/null）→ 空状态', () => {
      for (const bad of ['nope', 42, null]) {
        files.set(PROVIDERS_CONFIG_PATH, bad)
        expect(readProvidersFile()).toEqual({ revision: 0, accounts: [] })
      }
    })
  })

  it('读出来的是深拷贝（调用方改动不会污染「盘上」数据）', () => {
    files.set(PROVIDERS_CONFIG_PATH, { version: 2, revision: 1, accounts: [ACC] })
    readProvidersFile().accounts.push({ ...ACC, id: 'injected' })
    expect(readProvidersFile().accounts).toHaveLength(1)
  })
})

describe('writeProvidersFile', () => {
  it('恒写 v2 形（version/revision/accounts 三字段）', () => {
    writeProvidersFile({ revision: 4, accounts: [ACC] })
    expect(files.get(PROVIDERS_CONFIG_PATH)).toEqual({ version: 2, revision: 4, accounts: [ACC] })
  })

  it('写→读往返一致（round-trip）', () => {
    writeProvidersFile({ revision: 9, accounts: [] })
    expect(readProvidersFile()).toEqual({ revision: 9, accounts: [] })
  })

  it('注入生效自检：写入只落在内存 Map，不产生真实文件访问', () => {
    writeProvidersFile({ revision: 1, accounts: [ACC] })
    expect(files.has(PROVIDERS_CONFIG_PATH)).toBe(true)
  })
})
