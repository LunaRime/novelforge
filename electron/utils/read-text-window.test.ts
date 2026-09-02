// C1：行/字符区间流式读取——窗口外仅计数（Mock 文件系统层，无真实磁盘 IO）
import { describe, it, expect } from 'vitest'
import { Readable } from 'node:stream'
import { scanTextWindow, ReadTextWindowDeps } from './read-text-window'

/** 用内存 chunk 数组 + 可选假 size 构造 Mock 文件系统层 */
function mockDeps(chunks: string[], sizeBytes?: number): { deps: ReadTextWindowDeps; emitted: string[] } {
  const emitted: string[] = []
  return {
    emitted,
    deps: {
      fileSize: async () => sizeBytes ?? Buffer.byteLength(chunks.join('')),
      createReadStream: () => {
        const src = [...chunks]
        const rs = new Readable({
          read() {
            if (src.length === 0) {
              this.push(null)
              return
            }
            const next = src.shift() as string
            emitted.push(next)
            this.push(next)
          },
        })
        return rs
      },
    },
  }
}

/** 无限内容工厂（模拟 100GB 文件）：每读一次产出一块 64KB 'x' */
function hugeFileDeps(hugeSizeBytes: number): { deps: ReadTextWindowDeps; producedChunks: () => number } {
  const emitted: string[] = []
  return {
    deps: {
      fileSize: async () => hugeSizeBytes,
      createReadStream: () => {
        const rs = new Readable({
          read() {
            const chunk = 'x'.repeat(64 * 1024)
            emitted.push(chunk)
            this.push(chunk) // 永不 push(null)：调用方早停负责截断
          },
        })
        return rs
      },
    },
    producedChunks: () => emitted.length,
  }
}

const content16 = '0123456789ABCDEF'

describe('scanTextWindow：窗口切片与 EOF 语义', () => {
  it('offset=0 limit=440：返回头部窗口（≤ limit），扫到文件尾 → totalChars 精确', async () => {
    const { deps } = mockDeps(['这', '是', '一', '个', '中', '文', '测', '试', '文', '件'])
    const r = await scanTextWindow('/mock/a.md', 0, 440, deps)
    expect(r.content).toBe('这是一个中文测试文件')
    expect(r.eof).toBe(true)
    expect(r.totalChars).toBe(10)
    expect(r.scannedChars).toBe(10)
  })

  it('中段窗口：跨 chunk 精确切出 [offset, offset+limit)', async () => {
    // 16 字符按 6/6/4 切块；取 [6,12)
    const { deps } = mockDeps(['012345', '6789AB', 'CDEF'])
    const r = await scanTextWindow('/mock/a.txt', 6, 6, deps)
    expect(r.content).toBe('6789AB')
    expect(r.eof).toBe(false) // 窗口止于 12 < 16 → 文件更长，未扫到尾
    expect(r.totalChars).toBeUndefined()
  })

  it('窗口覆盖到文件尾：eof=true 且 totalChars=文件总长', async () => {
    const { deps } = mockDeps(['0123456789ABCDEF'])
    const r = await scanTextWindow('/mock/a.txt', 6, 100, deps)
    expect(r.content).toBe('6789ABCDEF')
    expect(r.eof).toBe(true)
    expect(r.totalChars).toBe(16)
  })

  it('窗口恰在文件尾结束（offset+limit == total）：eof=true（字节对账判定）', async () => {
    const { deps } = mockDeps(['0123456789ABCDEF'])
    const r = await scanTextWindow('/mock/a.txt', 10, 6, deps)
    expect(r.content).toBe('ABCDEF')
    expect(r.eof).toBe(true)
    expect(r.totalChars).toBe(16)
  })

  it('offset 越界：空内容 + eof=true + totalChars=文件总长（调用方判 beyond）', async () => {
    const { deps } = mockDeps([content16])
    const r = await scanTextWindow('/mock/a.txt', 1000, 440, deps)
    expect(r.content).toBe('')
    expect(r.eof).toBe(true)
    expect(r.totalChars).toBe(16)
  })

  it('空文件：空内容 + eof + totalChars=0', async () => {
    const { deps } = mockDeps([])
    const r = await scanTextWindow('/mock/empty.txt', 0, 440, deps)
    expect(r.content).toBe('')
    expect(r.eof).toBe(true)
    expect(r.totalChars).toBe(0)
  })
})

describe('scanTextWindow：超大文件不爆 RSS（窗口外仅计数）', () => {
  it('100GB 模拟：读首行窗口即停，产出 chunk 数有界、内容 ≤ limit', async () => {
    const { deps, producedChunks } = hugeFileDeps(100 * 1024 * 1024 * 1024)
    const r = await scanTextWindow('/mock/huge.txt', 0, 440, deps)
    expect(r.content).toBe('x'.repeat(440))
    expect(r.content.length).toBe(440)
    expect(r.eof).toBe(false)
    expect(r.totalChars).toBeUndefined()
    // 证明未全量扫描：产出块数 ≪ 100GB/64KB(=160 万块)；实际只读完 1 个 64KB 块即停
    expect(producedChunks()).toBeLessThan(10)
    // scannedChars 含已消费 chunk 的整块长度（64KB），但远小于文件规模 → 证明早停
    expect(r.scannedChars).toBeLessThan(100_000)
  })

  it('100GB 模拟 + offset=1e6：窗口前字符仅计数不持有，继续早停', async () => {
    const { deps, producedChunks } = hugeFileDeps(100 * 1024 * 1024 * 1024)
    const r = await scanTextWindow('/mock/huge.txt', 1_000_000, 440, deps)
    expect(r.content).toBe('x'.repeat(440))
    expect(r.eof).toBe(false)
    expect(producedChunks()).toBeLessThan(20) // 64KB×16=1M 字符附近早停
  })

  it('字符串块切分不越界（CJK 多字节安全由 Node string 流保证，此处验证 code unit 边界）', async () => {
    const { deps } = mockDeps(['中文测试', '混合English', '结尾'])
    const r = await scanTextWindow('/mock/cjk.txt', 4, 4, deps)
    // '中文测试'=4 code units；offset 4 起 → '混合En'（limit 4，窗口止于 8 < 总长 → 未扫到尾）
    expect(r.content).toBe('混合En')
    expect(r.eof).toBe(false)
  })

  it('UTF-8 码点跨 Buffer 块被切开：StringDecoder 重组，不产生乱码', async () => {
    // '中文测试' 的 UTF-8 为 12 字节；把「测」的 3 字节从中间切开（Buffer 块 4+2 字节）
    const full = Buffer.from('中文测试', 'utf8')
    const bufs = [Buffer.from(full.subarray(0, 7)), Buffer.from(full.subarray(7))] // 第 7 字节落在「测」的 3 字节内
    const emitted: Buffer[] = []
    const deps: ReadTextWindowDeps = {
      fileSize: async () => full.length,
      createReadStream: () => {
        const src = [...bufs]
        return new Readable({
          read() {
            if (src.length === 0) {
              this.push(null)
              return
            }
            const next = src.shift() as Buffer
            emitted.push(next)
            this.push(next)
          },
        })
      },
    }
    const r = await scanTextWindow('/mock/split.txt', 0, 440, deps)
    expect(r.content).toBe('中文测试')
    expect(r.eof).toBe(true)
    expect(r.totalChars).toBe(4)
    expect(emitted.length).toBe(2)
  })
})
