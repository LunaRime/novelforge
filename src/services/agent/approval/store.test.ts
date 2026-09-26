// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadApprovalRules, appendApprovalRule } from './store'
import { ipc } from '../../ipc-client'
import type { ApprovalRule } from './types'

vi.mock('../../ipc-client', () => ({ ipc: { invoke: vi.fn() } }))
const mockInvoke = vi.mocked(ipc.invoke)

const rule: ApprovalRule = {
  id: 'approval-deadbeef',
  toolName: 'start_workflow',
  matcher: 'args-identity',
  matcherVersion: 1,
  matchKey: '["start_workflow","generate_draft"]',
  displayPattern: 'start_workflow → generate_draft',
  approvedArgsHash: 'cafebabe',
  createdAt: '2026-09-26T00:00:00.000Z',
}

beforeEach(() => mockInvoke.mockReset())

describe('workspace 批准记忆（.novelforge/approvals.json）', () => {
  it('读取：文件不存在 → 空数组（不抛错）', async () => {
    mockInvoke.mockResolvedValueOnce({ success: false })
    expect(await loadApprovalRules('E:/novels/demo')).toEqual([])
  })

  it('读取：内容损坏 → 空数组（fail-closed）', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, content: '{not json' })
    expect(await loadApprovalRules('E:/novels/demo')).toEqual([])
  })

  it('读取：形状不对的条目不进入结果', async () => {
    mockInvoke.mockResolvedValueOnce({
      success: true,
      content: JSON.stringify({ version: 1, rules: [rule, { id: 'x' }, null] }),
    })
    const rules = await loadApprovalRules('E:/novels/demo')
    expect(rules).toHaveLength(1)
    expect(rules[0].id).toBe('approval-deadbeef')
  })

  it('读取：路径拼接在项目内 .novelforge/approvals.json', async () => {
    mockInvoke.mockResolvedValueOnce({ success: false })
    await loadApprovalRules('E:/novels/demo/')
    expect(mockInvoke.mock.calls[0][0]).toBe('fs:read-file')
    expect(String(mockInvoke.mock.calls[0][1])).toBe('E:/novels/demo/.novelforge/approvals.json')
  })

  it('追加：去重后写回完整结构（fs:write-file 双位置参数）', async () => {
    mockInvoke
      .mockResolvedValueOnce({ success: true, content: JSON.stringify({ version: 1, rules: [rule] }) })  // 读
      .mockResolvedValueOnce({ success: true })                                                          // 写
    await appendApprovalRule('E:/novels/demo', rule)
    const writeCall = mockInvoke.mock.calls[1]
    expect(writeCall[0]).toBe('fs:write-file')
    expect(String(writeCall[1])).toContain('.novelforge/approvals.json')
    const written = JSON.parse(String(writeCall[2]))
    expect(written.version).toBe(1)
    expect(written.rules).toHaveLength(1)   // 同 id 去重，不重复追加
  })

  it('追加：新规则进入列表尾部', async () => {
    const second: ApprovalRule = { ...rule, id: 'approval-feedface', matchKey: '["update_config","x"]' }
    mockInvoke
      .mockResolvedValueOnce({ success: true, content: JSON.stringify({ version: 1, rules: [rule] }) })
      .mockResolvedValueOnce({ success: true })
    await appendApprovalRule('E:/novels/demo', second)
    const written = JSON.parse(String(mockInvoke.mock.calls[1][2]))
    expect(written.rules).toHaveLength(2)
    expect(written.rules[1].id).toBe('approval-feedface')
  })
})
