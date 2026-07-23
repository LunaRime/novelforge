/**
 * 全局事件总线 — 统一解耦业务层（Service/Command/Workflow）与视图层（React/Zustand）
 *
 * 所有跨模块事件都通过此总线分发，组件不再直接使用 window.dispatchEvent。
 * 事件由 ProjectService 统一消费，驱动 Store 更新，组件只需订阅 Store 数据。
 */

// ===== 事件类型定义 =====

export type GlobalEventType =
  // --- 资源刷新 ---
  | 'REFRESH_RESOURCE'
  // --- 工作流相关 ---
  | 'WORKFLOW_COMPLETE'
  | 'WORKFLOW_ERROR'
  // --- 架构后处理 ---
  | 'ARCH_POSTPROCESS_UPDATED'
  | 'CHARACTER_EXTRACT_FAILED'
  // --- 架构文件单步更新（每步生成完触发） ---
  | 'ARCH_FILE_UPDATED'
  // --- 定稿完成 ---
  | 'FINALIZE_COMPLETE'
  // --- 项目级事件 ---
  | 'PROJECT_CHANGED'
  // --- 系统通知 ---
  | 'SYSTEM_NOTICE'

export interface EventPayloadMap {
  'REFRESH_RESOURCE': {
    resources: Array<'fileTree' | 'characterCards' | 'drafts' | 'blueprints' | 'all'>
  }
  'WORKFLOW_COMPLETE': {
    type: string
  }
  'WORKFLOW_ERROR': {
    title: string
    error: string
    stack?: string
  }
  'ARCH_POSTPROCESS_UPDATED': Record<string, never>
  'CHARACTER_EXTRACT_FAILED': {
    error?: string
  }
  'ARCH_FILE_UPDATED': {
    fileName: string
  }
  'FINALIZE_COMPLETE': {
    chapterNumber: number
  }
  'PROJECT_CHANGED': {
    projectPath: string
  }
  'SYSTEM_NOTICE': {
    level: 'info' | 'success' | 'warn' | 'error'
    message: string
  }
}

// ===== EventBus 实现 =====

type AsyncListener<K extends GlobalEventType> = (
  payload: EventPayloadMap[K],
) => void | Promise<void>

class EventBus {
  private target = new EventTarget()
  /** 异步监听器列表（独立于 EventTarget，用于 emitAsync 收集 Promise） */
  private asyncListeners = new Map<string, Set<AsyncListener<GlobalEventType>>>()

  emit<K extends GlobalEventType>(type: K, payload: EventPayloadMap[K]) {
    this.target.dispatchEvent(new CustomEvent(type, { detail: payload }))
  }

  /**
   * 异步发射事件：等待所有同步和异步监听器执行完成后 resolve。
   * 适用于需要确保事件完全处理完毕后再继续的场景（如工作流步骤间通信）。
   */
  async emitAsync<K extends GlobalEventType>(
    type: K,
    payload: EventPayloadMap[K],
  ): Promise<void> {
    // 1. 同步发射（EventTarget 同步分发）
    this.target.dispatchEvent(new CustomEvent(type, { detail: payload }))

    // 2. 收集所有异步监听器的 Promise 并等待
    const asyncSet = this.asyncListeners.get(type)
    if (asyncSet && asyncSet.size > 0) {
      const promises = Array.from(asyncSet).map((handler) => {
        try {
          const result = handler(payload)
          return result instanceof Promise ? result : Promise.resolve()
        } catch (error) {
          return Promise.reject(error)
        }
      })
      await Promise.allSettled(promises)
    }
  }

  on<K extends GlobalEventType>(
    type: K,
    handler: (payload: EventPayloadMap[K]) => void,
  ): () => void {
    const listener = (event: Event) => {
      handler((event as CustomEvent).detail)
    }
    this.target.addEventListener(type as string, listener)
    return () => this.target.removeEventListener(type as string, listener)
  }

  /**
   * 注册异步监听器 — emitAsync 会等待此类监听器完成。
   *
   * 与 `on()` 的区别：`onAsync()` 注册的 handler 可以返回 Promise，
   * emitAsync 会通过 Promise.allSettled 等待所有异步 handler 完成。
   * 同步 `emit()` 也会触发异步 handler（fire-and-forget，不等待）。
   */
  onAsync<K extends GlobalEventType>(
    type: K,
    handler: AsyncListener<K>,
  ): () => void {
    const typedHandler = handler as AsyncListener<GlobalEventType>
    if (!this.asyncListeners.has(type)) {
      this.asyncListeners.set(type, new Set())
    }
    this.asyncListeners.get(type)!.add(typedHandler)

    // 同时注册到 EventTarget 以便 emit() 也能触发（fire-and-forget）
    const syncWrapper = (event: Event) => {
      typedHandler((event as CustomEvent).detail)
    }
    this.target.addEventListener(type as string, syncWrapper)

    return () => {
      this.asyncListeners.get(type)?.delete(typedHandler)
      this.target.removeEventListener(type as string, syncWrapper)
    }
  }

  /**
   * 管道式事件处理：依次经过多个处理器，每个处理器可以转换 payload。
   * 适用于需要多个模块依次处理同一事件的场景。
   */
  async pipeline<K extends GlobalEventType>(
    type: K,
    initialPayload: EventPayloadMap[K],
    processors: Array<(payload: EventPayloadMap[K]) => EventPayloadMap[K] | Promise<EventPayloadMap[K]>>,
  ): Promise<EventPayloadMap[K]> {
    let payload = initialPayload
    for (const processor of processors) {
      payload = await processor(payload)
    }
    // 最后发出处理后的结果
    this.emit(type, payload)
    return payload
  }
}

export const globalEventBus = new EventBus()

// ===== 便捷日志工具 =====

export const AppLogger = {
  info: (msg: string) => globalEventBus.emit('SYSTEM_NOTICE', { level: 'info', message: msg }),
  warn: (msg: string) => globalEventBus.emit('SYSTEM_NOTICE', { level: 'warn', message: msg }),
  error: (title: string, err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error(`[AppLogger] ${title}:`, err)
    globalEventBus.emit('WORKFLOW_ERROR', { title, error: message, stack })
    globalEventBus.emit('SYSTEM_NOTICE', { level: 'error', message: `${title}: ${message}` })
  }
}
