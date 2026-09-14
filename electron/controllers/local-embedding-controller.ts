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
import type { GlobalConfig, LocalEmbeddingConfig } from '../../src/shared/ipc-channels'
import {
  DEFAULT_GLOBAL_CONFIG,
  GLOBAL_CONFIG_PATH,
  readJsonFile,
  readLocalEmbeddingConfig,
  writeJsonFile,
} from '../utils/config-utils'
import { detectOllama, listOllamaModels, pullModel, embedLocal } from '../ollama-embedding'
import { guardedHandle } from '../security/ipc-guard'
import { logger } from '../utils/logger'
import { safeErrorMessage } from '../utils/error-utils'

/** 测试用文本（与既有 `embedding:test-llm` 同字面量；是发给模型的输入，非用户可见文案） */
const TEST_TEXT = '测试文本'

/** 拉取中的 `<baseUrl>|<model>`：防连点 / 多窗口重复发起同一模型的下载（数 GB 级） */
const pullsInFlight = new Set<string>()

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

    void pullModel(cfg.baseUrl, cfg.model, (progress) => {
      // 渲染层可能已关闭 → send 会抛；进度只是信息，不能让它影响下载本身
      try {
        event.sender.send('embedding:local-pull-progress', progress)
      } catch (e) {
        logger.warn('Embedding', `pull progress send failed: ${safeErrorMessage(e)}`)
      }
    })
      .then((res) => {
        if (!res.success) logger.warn('Embedding', `pull model failed: ${res.error ?? 'unknown'}`)
      })
      .catch((e) => {
        logger.warn('Embedding', `pull model crashed: ${safeErrorMessage(e)}`)
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
