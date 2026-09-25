/**
 * OpenAI 兼容协议 URL 构造工具（主进程共享）
 *
 * 覆盖各服务商 baseUrl 形态差异：
 * - OpenAI 官方 `https://api.openai.com` → 补 `/v1/chat/completions` / `/v1/embeddings`
 * - DeepSeek `https://api.deepseek.com` → 同上（v1 兼容端点）
 * - BigModel `https://open.bigmodel.cn/api/paas/v4` → `/chat/completions` / `/embeddings`（v4 路径自带版本段，**不得**再补 /v1）
 * - Ollama `http://localhost:11434` → `/v1/chat/completions` / `/v1/embeddings`
 * - 用户手动填写的完整端点（以 /chat/completions 或 /embeddings 结尾）→ 直接使用
 *
 * 历史事故：chat 侧只有 /v1/chat 特例导致 bigmodel 404；embedding 侧不补 /v1 导致 OpenAI 404。
 * 两端点规则曾互相矛盾，统一收敛到本工具。
 */

export type OpenAIEndpointKind = 'chat' | 'embedding' | 'models'

export function buildOpenAIUrl(baseUrl: string, kind: OpenAIEndpointKind): string {
  const base = baseUrl.replace(/\/$/, '')

  // 用户直接填了完整端点
  if (base.endsWith('/chat/completions') || base.endsWith('/embeddings')) {
    // models 要**剥掉端点段**而不是原样使用（`…/v1/chat/completions` → `…/v1/models`）。
    // ⚠️ `/chat/completions` 是**两段**，用 lastIndexOf('/') 只会剥掉一段，得出 `…/v1/chat/models`
    if (kind === 'models') {
      const endpoint = base.endsWith('/chat/completions') ? '/chat/completions' : '/embeddings'
      return `${base.slice(0, -endpoint.length)}/models`
    }
    return base
  }

  // 旧版特例：`…/v1/chat`（保留兼容）
  if (base.endsWith('/v1/chat')) {
    return kind === 'chat' ? `${base}/completions` : `${base.slice(0, base.lastIndexOf('/'))}/models`
  }

  // BigModel paas 路径自带 /v4 版本段（各端点均直接追加）
  if (base.endsWith('/v4')) {
    if (kind === 'models') return `${base}/models`
    return kind === 'chat' ? `${base}/chat/completions` : `${base}/embeddings`
  }

  if (kind === 'models') return `${base}/v1/models`
  return kind === 'chat' ? `${base}/v1/chat/completions` : `${base}/v1/embeddings`
}
