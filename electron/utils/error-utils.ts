/**
 * 错误处理工具 — 安全的错误消息提取
 *
 * 替换 `String(error)` 模式，避免非 Error 对象产生无意义的 "[object Object]" 消息。
 * 优先级：Error.message → string → JSON.stringify → String
 */

/** 从任意 catch 值中提取可读错误消息 */
export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    // JSON.stringify(undefined) 返回 undefined（非字符串），需回退到 String()
    return JSON.stringify(error) ?? String(error)
  } catch {
    return String(error)
  }
}
