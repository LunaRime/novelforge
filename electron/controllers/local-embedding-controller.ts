/**
 * 本地 Ollama 向量档控制器（T4）—— `embedding:local-*` 六条通道
 *
 * 设计要点：
 * - **全部经 `guardedHandle` 注册**（L4 铁律 4：禁止裸 `ipcMain.handle`），通道在策略表登记后
 *   才可注册（缺登记 = tsc 编译错误）。
 * - **四条探测/拉取通道不收渲染层入参**：baseUrl/model 一律由主进程从全局配置读取。
 *   若允许渲染层传 baseUrl，被 XSS 的渲染层就能让主进程向任意内网地址发请求
 *   （与 L4 S10 对 `mcp:connect` 的收紧同一理由）。
 * - **`local-pull` 只发起、立即返回**：`pullModel` 的下载可能持续数分钟，await 它会撞上渲染层
 *   30s IPC 超时；进度经事件 `embedding:local-pull-progress` 推送（preload 的 event 前缀由
 *   `IPC_EVENT_CHANNELS` 派生，无需手改 preload）。
 */
import { t } from '../../src/shared/locale'
import type { EmbeddingEvents, GlobalConfig, LocalEmbeddingConfig } from '../../src/shared/ipc-channels'
import {
  DEFAULT_GLOBAL_CONFIG,
  GLOBAL_CONFIG_PATH,
  readJsonFile,
  readLocalEmbeddingConfig,
  writeJsonFile,
} from '../utils/config-utils'
import { detectOllama, listOllamaModels, pullModel, embedLocal } from '../ollama-embedding'
import { installModel } from '../model-installer'
import { createElectronTransport } from '../net/electron-net-transport'
import { guardedHandle } from '../security/ipc-guard'
import { logger } from '../utils/logger'
import { safeErrorMessage } from '../utils/error-utils'

/** 测试用文本（与既有 `embedding:test-llm` 同字面量；是发给模型的输入，非用户可见文案） */
const TEST_TEXT = '测试文本'

/** 拉取中的 `<baseUrl>|<model>`：防连点 / 多窗口重复发起同一模型的下载（数 GB 级） */
const pullsInFlight = new Set<string>()

/** 进度帧载荷（事件通道类型的唯一来源在 src/shared/ipc-channels.ts） */
type ProgressFrame = EmbeddingEvents['embedding:local-pull-progress']

/** 代理配置（智能下载的候选路径来源；读失败退化为「只有直连」） */
function readProxyConfig(): GlobalConfig['proxy'] {
  try {
    return readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG).proxy
  } catch {
    return undefined
  }
}

/**
 * 智能下载 → 失败回退 Ollama 自身 pull。
 *
 * **回退是设计的一部分，不是兜底**：模型目录不可写 / registry 全路径不通 / 换路超限 /
 * 落库自检失败，都走它——用户此时得到的就是本功能上线前的行为，不会更糟。
 *
 * ⚠️ 换路提示**不单独发帧**：独立一帧没有 `completed/percent`，渲染层会把它读成 0%
 * （进度条跳回起点）。改为把 `switchedFrom` 挂在换路后的第一帧上。
 */
async function runModelDownload(
  cfg: LocalEmbeddingConfig,
  send: (frame: ProgressFrame) => void,
): Promise<void> {
  let switchedFrom: string | undefined

  // 智能下载按契约不抛；万一抛了也必须回退——新路径崩掉不能把用户的老路径一并堵死
  let smart: Awaited<ReturnType<typeof installModel>>
  try {
    smart = await installModel(
      {
        transport: createElectronTransport(),
        proxy: readProxyConfig(),
        listModels: () => listOllamaModels(cfg.baseUrl),
        log: (message) => logger.info('Embedding', `smart download: ${message}`),
      },
      {
        name: cfg.model,
        onSwitch: (from) => { switchedFrom = from.label },
        onProgress: (p) => {
          send({
            status: 'downloading',
            completed: p.completed,
            total: p.total,
            percent: p.total > 0 ? Math.round((p.completed / p.total) * 100) : undefined,
            path: p.pathId,
            pathLabel: p.pathLabel,
            bytesPerSec: p.bytesPerSec,
            switchedFrom,
          })
          switchedFrom = undefined
        },
      },
    )
  } catch (e) {
    logger.warn('Embedding', `smart download crashed: ${safeErrorMessage(e)}`)
    smart = { success: false, error: safeErrorMessage(e) }
  }

  if (smart.success) {
    logger.info('Embedding', `smart download finished via ${smart.usedPath?.label ?? 'unknown'}`)
    send({ status: 'success' })
    return
  }

  logger.warn('Embedding', `smart download failed, falling back to ollama pull: ${smart.error ?? 'unknown'}`)
  const fallback = await pullModel(cfg.baseUrl, cfg.model, send)
  if (!fallback.success) send({ status: 'error', error: fallback.error ?? '' })
}

/**
 * 过滤写回的补丁：只接受声明类型的字段。
 * 非法值一律**丢弃**而不是写进 config.json（例如 `enabled: "yes"` → 不落盘，
 * 读侧本来也会按严格真值回退，但配置保持干净便于人工排查）。
 */
