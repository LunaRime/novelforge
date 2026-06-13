/**
 * Vela Hub Service — TransferHub 初始化器
 *
 * 负责在应用启动时初始化 TransferHub 并注册内置功能模块。
 * 各功能模块通过 hub-service 注册自己的路由处理器，实现解耦。
 */

import { transferHub } from '../shared/transfer-hub'
import type { HubMiddleware } from '../shared/middleware.interface'

/** 已注册的模块名称集合 */
const registeredModules = new Set<string>()

/**
 * 初始化 TransferHub。
 * 在 App.tsx 的 mount effect 中调用一次。
 */
export async function initializeHub(): Promise<void> {
  if (transferHub.isInitialized) {
    console.log('[HubService] TransferHub 已初始化，跳过')
    return
  }

  await transferHub.initialize()
  console.log('[HubService] TransferHub 初始化成功')
}

/**
 * 注册一个功能模块到 TransferHub。
 *
 * @param moduleName 模块名称（用于追踪）
 * @param setup 模块设置函数，接收 transferHub 实例
 * @returns 取消注册的函数
 */
export function registerModule(
  moduleName: string,
  setup: (hub: typeof transferHub) => (() => void) | void,
): () => void {
  if (registeredModules.has(moduleName)) {
    console.warn(`[HubService] 模块 "${moduleName}" 已注册，跳过`)
    return () => {
      registeredModules.delete(moduleName)
    }
  }

  registeredModules.add(moduleName)

  const cleanup = setup(transferHub)

  console.log(`[HubService] 模块已注册: ${moduleName}`)

  return () => {
    registeredModules.delete(moduleName)
    cleanup?.()
    console.log(`[HubService] 模块已注销: ${moduleName}`)
  }
}

/**
 * 注册中间件到 TransferHub。
 * 便捷方法，用于在模块初始化时注册中间件。
 */
export function registerMiddleware(middleware: HubMiddleware): () => void {
  return transferHub.use(middleware)
}

/**
 * 销毁 TransferHub（应用退出时）。
 */
export function destroyHub(): void {
  registeredModules.clear()
  transferHub.destroy()
  console.log('[HubService] TransferHub 已销毁')
}
