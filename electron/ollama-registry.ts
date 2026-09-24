/**
 * 智能模型下载 — registry 协议层（零 electron 依赖，注入 Transport）
 *
 * Ollama 的模型库是一个**内容寻址的目录约定**（2026-09-25 实测：注册表返回的 manifest
 * 与本地已安装的 manifest 逐字节一致）：
 * - 权重按 `sha256-<hex>` 落在 `{OLLAMA_MODELS}/blobs/`
 * - manifest 原样落在 `{OLLAMA_MODELS}/manifests/registry.ollama.ai/library/<name>/<tag>`
 *
 * digest 即文件名 ⇒ 校验、去重、续传都是白送的。本模块负责：
 * - 拉 manifest（匿名可读，实测 200）
 * - 下 blob：Range 续传 + 流式 sha256 + 停滞/连续错误换路
 *
 * 约束：不 import electron（保持可在 CI 无 electron 二进制下直接单测）；
 * 传输由调用方注入（生产环境见 `net/electron-net-transport.ts`）。
 */

import { createHash } from 'node:crypto'
import { closeSync, existsSync, openSync, readSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { decideSwitch, PROBE_BYTES, scoreProbe, type NetPath } from './net-path'

/** 进度上报节流：1.2 GB 按 64 KiB 分块约 1.9 万个 chunk，逐块上报会灌爆 IPC */
const PROGRESS_INTERVAL_MS = 300

/** 单次请求的错误详情截断（远端 body 可能很长） */
const ERROR_DETAIL_MAX = 200

/**
 * 一次「失败的尝试」至少要拿到这么多字节，才算这条路径仍在有效推进。
 *
 * ⚠️ 不能用「收到过任何字节就重置错误计数」——实测踩坑：流被截断时每次重试都能收到
 * 少量字节，错误计数被反复清零 → **无限重试**，且文件每轮都在增长（把测试 worker 撑爆）。
 *
 * 有了这条下界，终止性可证：每次尝试要么拿到 ≥1 MiB（最多 `总大小 / 1 MiB` 次），
 * 要么计入错误（最多 `MAX_PATH_ERRORS × (MAX_SWITCHES+1)` 次），二者不会同时不满足。
 */
const MIN_ATTEMPT_PROGRESS = 1024 * 1024

export interface TransportResponse {
  status: number
  headers: Record<string, string | undefined>
  body: AsyncIterable<Uint8Array>
}

export interface Transport {
  request(url: string, opts: {
    headers?: Record<string, string>
    signal?: AbortSignal
    path: NetPath
  }): Promise<TransportResponse>
}

export interface ManifestLayer {
  mediaType: string
  digest: string
  size: number
}

export interface RegistryManifest {
  schemaVersion: number
  mediaType?: string
  config: ManifestLayer
  layers: ManifestLayer[]
}

// ===== URL 与命名 =====

export function registryManifestUrl(name: string, tag: string): string {
  return `https://registry.ollama.ai/v2/library/${name}/manifests/${tag}`
}

export function registryBlobUrl(name: string, digest: string): string {
  return `https://registry.ollama.ai/v2/library/${name}/blobs/${digest}`
}

/** `sha256:ab…` → `sha256-ab…`（Ollama 的落盘命名：冒号换连字符） */
export function digestToBlobName(digest: string): string {
  return digest.replace(':', '-')
}

/** `sha256:ab…` → `ab…`（比对用的小写 hex） */
function digestHex(digest: string): string {
  return digest.slice(digest.indexOf(':') + 1).toLowerCase()
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function sanitize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, ERROR_DETAIL_MAX)
}

// ===== manifest =====

function asLayer(value: unknown): ManifestLayer | null {
  if (!value || typeof value !== 'object') return null
  const { mediaType, digest, size } = value as { mediaType?: unknown; digest?: unknown; size?: unknown }
  if (typeof digest !== 'string' || digest === '') return null
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return null
  return { mediaType: typeof mediaType === 'string' ? mediaType : '', digest, size }
}

/**
 * 解析 manifest。**畸形一律返回 null（不抛）**：调用方据此回退 Ollama 自身 pull，
 * 而不是拿半个 manifest 去写坏模型库。
 */
export function parseManifest(text: string): RegistryManifest | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null

  const { schemaVersion, mediaType, config, layers } = raw as Record<string, unknown>
  if (typeof schemaVersion !== 'number') return null
  const parsedConfig = asLayer(config)
  if (!parsedConfig) return null
  if (!Array.isArray(layers) || layers.length === 0) return null
  const parsedLayers: ManifestLayer[] = []
  for (const entry of layers) {
    const layer = asLayer(entry)
    if (!layer) return null
    parsedLayers.push(layer)
  }

  return {
    schemaVersion,
    mediaType: typeof mediaType === 'string' ? mediaType : undefined,
    config: parsedConfig,
    layers: parsedLayers,
  }
}

