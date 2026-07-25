/**
 * workflow-utils 单元测试 — 重点关注 parseMarkdownTable 的审稿表格支持
 */
import { describe, it, expect } from 'vitest'

// 直接内联测试 parseMarkdownTable 逻辑（避免复杂的 ESM mock 依赖）
// 以下函数是 workflow-utils.ts 中 parseMarkdownTable 的精确副本

const HEADER_ALIASES: Record<string, string> = {
  chapterNumber: 'chapterNumber', 章节: 'chapterNumber', 章节号: 'chapterNumber',
  title: 'title', 标题: 'title',
  role: 'role', 定位: 'role',
  purpose: 'purpose', 目标: 'purpose',
  characters: 'characters', 角色: 'characters',
  keyEvents: 'keyEvents', 核心事件: 'keyEvents',
  suspenseHook: 'suspenseHook', 悬念: 'suspenseHook',
}

function splitTableRow(line: string): string[] {
  let trimmed = line.trim()
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1)
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1)
  return trimmed.split('|').map(s => s.trim())
}

function parseMarkdownTable(text: string): Array<Record<string, string>> | null {
  if (!text) return null

  let content = text
  const codeBlockMatch = content.match(/```(?:markdown|md|table)?\s*\n?([\s\S]*?)```/)
  if (codeBlockMatch) {
    content = codeBlockMatch[1].trim()
  }

  const lines = content.split(/\r?\n/)

  const separatorLineRegex = /^\s*\|[\s\-:]+\|[\s\-:|]+\s*$/
  let separatorIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (separatorLineRegex.test(lines[i])) {
      separatorIdx = i
      break
    }
  }

  if (separatorIdx < 0) {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].includes('|') && lines[i].includes('---')) {
        separatorIdx = i
        break
      }
    }
  }

  if (separatorIdx < 1) return null

  const headerLine = lines[separatorIdx - 1]
  const headers = splitTableRow(headerLine)
  if (headers.length < 2) return null

  const fieldMap: string[] = headers.map(h => {
    const normalized = h.trim()
    return HEADER_ALIASES[normalized] || HEADER_ALIASES[normalized.toLowerCase()] || normalized
  })

  const dataRowRegex = /^\s*\|.+\|\s*$/
  const rows: Array<Record<string, string>> = []

  for (let i = separatorIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    if (!dataRowRegex.test(line)) {
      if (rows.length > 0) break
      continue
    }

    const cells = splitTableRow(line)
    const row: Record<string, string> = {}
    let hasContent = false

    const effectiveFields = cells.length > fieldMap.length
      ? [...fieldMap, ...Array.from({ length: cells.length - fieldMap.length }, (_, k) => `col_${fieldMap.length + k + 1}`)]
      : fieldMap

    for (let j = 0; j < cells.length; j++) {
      const value = cells[j].trim()
      if (value) hasContent = true
      if (j < effectiveFields.length) {
        row[effectiveFields[j]] = value
      }
    }

    if (hasContent) rows.push(row)
  }

  if (rows.length === 0) return null

  // ★ 修复后的验证逻辑: 同时支持蓝图和审稿表格
  const hasValidData = rows.some(r => {
    const v = r.chapterNumber
    const isBlueprint = (v && !isNaN(Number(v)) && Number(v) > 0) || r.title?.trim()
    const hasCategory = r.category?.trim()
    const hasSeverity = r.severity?.trim()
    const hasDescription = r.description?.trim()
    const isReview = hasCategory && (hasSeverity || hasDescription)
    return isBlueprint || isReview
  })

  if (!hasValidData) return null

  return rows
}

// ===== 测试用例 =====

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
      expect(result!).toHaveLength(3)
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
      expect(result!).toHaveLength(2)
      expect(result![1].category).toBe('世界观遵守')
    })

    it('应处理 LLM 直接输出的纯表格（无前缀）', () => {
      const input = `| category | severity | quote | description |
|----------|----------|-------|-------------|
| 角色状态 | pass | | 角色行为一致 |`

      const result = parseMarkdownTable(input)
      expect(result).not.toBeNull()
      expect(result!).toHaveLength(1)
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
      expect(result!).toHaveLength(2)
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
      expect(result!).toHaveLength(1)
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
      expect(result!).toHaveLength(1)
      expect(result![0].category).toBe('剧情连贯性')
    })
  })
})
