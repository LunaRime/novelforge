/**
 * workflow-utils 单元测试 — parseMarkdownTable / robustParseJSON / extractAndRepairJSON
 *
 * 历史问题：本文件曾是 parseMarkdownTable 的内联副本（与实现漂移：HEADER_ALIASES 子集、
 * 缺 isCharacter 分支）——改实现不改进测试会误报/漏报。现直接 import 生产模块。
 */
import { describe, it, expect } from 'vitest'
import { parseMarkdownTable, robustParseJSON, extractAndRepairJSON } from './workflow-utils'

describe('parseMarkdownTable', () => {
  describe('审稿表格解析 (Bug Fix)', () => {
    it('应正确解析标准 Markdown 审稿表格', () => {
      const input = `| category | severity | quote | description |
|----------|----------|-------|-------------|
| 剧情连贯性 | pass | | 未发现与前文矛盾 |
| 剧情合理性 | error | 他三天前还在京城 | 时间线矛盾 |
| 角色状态 | warning | 张三突然暴怒 | 不符合冷静人设 |`

      const result = parseMarkdownTable(input)
      expect(result).not.toBeNull()
      expect(result).toHaveLength(3)
      expect(result![0].category).toBe('剧情连贯性')
      expect(result![0].severity).toBe('pass')
      expect(result![0].description).toBe('未发现与前文矛盾')
      expect(result![1].category).toBe('剧情合理性')
      expect(result![1].severity).toBe('error')
      expect(result![2].severity).toBe('warning')
    })

    it('应处理带说明文字的审稿表格（前导文字）', () => {
      const input = `以下是审稿结果：

| category | severity | description |
|----------|----------|-------------|
| 伏笔完整性 | pass | 无遗漏伏笔 |
| 世界观遵守 | error | 违反灵力设定 |

审稿完毕。`

      const result = parseMarkdownTable(input)
      expect(result).not.toBeNull()
      expect(result).toHaveLength(2)
      expect(result![1].category).toBe('世界观遵守')
    })

    it('应处理 LLM 直接输出的纯表格（无前缀）', () => {
      const input = `| category | severity | quote | description |
|----------|----------|-------|-------------|
| 角色状态 | pass | | 角色行为一致 |`

      const result = parseMarkdownTable(input)
      expect(result).not.toBeNull()
      expect(result).toHaveLength(1)
    })

    it('空输入返回 null', () => {
      expect(parseMarkdownTable('')).toBeNull()
    })

    it('无表格文本返回 null', () => {
      expect(parseMarkdownTable('这是一段纯文本，没有表格')).toBeNull()
    })
  })

  describe('蓝图表格解析 (回归测试)', () => {
    it('应正确解析蓝图 Markdown 表格', () => {
      const input = `| 章节号 | 标题 | 定位 | 核心事件 |
|--------|------|------|----------|
| 1 | 穿越 | 开篇 | 主角穿越到异世界 |
| 2 | 觉醒 | 过渡 | 主角觉醒金手指 |`

      const result = parseMarkdownTable(input)
      expect(result).not.toBeNull()
      expect(result).toHaveLength(2)
      expect(result![0].chapterNumber).toBe('1')
      expect(result![0].title).toBe('穿越')
      expect(result![1].chapterNumber).toBe('2')
    })

    it('应正确解析英文表头蓝图表格', () => {
      const input = `| chapterNumber | title | purpose | characters |
|--------------|-------|---------|------------|
| 3 | 决战 | 高潮 | 张三,李四 |`

      const result = parseMarkdownTable(input)
      expect(result).not.toBeNull()
      expect(result).toHaveLength(1)
      expect(result![0].chapterNumber).toBe('3')
    })
  })

  describe('Markdown 代码块包裹', () => {
    it('应提取 markdown 代码块内的审稿表格', () => {
      const input = `以下是审稿结果：

\`\`\`markdown
| category | severity | description |
|----------|----------|-------------|
| 剧情连贯性 | pass | 章节逻辑清晰 |
\`\`\`

以上为评审意见。`

      const result = parseMarkdownTable(input)
      expect(result).not.toBeNull()
      expect(result).toHaveLength(1)
      expect(result![0].category).toBe('剧情连贯性')
    })
  })

  describe('多行单元格（P1 修复：单元格内换行不再丢弃后续行）', () => {
    it('第 2 行 description 换行后，后续行仍被解析', () => {
      const input = `| category | severity | description |
|----------|----------|-------------|
| 剧情连贯性 | pass | 未发现与前文矛盾 |
| 剧情合理性 | error | 时间线矛盾：
主角三天前还在京城，却出现在边关 |
| 角色状态 | warning | 不符合冷静人设 |`

      const result = parseMarkdownTable(input)
      expect(result).not.toBeNull()
      // 3 行全部保留（历史事故：换行后 break，只剩前 2 行）
      expect(result).toHaveLength(3)
      expect(result![1].description).toContain('时间线矛盾')
      expect(result![2].category).toBe('角色状态')
    })
  })

  describe('转义竖线与分隔行误判（P2 修复）', () => {
    it('\\| 转义竖线不被当作列分隔符', () => {
      const input = `| category | description |
|----------|-------------|
| 世界观 | 规则：灵力\\|魔力双体系 |`

      const result = parseMarkdownTable(input)
      expect(result).not.toBeNull()
      expect(result![0].description).toBe('规则：灵力|魔力双体系')
    })

    it('数据行描述含 "---" 不触发分隔行兜底误判', () => {
      const input = `| category | severity | description |
|----------|----------|-------------|
| 剧情连贯性 | pass | 章内节奏 --- 无断裂 |`

      const result = parseMarkdownTable(input)
      expect(result).not.toBeNull()
      expect(result).toHaveLength(1)
      expect(result![0].description).toBe('章内节奏 --- 无断裂')
    })
  })
})

describe('robustParseJSON', () => {
  it('字符串值内的撇号不被单引号替换破坏（P1 修复）', () => {
    const input = `{"description": "It's a trap", "name": "don't stop"}`
    const result = robustParseJSON(input, false)
    expect(result).not.toBeNull()
    const obj = result as Record<string, string>
    expect(obj.description).toBe("It's a trap")
    expect(obj.name).toBe("don't stop")
  })

  it('单引号键与值（模型混用）仍能修复', () => {
    const input = `{ 'name': '张三', 'score': '8分' }`
    const result = robustParseJSON(input, false)
    expect(result).not.toBeNull()
    const obj = result as Record<string, string>
    expect(obj.name).toBe('张三')
  })

  it('大写 ```JSON 与带空格 ``` json 代码块均可提取', () => {
    const upper = "```JSON\n{\"a\": 1}\n```"
    const spaced = "``` json\n{\"b\": 2}\n```"
    expect((robustParseJSON(upper, false) as Record<string, number>).a).toBe(1)
    expect((robustParseJSON(spaced, false) as Record<string, number>).b).toBe(2)
  })
})

describe('extractAndRepairJSON', () => {
  it('大小写/空格变体 fence 均能提取（P2 修复）', () => {
    const upper = "```JSON\n[{\"chapterNumber\": 1}]\n```"
    const spaced = "``` json\n[{\"chapterNumber\": 2}]\n```"
    const r1 = extractAndRepairJSON(upper, true)
    const r2 = extractAndRepairJSON(spaced, true)
    expect(r1.parsed).not.toBeNull()
    expect(r2.parsed).not.toBeNull()
    expect((r1.parsed as Array<Record<string, number>>)[0].chapterNumber).toBe(1)
    expect((r2.parsed as Array<Record<string, number>>)[0].chapterNumber).toBe(2)
  })
})