/** 按候选路径顺序读取响应体（失败只影响本条候选） */
async function readBody(body: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of body) {
    const buf = Buffer.from(chunk)
    chunks.push(buf)
    total += buf.length
    // manifest 只有几百字节；给个上限防畸形响应把内存灌爆
    if (total > 1024 * 1024) throw new Error('manifest response too large')
  }
  return Buffer.concat(chunks).toString('utf8')
}

export interface FetchManifestResult {
  success: boolean
  manifest?: RegistryManifest
  /** 原始响应文本——落盘必须**原样写入**（解析再序列化会改变字节，Ollama 会校验失败） */
  raw?: string
  path?: NetPath
  error?: string
}

/** 取 manifest：候选路径按序试，任一成功即返回（小请求，不做测速） */
export async function fetchManifest(
  transport: Transport,
  opts: { name: string; tag: string; paths: NetPath[]; signal?: AbortSignal },
): Promise<FetchManifestResult> {
  const url = registryManifestUrl(opts.name, opts.tag)
  let lastError = ''
  for (const path of opts.paths) {
    try {
      const res = await transport.request(url, { path, signal: opts.signal })
      if (res.status !== 200) {
        lastError = `manifest HTTP ${res.status}`
        continue
      }
      const raw = await readBody(res.body)
      const manifest = parseManifest(raw)
      if (!manifest) {
        lastError = 'manifest 响应畸形'
        continue
      }
      return { success: true, manifest, raw, path }
    } catch (e) {
      lastError = sanitize(describeError(e))
    }
  }
  return { success: false, error: lastError || '所有网络路径均不可用' }
}

// ===== blob 下载 =====

