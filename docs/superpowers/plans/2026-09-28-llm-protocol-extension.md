# LLM 协议扩展实施计划（v2 计划 A）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans（用户已指定执行）。步骤用 checkbox（`- [ ]`）跟踪。

**Goal:** 协议枚举收敛为单一来源（dsh 的"UI 可选集 ≡ 适配器可服务集"理念），并新增 `anthropic` 原生协议，解除 Anthropic 预设的 OpenAI 兼容层限制（response_format 失效 / 温度上限 1 / 无 prompt 缓存）。

**Architecture:** `src/shared/llm-protocols.ts` 单源 → factory 映射表 / UI 协议下拉 / 类型 三处引用；`anthropic-provider.ts` 照 `gemini-provider.ts` 模式——**关键逻辑拆为导出纯函数**（请求构造 / SSE 解析器 / 错误映射），类只做 fetch 编排；纯函数直测（照 `gemini-provider.test.ts` 范式，不需 mock fetch）。

**Tech Stack:** TypeScript strict + Vitest（node 环境，electron 侧测试照 `electron/llm/*.test.ts`）。

**Spec:** `docs/superpowers/specs/2026-09-28-model-management-v2-design.md` §十 / §十一

## Global Constraints

- 三门禁每任务提交前跑：`npx tsc --noEmit` / `npx eslint . --ext ts,tsx --max-warnings 0` / `npx vitest run`——**退出码直查**（`> /tmp/x.log 2>&1; echo $?`，禁止接 `head` 掩盖退出码）
- 协议准入标准注释（dsh 理念）写进 `llm-protocols.ts` 文件头，原文见 spec §十
- 新增用户可见文案三语（zh-CN / en-US / ru-RU）入 `src/shared/locale-data/ui.ts`
- **不动** `retry-handler` 的判定逻辑（现状按 HTTP status ✓）；新协议失败必须抛带 `status` 的 `HttpError`（`electron/llm/url-utils.ts` 的既有类）
- 流式契约（dsh 教训）：**usage 先于 finish 交付、finish 后不再产出**；本仓无 tool-calling，不做 tool 块映射
- 依赖方向：`src/shared/**` 不得 import `electron/**`（llm-protocols 是纯共享常量）

## Review Focus（测试必须钉住的输入类）

1. **SSE 帧被 TCP 分片切断**：`data: {...}` 一行被切成两个 chunk 投喂 → 解析器不得丢帧或双发
2. **usage 分两处**：Anthropic 的 `input_tokens` 在 `message_start`、`output_tokens` 在 `message_delta` → 合并后一次性交付
3. **`max_tokens` 必填**：Anthropic 拒绝缺失；构造时取 `model.maxTokens`（兜底 4096）
4. **baseUrl 归一化**：用户可能填 `https://api.anthropic.com`、带尾斜杠、或已含 `/v1` → 一律拼成 `{root}/v1/messages` 不重复
5. **错误体非 JSON**（网关 HTML 错误页）→ 解析容错，仍抛带 status 的 HttpError

---

### Task 1: 协议单源注册表（**行为不变**：先只收敛 openai/gemini 两员）

**Files:**
- Create: `src/shared/llm-protocols.ts`
- Create: `src/shared/llm-protocols.test.ts`
- Modify: `electron/llm/llm-factory.ts`、`electron/llm/provider.interface.ts`（错误契约注释）、`src/components/settings/ModelListSection.tsx`（ModelForm 的协议下拉单源化）、`src/shared/locale-data/ui.ts`（两个 label key）

**Interfaces:**
- Produces: `LLM_PROTOCOLS`（as const 数组：`{ id, labelKey }`）与 `type LLMProtocol = (typeof LLM_PROTOCOLS)[number]['id']`；后续 Task 2 往数组**加一行**即完成注册

- [ ] **Step 1: 写 failing test**

