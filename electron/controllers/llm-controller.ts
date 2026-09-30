import { BrowserWindow } from 'electron'
import { t } from '../../src/shared/locale'
import { readJsonFile, writeJsonFile, MODELS_CONFIG_PATH, GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG, readProvidersFile, writeProvidersFile } from '../utils/config-utils'
import type { ProvidersFileState } from '../utils/config-utils'
import { ModelProfile, GlobalConfig, ProviderAccount } from '../../src/shared/ipc-channels'
import { MAX_TOKENS_CAP, clampMaxTokens } from '../../src/shared/llm-constants'
import { syncAccountModels, isModelOfAccount, type ModelOverrides } from '../../src/shared/provider-accounts'
import { apiKeyFailure, deriveCredentialRef } from '../../src/shared/credential-rules'
import { readCredentialFile, setStoredValue } from '../credentials/store'
import { resolveRequestKey, stripApiKey } from '../credentials/resolve'
import { hasLegacyKey, legacyKeyOf, runCredentialMigration } from '../credentials/migrate'
import type { LegacyAccount, LegacyModel } from '../credentials/migrate'
import type { ResolvedModelProfile } from '../llm/provider.interface'
import { serialize } from '../utils/config-write-queue'
import { presetModelDefaults } from '../../src/shared/provider-presets'
import { listOllamaModels } from '../ollama-embedding'
import { LLMFactory } from '../llm/llm-factory'
import { llmConcurrencyController } from '../utils/concurrency-controller'
import { safeErrorMessage } from '../utils/error-utils'
import { logger } from '../utils/logger'
import { guardedHandle } from '../security/ipc-guard'
import { refreshOutboundProxy } from '../net/proxy-fetch'

const activeStreams = new Map<string, AbortController>()

/** 懒迁移是否已排过（进程内去重；见 scheduleCredentialMigration） */
let credentialMigrationScheduled = false

/**
 * 懒迁移（模型管理 v3 T4）：读到**非空 `apiKey`**（明文或 `ENC:` 密文）时补跑一次存量迁移 ——
 * 把密钥搬进 `credentials.json` 并给条目补发 `apiKeyRef`。启动路径（main.ts）是主入口，
 * 这里是**安全网**：老数据在运行期才出现（比如用户手工改了配置文件）也不会一直不迁。
 *
 * ⚠️ **绝不能 await**：本模块的读路径（`loadModelConfigs` / `readProvidersFile`）大量运行在
 * `serialize(...)` 任务**内部**，而迁移自己的写盘也排同一个队列 —— 任务内等自己 = 自死锁
 * （`llm:save-provider` 会直接卡死）。不 await 的代价只是「本次读仍看到迁移前的数据」——
 * v3 T5 起密钥解析是 ref-only，那个窗口里该条目表现成**「无 key」**（用户看到「请配置密钥」），
 * 迁移在后台完成后**下一次**读即恢复 —— 不再有「明文回落」把窗口遮住。
 *
 * ⚠️ 进程内只排一次：读路径是热路径（每次生成都会走），失败重排会让队列堆满注定失败的任务。
 * 迁移失败不阻断任何功能（文件里的明文仍在、`.bak` 也在），下次启动时启动路径会再试一次。
 */
function scheduleCredentialMigration(): void {
  if (credentialMigrationScheduled) return
  credentialMigrationScheduled = true
  void runCredentialMigration().catch((error) => {
    // runCredentialMigration 内部已兜底（不抛）；这里是最后一道保险，避免未处理的 rejection
    logger.warn('LLM', `[lazy-migrate] 意外异常（已忽略）：${safeErrorMessage(error)}`)
  })
}

/**
 * 读 providers.json + 懒迁移钩子：让「读 providers」的每个入口都自动带上判定，
 * 不必各处记得手写一遍（漏一处就会出现「某个入口读到的还是旧形状」的分裂）。
 */
function readProvidersFileLazy(): ProvidersFileState {
  const state = readProvidersFile()
  if (state.accounts.some((a) => hasLegacyKey(legacyKeyOf(a)))) scheduleCredentialMigration()
  return state
}

/**
 * 读 models.json（**返回条目不含密钥**；类型上也没有该字段）。
 *
 * ⚠️ 盘上可能仍有 `apiKey` 残留（迁移失败的窗口）——这里**原样读、原样写回**，
 * **不在此处剥离**：剥离意味着下一次「读-改-写」会把明文从文件里抹掉，而迁移还没把值搬进
 * 凭据库 → 密钥静默丢失（要重启或让用户重填）。剥离只发生在**出站边界**
 * （`llm:list-models` 的 `stripApiKey`）——那里删的是内存副本，盘上数据不受影响。
 */