/** 把已有前缀喂进 hasher（续传时不能跳过后半段的完整性） */
function primeHash(hash: ReturnType<typeof createHash>, filePath: string, bytes: number): boolean {
  const buf = Buffer.alloc(1 << 20)
  let fd: number | undefined
  try {
    fd = openSync(filePath, 'r')
    let read = 0
    while (read < bytes) {
      const n = readSync(fd, buf, 0, Math.min(buf.length, bytes - read), read)
      if (n <= 0) return false
      hash.update(buf.subarray(0, n))
      read += n
    }
    return read === bytes
  } catch {
    return false
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/** 从 content-range（`bytes 0-99/1000`）里取总长 */
function totalFromContentRange(value: string | undefined): number | undefined {
  const m = value?.match(/\/(\d+)\s*$/)
  if (!m) return undefined
  const total = Number(m[1])
  return Number.isFinite(total) && total > 0 ? total : undefined
}

export interface BlobProgress {
  completed: number
  total?: number
  /** 距上次上报之间的实测速率（换路后重新起算，不掺旧路径的均值） */
  bytesPerSec?: number
  path: NetPath
}

export interface DownloadBlobResult {
  success: boolean
  usedPath?: NetPath
  bytesWritten?: number
  error?: string
}

/**
 * 下载单个 blob 到 `destPath`。
 *
 * - **续传**：`destPath` 已有内容时自动从文件实际大小发 `Range`（断点即文件大小，唯一真源）
 * - **服务端忽略 Range 返回 200** → 丢弃已有前缀从头写（拼接错位比重下更贵）
 * - **校验**：流式 sha256，不符 → 删除文件并失败（绝不让坏 blob 进模型库）
 * - **换路**：停滞 / 连续错误达上限 → 换下一条候选并续传；换路超限或候选耗尽 → `{success:false}`
 *
 * 失败一律不抛（返回值表达），由调用方决定回退策略。
 */
export async function downloadBlob(
  transport: Transport,
  opts: {
    url: string
    destPath: string
    digest: string
    paths: NetPath[]
    expectedSize?: number
    stallTimeoutMs?: number
    onProgress?: (p: BlobProgress) => void
    onSwitch?: (from: NetPath, to: NetPath, reason: 'stall' | 'errors') => void
    signal?: AbortSignal
  },
): Promise<DownloadBlobResult> {
  const expectedHex = digestHex(opts.digest)
  const stallTimeoutMs = opts.stallTimeoutMs ?? 20_000
  const candidates = opts.paths.length > 0 ? opts.paths : []
  if (candidates.length === 0) return { success: false, error: '无可用网络路径' }

  let written = existsSync(opts.destPath) ? statSync(opts.destPath).size : 0
  let hash = createHash('sha256')
  if (written > 0 && !primeHash(hash, opts.destPath, written)) {
    // 前缀读不全（文件被截断/权限问题）→ 干净重来，不带着可疑前缀继续
    written = 0
    hash = createHash('sha256')
  }

  let pathIndex = 0
  let triedCount = 1
  let consecutiveErrors = 0
  let lastProgressAt = 0
  let lastProgressBytes = written

  const emit = (path: NetPath, force: boolean): void => {
    if (!opts.onProgress) return
    const now = Date.now()
    if (!force && now - lastProgressAt < PROGRESS_INTERVAL_MS) return
    const elapsed = now - lastProgressAt
    const bytesPerSec = lastProgressAt > 0 && elapsed > 0
      ? Math.round(((written - lastProgressBytes) / elapsed) * 1000)
      : undefined
    lastProgressAt = now
    lastProgressBytes = written
    try {
      opts.onProgress({ completed: written, total: opts.expectedSize, bytesPerSec, path })
    } catch {
      // 进度只是信息，回调异常不得影响下载本身
    }
  }

  let lastError = ''
  for (;;) {
    const path = candidates[pathIndex]
    const controller = new AbortController()
    const onOuterAbort = (): void => controller.abort()
    opts.signal?.addEventListener('abort', onOuterAbort, { once: true })

    let stalled = false
    let lastByteAt = Date.now()
    const attemptStartBytes = written
    const checker = setInterval(() => {
      if (Date.now() - lastByteAt >= stallTimeoutMs) {
        stalled = true
        controller.abort()
      }
    }, Math.max(10, Math.floor(stallTimeoutMs / 4)))

    try {
      const headers: Record<string, string> = {}
      if (written > 0) headers.Range = `bytes=${written}-`

      const res = await transport.request(opts.url, { headers, path, signal: controller.signal })
      if (res.status !== 200 && res.status !== 206) {
        throw new Error(`blob HTTP ${res.status}`)
      }

      const total = opts.expectedSize ?? totalFromContentRange(res.headers['content-range'])
      if (written > 0 && res.status === 200) {
        // 服务端忽略了 Range：已有前缀作废，从头写
        written = 0
        hash = createHash('sha256')
        lastProgressBytes = 0
      }

      const fd = openSync(opts.destPath, written > 0 ? 'a' : 'w')
      try {
        for await (const chunk of res.body) {
          const buf = Buffer.from(chunk)
          writeSync(fd, buf)
          hash.update(buf)
          written += buf.length
          lastByteAt = Date.now()
          emit(path, false)
        }
      } finally {
        closeSync(fd)
      }

      if (total !== undefined && written < total) {
        throw new Error(`blob 流被截断：${written}/${total}`)
      }
      break
    } catch (e) {
      lastError = sanitize(describeError(e))
      // 本轮拿到足够字节 = 路径仍在有效推进 → 不计入错误（长下载偶发掉线可无限续传）
      if (written - attemptStartBytes < MIN_ATTEMPT_PROGRESS) consecutiveErrors++
      const decision = decideSwitch({
        stalled,
        consecutiveErrors,
        triedCount,
        totalCandidates: candidates.length,
      })
      if (decision.exhausted) {
        emit(path, true)
        return { success: false, usedPath: path, bytesWritten: written, error: lastError }
      }
      if (decision.switch) {
        const next = pathIndex + 1
        if (next >= candidates.length) {
          return { success: false, usedPath: path, bytesWritten: written, error: lastError }
        }
        try {
          opts.onSwitch?.(candidates[pathIndex], candidates[next], stalled ? 'stall' : 'errors')
        } catch {
          // 同上：回调异常不影响下载
        }
        pathIndex = next
        triedCount++
        consecutiveErrors = 0
      }
      // 未达阈值 → 原路径重试（循环继续，written 已是最新断点）
    } finally {
      clearInterval(checker)
      opts.signal?.removeEventListener('abort', onOuterAbort)
    }
  }

  const usedPath = candidates[pathIndex]
  emit(usedPath, true)

  if (hash.digest('hex') !== expectedHex) {
    // 坏 blob 进模型库 = 之后所有推理静默出错，宁可失败重下
    try {
      unlinkSync(opts.destPath)
    } catch {
      // 删不掉也只能失败上报，不能返回成功
    }
    return { success: false, usedPath, bytesWritten: written, error: 'blob sha256 校验不符' }
  }

  return { success: true, usedPath, bytesWritten: written }
}

// ===== 路径测速 =====

/**
 * 对**真实 blob** 发一次 Range 请求测吞吐（延迟 ≠ 吞吐，本机瓶颈正是吞吐）。
 * 返回 `bytesPerSec`；拿不到字节 / 超时 / 报错 → `null`（由 `scoreProbe` 的口径决定）。
 *
 * 探测字节丢弃：成本约 2 MiB/候选，对 GB 级模型可忽略；换来的是「选路真的按实测走」。
 */
export async function probePath(
  transport: Transport,
  url: string,
  path: NetPath,
  opts?: { maxBytes?: number; timeoutMs?: number },
): Promise<number | null> {
  const maxBytes = opts?.maxBytes ?? PROBE_BYTES
  const timeoutMs = opts?.timeoutMs ?? 8_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()
  let received = 0
  try {
    const res = await transport.request(url, {
      headers: { Range: `bytes=0-${maxBytes - 1}` },
      path,
      signal: controller.signal,
    })
    if (res.status !== 200 && res.status !== 206) return null
    for await (const chunk of res.body) {
      received += chunk.length
      if (received >= maxBytes) break
    }
  } catch {
    // 超时/连接错误 → 该路径探测失败（null），不代表下载一定不可用
  } finally {
    clearTimeout(timer)
  }
  return scoreProbe(received, Date.now() - startedAt)
}