`src/shared/llm-protocols.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { LLM_PROTOCOLS } from './llm-protocols'
import { UI_TEXTS } from './locale'

describe('LLM 协议单源注册表', () => {
  it('当前含 openai / gemini 两员（anthropic 由计划 B-Task2 加入）', () => {
    expect(LLM_PROTOCOLS.map(p => p.id)).toEqual(['openai', 'gemini'])
  })

  it('每个协议的 labelKey 都有三语文案（UI 下拉直接消费，不得漏）', () => {
    for (const p of LLM_PROTOCOLS) {
      const entry = UI_TEXTS[p.labelKey]
      expect(entry, `${p.id} 的 labelKey「${p.labelKey}」不在 locale`).toBeTruthy()
      for (const loc of ['zh-CN', 'en-US', 'ru-RU'] as const) {
        expect(entry[loc], `${p.labelKey} 缺 ${loc}`).toBeTruthy()
      }
    }
  })
})
```

- [ ] **Step 2: 跑红**

Run: `npx vitest run src/shared/llm-protocols.test.ts`
Expected: FAIL——`Cannot find module './llm-protocols'`。

- [ ] **Step 3: 实现单源 + 三处引用**

`src/shared/llm-protocols.ts`：

```ts
/**
 * LLM 协议注册表 —— 单一来源（2026-09-28，源自 deepseek-harness 的协议层调研）。
 *
 * 准入标准（照 dsh，勿放宽而不改注释）：能被「一把 key + 一个 endpoint + headers」完整描述的
 * 协议才进表；Bedrock（SigV4+区域）/ Vertex（project/ADC）/ Azure（env+api-version）/ OAuth 类
 * 一律排除 —— 配置形状表达不了的认证，放进来只会交回一个「能选中但必然认证失败」的 provider。
 *
 * 引用方：llm-factory（映射表，Record 完整性由 TS 保证）、ModelForm 的协议下拉、ModelProfile /
 * ProviderPreset 的 protocol 字段类型。**加协议 = 本数组加一行 + 实现对应 provider**。
 */
import type { TextKey } from './locale'

export const LLM_PROTOCOLS = [
  { id: 'openai', labelKey: 'form.protocolOpenai' },
  { id: 'gemini', labelKey: 'form.protocolGemini' },
] as const

export type LLMProtocol = (typeof LLM_PROTOCOLS)[number]['id']
```

`electron/llm/llm-factory.ts` 改映射表：

```ts
import { OpenAIProvider } from './openai-provider'
import { GeminiProvider } from './gemini-provider'
import type { LLMProtocol } from '../../src/shared/llm-protocols'

/** 协议 → provider 工厂（Record 完整性由 TS 保证：LLM_PROTOCOLS 加员而此处漏加会编译失败） */
const PROVIDER_FACTORY: Record<LLMProtocol, () => ILLMProvider> = {
  openai: () => new OpenAIProvider(),
  gemini: () => new GeminiProvider(),
}

export class LLMFactory {
  static getProvider(model: Pick<ModelProfile, 'protocol'>): ILLMProvider {
    return PROVIDER_FACTORY[model.protocol]()
  }
}
```

（保留原注释中"只收 protocol"的理由。）

类型引用：`src/shared/ipc-channels.ts` 的 `ModelProfile.protocol` 与 `src/shared/provider-presets.ts` 的 `ProviderPreset.protocol` 从 `'openai' | 'gemini'` 改为 `LLMProtocol`（本步等价，Task 2 加员后自动扩）。

UI 下拉单源（`ModelListSection.tsx` 的 ModelForm 协议 Select）：

```tsx
import { LLM_PROTOCOLS } from '../../../shared/llm-protocols'
// …
<Select value={model.protocol} onValueChange={(v) => up('protocol', v as LLMProtocol)}>
  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
  <SelectContent>
    {LLM_PROTOCOLS.map((p) => (
      <SelectItem key={p.id} value={p.id}>{t(p.labelKey)}</SelectItem>
    ))}
  </SelectContent>
</Select>
```

i18n（`ui.ts`）：

