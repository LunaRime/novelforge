/**
 * 存量密钥迁移（模型管理 v3 T4）—— 把 `providers.json` / `models.json` 里的 `apiKey`
 * 搬进 `~/.novelforge/credentials.json`，并给条目补发 `apiKeyRef`。
 *
 * **本批唯一触碰用户真实数据的操作**，故三条硬性质写在最前面：
 *  ① **幂等**：判据 = 两文件里还有没有非空 `apiKey`（明文或 `ENC:` 密文都算）。没有 → 立刻返回，
 *     不写盘、不备份；有 → 全量搬完并**摘掉字段**（不置空串）。半迁移（凭据已落盘、文件未清）重跑时
 *     **沿用条目上已有的 `apiKeyRef`**，不会另开 `_2` 把同一把钥匙存在两个名字下。
 *  ② **可回退**：首次执行前把两份配置文件按**原始字节**复制为 `*.pre-credentials.bak`
 *     （仅当 .bak 尚不存在）；备份失败 = 整体失败，宁可不迁移也不能没有回退点。
 *  ③ **失败不阻断**：全程 try/catch，失败只留日志 + 保留原状（下次启动/下次读取再试），
 *     绝不把异常抛到启动路径或 IPC 链路上。
 *
 * 拆两层是刻意的：`planMigration` 是**纯函数**（值从参数进、结果从返回出），迁移的分配逻辑
 * 可以完整单测；`runCredentialMigration` 只负责 IO 编排（读 → 备份 → 写）。
 */
import type { ModelProfile, ProviderAccount } from '../../src/shared/ipc-channels'
import { deriveCredentialRef } from '../../src/shared/credential-rules'
import {
  MODELS_CONFIG_PATH,
  PROVIDERS_CONFIG_PATH,
  backupFileOnce,
  readJsonFile,
  readProvidersFile,
  writeJsonFile,
  writeProvidersFile,
} from '../utils/config-utils'
import { decryptApiKey, encryptApiKey, isPlaintextKey } from '../utils/secure-config'
import { safeErrorMessage } from '../utils/error-utils'
import { logger } from '../utils/logger'
import { serialize } from '../utils/config-write-queue'
import { mergeStoredCiphertext, readCredentialFile } from './store'

/**
 * 「文件里还留着密钥」的唯一判据（明文 / `ENC:` 密文都算）—— 迁移的幂等判据与懒迁移钩子
 * 共用它，两处口径不可能漂移。
 *
 * 空串 = 已迁移 / 从未配置（两者对迁移而言等价：无事可做）。
 */
