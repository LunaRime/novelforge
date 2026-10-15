/**
 * ccr-fidelity — 压缩保真检查（P1-2）纯函数测试：
 * 实体抽取（写入目标 / 角色名 / 章节号）+ 保留率 + 阈值分支。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import {
  collectBatchEntities,
  checkSummaryFidelity,
  extractChapterCores,
  shouldWarnFidelity,
  FIDELITY_MIN_ENTITIES,
  FIDELITY_WARN_RATIO,
} from './ccr-fidelity'
import { toolRegistry } from './tool-registry'
import type { AgentMessage } from '../../stores/agent-store'

beforeAll(() => {
  // extractSideEffectReceipts 依赖注册表判定「是否有副作用」：注册一个写类探针工具
  toolRegistry.register({
    name: 'p12-write-probe',
    description: '测试探针（写类）',
    source: 'builtin',
    inputSchema: { type: 'object', properties: { file_path: { type: 'string', description: '路径' } }, required: ['file_path'] },
    requiresConfirmation: true,
    isReadOnly: false,
    execute: async () => ({ success: true, content: 'ok' }),
  })
  toolRegistry.register({
    name: 'p12-read-probe',
    description: '测试探针（读类）',
    source: 'builtin',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiresConfirmation: false,
    isReadOnly: true,
    execute: async () => ({ success: true, content: 'ok' }),
  })
})

const msg = (over: Partial<AgentMessage>): AgentMessage => ({
  id: `m${Math.random()}`,
  role: 'user',
  content: '',
  createdAt: 0,
  ...over,
})

describe('collectBatchEntities：实体抽取', () => {
  it('写入目标：从写类工具调用抽取并去重；读类不进；失败写入也算（关键事实）', () => {
    const batch = [
      msg({
        content: '写两章',
        toolCalls: [
          { id: 't1', toolName: 'p12-write-probe', arguments: { file_path: 'drafts/c1.md' }, status: 'completed' },
          { id: 't2', toolName: 'p12-read-probe', arguments: {}, status: 'completed' },
          { id: 't3', toolName: 'p12-write-probe', arguments: { file_path: 'drafts/c2.md' }, status: 'failed' },
          // 同 target 重复写：只留最新一条（去重）
          { id: 't4', toolName: 'p12-write-probe', arguments: { file_path: 'drafts/c1.md' }, status: 'completed' },
        ],
      }),
    ]
    const entities = collectBatchEntities(batch, { characterNames: [] })
    const targets = entities.filter(e => e.kind === 'write-target').map(e => e.value)
    expect(targets).toEqual(['drafts/c1.md', 'drafts/c2.md'])
  })

  it('角色名：只抽「传入清单 ∩ 批次文本」的名字', () => {
    const batch = [msg({ content: '苏晚晴走进房间，林澈沉默。' })]
    const entities = collectBatchEntities(batch, { characterNames: ['苏晚晴', '未出场者'] })
    expect(entities.filter(e => e.kind === 'character').map(e => e.value)).toEqual(['苏晚晴'])
  })

  it('章节号：第 3 章 / 第三章 / Chapter 5 归一为数字核心并去重', () => {
    const batch = [msg({ content: '先写第三章，再补第 3 章（同一章），最后 Chapter 5。' })]
    const entities = collectBatchEntities(batch, { characterNames: [] })
    expect(entities.filter(e => e.kind === 'chapter').map(e => e.value).sort()).toEqual(['3', '5'])
  })

  it('extractChapterCores 支持十/百复合中文数字', () => {
    expect([...extractChapterCores('从第十一章到第一百零二章')].sort((a, b) => Number(a) - Number(b)))
      .toEqual(['11', '102'])
  })
})

describe('checkSummaryFidelity：保留率', () => {
  it('命中 → 保留；缺失 → misses + missingKinds（章节号按数字核心跨写法命中）', () => {
    const entities = [
      { kind: 'write-target' as const, value: 'drafts/c1.md' },
      { kind: 'character' as const, value: '苏晚晴' },
      { kind: 'chapter' as const, value: '3' },
    ]
    const ok = checkSummaryFidelity(entities, '已写入 drafts/c1.md，苏晚晴负责第三章。')
    expect(ok).toMatchObject({ extracted: 3, retained: 3, ratio: 1 })
    expect(ok.misses).toEqual([])

    const bad = checkSummaryFidelity(entities, '说了点别的。')
    expect(bad).toMatchObject({ extracted: 3, retained: 0, ratio: 0 })
    expect(bad.missingKinds.sort()).toEqual(['chapter', 'character', 'write-target'])
  })

  it('空白 / 全角数字归一：带空格的「第 3 章」与「第3章」互认', () => {
    const entities = [{ kind: 'chapter' as const, value: '3' }]
    expect(checkSummaryFidelity(entities, '推进第 3 章').retained).toBe(1)
    expect(checkSummaryFidelity(entities, '推进第３章').retained).toBe(1)
  })

  it('无实体 → ratio 1（无从告警）', () => {
    expect(checkSummaryFidelity([], '任意摘要').ratio).toBe(1)
  })
})

describe('shouldWarnFidelity：阈值分支', () => {
  it('实体数不足不告警（样本太小）', () => {
    expect(shouldWarnFidelity({ extracted: FIDELITY_MIN_ENTITIES - 1, ratio: 0 })).toBe(false)
  })

  it('实体数达标且低于阈值 → 告警；等于阈值不告警（严格小于）', () => {
    expect(shouldWarnFidelity({ extracted: FIDELITY_MIN_ENTITIES, ratio: 0.1 })).toBe(true)
    expect(shouldWarnFidelity({ extracted: 10, ratio: FIDELITY_WARN_RATIO })).toBe(false)
    expect(shouldWarnFidelity({ extracted: 10, ratio: FIDELITY_WARN_RATIO - 0.01 })).toBe(true)
  })
})
