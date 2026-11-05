import { app } from 'electron'
import { readJsonFile, GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG } from '../utils/config-utils'
import { isIpcMetricsEnabled, setIpcMetricsEnabled, getIpcMetrics, clearIpcMetrics } from '../dev/ipc-metrics'
import { listTables, getSchema, runQuery } from '../dev/db-inspector'
import { getPerfSnapshot } from '../dev/perf-snapshot'
import { t } from '../../src/shared/locale'
import { guardedHandle } from '../security/ipc-guard'
import type { DevIpcMetricsData, GlobalConfig } from '../../src/shared/ipc-channels'
/** 开发者控制台门禁：开发态默认开；打包版需显式开关或 --devtools */
export function isDevConsoleEnabled(): boolean {
  if (!__DEV_CONSOLE__) return false
  if (process.env.NOVELFORGE_DEVTOOLS === '1') return true
  if (!app.isPackaged) return true
  try {
    const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
    return config.devMode?.consoleEnabled === true
  } catch {
    return false
  }
}

function assertDevConsoleEnabled(): void {
  if (!isDevConsoleEnabled()) throw new Error(t('dev.consoleDisabled'))
}

export function registerConsoleController() {
  /** 开发者控制台：打开/关闭 IPC 指标采集 */
  guardedHandle('dev:ipc-set-enabled', async (_event, enabled: boolean) => {
    assertDevConsoleEnabled()
    setIpcMetricsEnabled(Boolean(enabled))
    return { success: true }
  })

  /** 开发者控制台：读取 IPC 指标 */
  guardedHandle('dev:ipc-metrics', async (): Promise<DevIpcMetricsData> => {
    assertDevConsoleEnabled()
    return { enabled: isIpcMetricsEnabled(), ...getIpcMetrics() }
  })

  /** 开发者控制台：清空 IPC 指标 */
  guardedHandle('dev:ipc-clear', async () => {
    assertDevConsoleEnabled()
    clearIpcMetrics()
    return { success: true }
  })

  /** 开发者控制台：项目数据库表列表 */
  guardedHandle('dev:db-tables', async () => {
    assertDevConsoleEnabled()
    return listTables()
  })

  /** 开发者控制台：表结构 */
  guardedHandle('dev:db-schema', async (_event, table: string) => {
    assertDevConsoleEnabled()
    return getSchema(table)
  })

  /** 开发者控制台：只读 SQL */
  guardedHandle('dev:db-query', async (_event, sql: string, limit?: number) => {
    assertDevConsoleEnabled()
    return runQuery(sql, limit)
  })

  /** 开发者控制台：性能快照 */
  guardedHandle('dev:perf', async () => {
    assertDevConsoleEnabled()
    return getPerfSnapshot()
  })

}
