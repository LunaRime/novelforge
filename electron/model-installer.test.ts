/**
 * model-installer 模块测试（智能模型下载 T3：编排 + 落库 + 自检 + 回退）
 *
 * 契约（T4 依赖，签名锁定）：
 * - resolveModelsDir：OLLAMA_MODELS 优先，否则 ~/.ollama/models；空白值视为未设置
 * - installModel：下载 → 校验 → 原子落盘（blobs/ + manifests/）→ 自检 /api/tags
 * - blob 已存在且 size 相符 → 跳过下载（去重，多模型共享 layer 不重下）
 * - 自检失败（模型没出现在 Ollama 列表）⇒ **清理刚写的 manifest** 并返回失败
 *   ——「目录猜错」必须留下干净现场，不能污染真正的模型库
 * - 任何失败一律 {success:false}（不抛），由控制器回退 Ollama 自身 pull
 *
 * 说明：本模块不 import electron——注入 mock Transport，用真实临时目录验证落盘。
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NetPath } from './net-path'
import {
  installModel,
  resolveModelsDir,
  type InstallDeps,
} from './model-installer'
import type { Transport, TransportResponse } from './ollama-registry'

const MODEL = 'bge-m3'
const CONFIG_BLOB = Buffer.from('{"model_format":"gguf"}')
const WEIGHT_BLOB = Buffer.alloc(4096, 5)
const sha = (b: Buffer): string => `sha256:${createHash('sha256').update(b).digest('hex')}`

const manifestText = JSON.stringify({
  schemaVersion: 2,
  mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
  config: { mediaType: 'application/vnd.docker.container.image.v1+json', digest: sha(CONFIG_BLOB), size: CONFIG_BLOB.length },
  layers: [{ mediaType: 'application/vnd.ollama.image.model', digest: sha(WEIGHT_BLOB), size: WEIGHT_BLOB.length }],
})

/** 按 URL 分发的 mock Transport：manifest → JSON；blob → 对应字节 */
function makeTransport(overrides?: {
  onRequest?: (url: string, path: NetPath, headers?: Record<string, string>) => void
}): Transport {
  return {
    request: async (url, opts): Promise<TransportResponse> => {
      overrides?.onRequest?.(url, opts.path, opts.headers)
      let payload: Buffer
      if (url.includes('/manifests/')) payload = Buffer.from(manifestText)
      else if (url.includes(sha(WEIGHT_BLOB))) payload = WEIGHT_BLOB
      else if (url.includes(sha(CONFIG_BLOB))) payload = CONFIG_BLOB
      else return { status: 404, headers: {}, body: (async function* () {})() }
      return {
        status: 200,
        headers: { 'content-length': String(payload.length) },
        body: (async function* () { yield payload })(),
      }
    },
  }
}

describe('resolveModelsDir', () => {
  it('OLLAMA_MODELS 优先', () => {
    expect(resolveModelsDir({ OLLAMA_MODELS: 'E:\\models' }, 'C:\\Users\\x')).toBe('E:\\models')
  })

  it('未设置 / 空白 → ~/.ollama/models', () => {
    expect(resolveModelsDir({}, 'C:\\Users\\x')).toBe(join('C:\\Users\\x', '.ollama', 'models'))
    expect(resolveModelsDir({ OLLAMA_MODELS: '   ' }, 'C:\\Users\\x')).toBe(join('C:\\Users\\x', '.ollama', 'models'))
  })
})

