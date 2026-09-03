/**
 * 工作流任务输出落盘（M2，对齐 CC diskOutput.ts + TaskOutput.ts，CC 对比 §三.4）
 *
 * 设计裁决（task-M2-report）：
 * - **双轨**：内存流式（step.result）保持不变，本模块是**补充持久通道**——
 *   渲染层在既有 100ms 共享 flush 点把同一文本镜像到文件（崩溃恢复 + 尾部续读）；
 * - **'w' 标志 + 显式字节偏移**：libuv 'a'/O_APPEND 在 MSYS2/Cygwin 有探测坑（静默丢输出），
 *   因此打开一律 `fsPromises.open(path, 'w')`（截断重建），后续每次写用显式 byte offset
 *   （不依赖 fd 隐式位置推进）；重开即覆盖 = 同 run 崩溃重启后旧文件被新输出截断重写；
 * - **目录/命名**：`{VELA_HOME}/workflow-output/<runId>/<stepIndex>.txt`——runId 为 UUID 天然
 *   分目录（任务级清理 = 删目录），stepIndex.txt = 每步一份（崩溃后按 run+step 续读）；
 * - **生命周期**：任务级删除（完成/取消时渲染层调 delete-run）；崩溃残留由启动 sweep 兜底
 *   （超龄目录清理，保留窗口内供恢复续读）；
 * - **每 key 串行队列**：同一步骤的多次 append IPC 可能并发到达，链式排队保证字节序；
 * - 不依赖 electron（纯 node:fs），vitest 可直接以临时目录单测（与 read-text-window 同范式）。
 */
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import type { WorkflowOutputTailData, WorkflowOutputTailOptions } from '../../src/shared/ipc-channels'

/** runId 白名单：randomUUID 形态（hex + 连字符），防路径穿越（IPC 入参不可信） */
const RUN_ID_RE = /^[a-zA-Z0-9-]{8,64}$/

/** 单文件最大可写步数防护（stepIndex 合法范围） */
const STEP_INDEX_MAX = 10_000

/** tail 字节窗口默认值（CC TaskOutput tail 4KB） */
const DEFAULT_TAIL_BYTES = 4096
/** tail 行数上限默认值（CC CircularBuffer 最近 1000 行语义） */
const DEFAULT_TAIL_LINES = 1000

/** 进行中的步骤写句柄（key = `${runId}:${stepIndex}`） */
interface OpenStepWriter {
  handle: fsPromises.FileHandle
  /** 已写字节数（下一次写的显式偏移 = 本值） */
  bytes: number
}

/**
 * 计算「包含字节位置 cut 的 UTF-8 字符」的起始偏移，保证窗口解码不产生半截码点。
 * prev = 文件 [prevStart, prevStart+prev.length) 的字节（一般为 cut 前 4 字节小窗），
 * 返回应作为读取起点的绝对字节偏移（≤ cut，最多提前 3 字节）。
 */
export function alignUtf8WindowStart(prev: Buffer, prevStart: number, cut: number): number {
  // 从 cut 前一个字节向前找 lead（连续续字节最多 3 个——UTF-8 最长 4 字节）
  // ⚠️ prev 是 [prevStart, prevStart+len) 的小窗 Buffer——索引必须相对 prevStart（W-1 实测：绝对索引越界
  // 读到 undefined，对齐失效 → 半截多字节字符解码出 U+FFFD 替换符）
  let i = cut - 1
  let back = 0
  while (i >= prevStart && back < 3 && (prev[i - prevStart]! & 0xC0) === 0x80) {
    i -= 1
    back += 1
  }
  if (i >= prevStart) {
    const b = prev[i - prevStart]!
    let need = 1
    if ((b & 0xE0) === 0xC0) need = 2
    else if ((b & 0xF0) === 0xE0) need = 3
    else if ((b & 0xF8) === 0xF0) need = 4
    // 该字符 [i, i+need) 跨越 cut → 从字符起点读，避免半截字节解码出替换符
    if (i + need > cut) return i
  }
  return cut
}

/** 校验 runId / stepIndex 入参合法性（非法返回 null，防御路径穿越） */
function sanitizeStepRef(runId: string, stepIndex: number): { runId: string; stepIndex: number } | null {
  if (typeof runId !== 'string' || !RUN_ID_RE.test(runId)) return null
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex > STEP_INDEX_MAX) return null
  return { runId, stepIndex }
}

/**
 * 工作流任务输出文件仓库（主进程单例；测试可用临时目录建新实例模拟进程重启崩溃恢复）。
 */
export class WorkflowOutputFileStore {
  /** 打开中的步骤写句柄（key = `${runId}:${stepIndex}`） */
  private readonly openWriters = new Map<string, OpenStepWriter>()
  /** 每 key 写队列（链式串行，保证同 key 并发 append 的字节序） */
  private readonly writeQueues = new Map<string, Promise<void>>()

  constructor(private readonly rootDir: string) {}

  /** run 目录绝对路径（含 runId 白名单清洗；非法 → null） */
  private runDir(runId: string): string | null {
    if (typeof runId !== 'string' || !RUN_ID_RE.test(runId)) return null
    return path.join(this.rootDir, runId)
  }

