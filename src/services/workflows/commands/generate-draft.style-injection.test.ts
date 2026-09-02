// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'
import { ChapterPromptBuilder } from '../../prompts/prompt-builder'
import { GenerateDraftCommand } from './generate-draft.command'
import type { CommandExecuteParams } from './base-command'
import type { ChapterInfo } from '../chapter-workflow'

// mock ipc-client（命令内部经 style-registry / db 通道读盘）
vi.mock('../../ipc-client', () => ({
  ipc: { invoke: vi.fn() },
}))

const mockInvoke = vi.mocked(ipc.invoke)
const projectPath = 'C:/projects/demo'

function makeProject(writingStyle: string | undefined) {
  useProjectStore.setState({
    currentProject: {
      id: 'demo',
      name: '测试项目',
      path: projectPath,
      novelConfig: {
        genre: '', // 空流派 → getGenreOverride null → 不触发流派分支（writing_style 只写一次）
        subGenre: '',
        targetAudience: '男频',
        totalChapters: 100,
        wordsPerChapter: 2000,
        plotStructure: 'three_act',
        narrativePOV: 'third_limited',
        coreOutline: '',
        worldSetting: '',
        goldenFinger: '',
        protagonistProfile: '',
        globalGuidance: '',
        writingStyle,
      },
      characterStates: '',
      createdAt: 0,
      updatedAt: 0,
    },
  })
}

function makeChapterInfo(): ChapterInfo {
  return { chapterNumber: 1, title: '第一章', role: 'protagonist', purpose: 'draft', characters: [], keyEvents: '开局' }
}

function makeParams(): CommandExecuteParams {
  return {
    step: {},
    context: { data: {}, cancelled: false },
    callbacks: { log: vi.fn(), setProgress: vi.fn(), appendText: vi.fn() },
  }
}

/** 测试子类：覆写 protected callLLM 以短路 LLM 调用（execute 的 prompt 组装路径仍真实执行） */
class TestableGenerateDraft extends GenerateDraftCommand {
  constructor() { super(makeChapterInfo()) }
  protected async callLLM(): Promise<string> { return '已生成正文' }
}

beforeEach(() => {
  mockInvoke.mockReset()
  mockInvoke.mockImplementation(async (...args: unknown[]) => {
    const channel = String(args[0])
    switch (channel) {
      case 'fs:list-dir': return []
      case 'db:character-get-all': return []
      case 'db:project-core-get': return {}
      case 'db:draft-get-all-chapter-numbers': return []
      case 'db:draft-next-version': return 1
      case 'db:draft-create': return { success: true, id: 1 }
      default: return {}
    }
  })
})

describe('GenerateDraftCommand 输出风格注入接线（C3 命令级回归）', () => {
  it('无 default.md → writing_style 变量 === config.writingStyle 原值（含边界空格，逐字不变）', async () => {
    makeProject('既有文风（含边界空格）  ')
    const spy = vi.spyOn(ChapterPromptBuilder.prototype, 'withWritingStyle')

    const result = await new TestableGenerateDraft().execute(makeParams())
    expect(result).toBe('已生成正文')

    // 命令链只调用一次 withWritingStyle（无流派分支）；传入值 = config 原值（不 trim）
    const writingStyleArg = spy.mock.calls.find(c => c[0] === '既有文风（含边界空格）  ')
    expect(writingStyleArg).toBeTruthy()
    expect(spy.mock.calls.filter(c => c[0] === '既有文风（含边界空格）  ')).toHaveLength(1)
    spy.mockRestore()
  })

  it('无 default.md + config 为空 → writing_style 变量 === ""（空段裁剪语义保持）', async () => {
    makeProject('')
    const spy = vi.spyOn(ChapterPromptBuilder.prototype, 'withWritingStyle')

    await new TestableGenerateDraft().execute(makeParams())
    expect(spy.mock.calls.some(c => c[0] === '')).toBe(true)
    spy.mockRestore()
  })

  it('有 default.md → writing_style 变量 = config + \\n\\n + 风格正文', async () => {
    makeProject('基调：沉重')
    mockInvoke.mockImplementation(async (...args: unknown[]) => {
      const channel = String(args[0])
      if (channel === 'styles:get') {
        return { name: 'default', description: '激活', promptBody: '冷峻克制，多用短句。' }
      }
      if (channel === 'fs:list-dir') return []
      if (channel === 'db:character-get-all') return []
      if (channel === 'db:project-core-get') return {}
      if (channel === 'db:draft-get-all-chapter-numbers') return []
      if (channel === 'db:draft-next-version') return 1
      if (channel === 'db:draft-create') return { success: true, id: 1 }
      return {}
    })
    const spy = vi.spyOn(ChapterPromptBuilder.prototype, 'withWritingStyle')

    await new TestableGenerateDraft().execute(makeParams())

    expect(mockInvoke).toHaveBeenCalledWith('styles:get', projectPath, 'default')
    const writingStyleArg = spy.mock.calls.find(c => c[0] === '基调：沉重\n\n冷峻克制，多用短句。')
    expect(writingStyleArg).toBeTruthy()
    spy.mockRestore()
  })

  it('有 default.md + config 为空 → writing_style 变量 = 仅风格正文（无前导分隔）', async () => {
    makeProject('')
    mockInvoke.mockImplementation(async (...args: unknown[]) => {
      const channel = String(args[0])
      if (channel === 'styles:get') {
        return { name: 'default', description: '激活', promptBody: '冷峻克制，多用短句。' }
      }
      if (channel === 'fs:list-dir') return []
      if (channel === 'db:character-get-all') return []
      if (channel === 'db:project-core-get') return {}
      if (channel === 'db:draft-get-all-chapter-numbers') return []
      if (channel === 'db:draft-next-version') return 1
      if (channel === 'db:draft-create') return { success: true, id: 1 }
      return {}
    })
    const spy = vi.spyOn(ChapterPromptBuilder.prototype, 'withWritingStyle')

    await new TestableGenerateDraft().execute(makeParams())

    expect(spy.mock.calls.some(c => c[0] === '冷峻克制，多用短句。')).toBe(true)
    spy.mockRestore()
  })
})