describe('installModel', () => {
  let root: string
  let modelsDir: string
  let deps: InstallDeps

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vela-installer-'))
    modelsDir = join(root, 'models')
    deps = { transport: makeTransport(), modelsDir, listModels: async () => [{ name: MODEL }] }
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const blobPath = (digest: string): string => join(modelsDir, 'blobs', digest.replace(':', '-'))
  const manifestPath = (): string =>
    join(modelsDir, 'manifests', 'registry.ollama.ai', 'library', MODEL, 'latest')

  it('正常安装：blobs + manifest 落盘，manifest 原样写入，返回成功', async () => {
    const out = await installModel(deps, { name: MODEL })
    expect(out.success).toBe(true)
    expect(readFileSync(blobPath(sha(WEIGHT_BLOB))).equals(WEIGHT_BLOB)).toBe(true)
    expect(readFileSync(blobPath(sha(CONFIG_BLOB))).equals(CONFIG_BLOB)).toBe(true)
    // 原样写入（解析再序列化会改变字节，Ollama 的 digest 校验会因此失败）
    expect(readFileSync(manifestPath(), 'utf8')).toBe(manifestText)
  })

  it('blob 已存在且 size 相符 → 跳过下载（去重）', async () => {
    mkdirSync(join(modelsDir, 'blobs'), { recursive: true })
    writeFileSync(blobPath(sha(WEIGHT_BLOB)), WEIGHT_BLOB)
    writeFileSync(blobPath(sha(CONFIG_BLOB)), CONFIG_BLOB)
    // 判据：blob 请求**全都带 Range**（= 只是测速采样）。整包下载不带 Range，出现即为重下。
    const blobRequestsWithoutRange: string[] = []
    deps.transport = makeTransport({
      onRequest: (url, _path, headers) => {
        if (url.includes('/blobs/') && !headers?.Range) blobRequestsWithoutRange.push(url)
      },
    })

    const out = await installModel(deps, { name: MODEL })
    expect(out.success).toBe(true)
    expect(blobRequestsWithoutRange).toEqual([])
  })

  it('自检失败（模型未出现在 Ollama 列表）→ 清理 manifest 并失败', async () => {
    deps.listModels = async () => [] // 目录猜错：写进去了但 Ollama 不认
    const out = await installModel(deps, { name: MODEL })
    expect(out.success).toBe(false)
    expect(out.error).toContain('自检')
    expect(existsSync(manifestPath())).toBe(false) // 现场必须干净
  })

  it('模型目录不可创建 → 失败（不抛）', async () => {
    const blocked = join(root, 'blocked')
    writeFileSync(blocked, 'not a dir') // 同名文件占位 → mkdir 必失败
    const out = await installModel({ ...deps, modelsDir: blocked }, { name: MODEL })
    expect(out.success).toBe(false)
  })

  it('blob 下载失败 → 失败且不写 manifest', async () => {
    deps.transport = {
      request: async (url) => {
        if (url.includes('/manifests/')) {
          return { status: 200, headers: {}, body: (async function* () { yield Buffer.from(manifestText) })() }
        }
        throw new Error('unexpected EOF')
      },
    }
    const out = await installModel(deps, { name: MODEL })
    expect(out.success).toBe(false)
    expect(existsSync(manifestPath())).toBe(false)
  })

  it('代理启用 → 候选含代理；代理路径更快时 blob 走代理', async () => {
    const usedPaths: string[] = []
    deps.transport = makeTransport({ onRequest: (_url, path) => usedPaths.push(path.id) })
    deps.proxy = { enabled: true, host: '127.0.0.1', port: 7897 }

    const out = await installModel(deps, { name: MODEL })
    expect(out.success).toBe(true)
    expect(usedPaths).toContain('proxy')
  })

  it('进度上报带上当前路径；配置了代理时两条候选都会被探测', async () => {
    const probed = new Set<string>()
    const seen = new Set<string>()
    deps.transport = makeTransport({ onRequest: (url, path) => { if (url.includes('/blobs/')) probed.add(path.id) } })
    deps.proxy = { enabled: true, host: '127.0.0.1', port: 7897 }

    await installModel(deps, {
      name: MODEL,
      onProgress: (p) => seen.add(p.pathId),
    })
    expect(probed.size).toBeGreaterThan(1) // 直连与代理都被采样过
    expect(seen.size).toBeGreaterThan(0)
  })

  it('落盘的 blob 大小与 manifest 声明一致（不做半截安装）', async () => {
    await installModel(deps, { name: MODEL })
    expect(statSync(blobPath(sha(WEIGHT_BLOB))).size).toBe(WEIGHT_BLOB.length)
  })
})
