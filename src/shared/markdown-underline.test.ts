import { expect, it } from 'vitest'
import { stripMarkdownUnderline, toggleMarkdownUnderline } from './markdown-underline'

it('只移除正文成对标记，保留内容、代码、转义标记和其他 HTML', () => {
  const text = '# <u>标题</u>\n\n<u>第一行\n第二行 <u>加重</u></u>\n\n`<u>代码</u>` \\<u>转义</u>\n\n<u class="note">HTML</u>\n\n<u>未闭合'
  expect(stripMarkdownUnderline(text)).toBe('# 标题\n\n第一行\n第二行 加重\n\n`<u>代码</u>` \\<u>转义</u>\n\n<u class="note">HTML</u>\n\n<u>未闭合')
})

it('跨段落选区可添加并撤销下划线，保留标题、列表和任务语法', () => {
  const format = (text: string) => toggleMarkdownUnderline(text, 0, text.length).reverse()
    .reduce((body, { from, to, insert }) => `${body.slice(0, from)}${insert}${body.slice(to)}`, text)
  const text = '# 标题 ##\n\n普通正文\n\n- 列表\n- [x] 任务'
  const marked = '# <u>标题</u> ##\n\n<u>普通正文</u>\n\n- <u>列表</u>\n- [x] <u>任务</u>'
  expect(format(text)).toBe(marked)
  expect(format(marked)).toBe(text)
})
