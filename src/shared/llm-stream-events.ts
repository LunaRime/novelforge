/**
 * 内部统一流事件 —— 业务层只消费这些事件，不直接读厂商 SSE。
 * 厂商差异（reasoning_content / tool_call 分片 / [DONE] / response.completed）全部在 Adapter 内吞掉。
 */
import type { LLMUsage } from '../../electron/llm/provider.interface'

export type InternalStreamFinishReason = 'stop' | 'length' | 'tool_use' | 'error'

export type InternalStreamEvent =
  | { type: 'start'; model: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'reasoning_delta'; delta: string }
  | { type: 'tool_call_delta'; id: string; name?: string; argsDelta: string }
  | { type: 'tool_call_complete'; id: string; name: string; args: unknown }
  | { type: 'finish'; reason: InternalStreamFinishReason; usage?: LLMUsage }
  | { type: 'error'; message: string; retryable: boolean }

export interface InternalStreamAdapter {
  push(chunk: string): InternalStreamEvent[]
  flush(): InternalStreamEvent[]
}
