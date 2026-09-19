// @vitest-environment jsdom
/**
 * vela-protocol — vela://memory/ 路由（AI 记忆文件在编辑器标签页打开）
 *
 * 背景（真机反馈 2026-09-19）：「每个小说章节 AI 记忆为什么就在侧边栏直接打开，为什么不在
 * 编辑栏打开？侧边栏那么小的位置」——记忆文件此前只能在侧栏行内展开（max-h-40 / 0.65rem
 * 的 pre），编辑侧没有任何入口。本用例锁定新增的 vela://memory/ 读分支：
 * 编辑器标签页以 vela://memory/<file> 作 filePath / tab id，内容经统一协议入口读取。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { VELA, readVelaContent, isVelaProtocol } from './vela-protocol'

const CONTENT = '---\nrange: 1-3\n---\n\n# 章节记忆 1-3\n\n## 第 1 章 · 开端\n- 关键事件：主角醒来\n'

describe('vela://memory/ 伪协议路由', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'velaAPI', {
      value: {
        invoke: vi.fn(async (ch: string) => (ch === 'memory:read' ? CONTENT : null)),
      },
      configurable: true,
    })
  })

  it('VELA.MEMORY 前缀常量存在（编辑器读写据此分流）', () => {
    expect(VELA.MEMORY).toBe('vela://memory/')
  })

  it('readVelaContent：vela://memory/<file> → memory:read(file)，文件名原样透传', async () => {
    const content = await readVelaContent('vela://memory/chapters-1-3.md')
    expect(content).toBe(CONTENT)
    expect(window.velaAPI.invoke).toHaveBeenCalledWith('memory:read', 'chapters-1-3.md')

    // 文件名不做 basename/编码等改写（路径安全由主进程 safeFile 兜底）：
    // 含空格与多点的名字必须逐字传出，否则读到的是另一个文件
    await readVelaContent('vela://memory/my notes.v2.md')
    expect(window.velaAPI.invoke).toHaveBeenCalledWith('memory:read', 'my notes.v2.md')
  })

  it('readVelaContent：读盘失败（主进程返回 null）降级空串，不抛错', async () => {
    Object.defineProperty(window, 'velaAPI', {
      value: { invoke: vi.fn(async () => null) },
      configurable: true,
    })
    await expect(readVelaContent('vela://memory/book-state.md')).resolves.toBe('')
  })

  it('isVelaProtocol 将 vela://memory/ 认作伪协议路径', () => {
    expect(isVelaProtocol('vela://memory/book-state.md')).toBe(true)
  })
})