function sanitizeLocalEmbeddingPatch(patch: Partial<LocalEmbeddingConfig>): Partial<LocalEmbeddingConfig> {
  const clean: Partial<LocalEmbeddingConfig> = {}
  if (typeof patch.enabled === 'boolean') clean.enabled = patch.enabled
  if (typeof patch.preferLocal === 'boolean') clean.preferLocal = patch.preferLocal
  if (typeof patch.baseUrl === 'string' && patch.baseUrl.trim() !== '') clean.baseUrl = patch.baseUrl.trim()
  if (typeof patch.model === 'string' && patch.model.trim() !== '') clean.model = patch.model.trim()
  return clean
}

export function registerLocalEmbeddingController(): void {
  /** 探测 Ollama 是否可用（三态不抛，返回其原始结构） */
  guardedHandle('embedding:local-detect', async () => {
    return detectOllama(readLocalEmbeddingConfig().baseUrl)
  })

  /** 列出本地已安装模型 */
  guardedHandle('embedding:local-list-models', async () => {
    return listOllamaModels(readLocalEmbeddingConfig().baseUrl)
  })

  /** 用配置的模型实测一次向量化 → 返回真实维度（设置页「测试」按钮） */
  guardedHandle('embedding:local-test', async () => {
    const cfg = readLocalEmbeddingConfig()
    try {
      const vectors = await embedLocal([TEST_TEXT], cfg.baseUrl, cfg.model)
      const dim = vectors[0]?.length ?? 0
      // 0 维不是「可用维度」（空响应另有 throw 契约，这里是兜底；不能报 success 误导设置页）
      if (dim <= 0) return { success: false, error: t('error.localEmbeddingEmptyVector') }
      return { success: true, dim }
    } catch (e) {
      // T2 契约：embedLocal 的错误串为英文技术描述 → 只落日志；对设置页沿用既有
      // `embedding:test-llm` 的口径（safeErrorMessage 直出，便于用户诊断失败原因）
      logger.warn('Embedding', `local embedding test failed: ${safeErrorMessage(e)}`)
      return { success: false, error: safeErrorMessage(e) }
    }
  })

  /** 拉取/更新模型：仅发起、立即返回；进度经 `embedding:local-pull-progress` 推送 */
  guardedHandle('embedding:local-pull', async (event) => {
    const cfg = readLocalEmbeddingConfig()
    // 防御分支：readLocalEmbeddingConfig 已逐字段回退默认值，正常路径不会命中；
    // 保留它是因为「向空 URL 发起下载」的代价远大于多一个分支
    if (!cfg.baseUrl || !cfg.model) {
      return { started: false, error: t('error.localEmbeddingNotConfigured') }
    }

    const key = `${cfg.baseUrl}|${cfg.model}`
    if (pullsInFlight.has(key)) {
      return { started: false, error: t('error.localPullInProgress') }
    }
    pullsInFlight.add(key)

    /**
     * 终态失败帧（FW-1）：`pullModel` 只把失败写进返回值 / reject，**从不 emit error 帧**
     * （ollama-embedding.ts:174-177 消费掉 `{"error"}` 后直接 return），若不在这里补发，
     * 「下载中途失败」对渲染层完全不可见 —— 进度条永久停在最后一帧、下载按钮永久 disabled。
     * 渲染层可能已关闭 → send 会抛；与进度帧同样的容忍（失败只落日志，不影响下载收尾）。
     */
    const sendTerminalError = (error: string): void => {
      try {
        event.sender.send('embedding:local-pull-progress', { status: 'error', error })
      } catch (e) {
        logger.warn('Embedding', `pull error frame send failed: ${safeErrorMessage(e)}`)
      }
    }

    /** 渲染层可能已关闭 → send 会抛；进度只是信息，不能让它影响下载本身 */
    const send = (frame: ProgressFrame): void => {
      try {
        event.sender.send('embedding:local-pull-progress', frame)
      } catch (e) {
        logger.warn('Embedding', `pull progress send failed: ${safeErrorMessage(e)}`)
      }
    }

    void runModelDownload(cfg, send)
      .catch((e) => {
        logger.warn('Embedding', `pull model crashed: ${safeErrorMessage(e)}`)
        sendTerminalError(safeErrorMessage(e))
      })
      .finally(() => {
        pullsInFlight.delete(key)
      })

    return { started: true }
  })

  /** 读本地向量档配置（主进程已回退默认值 → 返回值恒为完整配置） */
  guardedHandle('embedding:local-get-config', async () => {
    return readLocalEmbeddingConfig()
  })

  /** 写本地向量档配置（部分更新，合并写回；不覆盖其它全局配置字段） */
  guardedHandle('embedding:local-set-config', async (_event, config?: Partial<LocalEmbeddingConfig>) => {
    try {
      const existing = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
      // 以**归一化后的读值**为基准（顺带修复配置里的非法/缺失字段），再叠加过滤后的补丁
      const merged: LocalEmbeddingConfig = {
        ...readLocalEmbeddingConfig(),
        ...sanitizeLocalEmbeddingPatch(config ?? {}),
      }
      writeJsonFile(GLOBAL_CONFIG_PATH, { ...existing, localEmbedding: merged })
      return { success: true }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })
}
