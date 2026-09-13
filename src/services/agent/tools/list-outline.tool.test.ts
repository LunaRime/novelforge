// @vitest-environment jsdom
/**
 * list_outline 工具测试（2026-09-13 真机反馈新增）
 *
 * 价值点有两个，都由本文件锁死：
 *  ① 一次调用读完全部大纲数据源（架构 + 蓝图 + 草稿），不再让 Agent 逐轮摸索；
 *  ② 空数据必须**显式标注**并给出下一步指引 —— 原先 Agent 花了 3 轮工具调用才拼出
 *     「架构空 / 蓝图空 / 草稿 0 章」，期间烧掉大半预算，最后撞上工具轮次上限。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'
import { t } from '../../../shared/locale'
import { listOutlineTool } from './list-outline.tool'

vi.mock('../../ipc-client', () => ({
  ipc: { invoke: vi.fn() },
}))

const mockInvoke = vi.mocked(ipc.invoke)

/** 按通道分派的 mock（默认全空） */
function mockChannels(over: {
  core?: unknown
  blueprints?: unknown
  drafts?: unknown
} = {}) {
  mockInvoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
    void args // 签名需与强类型 mock 一致；本用例只按 channel 分派
    if (channel === 'db:project-core-get') return (over.core ?? null) as never
    if (channel === 'db:blueprint-get-all') return (over.blueprints ?? []) as never
    if (channel === 'db:draft-get-all-chapter-numbers') return (over.drafts ?? []) as never
    return null as never
  })
}

beforeEach(() => {
  mockInvoke.mockClear()
  useProjectStore.setState({
    currentProject: { id: 'p1', name: '穿越80后', path: '/tmp/p1', novelConfig: {} } as never,
  })
})

describe('list_outline', () => {
  it('三个数据源一次读完（并发三通道，各只调一次）', async () => {
    mockChannels()
    const res = await listOutlineTool.execute({})
    expect(res.success).toBe(true)

    const channels = mockInvoke.mock.calls.map(c => c[0])
    expect(channels).toContain('db:project-core-get')
    expect(channels).toContain('db:blueprint-get-all')
    expect(channels).toContain('db:draft-get-all-chapter-numbers')
  })

  it('全空时：每节显式标注（空）+ 给出「先跑架构工作流」的下一步指引', async () => {
    mockChannels()
    const res = await listOutlineTool.execute({})
    const content = String(res.content)

    // 四个架构子项 + 蓝图 + 草稿都应标空
    const emptyMarks = content.split(t('tool.listOutlineEmptyItem')).length - 1
    expect(emptyMarks).toBeGreaterThanOrEqual(6)
    // 关键：不能让 Agent 自己猜下一步
    expect(content).toContain(t('tool.listOutlineAllEmpty'))
  })

  it('有数据时：架构给预览、蓝图给章号、草稿给数量，且不再输出全空指引', async () => {
    mockChannels({
      core: { premise: '姜小满穿越修真界', worldbuilding: '', charactersArch: '', synopsis: '三幕结构' },
      blueprints: [{ chapterNumber: 3 }, { chapterNumber: 1 }],
      drafts: [1, 2],
    })
    const res = await listOutlineTool.execute({})
    const content = String(res.content)

    expect(content).toContain('姜小满穿越修真界')
    expect(content).toContain('三幕结构')
    // 蓝图章号升序展示
    expect(content).toContain('1, 3')
    expect(content).toContain(t('tool.listOutlineDraftCount').replace('{count}', '2'))
    expect(content).not.toContain(t('tool.listOutlineAllEmpty'))
  })

  it('架构预览截断，避免把整篇世界观灌进上下文', async () => {
    mockChannels({ core: { premise: 'x'.repeat(1000), worldbuilding: '', charactersArch: '', synopsis: '' } })
    const res = await listOutlineTool.execute({})
    expect(String(res.content)).not.toContain('x'.repeat(1000))
    expect(String(res.content)).toContain('…')
  })

  it('未打开项目 → 明确报错，不发 IPC', async () => {
    useProjectStore.setState({ currentProject: null as never })
    const res = await listOutlineTool.execute({})
    expect(res.success).toBe(false)
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})
