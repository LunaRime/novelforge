/**
 * 查询改写端到端（L3 T5，真实 LanceDB + 真实 jieba 分词 + 真实 RRF 融合）
 *
 * 沙箱内无 Embedding API → 仅把 `generateEmbeddings` 换成**确定性 stub**：
 * 文本含哪些角色形态 → 对应维度置 1（不是对真实 embedding 的近似，只用于验证
 * 「扩展文本 → 语义通道输入 → 召回结果」这条链路是否真的改善召回）。
 *
 * 两个用例：
 * ① 别名 query 经扩展 → 召回只含**正名**的 chunk（扩展生效；无 characters 时为改造前行为）
 * ② 有/无 characters 时 **FTS-only 入口结果完全相同**（扩展不得进入 T3 的词级 AND 通道——
 *    并入变体等于增加 AND 约束，会把别名查询的召回清零；见 task-5-report.md §落点与语义选择）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { searchKnowledge, searchKnowledgeFTS } from './knowledge-base'
import { addChunks, closeConnection } from './vector-store'

const h = vi.hoisted(() => ({
  db: null as unknown,
  currentProjectPath: null as string | null,
  embedCalls: [] as string[][],
}))

vi.mock('./database', () => ({
  getProjectDb: () => h.db,
  getCurrentProjectPath: () => h.currentProjectPath,
}))

/** 形态维度（顺序固定）：苏晚 / 阿晚 / 晚儿 / 今天 */
const VARIANTS = ['苏晚', '阿晚', '晚儿', '今天']
function stubEmbed(text: string): number[] {
  return [...VARIANTS.map(v => (text.includes(v) ? 1 : 0)), 0.1]
}

vi.mock('./embedding', () => ({
  chunkText: () => [],
  generateEmbeddings: async (texts: string[]) => {
    h.embedCalls.push(texts)
    return texts.map(stubEmbed)
  },
}))

const MODEL = { baseUrl: '', apiKey: 'test-key' }

function makeTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nf-alias-'))
}

async function cleanupProject(projectPath: string): Promise<void> {
  await closeConnection(projectPath)
  fs.rmSync(projectPath, { recursive: true, force: true })
}

function makeCharactersDb(rows: Array<{ name: string; aliases: string }>): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec("CREATE TABLE characters (name TEXT PRIMARY KEY, aliases TEXT DEFAULT '[]')")
  const insert = db.prepare('INSERT INTO characters (name, aliases) VALUES (?, ?)')
  for (const r of rows) insert.run(r.name, r.aliases)
  return db
}

beforeEach(() => {
  h.db = null
  h.currentProjectPath = null
  h.embedCalls.length = 0
})

describe('端到端：别名 query 召回含正名的 chunk（真实 LanceDB，L3 T5）', () => {
  /**
   * 显式 timeout（L3 T6 fix）：本文件是**真实 LanceDB** 端到端（建表 + 写入 + 迁移自检 + 双通道检索），
   * 默认 5s 在 CI/官方环境与并发负载下会抖（T6 门禁实测：并发跑时首例 > 5s 触发
   * "Test timed out in 5000ms"）。断言逐字未改，只放宽时限。
   */
  const E2E_TIMEOUT_MS = 30_000

  it('扩展生效：query 用别名「阿晚」→ 召回只含正名「苏晚」的 chunk；无 characters 时与改造前一致', async () => {
    const projectPath = makeTempProject()
    try {
      h.currentProjectPath = projectPath
      // 正名 chunk（只含 苏晚/晚儿/今天 形态）；对照 chunk 只含别名 阿晚
      const canonical = '苏晚（晚儿）今天在城墙上等待'
      const aliasOnly = '阿晚离开了'
      await addChunks(projectPath, randomUUID(), '第1章 正名.txt', [canonical], [stubEmbed(canonical)])
      await addChunks(projectPath, randomUUID(), '第2章 别名.txt', [aliasOnly], [stubEmbed(aliasOnly)])

      const query = '阿晚今天做了什么'

      // ① 基线 = 无 characters（改造前行为）：别名 query 只贴近别名 chunk
      h.db = null
      const before = await searchKnowledge(query, projectPath, 'openai', MODEL, 1)
      expect(before).toHaveLength(1)
      expect(before[0].text).toBe(aliasOnly)

      // ② 有 characters 别名注册表：query 扩展为「正名 + 别名」→ 语义通道召回含正名的 chunk
      h.db = makeCharactersDb([{ name: '苏晚', aliases: '["阿晚","晚儿"]' }])
      const after = await searchKnowledge(query, projectPath, 'openai', MODEL, 1)
      expect(after).toHaveLength(1)
      expect(after[0].text).toBe(canonical)
      // knowledge-base 声明的返回类型只含 3 键（source 由 vector-store 的 SearchResult 携带）→ 显式取用
      expect((after[0] as { source?: string }).source).toBe('vector')
      expect(Object.keys(after[0]).sort()).toEqual(['fileName', 'score', 'source', 'text'])

      // 语义通道输入确实被改写（词法通道不受影响 → 见下一个用例）
      expect(h.embedCalls).toEqual([[query], [`${query} 苏晚 晚儿`]])
    } finally {
      await cleanupProject(projectPath)
    }
  }, E2E_TIMEOUT_MS)

  it('回归守卫：有/无 characters 时 FTS-only 检索结果逐字相同（扩展不进 T3 的 AND 通道）', async () => {
    const projectPath = makeTempProject()
    try {
      h.currentProjectPath = projectPath
      const canonical = '苏晚（晚儿）今天在城墙上等待'
      const aliasOnly = '阿晚离开了'
      await addChunks(projectPath, randomUUID(), '第1章 正名.txt', [canonical], [stubEmbed(canonical)])
      await addChunks(projectPath, randomUUID(), '第2章 别名.txt', [aliasOnly], [stubEmbed(aliasOnly)])

      // 别名 query 在词级 AND 下命中只含别名的 chunk（非空，是本守卫有意义的前提）
      h.db = null
      const withoutCharacters = await searchKnowledgeFTS('阿晚', projectPath, 2)
      expect(withoutCharacters.map(r => r.text)).toEqual([aliasOnly])

      // 有 characters 且 query 命中别名：若把扩展并入 query 交给词法通道，
      // 词表会变成 [阿晚, 苏晚, 晚儿] → AND 要求 chunk 同时含三种形态 → 本用例将返回空
      h.db = makeCharactersDb([{ name: '苏晚', aliases: '["阿晚","晚儿"]' }])
      const withCharacters = await searchKnowledgeFTS('阿晚', projectPath, 2)
      expect(withCharacters).toEqual(withoutCharacters)
    } finally {
      await cleanupProject(projectPath)
    }
  }, E2E_TIMEOUT_MS)
})
