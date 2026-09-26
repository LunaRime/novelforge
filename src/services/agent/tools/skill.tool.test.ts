/**
 * skill 元工具测试（B 档第一轮：模型自主懒加载）
 *
 * 关键边界：`userInvocable` 只约束 `/命令`，**不约束模型** —— 目录必须包含这类技能。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { skillTool } from './skill.tool'
import { skillRegistry, type LoadedSkill } from '../skill-registry'

function mk(name: string, meta: Partial<LoadedSkill['metadata']> = {}, content = `正文-${name}`): LoadedSkill {
  return {
    metadata: { name, displayName: `显示名-${name}`, description: `描述-${name}`, userInvocable: true, ...meta },
    content,
    source: 'builtin',
    baseDir: '',
    filePath: `builtin://${name}`,
  }
}

beforeEach(() => {
  skillRegistry.register(mk('b-skill-a'))
  skillRegistry.register(mk('b-skill-hidden', { userInvocable: false }))
  skillRegistry.register(mk('b-skill-args', {}, '开头 ${args} 结尾'))
})

describe('skill 元工具', () => {
  it('无参 → 返回技能目录（含 displayName 与 name）', async () => {
    const res = await skillTool.execute({})
    expect(res.success).toBe(true)
    expect(res.content).toContain('显示名-b-skill-a')
    expect(res.content).toContain('b-skill-a')
    expect(res.content).toContain('描述-b-skill-a')
  })

  it('目录含 userInvocable:false 的技能（该字段只约束 /命令）', async () => {
    const res = await skillTool.execute({})
    expect(res.content).toContain('b-skill-hidden')
  })

  it('{ name } → 返回该技能全文', async () => {
    const res = await skillTool.execute({ name: 'b-skill-a' })
    expect(res.success).toBe(true)
    expect(res.content).toContain('正文-b-skill-a')
  })

  it('{ name, args } → ${args} 被替换（与 /命令 同语义）', async () => {
    const res = await skillTool.execute({ name: 'b-skill-args', args: '第三章' })
    expect(res.content).toContain('第三章')
    expect(res.content).not.toContain('${args}')
  })

  it('未知技能 → 失败且错误信息含该名字 + 目录提示（模型可自我纠正）', async () => {
    const res = await skillTool.execute({ name: 'not-exist-skill' })
    expect(res.success).toBe(false)
    expect(String(res.error)).toContain('not-exist-skill')
    expect(String(res.error)).toContain('b-skill-a')   // 附目录，便于下一轮纠正
  })

  it('allowedTools 未声明 → 无工具约束提示', async () => {
    skillRegistry.register(mk('b-skill-tools-undeclared'))
    const res = await skillTool.execute({ name: 'b-skill-tools-undeclared' })
    expect(res.content).not.toContain('不应调用任何工具')
  })

  it('allowedTools: [] → 提示"不应调用任何工具"（显式语义不丢失）', async () => {
    skillRegistry.register(mk('b-skill-tools-empty', { allowedTools: [] }))
    const res = await skillTool.execute({ name: 'b-skill-tools-empty' })
    expect(res.content).toContain('不应调用任何工具')
  })

  it('allowedTools: ["read_file"] → 提示白名单', async () => {
    skillRegistry.register(mk('b-skill-tools-list', { allowedTools: ['read_file'] }))
    const res = await skillTool.execute({ name: 'b-skill-tools-list' })
    expect(res.content).toContain('read_file')
  })

  it('只读且不需确认（纯读操作）', () => {
    expect(skillTool.requiresConfirmation).toBe(false)
    expect(skillTool.isReadOnly).toBe(true)
    expect(skillTool.source).toBe('builtin')
  })
})
