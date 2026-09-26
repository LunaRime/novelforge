/**
 * 前缀记账（B 档第二轮 B4）
 *
 * 背景：`rollingSummary` 注入 system 尾部 → 每轮压缩都改写前缀、缓存必然失效；
 * 而引擎注释声称"前缀稳定"（`agent-engine.ts` 的降档重试注释）却无任何校验。
 *
 * 本模块**只记账**（用户拍板：不做硬拒绝）—— NF 的摘要每轮都会进 system，
 * 硬拒绝会堵死正常对话；先把"前缀变了、命中归零"变成可见事实。
 *
 * 哈希用 FNV-1a 双拼接（同步、零依赖）。记账不需要抗碰撞强度：漏检只影响观测精度。
 */

/** 指纹长度（双 FNV-1a 拼接后截断为 12） */
const FINGERPRINT_LEN = 12

function fnv1a(input: string, seed: number): number {
  let h = seed
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/**
 * 计算 **system 段**的前缀指纹（空文本 → 空串，调用方据此跳过记账）。
 * ⚠️ 只传 system 文本 —— 含 history/user 会让指纹每轮必变、告警沦为噪音。
 */
export function computePrefixFingerprint(systemText: string): string {
  if (!systemText) return ''
  const a = fnv1a(systemText, 0x811c9dc5).toString(16).padStart(8, '0')
  const b = fnv1a(systemText, 0x01234567).toString(16).padStart(8, '0')
  return `${a}${b}`.slice(0, FINGERPRINT_LEN)
}

/**
 * 比较两轮的前缀。
 * 接**明文**而非指纹 —— 指纹不可比长度，而"共享了多少字符"必须按字符算。
 * `prev` 为空表示首轮 → `changed: false`（不告警）。
 */
export function comparePrefix(prev: string, current: string): { changed: boolean; sharedChars: number } {
  if (!prev) return { changed: false, sharedChars: 0 }
  if (prev === current) return { changed: false, sharedChars: 0 }
  let shared = 0
  const max = Math.min(prev.length, current.length)
  while (shared < max && prev[shared] === current[shared]) shared++
  return { changed: true, sharedChars: shared }
}
