/**
 * WorkflowOutputFileStore — 工作流任务输出落盘（M2，CC §三.4 diskOutput）
 *
 * 覆盖：fd 'w' 截断语义（MSYS2/Cygwin 'a' 探测坑规避）、多段 append 字节序、tail 4KB/行数
 * 窗口 + 半截行/UTF-8 字符边界处理、deleteRun 任务级清理、sweep 超龄兜底、崩溃恢复
 * （新实例同目录续读 = 进程重启模拟）、非法 runId/stepIndex 防御（路径穿越）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { WorkflowOutputFileStore, alignUtf8WindowStart } from './workflow-output-store'

let rootDir: string
let store: WorkflowOutputFileStore

beforeEach(async () => {
  rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'nf-workflow-output-'))
  store = new WorkflowOutputFileStore(rootDir)
})

afterEach(async () => {
  await store.closeAll()
  await fsPromises.rm(rootDir, { recursive: true, force: true })
})

const runId = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789'

describe('append / full 读（fd 直写 + 显式字节偏移）', () => {
  it('多段 append 按调用顺序拼接，full 读回 = 拼接结果', async () => {
    // 不 await 逐段（模拟高帧 append IPC 并发到达），队列保证字节序
    const tasks = Array.from({ length: 50 }, (_, i) => store.append(runId, 0, `chunk-${String(i).padStart(3, '0')}\n`))
    const results = await Promise.all(tasks)
    expect(results.every(r => r.success)).toBe(true)

    const tail = await store.readTail(runId, 0, { full: true })
    expect(tail.exists).toBe(true)
    const expected = Array.from({ length: 50 }, (_, i) => `chunk-${String(i).padStart(3, '0')}\n`).join('')
    expect(tail.content).toBe(expected)
    expect(tail.totalBytes).toBe(Buffer.byteLength(expected))
    expect(tail.truncated).toBe(false)
  })

  it("'w' 截断语义：进程重启（新实例同目录）后旧文件被覆盖重写（MSYS2 'a' 探测坑规避）", async () => {
    await store.append(runId, 0, 'old-first-attempt')
    await store.closeAll()

    // 模拟崩溃后重启：同目录新 store（main 进程内存态已丢，文件还在 = 崩溃恢复前提）
    const restarted = new WorkflowOutputFileStore(rootDir)
    try {
      await restarted.append(runId, 0, 'second-attempt')
      const tail = await restarted.readTail(runId, 0, { full: true })
      // 'w' 打开截断 → 文件只有新内容（不会把两次尝试混在一起）
      expect(tail.content).toBe('second-attempt')
    } finally {
      await restarted.closeAll()
    }
  })

  it('空文本/非法入参静默拒绝，不落文件（路径穿越防御）', async () => {
    expect((await store.append(runId, 0, '')).success).toBe(true) // 空文本 = no-op
    expect((await store.append('', 0, 'x')).success).toBe(false)
    expect((await store.append('..\\..\\evil', 0, 'x')).success).toBe(false)
    expect((await store.append('../../escape', 0, 'x')).success).toBe(false)
    expect((await store.append(runId, -1, 'x')).success).toBe(false)
    expect((await store.append(runId, 10_001, 'x')).success).toBe(false)
    expect((await store.readTail('..\\evil', 0)).success).toBe(false)
    expect((await store.deleteRun('../..')).success).toBe(false)
    // 任何文件都未落盘
    const dirs = await fsPromises.readdir(rootDir)
    expect(dirs).toEqual([])
  })
})

describe('readTail（UI 1s 轮询 tail 4KB + 最近 1000 行）', () => {
  it('缺失文件 → exists=false（未流式/已清理步骤），已建文件可读', async () => {
    const missing = await store.readTail(runId, 3)
    expect(missing.exists).toBe(false)
    expect(missing.content).toBe('')
    // 空 append 不建文件（no-op）；真实 append 才落盘
    expect((await store.append(runId, 1, '')).success).toBe(true)
    expect(fs.existsSync(path.join(rootDir, runId, '1.txt'))).toBe(false)
    await store.append(runId, 2, 'x')
    const created = await store.readTail(runId, 2, { full: true })
    expect(created.exists).toBe(true)
    expect(created.content).toBe('x')
  })

  it('超大输出只取尾部 4KB 窗口，窗口截断丢弃不完整首行（内容 = 尾部完整行后缀）', async () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line-${String(i).padStart(3, '0')}` + 'x'.repeat(80))
    const full = lines.join('\n') + '\n'
    await store.append(runId, 0, full)

    const tail = await store.readTail(runId, 0)
    expect(tail.exists).toBe(true)
    expect(tail.truncated).toBe(true)
    expect(tail.content.length).toBeLessThanOrEqual(4096 + 100) // 窗口 + 单行长裕量
    expect(tail.totalBytes).toBe(Buffer.byteLength(full))
    // 尾部最后一行保留（文件以换行结尾 → 取最后一个非空行）
    const lastLine = tail.content.split('\n').filter(Boolean).pop()
    expect(lastLine).toBe('line-199' + 'x'.repeat(80))
    // 窗口起点半截行被丢弃 → 每行都是原始完整行（无半截前缀）
    for (const line of tail.content.split('\n').filter(Boolean)) {
      expect(full.includes(line)).toBe(true)
      expect(line.endsWith('x'.repeat(80))).toBe(true)
    }
  })

  it('UTF-8 多字节字符跨窗口边界不断裂（无替换符 U+FFFD）', async () => {
    // 中文 3 字节字符长行，让窗口起点落在多字节序列内部
    const full = '章'.repeat(3000) + '\nEND'
    await store.append(runId, 0, full)
    const tail = await store.readTail(runId, 0)
    expect(tail.content).toBe('END') // 半截中文行整行丢弃，保留完整尾部行
    expect(tail.content.includes('\uFFFD')).toBe(false)
  })

  it('maxLines 行窗口：只保留最近 N 行（CircularBuffer 1000 行语义）', async () => {
    const full = Array.from({ length: 30 }, (_, i) => `row-${i}`).join('\n')
    await store.append(runId, 0, full)
    const tail = await store.readTail(runId, 0, { maxBytes: 4096, maxLines: 5 })
    expect(tail.content.split('\n')).toEqual(['row-25', 'row-26', 'row-27', 'row-28', 'row-29'])
    expect(tail.truncated).toBe(true)
  })

  it('full=true 整文件续读（崩溃恢复路径），无视窗口限制', async () => {
    const full = Array.from({ length: 5000 }, (_, i) => `r${i}-${'中'.repeat(30)}`).join('\n')
    await store.append(runId, 0, full)
    const tail = await store.readTail(runId, 0, { full: true })
    expect(tail.content).toBe(full)
    expect(tail.truncated).toBe(false)
  })
})

describe('alignUtf8WindowStart（UTF-8 字符边界对齐纯函数）', () => {
  it('窗口起点落在 3 字节字符中间 → 回退到该字符起始', () => {
    const buf = Buffer.from('ab章cd', 'utf8')
    const lead = 2 // '章' 起始字节
    const mid = lead + 1
    expect(alignUtf8WindowStart(buf, 0, mid)).toBe(lead)
  })

  it('起点恰在 ASCII/字符边界 → 不动', () => {
    const buf = Buffer.from('ab章cd', 'utf8')
    expect(alignUtf8WindowStart(buf, 0, 0)).toBe(0)
    expect(alignUtf8WindowStart(buf, 0, 2)).toBe(2)
    expect(alignUtf8WindowStart(buf, 0, buf.length)).toBe(buf.length)
  })
})

describe('deleteRun / sweep（任务级生命周期）', () => {
  it('deleteRun 删除整 run 目录（含已打开句柄），同 run 再 append 重建', async () => {
    await store.append(runId, 0, 'part-1')
    await store.append(runId, 1, 'step-two')
    expect(await fsPromises.readdir(path.join(rootDir, runId))).toHaveLength(2)

    const res = await store.deleteRun(runId)
    expect(res.success).toBe(true)
    expect(fs.existsSync(path.join(rootDir, runId))).toBe(false)

    // 任务级清理后再 append = 新文件
    await store.append(runId, 2, 'after-clean')
    expect(fs.existsSync(path.join(rootDir, runId, '2.txt'))).toBe(true)
    // 幂等：重复删除成功
    expect((await store.deleteRun(runId)).success).toBe(true)
  })

  it('sweep 只清超龄 run 目录，保留新鲜目录供崩溃恢复续读', async () => {
    const staleRun = '00000000-0000-4000-8000-000000000001'
    const freshRun = '00000000-0000-4000-8000-000000000002'
    await store.append(staleRun, 0, 'old')
    await store.append(freshRun, 0, 'new')
    const oldTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    await fsPromises.utimes(path.join(rootDir, staleRun), oldTime, oldTime)

    const removed = await store.sweep(7 * 24 * 60 * 60 * 1000)
    expect(removed).toBe(1)
    expect(fs.existsSync(path.join(rootDir, staleRun))).toBe(false)
    expect(fs.existsSync(path.join(rootDir, freshRun))).toBe(true)
  })
})

describe('崩溃恢复（文件还在，下次可续读）', () => {
  it('模拟进程崩溃后新进程实例能读到中断步骤的完整输出', async () => {
    // 第一进程：任务流式中途"崩溃"（写了一些内容，未 deleteRun）
    await store.append(runId, 0, '第一章 开头……')
    await store.append(runId, 0, '（流式进行到一半）')
    await store.closeAll() // 进程退出（句柄释放，文件保留）

    // 第二进程（重启）：同目录新实例续读
    const restarted = new WorkflowOutputFileStore(rootDir)
    try {
      const tail = await restarted.readTail(runId, 0, { full: true })
      expect(tail.exists).toBe(true)
      expect(tail.content).toBe('第一章 开头……（流式进行到一半）')
    } finally {
      await restarted.closeAll()
    }
  })
})
