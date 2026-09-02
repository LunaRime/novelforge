// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'
import { ChapterPromptBuilder } from '../../prompts/prompt-builder'
import { RefineDraftCommand } from './refine-draft.command'
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
        genre: '',
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
  return { chapterNumber: 1, title: '第一章', role: 'protagonist', purpose: 'refine', characters: [], keyEvents: '开局' }
}

function makeParams(): CommandExecuteParams {
  return {
    step: {},
    context: { data: {}, cancelled: false },
    callbacks: { log: vi.fn(), setProgress: vi.fn(), appendText: vi.fn() },
  }
}

/** 测试子类：覆写 protected callLLM 短路 LLM 调用（refine 经 callLLMWithBuilder → this.callLLM） */
class TestableRefineDraft extends RefineDraftCommand {
  constructor() {
    super({
      draftPath: 'vela://draft/1',
      draftContent: '待精修正文内容',
      chapterNumber: 1,
      chapterInfo: makeChapterInfo(),
    })
  }
  protected async callLLM(): Promise<string> { return '已精修正文' }
}

beforeEach(() => {
  mockInvoke.mockReset()
  mockInvoke.mockImplementation(async (...args: unknown[]) => {
    const channel = String(args[0])
    switch (channel) {
      case 'fs:list-dir': return []
      case 'db:character-get-all': return []
      case 'db:draft-get-meta': return { id: 1, version: 1, status: 'draft', source: 'write', content: '待精修正文内容' }
      case 'db:revision-next-index': return 1
      case 'db:revision-get-pending': return []
      case 'db:revision-create': return { success: true, id: 1 }
      default: return {}
    }
  })
})

describe('RefineDraftCommand 输出风格注入接线（C3 修稿扩展命令级回归）', () => {
  it('无 default.md → writing_style 变量 === config.writingStyle 原值（含边界空格，逐字不变）', async () => {
    makeProject('既有文风（含边界空格）  ')
    const spy = vi.spyOn(ChapterPromptBuilder.prototype, 'withWritingStyle')

    const result = await new TestableRefineDraft().execute(makeParams())
    expect(result).toBe('已精修正文')

    const writingStyleArg = spy.mock.calls.find(c => c[0] === '既有文风（含边界空格）  ')
    expect(writingStyleArg).toBeTruthy()
    expect(spy.mock.calls.filter(c => c[0] === '既有文风（含边界空格）  ')).toHaveLength(1)
    spy.mockRestore()
  })

  it('无 default.md + config 为空 → writing_style 变量 === ""（修稿模板空段裁剪保持）', async () => {
    makeProject('')
    const spy = vi.spyOn(ChapterPromptBuilder.prototype, 'withWritingStyle')

    await new TestableRefineDraft().execute(makeParams())
    expect(spy.mock.calls.some(c => c[0] === '')).toBe(true)
    spy.mockRestore()
  })

  it('有 default.md → writing_style 变量 = config + \\n\\n + 风格正文（风格正文进入 withWritingStyle）', async () => {
    makeProject('基调：沉重')
    mockInvoke.mockImplementation(async (...args: unknown[]) => {
      const channel = String(args[0])
      if (channel === 'styles:get') {
        return { name: 'default', description: '激活', promptBody: '冷峻克制，多用短句。' }
      }
      switch (channel) {
        case 'fs:list-dir': return []
        case 'db:character-get-all': return []
        case 'db:draft-get-meta': return { id: 1, version: 1, status: 'draft', source: 'write', content: '待精修正文内容' }
        case 'db:revision-next-index': return 1
        case 'db:revision-get-pending': return []
        case 'db:revision-create': return { success: true, id: 1 }
        default: return {}
      }
    })
    const spy = vi.spyOn(ChapterPromptBuilder.prototype, 'withWritingStyle')

    await new TestableRefineDraft().execute(makeParams())

    expect(mockInvoke).toHaveBeenCalledWith('styles:get', projectPath, 'default')
    const writingStyleArg = spy.mock.calls.find(c => c[0] === '基调：沉重\n\n冷峻克制，多用短句。')
    expect(writingStyleArg).toBeTruthy()
    spy.mockRestore()
  })

  it('有 default.md + config 为空 → writing_style 变量 = 仅风格正文', async () => {
    makeProject('')
    mockInvoke.mockImplementation(async (...args: unknown[]) => {
      const channel = String(args[0])
      if (channel === 'styles:get') {
        return { name: 'default', description: '激活', promptBody: '冷峻克制，多用短句。' }
      }
      switch (channel) {
        case 'fs:list-dir': return []
        case 'db:character-get-all': return []
        case 'db:draft-get-meta': return { id: 1, version: 1, status: 'draft', source: 'write', content: '待精修正文内容' }
        case 'db:revision-next-index': return 1
        case 'db:revision-get-pending': return []
        case 'db:revision-create': return { success: true, id: 1 }
        default: return {}
      }
    })
    const spy = vi.spyOn(ChapterPromptBuilder.prototype, 'withWritingStyle')

    await new TestableRefineDraft().execute(makeParams())

    expect(spy.mock.calls.some(c => c[0] === '冷峻克制，多用短句。')).toBe(true)
    spy.mockRestore()
  })
})
