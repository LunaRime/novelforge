/**
 * Ollama 本地向量档 — 主进程 HTTP 客户端（纯 fetch，零新依赖）
 *
 * 用途（T3/T4/T5 消费）：
 * - detectOllama：本地 Ollama 健康检查 / 版本探测（三态返回，不抛）
 * - listOllamaModels：已装模型列表（`:latest` 规范化 + 去重 + 排序，异常 → []）
 * - pullModel：拉取模型，NDJSON 流式进度回调（长任务 300s 超时）
 * - embedLocal：`/api/embed` 批量向量化（与输入同序；失败 throw 供降级链捕获）
 *
 * 约束：无状态、纯 HTTP、不 import electron（保持可在 CI 无 electron 二进制下直接单测）。
 * 错误信息一律结构化返回 / 英文（用户可见文案由渲染层 i18n 负责，见 T5）。
 */

import { fetchWithTimeout } from './embedding'

/** 拉模型是分钟级长任务——默认 10s 超时会把大模型 pull 腰斩（T1 导出 fetchWithTimeout 的动机） */
const PULL_TIMEOUT_MS = 300_000

/** 错误详情截断长度（远端/本地 body 可能很长，避免日志与 IPC 载荷被灌爆） */
const ERROR_DETAIL_MAX = 200

/** baseUrl + path 拼接（容忍用户填写的尾斜杠，避免 `//api/version`） */
function apiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

/** 未知异常 → 可读 message（AbortError / TypeError('fetch failed') 等） */
function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** 单行化 + 截断（错误详情可能含换行/超长 body） */
function sanitize(text: string, max: number = ERROR_DETAIL_MAX): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max)
}

/** 读取错误响应体（失败时退化为空串，不让二次异常覆盖主错误） */
async function safeText(res: Response): Promise<string> {
  try {
    return sanitize(await res.text())
  } catch {
    return ''
  }
}

// ===== 健康检查 / 版本 =====

/**
 * 探测本地 Ollama 是否可用。
 * 三态**不抛**：可用 → `{ok:true, version}`；连接拒绝 / 非 200 / 响应畸形 → `{ok:false, error}`。
 */
export async function detectOllama(baseUrl: string): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const res = await fetchWithTimeout(apiUrl(baseUrl, '/api/version'), { method: 'GET' })
    if (!res.ok) {
      return { ok: false, error: `Ollama /api/version failed: HTTP ${res.status}` }
    }
    const data = await res.json() as { version?: unknown } | null
    const version = data && typeof data.version === 'string' ? data.version : undefined
    return version ? { ok: true, version } : { ok: true }
  } catch (e) {
    return { ok: false, error: describeError(e) }
  }
}

// ===== 已装模型列表 =====

/** Ollama 的 `:latest` 是默认 tag 别名——保留会让 `bge-m3` 与 `bge-m3:latest` 在配置里重复 */
function normalizeModelName(name: string): string {
  return name.replace(/:latest$/, '')
}

/**
 * 列出本地已装模型（规范化 `:latest` + 去重 + 按 name 升序，size 取首次出现的值）。
 * 空 / 畸形 / 非 200 / 连接失败 → `[]`（**不抛**：列表只服务 UI 下拉，失败等价于"没有可选模型"）。
 */
