import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  parseStylePromptFile,
  styleNameFromFile,
  mergeStyleLayers,
  toStyleInfo,
  DEFAULT_STYLE_NAME,
  appendWritingStyle,
  listStyles,
  getStyle,
  getActiveStyle,
} from './style-registry'
import { ipc } from '../ipc-client'
import { ChapterPromptBuilder } from '../prompts/prompt-builder'
import type { StyleMeta } from '../../shared/ipc-channels'

vi.mock('../ipc-client', () => ({
  ipc: { invoke: vi.fn() },
}))

const mockInvoke = vi.mocked(ipc.invoke)
const projectPath = 'C:/projects/demo'

function meta(name: string, description: string, promptBody: string): StyleMeta {
  return { name, description, promptBody }
}

describe('parseStylePromptFile — frontmatter 解析', () => {
  it('frontmatter description + 正文', () => {
    const raw = '---\ndescription: 冷峻克制的文风\n---\n\n第一人称视角，短句为主。'
    expect(parseStylePromptFile(raw, 'cold.md')).toEqual(meta('cold', '冷峻克制的文风', '第一人称视角，短句为主。'))
  })

  it('frontmatter 无 description → 描述为空', () => {
    expect(parseStylePromptFile('---\ntags: x\n---\n正文', 'a.md')).toEqual(meta('a', '', '正文'))
  })

  it('description 值可含冒号（首个冒号切分 key/value）', () => {
    expect(parseStylePromptFile('---\ndescription: 偏日系：治愈\n---\n正文', 'a.md')?.description).toBe('偏日系：治愈')
  })

  it('无 frontmatter（纯正文文件）→ 整文件为 prompt，描述为空（零代码 default.md 语义）', () => {
    expect(parseStylePromptFile('直接写正文，不要前缀说明。', 'default.md')).toEqual(meta('default', '', '直接写正文，不要前缀说明。'))
  })

  it('空文件 / 纯空白 → null（跳过）', () => {
    expect(parseStylePromptFile('', 'a.md')).toBeNull()
    expect(parseStylePromptFile('   \n  ', 'a.md')).toBeNull()
  })

  it('以 --- 开头但无闭合 --- → 非法 frontmatter → null（跳过不崩）', () => {
    expect(parseStylePromptFile('---\ndescription: 缺闭合', 'broken.md')).toBeNull()
  })

  it('frontmatter 闭合但正文为空 → null（无 prompt 可注入）', () => {
    expect(parseStylePromptFile('---\ndescription: x\n---\n  ', 'empty-body.md')).toBeNull()
  })

  it('CRLF 换行可解析', () => {
    const raw = '---\r\ndescription: Windows 换行\r\n---\r\n\r\n正文内容'
    expect(parseStylePromptFile(raw, 'win.md')).toEqual(meta('win', 'Windows 换行', '正文内容'))
  })

  it('非法输入（null/undefined raw）→ null 不抛', () => {
    expect(parseStylePromptFile(null as unknown as string, 'a.md')).toBeNull()
    expect(parseStylePromptFile(undefined as unknown as string, 'a.md')).toBeNull()
  })
})

describe('styleNameFromFile', () => {
  it('去 .md 后缀', () => {
    expect(styleNameFromFile('default.md')).toBe('default')
    expect(styleNameFromFile('my.style.md')).toBe('my.style')
  })
})

describe('mergeStyleLayers — 双层合并（项目覆盖用户）', () => {
  it('同名 → 项目覆盖用户（含 description 与 promptBody）', () => {
    const user = [meta('default', '用户版描述', '用户版正文')]
    const project = [meta('default', '项目版描述', '项目版正文')]
    const merged = mergeStyleLayers(project, user)
    expect(merged).toHaveLength(1)
    expect(merged[0]).toEqual(meta('default', '项目版描述', '项目版正文'))
  })

  it('并集：用户独有保留 + 按 name 排序', () => {
    const user = [meta('zzz', '', 'u'), meta('aaa', '', 'u')]
    const project = [meta('mmm', '', 'p')]
    expect(mergeStyleLayers(project, user).map(s => s.name)).toEqual(['aaa', 'mmm', 'zzz'])
  })

  it('空输入不崩', () => {
    expect(mergeStyleLayers([], [])).toEqual([])
    expect(mergeStyleLayers([meta('p', '', 'x')], [])).toHaveLength(1)
  })

  it('同一层内重名 → 后者胜出（project 数组内后者覆盖前者）', () => {
    const project = [meta('default', '旧', '旧正文'), meta('default', '新', '新正文')]
    const merged = mergeStyleLayers(project, [])
    expect(merged[0]).toEqual(meta('default', '新', '新正文'))
  })
})

describe('toStyleInfo / DEFAULT_STYLE_NAME', () => {
  it('列表载荷剥去 promptBody', () => {
    expect(toStyleInfo(meta('default', '描述', '正文'))).toEqual({ name: 'default', description: '描述' })
  })

  it('默认激活风格名为 default（default.md 零代码注册语义）', () => {
    expect(DEFAULT_STYLE_NAME).toBe('default')
  })
})

