/**
 * 开发者控制台 — 性能快照（主进程 + 项目 DB + 日志）。
 *
 * 只读、低开销：event loop delay 用 perf_hooks 直方图；DB 只 stat 文件，不打开连接。
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { getCurrentProjectPath } from '../database'
import { getProjectVelaDir, VELA_HOME } from '../utils/config-utils'
import type { DevPerfSnapshot } from '../../src/shared/ipc-channels'

const loopDelay = monitorEventLoopDelay({ resolution: 20 })
loopDelay.enable()

function safeStat(file: string): number {
  try { return fs.statSync(file).size } catch { return 0 }
}

function walkLogs(dir: string): { files: number; bytes: number } {
  let files = 0
  let bytes = 0
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        const sub = walkLogs(target)
        files += sub.files
        bytes += sub.bytes
      } else if (entry.name.endsWith('.log')) {
        files += 1
        bytes += safeStat(target)
      }
    }
  } catch {
    // 日志目录不存在 / 无权限：返回已统计部分
  }
  return { files, bytes }
}

export function getPerfSnapshot(): DevPerfSnapshot {
  const memory = process.memoryUsage()
  const projectPath = getCurrentProjectPath()
  const dbFile = projectPath ? path.join(getProjectVelaDir(projectPath), 'vela.db') : ''
  const logDir = path.join(VELA_HOME, 'logs')

  let appMetrics: DevPerfSnapshot['app'] = []
  try {
    appMetrics = app.getAppMetrics().map((metric) => ({
      type: metric.type,
      pid: metric.pid,
      cpuPercent: metric.cpu?.percentCPUUsage ?? 0,
      memoryKB: metric.memory?.workingSetSize ?? 0,
    }))
  } catch {
    appMetrics = []
  }

  const eventLoopDelayMs = loopDelay.mean / 1e6
  loopDelay.reset()

  return {
    main: {
      pid: process.pid,
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      external: memory.external,
      uptimeSec: process.uptime(),
      eventLoopDelayMs: Number.isFinite(eventLoopDelayMs) ? eventLoopDelayMs : 0,
    },
    app: appMetrics,
    db: {
      projectPath,
      size: dbFile ? safeStat(dbFile) : 0,
      walSize: dbFile ? safeStat(`${dbFile}-wal`) : 0,
    },
    logs: { dir: logDir, ...walkLogs(logDir) },
  }
}