```ts
'form.protocolOpenai': { 'zh-CN': 'OpenAI 兼容', 'en-US': 'OpenAI-compatible', 'ru-RU': 'Совместимый с OpenAI' },
'form.protocolGemini': { 'zh-CN': 'Gemini 原生', 'en-US': 'Gemini native', 'ru-RU': 'Нативный Gemini' },
```

`provider.interface.ts` 契约注释（在 `listModels` 注释后补一条类注释）：

```ts
/**
 * 错误契约（2026-09-28，加协议前码化）：**失败一律抛带 `status` 的 `HttpError`**（或等价携带
 * HTTP 状态的对象），调用方与 retry-handler 只按 status/code 判定，**绝不解析 message 文本**
 * —— 否则每加一个协议就要重写一份文本正则（dsh 的教训）。
 */
```

- [ ] **Step 4: 跑绿 + 全量门禁**

Run: `npx vitest run src/shared/llm-protocols.test.ts`（PASS）
Run 三门禁（退出码直查）。

- [ ] **Step 5: 提交**

```bash
git add src/shared/llm-protocols.ts src/shared/llm-protocols.test.ts electron/llm/llm-factory.ts electron/llm/provider.interface.ts src/shared/ipc-channels.ts src/shared/provider-presets.ts src/components/settings/ModelListSection.tsx src/shared/locale-data/ui.ts
git commit -m "refactor(llm): 协议注册表单源化（llm-protocols）+ 错误契约码化注释"
```

---

### Task 2: `anthropic` 原生协议（加协议 = 注册表一行 + 一个 provider）

**Files:**
- Create: `electron/llm/anthropic-provider.ts`
- Create: `electron/llm/anthropic-provider.test.ts`
- Modify: `src/shared/llm-protocols.ts`（+1 行）、`electron/llm/llm-factory.ts`（+1 行 + import）、`src/shared/provider-presets.ts`（Anthropic 预设注释更新）、`src/shared/locale-data/ui.ts`（`form.protocolAnthropic`）

**Interfaces:**
- Produces（全部导出、供测试直测的纯函数）：
  - `toAnthropicRequest(model: ModelProfile, messages: ChatMessage[], opts?: LLMStreamOptions): { url: string; headers: Record<string,string>; body: AnthropicBody }`
  - `createAnthropicStreamParser(emit: (e: AnthropicStreamEvent) => void): (chunk: string) => void`
  - `mapAnthropicError(status: number, bodyText: string): HttpError`
  - `class AnthropicProvider implements ILLMProvider`（编排层）
- Consumes: `HttpError`（`./url-utils`）、`fetchWithTimeout`（既有工具，与 openai-provider 同款）、`LLMFixture` 型消息 `{ role: string; content: string }`

- [ ] **Step 1: 写请求构造的 failing tests**

