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
import { getProjectDb } from '../database'
import { logger } from '../utils/logger'
import { safeErrorMessage } from '../utils/error-utils'
import { t } from '../../src/shared/locale'

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
      return { ok: false, message: t('health.dbNotConnected') }
    }
    const result = db.pragma('integrity_check') as Array<{ integrity_check: string }>
    const isOk = result.length === 1 && result[0].integrity_check === 'ok'
    return {
      ok: isOk,
      message: isOk ? t('health.dbOk') : t('health.dbCorrupt'),
      detail: isOk ? undefined : result.map(r => r.integrity_check).join('; '),
    }
  } catch (error) {
    return { ok: false, message: t('health.dbCheckFailed'), detail: safeErrorMessage(error) }
  }
}

/** 磁盘空间检查（项目目录所在盘） */
function checkDiskSpace(projectPath?: string): HealthCheckResult {
  try {
    // 默认检查 ~/.novelforge 配置目录
    const targetPath = projectPath || process.env.VELA_HOME || ''
    if (!targetPath || !fs.existsSync(targetPath)) {
      // 无法确定路径时返回 neutral
      return { ok: true, message: t('health.diskSkippedNoPath') }
    }

    // Node.js 没有直接的磁盘空间 API，用 fs.statfs（Node 19+）或保守处理
    try {
      const stat = fs.statfsSync(targetPath)
      const freeMB = Math.round((stat.bsize * stat.bfree) / (1024 * 1024))
      const isLow = freeMB < 100 // 低于 100MB 警告
      return {
        ok: !isLow,
        message: isLow
          ? t('health.diskLow').replace('{mb}', String(freeMB))
          : t('health.diskOk').replace('{mb}', String(freeMB)),
        detail: `${freeMB}MB`,
      }
    } catch {
      return { ok: true, message: t('health.diskSkippedNoStatfs') }
    }
  } catch (error) {
    return { ok: false, message: t('health.diskCheckFailed'), detail: safeErrorMessage(error) }
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
      return { ok: true, message: t('health.llmOk') }
    }
    return { ok: false, message: t('health.llmStatus').replace('{status}', String(res.status)), detail: await res.text().catch(() => '') }
  } catch (error) {
    return { ok: false, message: t('health.llmFailed'), detail: safeErrorMessage(error) }
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

    logger.info('HealthCheck', t('log.healthCheck.done').replace('{status}', allOk ? 'OK' : 'WARN'))
    return result
  })

  ipcMain.handle('health:check-llm', async (_event, baseUrl: string, apiKey: string) => {
    const llmCheck = await checkLLMConnectivity(baseUrl, apiKey)
    return { ok: llmCheck.ok, message: llmCheck.message, detail: llmCheck.detail }
  })

  logger.info('HealthCheck', t('log.ipc.handlersRegistered'))
}
