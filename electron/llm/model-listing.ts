import type { LLMModelCandidate } from '../../src/shared/ipc-channels'

/**
 * 拉取候选的解析工具（2026-09-28，对齐 deepseek-harness 的 readListing）：
 * 各家端点的容量字段拼写不一，统一从多拼写里取正值整数；无 id 行跳过；按 id 去重；保持端点顺序。
 */

/** 单条的容量字段多拼写解析；无效值（0/负数/NaN/非数字）一律丢弃 */
export function pickCapacity(entry: Record<string, unknown>): Pick<LLMModelCandidate, 'contextWindow' | 'maxTokens'> {
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined
  const limit = entry.limit as { context?: unknown; output?: unknown } | undefined
  const contextWindow = num(
    entry.context_length ?? entry.context_window ?? entry.max_input_tokens ?? entry.inputTokenLimit ?? limit?.context,
  )
  const maxTokens = num(entry.max_tokens ?? entry.max_output_tokens ?? entry.outputTokenLimit ?? limit?.output)
  return {
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
  }
}

/** 组装候选列表：无 id 跳过、按 id 去重（保留首个）、保持端点顺序 */
export function toCandidates(
  entries: Array<Record<string, unknown>>,
  idOf: (e: Record<string, unknown>) => string | undefined,
): LLMModelCandidate[] {
  const seen = new Set<string>()
  const out: LLMModelCandidate[] = []
  for (const e of entries) {
    const id = idOf(e)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ id, ...pickCapacity(e) })
  }
  return out
}

/**
 * 模型列表响应的**读取上限**（4MB，模型管理 v3 §5）。
 *
 * 这个端点是我们主动打给用户填的任意地址的：一个配错的网关可以回一份几百 MB 的体
 * （或一个无限流的错误页），整份 `res.json()` 进内存 = 主进程被一个按钮拖垮。
 * 4MB 对任何真实模型清单都绰绰有余（OpenRouter 全量清单约 200KB）。
 */
export const MAX_LISTING_BYTES = 4 * 1024 * 1024

/** 超限时抛出的错误（`{detail}` 会进 `error.modelListUnavailable` 的兜底文案） */
function tooLarge(maxBytes: number): Error {
  return new Error(`response too large (over ${String(Math.round(maxBytes / 1024 / 1024))}MB), read aborted`)
}

/**
 * 读一个模型列表响应并解成 JSON —— **带上限**。
 *
 * 先看 `content-length`（谎报/缺失时再按真实字节数边读边数），两条路都在超限时抛错；
 * 流式分支在抛错前 `cancel()`，不让连接空转到对端发完。
 */
export async function readListingJson(
  res: Response,
  maxBytes: number = MAX_LISTING_BYTES,
): Promise<Record<string, unknown>> {
  const declared = Number(res.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge(maxBytes)

  const reader = res.body?.getReader()
  if (!reader) {
    // 无流（老运行时/已缓存的 Response）：只能整份读出来再判 —— 有上限也比没有强
    const raw = new Uint8Array(await res.arrayBuffer())
    if (raw.byteLength > maxBytes) throw tooLarge(maxBytes)
    return JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>
  }

  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => { /* 取消失败无关紧要：错误照抛 */ })
      throw tooLarge(maxBytes)
    }
    chunks.push(value)
  }

  const merged = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    merged.set(chunk, at)
    at += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(merged)) as Record<string, unknown>
}
