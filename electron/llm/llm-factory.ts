import { ILLMProvider } from './provider.interface'
import { ModelProfile } from '../../src/shared/ipc-channels'
import type { LLMProtocol } from '../../src/shared/llm-protocols'
import { OpenAIProvider } from './openai-provider'
import { GeminiProvider } from './gemini-provider'

/**
 * 协议 → provider 工厂（单源：src/shared/llm-protocols.ts）。
 * **Record 完整性由 TS 保证**：注册表加员而此处漏注册会直接编译失败——
 * 这正是"加协议 = 注册表一行 + 一个 provider"的落地方式（2026-09-28）。
 */
const PROVIDER_FACTORY: Record<LLMProtocol, () => ILLMProvider> = {
  openai: () => new OpenAIProvider(),
  gemini: () => new GeminiProvider(),
}

export class LLMFactory {
  /**
   * 只收 `protocol` —— 工厂不关心模型是谁，只看走哪套协议。
   * 收成 `Pick` 而不是整个 `ModelProfile`：列模型发生在「账户已填、模型还没勾选」的时刻，
   * 那时没有模型对象，传整个 profile 就得伪造一个假的。
   */
  static getProvider(model: Pick<ModelProfile, 'protocol'>): ILLMProvider {
    return PROVIDER_FACTORY[model.protocol]()
  }
}
