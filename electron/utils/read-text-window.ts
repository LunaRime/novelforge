/**
 * 超大文本文件窗口流式扫描（C1，CC 对比 §三.9 剩余）
 *
 * 只累计 [offset, offset+limit) 字符窗口内的内容，窗口外字符仅计数（计数即丢弃，不持有）——
 * 读 100GB 文件的首行窗口不会把文件载入内存，RSS 有界。
 *
 * 窗口口径与渲染层 read_file 的 offset/limit 契约一致：JS string.length（UTF-16 code unit）。
 * 多字节字符跨 chunk 边界用 StringDecoder 防御性解码（字符串块与 Buffer 块均支持）：
 * 真实 fs 字符串模式流内部已用 StringDecoder 保证不切码点，本模块对 Buffer 块同样处理。
 *
 * 依赖注入（fileSize / createReadStream）便于纯 node 单测用 Mock 文件系统层模拟 100GB 文件；
 * 生产默认 node:fs。本模块不依赖 electron（fs-controller 之外的纯工具）。
 */
import { createReadStream as fsCreateReadStream, promises as fsPromises } from 'node:fs'
import { Readable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'

export interface ReadTextWindowDeps {
  /** 文件字节大小（EOF 判定：已读字节 ≥ size ⇔ 已消费到文件尾） */
  fileSize: (filePath: string) => Promise<number>
  /** 只读流：产出 utf-8 文本的 Buffer 块或字符串块（与 fs 字符串模式语义兼容） */
  createReadStream: (filePath: string) => Readable
}

export interface ScanTextWindowResult {
  /** 窗口内内容（[offset, offset+limit)，≤ limit code units；offset 越界时为 ''） */
  content: string
  /** 是否扫到文件尾（true ⇔ totalChars 可知） */
  eof: boolean
  /** 文件总字符数（仅 eof 时可知；窗口早停截断时为 undefined） */
  totalChars: number | undefined
  /** 已扫描字符数（含窗口外仅计数的部分）——测试/诊断用 */
  scannedChars: number
}

const defaultDeps: ReadTextWindowDeps = {
  fileSize: async (filePath: string) => (await fsPromises.stat(filePath)).size,
  createReadStream: (filePath: string) =>
    fsCreateReadStream(filePath, { encoding: 'utf8' }) as unknown as Readable,
}

/**
 * 从文件开头流式扫描，返回 [offset, offset+limit) 字符窗口。
 * - 窗口在到达 limit 前遇文件尾（eof=true）：totalChars = 全文件字符数（精确）；
 * - 窗口提前填满但文件未到尾（eof=false）：立即停止消费（RSS 有界），totalChars=undefined。
 * offset/limit 必须已清洗为非负整数 / ≥1 整数（调用方负责，本函数信任入参）。
 */
export async function scanTextWindow(
  filePath: string,
  offset: number,
  limit: number,
  deps: ReadTextWindowDeps = defaultDeps,
): Promise<ScanTextWindowResult> {
  const size = await deps.fileSize(filePath)
  const stream = deps.createReadStream(filePath)
  const decoder = new StringDecoder('utf8')
  const parts: string[] = []
  let partsChars = 0
  let pos = 0 // 已消费 code units（窗口外部分仅计数，不持有）
  let bytes = 0
  let abortedEarly = false
  let eof = false
  // 消费一段已解码文本：只累计与 [offset, offset+limit) 相交的片段，其余仅推进 pos
  const consumeText = (s: string): void => {
    if (s.length === 0) return
    const chunkEnd = pos + s.length
    if (partsChars < limit && chunkEnd > offset) {
      const from = Math.max(0, offset - pos)
      const to = Math.min(s.length, from + (limit - partsChars))
      if (to > from) {
        parts.push(s.slice(from, to))
        partsChars += to - from
      }
    }
    pos = chunkEnd
  }
  try {
    for await (const chunk of stream) {
      const s = typeof chunk === 'string' ? chunk : decoder.write(chunk as Buffer)
      bytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : (chunk as Buffer).byteLength
      consumeText(s)
      if (partsChars >= limit) {
        // 窗口已满：恰好消费到文件尾（bytes ≥ size）⇔ eof；否则文件更大 → 早停截断
        if (bytes >= size) eof = true
        abortedEarly = true
        break
      }
    }
    if (!abortedEarly) {
      // 迭代自然结束 = 读到了文件尾；冲刷 decoder 可能残留的不完整码点（Buffer 块防御路径）
      consumeText(decoder.end())
      eof = true
    }
  } finally {
    // 早停清理（幂等；Node 异步迭代 break 通常已 destroy，此处兜底防 fd 泄漏）
    if (!stream.destroyed) stream.destroy()
  }
  return {
    content: parts.join(''),
    eof,
    totalChars: eof ? pos : undefined,
    scannedChars: pos,
  }
}