export function hasLegacyKey(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * 盘上条目的**迁移期形状**：`ModelProfile` / `ProviderAccount` 上已经没有 `apiKey` 字段
 * （v3 T5），但旧文件里可能有 —— 本模块是**全仓唯一还需要看这个字段的地方**，故在此显式声明。
 */
export type LegacyAccount = ProviderAccount & { apiKey?: string }
export type LegacyModel = ModelProfile & { apiKey?: string }

/**
 * 读盘上残留的密钥字段。返回 `unknown` 的原值给 `hasLegacyKey` 判 —— 由它负责
 * 「非字符串 / 空串 = 没有」的收窄，两处判据不会漂移。
 */
export function legacyKeyOf(entry: object): unknown {
  return (entry as { apiKey?: unknown }).apiKey
}

/**
 * 把密钥字段从条目上**摘掉**（不是置空串）——迁移的写回形状。
 *
 * 为什么不留 `apiKey: ''`：那样配置文件里永远躺着一个密码字段，而 v3 的落盘类型
 * （`ModelProfile` / `ProviderAccount`）已经不认它了 —— 类型与盘面对不上，
 * 下一个读这段代码的人得先分辨「空串是已迁移还是从没配过」。摘掉则两者同形。
 */
function withoutLegacyKey<T extends { apiKey?: string }>(entry: T): T {
  const rest = { ...entry }
  delete (rest as { apiKey?: string }).apiKey
  return rest
}

/** 迁移计划（纯函数产物）：`refs` = **合并后**的完整凭据表（含原有项） */
export interface MigrationPlan {
  refs: Record<string, string>
  accounts: ProviderAccount[]
  models: ModelProfile[]
  /** 是否存在非空 `apiKey` —— 幂等判据 */
  changed: boolean
}

/**
 * 值入库前的编码：**明文才加密**，已是 `ENC:` 密文则**原样搬运**。
 *
 * ⚠️ 不能无脑 `encryptApiKey`：密文串会被当明文再加密一层（`ENC:` 套 `ENC:`），
 * 解出来是上一层的密文 —— 密钥直接不可用，且故障表现为 401，最难排查的那类。
 */
function encodeStoredValue(value: string): string {
  return isPlaintextKey(value) ? encryptApiKey(value) : value
}

/** 「值 → ref」反查表：迁移复用 ref 的唯一依据（见 `reuseOrAssignRef`） */
interface RefLookup {
  /** 密文逐字节相同 → 同一个 ref */
  byCipher: Map<string, string>
  /** 明文串相同 → 同一个 ref */
  byPlain: Map<string, string>
}

/**
 * 从凭据库现有内容建反查表。
 *
 * ⚠️ 两张表分开、且**不让解不开的密文参与明文比对**：把坏密文（换机器/损坏，`decryptApiKey`
 * 的原样返回契约）解成乱码再拿去比，会把两个不相干的条目并成同一个 ref —— 静默串钥匙，
 * 比多分配一个名字危险得多。密文只在**逐字节相同**时才算同源
 * （DPAPI 每次加密结果都不同，能逐字节相同必是同一份值的拷贝）。
 */
function buildLookup(storedRefs: Record<string, string>): RefLookup {
  const byCipher = new Map<string, string>()
  const byPlain = new Map<string, string>()
  for (const [ref, value] of Object.entries(storedRefs)) {
    if (!byCipher.has(value)) byCipher.set(value, ref)
    const plaintext = isPlaintextKey(value)
    const plain = plaintext ? value : decryptApiKey(value)
    if ((plaintext || plain !== value) && !byPlain.has(plain)) byPlain.set(plain, ref)
  }
  return { byCipher, byPlain }
}

/**
 * 取该条目要用的 ref：**已有 ref 优先**（半迁移续跑：上次已分配，不许另开 `_2`）；
 * 否则按值复用（同一把钥匙的派生副本/上次已入库的同一份值）；都不中才新分配。
 *
 * 值复用要解决的问题：账户与它的派生条目、以及「凭据已落盘、文件写回前中断」的重跑，
 * 手里都是**同一个值**。不复用就会为同一个密钥派生出一串 `_2`、`_3` —— 用户可见的裸名
 * `<PROVIDER>_API_KEY` 被顶掉，同一个密钥在库里存成多份。
 */
function reuseOrAssignRef(
  provider: string,
  existingRef: string | undefined,
  value: string,
  taken: Set<string>,
  lookup: RefLookup,
): string {
  const plaintext = isPlaintextKey(value)
  const hit = existingRef || (plaintext ? lookup.byPlain.get(value) : lookup.byCipher.get(value))
  const ref = hit || deriveCredentialRef(provider, taken)
  taken.add(ref)
  // 登记本次分配：同一次计划里**后面**的同值条目（账户的派生副本）直接复用，不再派生 `_2`
  const table = plaintext ? lookup.byPlain : lookup.byCipher
  if (!table.has(value)) table.set(value, ref)
  return ref
}

/**
 * 算出迁移计划（纯函数：不读盘、不写盘、不改入参）。
 *
 * @param storedRefs 凭据库现有内容（`ref → ENC: 密文`）—— 既用来避开重名，也作为合并基底
 *
 * **分配顺序固定为 accounts 先、models 后**：首个账户拿到裸名 `<PROVIDER>_API_KEY`
 * （用户在 shell 里 `export OPENAI_API_KEY=…` 的常见写法，正是「环境变量影子」要找的名字），
 * 用户可见的 ref 名因此稳定；后来的同 provider 条目顺延 `_2`、`_3`。
 */
export function planMigration(
  accounts: LegacyAccount[],
  models: LegacyModel[],
  storedRefs: Record<string, string>,
): MigrationPlan {
  const refs: Record<string, string> = { ...storedRefs }
  // 已占用的名字 = 凭据库现有 ref ∪ 两个文件里**已写明**的 apiKeyRef。
  // ⚠️ 必须把「无密钥但有 ref」的条目也收进来：否则一条占着 OPENAI_API_KEY 的旧条目
  //    会让后来的同 provider 条目再派生一次同名 ref —— 两个来源指向同一把钥匙（静默串钥匙）。
  const taken = new Set(Object.keys(refs))
  for (const a of accounts) if (a.apiKeyRef) taken.add(a.apiKeyRef)
  for (const m of models) if (m.apiKeyRef) taken.add(m.apiKeyRef)
  const lookup = buildLookup(storedRefs)

  let changed = false

  const nextAccounts = accounts.map((a) => {
    const legacyKey = legacyKeyOf(a)
    if (!hasLegacyKey(legacyKey)) return a
    changed = true
    const ref = reuseOrAssignRef(a.provider, a.apiKeyRef, legacyKey, taken, lookup)
    // 同名项不覆盖：盘上已有的值可能来自上一次半迁移，也可能来自用户手设（都比本次快照新）
    if (!(ref in refs)) refs[ref] = encodeStoredValue(legacyKey)
    return { ...withoutLegacyKey(a), apiKeyRef: ref }
  })

  const nextModels = models.map((m) => {
    const legacyKey = legacyKeyOf(m)
    if (!hasLegacyKey(legacyKey)) return m
    changed = true
    const ref = reuseOrAssignRef(m.provider, m.apiKeyRef, legacyKey, taken, lookup)
    if (!(ref in refs)) refs[ref] = encodeStoredValue(legacyKey)
    return { ...withoutLegacyKey(m), apiKeyRef: ref }
  })

  return { refs, accounts: nextAccounts, models: nextModels, changed }
}

/** 迁移结果（`runCredentialMigration` 的返回；**永不抛**） */
export interface MigrationOutcome {
  /** 是否真的动了数据（写盘）。false = 无事可做 / 已迁移过 / 失败 */
  changed: boolean
  /** 本次并入凭据库的 ref 数（沿用既有 ref 的半迁移续跑为 0） */
  refs: number
  /** 失败原因（成功 / 无事可做时缺省） */
  error?: string
}

/**
 * 在**队列任务内**把计划套用到刚重读的数据上；`null` = 无需写盘。
 *
 * 为什么要在任务内重读而不是直接写计划结果：计划是队列外的一次快照，直接写回会把
 * 「快照之后落盘的并发修改」整份覆盖掉（丢更新 —— 写队列存在的意义就是防这个）。
 *
 * 两道防线（`baseline` = 计划所依据的那份快照）：
 *  ① **值一致性**：只对「密钥字段与快照一模一样」的条目动手 —— 期间被改过的条目原样保留，
 *     留给下一次迁移（与 providers.json 的 revision 门控同一个思路：不拿旧快照覆盖新数据）；
 *  ② **字段级替换**：即使命中，也只改 `apiKey` / `apiKeyRef` 两个字段，其余字段取**当前**值
 *     （期间改过的 `maxTokens` 之类不该被快照里的旧值冲掉）。
 */
function applyPlannedInTask<T extends { id: string; apiKey?: string; apiKeyRef?: string }>(
  current: T[],
  baseline: T[],
  planned: T[],
): T[] | null {
  const planById = new Map<string, { source: T; legacyKey: string; ref: string }>()
  baseline.forEach((b, i) => {
    const ref = planned[i].apiKeyRef
    if (hasLegacyKey(b.apiKey) && ref) planById.set(b.id, { source: b, legacyKey: b.apiKey, ref })
  })

  let touched = false
  const next = current.map((c) => {
    const entry = planById.get(c.id)
    if (!entry) return c
    if (c.apiKey !== entry.legacyKey || c.apiKeyRef !== entry.source.apiKeyRef) return c
    touched = true
    // 字段级替换 + **摘掉密钥字段**（与 planMigration 同一终态：盘上不再有 apiKey）
    const nextEntry: T = { ...c, apiKeyRef: entry.ref }
    delete (nextEntry as { apiKey?: string }).apiKey
    return nextEntry
  })
  return touched ? next : null
}

/**
 * 存量密钥迁移（幂等；**永不抛**）。
 *
 * 顺序（步骤 ④ 先于 ⑤ 是刻意的）：
 *   ① 读两份配置 → 判断有没有非空 apiKey（没有 → 直接返回，一个字节都不写）
 *   ② 备份两份文件（.bak 已存在则跳过）
 *   ③ 算计划（纯函数）
 *   ④ **凭据先落盘** —— 此后即使崩溃，重跑也只是「值已在库里 + 文件还有旧值」，
 *      按已分配的 ref 沿用即可（半迁移续跑）
 *   ⑤ 两份配置各自在自己的**写队列任务**内完成「重读 → 套计划 → 写回」
 *
 * ⚠️ 步骤 ⑤ 必须走 `serialize`：设置页保存、工作流改模型列表都在同一队列上，
 * 迁移若直接写盘就会与它们互相覆盖（整份 JSON 读-改-写不可并发）。
 */
export async function runCredentialMigration(): Promise<MigrationOutcome> {
  try {
    // ① 值不值得动手 —— 幂等判据也在这里（终态重跑连备份都不做）
    // 注：这两处读的是**盘上原始条目**（类型上已无 apiKey，见 LegacyAccount/LegacyModel）
    const accounts: LegacyAccount[] = readProvidersFile().accounts
    const models: LegacyModel[] = readJsonFile<ModelProfile[]>(MODELS_CONFIG_PATH, [])
    const accountsDirty = accounts.some((a) => hasLegacyKey(legacyKeyOf(a)))
    const modelsDirty = models.some((m) => hasLegacyKey(legacyKeyOf(m)))
    if (!accountsDirty && !modelsDirty) return { changed: false, refs: 0 }

    // ② 回退点。失败 = 整体失败：没有备份就没有回退，宁可这次不迁
    for (const file of [PROVIDERS_CONFIG_PATH, MODELS_CONFIG_PATH]) {
      if (backupFileOnce(file) === 'failed') {
        logger.error('Credentials', `[migrate] 备份失败，本次不迁移：${file}`)
        return { changed: false, refs: 0, error: 'backupFailed' }
      }
    }

    // ③ 计划（纯函数）
    const storedRefs = readCredentialFile().refs
    const plan = planMigration(accounts, models, storedRefs)
    const plannedAccounts: LegacyAccount[] = plan.accounts
    const plannedModels: LegacyModel[] = plan.models
    // 只把**本次新分配**的项交给 store：已有项一律以盘上为准（并发写入可能比本快照新）
    const freshRefs: Record<string, string> = {}
    for (const [ref, cipher] of Object.entries(plan.refs)) {
      if (!(ref in storedRefs)) freshRefs[ref] = cipher
    }

    // ④ 凭据先落盘（合并写 + 同步进程内缓存：迁移后**立即**可解析，不必等重启）
    mergeStoredCiphertext(freshRefs)

    // ⑤ 两份配置各自回写（各自的队列任务内重读 + 套计划）
    if (accountsDirty) {
      await serialize('providers', () => {
        const state = readProvidersFile()
        const next = applyPlannedInTask<LegacyAccount>(state.accounts, accounts, plannedAccounts)
        if (next) writeProvidersFile({ revision: state.revision + 1, accounts: next })
      })
    }
    if (modelsDirty) {
      await serialize('models', () => {
        const current: LegacyModel[] = readJsonFile<ModelProfile[]>(MODELS_CONFIG_PATH, [])
        const next = applyPlannedInTask<LegacyModel>(current, models, plannedModels)
        if (next) writeJsonFile(MODELS_CONFIG_PATH, next)
      })
    }

    logger.info('Credentials', `[migrate] 存量密钥已迁移：新分配 ${Object.keys(freshRefs).length} 个 ref`)
    return { changed: true, refs: Object.keys(freshRefs).length }
  } catch (error) {
    // 失败不阻断（启动路径 / 生成路径都受不起异常）：保留原状，下次再试
    logger.error('Credentials', `[migrate] 迁移失败（保留原状，下次再试）：${safeErrorMessage(error)}`)
    return { changed: false, refs: 0, error: safeErrorMessage(error) }
  }
}