describe('appendWritingStyle — 风格正文追加到既有 writingStyle', () => {
  it('无激活风格正文 → 原值逐字不变（行为兼容）', () => {
    const existing = ' 既有文风（含边界空格）  '
    expect(appendWritingStyle(existing, '')).toBe(existing)
    expect(appendWritingStyle(existing, '   ')).toBe(existing)
  })

  it('二者皆空 → 空', () => {
    expect(appendWritingStyle('', '')).toBe('')
    expect(appendWritingStyle(undefined as unknown as string, '')).toBe('')
  })

  it('既有文风空 + 风格正文 → 仅风格正文（无前导分隔）', () => {
    expect(appendWritingStyle('', '风格指令')).toBe('风格指令')
  })

  it('二者非空 → 既有 + 空行 + 风格正文', () => {
    expect(appendWritingStyle('基调：冷峻', '多用短句。')).toBe('基调：冷峻\n\n多用短句。')
  })
})

describe('style-registry IPC API（styles:list / styles:get 通道契约）', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
  })

  it('listStyles → styles:list(projectPath) 透传；损坏/异常 → []', async () => {
    mockInvoke.mockResolvedValueOnce([{ name: 'a', description: 'A' }])
    await expect(listStyles(projectPath)).resolves.toEqual([{ name: 'a', description: 'A' }])
    expect(mockInvoke).toHaveBeenCalledWith('styles:list', projectPath)

    mockInvoke.mockRejectedValueOnce(new Error('ipc down'))
    await expect(listStyles(projectPath)).resolves.toEqual([])
  })

  it('getStyle → styles:get(projectPath, name) 透传；不存在/异常 → null', async () => {
    mockInvoke.mockResolvedValueOnce({ name: 'default', description: 'd', promptBody: '正文' })
    await expect(getStyle('default', projectPath)).resolves.toEqual({ name: 'default', description: 'd', promptBody: '正文' })
    expect(mockInvoke).toHaveBeenCalledWith('styles:get', projectPath, 'default')

    mockInvoke.mockResolvedValueOnce(null)
    await expect(getStyle('nope', projectPath)).resolves.toBeNull()
    mockInvoke.mockRejectedValueOnce(new Error('down'))
    await expect(getStyle('nope', projectPath)).resolves.toBeNull()
  })

  it('getActiveStyle → 固定请求 DEFAULT_STYLE_NAME', async () => {
    mockInvoke.mockResolvedValue({ name: 'default', description: '激活', promptBody: '激活正文' })
    const active = await getActiveStyle(projectPath)
    expect(active?.promptBody).toBe('激活正文')
    expect(mockInvoke).toHaveBeenCalledWith('styles:get', projectPath, DEFAULT_STYLE_NAME)
  })
})

describe('注入接线（generate-draft 同款 seam：getActiveStyle + appendWritingStyle → withWritingStyle）', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
  })

  function makeChapterTemplate(content: string) {
    return {
      key: 'test_chapter',
      name: '章节',
      description: 'd',
      content,
      variables: { writing_style: '文风' },
    }
  }

  it('无 default.md（styles:get → null）→ writing_style 与现状逐字一致（含空既有值）', async () => {
    mockInvoke.mockResolvedValueOnce(null)
    const activeBody = (await getActiveStyle(projectPath))?.promptBody ?? ''
    const existing = '既有文风（含边界空格）  '
    const value = appendWritingStyle(existing, activeBody)
    // 与旧代码 .withWritingStyle(project.novelConfig.writingStyle || '') 一致
    expect(value).toBe(existing)

    const builder = new ChapterPromptBuilder(makeChapterTemplate('【文风】{{writing_style}}'))
    builder.withWritingStyle(appendWritingStyle('', activeBody))
    const variables = (builder as unknown as { variables: Record<string, string> }).variables
    expect(variables.writing_style).toBe('') // 空值 → 模板空段裁剪同现状
  })

  it('有 default.md → 风格正文追加进 withWritingStyle 的 writing_style 变量（含空既有值只取正文）', async () => {
    mockInvoke.mockResolvedValueOnce({ name: 'default', description: '激活', promptBody: '冷峻克制，多用短句。' })
    const active = await getActiveStyle(projectPath)
    const activeBody = active?.promptBody ?? ''
    expect(activeBody).toBe('冷峻克制，多用短句。')

    const withExisting = appendWritingStyle('基调：沉重', activeBody)
    expect(withExisting).toBe('基调：沉重\n\n冷峻克制，多用短句。')
    const onlyBody = appendWritingStyle('', activeBody)
    expect(onlyBody).toBe('冷峻克制，多用短句。')

    const builder = new ChapterPromptBuilder(makeChapterTemplate('【文风】{{writing_style}}'))
    builder.withWritingStyle(withExisting)
    const variables = (builder as unknown as { variables: Record<string, string> }).variables
    expect(variables.writing_style).toBe('基调：沉重\n\n冷峻克制，多用短句。')
    // 注入经 build 落进最终 prompt（USER_INPUT 包裹后仍含正文）
    const built = builder.build()
    expect(built).toContain('冷峻克制，多用短句。')
  })
})
