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

/** 批量状态查询（`credential:describe` 的实现） */
export function describeCredentials(refs: string[]): Record<string, CredentialInfo> {
  return describeFrom(refs, envSource, readCredentialValue)
}