`electron/llm/anthropic-provider.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { toAnthropicRequest, createAnthropicStreamParser, mapAnthropicError } from './anthropic-provider'
import type { ModelProfile } from '../../src/shared/ipc-channels'

const model = {
  id: 'a1', name: 'Claude', provider: 'anthropic', protocol: 'anthropic',
  modelName: 'claude-sonnet-5', apiKey: 'sk-ant-x',
  baseUrl: 'https://api.anthropic.com', temperature: 0.7, maxTokens: 8192, contextWindow: 200000,
} as ModelProfile

describe('toAnthropicRequest', () => {
  it('URL 归一化：裸域名/尾斜杠/已含 /v1 都拼成 {root}/v1/messages（不重复）', () => {
    for (const base of ['https://api.anthropic.com', 'https://api.anthropic.com/', 'https://api.anthropic.com/v1',
      'https://api.anthropic.com/v1/']) {
      expect(toAnthropicRequest({ ...model, baseUrl: base }, [{ role: 'user', content: 'hi' }]).url)
        .toBe('https://api.anthropic.com/v1/messages')
    }
  })

  it('system 提取为顶层字段（多条合并），不进 messages；max_tokens 取 model.maxTokens', () => {
    const req = toAnthropicRequest(model, [
      { role: 'system', content: '你是一位小说家。' },
      { role: 'system', content: '【架构】主角是林晚。' },
      { role: 'user', content: '写一章' },
      { role: 'assistant', content: '好的' },
    ])
    expect(req.body.system).toBe('你是一位小说家。\n\n【架构】主角是林晚。')
    expect(req.body.messages.map(m => m.role)).toEqual(['user', 'assistant'])
    expect(req.body.max_tokens).toBe(8192)
    expect(req.headers['x-api-key']).toBe('sk-ant-x')
    expect(req.headers['anthropic-version']).toBe('2023-06-01')
  })

  it('maxTokens 缺失兜底 4096（Anthropic 拒绝空 max_tokens）', () => {
    const req = toAnthropicRequest({ ...model, maxTokens: undefined as unknown as number }, [{ role: 'user', content: 'hi' }])
    expect(req.body.max_tokens).toBe(4096)
  })
})

describe('createAnthropicStreamParser', () => {
  it('帧序列：text_delta 累积文本，usage 两处合并（message_start.in + message_delta.out），先 usage 后 finish', () => {
    const events: string[] = []
    let text = ''
    const parse = createAnthropicStreamParser((e) => {
      if (e.type === 'text') text += e.text
      if (e.type === 'usage') events.push(`usage:${e.inputTokens}/${e.outputTokens}`)
      if (e.type === 'finish') events.push('finish')
    })
    parse('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":1}}}\n\n')
    parse('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你好"}}\n\n')
    parse('event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":7}}\n\n')
    parse('event: message_stop\ndata: {"type":"message_stop"}\n\n')
    expect(text).toBe('你好')
    expect(events).toEqual(['usage:12/7', 'finish'])
  })

  it('帧被 TCP 分片切断：一行 data 拆两个 chunk 投喂仍完整解析（Review Focus 1）', () => {
    let text = ''
    const parse = createAnthropicStreamParser((e) => { if (e.type === 'text') text += e.text })
    const line = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"分片"}}\n\n'
    parse(line.slice(0, 40))
    parse(line.slice(40))
    expect(text).toBe('分片')
  })

  it('finish 后不再产出（Review Focus：dsh 流式契约）', () => {
    const seen: string[] = []
    const parse = createAnthropicStreamParser((e) => seen.push(e.type))
    parse('event: message_stop\ndata: {"type":"message_stop"}\n\n')
    parse('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"迟到"}}\n\n')
    expect(seen).toEqual(['finish'])
  })
})

describe('mapAnthropicError', () => {
  it('401 → HttpError(status=401)；429 响应体含 retry-after 时透传 message', () => {
    expect(mapAnthropicError(401, '{"type":"error","error":{"message":"invalid x-api-key"}}').status).toBe(401)
    const e = mapAnthropicError(429, '{"error":{"message":"rate limited"}}')
    expect(e.status).toBe(429)
  })

  it('HTML 错误页（非 JSON）不崩，仍抛带 status 的 HttpError（Review Focus 5）', () => {
    const e = mapAnthropicError(502, '<html><body>Bad Gateway</body></html>')
    expect(e.status).toBe(502)
  })
})
```

- [ ] **Step 2: 跑红**

Run: `npx vitest run electron/llm/anthropic-provider.test.ts`
Expected: FAIL——模块不存在。

- [ ] **Step 3: 实现纯函数 + provider 类**

`electron/llm/anthropic-provider.ts` 核心结构（完整实现按此展开）：

