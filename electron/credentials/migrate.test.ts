/**
 * 存量密钥迁移单测（模型管理 v3 T4）—— 纯核心 `planMigration` + IO 壳 `runCredentialMigration`。
 *
 * 这是本批**唯一触碰用户真实数据**的操作，故契约逐条锁定：
 *  - **幂等**：终态重跑 `changed=false`，一个字节都不写、不重新备份；
 *  - **可回退**：首次执行前留 `*.pre-credentials.bak`（内容 = 迁移**前**的字节）；
 *  - **半迁移可续跑**：凭据已落盘、文件写回前崩溃 → 重跑沿用原 ref（不再开 `_2`）只清文件；
 *  - **失败不阻断**：备份/写盘失败一律「不抛 + 保留原状 + 留日志」，下次再试。
 *
 * ⚠️ 测试卫生（硬性）：**绝不触真实 `~/.novelforge`**。两道防线 ——
 *  ① `node:os` 的 `homedir` 打桩到临时目录（`VELA_HOME` 随之落在 tmp 里，kb-controller.test.ts 同款）；
 *  ② 需要制造 IO 失败时改用注入件（`__setConfigFilesForTest` / `__setCredentialFileForTest`）。
 *
 * ⚠️ CI 一致性（ci-parity-standard）：import 到 electron（`secure-config` → `safeStorage`）
 *    → **必须 `vi.mock('electron')`**；另打桩 logger（真实 logger 会往 logs/ 写盘）。
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import fs from 'node:fs'

// ===== mock 状态（vi.hoisted：模块工厂先于 import 求值）=====
const h = vi.hoisted(() => ({
  /** safeStorage 打桩：可逆（decrypt = encrypt 的逆）——「明文入库后可解回」才是真断言 */
  available: true,
  encryptString: vi.fn((s: string) => Buffer.from(s, 'utf-8')),
  decryptString: vi.fn((buf: Buffer) => buf.toString('utf-8')),
  /** 假 home（tmp 子目录）—— VELA_HOME / 三个配置文件路径全部派生自它 */
  home: `${process.env.TEMP ?? process.env.TMP ?? process.cwd()}/nf-migrate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
}))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  const homedir = () => h.home
  return { ...actual, homedir, default: { ...actual, homedir } }
})

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
import { planMigration, runCredentialMigration, hasLegacyKey } from './migrate'
import { encryptApiKey, decryptApiKey } from '../utils/secure-config'
import {
  MODELS_CONFIG_PATH,
  PROVIDERS_CONFIG_PATH,
  CREDENTIALS_CONFIG_PATH,
  CREDENTIAL_MIGRATION_BACKUP_SUFFIX,
  VELA_HOME,
  readProvidersFile,
  __setConfigFilesForTest,
} from '../utils/config-utils'
import {
  mergeStoredCiphertext,
  readCredentialFile,
  readCredentialValue,
  __setCredentialFileForTest,
  __setStoredForTest,
} from './store'
import type { ModelProfile, ProviderAccount } from '../../src/shared/ipc-channels'

const BAK = (p: string) => p + CREDENTIAL_MIGRATION_BACKUP_SUFFIX

function account(over: Partial<ProviderAccount> = {}): ProviderAccount {
  return {
    id: 'a1',
    provider: 'openai',
    protocol: 'openai',
    apiKey: 'ENC:xxx',
    baseUrl: 'https://api.openai.com',
    modelNames: ['gpt-4o'],
    ...over,
  }
}

function model(over: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: 'm1',
    name: 'DeepSeek Chat',
    provider: 'deepseek',
    protocol: 'openai',
    modelName: 'deepseek-chat',
    apiKey: 'sk-plain',
    baseUrl: 'https://api.deepseek.com',
    temperature: 0.7,
    maxTokens: 128,
    contextWindow: 8192,
    purposes: ['generation'],
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.available = true
  h.encryptString.mockImplementation((s: string) => Buffer.from(s, 'utf-8'))
  h.decryptString.mockImplementation((buf: Buffer) => buf.toString('utf-8'))
})

// ===== ① planMigration（纯函数）=====

describe('planMigration（纯函数）', () => {
  it('账户与手工条目明文/密文 key 全量搬入 refs，文件字段清空', () => {
    const accounts = [account({ apiKey: 'ENC:xxx' })]
    const models = [model({ apiKey: 'sk-plain' })]

    const plan = planMigration(accounts, models, {})

    expect(plan.changed).toBe(true)
    expect(plan.accounts[0].apiKey).toBe('')
    expect(plan.accounts[0].apiKeyRef).toBe('OPENAI_API_KEY')
    expect(plan.models[0].apiKeyRef).toBe('DEEPSEEK_API_KEY')
    expect(plan.models[0].apiKey).toBe('')
    expect(plan.refs['OPENAI_API_KEY']).toBe('ENC:xxx')
    expect(plan.refs['DEEPSEEK_API_KEY']).toMatch(/^ENC:/) // 明文被加密
    // 「密文原样搬运、明文真加密」——解回来必须是原值（不是套了一层壳的密文）
    expect(decryptApiKey(plan.refs['DEEPSEEK_API_KEY'])).toBe('sk-plain')
    // 纯函数：不动入参（调用方可能就是刚读出来的那份数组）
    expect(accounts[0].apiKey).toBe('ENC:xxx')
    expect(models[0].apiKey).toBe('sk-plain')
  })

  it('幂等：终态再跑 changed=false，refs 不新增', () => {
    const done = account({ apiKey: '', apiKeyRef: 'OPENAI_API_KEY' })

    const plan = planMigration([done], [], { OPENAI_API_KEY: 'ENC:xxx' })

    expect(plan.changed).toBe(false)
    expect(plan.refs).toEqual({ OPENAI_API_KEY: 'ENC:xxx' })
    expect(plan.accounts).toEqual([done])
  })

  it('半迁移崩溃续跑：refs 已写、文件未清 → 重跑只清文件（不重复分配）', () => {
    const plan = planMigration(
      [account({ apiKey: 'ENC:xxx', apiKeyRef: 'OPENAI_API_KEY' })],
      [],
      { OPENAI_API_KEY: 'ENC:xxx' },
    )

    expect(plan.changed).toBe(true)
    expect(plan.accounts[0].apiKeyRef).toBe('OPENAI_API_KEY') // 沿用，不新开 _2
    expect(plan.accounts[0].apiKey).toBe('')
    expect(Object.keys(plan.refs)).toEqual(['OPENAI_API_KEY'])
  })

  it('分配顺序 accounts 先、models 后：首账户拿裸名，同 provider 顺延 _2', () => {
    const plan = planMigration(
      [account({ id: 'a1', apiKey: 'ENC:1' }), account({ id: 'a2', apiKey: 'ENC:2' })],
      [model({ provider: 'openai', apiKey: 'ENC:3' })],
      {},
    )

    expect(plan.accounts.map((a) => a.apiKeyRef)).toEqual(['OPENAI_API_KEY', 'OPENAI_API_KEY_2'])
    expect(plan.models[0].apiKeyRef).toBe('OPENAI_API_KEY_3')
  })

  it('账户与派生副本复用同一个 ref，不派生 _2（逐字节同一份值 / 同一份明文各成一组）', () => {
    // 存量形态：账户与 models.json 里的派生条目各存一份**同一个值**
    // （派生副本由 syncAccountModels 原样拷贝，故密文是逐字节相同的那一份）
    const cipher = encryptApiKey('sk-shared')
    const plan = planMigration(
      [account({ apiKey: cipher })],
      [
        model({ provider: 'openai', apiKey: cipher }),
        model({ id: 'm2', provider: 'openai', apiKey: 'sk-plain-shared' }),
        model({ id: 'm3', provider: 'openai', apiKey: 'sk-plain-shared' }),
      ],
      {},
    )

    expect(plan.accounts[0].apiKeyRef).toBe('OPENAI_API_KEY')
    expect(plan.models.map((m) => m.apiKeyRef))
      .toEqual(['OPENAI_API_KEY', 'OPENAI_API_KEY_2', 'OPENAI_API_KEY_2'])
    expect(Object.keys(plan.refs).sort()).toEqual(['OPENAI_API_KEY', 'OPENAI_API_KEY_2']) // 一份值只落一个 ref
  })

  it('半迁移续跑（条目丢了 ref）：凭据库已有同一份值 → 沿用原 ref', () => {
    // 崩溃点更靠前的一种半迁移：值已入库，但配置文件里的 apiKeyRef 还没来得及写上
    const cipher = encryptApiKey('sk-half')
    const plan = planMigration([account({ apiKey: cipher })], [], { OPENAI_API_KEY: cipher })

    expect(plan.changed).toBe(true)
    expect(plan.accounts[0].apiKeyRef).toBe('OPENAI_API_KEY') // 不是 OPENAI_API_KEY_2
    expect(plan.refs.OPENAI_API_KEY).toBe(cipher)
  })

  it('解不开的密文不参与值比对（不会把两个不相干的条目并成一个 ref）', () => {
    // 极端形态：safeStorage 解出来的是同一坨垃圾（换机器/密文损坏的真实表现是「解不开」，
    // 这里刻意用「解出乱码」压一压 —— 朴素实现（解密再比对）会把三条不相干的密文并成一个 ref）
    h.decryptString.mockImplementation(() => 'same-junk')
    const plan = planMigration(
      [account({ apiKey: 'ENC:from-other-machine' })],
      [model({ provider: 'openai', apiKey: 'ENC:another-one' })],
      { OPENAI_API_KEY: 'ENC:stored-elsewhere' },
    )

    expect(plan.accounts[0].apiKeyRef).toBe('OPENAI_API_KEY_2') // 各是各的，没有被并到一起
    expect(plan.models[0].apiKeyRef).toBe('OPENAI_API_KEY_3')
    expect(Object.keys(plan.refs).sort()).toEqual(['OPENAI_API_KEY', 'OPENAI_API_KEY_2', 'OPENAI_API_KEY_3'])
  })

  it('无密钥但已占 ref 的条目照样占住名字（不会分给后来的同 provider 条目）', () => {
    const plan = planMigration(
      [account({ apiKey: '', apiKeyRef: 'OPENAI_API_KEY' }), account({ id: 'a2', apiKey: 'ENC:x' })],
      [],
      {},
    )

    expect(plan.accounts[1].apiKeyRef).toBe('OPENAI_API_KEY_2')
  })

  it('ref 已被凭据库占用时顺延（凭据库是全局命名空间的一部分）', () => {
    const plan = planMigration([account({ apiKey: 'ENC:x' })], [], { OPENAI_API_KEY: 'ENC:old' })

    expect(plan.accounts[0].apiKeyRef).toBe('OPENAI_API_KEY_2')
    expect(plan.refs['OPENAI_API_KEY']).toBe('ENC:old') // 老值不被覆盖
  })

  it('refs 已存在同名项时不覆盖（盘上的值比本次快照新）', () => {
    const plan = planMigration(
      [account({ apiKey: 'ENC:new', apiKeyRef: 'OPENAI_API_KEY' })],
      [],
      { OPENAI_API_KEY: 'ENC:from-store' },
    )

    expect(plan.refs['OPENAI_API_KEY']).toBe('ENC:from-store')
    expect(plan.accounts[0].apiKey).toBe('') // 文件字段仍清空（值已在库里）
  })

  it('空 provider 名也能派生（不崩、不产生空 ref）', () => {
    const plan = planMigration([account({ provider: 'custom', apiKey: 'ENC:x' })], [], {})
    expect(plan.accounts[0].apiKeyRef).toBe('CUSTOM_API_KEY')
  })
})

describe('hasLegacyKey（懒迁移钩子与迁移范围共用同一判据）', () => {
  it('非空即算（明文/密文都算），空串与 undefined 不算', () => {
    expect(hasLegacyKey('sk-plain')).toBe(true)
    expect(hasLegacyKey('ENC:x')).toBe(true)
    expect(hasLegacyKey('')).toBe(false)
    expect(hasLegacyKey(undefined)).toBe(false)
  })
})

// ===== ② runCredentialMigration（真实文件层：tmp home）=====
//
// 这一段刻意**不注入**文件替身：要验证的正是真实 fs 分支（copyFileSync / 原子写 / rename），
// 注入件覆盖不到。隔离靠 `node:os` 的 homedir 打桩（路径全部落在 tmp 下）。
// ⚠️ 本段必须排在「注入件」段之前：`__setConfigFilesForTest` 是**进程级不可逆**的开关。

const readModels = (): ModelProfile[] => JSON.parse(fs.readFileSync(MODELS_CONFIG_PATH, 'utf-8'))
const writeProviders = (accounts: ProviderAccount[], revision = 1): void =>
  fs.writeFileSync(PROVIDERS_CONFIG_PATH, JSON.stringify({ version: 2, revision, accounts }))
const writeModels = (models: ModelProfile[]): void =>
  fs.writeFileSync(MODELS_CONFIG_PATH, JSON.stringify(models))
const rawRead = (p: string): string => fs.readFileSync(p, 'utf-8')

describe('runCredentialMigration（真实文件层 · tmp home）', () => {
  beforeEach(() => {
    fs.rmSync(h.home, { recursive: true, force: true })
    fs.mkdirSync(VELA_HOME, { recursive: true }) // ~/.novelforge（假 home 下）—— 三个配置文件都在它里面
    __setStoredForTest({}) // 清 store 的进程内明文缓存（换了一份盘上数据，缓存必须失效）
  })

  afterAll(() => {
    fs.rmSync(h.home, { recursive: true, force: true })
  })

  it('端到端：密钥入库 + 两文件字段清空 + .bak 是迁移**前**的内容', async () => {
    const legacyCipher = encryptApiKey('sk-legacy-cipher-source')
    writeProviders([account({ apiKey: 'sk-openai-plain', apiKeyRef: undefined })], 3)
    writeModels([model({ apiKey: legacyCipher })])

    const outcome = await runCredentialMigration()

    expect(outcome).toEqual({ changed: true, refs: 2 })
    // ① 凭据入库：明文被加密、密文原样搬运（不二次加密）
    const creds = readCredentialFile().refs
    expect(Object.keys(creds).sort()).toEqual(['DEEPSEEK_API_KEY', 'OPENAI_API_KEY'])
    expect(creds.OPENAI_API_KEY).toMatch(/^ENC:/)
    expect(decryptApiKey(creds.OPENAI_API_KEY)).toBe('sk-openai-plain')
    expect(creds.DEEPSEEK_API_KEY).toBe(legacyCipher)
    expect(decryptApiKey(creds.DEEPSEEK_API_KEY)).toBe('sk-legacy-cipher-source')
    // ② 配置文件：字段清空 + 补发 ref；revision 记一次修改（+1）
    const providers = readProvidersFile()
    expect(providers.revision).toBe(4)
    expect(providers.accounts[0]).toMatchObject({ apiKey: '', apiKeyRef: 'OPENAI_API_KEY' })
    expect(readModels()[0]).toMatchObject({ apiKey: '', apiKeyRef: 'DEEPSEEK_API_KEY' })
    // ③ 备份 = 回退点：留的是**迁移前**的字节（明文还在里面，这才叫可回退）
    expect(JSON.parse(rawRead(BAK(PROVIDERS_CONFIG_PATH))).accounts[0].apiKey).toBe('sk-openai-plain')
    expect(JSON.parse(rawRead(BAK(MODELS_CONFIG_PATH)))[0].apiKey).toBe(legacyCipher)
    // ④ 迁移后两文件里再无密钥字段值
    expect(rawRead(PROVIDERS_CONFIG_PATH)).not.toContain('sk-openai-plain')
    expect(rawRead(MODELS_CONFIG_PATH)).not.toContain('legacy-cipher-source')
  })

  it('幂等重跑：第二次 changed=false —— 不写盘、不重新备份', async () => {
    writeProviders([account({ apiKey: 'sk-openai-plain' })], 3)
    writeModels([model({ apiKey: 'sk-plain' })])
    await runCredentialMigration()
    const after = {
      providers: rawRead(PROVIDERS_CONFIG_PATH),
      models: rawRead(MODELS_CONFIG_PATH),
      creds: rawRead(CREDENTIALS_CONFIG_PATH),
      refs: Object.keys(readCredentialFile().refs).sort(),
    }
    // 哨兵：第二次若仍做备份，会把这份哨兵冲掉
    fs.writeFileSync(BAK(PROVIDERS_CONFIG_PATH), '"sentinel"')

    const second = await runCredentialMigration()

    expect(second).toEqual({ changed: false, refs: 0 })
    expect(rawRead(BAK(PROVIDERS_CONFIG_PATH))).toBe('"sentinel"')
    expect(rawRead(PROVIDERS_CONFIG_PATH)).toBe(after.providers)
    expect(rawRead(MODELS_CONFIG_PATH)).toBe(after.models)
    expect(rawRead(CREDENTIALS_CONFIG_PATH)).toBe(after.creds)
    expect(Object.keys(readCredentialFile().refs).sort()).toEqual(after.refs)
  })

  it('半迁移崩溃续跑：凭据已写、文件未清 → 沿用原 ref（不开 _2）只清文件', async () => {
    // 模拟「凭据先落盘（步骤 ④）、两文件写回（步骤 ⑤）前崩溃」
    const cipher = encryptApiKey('sk-openai')
    fs.writeFileSync(CREDENTIALS_CONFIG_PATH, JSON.stringify({ version: 1, refs: { OPENAI_API_KEY: cipher } }))
    writeProviders([account({ apiKey: cipher, apiKeyRef: undefined })], 3)
    writeModels([])

    const outcome = await runCredentialMigration()

    expect(outcome).toEqual({ changed: true, refs: 0 }) // 没有新分配（沿用），但文件要清
    expect(Object.keys(readCredentialFile().refs)).toEqual(['OPENAI_API_KEY'])
    expect(readCredentialFile().refs.OPENAI_API_KEY).toBe(cipher) // 库里原值不动
    const providers = readProvidersFile()
    expect(providers.accounts[0]).toMatchObject({ apiKey: '', apiKeyRef: 'OPENAI_API_KEY' })
    expect(providers.revision).toBe(4)
  })

  it('无遗留 key → changed=false：不备份、不写盘、不建 credentials.json', async () => {
    // 本机现状形态（providers 空 + 模型条目无明文 key）
    writeProviders([], 1)
    writeModels([model({ apiKey: '', apiKeyRef: 'DEEPSEEK_API_KEY' })])
    const before = { providers: rawRead(PROVIDERS_CONFIG_PATH), models: rawRead(MODELS_CONFIG_PATH) }

    const outcome = await runCredentialMigration()

    expect(outcome).toEqual({ changed: false, refs: 0 })
    expect(fs.existsSync(BAK(PROVIDERS_CONFIG_PATH))).toBe(false)
    expect(fs.existsSync(BAK(MODELS_CONFIG_PATH))).toBe(false)
    expect(fs.existsSync(CREDENTIALS_CONFIG_PATH)).toBe(false)
    expect(rawRead(PROVIDERS_CONFIG_PATH)).toBe(before.providers)
    expect(rawRead(MODELS_CONFIG_PATH)).toBe(before.models)
  })

  it('并发改动不被计划覆盖：快照之后被改过的条目原样保留（值一致性 + 字段级替换）', async () => {
    writeProviders([account({ apiKey: 'sk-old', apiKeyRef: undefined })], 5)
    writeModels([model({ apiKey: 'sk-plain' })])

    // 让迁移跑起来但**不 await**：它会同步做完「算计划 + 凭据落盘」，把两个写盘任务排进队列；
    // 此刻插进来的写 = 队列外的并发改动（等价于另一个已完成的 IPC 写落在快照之后）
    const pending = runCredentialMigration()
    writeProviders([{ ...account({ apiKey: 'sk-CHANGED', apiKeyRef: undefined }), baseUrl: 'https://changed.example' }], 6)
    const outcome = await pending

    // ① providers 侧被改过 → 一个字段都不动（连 revision 也不 bump）
    const providers = readProvidersFile()
    expect(outcome).toEqual({ changed: true, refs: 2 })
    expect(providers.accounts[0]).toMatchObject({ apiKey: 'sk-CHANGED', baseUrl: 'https://changed.example' })
    expect(providers.accounts[0].apiKeyRef).toBeUndefined()
    expect(providers.revision).toBe(6)
    // ② models 侧没被改过 → 照常清字段（计划里已分配的 ref 用上）
    expect(readModels()[0]).toMatchObject({ apiKey: '', apiKeyRef: 'DEEPSEEK_API_KEY' })
    // ③ providers 的密钥仍留在文件里（没被搬走也没被清），下次读取会再迁一次 —— 数据不丢
    expect(Object.keys(readCredentialFile().refs).sort()).toEqual(['DEEPSEEK_API_KEY', 'OPENAI_API_KEY'])
  })

  it('备份只做一次（.bak 已存在则跳过）与 IO 壳失败静默', async () => {
    // ① .bak 已存在（上一次留下的回退点）→ 跳过备份，但迁移照做
    fs.writeFileSync(BAK(PROVIDERS_CONFIG_PATH), '"sentinel"')
    writeProviders([account({ apiKey: 'sk-openai-plain' })])
    writeModels([])

    const first = await runCredentialMigration()

    expect(first).toEqual({ changed: true, refs: 1 })
    expect(rawRead(BAK(PROVIDERS_CONFIG_PATH))).toBe('"sentinel"') // 未被覆盖
    expect(readProvidersFile().accounts[0].apiKey).toBe('') // 迁移照做

    // ② 备份**失败** = 整体失败（宁可不动，也不能没有回退点）：不抛、留日志、原状保留。
    //    制造真实的 copyFileSync 失败：把源路径做成**目录**（跨平台一致地失败：EPERM / EISDIR）
    fs.rmSync(BAK(PROVIDERS_CONFIG_PATH), { force: true })
    fs.rmSync(BAK(MODELS_CONFIG_PATH), { force: true }) // ① 留下的 .bak 会影响本段断言，先清掉
    fs.rmSync(PROVIDERS_CONFIG_PATH, { force: true })
    fs.mkdirSync(PROVIDERS_CONFIG_PATH)
    writeModels([model({ apiKey: 'sk-plain' })])
    const modelsBefore = rawRead(MODELS_CONFIG_PATH)

    const second = await runCredentialMigration()

    expect(second).toEqual({ changed: false, refs: 0, error: 'backupFailed' })
    expect(logger.error).toHaveBeenCalled()
    expect(rawRead(MODELS_CONFIG_PATH)).toBe(modelsBefore) // 一个字节都没动
    expect(fs.existsSync(BAK(MODELS_CONFIG_PATH))).toBe(false)
  })
})

// ===== ③ IO 失败静默（注入件：真实 fs 造不出的写盘失败）=====

describe('mergeStoredCiphertext（迁移写入路径的合并语义）', () => {
  it('不覆盖**进程内已有**的值（哪怕盘上没有）—— 迁移不得改写正在用的钥匙', () => {
    const file = { version: 1, refs: {} as Record<string, string> }
    __setConfigFilesForTest(new Map<string, unknown>())
    __setCredentialFileForTest(file as never)
    __setStoredForTest({ R: 'sk-in-use' }) // 本会话已有值（set 过 / 用例注入），盘上还没有

    mergeStoredCiphertext({ R: 'ENC:other' })

    expect(readCredentialValue('R')).toBe('sk-in-use') // 缓存不被冲掉
    expect(file.refs).toEqual({}) // 也没有写盘（无事可做）
  })

  it('盘上已有的 ref 同样不覆盖，只并入新增项', () => {
    const file = { version: 1, refs: { OLD: 'ENC:old' } as Record<string, string> }
    __setConfigFilesForTest(new Map<string, unknown>())
    __setCredentialFileForTest(file as never)
    __setStoredForTest({})

    mergeStoredCiphertext({ OLD: 'ENC:attacker', NEW: 'ENC:new' })

    expect(file.refs).toEqual({ OLD: 'ENC:old', NEW: 'ENC:new' })
  })
})

describe('runCredentialMigration（注入件 · 写盘失败）', () => {
  it('凭据写盘抛错 → 不抛、返回 error、两文件原状保留（下次再试）', async () => {
    const files = new Map<string, unknown>([
      [PROVIDERS_CONFIG_PATH, { version: 2, revision: 1, accounts: [account({ apiKey: 'sk-x' })] }],
      [MODELS_CONFIG_PATH, []],
    ])
    __setConfigFilesForTest(files)
    // 冻结的注入件 = 写入必抛（严格模式下给冻结对象赋值 → TypeError）→ 模拟凭据文件不可写
    __setCredentialFileForTest(Object.freeze({ version: 1, refs: {} }) as never)
    __setStoredForTest({})

    const outcome = await runCredentialMigration()

    expect(outcome.changed).toBe(false)
    expect(outcome.error).toBeTruthy()
    expect(logger.error).toHaveBeenCalled()
    // 失败 = 保留原状：文件里的 key 一个字节没动（下次读取会经懒迁移重试）
    expect(files.get(PROVIDERS_CONFIG_PATH)).toMatchObject({ revision: 1, accounts: [{ apiKey: 'sk-x' }] })
    expect(files.has(BAK(PROVIDERS_CONFIG_PATH))).toBe(true) // 备份已做（回退点先于写入落定）
  })
})
