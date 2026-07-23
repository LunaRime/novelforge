/**
 * NovelForge Transfer Hub — 中间件接口定义
 *
 * 中间件是 TransferHub 的可插拔处理单元。
 * 每个中间件可以在消息处理的不同阶段介入：
 * - preProcess: 在路由前转换消息
 * - handle: 处理消息（可以短路管道）
 * - postProcess: 在路由后转换消息
 *
 * 中间件按 priority 排序执行（数值越小越先执行）。
 */

import type { HubMessage } from './transfer-hub'

export interface HubMiddleware {
  /** 中间件唯一名称（用于日志和移除） */
  name: string

  /**
   * 预处理：在消息路由到处理器之前执行。
   * 返回修改后的消息（或原消息）。
   * 返回 null 则短路管道，消息不会被进一步处理。
   */
  preProcess?: (msg: HubMessage) => HubMessage | null | Promise<HubMessage | null>

  /**
   * 处理消息。接收 next() 函数以继续管道。
   * 不调用 next() 则短路管道。
   */
  handle?: (msg: HubMessage, next: () => Promise<void>) => Promise<void>

  /**
   * 后处理：在消息处理完成后执行。
   * 返回修改后的消息（通常不需要修改）。
   */
  postProcess?: (msg: HubMessage) => HubMessage | Promise<HubMessage>

  /**
   * 优先级（数值越小越先执行）。
   * 内置中间件使用 0-99，用户中间件使用 100+。
   * 默认: 500
   */
  priority?: number
}

/** 中间件工厂函数类型 */
export type MiddlewareFactory = (
  options?: Record<string, unknown>,
) => HubMiddleware
