import { ILLMProvider } from './provider.interface'
import { ModelProfile } from '../../src/shared/ipc-channels'
import { OpenAIProvider } from './openai-provider'
import { GeminiProvider } from './gemini-provider'

export class LLMFactory {
  /**
   * 只收 `protocol` —— 工厂不关心模型是谁，只看走哪套协议。
   * 收成 `Pick` 而不是整个 `ModelProfile`：列模型发生在「账户已填、模型还没勾选」的时刻，
   * 那时没有模型对象，传整个 profile 就得伪造一个假的。
   */
  static getProvider(model: Pick<ModelProfile, 'protocol'>): ILLMProvider {
    if (model.protocol === 'gemini') {
      return new GeminiProvider()
    }
    return new OpenAIProvider()
  }
}
