/**
 * Vela API 并发控制器 — 基于信号量的请求并发限制
 *
 * 提供：
 * 1. 信号量模式：限制同时进行的异步操作数量
 * 2. 优先级队列：高优先级请求先执行
 * 3. 批量执行：自动分批并发执行，遵守全局限制
 * 4. 中止支持：通过 AbortSignal 取消排队中的请求
 *
 * 不含任何 LLM 特定逻辑 — 通用并发控制，可用于文件 I/O、数据库操作等场景。
 */

// ===== 类型定义 =====

export interface ConcurrencyConfig {
  /** 最大并发数 */
  maxConcurrent: number
  /** 最大排队数量 */
  maxQueueSize: number
  /** 默认超时（毫秒），0 = 不超时 */
  defaultTimeoutMs: number
}

export const DEFAULT_CONCURRENCY_CONFIG: ConcurrencyConfig = {
  maxConcurrent: 3,
  maxQueueSize: 50,
  defaultTimeoutMs: 120_000,
}

/** 排队中的请求 */
interface QueuedRequest<T = unknown> {
  id: string
  /** 优先级（数值越小优先级越高） */
  priority: number
  /** 实际执行函数 */
  execute: () => Promise<T>
  /** Promise resolve/reject */
  resolve: (value: T) => void
  reject: (error: Error) => void
  /** 可选的 AbortSignal */
  signal?: AbortSignal
  /** 入队时间 */
  enqueuedAt: number
}

/** 活跃槽位 */
interface ActiveSlot {
  id: string
  release: () => void
}

// ===== 并发控制器 =====

export class ConcurrencyController {
  private config: ConcurrencyConfig
  private activeSlots: ActiveSlot[] = []
  private queue: QueuedRequest[] = []
  private slotCounter = 0

  constructor(config: Partial<ConcurrencyConfig> = {}) {
    this.config = { ...DEFAULT_CONCURRENCY_CONFIG, ...config }
  }

  // ===== 公共 API =====

