/**
 * 分卷存储测试（B 档第二轮 T1）
 *
 * 靶点：被压缩的原文此前内联在会话 archive JSON 里（且清理逻辑有 bug：只清下标 0 →
 * batch 2+ 永不释放、磁盘无界增长）。改为分卷落盘：会话 JSON 只留引用，原文永不丢失、可重生成摘要。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('../ipc-client', () => ({ ipc: { invoke: invokeMock } }))

import { writeBatchOriginal, readBatchOriginal, deleteAllOriginals, countOriginals } from './compaction-originals'
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
