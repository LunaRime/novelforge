import { beforeEach, expect, it, vi } from 'vitest'
import type { ExportChannels } from '../../src/shared/ipc-channels'
import { registerExportController } from './export-controller'

type ChapterExport = ExportChannels['export:export-chapters']
const fixture = vi.hoisted(() => ({
  handlers: new Map<string, (_event: unknown, input: ChapterExport['args'][0]) => Promise<ChapterExport['return']>>(),
  writeFile: vi.fn(),
  addZipFile: vi.fn(),
  body: '<u>段落</u>后仍有文字、`<u>代码</u>` 原样。',
}))

vi.mock('electron', () => ({ dialog: {}, BrowserWindow: {} }))
vi.mock('node:fs/promises', () => ({ default: { mkdir: vi.fn(), writeFile: fixture.writeFile } }))
vi.mock('../database', () => ({ getProjectDb: () => ({
  prepare: (query: string) => ({ get: () => query.includes('blueprints')
    ? { title: '章节' } : { chapter_number: 1, body: fixture.body } }),
}) }))
vi.mock('./fs-controller', () => ({ grantDirectory: vi.fn(), assertPathAllowedForIpc: (path: string) => path }))
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))
vi.mock('../security/ipc-guard', () => ({ guardedHandle: (channel: string, callback: never) => fixture.handlers.set(channel, callback) }))
vi.mock('../utils/zip-writer', () => ({ ZipWriter: class {
  addFile = fixture.addZipFile
  writeToFile = vi.fn()
} }))

beforeEach(() => {
  vi.clearAllMocks()
  registerExportController()
})

it.each(['folder', 'zip'] as const)('章节导出 %s 根据文件格式保留或移除下划线', async format => {
  const handler = fixture.handlers.get('export:export-chapters')!
  const exportChapter = (fileFormat: 'md' | 'txt') => handler({}, {
    chapterNumbers: [1], format, fileFormat, outputPath: 'output', projectName: '小说',
  })
  const output = format === 'folder' ? fixture.writeFile : fixture.addZipFile

  await expect(exportChapter('md')).resolves.toMatchObject({ success: true })
  expect(output.mock.lastCall?.[1]).toBe(`# 第1章 章节\n\n${fixture.body}`)
  await expect(exportChapter('txt')).resolves.toMatchObject({ success: true })
  expect(output.mock.lastCall?.[1]).toBe('第1章 章节\n\n段落后仍有文字、<u>代码</u> 原样。')
})
