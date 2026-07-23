/**
 * NovelForge Transfer Hub — 中枢消息路由模块
 *
 * 功能：
 * 1. 中间件管道：可插拔的消息预处理/后处理链
 * 2. 消息路由：按类型/模式分发消息到处理器
 * 3. 请求-响应：支持异步 request/response 模式
 * 4. 向后兼容：包装现有 globalEventBus，现有 emit/on 代码无需修改
 *
 * 架构：
 *   消息 → preProcess 中间件链 → route handler → postProcess 中间件链
 */

import { globalEventBus, type GlobalEventType } from './event-bus'
import type { HubMiddleware } from './middleware.interface'

// ===== 类型定义 =====

/** Hub 消息类型：扩展 GlobalEventType + 新增请求/响应类型 */
export type HubMessageType =
  | GlobalEventType
  // 蓝图校检
  | 'REQUEST:BLUEPRINT_VERIFY'
  | 'RESPONSE:BLUEPRINT_VERIFY'
  // 互评
  | 'REQUEST:MUTUAL_REVIEW'
  | 'RESPONSE:MUTUAL_REVIEW'
  // 向量检索
  | 'REQUEST:VECTOR_SEARCH'
  | 'RESPONSE:VECTOR_SEARCH'
  // 通用
  | 'REQUEST:GENERIC'
  | 'RESPONSE:GENERIC'
  | 'HUB:ERROR'
  | string

/** Hub 消息封装 */
export interface HubMessage<T = unknown> {
  /** 消息唯一 ID */
  id: string
  /** 消息类型 */
  type: HubMessageType
  /** 消息载荷 */
  payload: T
  /** 时间戳 */
  timestamp: number
  /** 来源模块标识（可选） */
  source?: string
  /** 关联 ID（请求-响应配对） */
  correlationId?: string
  /** 附加元数据 */
  metadata?: Record<string, unknown>
}

/** 消息处理器 */
export type HubMessageHandler<T = unknown> = (
  msg: HubMessage<T>,
) => Promise<void> | void

/** 路由表条目 */
interface RouteEntry {
  /** 精确匹配的类型 */
  type?: HubMessageType
  /** 正则匹配模式 */
  pattern?: RegExp
  /** 处理器 */
  handler: HubMessageHandler
}

/** request() 选项 */
export interface HubRequestOptions {
  /** 超时毫秒数（默认 30000） */
  timeoutMs?: number
  /** 附加元数据 */
  metadata?: Record<string, unknown>
  /** 来源标识 */
  source?: string
}

// ===== TransferHub 实现 =====