export async function listOllamaModels(baseUrl: string): Promise<Array<{ name: string; size: number }>> {
  try {
    const res = await fetchWithTimeout(apiUrl(baseUrl, '/api/tags'), { method: 'GET' })
    if (!res.ok) return []

    const data = await res.json() as { models?: unknown } | null
    const models = data?.models
    if (!Array.isArray(models)) return []

    const deduped = new Map<string, number>()
    for (const entry of models) {
      if (!entry || typeof entry !== 'object') continue
      const { name, size } = entry as { name?: unknown; size?: unknown }
      if (typeof name !== 'string' || name.length === 0) continue
      const normalized = normalizeModelName(name)
      if (!normalized || deduped.has(normalized)) continue
      deduped.set(normalized, typeof size === 'number' && Number.isFinite(size) ? size : 0)
    }

    return [...deduped.entries()]
      .map(([name, size]) => ({ name, size }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  } catch {
    return []
  }
}

// ===== 拉取模型（NDJSON 流式进度） =====

/** `/api/pull` 单帧进度（percent 仅在 completed/total 均就绪且 total > 0 时给出） */
export interface PullProgress {
  status: string
  completed?: number
  total?: number
  percent?: number
}

/**
 * 拉取 / 更新本地模型，NDJSON 流式上报进度。
 * 返回结构化结果（不抛）：失败帧 / 非 200 / 超时 / 流截断 → `{success:false, error}`。
 */
export async function pullModel(
  baseUrl: string,
  model: string,
  onProgress?: (p: PullProgress) => void,
): Promise<{ success: boolean; error?: string }> {
  let res: Response
  try {
    res = await fetchWithTimeout(apiUrl(baseUrl, '/api/pull'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
    }, PULL_TIMEOUT_MS)
  } catch (e) {
    return { success: false, error: describeError(e) }
  }

  if (!res.ok) {
    const detail = await safeText(res)
    return { success: false, error: `Ollama /api/pull failed: HTTP ${res.status}${detail ? ` ${detail}` : ''}` }
  }

  const reader = res.body?.getReader()
  if (!reader) {
    return { success: false, error: 'Ollama /api/pull response has no body stream' }
  }

  const decoder = new TextDecoder()
  let buffer = '' // 跨 read 边界的行缓冲（照 llm/openai-provider.ts 的 SSE 解析模式）
  let sawTerminalSuccess = false
  let failure: string | undefined

  /** 上报一帧（回调异常不得影响下载本身：renderer 已关闭时 onProgress 可能抛） */
  const emit = (progress: PullProgress): void => {
    if (!onProgress) return
    try {
      onProgress(progress)
    } catch (e) {
      console.warn('[ollama] pull progress callback failed:', describeError(e))
    }
  }

  /** 解析单行 NDJSON：空行跳过；非法 JSON → warn 跳过（不炸整条流） */
  const handleLine = (line: string): void => {
    const trimmed = line.trim()
    if (!trimmed) return

    let frame: { status?: unknown; completed?: unknown; total?: unknown; error?: unknown }
    try {
      frame = JSON.parse(trimmed) as typeof frame
    } catch {
      console.warn('[ollama] skip malformed NDJSON line:', trimmed.slice(0, ERROR_DETAIL_MAX))
      return
    }
    if (!frame || typeof frame !== 'object') return

    // 失败帧：Ollama 在拉取失败时给出 {"error":"..."}（无 status）
    if (typeof frame.error === 'string' && frame.error) {
      failure = frame.error
      return
    }

    const status = typeof frame.status === 'string' ? frame.status : ''
    if (status === 'success') sawTerminalSuccess = true
    if (!status) return

    const progress: PullProgress = { status }
    if (typeof frame.completed === 'number') progress.completed = frame.completed
    if (typeof frame.total === 'number') progress.total = frame.total
    if (typeof frame.completed === 'number' && typeof frame.total === 'number' && frame.total > 0) {
      progress.percent = Math.round((frame.completed / frame.total) * 100)
    }
    emit(progress)
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n')
      buffer = parts.pop() ?? '' // 残行留到下一个 chunk（跨 chunk 的半个 JSON 行）
      for (const line of parts) {
        handleLine(line)
        if (failure) break
      }
      if (failure) break
    }

    // 流结束：flush 残留行（末行通常没有尾随 \n）
    if (!failure && buffer.trim()) handleLine(buffer)
  } catch (e) {
    return { success: false, error: describeError(e) }
  } finally {
    if (failure) {
      // 失败帧后主动取消流：不继续消费剩余 chunk，也不让连接悬挂
      void reader.cancel().catch(() => {})
    }
  }

  if (failure) {
    return { success: false, error: `Ollama /api/pull failed: ${sanitize(failure)}` }
  }
  if (!sawTerminalSuccess) {
    // 流正常结束却无终帧 = 截断（代理/超时切断）——不能当成功上报，否则用户以为模型已就绪
    return { success: false, error: 'Ollama /api/pull stream ended before completion' }
  }
  return { success: true }
}

// ===== 本地向量化 =====

/**
 * 归一化 `/api/embed` 响应为向量数组。
 * 主形状：`{embeddings: number[][]}`；兼容 OpenAI 形状 `{data:[{embedding,index}]}`
 * （必要时按 index 排序，保证与输入同序）。无法解析 → null。
 */
function normalizeEmbeddings(data: { embeddings?: unknown; data?: unknown } | null): number[][] | null {
  const raw: unknown[] | null = Array.isArray(data?.embeddings) && data.embeddings.length > 0
    ? data.embeddings
    : (Array.isArray(data?.data) && data.data.length > 0 ? data.data : null)
  if (!raw) return null

  const entries: Array<{ vector: number[]; index?: number }> = []
  for (const entry of raw) {
    if (Array.isArray(entry)) {
      if (!entry.every((n) => typeof n === 'number')) return null
      entries.push({ vector: entry as number[] })
      continue
    }
    if (!entry || typeof entry !== 'object') return null
    const { embedding, index } = entry as { embedding?: unknown; index?: unknown }
    if (!Array.isArray(embedding) || !embedding.every((n) => typeof n === 'number')) return null
    entries.push({ vector: embedding as number[], index: typeof index === 'number' ? index : undefined })
  }

  if (entries.length === 0) return null
  if (entries.every((e) => e.index !== undefined)) {
    entries.sort((a, b) => (a.index as number) - (b.index as number))
  }
  return entries.map((e) => e.vector)
}

/**
 * 本地批量向量化（`POST /api/embed`），返回与 `texts` **同序**的向量数组。
 * 失败一律 **throw**（非 200 / 响应畸形 / 空 / 数量不匹配 / 网络或超时）——
 * 供 T3 降级链捕获后回退到远程 Embedding API。
 */
export async function embedLocal(texts: string[], baseUrl: string, model: string): Promise<number[][]> {
  if (texts.length === 0) return []

  const res = await fetchWithTimeout(apiUrl(baseUrl, '/api/embed'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: texts }),
  })

  if (!res.ok) {
    const detail = await safeText(res)
    throw new Error(`Ollama /api/embed failed: HTTP ${res.status}${detail ? ` ${detail}` : ''}`)
  }

  let data: { embeddings?: unknown; data?: unknown } | null
  try {
    data = await res.json() as { embeddings?: unknown; data?: unknown } | null
  } catch (e) {
    throw new Error(`Ollama /api/embed returned invalid JSON: ${describeError(e)}`)
  }

  const vectors = normalizeEmbeddings(data)
  if (!vectors) {
    throw new Error('Ollama /api/embed response contains no embeddings')
  }
  if (vectors.length !== texts.length) {
    // 静默错位会让检索结果与文本张冠李戴，必须显式失败
    throw new Error(`Ollama /api/embed returned ${vectors.length} vector(s) for ${texts.length} input(s)`)
  }

  return vectors
}
