/**
 * buildOpenAIUrl —— OpenAI 兼容端点 URL 构造
 *
 * 已有 chat / embedding 两种；2026-09-25 新增 `models`（「获取可用模型」要打 `GET /v1/models`）。
 * 本文件只覆盖新增的 models 与既有两种各一条回归，不重述历史事故。
 */
import { describe, it, expect } from 'vitest'
import { buildOpenAIUrl } from './url-utils'

describe("buildOpenAIUrl(kind='models')", () => {
  it('裸域名补 /v1/models', () => {
    expect(buildOpenAIUrl('https://api.openai.com', 'models')).toBe('https://api.openai.com/v1/models')
    expect(buildOpenAIUrl('https://api.deepseek.com', 'models')).toBe('https://api.deepseek.com/v1/models')
  })

  it('容忍结尾斜杠', () => {
    expect(buildOpenAIUrl('https://api.openai.com/', 'models')).toBe('https://api.openai.com/v1/models')
  })

  it('BigModel 的 /v4 路径自带版本段 → 不再补 /v1', () => {
    expect(buildOpenAIUrl('https://open.bigmodel.cn/api/paas/v4', 'models'))
      .toBe('https://open.bigmodel.cn/api/paas/v4/models')
  })

  it('任何已带版本段的地址都不再补 /v1（用户可填 baseUrl，填成 /v1 极常见）', () => {
    expect(buildOpenAIUrl('https://api.moonshot.cn/v1', 'chat'))
      .toBe('https://api.moonshot.cn/v1/chat/completions')
    expect(buildOpenAIUrl('https://dashscope.aliyuncs.com/compatible-mode/v1', 'chat'))
      .toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions')
    expect(buildOpenAIUrl('https://dashscope.aliyuncs.com/compatible-mode/v1', 'models'))
      .toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/models')
  })

  it('用户填了完整端点 → 换掉末段而不是叠加', () => {
    expect(buildOpenAIUrl('https://proxy.example.com/v1/chat/completions', 'models'))
      .toBe('https://proxy.example.com/v1/models')
    expect(buildOpenAIUrl('https://proxy.example.com/v1/embeddings', 'models'))
      .toBe('https://proxy.example.com/v1/models')
  })

  it('旧版 /v1/chat 特例同样换掉末段', () => {
    expect(buildOpenAIUrl('https://proxy.example.com/v1/chat', 'models'))
      .toBe('https://proxy.example.com/v1/models')
  })
})

describe('buildOpenAIUrl 既有行为回归', () => {
  it('chat 与 embedding 不受本次新增影响', () => {
    expect(buildOpenAIUrl('https://api.openai.com', 'chat')).toBe('https://api.openai.com/v1/chat/completions')
    expect(buildOpenAIUrl('https://api.openai.com', 'embedding')).toBe('https://api.openai.com/v1/embeddings')
    expect(buildOpenAIUrl('https://open.bigmodel.cn/api/paas/v4', 'chat'))
      .toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions')
  })
})
