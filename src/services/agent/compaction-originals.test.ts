/**
 * 分卷存储测试（B 档第二轮 T1）
 *
 * 靶点：被压缩的原文此前内联在会话 archive JSON 里（且清理逻辑有 bug：只清下标 0 →
 * batch 2+ 永不释放、磁盘无界增长）。改为分卷落盘：会话 JSON 只留引用，原文永不丢失、可重生成摘要。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('../ipc-client', () => ({ ipc: { invoke: invokeMock } }))

import { writeBatchOriginal, readBatchOriginal, deleteAllOriginals, countOriginals, deleteBatchOriginals } from './compaction-originals'
import type { AgentMessage } from '../../stores/agent-store'

const msg = (id: string): AgentMessage => ({ id, role: 'user', content: `内容-${id}`, createdAt: 1 })

/** 模拟主进程的文件存储 */
let files: Record<string, string>

beforeEach(() => {
  files = {}
  invokeMock.mockReset()
  invokeMock.mockImplementation(async (ch: string, id: string, content?: string) => {
    if (ch === 'fs:agent-archive-original-write') {
      files[id] = String(content)
      return { success: true }
    }
    if (ch === 'fs:agent-archive-original-read') {
      return { success: true, content: files[id] ?? null }
    }
    if (ch === 'fs:agent-archive-original-delete') {
      delete files[id]
      return { success: true }
    }
    return null
  })
})

describe('分卷存储（compaction-originals）', () => {
  it('写入后读回', async () => {
    await writeBatchOriginal('c1', 1, [msg('m1')])
    expect((await readBatchOriginal('c1', 1))?.[0].id).toBe('m1')
  })

  it('同批次覆盖幂等（重生成/重压缩不叠加）', async () => {
    await writeBatchOriginal('c1', 1, [msg('m1')])
    await writeBatchOriginal('c1', 1, [msg('m2')])
    const read = await readBatchOriginal('c1', 1)
    expect(read).toHaveLength(1)
    expect(read?.[0].id).toBe('m2')
  })

  it('不同批次互不覆盖', async () => {
    await writeBatchOriginal('c1', 1, [msg('m1')])
    await writeBatchOriginal('c1', 2, [msg('m2')])
    expect((await readBatchOriginal('c1', 1))?.[0].id).toBe('m1')
    expect((await readBatchOriginal('c1', 2))?.[0].id).toBe('m2')
  })

  it('不存在的批次 → null（不抛）', async () => {
    expect(await readBatchOriginal('c1', 9)).toBeNull()
  })

  it('分卷损坏 → null（fail-safe）', async () => {
    files['c1'] = '{broken'
    expect(await readBatchOriginal('c1', 1)).toBeNull()
  })

  it('删除会话 → 分卷清空', async () => {
    await writeBatchOriginal('c1', 1, [msg('m1')])
    await deleteAllOriginals('c1')
    expect(await readBatchOriginal('c1', 1)).toBeNull()
  })

  it('countOriginals 返回批次数与总字节', async () => {
    await writeBatchOriginal('c1', 1, [msg('m1')])
    await writeBatchOriginal('c1', 2, [msg('m2')])
    const counts = await countOriginals('c1')
    expect(counts.batches).toBe(2)
    expect(counts.bytes).toBeGreaterThan(0)
  })
})

describe('deleteBatchOriginals（§7.1-C2 评审 I1：批量删必须一次读-改-写）', () => {
  it('一次调用删掉全部指定批次，且只写一次盘（并发逐条删会丢更新）', async () => {
    await writeBatchOriginal('c1', 1, [msg('a')])
    await writeBatchOriginal('c1', 2, [msg('b')])
    await writeBatchOriginal('c1', 3, [msg('c')])
    const writesBefore = invokeMock.mock.calls.filter(c => c[0] === 'fs:agent-archive-original-write').length

    await deleteBatchOriginals('c1', [1, 2, 3])

    const writesAfter = invokeMock.mock.calls.filter(c => c[0] === 'fs:agent-archive-original-write').length
    expect(writesAfter - writesBefore).toBe(1)          // 一次读-改-写
    expect(JSON.parse(files['c1']).batches).toEqual({}) // 三批全释放（不是只释放最后一批）
  })

  it('待删批次不存在时不写盘（幂等，不制造无谓 IO）', async () => {
    await writeBatchOriginal('c1', 5, [msg('e')])
    const before = invokeMock.mock.calls.filter(c => c[0] === 'fs:agent-archive-original-write').length
    await deleteBatchOriginals('c1', [99])
    const after = invokeMock.mock.calls.filter(c => c[0] === 'fs:agent-archive-original-write').length
    expect(after).toBe(before)
    expect(JSON.parse(files['c1']).batches['5']).toBeTruthy()
  })

  it('只删指定的那些，保留集不受影响（批号有空洞时也不越界）', async () => {
    for (const b of [1, 2, 4]) await writeBatchOriginal('c1', b, [msg(`m${b}`)])
    await deleteBatchOriginals('c1', [1, 4])          // 2 不在删除集里
    expect(Object.keys(JSON.parse(files['c1']).batches)).toEqual(['2'])
  })
})
