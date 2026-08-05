/**
 * 开发者模式外部 API 校验纯函数（无 electron 依赖，可单测）
 */

/** URL 白名单校验：仅 http/https（防 file://、ftp:// 等协议注入） */
export function isValidHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** path 相对路径校验：拒绝绝对 URL / 协议相对 //（防绕过 base URL 限制） */
export function isValidRelativePath(path: string): boolean {
  if (!path) return true // 空 path = 根路径
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('//')) return false
  // 拒绝协议注入（如 javascript:、data:）与危险协议
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path) && !path.startsWith('/')) return false
  return true
}

/** 拼接最终 URL（base 去尾斜杠 + path 加前导斜杠）；返回 null 表示非法 */
export function buildDevApiUrl(baseUrl: string, path: string): string | null {
  if (!isValidHttpUrl(baseUrl)) return null
  const cleanBase = baseUrl.replace(/\/+$/, '')
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  const url = `${cleanBase}${cleanPath}`
  return isValidHttpUrl(url) ? url : null
}

/** 响应体截断（超出 maxBytes 截断并追加提示） */
export function truncateResponse(buf: Buffer, maxBytes: number): { content: string; truncated: boolean } {
  const truncated = buf.length > maxBytes
  const content = buf.subarray(0, maxBytes).toString('utf-8')
  return {
    content: truncated ? `${content}\n\n[响应已截断：${buf.length} 字节 > ${maxBytes} 上限]` : content,
    truncated,
  }
}