```ts
// 关键实现要点：
// ① toAnthropicRequest：root 归一化 = baseUrl.replace(/\/+$/,'').replace(/\/v1$/,'')，拼 `${root}/v1/messages`
//    头：x-api-key / anthropic-version: 2023-06-01 / content-type: application/json
//    body：{ model: modelName, max_tokens: model.maxTokens || 4096, temperature, system?, messages }
// ② createAnthropicStreamParser：行缓冲（buf += chunk; 按 \n 切行；空行为事件边界）——
//    事件块内 data: 行拼接后 JSON.parse；type 映射：
//    message_start → 记 inputTokens；content_block_delta(text_delta) → emit {type:'text',text}
//    message_delta → 记 outputTokens；message_stop → emit {type:'usage',inputTokens,outputTokens}
//    然后 emit {type:'finish'}；置 finished=true，之后一律忽略
// ③ mapAnthropicError：try JSON.parse 取 error.message（失败用原始文本截断 200 字），返回 new HttpError(status, message)
// ④ AnthropicProvider：generate（fetch 非流式，取 content[0].text + usage）、
//    generateStream（fetch SSE，createAnthropicStreamParser 驱动 onChunk/onComplete 回调，与 openai-provider 的回调形状一致）、
//    listModels（GET {root}/v1/models?limit=1000，头同上，解析 data[].id——本计划保持返回 string[]，v2 计划 B 再扩规格）
```

（实现时以 `openai-provider.ts` 的 stream 回调编排为模板，保证 `opts.onChunk` / `opts.onComplete` / `opts.onError` 语义一致。）

- [ ] **Step 4: 跑绿（三块纯函数测试）**

Run: `npx vitest run electron/llm/anthropic-provider.test.ts`（PASS）

- [ ] **Step 5: 注册（单源的兑现：注册表加一行）**

- `src/shared/llm-protocols.ts`：数组加 `{ id: 'anthropic', labelKey: 'form.protocolAnthropic' }`
- `llm-factory.ts`：`PROVIDER_FACTORY` 加 `anthropic: () => new AnthropicProvider()`（**漏加会编译失败——TS 的 Record 完整性**）
- `ui.ts`：`'form.protocolAnthropic': { 'zh-CN': 'Anthropic 原生（Claude）', 'en-US': 'Anthropic native (Claude)', 'ru-RU': 'Нативный Anthropic (Claude)' }`
- `provider-presets.ts`：Anthropic 预设注释更新（协议从"官方 OpenAI 兼容层（beta）"改注为"原生 Messages API——此前的兼容层限制（response_format 失效/温度上限 1/无 prompt 缓存）不再适用；协议字段保持 'anthropic'"），并**移除 baseUrl 裸域名依赖兼容层的注释**（原生协议自己拼 /v1/messages）
- 跑 `npx vitest run src/shared/llm-protocols.test.ts`——**断言更新**：Task 1 的 `['openai','gemini']` 改为 `['openai','gemini','anthropic']`

- [ ] **Step 6: 全量门禁 + 提交**

```bash
npx tsc --noEmit && npx eslint . --ext ts,tsx --max-warnings 0 && npx vitest run
git add electron/llm/anthropic-provider.ts electron/llm/anthropic-provider.test.ts src/shared/llm-protocols.ts src/shared/llm-protocols.test.ts electron/llm/llm-factory.ts src/shared/provider-presets.ts src/shared/locale-data/ui.ts
git commit -m "feat(llm): anthropic 原生协议（Messages API：请求构造/SSE/错误映射）+ 注册表加员"
```

---

## Self-Review 记录

- **Spec 覆盖**：§十 → Task 1（单源 + 准入注释 + 错误契约 + UI 下拉）；§十一 → Task 2（provider 五要点 + 注册 + 预设）。§九"协议范围只加 anthropic"未越界。
- **Placeholder 扫描**：Task 2 的 provider 类编排给"要点 + 模板指引"（openai-provider 为模板）而非全文——纯函数（被测单元）代码全给出；编排层是直译，可接受。
- **类型一致性**：`LLMProtocol` 单源；`toAnthropicRequest` 返回形状与测试断言一致；`HttpError(status, message)` 与 `url-utils.ts` 既有构造一致（实现时核对签名）。
- **Review Focus**：5 条 → 测试分别覆盖（1→分片用例、2→usage 合并用例、3→max_tokens 兜底、4→URL 归一化、5→HTML 错误体）。