  /**
   * 执行一个受控的异步操作。
   * 如果当前活跃数已达上限，该操作会进入优先级队列等待。
   *
   * @param fn 要执行的异步函数
   * @param options 可选配置
   * @returns fn 的返回值
   */
  async execute<T>(
    fn: () => Promise<T>,
    options?: {
      priority?: number
      signal?: AbortSignal
      timeoutMs?: number
    },
  ): Promise<T> {
    const priority = options?.priority ?? 10
    const signal = options?.signal
    const timeoutMs = options?.timeoutMs ?? this.config.defaultTimeoutMs

    // 如果信号已经中止，直接拒绝
    if (signal?.aborted) {
      throw new DOMException('请求已取消', 'AbortError')
    }

    // 检查队列容量
    if (this.queue.length >= this.config.maxQueueSize) {
      throw new Error(`并发队列已满（最多 ${this.config.maxQueueSize} 个排队请求），请稍后重试`)
    }

    // 如果活跃数未达上限，直接获取槽位并执行
    if (this.activeSlots.length < this.config.maxConcurrent) {
      const slot = this.acquireSlot()
      try {
        return await this.executeWithTimeout(fn, timeoutMs, signal)
      } finally {
        this.releaseSlot(slot)
        this.processQueue()
      }
    }

    // 否则进入排队
    return new Promise<T>((resolve, reject) => {
      const id = `req_${++this.slotCounter}_${Date.now()}`

      // 监听 AbortSignal
      const onAbort = () => {
        this.removeFromQueue(id)
        reject(new DOMException('请求已取消', 'AbortError'))
      }

      if (signal) {
        if (signal.aborted) {
          reject(new DOMException('请求已取消', 'AbortError'))
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }

      const queued: QueuedRequest<T> = {
        id,
        priority,
        execute: fn,
        resolve: (value: T) => {
          signal?.removeEventListener('abort', onAbort)
          resolve(value)
        },
        reject: (error: Error) => {
          signal?.removeEventListener('abort', onAbort)
          reject(error)
        },
        signal,
        enqueuedAt: Date.now(),
      }

      this.enqueue(queued)
    })
  }

  /**
   * 批量并行执行多个任务，自动分批以遵守并发限制。
   *
   * 所有任务都会被执行，不会因为单个任务失败而中止。
   * 返回结果数组，失败的任务对应位置为 null。
   *
   * @param tasks 任务函数数组
   * @param options 可选配置
   * @returns 结果数组（与 tasks 顺序一致）
   */
  async batchExecute<T>(
    tasks: Array<() => Promise<T>>,
    options?: {
      signal?: AbortSignal
      onProgress?: (done: number, total: number) => void
    },
  ): Promise<(T | null)[]> {
    if (tasks.length === 0) return []

    const results: (T | null)[] = new Array(tasks.length).fill(null)
    let completed = 0

    // 使用内部信号量控制并发
    const running = new Set<number>()
    let nextIndex = 0

    const runTask = async (index: number): Promise<void> => {
      try {
        // 通过 execute 获取槽位
        const result = await this.execute(
          () => tasks[index](),
          { signal: options?.signal },
        )
        results[index] = result
      } catch {
        // 单个任务失败标记为 null，不阻断其他任务
        results[index] = null
      } finally {
        running.delete(index)
        completed++
        options?.onProgress?.(completed, tasks.length)
        // 继续调度下一个任务
        scheduleNext()
      }
    }

    const scheduleNext = () => {
      while (running.size < this.config.maxConcurrent && nextIndex < tasks.length) {
        if (options?.signal?.aborted) break
        const idx = nextIndex++
        running.add(idx)
        runTask(idx)
      }
    }

    scheduleNext()

    // 等待所有任务完成
    while (completed < tasks.length) {
      if (options?.signal?.aborted) {
        // 取消所有还在排队和运行中的任务
        this.removeAllForSignal(options.signal)
        break
      }
      await new Promise<void>((resolve) => {
        const check = () => {
          if (completed >= tasks.length || options?.signal?.aborted) {
            resolve()
          } else {
            setTimeout(check, 50)
          }
        }
        check()
      })
    }

    return results
  }

  /**
   * 获取当前活跃请求数
   */
  get activeCount(): number {
    return this.activeSlots.length
  }

  /**
   * 获取当前排队请求数
   */
  get queueLength(): number {
    return this.queue.length
  }

  /**
   * 获取当前配置（只读）
   */
  get currentConfig(): Readonly<ConcurrencyConfig> {
    return { ...this.config }
  }

  /**
   * 更新并发配置
   */
  updateConfig(partial: Partial<ConcurrencyConfig>): void {
    this.config = { ...this.config, ...partial }
    // 如果提高了并发上限，立即处理队列
    this.processQueue()
  }

  /**
   * 获取状态快照（供 IPC 报告）
   */
  getStatus(): {
    activeCount: number
    queueLength: number
    maxConcurrent: number
    maxQueueSize: number
  } {
    return {
      activeCount: this.activeSlots.length,
      queueLength: this.queue.length,
      maxConcurrent: this.config.maxConcurrent,
      maxQueueSize: this.config.maxQueueSize,
    }
  }

  /**
   * 取消所有排队中的请求（运行中的不受影响）
   */
  cancelAllQueued(): number {
    const cancelled = this.queue.length
    for (const req of this.queue) {
      req.reject(new DOMException('所有排队请求已取消', 'AbortError'))
    }
    this.queue = []
    return cancelled
  }

  /**
   * 取消所有请求（包括运行中的）
   */
  cancelAll(): void {
    // 取消排队的
    this.cancelAllQueued()
    // 活跃的无法真正取消（已经在执行中），但释放槽位
    this.activeSlots = []
  }

  // ===== 内部方法 =====

  /** 获取一个槽位 */
  private acquireSlot(): ActiveSlot {
    const id = `slot_${++this.slotCounter}`
    const slot: ActiveSlot = {
      id,
      release: () => {
        this.activeSlots = this.activeSlots.filter((s) => s.id !== id)
      },
    }
    this.activeSlots.push(slot)
    return slot
  }

  /** 释放槽位 */
  private releaseSlot(slot: ActiveSlot): void {
    this.activeSlots = this.activeSlots.filter((s) => s.id !== slot.id)
  }

  /** 按优先级入队 */
  private enqueue<T>(request: QueuedRequest<T>): void {
    // 找到插入位置（按优先级升序，同优先级按时间升序）
    const insertIndex = this.queue.findIndex(
      (r) => r.priority > request.priority,
    )
    if (insertIndex === -1) {
      this.queue.push(request as QueuedRequest)
    } else {
      this.queue.splice(insertIndex, 0, request as QueuedRequest)
    }
  }

  /** 从队列中移除指定请求 */
  private removeFromQueue(id: string): void {
    this.queue = this.queue.filter((r) => r.id !== id)
  }

  /** 移除与指定 signal 关联的所有请求 */
  private removeAllForSignal(signal: AbortSignal): void {
    const toRemove: string[] = []
    for (const req of this.queue) {
      if (req.signal === signal) {
        toRemove.push(req.id)
        req.reject(new DOMException('请求已取消', 'AbortError'))
      }
    }
    this.queue = this.queue.filter((r) => !toRemove.includes(r.id))
  }

  /** 处理队列：有可用槽位时取下一个排队请求执行 */
  private processQueue(): void {
    while (
      this.activeSlots.length < this.config.maxConcurrent &&
      this.queue.length > 0
    ) {
      // 从队列头部取出（已按优先级排序）
      const next = this.queue.shift()!
      this.executeQueued(next)
    }
  }

  /** 执行排队的请求 */
  private async executeQueued<T>(request: QueuedRequest<T>): Promise<void> {
    // 检查是否已被取消
    if (request.signal?.aborted) {
      request.reject(new DOMException('请求已取消', 'AbortError'))
      return
    }

    const slot = this.acquireSlot()
    try {
      const result = await this.executeWithTimeout(
        request.execute,
        this.config.defaultTimeoutMs,
        request.signal,
      )
      request.resolve(result)
    } catch (error) {
      request.reject(error instanceof Error ? error : new Error(String(error)))
    } finally {
      this.releaseSlot(slot)
      this.processQueue()
    }
  }

  /** 带超时执行的包装 */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<T> {
    if (timeoutMs <= 0) {
      // 无超时限制
      return fn()
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`请求超时（${timeoutMs / 1000}s）`))
      }, timeoutMs)
    })

    const abortPromise = signal
      ? new Promise<never>((_, reject) => {
          const onAbort = () => {
            reject(new DOMException('请求已取消', 'AbortError'))
          }
          if (signal.aborted) {
            onAbort()
          } else {
            signal.addEventListener('abort', onAbort, { once: true })
          }
        })
      : null

    try {
      const race: Promise<T> = abortPromise
        ? Promise.race([fn(), timeoutPromise, abortPromise])
        : Promise.race([fn(), timeoutPromise])

      return await race
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }
}

// ===== 全局单例（供 LLM 控制器使用） =====

/** LLM 专用并发控制器实例 */
export const llmConcurrencyController = new ConcurrencyController({
  maxConcurrent: 3,
  maxQueueSize: 50,
  defaultTimeoutMs: 120_000,
})
