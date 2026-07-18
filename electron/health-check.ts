/**
 * NovelForge 健康检查模块
 *
 * 提供应用运行状态诊断能力：
 * - 数据库完整性校验
 * - 磁盘剩余空间
 * - LLM 服务连通性（按需）
 *
 * 所有检查结果通过 IPC `health:check` 暴露给渲染进程。
 */
import { ipcMain } from 'electron'
import fs from 'node:fs'
import { getProjectDb } from './database'
import { logger } from './utils/logger'
import { safeErrorMessage } from './utils/error-utils'

// ===== 类型 =====

export interface HealthStatus {
  ok: boolean
  timestamp: number
  checks: {
    database: HealthCheckResult
    diskSpace: HealthCheckResult
    llm?: HealthCheckResult
  }
}

export interface HealthCheckResult {
  ok: boolean
  message: string
  detail?: string
}

// ===== 检查函数 =====

/** 数据库完整性检查 */
function checkDatabase(): HealthCheckResult {
  try {
    const db = getProjectDb()
    if (!db) {
      return { ok: false, message: '数据库未连接' }
    }
    const result = db.pragma('integrity_check') as Array<{ integrity_check: string }>
    const isOk = result.length === 1 && result[0].integrity_check === 'ok'
    return {
      ok: isOk,
      message: isOk ? '数据库完整' : '数据库完整性校验失败',
      detail: isOk ? undefined : result.map(r => r.integrity_check).join('; '),
    }
  } catch (error) {
    return { ok: false, message: '数据库检查异常', detail: safeErrorMessage(error) }
  }
}

/** 磁盘空间检查（项目目录所在盘） */
function checkDiskSpace(projectPath?: string): HealthCheckResult {
  try {
    // 默认检查 ~/.vela 配置目录
    const targetPath = projectPath || process.env.VELA_HOME || ''
    if (!targetPath || !fs.existsSync(targetPath)) {
      // 无法确定路径时返回 neutral
      return { ok: true, message: '磁盘检查已跳过（无项目路径）' }
    }

    // Node.js 没有直接的磁盘空间 API，用 fs.statfs（Node 19+）或保守处理
    try {
      const stat = fs.statfsSync(targetPath)
      const freeMB = Math.round((stat.bsize * stat.bfree) / (1024 * 1024))
      const isLow = freeMB < 100 // 低于 100MB 警告
      return {
        ok: !isLow,
        message: isLow ? `磁盘空间不足 (${freeMB}MB)` : `磁盘正常 (${freeMB}MB 可用)`,
        detail: `${freeMB}MB`,
      }
    } catch {
      return { ok: true, message: '磁盘检查已跳过（statfs 不可用）' }
    }
  } catch (error) {
    return { ok: false, message: '磁盘检查异常', detail: safeErrorMessage(error) }
  }
}

/** LLM 连通性检查（按需，不阻塞默认检查） */
async function checkLLMConnectivity(baseUrl: string, apiKey: string): Promise<HealthCheckResult> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const res = await fetch(baseUrl.replace(/\/$/, '') + '/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (res.ok) {
      return { ok: true, message: 'LLM 服务可达' }
    }
    return { ok: false, message: `LLM 返回 ${res.status}`, detail: await res.text().catch(() => '') }
  } catch (error) {
    return { ok: false, message: 'LLM 连接失败', detail: safeErrorMessage(error) }
  }
}

// ===== IPC 注册 =====

export function registerHealthCheckIPC(): void {
  ipcMain.handle('health:check', async (_event, projectPath?: string) => {
    const checks = {
      database: checkDatabase(),
      diskSpace: checkDiskSpace(projectPath),
    }

    const allOk = checks.database.ok && checks.diskSpace.ok

    const result: HealthStatus = {
      ok: allOk,
      timestamp: Date.now(),
      checks,
    }

    logger.info('HealthCheck', `健康检查完成: ${allOk ? 'OK' : 'WARN'}`)
    return result
  })

  ipcMain.handle('health:check-llm', async (_event, baseUrl: string, apiKey: string) => {
    const llmCheck = await checkLLMConnectivity(baseUrl, apiKey)
    return { ok: llmCheck.ok, message: llmCheck.message, detail: llmCheck.detail }
  })

  logger.info('HealthCheck', 'IPC 处理器已注册')
}