function loadModelConfigs(): ModelProfile[] {
  const models = readJsonFile<ModelProfile[]>(MODELS_CONFIG_PATH, [])
  if (models.some((m) => hasLegacyKey(legacyKeyOf(m)))) scheduleCredentialMigration()
  return models
}

/** 写 models.json —— v3 T5 起不再加解密：落盘类型里没有可加密的字段了 */
function saveModelConfigs(models: ModelProfile[]) {
  writeJsonFile(MODELS_CONFIG_PATH, models)
}

/**
 * 保存时把**盘上残留的密钥字段**原样带过去（T5 修复 round 1）。
 *
 * 为什么必须有：渲染层拿到的是**出站剥离过**的条目（没有 `apiKey`），而我们保存走的是**整条替换**
 * —— 于是盘上尚未迁移的明文/密文会被静默抹掉，此后 `hasLegacyKey` 恒 false、迁移**永不再搬**，
 * 密钥只剩重填一条路。派生同步（`syncAccountModels`）用的是 `{...m, ...credentials}` 合并语义，
 * 本来就有这层保护 —— 两处口径必须一致。
 *
 * 取值顺序：调用方自带（内部调用方）→ 盘上残留；**都没有则不加这个键**
 * （「落盘不含密码字段」是 T5 的性质，不能因为保全而回退）。
 */
function carryLegacyKey(next: { apiKey?: string }, onDisk: object | undefined): void {
  const own = legacyKeyOf(next)
  const carried = hasLegacyKey(own) ? own : legacyKeyOf(onDisk ?? {})
  if (hasLegacyKey(carried)) next.apiKey = carried
}

/**
 * models.json 的**受保护**读-改-写（v3 §5）：整次「读 → 改 → 写」都在同一个写队列任务内。
 *
 * ⚠️ 保护的正确性取决于**整次**读-改-写都在 fn 里：只把 write 包起来等于没包
 * （两个调用者仍会各自基于同一份旧快照改，后写者覆盖前者的改动）。
 * 返回写入后的数组，供调用方做日志/计数（不必再读一次盘）。
 */
function mutateModels(fn: (models: ModelProfile[]) => ModelProfile[]): Promise<ModelProfile[]> {
  return serialize('models', () => {
    const next = fn(loadModelConfigs())
    saveModelConfigs(next)
    return next
  })
}

/** `mutateProviders` 的结果（写入成功 / 版本冲突 / 写盘失败） */
type ProvidersMutationResult =
  | { kind: 'written'; revision: number }
  | { kind: 'conflict' }
  | { kind: 'failed'; error: string }

/**
 * providers.json 的受保护读-改-写 + revision 门控（v3 §5「写入：逐字段最小操作 + revision 冲突拒绝」）。
 *
 * - `expectedRevision === undefined` → **不校验**（老调用方零改动；unfenced 写入）
 * - 不符 → `conflict`：**一个字节都不写**（含 revision 不 bump）——调用方据此提示「配置已被
 *   其他窗口修改，请重载」
 * - 成功 → revision = 旧值 + 1（下次提交带它 → 期间别处的修改会被检出）
 * - 写盘抛错 → `failed`（与其他 IPC 一致：报错不抛给渲染层，但要留日志 —— 由调用方打）
 */
function mutateProviders(
  expectedRevision: number | undefined,
  fn: (accounts: ProviderAccount[]) => ProviderAccount[],
): Promise<ProvidersMutationResult> {
  return serialize<ProvidersMutationResult>('providers', () => {
    const state = readProvidersFileLazy()
    if (expectedRevision !== undefined && expectedRevision !== state.revision) {
      return { kind: 'conflict' }
    }
    const revision = state.revision + 1
    writeProvidersFile({ revision, accounts: fn(state.accounts) })
    return { kind: 'written', revision }
  }).catch((error) => ({ kind: 'failed', error: safeErrorMessage(error) }))
}

/**
 * 分配 ref 时的「已占用」全集（v3 §4.3）：凭据库已有 ref ∪ 账户的 ref ∪ **手工条目**的 ref。
 *
 * 为什么要连手工条目一起收：ref 是**全局命名空间**（就是环境变量名）—— 与账户的 ref
 * 分开算的话，一个手工模型条目用掉的 `OPENAI_API_KEY` 会被下一个账户再分配一次，
 * 两个来源从此指向同一个环境变量（静默串钥匙）。
 *
 * ⚠️ 传进来的 `accounts` 必须是**队列任务内刚读到的那份**，否则两次并发保存会分到同名 ref。
 * 只读 `apiKeyRef`（不是密文），所以这里对 models.json 用**裸读**（readJsonFile）：
 * 顺带避开 `loadModelConfigs` 的明文迁移写盘（那也该发生在队列里）。
 */
