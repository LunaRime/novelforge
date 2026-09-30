/**
 * 凭据解析（模型管理 v3 §4.4）—— env 非空优先 → store；**每次调用即读**（热轮换）。
 *
 * 拆两层是刻意的：
 *   - `resolveFrom` / `describeFrom` 是**纯核心**（env / stored 都从参数注入）——
 *     单测不需要动 `process.env`、不需要打桩 electron，也不会碰到真实凭据文件；
 *   - `resolveCredential` / `describeCredentials` 只是把真实来源（`process.env` + store 缓存）接上。
 *
 * ⚠️ env 优先的语义边界（多账户）：查找**按 ref 精确匹配**，不做任何前缀/词干回退 ——
 * `OPENAI_API_KEY` 被 shell 设置时，只有 `OPENAI_API_KEY` 命中 env；
 * `OPENAI_API_KEY_2`（第二个账户）仍取 store 的值（Review Focus 2）。
 */
import type { CredentialInfo } from '../../src/shared/ipc-channels'
import { readCredentialValue } from './store'

/** 解析结果：值 + 来源（来源要回传，`describe` 与「env 影子」判定都靠它） */
export interface SourceResult {
  value: string
  source: 'env' | 'store'
}

export type EnvSource = (name: string) => string | undefined
export type StoredSource = (ref: string) => string | undefined

/** 非空（去空白后仍有内容）才算配置；空串/纯空白 = 未配置 */
function nonBlank(value: string | undefined): string | undefined {
  return value !== undefined && value.trim().length > 0 ? value : undefined
}

/**
 * 解析一个 ref：env 非空 → 命中（source='env'）；否则 store 非空 → 命中（source='store'）；
 * 都为空 → `undefined`。
 *
 * `stored` 抛错（解密失败）按**未配置**处理而非向上抛（Review Focus 3）：
 * 凭据是增强信息，一条坏密文不该让整次生成/探测崩掉 —— 让它表现成「没有 key」，
 * 由调用方给出「请配置密钥」这类可操作提示。
 */
export function resolveFrom(ref: string, env: EnvSource, stored: StoredSource): SourceResult | undefined {
  const envValue = nonBlank(env(ref))
  if (envValue !== undefined) return { value: envValue, source: 'env' }
  try {
    const storedValue = nonBlank(stored(ref))
    if (storedValue !== undefined) return { value: storedValue, source: 'store' }
  } catch { /* 解密失败：按未配置处理（日志由 secure-config 落） */ }
  return undefined
}

/**
 * 批量描述（**永不回传值**，§4.1）：`configured` = 上述解析是否命中；
 * `writable` = env 未影子（env 命中 → false，此时 set/unset 一律被拒，因为写了也不生效）。
 *
 * 未配置的项目 `source` 字段缺省（不写 undefined）——渲染层据此三态灯。
 */
export function describeFrom(
  refs: readonly string[],
  env: EnvSource,
  stored: StoredSource,
): Record<string, CredentialInfo> {
  const out: Record<string, CredentialInfo> = {}
  for (const ref of refs) {
    if (nonBlank(env(ref)) !== undefined) {
      out[ref] = { configured: true, source: 'env', writable: false }
      continue
    }
    const hit = resolveFrom(ref, env, stored)
    out[ref] = hit
      ? { configured: true, source: hit.source, writable: true }
      : { configured: false, writable: true }
  }
  return out
}

/** 真实 env 源（每次调用现读 —— 用户改了 shell 变量/重启了终端，下个请求就生效） */
const envSource: EnvSource = (name) => process.env[name]

/** 解析实际要用的密钥；`ref` 未分配（undefined）→ undefined */
export function resolveCredential(ref: string | undefined): string | undefined {
  if (ref === undefined) return undefined
  return resolveFrom(ref, envSource, readCredentialValue)?.value
}

/**
 * 取「本次请求实际要用的密钥」：按条目的 `apiKeyRef` 解析（env 非空 → store 非空）；
 * ref 未分配 / 解析不到 → **空串**（由调用方给出「请配置密钥」这类可操作提示）。
 *
 * v3 T5 起是 **ref-only**：过渡期的「明文回落」随 `ModelProfile.apiKey` 字段一起删除 ——
 * 密钥已全部搬进凭据库（T4），配置文件里没有可回落的明文，留着那条分支只会掩盖
 * 「迁移没跑成」这件事（现在它会表现成「无 key」，用户/日志看得见）。
 */
export function resolveModelKey(profile: { apiKeyRef?: string }): string {
  return resolveCredential(profile.apiKeyRef) ?? ''
}

/**
 * 本次请求实际要用的密钥：**草稿优先**（用户当场输入、trim 后非空）→ 否则按 ref 解析。
 *
 * 「草稿非空即胜出」是 v3 §4.7 的裁定（dsh 同款 typed key wins）：刚敲进去的键必须能被
 * 测试连接 / 获取模型 / 保存**当场验证**，而不是被已存的 ref 值悄悄顶掉 —— 后者是
 * 「改了密钥却一直在用旧的」这类最难自查的故障。空串/纯空白 = 没输入（不遮蔽 ref）。
 */
export function resolveRequestKey(ref: string | undefined, draft: string | undefined): string {
  const typed = draft?.trim()
  if (typed) return typed
  return resolveCredential(ref) ?? ''
}

/**
 * 出站剥离（v3 §4.7「渲染层剥离」）：把条目上**可能残留**的密钥字段删掉再交给渲染层。
 *
 * 类型上已经没有该字段，这里是**防御层**：迁移失败（或用户手改）的窗口里盘上仍有明文/密文，
 * 而「值不过境」不取决于迁移跑没跑成 —— 列表通道一律先剥再回。
 */
export function stripApiKey<T extends object>(entry: T): T {
  delete (entry as { apiKey?: unknown }).apiKey
  return entry
}

/** 批量状态查询（`credential:describe` 的实现） */
export function describeCredentials(refs: string[]): Record<string, CredentialInfo> {
  return describeFrom(refs, envSource, readCredentialValue)
}