  private stepPath(runId: string, stepIndex: number): string | null {
    const ref = sanitizeStepRef(runId, stepIndex)
    if (!ref) return null
    return path.join(this.rootDir, ref.runId, `${ref.stepIndex}.txt`)
  }

  private stepKey(runId: string, stepIndex: number): string {
    return `${runId}:${stepIndex}`
  }

  private async closeWriter(key: string): Promise<void> {
    const writer = this.openWriters.get(key)
    if (!writer) return
    this.openWriters.delete(key)
    try { await writer.handle.close() } catch { /* 关闭失败无害（句柄已释放） */ }
  }

  /**
   * 追加一段文本到 (runId, stepIndex) 的输出文件。
   * - 首次调用：mkdir run 目录 + `open(path, 'w')`（截断重建，'a' 探测坑规避）；
   * - 后续：显式 byte offset 追加（write 后按 bytesWritten 推进自己的游标）；
   * - 同 key 并发 append 由链式队列串行化（字节序 = 调用序）。
   */
  append(runId: string, stepIndex: number, text: string): Promise<{ success: boolean; error?: string }> {
    if (typeof text !== 'string' || text.length === 0) return Promise.resolve({ success: true })
    if (!sanitizeStepRef(runId, stepIndex)) {
      return Promise.resolve({ success: false, error: 'invalid step ref' })
    }
    const key = this.stepKey(runId, stepIndex)
    const prev = this.writeQueues.get(key) ?? Promise.resolve()
    const task = prev.then(async () => {
      try {
        await this.doAppend(runId, stepIndex, key, text)
      } catch (error) {
        // 写失败：释放句柄，下次 append 以 'w' 重开（截断重写——崩溃后语义即重开）
        await this.closeWriter(key).catch(() => {})
        throw error
      }
    })
    // 队列记录成功路径本身（不吞错：append 返回值由调用方 await 得到）
    const queued = task.then(() => {}, () => {})
    this.writeQueues.set(key, queued)
    return task.then(
      () => ({ success: true }),
      (error) => ({ success: false, error: error instanceof Error ? error.message : String(error) }),
    )
  }

  private async doAppend(runId: string, stepIndex: number, key: string, text: string): Promise<void> {
    let writer = this.openWriters.get(key)
    if (!writer) {
      const runDir = this.runDir(runId)
      if (!runDir) return
      await fsPromises.mkdir(runDir, { recursive: true })
      const filePath = path.join(runDir, `${stepIndex}.txt`)
      // 'w' 标志：截断/创建（CC 血泪教训——libuv 'a' 在 MSYS2/Cygwin 探测失败会静默丢全部输出）
      const handle = await fsPromises.open(filePath, 'w')
      writer = { handle, bytes: 0 }
      this.openWriters.set(key, writer)
    }
    const buf = Buffer.from(text, 'utf8')
    if (buf.length === 0) return
    const { bytesWritten } = await writer.handle.write(buf, 0, buf.length, writer.bytes)
    writer.bytes += bytesWritten
  }

  /** 释放某步骤的写句柄（步骤结束/取消时释放 fd；文件保留供崩溃恢复直到 deleteRun） */
  async closeStep(runId: string, stepIndex: number): Promise<void> {
    if (!sanitizeStepRef(runId, stepIndex)) return
    await this.closeWriter(this.stepKey(runId, stepIndex))
  }

