/**
 * 工作流任务输出落盘客户端（M2，CC §三.4 双轨补充通道）
 *
 * - `mirrorStepAppend`：渲染层在 workflow-store 既有 appendText 100ms 共享 flush 点调用，
 *   把同一文本镜像到主进程文件（fire-and-forget，失败静默——内存流式渲染不受影响）；
 * - `deleteRunOutput`：任务级清理（完成/取消后删除 run 目录，崩溃恢复前保留）；
 * - `readStepOutputTail`：tail 读（默认 4KB/最近 1000 行；full=true 供崩溃恢复续读）；
 * - `appendTailRing`：CC CircularBuffer「最近 1000 行」语义的纯函数——跨轮次把 tail 窗口
 *   新增行并入有界行环（去重靠窗口与环尾的重叠后缀；无重叠视为大跳跃直接并入并截断）。
 * 失败静默与既有 renderLog/ipc 惯例一致：落盘是补充通道，任何失败不得打断流式主路径。
 */
import { ipc } from './ipc-client'
import type { WorkflowOutputTailData, WorkflowOutputTailOptions } from '../shared/ipc-channels'

/** 镜像一段流式文本到 (runId, stepIndex) 输出文件（fire-and-forget，与内存写同频不同步等待） */
export function mirrorStepAppend(runId: string, stepIndex: number, text: string): void {
  if (!runId || typeof text !== 'string' || text.length === 0) return
  ipc.invoke('fs:workflow-output-append', runId, stepIndex, text).catch(() => {
    // 落盘失败不影响内存流式（双轨语义：文件是补充通道）
  })
}

/** 任务级清理：删除整 run 输出目录（完成/取消后；崩溃恢复需要文件 → 不提前删） */
export function deleteRunOutput(runId: string): void {
  if (!runId) return
  ipc.invoke('fs:workflow-output-delete-run', runId).catch(() => { /* 清理失败无害 */ })
}

/** 读步骤输出文件尾部窗口（失败降级为不存在——UI 兜底空态） */
export async function readStepOutputTail(
  runId: string,
  stepIndex: number,
  options?: WorkflowOutputTailOptions,
): Promise<WorkflowOutputTailData> {
  try {
    return await ipc.invoke('fs:workflow-output-tail', runId, stepIndex, options)
  } catch {
    return { success: false, exists: false, content: '', totalBytes: 0, truncated: false }
  }
}

/** 把 tail 窗口文本切成行（空串 → 空数组；尾随换行保留为空尾行，join 可还原） */
export function splitTailLines(content: string): string[] {
  if (content === '') return []
  return content.split('\n')
}

/**
 * 计算两轮 tail 窗口行之间的连续重叠数 o（重叠行数 = ring 中已包含、incoming 重新带回的行数）：
 * - 情形 A：ring 整体是 incoming 前缀（文件 ≤ 窗口增长——新窗口完整带回旧环）→ o = ring.length；
 * - 情形 B：ring 尾部与 incoming 头部连续（窗口随文件增长滑动，旧环尾部仍是新窗口开头）→ 后缀重叠；
 * - 其余 → 0（两次轮询间增长超过窗口 / 内容被覆盖，旧行已不可追）。
 */
function tailOverlap(ring: string[], incoming: string[]): number {
  if (ring.length === 0 || incoming.length === 0) return 0
  if (ring.length <= incoming.length) {
    let headEqual = true
    for (let i = 0; i < ring.length; i++) {
      if (ring[i] !== incoming[i]) { headEqual = false; break }
    }
    if (headEqual) return ring.length
  }
  const maxSuffix = Math.min(ring.length, incoming.length)
  for (let o = maxSuffix; o > 0; o--) {
    let ok = true
    for (let i = 0; i < o; i++) {
      if (ring[ring.length - o + i] !== incoming[i]) { ok = false; break }
    }
    if (ok) return o
  }
  return 0
}

/**
 * 把一轮 tail 窗口的行并入有界行环（CircularBuffer 最近 N 行，CC TaskOutput 语义）：
 * - 有连续重叠 → 只追加新增行（文件小窗口增长 = 环整体被新窗口替换为超集，无重复）；
 * - 无重叠（轮询间隙增长超过窗口/内容被覆盖）→ 环整体作废，替换为最新窗口；
 * - 恒返回长度 ≤ cap 的行数组（跨轮累积 + 截断 = 始终持有「最近 ≤cap 行」）。
 */
export function appendTailRing(ring: string[], incoming: string[], cap: number): string[] {
  if (incoming.length === 0) return ring
  if (ring.length === 0) return incoming.slice(-cap)
  const overlap = tailOverlap(ring, incoming)
  if (overlap === 0) return incoming.slice(-cap)
  const merged = overlap >= ring.length ? incoming : [...ring, ...incoming.slice(overlap)]
  return merged.length > cap ? merged.slice(-cap) : merged
}
