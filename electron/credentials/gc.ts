/**
 * 孤儿 ref 回收（模型管理 v3 终审小修④）—— 删除路径的 gc。
 *
 * **问题**：ref 是**全局命名空间**（它就是环境变量名）。删条目 / 删账户只清配置，凭据库里
 * 那条值没人再引用却还占着名字；而 `deriveCredentialRef` 的 taken 取自凭据库 ∪ 账户 ∪ 条目
 * —— 死 ref 于是**永久占住裸名**：下一个同 provider 的条目只能拿到 `_2`，用户在 shell 里
 * 设的裸名（`OPENAI_API_KEY`）从此不再命中。
 *
 * **判据**：凭据库的全部 ref 减去「账户 ∪ 全部条目」的引用集合，差集即孤儿。
 * 三条边界（每一条都对应一次真实的误删风险）：
 *  - **账户的 ref 永远算被引用**，与它的 `modelNames` 无关：空/缺省 = 继承态，这时没有派生
 *    条目，但账户本身就是那条 ref 的引用者 —— 只看派生条目会把账户的钥匙删掉；
 *  - 派生条目与其账户**共享** ref，手工条目也可能用着同名 ref → 以「账户 ∪ 条目」并集判定，
 *    某一侧还在用就不动；
 *  - **env 影子跳过**（`describe` 的 `writable === false`）：那条值由环境提供、不归应用管
 *    （写了也不生效），删了只会在用户去掉环境变量/换机器时表现成密钥失踪。
 *
 * **时机**：只在 `llm:delete-model` / `llm:delete-provider` 的 mutation **成功之后**调用，
 * 且**在写队列任务之外**（任务内 await 同一个队列的任务 = 自死锁；本模块整个是同步的，
 * 不碰 `serialize`）。删除是低频动作，孤儿最多活到下一次删除。
 *
 * **失败不阻断**：删条目已经成功了，回收不成功只是回到修复前的状态（留日志即可）。
 *
 * 已知窗口（有意不处理）：迁移若在「凭据已写、配置文件还没写回」之间中断，那几个 ref 会短暂
 * 表现为孤儿 —— 但它们对应的**明文仍在配置文件里**，懒迁移下一次会原样搬回来（不丢密钥），
 * 而 gc 只在删除**之后**跑，窗口极窄且可自愈。
 */

import type { ModelProfile } from '../../src/shared/ipc-channels'
import { MODELS_CONFIG_PATH, readJsonFile, readProvidersFile } from '../utils/config-utils'
import { safeErrorMessage } from '../utils/error-utils'
import { logger } from '../utils/logger'
import { describeCredentials } from './resolve'
import { readCredentialFile, unsetStoredValue } from './store'

/**
 * 仍被引用的 ref 全集：**账户 ∪ 全部条目**（派生条目与手工条目一视同仁）。
 *
 * 两处读都是**裸读**（不进队列、不触发懒迁移的写盘）：这只是删除后的一次回收，
 * 不该顺带写任何文件；拿到的快照晚一拍也无所谓（见文件头「时机」）。
 */
function collectReferencedRefs(): Set<string> {
  const referenced = new Set<string>()
  for (const account of readProvidersFile().accounts) {
    if (account.apiKeyRef) referenced.add(account.apiKeyRef)
  }
  for (const model of readJsonFile<ModelProfile[]>(MODELS_CONFIG_PATH, [])) {
    if (model.apiKeyRef) referenced.add(model.apiKeyRef)
  }
  return referenced
}

/**
 * 回收无人引用的 ref（幂等；**永不抛**）。返回被清掉的 ref（调用方记日志、用例断言）。
 *
 * 一个 ref 被 unset 失败（磁盘满/权限）只留 warn 并继续下一个：删配置已经成功，
 * 这次回收失败不该让调用方的成功变成失败。
 */
export function gcOrphanRefs(): string[] {
  try {
    const refs = Object.keys(readCredentialFile().refs)
    if (refs.length === 0) return []

    const referenced = collectReferencedRefs()
    const orphans = refs.filter((ref) => !referenced.has(ref))
    if (orphans.length === 0) return []

    const info = describeCredentials(orphans)
    const removed: string[] = []
    for (const ref of orphans) {
      // env 影子：值由环境提供（库里的那份写了也不生效）→ 不归本页删除
      if (info[ref]?.writable === false) continue
      try {
        unsetStoredValue(ref)
        removed.push(ref)
      } catch (error) {
        logger.warn('Credentials', `[gc] unset orphan ref failed: ${ref} (${safeErrorMessage(error)})`)
      }
    }
    return removed
  } catch (error) {
    logger.warn('Credentials', `[gc] orphan ref sweep failed: ${safeErrorMessage(error)}`)
    return []
  }
}
