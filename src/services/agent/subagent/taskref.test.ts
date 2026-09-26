import { describe, it, expect } from 'vitest'
import { computeSubAgentTaskRef, resolveSubAgentTools, SUBAGENT_WRITE_TOOLS, subAgentReadOnlyTools } from './taskref'
import { registerBuiltinTools } from '../tools'

describe('computeSubAgentTaskRef（幂等指纹）', () => {
  it('同输入同值；会话 / 描述 / 工具集任一变化即不同', () => {
    const a = computeSubAgentTaskRef('c1', '查玉佩伏笔', ['read_drafts'])
    expect(computeSubAgentTaskRef('c1', '查玉佩伏笔', ['read_drafts'])).toBe(a)
    expect(computeSubAgentTaskRef('c2', '查玉佩伏笔', ['read_drafts'])).not.toBe(a)
    expect(computeSubAgentTaskRef('c1', '查玉佩伏笔（重跑）', ['read_drafts'])).not.toBe(a)
    expect(computeSubAgentTaskRef('c1', '查玉佩伏笔', ['read_drafts', 'read_memory'])).not.toBe(a)
  })

  it('工具顺序无关（集合语义）', () => {
    expect(computeSubAgentTaskRef('c1', 'x', ['b', 'a'])).toBe(computeSubAgentTaskRef('c1', 'x', ['a', 'b']))
  })

  it('描述里的分隔符不会造成歧义碰撞（拼接用 \\u0000 分隔）', () => {
    expect(computeSubAgentTaskRef('c1', 'a\u0000b', ['x'])).not.toBe(computeSubAgentTaskRef('c1', 'a', ['b']))
  })
})

describe('resolveSubAgentTools（白名单构造）', () => {
  registerBuiltinTools()

  it('只读段 = 内置只读工具（排除 task / skill / 写工具）', () => {
    const list = subAgentReadOnlyTools()
    expect(list).toContain('read_drafts')
    expect(list).not.toContain('task')
    expect(list).not.toContain('skill')
    for (const w of SUBAGENT_WRITE_TOOLS) expect(list).not.toContain(w)
  })

  it('tools 参数取交集；未知名字忽略且**不破坏其余白名单**（Review Focus 1）', () => {
    const list = resolveSubAgentTools(['read_drafts', '不存在的工具', 'write_file'])
    expect(list).toContain('read_drafts')
    expect(list).toContain('write_file')            // 写工具恒在（执行时过父方审批，见 T6）
    expect(list).not.toContain('不存在的工具')
    expect(list.length).toBeGreaterThan(1)          // 一个坏名字不能让白名单塌成空
  })

  it('缺省 = 全部内置只读 + 写工具', () => {
    const list = resolveSubAgentTools(undefined)
    expect(list).toContain('read_drafts')
    expect(list).toContain('write_file')
  })

  it('写工具恒在（即使 tools 只请求只读子集）', () => {
    expect(resolveSubAgentTools(['read_drafts'])).toContain('write_file')
  })

  it('白名单里绝不含 task（禁止递归派发）', () => {
    expect(resolveSubAgentTools(['task', 'read_drafts'])).not.toContain('task')
  })
})
