import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PromptTemplate } from './prompt-templates'
import { ipc } from './ipc-client'

// mock ipc-client（prompt-templates 内部动态 import）
vi.mock('./ipc-client', () => ({
  ipc: {
    isElectron: true,
    invoke: vi.fn(),
  },
}))

/** 磁盘上的旧自定义内容（模拟加载竞态中文件里的旧值） */
const OLD_CUSTOM = JSON.stringify({
  key: 'premise', name: '旧自定义', description: 'd',
  content: '旧文件内容 {{genre}}', variables: {},
})

const mockInvoke = vi.mocked(ipc.invoke)

beforeEach(() => {
  vi.resetModules()
  mockInvoke.mockClear()
  mockInvoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
    switch (channel) {
      case 'config:get-vela-home':
        return 'C:/Users/test/.novelforge'
      case 'fs:check-exists':
        return String(args[0]).includes('prompts')
      case 'fs:list-dir':
        return [{ name: 'premise.json', path: 'C:/Users/test/.novelforge/prompts/premise.json', isDir: false }]
      case 'fs:read-file':
        return { success: true, content: OLD_CUSTOM }
      case 'fs:write-file':
        return null
      case 'fs:mkdir':
        return null
      default:
        return null
    }
  })
})

/** 每个测试独立加载模块实例（模块级 Map/标志状态隔离） */
async function loadModule() {
  return await import('./prompt-templates')
}

describe('loadCustomPrompts（Issue #19 加载链路）', () => {
  it('从 ~/.novelforge/prompts 加载 JSON 覆盖，getPromptTemplate 返回自定义内容', async () => {
    const mod = await loadModule()
    await mod.loadCustomPrompts()
    const template = mod.getPromptTemplate('premise')
    expect(template?.content).toBe('旧文件内容 {{genre}}')
    expect(mod.getPromptSource('premise')).toBe('global')
  })

  it('幂等：重复调用只加载一次（App 启动 + 设置页双调用点）', async () => {
    const mod = await loadModule()
    await mod.loadCustomPrompts()
    await mod.loadCustomPrompts()
    const homeCalls = mockInvoke.mock.calls.filter(c => c[0] === 'config:get-vela-home')
    expect(homeCalls).toHaveLength(1)
  })
})

describe('saveCustomPrompt（Issue #19 保存后立即生效）', () => {
  it('未加载过也能直接保存并生效（不再回退内置模板）', async () => {
    const mod = await loadModule()
    // 关键回归：此前 saveCustomPrompt 不置 loaded 标志 → getPromptTemplate 跳过内存 Map
    const ok = await mod.saveCustomPrompt({
      key: 'premise', name: '英文前提', description: 'd',
      content: 'English premise {{genre}}', variables: {},
    })
    expect(ok).toBe(true)
    expect(mod.getPromptTemplate('premise')?.content).toBe('English premise {{genre}}')
    expect(mod.getPromptSource('premise')).toBe('global')
  })
})

describe('加载竞态防护', () => {
  it('先保存后加载：加载完成不覆盖会话内新保存的值（内存 Map 权威）', async () => {
    const mod = await loadModule()
    // 用户先保存新内容（写入文件 + 内存 Map）
    await mod.saveCustomPrompt({
      key: 'premise', name: '新自定义', description: 'd',
      content: '新保存的内容 {{genre}}', variables: {},
    })
    // 启动加载（磁盘仍是旧内容 OLD_CUSTOM——模拟加载读的是保存前的快照）
    await mod.loadCustomPrompts()
    expect(mod.getPromptTemplate('premise')?.content).toBe('新保存的内容 {{genre}}')
  })
})

describe('appendOutputLanguage（Issue #18/#19 输出语言约束）', () => {
  it('en-US → 追加 English 指令', async () => {
    const mod = await loadModule()
    const out = mod.appendOutputLanguage('内容', 'en-US')
    expect(out).toContain('[System]')
    expect(out).toContain('English')
    expect(out).toContain('Do not respond in any other language')
  })

  it('ru-RU → 追加 Русский 指令', async () => {
    const mod = await loadModule()
    expect(mod.appendOutputLanguage('内容', 'ru-RU')).toContain('Русский')
  })

  // 渲染统一走 prompt-builder 的 BasePromptBuilder（renderPrompt 已删除，见 prompt-templates.ts 注释）
})

