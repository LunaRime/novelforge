/**
 * IPC 调用指标 — 开发控制台专用，默认关闭。
 *
 * 只在 guardedHandle 的成功/失败路径各记一次；关闭时记录函数立即返回。
 * recent 环上限 500，避免长跑内存增长；错误文本先脱敏再截断。
 */

export interface DevIpcMetric {
  channel: string
  calls: number
  errors: number
  totalMs: number
  lastMs: number
  avgMs: number
  lastAt: number
  lastError?: string
}

export interface DevIpcRecentCall {
  channel: string
  at: number
  durationMs: number
  ok: boolean
  error?: string
}

const RECENT_LIMIT = 500
const ERROR_LIMIT = 300

const aggregate = new Map<string, DevIpcMetric>()
const recent: DevIpcRecentCall[] = []
let enabled = process.env.NOVELFORGE_DEVTOOLS === '1'

export function setIpcMetricsEnabled(value: boolean): void {
  enabled = value
}

export function isIpcMetricsEnabled(): boolean {
  return enabled
}

/** 密钥/令牌脱敏（日志与错误详情展示前必须经过） */
export function redactSecrets(text: string): string {
  if (!text) return ''
  return text
    // Authorization 整行值（含 Basic/Bearer scheme 与凭据）
    .replace(/\b(authorization|proxy-authorization)\s*[:=]\s*[^\r\n,;}]+/gi, '$1=***')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 ***')
    .replace(/\bsk-[A-Za-z0-9._-]{8,}\b/g, 'sk-***')
    // JSON 引号值 / 常见字段名 / access_token 等下划线变体
    .replace(
      /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|x-api-key|token|password|key)\b(\s*["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi,
      '$1$2***',
    )
    // URL query 中的 key/token
    .replace(/([?&](?:key|token|api[_-]?key|access[_-]?token|refresh[_-]?token)=)[^&#\s]+/gi, '$1***')
}

function errorText(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined
  const raw = error instanceof Error ? error.message : String(error)
  return redactSecrets(raw).slice(0, ERROR_LIMIT)
}

export function recordIpcCall(channel: string, durationMs: number, error?: unknown): void {
  if (!enabled) return
  // 指标自身的读取/清空不参与统计，避免控制台轮询把数据刷成噪声
  if (channel.startsWith('dev:ipc-')) return

  const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0
  const message = errorText(error)
  const at = Date.now()

  const current = aggregate.get(channel) ?? {
    channel,
    calls: 0,
    errors: 0,
    totalMs: 0,
    lastMs: 0,
    avgMs: 0,
    lastAt: 0,
  }
  current.calls += 1
  current.errors += message ? 1 : 0
  current.totalMs += duration
  current.lastMs = duration
  current.avgMs = current.calls > 0 ? current.totalMs / current.calls : 0
  current.lastAt = at
  if (message) current.lastError = message
  aggregate.set(channel, current)

  recent.push({
    channel,
    at,
    durationMs: duration,
    ok: !message,
    ...(message ? { error: message } : {}),
  })
  if (recent.length > RECENT_LIMIT) recent.splice(0, recent.length - RECENT_LIMIT)
}

export function getIpcMetrics(): { metrics: DevIpcMetric[]; recent: DevIpcRecentCall[] } {
  return {
    metrics: [...aggregate.values()].sort((a, b) => b.totalMs - a.totalMs),
    recent: [...recent],
  }
}

export function clearIpcMetrics(): void {
  aggregate.clear()
  recent.length = 0
}