function collectTakenRefs(accounts: ProviderAccount[]): Set<string> {
  const taken = new Set<string>(Object.keys(readCredentialFile().refs))
  for (const a of accounts) if (a.apiKeyRef) taken.add(a.apiKeyRef)
  const accountIds = new Set(accounts.map((a) => a.id))
  for (const m of readJsonFile<ModelProfile[]>(MODELS_CONFIG_PATH, [])) {
    // 「无账户前缀」= 手工条目；派生条目（`{accountId}::{modelName}`）的 ref 已由上面的循环覆盖
    const isDerived = [...accountIds].some((id) => isModelOfAccount(m.id, id))
    if (!isDerived && m.apiKeyRef) taken.add(m.apiKeyRef)
  }
  return taken
}

/**
 * 交给 provider 前的**唯一收口点**（v3 §4.4）：把条目上的 `apiKeyRef` 解析成实际密钥
 * （`draft` 给定时它优先 —— 用户当场输入的一次性草稿）。
 *
 * 为什么收在这里而不进 provider：密钥来源（凭据库 / env / 本次草稿）是**主进程配置层**的事，
 * provider 只该拿到「一串可用的密钥」——分散到各 provider 里会变成三份各自演化的兜底逻辑。
 * 返回 `ResolvedModelProfile`：类型上给 `apiKey` 盖章，provider 拿不到未解析的条目。
 */
function withResolvedKey(model: ModelProfile, draft?: string): ResolvedModelProfile {
  return { ...model, apiKey: resolveRequestKey(model.apiKeyRef, draft) }
}

/** 生成路径（`llm:generate` / `llm:generate-stream` 共用）取模型配置，密钥已解析 */
function getModelConfig(modelId: string): ResolvedModelProfile | null {
  const models = loadModelConfigs()
  const model = models.find((m) => m.id === modelId) ?? null
  return model ? withResolvedKey(model) : null
}

/**
 * 解析并钳制 maxTokens 请求参数（运行时钳制，所有请求通道唯一收口）。
 * 设置页 ModelForm 已钳制保存路径 [1, 131072]，但旧配置/直改 models.json
 * 仍可超限 → 请求 max_tokens 超模型上限 → API 400（"This endpoint's max tokens..."）。
 */
function resolveMaxTokens(requested: number | undefined, model: ModelProfile): number {
  const raw = requested ?? model.maxTokens
  const clamped = clampMaxTokens(requested, model.maxTokens)
  if (clamped !== raw) {
    logger.warn('LLM', t('log.llm.maxTokensClamped')
      .replace('{model}', model.name)
      .replace('{requested}', String(raw))
      .replace('{clamped}', String(clamped))
      .replace('{cap}', String(MAX_TOKENS_CAP)))
  }
  return clamped
}

/**
 * 同步代理配置。**两条链路都要更新，别只做一半**：
 *
 * 1. `refreshOutboundProxy()` —— 主进程**自己的**出站请求（LLM/Embedding/开发者 API）。
 *    这是 2026-09-25 补的：此前只设环境变量，而主进程 `globalThis.fetch` 是 Node undici，
 *    **不读**代理环境变量（除非进程启动时就带 `NODE_USE_ENV_PROXY=1`）——实测把 HTTPS_PROXY
 *    指向死端口，请求照样 200。即「用户配了代理，应用自己的请求一直直连」。
 * 2. 下面那组 `process.env.*` —— 保留，它服务的是**子进程**：`mcp-manager` 用
 *    `env: { ...process.env }` 拉起 MCP 服务器，子进程（npx 下载的第三方工具）会继承它。
 *    对主进程自身无效，别指望。
 */
function applyProxyConfig() {
  refreshOutboundProxy()
  try {
    const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
    if (config.proxy?.enabled && config.proxy.host) {
      const proxyUrl = config.proxy.type === 'socks5'
        ? `socks5://${config.proxy.host}:${config.proxy.port}`
        : `http://${config.proxy.host}:${config.proxy.port}`
      process.env.HTTP_PROXY = proxyUrl
      process.env.HTTPS_PROXY = proxyUrl
      process.env.http_proxy = proxyUrl
      process.env.https_proxy = proxyUrl
    } else {
      delete process.env.HTTP_PROXY
      delete process.env.HTTPS_PROXY
      delete process.env.http_proxy
      delete process.env.https_proxy
    }
  } catch { /* 忽略 */ }
}