describe('localizeTemplate（Issue #18 多语言模板）', () => {
  it('en-US 语言 → 返回英文模板内容（不污染 BUILTIN_PROMPTS 原对象）', async () => {
    const mod = await loadModule()
    const premise = mod.BUILTIN_PROMPTS.find(p => p.key === 'premise')!
    const localized = mod.localizeTemplate(premise, 'en-US')
    expect(localized.content).toContain('Story Premise')
    expect(localized.content).toContain('{{genre}}')
    // 原对象保持中文（内存不被污染，语言切换可回退）
    expect(premise.content).toContain('故事前提')
    expect(premise.content).not.toBe(localized.content)
  })

  it('zh-CN → 回退中文原文（跳过 en-US，中文是模板原文语言）', async () => {
    const mod = await loadModule()
    const premise = mod.BUILTIN_PROMPTS.find(p => p.key === 'premise')!
    const localized = mod.localizeTemplate(premise, 'zh-CN')
    // 返回中文原文而非英文变体（历史 bug：19 个模板全有 en-US → zh-CN 用户看到英文模板，
    // 设置页混合语言）。注意中文原文可能自带术语（如「故事前提（Story Premise）」），
    // 断言用英文变体的特征句区分
    expect(localized.content).toContain('请提炼本书的故事前提')
    expect(localized.content).not.toContain('You are a top-tier web novel planning expert')
  })

  it('ru-RU（无俄语变体）→ 回退 en-US', async () => {
    const mod = await loadModule()
    const premise = mod.BUILTIN_PROMPTS.find(p => p.key === 'premise')!
    const localized = mod.localizeTemplate(premise, 'ru-RU')
    expect(localized.content).toContain('Story Premise')
  })

  it('自定义模板不被语言化覆盖（保存的内容就是展示内容，#19 关键回归）', async () => {
    const mod = await loadModule()
    await mod.saveCustomPrompt({
      key: 'premise', name: '自定义', description: 'd',
      content: '用户保存的内容 {{genre}}', variables: {},
    })
    const tpl = mod.getPromptTemplate('premise')!
    expect(tpl.content).toBe('用户保存的内容 {{genre}}')
  })
})

describe('systemSuffix/systemRole 语言化（英文用户生成质量）', () => {
  it('localizeTemplate 解析 systemRole 语言变体', async () => {
    const mod = await loadModule()
    const premise = mod.BUILTIN_PROMPTS.find(p => p.key === 'premise')!
    const localized = mod.localizeTemplate(premise, 'en-US')
    expect(localized.systemRole).toContain('story architect')
    expect(localized.content).toContain('Story Premise')
  })

  it('localizeTemplate 解析 systemSuffix 语言变体（保留占位符）', async () => {
    const mod = await loadModule()
    const premise = mod.BUILTIN_PROMPTS.find(p => p.key === 'premise')!
    const localized = mod.localizeTemplate(premise, 'en-US')
    expect(localized.systemSuffix).toContain('highest priority')
    expect(localized.systemSuffix).toContain('{{step_guidance}}')
  })

  it('全部 19 个模板的 systemRole 都有 en-US 变体', async () => {
    const mod = await loadModule()
    const missing = mod.BUILTIN_PROMPTS.filter(p => !p.systemRoleLocales?.['en-US']).map(p => p.key)
    expect(missing).toEqual([])
  })

  it('systemSuffix 英文变体占位符与中文版一致（防渲染残留）', async () => {
    const mod = await loadModule()
    for (const p of mod.BUILTIN_PROMPTS) {
      const en = p.systemSuffixLocales?.['en-US']
      if (!en) continue
      const zhVars = [...(p.systemSuffix ?? '').matchAll(/\{\{([^}]+)\}\}/g)].map(m => m[1]).sort()
      const enVars = [...en.matchAll(/\{\{([^}]+)\}\}/g)].map(m => m[1]).sort()
      expect(enVars, `${p.key} systemSuffix 占位符不一致`).toEqual(zhVars)
    }
  })
})

