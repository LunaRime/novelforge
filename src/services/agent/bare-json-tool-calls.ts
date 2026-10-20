/**
 * 裸 JSON 工具调用兜底。
 *
 * 少数 OpenAI-compatible 模型（实测 Qwen）不按 XML 协议输出，而是直接回：
 *   {"name":"read_drafts","arguments":{"chapter_number":1}}
 * 这里只接受「工具名在注册表中」且 arguments 为对象的独立 JSON 对象，
 * 避免把普通正文里的 JSON 误当工具调用。
 */
export interface BareToolCall {
  name: string
  arguments: Record<string, unknown>
}

function findJsonEnd(text: string, start: number): number | null {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return null
}

export function parseBareJsonToolCalls(
  text: string,
  isKnownTool: (name: string) => boolean,
): { textParts: string[]; toolCalls: BareToolCall[] } | null {
  const toolCalls: BareToolCall[] = []
  const parts: string[] = []
  let cursor = 0
  let i = 0

  while (i < text.length) {
    if (text[i] !== '{') { i++; continue }
    const end = findJsonEnd(text, i)
    if (end === null) break
    const raw = text.slice(i, end)
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const name = typeof parsed.name === 'string' ? parsed.name : typeof parsed.tool === 'string' ? parsed.tool : ''
      const args = parsed.arguments ?? parsed.parameters
      if (name && isKnownTool(name) && args && typeof args === 'object' && !Array.isArray(args)) {
        parts.push(text.slice(cursor, i))
        toolCalls.push({ name, arguments: args as Record<string, unknown> })
        cursor = end
        i = end
        continue
      }
    } catch { /* 不是完整 JSON → 当作正文继续 */ }
    i++
  }

  if (toolCalls.length === 0) return null
  parts.push(text.slice(cursor))
  return { textParts: parts.filter(part => part.trim() !== ''), toolCalls }
}
