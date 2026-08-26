// @vitest-environment jsdom
/**
 * shared-memory — 跨会话可复用事实（shared.md）编解码/合并/读写测试（CCR P3 Task 1）
 *
 * 纯函数外另 mock IPC 覆盖 upsertSharedFacts 数据流：
 * memory:read shared.md（不存在返回 null）→ merge → memory:write。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  SHARED_MEMORY_FILE,
  parseSharedFacts,
  mergeSharedFacts,
  buildSharedFile,
  parseSharedFile,
  upsertSharedFacts,
} from './shared-memory'

// mock IPC（memory:read/write，chapter-memory.test.ts 先例：window.velaAPI）
const memoryFiles = new Map<string, string>()
const invoke = vi.fn(async (ch: string, ...args: unknown[]) => {
  switch (ch) {
    case 'memory:read':
      return memoryFiles.get(String(args[0])) ?? null
    case 'memory:write': {
      memoryFiles.set(String(args[0]), String(args[1]))
      return { success: true }
    }
    default:
      return null
  }
})

beforeEach(() => {
  memoryFiles.clear()
  invoke.mockClear()
  Object.defineProperty(window, 'velaAPI', { value: { invoke }, configurable: true })
})

describe('parseSharedFacts', () => {
  it('从 [可复用事实] 标记后提取逐行事实', () => {
    const facts = parseSharedFacts('摘要内容\n\n[可复用事实]\n- 用户偏好爽文节奏\n- 主角名苏晚晴\n')
    expect(facts).toEqual(['用户偏好爽文节奏', '主角名苏晚晴'])
  })

  it('无标记 → 空数组', () => {
    expect(parseSharedFacts('纯摘要')).toEqual([])
  })

  it('锚点后的非事实行被忽略（兼容模型附加说明）', () => {
    const facts = parseSharedFacts('[可复用事实]\n以下是基于本次对话的事实：\n- 事实A\n- 事实B')
    expect(facts).toEqual(['事实A', '事实B'])
  })
})

describe('mergeSharedFacts', () => {
  it('按文本去重 + 上限 50 丢最旧', () => {
    const merged = mergeSharedFacts(['旧事实'], ['旧事实', '新事实'])
    expect(merged).toEqual(['旧事实', '新事实'])
    const over = mergeSharedFacts(Array.from({ length: 50 }, (_, i) => `事实${i}`), ['溢出'])
    expect(over).toHaveLength(50)
    expect(over[0]).toBe('事实1') // 最旧（事实0）被丢
    expect(over[49]).toBe('溢出')
  })

  it('空白条目被剔除', () => {
    expect(mergeSharedFacts([], ['  ', '事实A'])).toEqual(['事实A'])
  })
})

describe('buildSharedFile / parseSharedFile', () => {
  it('round-trip', () => {
    const raw = buildSharedFile(['事实A'])
    expect(raw).toContain('type: shared')
    expect(parseSharedFile(raw)).toEqual(['事实A'])
    expect(parseSharedFile('损坏')).toEqual([])
  })

  it('解析多事实与损坏文件', () => {
    const raw = buildSharedFile(['事实A', '事实B'])
    expect(parseSharedFile(raw)).toEqual(['事实A', '事实B'])
    expect(parseSharedFile('')).toEqual([])
    expect(parseSharedFile('# 只有标题')).toEqual([])
  })
})

describe('upsertSharedFacts', () => {
  it('文件不存在 → 新建 shared.md', async () => {
    expect(await upsertSharedFacts(['事实A', '事实B'])).toBe(true)
    expect(memoryFiles.get(SHARED_MEMORY_FILE)).toContain('- 事实A')
    expect(memoryFiles.get(SHARED_MEMORY_FILE)).toContain('- 事实B')
  })

  it('文件已存在 → 读合并写回（去重）', async () => {
    memoryFiles.set(SHARED_MEMORY_FILE, buildSharedFile(['事实A']))
    expect(await upsertSharedFacts(['事实A', '事实B'])).toBe(true)
    expect(memoryFiles.get(SHARED_MEMORY_FILE)).toContain('- 事实A')
    expect(memoryFiles.get(SHARED_MEMORY_FILE)).toContain('- 事实B')
    // 单条事实只出现一次（去重生效）
    expect(memoryFiles.get(SHARED_MEMORY_FILE)!.split('- 事实A').length - 1).toBe(1)
  })

  it('无可写事实 → 不写入且返回 true（幂等）', async () => {
    expect(await upsertSharedFacts([])).toBe(true)
    expect(invoke).not.toHaveBeenCalledWith('memory:write', expect.anything(), expect.anything())
  })
})