  /**
   * 读 (runId, stepIndex) 输出文件尾部窗口：
   * - 默认尾部 4KB + 最近 1000 行（UI 1s 轮询显示，对齐 CC TaskOutput）；
   * - `full: true` = 整文件读（崩溃恢复续读填充 step.result）；
   * - 字节窗口起点按 UTF-8 字符对齐（防半截码点）；首行若被窗口截断则丢弃到行首
   *   （尾部视图只显示完整行，与 CC tail 语义一致）。
   */
  async readTail(runId: string, stepIndex: number, options?: WorkflowOutputTailOptions): Promise<WorkflowOutputTailData> {
    const filePath = this.stepPath(runId, stepIndex)
    if (!filePath) {
      return { success: false, exists: false, content: '', totalBytes: 0, truncated: false, error: 'invalid step ref' }
    }
    let size: number
    try {
      size = (await fsPromises.stat(filePath)).size
    } catch {
      return { success: true, exists: false, content: '', totalBytes: 0, truncated: false }
    }
    const full = options?.full === true
    const maxBytes = full ? Infinity : options?.maxBytes && options.maxBytes > 0 ? options.maxBytes : DEFAULT_TAIL_BYTES
    const maxLines = full ? Infinity : options?.maxLines && options.maxLines > 0 ? options.maxLines : DEFAULT_TAIL_LINES
    if (size === 0) return { success: true, exists: true, content: '', totalBytes: 0, truncated: false }

    let start = full ? 0 : Math.max(0, size - maxBytes)
    // 字节窗口起点对齐到字符边界（读 cut 前 4 字节判定 lead/续字节）
    if (!full && start > 0) {
      const preStart = Math.max(0, start - 4)
      const preLen = start - preStart
      const pre = Buffer.alloc(preLen)
      const handle = await fsPromises.open(filePath, 'r')
      try {
        await handle.read(pre, 0, preLen, preStart)
        start = alignUtf8WindowStart(pre, preStart, start)
      } finally {
        await handle.close()
      }
    }

    const readLen = size - start
    const buf = Buffer.alloc(readLen)
    let handle: fsPromises.FileHandle
    try {
      handle = await fsPromises.open(filePath, 'r')
    } catch {
      // 文件在 stat 后被删（任务级清理竞态）→ 视为不存在
      return { success: true, exists: false, content: '', totalBytes: 0, truncated: false }
    }
    let content: string
    try {
      await handle.read(buf, 0, readLen, start)
      content = buf.toString('utf8')
    } finally {
      await handle.close()
    }

    let truncated = false
    // 字节窗口起点 > 0（被截断）→ 恒置 truncated（tail 视图 = 非完整全文）：
    // 首行不完整时丢到下一个换行（只显示完整行）；单行超长窗口内无换行可丢（nl===-1）
    // 时保留半截行内容但 truncated 仍为 true——与「tail 只显示完整尾部」的注释语义一致
    if (!full && start > 0) {
      truncated = true
      const nl = content.indexOf('\n')
      if (nl !== -1) content = content.slice(nl + 1)
    }
    // 行窗口：保留最近 maxLines 行
    if (Number.isFinite(maxLines) && content.length > 0) {
      const lines = content.split('\n')
      if (lines.length > maxLines) {
        content = lines.slice(-maxLines).join('\n')
        truncated = true
      }
    }
    return { success: true, exists: true, content, totalBytes: size, truncated }
  }

  /**
   * 任务级清理：删除整 run 输出目录（完成/取消后由渲染层调用）；
   * 先释放该 run 所有打开的写句柄（防 Windows fd 占用删除失败），再递归删除。
   *
   * I-1（评审修复）：步骤完成/取消时最后一发镜像 append 与 delete-run IPC 可同 tick 到达——
   * 两个 async handler 并发。必须先收齐该 run 名下 writeQueues 的**全部排队任务**
   * （await 其落盘完成或失败）再关句柄 + rm：否则 rm 后仍排队的 append 会
   * mkdir + open('w') 重建目录（输出文件复活），或 Windows 下句柄未释放 rm 失败，
   * 「任务级清理」不变量不成立。IPC 管道保序 + append 入队同步于 handler 入口 →
   * 快照覆盖 delete 之前已发送的全部 append。
   */
  async deleteRun(runId: string): Promise<{ success: boolean; error?: string }> {
    const runDir = this.runDir(runId)
    if (!runDir) return { success: false, error: 'invalid run id' }
    // ① 收齐排队任务（等待落盘完成或失败——writeQueues 存的是吞错链，永不自拒）
    const queued: Promise<unknown>[] = []
    for (const [key, task] of this.writeQueues) {
      if (key.startsWith(`${runId}:`)) queued.push(task)
    }
    if (queued.length > 0) await Promise.allSettled(queued)
    // ② 排队任务已结束：清理该 run 的队列条目（防 Map 泄漏——条目指向已 settle 的链）
    for (const key of [...this.writeQueues.keys()]) {
      if (key.startsWith(`${runId}:`)) this.writeQueues.delete(key)
    }
    // ③ 关闭该 run 名下所有写句柄（防 Windows fd 占用删除失败）
    for (const [key, writer] of [...this.openWriters]) {
      if (key.startsWith(`${runId}:`)) {
        this.openWriters.delete(key)
        try { await writer.handle.close() } catch { /* ignore */ }
      }
    }
    try {
      await fsPromises.rm(runDir, { recursive: true, force: true })
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * 启动兜底清理（崩溃残留）：删除 mtime 早于 now-olderThanMs 的 run 目录，
   * 保留窗口内的目录供崩溃恢复续读。返回删除的目录数。
   */
  async sweep(olderThanMs: number): Promise<number> {
    let entries: fs.Dirent[]
    try {
      entries = await fsPromises.readdir(this.rootDir, { withFileTypes: true })
    } catch {
      return 0 // 根目录不存在 = 尚无输出
    }
    const deadline = Date.now() - olderThanMs
    let removed = 0
    for (const entry of entries) {
      if (!entry.isDirectory() || !RUN_ID_RE.test(entry.name)) continue
      const dirPath = path.join(this.rootDir, entry.name)
      try {
        const stat = await fsPromises.stat(dirPath)
        if (stat.mtimeMs < deadline) {
          await this.deleteRun(entry.name)
          removed += 1
        }
      } catch { /* 单个目录异常不影响其他清理 */ }
    }
    return removed
  }

  /** 释放全部写句柄（测试收尾 / 主进程退出路径） */
  async closeAll(): Promise<void> {
    const writers = [...this.openWriters.values()]
    this.openWriters.clear()
    await Promise.all(writers.map(w => w.handle.close().catch(() => {})))
  }
}
