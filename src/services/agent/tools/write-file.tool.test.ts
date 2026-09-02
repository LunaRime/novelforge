// @vitest-environment jsdom
/**
 * write_file 工具测试（I-1 修复新增——此前无独立测试文件）：
 * 数据目录保护下沉 safe-path（isProtectedRelativePath 规范化首段判定）后的回归矩阵：
 * 直形/./混淆/..混淆/.git 拒绝 + 正常路径不误报 + 读缓存失效语义（read-file.tool.test P0-2 已覆盖，此处聚焦路径）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'
import { t } from '../../../shared/locale'
import { writeFileTool } from './write-file.tool'

vi.mock('../../ipc-client', () => ({
  ipc: { invoke: vi.fn() },
}))

const mockInvoke = vi.mocked(ipc.invoke)

/** 项目根目录 fixture（与 read-file.tool.test.ts 一致） */
const projectPath = '/tmp/test-project'

/** 捕获写盘载荷：fs:write-file(fullPath, content) */
let writeCalls: Array<{ fullPath: string; content: string }>

beforeEach(() => {
  mockInvoke.mockClear()
  writeCalls = []
  useProjectStore.setState({
    currentProject: {
      id: 'test-project',
      name: '测试项目',
      path: projectPath,
      novelConfig: {
        genre: '玄幻',
        subGenre: '东方玄幻',
        targetAudience: '男频',
        totalChapters: 100,
        wordsPerChapter: 2000,
        plotStructure: 'three_act',
        narrativePOV: 'third_limited',
        coreOutline: '',
        worldSetting: '',
        goldenFinger: '',
        protagonistProfile: '',
        globalGuidance: '',
      },
      characterStates: '',
      createdAt: 0,
      updatedAt: 0,
    },
  })
  mockInvoke.mockImplementation(async (ch: string, ...args: unknown[]) => {
    if (ch === 'fs:write-file') {
      writeCalls.push({ fullPath: String(args[0]), content: String(args[1]) })
      return { success: true }
    }
    return { success: false, error: `unexpected channel: ${ch}` }
  })
})

describe('write_file 工具契约', () => {
  it('注册形态：行动工具（需确认、非只读、参数必填）', () => {
    expect(writeFileTool.name).toBe('write_file')
    expect(writeFileTool.requiresConfirmation).toBe(true)
    expect(writeFileTool.isReadOnly).toBe(false)
    expect(writeFileTool.inputSchema.required).toEqual(['file_path', 'content'])
  })
})

describe('write_file 成功路径（行为兼容：正常路径零变化）', () => {
  it('正常子目录文件写入：fullPath 为项目内拼接、内容原样、产物 file_modified', async () => {
    const r = await writeFileTool.execute({ file_path: '稿子/第一章.md', content: '正文内容' })
    expect(r.success).toBe(true)
    expect(writeCalls).toEqual([{ fullPath: `${projectPath}/稿子/第一章.md`, content: '正文内容' }])
    expect(r.content).toBe(t('tool.fileWritten').replace('{path}', '稿子/第一章.md').replace('{length}', '4'))
    expect(r.artifacts).toEqual([{ type: 'file_modified', path: `${projectPath}/稿子/第一章.md`, name: '稿子/第一章.md' }])
  })

  it('多级子目录不误报（保护判定只认首段数据目录）', async () => {
    const r = await writeFileTool.execute({ file_path: '笔记/设定/世界观.md', content: 'x' })
    expect(r.success).toBe(true)
    expect(writeCalls).toHaveLength(1)
    expect(writeCalls[0].fullPath).toBe(`${projectPath}/笔记/设定/世界观.md`)
  })

  it('路径越界（../）拒绝（行为兼容，validatePath 先行）', async () => {
    const r = await writeFileTool.execute({ file_path: '../evil.md', content: 'x' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('越界')
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})

describe('write_file 数据目录保护（I-1 修复回归矩阵）', () => {
  const cases: Array<[string, string]> = [
    ['直形 .novelforge/vela.db', '.novelforge/vela.db'],
    ['直形 .git/config', '.git/config'],
    ['./ 前缀混淆', './.novelforge/vela.db'],
    ['.. 中段混淆（文本形态提示词覆盖目标）', 'x/../.novelforge/prompts/main.json'],
    ['反斜杠 + .. 混淆', 'x\\..\\.git\\config'],
    ['目录名本身', '.novelforge'],
    ['node_modules 子路径', 'node_modules/some-pkg/index.js'],
  ]
  for (const [label, filePath] of cases) {
    it(`${label} → 拒绝（writeProtectedPath），零 IPC`, async () => {
      const r = await writeFileTool.execute({ file_path: filePath, content: '{"prompt":"overwrite"}' })
      expect(r.success).toBe(false)
      expect(r.error).toBe(t('tool.writeProtectedPath'))
      expect(mockInvoke).not.toHaveBeenCalled()
    })
  }
})
