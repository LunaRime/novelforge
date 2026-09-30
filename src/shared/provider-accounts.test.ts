import { describe, it, expect } from 'vitest'
import { deriveModelId, isModelOfAccount, syncAccountModels, findModelReferences } from './provider-accounts'
import { BUILTIN_PRESETS, builtinCatalogFor, presetModelDefaults } from './provider-presets'
import { PI_AI_MODEL_SPECS } from './model-specs.generated'
import type { ModelProfile, ProviderAccount } from './ipc-channels'

const ACCOUNT: ProviderAccount = {
  id: 'acc-1',
  provider: 'deepseek',
  protocol: 'openai',
  apiKey: 'sk-account',
  apiKeyRef: 'DEEPSEEK_API_KEY',
  baseUrl: 'https://api.deepseek.com',
  modelNames: ['deepseek-v4-pro', 'deepseek-v4-flash'],
}

function mkModel(over: Partial<ModelProfile> & { id: string }): ModelProfile {
  return {
    name: over.id,
    provider: 'openai',
    protocol: 'openai',
    modelName: 'gpt-4o',
    apiKey: '',
    baseUrl: '',
    temperature: 0.7,
    maxTokens: 4096,
    contextWindow: 131072,
    purposes: ['generation'],
    ...over,
  }
}

const DEFAULTS = {
  temperature: 0.7,
  maxTokens: 8192,
  contextWindow: 128000,
  purposes: ['generation'] as ModelProfile['purposes'],
}
const newModelDefaults = () => ({ ...DEFAULTS })

describe('deriveModelId / isModelOfAccount', () => {
  it('id 由 accountId 与模型名确定性派生（反复勾选/取消后仍可重现）', () => {
    expect(deriveModelId('acc-1', 'deepseek-v4-pro')).toBe('acc-1::deepseek-v4-pro')
    expect(deriveModelId('acc-1', 'deepseek-v4-pro')).toBe(deriveModelId('acc-1', 'deepseek-v4-pro'))
  })

  it('能判定某条目属于哪个账户', () => {
    expect(isModelOfAccount(deriveModelId('acc-1', 'm'), 'acc-1')).toBe(true)
    expect(isModelOfAccount(deriveModelId('acc-2', 'm'), 'acc-1')).toBe(false)
    expect(isModelOfAccount('手工条目-uuid', 'acc-1')).toBe(false)
  })

  it('手工条目的 uuid 不会被误判为派生条目', () => {
    // uuid 里没有 `::`，故不会被任何账户认领
    expect(isModelOfAccount('f47ac10b-58cc-4372-a567-0e02b2c3d479', 'f47ac10b')).toBe(false)
  })
})