/** 启动时恢复持久化的并发配置（重启不丢；损坏值忽略回到默认） */
function restoreConcurrencyConfig() {
  try {
    const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
    if (config.concurrency?.maxConcurrent && config.concurrency.maxQueueSize) {
      llmConcurrencyController.updateConfig({
        maxConcurrent: Math.max(1, Math.min(20, config.concurrency.maxConcurrent)),
        maxQueueSize: Math.max(1, Math.min(500, config.concurrency.maxQueueSize)),
      })
      logger.info('LLM', t('log.llm.concurrencyRestored').replace('{max}', String(config.concurrency.maxConcurrent)).replace('{queue}', String(config.concurrency.maxQueueSize)))
    }
  } catch { /* 忽略 */ }
}

export function registerLLMController() {
  restoreConcurrencyConfig()
  // 启动即同步一次代理：Embedding / 健康检查可能在任何 LLM 调用**之前**发生，
  // 不能只依赖 applyProxyConfig 那几处「LLM 操作前」的调用点
  applyProxyConfig()

  guardedHandle('llm:generate', async (_event, request: { modelId: string; messages: Array<{ role: string; content: string }>; temperature?: number; maxTokens?: number; responseFormat?: { type: string }; thinking?: boolean; priority?: number }) => {
    return llmConcurrencyController.execute(
      async () => {
        applyProxyConfig()
        const model = getModelConfig(request.modelId)
        if (!model) return { success: false, content: '', error: t('error.modelConfigNotFound') }

        const provider = LLMFactory.getProvider(model)
        return await provider.generate(model, request.messages, {
          temperature: request.temperature ?? model.temperature,
          maxTokens: resolveMaxTokens(request.maxTokens, model),
          responseFormat: request.responseFormat,
          thinking: request.thinking,
        })
      },
      // timeoutMs: 0 —— 与流式一致：长输出（预设 maxTokens 高达 131072）可超 120s；
      // Promise.race 超时不取消底层 fn，超时后请求仍会真实调用 API 继续扣费（历史事故：
      // 超时报错 + 底层继续执行 + 槽位提前释放 → 并发上限失效 + 双倍计费）
      { priority: request.priority ?? 10, timeoutMs: 0 },
    ).catch((error) => ({
      success: false,
      content: '',
      error: error instanceof Error ? error.message : safeErrorMessage(error),
    }))
  })

  guardedHandle('llm:generate-stream', async (event, requestId: string, request: { modelId: string; messages: Array<{ role: string; content: string }>; temperature?: number; maxTokens?: number; responseFormat?: { type: string }; thinking?: boolean; priority?: number }) => {
    applyProxyConfig()
    const model = getModelConfig(request.modelId)
    if (!model) return { requestId, started: false }

    const abortController = new AbortController()
    activeStreams.set(requestId, abortController)
    const win = BrowserWindow.fromWebContents(event.sender)

    const provider = LLMFactory.getProvider(model)

    // 使用并发控制器执行流式请求
    // 注意：流式请求的 execute 返回后流仍在进行，所以我们在内部获取槽位
    // timeoutMs: 0（无硬超时）——长输出（批量蓝图/长文生成）可超过 120s；
    // 流式请求的生命周期由 llm:cancel → AbortController 管理（取消仍生效）
    llmConcurrencyController.execute(
      async () => {
        // 检查请求是否已被取消（排队期间被取消：必须补发错误事件——
        // 渲染层监听器与 activeRequests 只在 onDone/onError 中清理，静默跳过会永久泄漏）
        if (abortController.signal.aborted) {
          win?.webContents.send('llm:stream-error', { requestId, error: t('error.requestCancelled') })
          activeStreams.delete(requestId)
          return { skipped: true }
        }

        return new Promise<void>((resolve, reject) => {
          provider.generateStream(model, request.messages, {
            temperature: request.temperature ?? model.temperature,
            maxTokens: resolveMaxTokens(request.maxTokens, model),
            responseFormat: request.responseFormat,
            thinking: request.thinking,
            signal: abortController.signal,
            onChunk: (chunk: string) => {
              if (!abortController.signal.aborted) {
                win?.webContents.send('llm:stream-chunk', { requestId, chunk })
              }
            },
            onDone: (fullText: string, usage?: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number }) => {
              // usage 含真实缓存命中 token（provider 已解析），透传给渲染进程供费用统计
              win?.webContents.send('llm:stream-done', { requestId, fullText, usage })
              activeStreams.delete(requestId)
              resolve()
            },
            onError: (error: string) => {
              win?.webContents.send('llm:stream-error', { requestId, error })
              activeStreams.delete(requestId)
              reject(new Error(error))
            },
          }).catch(reject)
        }).catch(() => { /* 流式错误已通过 onError 回调处理 */ })
      },
      { priority: request.priority ?? 10, timeoutMs: 0 },
    ).catch((error) => {
      // 用 error.name 判断取消（此前依赖 locale 文案 '请求已取消' 字符串比较，
      // en-US/ru-RU 语言下失效且是死分支——取消路径实际已被 skipped 分支/onError 处理）
      if (!(error instanceof Error && error.name === 'AbortError')) {
        win?.webContents.send('llm:stream-error', { requestId, error: safeErrorMessage(error) })
        activeStreams.delete(requestId)
      }
    })

    return { requestId, started: true }
  })

  guardedHandle('llm:cancel', async (_event, requestId: string) => {
    const controller = activeStreams.get(requestId)
    if (controller) {
      controller.abort()
      activeStreams.delete(requestId)
      return { success: true }
    }
    return { success: false }
  })

  // 真机反馈「列表/保存/删除都很慢」的定位埋点：只在**超过阈值**时告警，避免刷日志。
  // 这三条覆盖了设置页模型增删的全部主进程侧开销（每次改动都会伴随一次 list）。
  const SLOW_IPC_MS = 200

  guardedHandle('llm:list-models', async () => {
    const t0 = Date.now()
    // 出站剥离（v3 §4.7）：条目上可能残留的密钥字段一律删掉再回渲染层
    const models = loadModelConfigs().map(stripApiKey)
    const ms = Date.now() - t0
    if (ms > SLOW_IPC_MS) logger.warn('LLM', `[list-models] slow ${ms}ms (models=${models.length})`)
    return models
  })

  guardedHandle('llm:save-model', async (_event, model: ModelProfile, apiKeyDraft?: string) => {
    const t0 = Date.now()
    try {
      // 业务校验（P3 修复）：
      // - modelName 空 → 运行时 API 必报错（ollama 空名等）
      // - purposes 空 → 模型在 UI 所有分类中不可见的孤儿，无法编辑/删除
      if (!model.modelName?.trim()) {
        return { success: false, error: t('error.modelNameEmpty') }
      }
      if (!model.purposes || model.purposes.length === 0) {
        return { success: false, error: t('error.modelPurposesEmpty') }
      }
      // 密钥草稿先校验（与 credential:set 同一套判据/拒因码）：非法值不该先写进配置文件
      const draft = apiKeyDraft ?? ''
      const failure = apiKeyFailure(draft)
      if (failure) return { success: false, error: failure }

      // ref 分配（v3 §4.3）在**队列任务内**做，且与 save-provider 共用同一份 taken 全集口径：
      // 新建的手工条目也要占名，否则下一个账户会再派生一次同名 ref（两个来源指向同一把钥匙）。
      const allocated: string[] = []
      // 读-改-写全程在 models 队列内（v3 §5）：并发保存两个模型不再互相覆盖
      const saved = await mutateModels((models) => {
        const accounts = readProvidersFileLazy().accounts
        // 派生条目（`{accountId}::{modelName}`）的凭据属于**账户**：继承它的 ref 而不是另分配一个
        // —— 否则同一把钥匙会有两个名字，用户在账户里换键时这条永远跟不上（半迁移的旧条目会走到这）
        const owner = accounts.find((a) => isModelOfAccount(model.id, a.id))
        const apiKeyRef = model.apiKeyRef
          ?? owner?.apiKeyRef
          ?? deriveCredentialRef(model.provider, collectTakenRefs(accounts))
        allocated[0] = apiKeyRef
        const idx = models.findIndex((m) => m.id === model.id)
        const next: LegacyModel = { ...model, apiKeyRef }
        // 整条替换前把盘上残留带过去（见 carryLegacyKey：否则未迁移的明文被静默抹掉）
        carryLegacyKey(next, idx >= 0 ? models[idx] : undefined)
        if (idx >= 0) return models.map((m, i) => (i === idx ? next : m))
        return [...models, next]
      })

      // 凭据写在**配置写成功之后**（spec §4.7 顺序）：写盘失败 → 配置已存（幂等），重试只补凭据
      const ref = allocated[0]
      if (draft.trim().length > 0 && ref) {
        try {
          setStoredValue(ref, draft.trim())
        } catch (error) {
          logger.error('LLM', `[save-model] 凭据写入失败 ref=${ref}: ${safeErrorMessage(error)}`)
          return { success: false, error: safeErrorMessage(error) }
        }
      }

      const ms = Date.now() - t0
      if (ms > SLOW_IPC_MS) logger.warn('LLM', `[save-model] slow ${ms}ms (models=${saved.length})`)
      return { success: true }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  guardedHandle('llm:delete-model', async (_event, modelId: string) => {
    const t0 = Date.now()
    try {
      // ⚠️ 真机回归修复（2026-09-13）：原先 `loadModelConfigs().filter(m => m.id !== modelId)`
      //   在 modelId 非法/模型不存在时会**空转**，然后照样 saveModelConfigs + 返回 success:true
      //   —— 界面上就是「点了删除没反应」（模型还在，且没有任何报错）。现在两种情况都显式报错。
      if (typeof modelId !== 'string' || !modelId.trim()) {
        const msg = `invalid modelId: ${String(modelId)}`
        logger.error('LLM', `[delete-model] ${msg}`)
        return { success: false, error: msg }
      }
      // 存在性判定用**裸读**（与里面那次受队列保护的真实删除分离）：只比 id，
      // 顺带避开 loadModelConfigs 的明文迁移写盘跑到队列外面去
      const ids = readJsonFile<ModelProfile[]>(MODELS_CONFIG_PATH, []).map((m) => m.id)
      if (!ids.includes(modelId)) {
        const msg = `model not found: ${modelId}`
        logger.warn('LLM', `[delete-model] ${msg}`)
        return { success: false, error: msg }
      }
      await mutateModels((models) => models.filter((m) => m.id !== modelId))
      const ms = Date.now() - t0
      logger.info('LLM', `[delete-model] removed: ${modelId} (${ms}ms)`)
      if (ms > SLOW_IPC_MS) logger.warn('LLM', `[delete-model] slow ${ms}ms`)
      return { success: true }
    } catch (error) {
      // 写盘失败（writeJsonFile 会 rethrow）等：必须留日志，否则只有渲染层一行 toast，排障全靠猜
      logger.error('LLM', `[delete-model] failed: ${safeErrorMessage(error)}`)
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  // ===== 供应商账户（2026-09-25）：一份凭据挂多个模型 =====
  //
  // 存储：providers.json 是账户的唯一真相；models.json 里的**派生条目**持有凭据引用
  // （apiKeyRef），由 syncAccountModels 维护（合并语义：只换连通字段，保留用户的逐模型调参）。
  // 这样做的理由见 src/shared/provider-accounts.ts 头注释。

  guardedHandle('llm:list-providers', async () => {
    // 出站剥离（v3 §4.7）：账户只带 apiKeyRef；值不过境，凭据状态走 credential:describe。
    // revision 同快照返回（v3 §5）：编辑卡据此做版本门控，拆开读会拿到不匹配的一对
    const state = readProvidersFileLazy()
    return { accounts: state.accounts.map(stripApiKey), revision: state.revision }
  })

  guardedHandle('llm:save-provider', async (_event, account: ProviderAccount, modelSpecs?: Record<string, { contextWindow?: number; maxTokens?: number }>, expectedRevision?: number, apiKeyDraft?: string, modelOverrides?: ModelOverrides) => {
    try {
      // 密钥草稿先校验（同 credential:set 的判据/拒因码），非法值不写盘
      const draft = apiKeyDraft ?? ''
      const failure = apiKeyFailure(draft)
      if (failure) return { success: false, error: failure }

      // ref 分配（v3 §4.3）必须在**队列任务内**做：taken 要用刚读到的那份 accounts，
      // 否则两次并发保存会各自算出同一个名字。
      // 分配结果经 holder 带出（数组 holder：TS 的控制流分析看不到闭包内赋值，`let` 变量
      // 会在闭包外被收窄成 null 而报「属性不存在」，元素访问则不会）。
      const allocated: ProviderAccount[] = []
      const outcome = await mutateProviders(expectedRevision, (accounts) => {
        const apiKeyRef = account.apiKeyRef ?? deriveCredentialRef(account.provider, collectTakenRefs(accounts))
        const idx = accounts.findIndex((a) => a.id === account.id)
        const next: LegacyAccount = { ...account, apiKeyRef }
        // 整条替换前把盘上残留带过去（与 save-model 同一道保全，见 carryLegacyKey）
        carryLegacyKey(next, idx >= 0 ? accounts[idx] : undefined)
        allocated[0] = next
        if (idx >= 0) return accounts.map((a, i) => (i === idx ? next : a))
        return [...accounts, next]
      })

      if (outcome.kind === 'conflict') {
        logger.warn('LLM', `[save-provider] revision conflict: account=${account.id} expected=${String(expectedRevision)}`)
        return { success: false, conflict: true, error: 'provider/conflict' }
      }
      if (outcome.kind === 'failed') {
        logger.error('LLM', `[save-provider] failed: ${outcome.error}`)
        return { success: false, error: outcome.error }
      }

      // 同步派生条目（账户条目走自己的队列键 providers，派生同步走 models —— 两次写各自原子，
      // 且都在「读→改→写」全程受保护，v3 §5）。派生条目只带 apiKeyRef，不再有凭据副本。
      // 规格来源（2026-09-28 批量采纳）：**本次拉取所得优先，回落内置预设** —— 拉回的规格
      // 是端点真实值；预设只是多数场景的缺省。只覆盖传入的实值键（undefined 不遮蔽回落值）。
      const saved: ProviderAccount = { ...account, apiKeyRef: allocated[0]?.apiKeyRef ?? account.apiKeyRef }
      await mutateModels((models) =>
        syncAccountModels(saved, models, (name) => {
          const base = presetModelDefaults(account.provider, name)
          const spec = modelSpecs?.[name]
          if (!spec) return base
          return {
            ...base,
            ...(spec.maxTokens !== undefined ? { maxTokens: spec.maxTokens } : {}),
            ...(spec.contextWindow !== undefined ? { contextWindow: spec.contextWindow } : {}),
          }
        }, modelOverrides),
      )

      // 凭据写在**配置写成功之后**（spec §4.7）：失败 → 账户已存（幂等），重试只补凭据这一步。
      // 返回里带上新 revision，让调用方不至于拿旧版本号再撞一次冲突。
      const ref = allocated[0]?.apiKeyRef
      if (draft.trim().length > 0 && ref) {
        try {
          setStoredValue(ref, draft.trim())
        } catch (error) {
          logger.error('LLM', `[save-provider] 凭据写入失败 ref=${ref}: ${safeErrorMessage(error)}`)
          return { success: false, error: safeErrorMessage(error), revision: outcome.revision }
        }
      }
      return { success: true, revision: outcome.revision }
    } catch (error) {
      logger.error('LLM', `[save-provider] failed: ${safeErrorMessage(error)}`)
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  guardedHandle('llm:delete-provider', async (_event, accountId: string) => {
    try {
      // ⚠️ 与 llm:delete-model 那次真机回归同型的坑：目标不存在时不能"空转照样返回 success"
      //   —— 界面上就是「点了删除没反应」。差别是那边回的是英文诊断串（给排障看），
      //   这里按 i18n 标准回可翻译文案（该字符串会一路到渲染层的 toast）。
      //   故存在性先在队列外判（也顺带避免「没得删却 bump 一次 revision」）。
      if (!readProvidersFileLazy().accounts.some((a) => a.id === accountId)) {
        logger.warn('LLM', `[delete-provider] account not found: ${accountId}`)
        return { success: false, error: t('error.providerNotFound') }
      }

      const outcome = await mutateProviders(undefined, (accounts) => accounts.filter((a) => a.id !== accountId))
      if (outcome.kind === 'failed') {
        logger.error('LLM', `[delete-provider] failed: ${outcome.error}`)
        return { success: false, error: outcome.error }
      }

      // 删账户的语义 = 移除该账户的**全部派生条目**。⚠️ 不能再用 `{ ...gone, modelNames: [] }`
      // 表达（v3 起空数组 = 继承内置目录 → 反而会把目录整组重建出来）；按 id 前缀过滤才是本意。
      // 手工条目与其它账户不受影响（前缀不匹配）。
      await mutateModels((models) => models.filter((m) => !isModelOfAccount(m.id, accountId)))
      return { success: true }
    } catch (error) {
      logger.error('LLM', `[delete-provider] failed: ${safeErrorMessage(error)}`)
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  guardedHandle(
    'llm:list-provider-models',
    async (_event, credentials: { provider: string; protocol: 'openai' | 'gemini'; baseUrl: string; apiKeyRef?: string; apiKeyDraft?: string }) => {
      try {
        if (!credentials.baseUrl?.trim()) {
          return { success: false, error: t('error.baseUrlRequired') }
        }
        // Ollama 走原生 /api/tags（复用既有实现：比 OpenAI 兼容端点更可靠，老版本也有）
        if (credentials.provider === 'ollama') {
          const models = await listOllamaModels(credentials.baseUrl)
          // /api/tags 不提供 token 规格 → 仅 id（2026-09-28 候选对象化）
          return { success: true, models: models.map((m) => ({ id: m.name })) }
        }
        // 密钥解析（v3 §4.4/§4.7）：表单里刚输入的草稿优先，否则按 ref 解析
        const apiKey = resolveRequestKey(credentials.apiKeyRef, credentials.apiKeyDraft)
        if (!apiKey.trim()) {
          return { success: false, error: t('error.apiKeyRequired') }
        }
        const models = await LLMFactory.getProvider({ protocol: credentials.protocol })
          .listModels({ baseUrl: credentials.baseUrl, apiKey })
        return { success: true, models }
      } catch (error) {
        // ⚠️ 必须**分类**：早先对所有失败都回同一句「该服务可能不支持」——
        //   密钥无效(401)、没网、地址写错时那句是**误导**，用户据此排查只会越走越偏。
        const status = (error as { status?: number }).status
        const isTimeout = (error as { name?: string }).name === 'AbortError'
        const detail = safeErrorMessage(error)
        logger.warn('LLM', `[list-provider-models] failed (status=${status ?? 'n/a'}${isTimeout ? ', timeout' : ''}): ${detail}`)
        const msg = status === 401 || status === 403
          ? t('error.modelListAuth').replace('{status}', String(status))
          : status === 404
          ? t('error.modelListNotSupported')
          : isTimeout
          // 超时最常见于：要走代理却按直连（或反之）。原文 "This operation was aborted" 对用户毫无信息量
          ? t('error.modelListTimeout')
          : t('error.modelListUnavailable').replace('{detail}', () => detail)
        return { success: false, error: msg }
      }
    },
  )

  guardedHandle('llm:set-default-model', async (_event, modelId: string | null) => {
    try {
      const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
      config.defaultModelId = modelId
      writeJsonFile(GLOBAL_CONFIG_PATH, config)
      return { success: true }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  guardedHandle('llm:get-default-model', async () => {
    const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
    return config.defaultModelId
  })

  guardedHandle('llm:set-default-embedding-model', async (_event, modelId: string | null) => {
    try {
      const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
      config.defaultEmbeddingModelId = modelId
      writeJsonFile(GLOBAL_CONFIG_PATH, config)
      return { success: true }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  guardedHandle('llm:get-default-embedding-model', async () => {
    const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
    return config.defaultEmbeddingModelId ?? null
  })

  guardedHandle('llm:test-connection', async (_event, model: ModelProfile, apiKeyDraft?: string) => {
    try {
      applyProxyConfig()

      // 收到的 profile 来自渲染层（表单草稿 / 列表条目）。密钥来源二选一（v3 §4.7）：
      // 表单里刚输入的草稿（apiKeyDraft）优先 —— 用户要能当场验证新键；否则按 apiKeyRef 解析。
      const target = withResolvedKey(model, apiKeyDraft)
      const messages = [{ role: 'user', content: 'Say "hello" and nothing else.' }]
      const provider = LLMFactory.getProvider(target)

      let result = { success: true, error: undefined as undefined | string }
      if (target.purposes?.includes('embedding')) {
        const { generateEmbeddings } = await import('../embedding')
        await generateEmbeddings(['hello'], target.protocol, target)
      } else {
        const res = await provider.generate(target, messages, {
          temperature: 0.7,
          maxTokens: 10,
        })
        result = { success: res.success, error: res.error }
      }

      return { success: result.success, error: result.error }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  // ===== 并发控制 =====

  guardedHandle('llm:concurrency-status', async () => {
    return llmConcurrencyController.getStatus()
  })

  guardedHandle('llm:concurrency-config', async (_event, config: { maxConcurrent?: number; maxQueueSize?: number }) => {
    try {
      // IPC 层钳制（UI 已有 min 1，主进程独立校验防死锁排队：maxConcurrent<=0 时所有请求卡队列）
      const next = {
        maxConcurrent: config.maxConcurrent !== undefined ? Math.max(1, Math.min(20, config.maxConcurrent)) : undefined,
        maxQueueSize: config.maxQueueSize !== undefined ? Math.max(1, Math.min(500, config.maxQueueSize)) : undefined,
      }
      llmConcurrencyController.updateConfig(next)
      // 持久化到全局配置（重启恢复）
      const g = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
      g.concurrency = {
        maxConcurrent: llmConcurrencyController.getStatus().maxConcurrent,
        maxQueueSize: llmConcurrencyController.getStatus().maxQueueSize,
      }
      writeJsonFile(GLOBAL_CONFIG_PATH, g)
      return { success: true }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  // ===== 模型路由配置（三层 elite/standard/budget，持久化到全局配置） =====

  guardedHandle('llm:set-routes', async (_event, routes: { elite: string[]; standard: string[]; budget: string[]; strategy?: 'static' | 'dynamic' }) => {
    try {
      const g = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
      g.modelRoutes = {
        elite: Array.isArray(routes.elite) ? routes.elite : [],
        standard: Array.isArray(routes.standard) ? routes.standard : [],
        budget: Array.isArray(routes.budget) ? routes.budget : [],
        // 白名单值域：非法值一律回落 static（fail-safe 到既有行为）
        strategy: routes.strategy === 'dynamic' ? 'dynamic' : 'static',
      }
      writeJsonFile(GLOBAL_CONFIG_PATH, g)
      return { success: true }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  guardedHandle('llm:get-routes', async () => {
    const g = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
    return g.modelRoutes ?? { elite: [], standard: [], budget: [] }
  })
}