describe('ru-RU 模板（俄语）', () => {
  it('ru-RU content 语言化生效', async () => {
    const mod = await loadModule()
    const premise = mod.BUILTIN_PROMPTS.find(p => p.key === 'premise')!
    const localized = mod.localizeTemplate(premise, 'ru-RU')
    expect(localized.content).toContain('Сформулируйте предпосылку')
    expect(localized.systemRole).toContain('эксперт по планированию')
  })

  it('11 个 EDITABLE 模板都有 ru-RU content 变体', async () => {
    const mod = await loadModule()
    const editable = mod.BUILTIN_PROMPTS.filter(p => mod.EDITABLE_PROMPT_KEYS.includes(p.key))
    const missing = editable.filter(p => !p.contentLocales?.['ru-RU']).map(p => p.key)
    expect(missing).toEqual([])
  })

  it('全部 19 个模板 systemRole 都有 ru-RU 变体', async () => {
    const mod = await loadModule()
    const missing = mod.BUILTIN_PROMPTS.filter(p => !p.systemRoleLocales?.['ru-RU']).map(p => p.key)
    expect(missing).toEqual([])
  })

  it('ru-RU content 占位符与中文版一致（防渲染残留）', async () => {
    const mod = await loadModule()
    for (const p of mod.BUILTIN_PROMPTS) {
      const ru = p.contentLocales?.['ru-RU']
      if (!ru) continue
      const zhVars = [...p.content.matchAll(/\{\{([^}]+)\}\}/g)].map(m => m[1]).sort()
      const ruVars = [...ru.matchAll(/\{\{([^}]+)\}\}/g)].map(m => m[1]).sort()
      expect(ruVars, `${p.key} ru content 占位符不一致`).toEqual(zhVars)
    }
  })

  it('systemSuffix 无 ru 变体 → 回退 en-US（渲染链安全）', async () => {
    const mod = await loadModule()
    const premise = mod.BUILTIN_PROMPTS.find(p => p.key === 'premise')!
    const localized = mod.localizeTemplate(premise, 'ru-RU')
    // suffix 无俄语 → 回退英文
    expect(localized.systemSuffix).toContain('highest priority')
  })
})

describe('localizeTemplate 回退与完整性（续）', () => {
  it('有 content 变体的模板：en-US 解析为英文 content', async () => {
    const mod = await loadModule()
    const blueprint = mod.BUILTIN_PROMPTS.find(p => p.key === 'chapter_blueprint')!
    const localized = mod.localizeTemplate(blueprint, 'en-US')
    expect(localized.content).toContain('nanny-level execution outline')
    expect(localized.systemRole).toContain('chapter blueprints')
  })

  it('全部 19 个内置模板都有 en-US content 变体', async () => {
    const mod = await loadModule()
    const missing = mod.BUILTIN_PROMPTS.filter(p => !p.contentLocales?.['en-US']).map(p => p.key)
    expect(missing).toEqual([])
  })

  it('无任何语言变体的模板原样返回（同一引用）', async () => {
    const mod = await loadModule()
    const plain: PromptTemplate = { key: 'x', name: 'x', description: 'x', content: '中文', variables: {} }
    expect(mod.localizeTemplate(plain, 'en-US')).toBe(plain)
  })

  it('全部 11 个 EDITABLE 模板都有 en-US 变体', async () => {
    const mod = await loadModule()
    const editable = mod.BUILTIN_PROMPTS.filter(p => mod.EDITABLE_PROMPT_KEYS.includes(p.key))
    const missing = editable.filter(p => !p.contentLocales?.['en-US']).map(p => p.key)
    expect(missing).toEqual([])
  })
})