describe('syncAccountModels', () => {
  it('勾选 → 为每个模型新建派生条目，凭据取自账户', () => {
    const out = syncAccountModels(ACCOUNT, [], newModelDefaults)
    expect(out).toHaveLength(2)
    expect(out[0].id).toBe('acc-1::deepseek-v4-pro')
    expect(out[0].modelName).toBe('deepseek-v4-pro')
    expect(out[0].apiKey).toBe('sk-account')
    expect(out[0].baseUrl).toBe('https://api.deepseek.com')
    expect(out[0].provider).toBe('deepseek')
    expect(out[0].maxTokens).toBe(8192)
    expect(out[0].apiKeyRef, '凭据副本必须带上账户的 ref（T5 删 apiKey 后它是唯一通路）').toBe('DEEPSEEK_API_KEY')
  })

  it('新条目的显示名初值取模型名（之后用户在卡片里改的就是权威值）', () => {
    expect(syncAccountModels(ACCOUNT, [], newModelDefaults)[0].name).toBe('deepseek-v4-pro')
  })

  describe('⚠️ 合并语义（不是覆盖）：逐模型设置必须保留', () => {
    it('改账户凭据 → 只更新凭据三字段，用户改过的显示名/温度/上限/窗口/用途原样保留', () => {
      const mine = mkModel({
        id: 'acc-1::deepseek-v4-pro',
        name: '我的主力模型',
        temperature: 1.2,
        maxTokens: 16384,
        contextWindow: 200000,
        purposes: ['generation', 'refinement'],
        apiKey: 'sk-old',
        baseUrl: 'https://old',
      })
      const changed: ProviderAccount = { ...ACCOUNT, apiKey: 'sk-new', baseUrl: 'https://new', protocol: 'gemini', provider: 'custom' }
      const out = syncAccountModels(changed, [mine], newModelDefaults)
      const got = out.find(m => m.id === 'acc-1::deepseek-v4-pro')!

      expect(got.apiKey).toBe('sk-new')
      expect(got.baseUrl).toBe('https://new')
      expect(got.protocol).toBe('gemini')
      expect(got.provider).toBe('custom')

      expect(got.name, '显示名被同步冲掉了').toBe('我的主力模型')
      expect(got.temperature).toBe(1.2)
      expect(got.maxTokens).toBe(16384)
      expect(got.contextWindow).toBe(200000)
      expect(got.purposes).toEqual(['generation', 'refinement'])
    })
  })

  describe('目录三态（v3 §3.4）：undefined / 空数组 = 继承内置目录', () => {
    /** 有完整手写目录的 provider（models + embeddingModels 都有） */
    const heir: ProviderAccount = {
      id: 'heir-1',
      provider: 'openai',
      protocol: 'openai',
      apiKey: 'sk-heir',
      apiKeyRef: 'OPENAI_API_KEY',
      baseUrl: 'https://api.openai.com',
      modelNames: [],
    }

    it('modelNames 空数组 = 继承内置目录全集（名序 = models 序 + embeddingModels 序）', () => {
      const out = syncAccountModels(heir, [], (n) => presetModelDefaults(heir.provider, n))

      expect(out.map(m => m.modelName)).toEqual(builtinCatalogFor('openai'))
      // 名序 = 预设 models 序 + embeddingModels 序（用预设本身做 oracle，不另写字面量）
      const preset = BUILTIN_PRESETS.find(p => p.provider === 'openai')!
      expect(out.map(m => m.modelName)).toEqual([
        ...preset.models.map(m => m.name),
        ...preset.embeddingModels,
      ])
      expect(out.length).toBeGreaterThan(preset.models.length) // 向量模型确实进来了
    })

    it('继承而来的派生条目同样携带凭据副本（apiKeyRef 随账户走）', () => {
      const out = syncAccountModels(heir, [], (n) => presetModelDefaults(heir.provider, n))
      expect(out.every(m => m.apiKeyRef === 'OPENAI_API_KEY')).toBe(true)
      expect(out.every(m => m.apiKey === 'sk-heir')).toBe(true)
      expect(out.every(m => m.provider === 'openai')).toBe(true)
    })

    it('modelNames 缺省（undefined）与空数组同义', () => {
      const undef: ProviderAccount = { ...heir, modelNames: undefined }
      const a = syncAccountModels(undef, [], (n) => presetModelDefaults(heir.provider, n))
      const b = syncAccountModels(heir, [], (n) => presetModelDefaults(heir.provider, n))
      expect(a.map(m => m.id)).toEqual(b.map(m => m.id))
      expect(a).toHaveLength(builtinCatalogFor('openai').length)
    })

    it('继承态下已有条目的逐模型设置仍原样保留（合并语义不因继承而变）', () => {
      const mine = mkModel({
        id: deriveModelId(heir.id, 'gpt-5.6-sol'),
        modelName: 'gpt-5.6-sol',
        name: '我的主力',
        temperature: 1.1,
        apiKey: 'sk-old',
      })
      const out = syncAccountModels(heir, [mine], (n) => presetModelDefaults(heir.provider, n))
      const got = out.find(m => m.id === mine.id)!
      expect(got.name).toBe('我的主力')
      expect(got.temperature).toBe(1.1)
      expect(got.apiKey).toBe('sk-heir')
      expect(out).toHaveLength(builtinCatalogFor('openai').length) // 不重复追加
    })

    it('生成表（PI_AI_MODEL_SPECS）的键并入继承目录，排在两个手写来源之后', () => {
      const provider = 'deepseek'
      const preset = BUILTIN_PRESETS.find(p => p.provider === provider)!
      const handwritten = [...preset.models.map(m => m.name), ...preset.embeddingModels]
      const generated = Object.keys(PI_AI_MODEL_SPECS[provider] ?? {})

      expect(builtinCatalogFor(provider)).toEqual([...new Set([...handwritten, ...generated])])
      expect(builtinCatalogFor(provider).length).toBeGreaterThan(handwritten.length) // 生成表确实带来新键
    })

    it('手写 models 刻意留空的 provider 由生成表兜住（继承不再为空）', () => {
      for (const provider of ['moonshot', 'xiaomi', 'groq', 'openrouter']) {
        expect(BUILTIN_PRESETS.find(p => p.provider === provider)!.models, provider).toEqual([])
        expect(builtinCatalogFor(provider), provider).toEqual(Object.keys(PI_AI_MODEL_SPECS[provider] ?? {}))
        expect(builtinCatalogFor(provider).length, provider).toBeGreaterThan(0)
      }
    })

    it('自定义清单只需要所列模型（非空 = 自定义态，不再继承）', () => {
      const out = syncAccountModels(ACCOUNT, [], (n) => presetModelDefaults(ACCOUNT.provider, n))
      expect(out.map(m => m.modelName)).toEqual(['deepseek-v4-pro', 'deepseek-v4-flash'])
      expect(out).toHaveLength(2) // 内置目录里还有别的 deepseek 规格项 → 证明未继承
    })

    it('未知/自定义 provider 的内置目录为空 → 继承态下不产生条目', () => {
      const custom: ProviderAccount = { ...heir, provider: 'custom', protocol: 'openai', modelNames: undefined }
      expect(builtinCatalogFor('custom')).toEqual([])
      expect(syncAccountModels(custom, [], (n) => presetModelDefaults(custom.provider, n))).toEqual([])
    })
  })

  it('取消勾选 → 删除该条目', () => {
    const existing = syncAccountModels(ACCOUNT, [], newModelDefaults)
    const shrunk: ProviderAccount = { ...ACCOUNT, modelNames: ['deepseek-v4-pro'] }
    const out = syncAccountModels(shrunk, existing, newModelDefaults)
    expect(out.map(m => m.id)).toEqual(['acc-1::deepseek-v4-pro'])
  })

  it('⚠️ 语义变更（v3）：空 modelNames 现在是「继承」而非「清空」——删除账户不再走它', () => {
    const existing = syncAccountModels(ACCOUNT, [], newModelDefaults)
    const out = syncAccountModels({ ...ACCOUNT, modelNames: [] }, existing, newModelDefaults)
    // 旧语义（空 = 删光派生条目）已废弃：现在空 = 继承内置目录 → 条目按目录重建
    // （既有条目仍按 existing 序保留 —— 合并语义不变，只有**新建**条目才取目录序）
    expect(out.map(m => m.id).sort()).toEqual(
      builtinCatalogFor('deepseek').map(n => deriveModelId(ACCOUNT.id, n)).sort(),
    )
    expect(out).not.toHaveLength(0)
  })

  describe('不越界', () => {
    it('手工添加的条目不受任何影响', () => {
      const hand = mkModel({ id: 'uuid-hand', name: '手工模型', apiKey: 'sk-hand' })
      const out = syncAccountModels(ACCOUNT, [hand], newModelDefaults)
      expect(out.find(m => m.id === 'uuid-hand')).toEqual(hand)
    })

    it('别的账户的条目不受影响', () => {
      const other = mkModel({ id: 'acc-2::m', name: '别的', apiKey: 'sk-other' })
      const out = syncAccountModels(ACCOUNT, [other], newModelDefaults)
      expect(out.find(m => m.id === 'acc-2::m')).toEqual(other)
    })

    it('保持既有条目顺序，新条目追加在后', () => {
      const hand = mkModel({ id: 'uuid-hand' })
      const kept = syncAccountModels({ ...ACCOUNT, modelNames: ['deepseek-v4-pro'] }, [hand], newModelDefaults)
      const added = syncAccountModels(ACCOUNT, kept, newModelDefaults)
      expect(added.map(m => m.id)).toEqual(['uuid-hand', 'acc-1::deepseek-v4-pro', 'acc-1::deepseek-v4-flash'])
    })
  })
})

