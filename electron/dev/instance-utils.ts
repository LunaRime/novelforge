import { t } from '../../src/shared/locale'
import type { DevInstanceInfo, DevInstanceStartInput } from '../../src/shared/ipc-channels'

export type StartInputValidation =
  | { ok: true; value: DevInstanceStartInput }
  | { ok: false; error: string }

/** 实例启动参数校验（端口避开特权段；CLI 仍会二次校验项目存在性） */
export function validateStartInput(input: unknown): StartInputValidation {
  if (input === undefined || input === null) return { ok: true, value: {} }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: t('dev.instanceInputObject') }
  }

  const raw = input as Record<string, unknown>
  const value: DevInstanceStartInput = {}

  if (raw.project !== undefined) {
    if (typeof raw.project !== 'string') return { ok: false, error: t('dev.instanceProjectString') }
    if (raw.project.trim()) value.project = raw.project.trim()
  }
  if (raw.port !== undefined) {
    if (typeof raw.port !== 'number' || !Number.isInteger(raw.port) || raw.port < 1024 || raw.port > 65535) {
      return { ok: false, error: t('dev.instancePortInvalid') }
    }
    value.port = raw.port
  }
  if (raw.name !== undefined) {
    if (typeof raw.name !== 'string') return { ok: false, error: t('dev.instanceNameString') }
    if (raw.name.trim()) value.name = raw.name.trim()
  }

  return { ok: true, value }
}

/** 解析 CLI `list --json` / `start --json` 输出 */
export function parseInstanceList(stdout: string): DevInstanceInfo[] {
  let parsed: unknown
  try { parsed = JSON.parse(stdout) } catch { return [] }
  if (!Array.isArray(parsed)) return []

  const out: DevInstanceInfo[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    if (typeof raw.id !== 'string' || typeof raw.port !== 'number' || typeof raw.project !== 'string') continue
    out.push({
      id: raw.id,
      pid: typeof raw.pid === 'number' ? raw.pid : 0,
      pgid: typeof raw.pgid === 'number' ? raw.pgid : undefined,
      port: raw.port,
      project: raw.project,
      home: typeof raw.home === 'string' ? raw.home : '',
      log: typeof raw.log === 'string' ? raw.log : '',
      startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : 0,
      status: typeof raw.status === 'string' ? raw.status : 'unknown',
      alive: raw.alive === true,
      stoppedAt: typeof raw.stoppedAt === 'number' ? raw.stoppedAt : undefined,
      error: typeof raw.error === 'string' ? raw.error : undefined,
    })
  }
  return out
}

/** 只接受 CLI 生成的实例 ID，防止把任意字符串传给子进程参数 */
export function isValidInstanceId(id: string): boolean {
  return /^dev-\d{8}-\d{6}-\d+$/.test(id)
}