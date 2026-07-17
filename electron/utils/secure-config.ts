/**
 * 安全配置模块 — API 密钥加密存储
 *
 * 使用 Electron safeStorage API 对敏感字段（apiKey）进行加解密。
 * 加密后的值以 `ENC:` 前缀存储在 JSON 配置文件中。
 *
 * 兼容性：
 * - safeStorage 不可用时（如无桌面环境的 Linux），回退到 base64 编码（非安全，但至少非明文）
 * - 读取时自动检测明文 key（无 ENC: 前缀），自动迁移到加密格式
 */
import { safeStorage } from 'electron'
import { logger } from './logger'

const ENC_PREFIX = 'ENC:'

/** 检查加密是否可用 */
export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

/** 加密 API 密钥 */
export function encryptApiKey(plainKey: string): string {
  if (!plainKey) return plainKey

  try {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(plainKey)
      return ENC_PREFIX + encrypted.toString('base64')
    }
    // 回退：base64 编码（非安全，标记为 ENC:B64: 区分真正的加密）
    logger.warn('SecureConfig', 'safeStorage 不可用，API 密钥将使用 base64 编码存储（非加密）')
    return ENC_PREFIX + 'B64:' + Buffer.from(plainKey, 'utf-8').toString('base64')
  } catch (error) {
    logger.error('SecureConfig', `加密 API 密钥失败: ${error}`)
    // 加密失败时回退到 base64
    return ENC_PREFIX + 'B64:' + Buffer.from(plainKey, 'utf-8').toString('base64')
  }
}

/** 解密 API 密钥 */
export function decryptApiKey(encrypted: string): string {
  if (!encrypted) return encrypted

  // 明文 key（无 ENC: 前缀）→ 直接返回（向后兼容）
  if (!encrypted.startsWith(ENC_PREFIX)) {
    return encrypted
  }

  const payload = encrypted.slice(ENC_PREFIX.length)

  // base64 回退格式
  if (payload.startsWith('B64:')) {
    try {
      return Buffer.from(payload.slice(4), 'base64').toString('utf-8')
    } catch {
      logger.error('SecureConfig', '解码 base64 API 密钥失败')
      return encrypted
    }
  }

  // safeStorage 加密格式
  try {
    const buffer = Buffer.from(payload, 'base64')
    return safeStorage.decryptString(buffer)
  } catch (error) {
    logger.error('SecureConfig', `解密 API 密钥失败: ${error}`)
    // 解密失败时返回原始值（可能是旧格式导致）
    return encrypted
  }
}

/**
 * 检测 key 是否为明文（非加密格式）
 * 用于向后兼容：读取旧配置文件时自动迁移
 */
export function isPlaintextKey(key: string): boolean {
  return !!key && !key.startsWith(ENC_PREFIX)
}