describe('findModelReferences（取消勾选 / 删账户前的引用保护）', () => {
  const MODEL = 'acc-1::deepseek-v4-pro'

  it('无引用 → 空数组', () => {
    expect(findModelReferences(MODEL, {})).toEqual([])
  })

  it('命中默认生成模型', () => {
    const refs = findModelReferences(MODEL, { defaultModelId: MODEL })
    expect(refs).toHaveLength(1)
    expect(refs[0].kind).toBe('default')
  })

  it('命中默认向量模型 / 向量化配置', () => {
    expect(findModelReferences(MODEL, { defaultEmbeddingModelId: MODEL })[0].kind).toBe('defaultEmbedding')
    expect(findModelReferences(MODEL, { llmEmbeddingModelId: MODEL })[0].kind).toBe('llmEmbedding')
  })

  it('命中三层路由的某一层（要指出是哪一层）', () => {
    const refs = findModelReferences(MODEL, {
      modelRoutes: { elite: [], standard: [MODEL], budget: [] },
    })
    expect(refs).toHaveLength(1)
    expect(refs[0].kind).toBe('route')
    expect(refs[0].label).toContain('standard')
  })

  it('命中会话（要指出是哪个会话）', () => {
    const refs = findModelReferences(MODEL, {
      conversations: [
        { id: 'c1', title: '无关会话', modelId: 'other' },
        { id: 'c2', title: '第一章', modelId: MODEL },
      ],
    })
    expect(refs).toHaveLength(1)
    expect(refs[0].label).toContain('第一章')
  })

  it('多处引用时全部列出', () => {
    const refs = findModelReferences(MODEL, {
      defaultModelId: MODEL,
      modelRoutes: { elite: [MODEL], standard: [], budget: [] },
      conversations: [{ id: 'c2', title: 'T', modelId: MODEL }],
    })
    expect(refs.map(r => r.kind).sort()).toEqual(['conversation', 'default', 'route'])
  })
})
