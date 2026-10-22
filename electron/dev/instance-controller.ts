/**
 * 开发者控制台 — 隔离实例控制器。
 *
 * 不在主进程复制 spawn 逻辑：统一调用 scripts/dev-instance.mjs，
 * 用 Electron 内置 Node（ELECTRON_RUN_AS_NODE=1）执行，保证 CLI 与 UI 行为一致。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { app } from 'electron'
import path from 'node:path'
import { guardedHandle } from '../security/ipc-guard'
import { isDevConsoleEnabled } from '../controllers/dev-controller'
import { redactSecrets } from './ipc-metrics'
import { isValidInstanceId, parseInstanceList, validateStartInput } from './instance-utils'
import type { DevInstanceInfo, DevInstanceStartInput } from '../../src/shared/ipc-channels'

const execFileAsync = promisify(execFile)
const DISABLED = '开发者控制台未启用（设置 → 开发者选项，或使用 --devtools 启动）'

function cliPath(): string {
  const root = app.getAppPath()
  // 打包后 app.getAppPath() 指向 app.asar；脚本被 asarUnpack 到 .asar.unpacked，
  // ELECTRON_RUN_AS_NODE 下必须用真实磁盘路径执行。
  const scriptRoot = root.endsWith('.asar') ? `${root}.unpacked` : root
  return path.join(scriptRoot, 'scripts', 'dev-instance.mjs')
}

async function runCli(args: string[], timeoutMs: number): Promise<string> {
  try {
    const { stdout } = await execFileAsync(process.execPath, [cliPath(), ...args], {
      // 不能用 app.getAppPath()：打包后它是 app.asar 文件，spawn 会 ENOTDIR
      cwd: path.dirname(cliPath()),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        // 让 CLI 用当前应用自身启动新实例（打包版 process.execPath 是 app 可执行文件）
        NOVELFORGE_ELECTRON_BIN: process.execPath,
        NOVELFORGE_ELECTRON_PACKAGED: app.isPackaged ? '1' : '0',
      },
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    })
    return String(stdout).trim()
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string }
    const detail = [e.stderr, e.stdout, e.message].filter(Boolean).join('\n')
    throw new Error(redactSecrets(detail).slice(0, 800) || 'instance cli failed')
  }
}

export function registerInstanceController(): void {
  guardedHandle('dev:console-status', async () => {
    const enabled = isDevConsoleEnabled()
    return enabled ? { enabled } : { enabled, reason: DISABLED }
  })

  guardedHandle('dev:instance-list', async (): Promise<DevInstanceInfo[]> => {
    if (!isDevConsoleEnabled()) return []
    try {
      return parseInstanceList(await runCli(['list', '--json'], 15_000))
    } catch {
      return []
    }
  })

  guardedHandle('dev:instance-start', async (_event, input: DevInstanceStartInput) => {
    if (!isDevConsoleEnabled()) return { success: false, error: DISABLED }
    const validated = validateStartInput(input)
    if (!validated.ok) return { success: false, error: validated.error }

    const args = ['start', '--json']
    if (validated.value.project) args.push('--project', validated.value.project)
    if (validated.value.port) args.push('--port', String(validated.value.port))
    if (validated.value.name) args.push('--name', validated.value.name)

    try {
      const stdout = await runCli(args, 60_000)
      const instance = parseInstanceList(`[${stdout}]`)[0]
      if (!instance) return { success: false, error: '实例已启动，但 manifest 解析失败' }
      return { success: true, instance }
    } catch (error) {
      return { success: false, error: redactSecrets(String(error instanceof Error ? error.message : error)) }
    }
  })

  guardedHandle('dev:instance-stop', async (_event, id: string) => {
    if (!isDevConsoleEnabled()) return { success: false, error: DISABLED }
    if (!isValidInstanceId(id)) return { success: false, error: '无效的实例 ID' }
    try {
      await runCli(['stop', id], 20_000)
      return { success: true }
    } catch (error) {
      return { success: false, error: redactSecrets(String(error instanceof Error ? error.message : error)) }
    }
  })

  guardedHandle('dev:instance-clean', async (_event, id: string) => {
    if (!isDevConsoleEnabled()) return { success: false, error: DISABLED }
    if (!isValidInstanceId(id)) return { success: false, error: '无效的实例 ID' }
    try {
      await runCli(['clean', id, '--yes'], 25_000)
      return { success: true }
    } catch (error) {
      return { success: false, error: redactSecrets(String(error instanceof Error ? error.message : error)) }
    }
  })
}