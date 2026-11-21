/** 密钥/令牌脱敏（日志与错误详情展示前必须经过） */
export function redactSecrets(text: string): string {
  if (!text) return ''
  return text
    // Authorization 整行值（含 Basic/Bearer scheme 与凭据）
    .replace(/\b(authorization|proxy-authorization)\s*[:=]\s*[^\r\n,;}]+/gi, '$1=***')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 ***')
    .replace(/\bsk-[A-Za-z0-9._-]{8,}\b/g, 'sk-***')
    // JSON 引号值 / 常见字段名 / access_token 等下划线变体
    .replace(
      /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|x-api-key|token|password|key)\b(\s*["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi,
      '$1$2***',
    )
    // URL query 中的 key/token
    .replace(/([?&](?:key|token|api[_-]?key|access[_-]?token|refresh[_-]?token)=)[^&#\s]+/gi, '$1***')
}
