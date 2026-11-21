import fs from 'node:fs/promises'
import path from 'node:path'
import { redactSecrets } from './redact-secrets'

const RECENT_DAYS = 7
const ENTRY_LIMIT = 200
const FILE_TAIL_BYTES = 512 * 1024
const DAILY_NAME = /^vela(?:-dev)?-\d{4}-\d{2}-\d{2}\.log$/
const ENTRY_PREFIX = /^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\] \[ERROR\s*\] \[([^\]]{1,100})\] (.*)$/

function sanitizeLine(line: string): string {
  // 过滤前缀、地址和查询参数后再截断，避免在截断处留下半个密钥。
  const masked = line.replace(
    /\b((?:set-cookie|cookie|password|client[_-]?secret|api[_-]?key|(?:access[_-]?|refresh[_-]?)?token)["']?\s*[:=]\s*)(["'])(?:\\.|(?!\2).)*?\2/gi,
    '$1$2***$2',
  )
  return redactSecrets(masked)
    .replace(/(https?:\/\/)[^/\s@]+@/gi, '$1[redacted]@')
    .replace(/(https?:\/\/[^\s"'<>?#]+)[?#][^\s"'<>]*/gi, '$1?[redacted]')
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, '[email]')
    .replace(/(?:\b[a-z]:[\\/]|\\\\)[^\r\n"'<>|,;]+/gi, '[local path]')
    .replace(/(^|[\s"'(=])\/(?:home|Users|tmp|private|var|mnt|media|opt)\/[^\r\n"'<>|,;]+/g, '$1[local path]')
    .slice(0, 1600)
}

async function readTail(file: string): Promise<string> {
  const handle = await fs.open(file, 'r')
  try {
    const { size } = await handle.stat()
    const offset = Math.max(0, size - FILE_TAIL_BYTES)
    const tail = Buffer.alloc(size - offset)
    const { bytesRead } = await handle.read(tail, 0, tail.length, offset)
    const text = tail.subarray(0, bytesRead).toString('utf8')
    if (offset === 0) return text
    const firstBreak = text.indexOf('\n')
    return firstBreak < 0 ? '' : text.slice(firstBreak + 1)
  } finally {
    await handle.close()
  }
}

/** 附件只收集最近的错误首行，避免将多行请求、响应和堆栈上下文一并打包。 */
export async function collectFeedbackErrors(logDirectories: string[], now = Date.now()): Promise<string[]> {
  const cutoff = now - RECENT_DAYS * 86_400_000
  const entries: Array<{ time: number; line: string }> = []

  for (const directory of logDirectories) {
    const files = await fs.readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    const recent = files.filter(file => file.isFile() && DAILY_NAME.test(file.name))
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(0, RECENT_DAYS + 2)
    for (const file of recent) {
      const text = await readTail(path.join(directory, file.name)).catch((error: NodeJS.ErrnoException) => {
        // 日志轮转和收集可能同时发生，跳过刚被删除的文件。
        if (error.code === 'ENOENT') return ''
        throw error
      })
      for (const line of text.split(/\r?\n/)) {
        const match = ENTRY_PREFIX.exec(line)
        if (!match) continue
        const time = Date.parse(match[1])
        if (!Number.isFinite(time) || time < cutoff || time > now) continue
        const source = sanitizeLine(match[2])
        const message = sanitizeLine(match[3])
        entries.push({ time, line: `[${match[1]}] [ERROR] [${source}] ${message}` })
      }
    }
  }
  return entries.sort((a, b) => b.time - a.time).slice(0, ENTRY_LIMIT).map(entry => entry.line)
}