export class TransferHub {
  private middlewares: HubMiddleware[] = []
  private routes: RouteEntry[] = []
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timeout: ReturnType<typeof setTimeout>
    }
  >()
  /** 已投递的响应 ID 集合，防止双重投递 */
  private deliveredResponses = new Set<string>()
  private initialized = false
  private msgCounter = 0

  // ===== 中间件管理 =====

  /**
   * 注册中间件。
   * @returns 取消注册的函数
   */
  use(middleware: HubMiddleware): () => void {
    // 按优先级插入
    const priority = middleware.priority ?? 500
    const insertIndex = this.middlewares.findIndex(
      (m) => (m.priority ?? 500) > priority,
    )
    if (insertIndex === -1) {
      this.middlewares.push(middleware)
    } else {
      this.middlewares.splice(insertIndex, 0, middleware)
    }

    console.log(`[TransferHub] 中间件已注册: ${middleware.name} (priority=${priority})`)

    // 返回取消注册函数
    return () => {
      this.removeMiddleware(middleware.name)
    }
  }

  /** 按名称移除中间件 */
  removeMiddleware(name: string): void {
    const before = this.middlewares.length
    this.middlewares = this.middlewares.filter((m) => m.name !== name)
    if (this.middlewares.length < before) {
      console.log(`[TransferHub] 中间件已移除: ${name}`)
    }
  }

  /** 获取已注册的中间件列表 */
  getMiddlewareNames(): string[] {
    return this.middlewares.map((m) => m.name)
  }

  // ===== 消息路由 =====

  /**
   * 注册精确匹配的消息处理器。
   * @returns 取消注册的函数
   */
  on(type: HubMessageType, handler: HubMessageHandler): () => void {
    const entry: RouteEntry = { type, handler }
    this.routes.push(entry)
    return () => {
      this.routes = this.routes.filter((r) => r !== entry)
    }
  }

  /**
   * 注册正则匹配的消息处理器。
   * @returns 取消注册的函数
   */
  onPattern(pattern: RegExp, handler: HubMessageHandler): () => void {
    const entry: RouteEntry = { pattern, handler }
    this.routes.push(entry)
    return () => {
      this.routes = this.routes.filter((r) => r !== entry)
    }
  }

  /**
   * 移除匹配指定类型的所有处理器。
   */
  off(type: HubMessageType): void {
    this.routes = this.routes.filter((r) => r.type !== type)
  }

  // ===== 消息发送 =====

  /**
   * 发送事件（fire-and-forget）。
   * 消息经过完整的中间件管道 → 路由分发。
   * 同时向后兼容发射到 globalEventBus。
   */
  async emit<T = unknown>(
    type: HubMessageType,
    payload: T,
    opts?: {
      source?: string
      metadata?: Record<string, unknown>
    },
  ): Promise<void> {
    const msg = this.createMessage(type, payload, opts)

    try {
      // 1. preProcess 中间件链
      let processedMsg: HubMessage<unknown> = msg as HubMessage<unknown>
      for (const mw of this.middlewares) {
        if (mw.preProcess) {
          const result = await mw.preProcess(processedMsg)
          if (result === null) {
            // 中间件短路
            return
          }
          processedMsg = result
        }
      }

      // 2. 路由分发
      await this.dispatchToRoutes(processedMsg)

      // 3. postProcess 中间件链
      for (const mw of this.middlewares) {
        if (mw.postProcess) {
          await mw.postProcess(processedMsg)
        }
      }

      // 4. 向后兼容：发射到 globalEventBus（仅限 GlobalEventType）
      if (this.isGlobalEventType(type)) {
        // TransferHub 泛型 payload 与 GlobalEventType 严格 payload 映射不对齐，需要类型断言
        const emitFn = globalEventBus.emit as unknown as (type: string, payload: unknown) => void
        emitFn(type, payload)
      }
    } catch (error) {
      console.error(`[TransferHub] emit 错误 (type=${type}):`, error)
    }
  }

  /**
   * 发送请求并等待响应（request-response 模式）。
   *
   * 消息以 `REQUEST:XXX` 类型发送，等待 `RESPONSE:XXX` 类型的响应。
   * 通过 correlationId 进行请求-响应配对。
   */
  async request<TReq = unknown, TRes = unknown>(
    type: HubMessageType,
    payload: TReq,
    opts?: HubRequestOptions,
  ): Promise<TRes> {
    const timeoutMs = opts?.timeoutMs ?? 30_000
    const msg = this.createMessage(type, payload, {
      source: opts?.source,
      metadata: opts?.metadata,
    })

    return new Promise<TRes>((resolve, reject) => {
      // 设置超时
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(msg.id)
        reject(
          new Error(
            `[TransferHub] 请求超时 (type=${type}, id=${msg.id}, timeout=${timeoutMs}ms)`,
          ),
        )
      }, timeoutMs)

      // 注册待处理请求
      this.pendingRequests.set(msg.id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      })

      // 发送消息
      this.emit(type, payload, {
        source: opts?.source,
        metadata: {
          ...opts?.metadata,
          _requestId: msg.id,
        },
      }).catch(reject)
    })
  }

  /**
   * 响应一个请求。
   * 使用 correlationId 匹配原始请求。
   *
   * 双重投递防护：已投递的响应不会再次处理。
   */
  async respond<T = unknown>(
    requestMsg: HubMessage,
    payload: T,
  ): Promise<boolean> {
    const correlationId = requestMsg.id

    // 防止双重投递：同一响应 ID 只处理一次
    if (this.deliveredResponses.has(correlationId)) {
      return false
    }
    this.deliveredResponses.add(correlationId)

    const pending = this.pendingRequests.get(correlationId)

    if (pending) {
      clearTimeout(pending.timeout)
      this.pendingRequests.delete(correlationId)
      pending.resolve(payload)
      return true
    }

    // pending 已被超时清除 → 仅发射 fire-and-forget RESPONSE 事件
    const responseType = requestMsg.type.replace(/^REQUEST:/, 'RESPONSE:')
    await this.emit(responseType, {
      correlationId,
      payload,
    })

    return false
  }

  // ===== 生命周期 =====

  /** 初始化 TransferHub */
  async initialize(): Promise<void> {
    if (this.initialized) return

    console.log('[TransferHub] 正在初始化...')

    // 注册内置中间件
    this.use({
      name: 'LoggingMiddleware',
      priority: 0,
      preProcess: (msg) => {
        // 仅在开发环境记录详细信息
        if (process.env.NODE_ENV === 'development') {
          console.debug(
            `[Hub] → ${msg.type}`,
            msg.source ? `[${msg.source}]` : '',
            msg.correlationId ? `(corr: ${msg.correlationId.slice(0, 8)})` : '',
          )
        }
        return msg
      },
    })

    this.use({
      name: 'CorrelationMiddleware',
      priority: 1,
      preProcess: (msg) => {
        // 自动关联：如果 metadata 中有 _requestId，自动设置 correlationId
        if (msg.metadata?._requestId && !msg.correlationId) {
          msg.correlationId = msg.metadata._requestId as string
        }
        return msg
      },
    })

    // 注册内置路由：自动匹配 RESPONSE 类型到对应的待处理请求
    this.onPattern(/^RESPONSE:/, async (msg) => {
      if (msg.payload && typeof msg.payload === 'object') {
        const p = msg.payload as Record<string, unknown>
        if (p.correlationId && typeof p.correlationId === 'string') {
          const pending = this.pendingRequests.get(p.correlationId)
          if (pending) {
            clearTimeout(pending.timeout)
            this.pendingRequests.delete(p.correlationId)
            pending.resolve(p.payload)
          }
        }
      }
    })

    // 注册错误路由
    this.on('HUB:ERROR', async (msg) => {
      console.error('[TransferHub] 中枢错误:', msg.payload)
    })

    this.initialized = true
    console.log(`[TransferHub] 初始化完成，已注册 ${this.middlewares.length} 个中间件`)
  }

  /** 销毁 TransferHub */
  destroy(): void {
    // 清理所有待处理请求
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('TransferHub 已销毁'))
    }
    this.pendingRequests.clear()
    this.deliveredResponses.clear()

    // 清理路由
    this.routes = []

    // 清理中间件
    this.middlewares = []

    this.initialized = false
    console.log('[TransferHub] 已销毁')
  }

  /** 是否已初始化 */
  get isInitialized(): boolean {
    return this.initialized
  }

  // ===== 内部方法 =====

  /** 创建标准消息对象 */
  private createMessage<T>(
    type: HubMessageType,
    payload: T,
    opts?: { source?: string; metadata?: Record<string, unknown> },
  ): HubMessage<T> {
    return {
      id: `hub_${++this.msgCounter}_${Date.now().toString(36)}`,
      type,
      payload,
      timestamp: Date.now(),
      source: opts?.source,
      metadata: opts?.metadata,
    }
  }

  /** 分发消息到匹配的路由处理器 */
  private async dispatchToRoutes(msg: HubMessage): Promise<void> {
    // 先执行中间件的 handle 方法（管道式）
    let mwIndex = 0
    const runMiddlewareChain = async (): Promise<void> => {
      while (mwIndex < this.middlewares.length) {
        const mw = this.middlewares[mwIndex++]
        if (mw.handle) {
          let nextCalled = false
          await mw.handle(msg, async () => {
            nextCalled = true
            await runMiddlewareChain()
          })
          if (!nextCalled) {
            // 中间件短路
            return
          }
        }
      }

      // 中间件管道执行完毕，分发到路由处理器
      await this.executeRouteHandlers(msg)
    }

    await runMiddlewareChain()
  }

  /** 执行匹配的路由处理器 */
  private async executeRouteHandlers(msg: HubMessage): Promise<void> {
    let matched = false

    for (const route of this.routes) {
      if (route.type && route.type === msg.type) {
        await route.handler(msg)
        matched = true
      } else if (route.pattern && route.pattern.test(msg.type)) {
        await route.handler(msg)
        matched = true
      }
    }

    if (!matched) {
      // 无人处理的消息静默丢弃（不会报错）
      // 除非设置了 _requireResponse 元数据
      if (msg.metadata?._requireResponse) {
        console.warn(`[TransferHub] 无人处理的消息: ${msg.type}`)
      }
    }
  }

  /**
   * 全局事件前缀列表 — 匹配此前缀的事件将被转发到 globalEventBus
   *
   * 当新增 GlobalEventType 时，请在此列表中添加对应前缀。
   * 支持通配符匹配：WORKFLOW_ 匹配所有 WORKFLOW_COMPLETE、WORKFLOW_ERROR 等。
   */
  private static readonly GLOBAL_EVENT_PREFIXES = [
    'WORKFLOW_',
    'FINALIZE_',
    'ARCH_',
    'PROJECT_',
    'REFRESH_RESOURCE',
    'CHAPTER_',
    'DRAFT_',
    'CHARACTER_',
    'SYSTEM_',
  ]

  /** 检查是否为 GlobalEventType（通过前缀通配符匹配） */
  private isGlobalEventType(type: string): boolean {
    return TransferHub.GLOBAL_EVENT_PREFIXES.some((prefix) =>
      type.startsWith(prefix),
    )
  }
}

// ===== 全局单例 =====

export const transferHub = new TransferHub()
