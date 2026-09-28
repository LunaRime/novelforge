/**
 * LLM 协议注册表 —— 单一来源（2026-09-28，源自 deepseek-harness 的协议层调研）。
 *
 * 准入标准（照 dsh，勿放宽而不改注释）：能被「一把 key + 一个 endpoint + headers」完整描述的
 * 协议才进表；Bedrock（SigV4+区域）/ Vertex（project/ADC）/ Azure（env+api-version）/ OAuth 类
 * 一律排除 —— 配置形状表达不了的认证，放进来只会交回一个「能选中但必然认证失败」的 provider。
 *
 * 引用方：llm-factory（映射表，Record 完整性由 TS 保证——加员漏注册会编译失败）、
 * ModelForm 的协议下拉、ModelProfile / ProviderAccount / ProviderPreset 的 protocol 字段类型。
 * **加协议 = 本数组加一行 + 实现对应 provider**。
 */
import type { TextKey } from './locale'

export const LLM_PROTOCOLS = [
  { id: 'openai', labelKey: 'form.protocolOpenai' },
  { id: 'gemini', labelKey: 'form.protocolGemini' },
  { id: 'anthropic', labelKey: 'form.protocolAnthropic' },
] as const satisfies readonly { id: string; labelKey: TextKey }[]

export type LLMProtocol = (typeof LLM_PROTOCOLS)[number]['id']
