import { beforeEach, expect, it, vi } from 'vitest'
import { exportNovel } from './export-service'

const fixture = vi.hoisted(() => ({
  invoke: vi.fn(),
  body: '<u>下划线</u>的正文和 `<u>代码</u>` 字样。',
}))

vi.mock('./ipc-client', () => ({ ipc: { invoke: fixture.invoke } }))
vi.mock('./store-facade', () => ({
  projectStore: { currentProject: { name: '小说', novelConfig: { genre: '', targetAudience: '' } } },
  workflowStore: { addLog: vi.fn() },
}))

beforeEach(() => {
  fixture.invoke.mockReset()
  fixture.invoke.mockImplementation((channel: string) => {
    switch (channel) {
      case 'db:blueprint-get-all': return [{ chapterNumber: 1 }]
      case 'db:draft-get-finalized': return { id: 1 }
      case 'db:draft-get-full': return { content: fixture.body }
      default: return { success: true }
    }
  })
})

it.each(['merged-md', 'split-md', 'txt'] as const)('全书导出 %s 使用对应的下划线表示', async format => {
  await expect(exportNovel({ format, outputDir: 'output' })).resolves.toMatchObject({ success: true })
  const file = fixture.invoke.mock.calls.find(([name]) => name === 'fs:write-file')
  expect(file?.[2]).toContain(format === 'txt' ? '下划线的正文和 <u>代码</u> 字样。' : fixture.body)
})
