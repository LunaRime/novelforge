/**
 * 串行写队列（模型管理 v3 §5）—— 核销挂起项「整份 JSON 读-改-写不可并发」。
 *
 * **问题**：配置文件的写路径都是「读全量 → 改 → 写全量」（models.json / providers.json）。
 * 两个并发调用各自读到同一份旧快照，各自改一处，后者覆盖前者 → **丢更新**（静默，最难排查）。
 * 真机场景：设置页保存账户的同时工作流在改模型列表、两个窗口同时编辑（spec §5 把它列为
 * 「编辑卡打开时记 revision」之外的另一半保障）。
 *
 * **解法**：按 key（文件）串行化 —— 同一个 key 的任务排队执行，任务体里做完整次「读→改→写」。
 * 注意本模块**不提供**锁原语，只保证「同 key 的任务不重叠」；正确性取决于调用方把整个
 * 读-改-写放进**一个** task 里（半个任务 = 没保护）。
 *
 * **错误纪律**：任务抛错要**原样透传**给调用方（写盘失败必须能被 IPC 层报给用户），
 * 但**不能断链** —— 一次失败之后，该 key 的后续任务必须照常执行（否则一次磁盘故障会让
 * 该文件此后的所有保存永久静默跳过）。
 */
import { logger } from './logger'

/** key → 该 key 已完成任务链的尾（吞掉错误，仅供排队；Map 在链空后清理，不会无限增长） */
const tails = new Map<string, Promise<void>>()

/**
 * 把 `task` 排到 `key` 的队尾；返回 task 自身的结果/异常。
 *
 * - 同 key：严格串行（后一个等前一个 settle，无论成败）
 * - 不同 key：互不影响（两个文件各排各的队）
 */
export function serialize<T>(key: string, task: () => T | Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve()
  const run = prev.then(() => task())

  // 队尾只用于排队，错误在这里被吞掉（调用方拿到的是 run 的异常）；
  // 链空即从 Map 移除，避免长跑进程里 key 只增不减。
  const tail: Promise<void> = run.then(
    () => undefined,
    (error) => {
      logger.warn('ConfigWriteQueue', `[serialize] task failed (key=${key}): ${String(error)}`)
    },
  )
  tails.set(key, tail)
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key)
  })

  return run
}
