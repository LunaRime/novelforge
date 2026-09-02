import { describe, it, expect } from 'vitest'
import {
  parseStylePromptFile,
  styleNameFromFile,
  mergeStyleLayers,
  toStyleInfo,
  DEFAULT_STYLE_NAME,
  appendWritingStyle,
} from './style-registry'
import type { StyleMeta } from '../../shared/ipc-channels'

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
