/**
 * 流式工具协议过滤器。
 *
 * 引擎的 XML 工具调用（`<tool_call>…</tool_call>` / `<tool_result…>…</tool_result>`）
 * 在流式 chunk 里可能被拆成任意片段。chunk 级正则只能删除完整标签对，未闭合块
 * 会先上屏；确认卡等待期间用户就会看到原始 JSON。
 *
 * 本过滤器跨 chunk 维护一个很小的状态机：
 * - 普通文本：只扣住可能是协议标签前缀的后缀；
 * - 工具块：整块吞掉，直到对应闭标签；
 * - flush：未闭合块整体丢弃（全文解析仍会在 onDone 兜底）。
 *
 * 刻意只识别 XML 协议；DSML 由既有 `createDsmlStreamFilter` 负责，两者串联使用。
 */

const OPEN_TOOL_CALL = '<tool_call'
const OPEN_TOOL_RESULT = '<tool_result'
const CLOSE_TOOL_CALL = '</tool_call>'
const CLOSE_TOOL_RESULT_RE = /<\/tool_result\s*>/i

const TAG_PREFIXES = [
  OPEN_TOOL_CALL,
  OPEN_TOOL_RESULT,
  CLOSE_TOOL_CALL,
  '</tool_result',
] as const

type BlockKind = 'tool_call' | 'tool_result'

/** 末尾可能是某个协议标签前缀的最长后缀长度（用于跨 chunk 扣留） */
function partialTagSuffixLength(text: string): number {
  let max = 0
  for (const tag of TAG_PREFIXES) {
    const limit = Math.min(tag.length - 1, text.length)
    for (let len = limit; len > max; len--) {
      if (text.endsWith(tag.slice(0, len))) {
        max = len
        break
      }
    }
  }
  return max
}

/** 找到最早的协议标签起点（只认完整的前缀拼写） */
function findTagStart(text: string): { index: number; kind: BlockKind } | null {
  const lower = text.toLowerCase()
  const call = lower.indexOf(OPEN_TOOL_CALL)
  const result = lower.indexOf(OPEN_TOOL_RESULT)
  const candidates: Array<{ index: number; kind: BlockKind }> = []
  if (call >= 0) candidates.push({ index: call, kind: 'tool_call' })
  if (result >= 0) candidates.push({ index: result, kind: 'tool_result' })
  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.index - b.index)
  return candidates[0]
}

export function createToolProtocolStreamFilter(): { push(chunk: string): string; flush(): string } {
  let buffer = ''
  let block: BlockKind | null = null

  function tryCloseBlock(): boolean {
    if (block === 'tool_call') {
      const idx = buffer.toLowerCase().indexOf(CLOSE_TOOL_CALL)
      if (idx < 0) return false
      buffer = buffer.slice(idx + CLOSE_TOOL_CALL.length)
      block = null
      return true
    }
    const match = CLOSE_TOOL_RESULT_RE.exec(buffer)
    if (!match) return false
    buffer = buffer.slice(match.index + match[0].length)
    block = null
    return true
  }

  function drain(): string {
    let out = ''
    for (;;) {
      if (block) {
        if (!tryCloseBlock()) return out
        continue
      }

      const tag = findTagStart(buffer)
      if (!tag) {
        const keep = partialTagSuffixLength(buffer)
        out += buffer.slice(0, buffer.length - keep)
        buffer = buffer.slice(buffer.length - keep)
        return out
      }

      out += buffer.slice(0, tag.index)
      const rest = buffer.slice(tag.index)
      const gt = rest.indexOf('>')
      if (gt < 0) {
        // 开标签还没闭合：保留整段等下一个 chunk
        buffer = rest
        return out
      }

      // 开标签若自闭合（结果标签可能出现），直接吞掉；否则进入块态
      const opening = rest.slice(0, gt + 1)
      buffer = rest.slice(gt + 1)
      block = opening.endsWith('/>') ? null : tag.kind
    }
  }

  return {
    push(chunk: string): string {
      if (!chunk) return ''
      buffer += chunk
      return drain()
    },
    flush(): string {
      if (block) {
        buffer = ''
        block = null
        return ''
      }
      const keep = partialTagSuffixLength(buffer)
      // flush 时末尾半截标签不可能是正文（完整标签前缀），丢弃；普通 `<` 仍保留
      const out = keep > 0 ? buffer.slice(0, buffer.length - keep) : buffer
      buffer = ''
      return out
    },
  }
}
