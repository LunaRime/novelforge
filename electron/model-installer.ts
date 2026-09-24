/**
 * 智能模型下载 — 编排与落库（零 electron 依赖，注入 Transport）
 *
 * 这是唯一知道「Ollama 模型库长什么样」的地方：
 * ```
 * {OLLAMA_MODELS}/
 * ├── blobs/sha256-<hex>                                     ← 内容寻址，digest 即文件名
 * ├── manifests/registry.ollama.ai/library/<name>/<tag>      ← 原样写入注册表返回的 manifest
 * └── .novelforge-staging/                                   ← 本模块的临时区（与 blobs 同卷）
 * ```
 *
 * 流程：定位目录 → 取 manifest → 测速选路 → 逐 blob（已存在即跳过）续传下载 + 校验
 * → 原子落盘 → 原样写 manifest → **自检 `/api/tags`**。
 *
 * 自检是「目录猜错」的唯一暴露点（应用读到的 OLLAMA_MODELS 未必等于运行中 Ollama 的）：
 * 模型没出现在列表里就清理刚写的 manifest 并失败——绝不能污染真正的模型库。
 *
 * 失败一律 `{success:false}`（不抛），由控制器回退到 Ollama 自身 pull。
 */

import { existsSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { safeErrorMessage } from './utils/error-utils'
import {
  buildPathCandidates,
  rankPaths,
  type NetPath,
  type PathProbe,
  type ProxyConfigLike,
} from './net-path'
import {
  digestToBlobName,
  downloadBlob,
  fetchManifest,
  probePath,
  registryBlobUrl,
  type ManifestLayer,
  type Transport,
} from './ollama-registry'

/** staging 与 blobs 同卷，`rename` 才是原子的；Ollama 不扫这个目录 */
const STAGING_DIR_NAME = '.novelforge-staging'

/** 模型名白名单：挡路径穿越（`../`、`/`）——名字最终会拼进文件系统路径 */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export interface InstallDeps {
  transport: Transport
  /** 候选路径的代理来源（与 GlobalConfig.proxy 同形） */
  proxy?: ProxyConfigLike
  /** 覆写模型目录；缺省按 `OLLAMA_MODELS` → `~/.ollama/models` 解析（测试注入临时目录） */
  modelsDir?: string
  /** 自检用：列出 Ollama 已装模型 */
  listModels: () => Promise<Array<{ name: string }>>
  log?: (message: string) => void
}

export interface InstallProgress {
  completed: number
  total: number
  bytesPerSec?: number
  pathId: NetPath['id']
  pathLabel: string
}

export interface InstallOptions {
  /** 模型名（不含 tag），如 `bge-m3` */
  name: string
  /** 默认 `latest` */
  tag?: string
  signal?: AbortSignal
  onProgress?: (p: InstallProgress) => void
  onSwitch?: (from: NetPath, to: NetPath, reason: 'stall' | 'errors') => void
}

export interface InstallResult {
  success: boolean
  error?: string
  usedPath?: NetPath
}

/**
 * 模型目录解析：`OLLAMA_MODELS` 优先，否则 `~/.ollama/models`。
 * 空白值等同未设置（`set OLLAMA_MODELS=` 这种残留不该把模型下到当前目录）。
 */
export function resolveModelsDir(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): string {
  const fromEnv = env.OLLAMA_MODELS?.trim()
  return fromEnv ? fromEnv : join(home, '.ollama', 'models')
}

/** `bge-m3:latest` 与 `bge-m3` 在自检时等价 */
function normalizeName(name: string): string {
  return name.replace(/:latest$/, '')
}

/**
 * 下载并安装一个模型到 Ollama 模型库。
 * 任何一步失败都返回 `{success:false}`，调用方据此回退到 `pullModel`（今天的行为）。
 */
export async function installModel(deps: InstallDeps, opts: InstallOptions): Promise<InstallResult> {
  const log = deps.log ?? ((): void => {})
  const tag = opts.tag ?? 'latest'

  if (!SAFE_NAME.test(opts.name) || !SAFE_NAME.test(tag)) {
    return { success: false, error: `模型名非法：${opts.name}:${tag}` }
  }

  const modelsDir = deps.modelsDir ?? resolveModelsDir()
  const blobsDir = join(modelsDir, 'blobs')
  const stagingDir = join(modelsDir, STAGING_DIR_NAME)
  try {
    mkdirSync(blobsDir, { recursive: true })
    mkdirSync(stagingDir, { recursive: true })
  } catch (e) {
    return { success: false, error: `模型目录不可写：${safeErrorMessage(e)}` }
  }

  // ===== 候选路径与 manifest =====
  const candidates = buildPathCandidates(deps.proxy)
  const manifestRes = await fetchManifest(deps.transport, {
    name: opts.name,
    tag,
    paths: candidates,
    signal: opts.signal,
  })
  if (!manifestRes.success || !manifestRes.manifest || !manifestRes.raw) {
    return { success: false, error: manifestRes.error ?? 'manifest 获取失败' }
  }
  const manifest = manifestRes.manifest
  const layers: ManifestLayer[] = [manifest.config, ...manifest.layers]

  // ===== 测速选路 =====
  // 串行而非并行：并发探测会互相抢带宽，测出来的排序是「两条路同时跑」的假象
  const probes: PathProbe[] = []
  const probeTarget = registryBlobUrl(opts.name, layers[0].digest)
  for (const path of candidates) {
    probes.push({ path, bytesPerSec: await probePath(deps.transport, probeTarget, path) })
  }
  const paths = rankPaths(probes)
  log(`选路：${probes.map((p) => `${p.path.label}=${p.bytesPerSec ?? '不可用'}`).join('，') || '无候选'}`)

  // ===== 逐 blob 下载 =====
  const grandTotal = layers.reduce((sum, l) => sum + l.size, 0)
  let completedBase = 0
  let usedPath: NetPath | undefined

  for (const layer of layers) {
    const blobName = digestToBlobName(layer.digest)
    const dest = join(blobsDir, blobName)
    const base = completedBase
    completedBase += layer.size

    // 去重：已装模型的共享 layer（config/license 常见）不重下
    if (existsSync(dest) && statSync(dest).size === layer.size) {
      log(`跳过已存在的 blob ${blobName}`)
      continue
    }

    const res = await downloadBlob(deps.transport, {
      url: registryBlobUrl(opts.name, layer.digest),
      destPath: join(stagingDir, blobName),
      digest: layer.digest,
      paths,
      expectedSize: layer.size,
      signal: opts.signal,
      onProgress: (p) => {
        opts.onProgress?.({
          completed: base + p.completed,
          total: grandTotal,
          bytesPerSec: p.bytesPerSec,
          pathId: p.path.id,
          pathLabel: p.path.label,
        })
      },
      onSwitch: opts.onSwitch,
    })
    if (!res.success) {
      // staging 残片保留（下次可从断点续传）；绝不留下半截的正式 blob
      return { success: false, error: res.error ?? `blob 下载失败：${blobName}` }
    }
    usedPath = res.usedPath

    try {
      renameSync(join(stagingDir, blobName), dest)
    } catch (e) {
      return { success: false, error: `blob 落盘失败：${safeErrorMessage(e)}` }
    }
  }

  // ===== manifest 原样落盘（解析再序列化会改变字节，Ollama 会因此校验失败）=====
  const manifestPath = join(modelsDir, 'manifests', 'registry.ollama.ai', 'library', opts.name, tag)
  try {
    mkdirSync(dirname(manifestPath), { recursive: true })
    const tmpPath = `${manifestPath}.novelforge-tmp`
    writeFileSync(tmpPath, manifestRes.raw)
    renameSync(tmpPath, manifestPath)
  } catch (e) {
    return { success: false, error: `写入 manifest 失败：${safeErrorMessage(e)}` }
  }

  // ===== 自检：目录猜错在这一步暴露 =====
  let installed: Array<{ name: string }> = []
  try {
    installed = await deps.listModels()
  } catch (e) {
    log(`自检列表读取失败：${safeErrorMessage(e)}`)
  }
  if (!installed.some((m) => normalizeName(m.name) === opts.name)) {
    try {
      unlinkSync(manifestPath)
    } catch {
      // 清理失败也只能上报失败——不能让调用方以为装好了
    }
    return {
      success: false,
      error: `自检失败：${opts.name} 未出现在 Ollama 模型列表中（模型目录可能与运行中的 Ollama 不一致）`,
    }
  }

  log(`模型 ${opts.name}:${tag} 安装完成`)
  return { success: true, usedPath }
}
