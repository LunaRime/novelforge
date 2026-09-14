import { ensureVelaHome, VELA_HOME } from './utils/config-utils'
import { logger } from './utils/logger'
import { t } from '../src/shared/locale'

import { registerConfigController } from './controllers/config-controller'
import { registerProjectController } from './controllers/project-controller'
import { registerFSController } from './controllers/fs-controller'
import { registerLLMController } from './controllers/llm-controller'
import { registerDatabaseController } from './controllers/db-controller'
import { registerKBController } from './controllers/kb-controller'
import { registerLocalEmbeddingController } from './controllers/local-embedding-controller'
import { registerImportController } from './controllers/import-controller'
import { registerEmbeddingController } from './controllers/embedding-controller'
import { registerUpdateController } from './controllers/update-controller'
import { registerExportController } from './controllers/export-controller'
import { registerSkillController } from './controllers/skill-controller'
import { registerDevController } from './controllers/dev-controller'
import { registerBrowserController } from './controllers/browser-controller'
import { registerReportController } from './controllers/report-controller'
import { registerTemplatesController } from './controllers/templates-controller'
import { registerHealthCheckIPC } from './controllers/health-check'
import { registerMemoryController } from './controllers/memory-controller'
import { registerStylesController } from './controllers/styles-controller'
// L4：MCP 桥此前由 main.ts 单独注册（第二入口），使 11 个 mcp: 通道绕过收口策略表；
// 现并入本函数，`registerIPCHandlers()` 成为**唯一**的 IPC 注册入口。
import { registerMCPHandlers } from './mcp/mcp-ipc-bridge'

/**
 * 注册所有 IPC 通道 — 在主进程启动时调用
 * (采用多控制器路由模式，解耦各个模块的庞大逻辑)
 */
export function registerIPCHandlers() {
  // 确保全局配置目录结构存在
  ensureVelaHome()

  // 挂载控制器路由
  registerConfigController()
  registerProjectController()
  registerFSController()
  registerLLMController()
  registerDatabaseController()
  registerKBController()
  registerLocalEmbeddingController()
  registerImportController()
  registerEmbeddingController()
  registerUpdateController()
  registerExportController()
  registerSkillController()
  registerDevController()
  registerBrowserController()
  registerReportController()
  registerTemplatesController()
  registerHealthCheckIPC()
  registerMemoryController()
  registerStylesController()
  // L4：MCP 桥（11 个 mcp: 通道）——并入唯一入口，不再由 main.ts 单独注册
  registerMCPHandlers()

  logger.info('IPC', t('log.ipc.allControllersRegistered').replace('{path}', VELA_HOME))
}
