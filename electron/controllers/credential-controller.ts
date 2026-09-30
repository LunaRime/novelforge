/**
 * 凭据层 IPC 控制器（模型管理 v3 §4.1）—— `credential:describe` / `credential:set` / `credential:unset`。
 *
 * 只做三件事：**校验 → 影子判定 → 转交 store**。加解密、文件形状、缓存都在
 * `electron/credentials/`（本文件不 import secure-config，密文不出这一层）。
 *
 * 拒因用**码**而非文案（`'keyBlank' | 'keyIllegalCharacters' | 'envShadowed'`）：
 * `keyBlank`/`keyIllegalCharacters` 与渲染层行内红字（`apiKeyFailure`，T6）是**同一套码**，
 * 渲染层映射到 settings 分片文案即可；主进程不拼句子，i18n 语言就不会由主进程决定。
 *
 * ⚠️ 本文件注册的通道目前**没有调用方**（接线在后续任务：账户删除→unset、应用→set、设置段→describe）；
 *    `guardedHandle` 的注册与策略表登记现在就位，是为了让「通道已存在但权限未定」的窗口期为零。
 */
import { guardedHandle } from '../security/ipc-guard'
import { apiKeyFailure } from '../../src/shared/credential-rules'
import { describeCredentials, describeFrom } from '../credentials/resolve'
import { setStoredValue, unsetStoredValue } from '../credentials/store'
import { safeErrorMessage } from '../utils/error-utils'
import { logger } from '../utils/logger'

const envSource = (name: string): string | undefined => process.env[name]

/**
 * env 影子 = 同名环境变量非空（写了也不生效）。
 * 判据复用 `describeFrom` 的 `writable` 语义 —— 「影子」的定义只此一处，set/unset/describe 不会漂移。
 */
function isEnvShadowed(ref: string): boolean {
  return describeFrom([ref], envSource, () => undefined)[ref].writable === false
}

export function registerCredentialController(): void {
  // 状态查询：只回 configured/source/writable，**永不回传值**（类型上就没有值字段）
  guardedHandle('credential:describe', async (_event, refs: string[]) => describeCredentials(refs))

  guardedHandle('credential:set', async (_event, ref: string, value: string) => {
    const failure = apiKeyFailure(value)
    if (failure !== undefined) return { success: false, error: failure }
    // 空 = 不提供（§4.4）：保留已存值、不写盘 —— 只写密钥框在这种情形下什么都不该发生
    if (value.length === 0) return { success: true }
    if (isEnvShadowed(ref)) return { success: false, error: 'envShadowed' }
    try {
      setStoredValue(ref, value)
      return { success: true }
    } catch (error) {
      // 写盘失败（writeJsonFile 会 rethrow）：必须留日志，否则渲染层只有一行 toast
      logger.error('Credential', `[set] 写入失败 ref=${ref}: ${safeErrorMessage(error)}`)
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  guardedHandle('credential:unset', async (_event, ref: string) => {
    // env 影子时同样拒绝（§4.4）：要求「让该 ref 变成未配置」而这个目标达不到，
    // 返回成功才是撒谎（删除账户流程会据此中止并保留行，见 §4.7）
    if (isEnvShadowed(ref)) return { success: false, error: 'envShadowed' }
    try {
      unsetStoredValue(ref)
      return { success: true }
    } catch (error) {
      logger.error('Credential', `[unset] 删除失败 ref=${ref}: ${safeErrorMessage(error)}`)
      return { success: false, error: safeErrorMessage(error) }
    }
  })
}
