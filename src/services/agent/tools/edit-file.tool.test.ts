// @vitest-environment jsdom
/**
 * edit_file 工具集成测试（C2 / CC §三.3）——mock IPC（参照 read-file.tool.test.ts 的 mockInvoke 模式）：
 * read 走 fs:read-file 全文 → 纯函数替换 → write 走 fs:write-file 整文件写回；断言写盘载荷 = 期望新内容。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'
import { t } from '../../../shared/locale'
import { clearReadState, readFileTool } from './read-file.tool'
import { editFileTool } from './edit-file.tool'

vi.mock('../../ipc-client', () => ({
  ipc: { invoke: vi.fn() },
}))

const mockInvoke = vi.mocked(ipc.invoke)

/** 项目根目录 fixture（与 read-file.tool.test.ts 一致） */
const projectPath = '/tmp/test-project'

/** 模拟磁盘：read 返回 disk、write 更新 disk——贴近真实 fs 语义，支持多调用链测试 */
let disk: string

/** 故障注入：非空时对应通道返回该错误（单测失败透传路径） */
let failRead: string | null = null
let failWrite: string | null = null

beforeEach(() => {
  mockInvoke.mockClear()
  disk = ''
  failRead = null
  failWrite = null
  clearReadState()
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
    if (ch === 'fs:read-file') return failRead !== null ? { success: false, error: failRead } : { success: true, content: disk }
    if (ch === 'fs:write-file') {
      if (failWrite !== null) return { success: false, error: failWrite }
      disk = String(args[1])
      return { success: true }
    }
    return { success: false, error: `unexpected channel: ${ch}` }
  })
})

/** 工具契约常量断言辅助 */
const fileEditedMsg = (path: string, line: string, removed: string, added: string): string =>
  t('tool.fileEdited').replace('{path}', path).replace('{line}', line).replace('{removed}', removed).replace('{added}', added)

describe('edit_file 工具契约', () => {
  it('注册形态：name/描述/参数 schema/确认与只读标志（与 write_file 同为行动工具）', () => {
    expect(editFileTool.name).toBe('edit_file')
    expect(editFileTool.source).toBe('builtin')
    expect(editFileTool.requiresConfirmation).toBe(true)
    expect(editFileTool.isReadOnly).toBe(false)
    expect(editFileTool.description).toBe(t('tool.editFileDesc'))
    expect(editFileTool.inputSchema.required).toEqual(['file_path', 'old_string', 'new_string'])
    expect(Object.keys(editFileTool.inputSchema.properties).sort()).toEqual(['file_path', 'new_string', 'old_string'])
  })
})

describe('edit_file 成功路径', () => {
  it('精确替换：读全文 → 替换第一处 → 整文件写回（其余内容一字不动）', async () => {
    disk = '他是主角。\n第二天，他出发了。\n' // 仅一处命中 → 无多命中提示
    const r = await editFileTool.execute({ file_path: 'chap1.md', old_string: '主角', new_string: '配角' })
    expect(r.success).toBe(true)
    expect(disk).toBe('他是配角。\n第二天，他出发了。\n') // 命中区外原样
    expect(r.content).toBe(fileEditedMsg('chap1.md', '1', '2', '2'))
    expect(r.artifacts).toEqual([{ type: 'file_modified', path: `${projectPath}/chap1.md`, name: 'chap1.md' }])
    // IPC 顺序：一次 read + 一次 write（全量写回，无新通道）
    expect(mockInvoke.mock.calls.map(c => c[0])).toEqual(['fs:read-file', 'fs:write-file'])
    expect(mockInvoke).toHaveBeenLastCalledWith('fs:write-file', `${projectPath}/chap1.md`, disk)
  })

  it('引号归一化 + preserveQuoteStyle 端到端：文件弯引号、模型直引号 → 命中真实子串并回填弯引号写入', async () => {
    // fixture 只在引号上差异（标点逐字一致）；new_string 直引号按文件弯引号风格回填为 “/”
    disk = '他说：“你好。”'
    const r = await editFileTool.execute({ file_path: 'chap1.md', old_string: '他说："你好。"', new_string: '她说："晚安。"' })
    expect(r.success).toBe(true)
    expect(disk).toBe('她说：“晚安。”')
    // 匹配经引号归一化 → 命中层提示附加
    expect(r.content).toContain(t('tool.editQuoteMatchNote'))
  })

  it('多命中：只替换第一处 + 提示出现次数', async () => {
    disk = '重复重复'
    const r = await editFileTool.execute({ file_path: 'chap1.md', old_string: '重复', new_string: 'X' })
    expect(r.success).toBe(true)
    expect(disk).toBe('X重复')
    expect(r.content).toContain(t('tool.editMatchMultiple').replace('{count}', '2'))
  })

  it('删除独占一行片段 → 连带删除尾换行（不留空行）', async () => {
    disk = '第一行\n要删的行\n第三行\n'
    const r = await editFileTool.execute({ file_path: 'chap1.md', old_string: '要删的行', new_string: '' })
    expect(r.success).toBe(true)
    expect(disk).toBe('第一行\n第三行\n')
    expect(r.content).toBe(fileEditedMsg('chap1.md', '2', '5', '0')) // '要删的行'(4) + 连带尾换行(1) = 5 移除
  })

  it('行内片段删除：双侧空格保留', async () => {
    disk = 'alpha beta gamma'
    const r = await editFileTool.execute({ file_path: 'chap1.md', old_string: 'beta', new_string: '' })
    expect(r.success).toBe(true)
    expect(disk).toBe('alpha  gamma')
  })

  it('模型侧空格差异命中（old 多尾随空格）→ 成功 + whitespace 层提示', async () => {
    disk = 'alpha beta'
    const r = await editFileTool.execute({ file_path: 'chap1.md', old_string: 'alpha beta ', new_string: 'A B' })
    expect(r.success).toBe(true)
    expect(disk).toBe('A B')
    expect(r.content).toContain(t('tool.editWhitespaceMatchNote'))
  })
})

describe('edit_file 边界与失败路径', () => {
  it('无实质差异（old==new）→ 成功但不写盘', async () => {
    disk = 'abc'
    const r = await editFileTool.execute({ file_path: 'chap1.md', old_string: 'b', new_string: 'b' })
    expect(r.success).toBe(true)
    expect(r.content).toBe(t('tool.editNoChange').replace('{path}', 'chap1.md'))
    expect(mockInvoke.mock.calls.map(c => c[0])).toEqual(['fs:read-file']) // 只有读，无写
  })

  it('old_string 未命中 → 失败提示（含已尝试层级建议），不写盘', async () => {
    disk = '甲乙丙'
    const r = await editFileTool.execute({ file_path: 'chap1.md', old_string: '丁戊', new_string: 'x' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('未找到匹配')
    expect(r.content).toBe('')
    expect(mockInvoke.mock.calls.map(c => c[0])).toEqual(['fs:read-file'])
  })

  it('空文件/文件不存在：读失败透传主进程错误', async () => {
    failRead = 'ENOENT: no such file'
    const r = await editFileTool.execute({ file_path: 'chap1.md', old_string: 'x', new_string: 'y' })
    expect(r.success).toBe(false)
    expect(r.error).toBe('ENOENT: no such file')
  })

  it('写失败透传主进程错误', async () => {
    disk = 'abc'
    failWrite = 'disk full'
    const r = await editFileTool.execute({ file_path: 'chap1.md', old_string: 'b', new_string: 'x' })
    expect(r.success).toBe(false)
    expect(r.error).toBe('disk full')
  })

  it('参数校验：缺 file_path / old_string / new_string / 空 old_string 各自报错且零 IO', async () => {
    expect((await editFileTool.execute({ old_string: 'x', new_string: 'y' })).error).toBe(t('error.missingFilePath'))
    expect((await editFileTool.execute({ file_path: 'a.md', new_string: 'y' })).error).toBe(t('tool.editMissingOldString'))
    expect((await editFileTool.execute({ file_path: 'a.md', old_string: 'x' })).error).toBe(t('tool.editMissingNewString'))
    expect((await editFileTool.execute({ file_path: 'a.md', old_string: '', new_string: 'y' })).error).toBe(t('tool.editEmptyOldString'))
    expect((await editFileTool.execute({ file_path: 123 as unknown as string, old_string: 'x', new_string: 'y' })).error).toBe(t('error.missingFilePath'))
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('路径安全：数据目录前缀拒绝（.novelforge/.vela/.git/node_modules）', async () => {
    const r = await editFileTool.execute({ file_path: '.novelforge/vela.db', old_string: 'x', new_string: 'y' })
    expect(r.success).toBe(false)
    expect(r.error).toBe(t('tool.writeProtectedPath'))
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('路径安全：../ 越界拒绝', async () => {
    const r = await editFileTool.execute({ file_path: '../outside.md', old_string: 'x', new_string: 'y' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('越界')
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})

describe('edit_file 数据目录保护归一化（I-1 修复回归矩阵）', () => {
  const cases: Array<[string, string]> = [
    ['直形 .novelforge/vela.db', '.novelforge/vela.db'],
    ['直形 .git/config', '.git/config'],
    ['./ 前缀混淆', './.novelforge/vela.db'],
    ['.. 中段混淆（文本形态提示词覆盖目标）', 'x/../.novelforge/prompts/main.json'],
    ['反斜杠 + .. 混淆', 'x\\..\\.novelforge\\prompts\\main.json'],
    ['目录名本身', '.novelforge'],
  ]
  for (const [label, filePath] of cases) {
    it(`${label} → 拒绝（writeProtectedPath），零 IPC`, async () => {
      const r = await editFileTool.execute({ file_path: filePath, old_string: 'x', new_string: 'y' })
      expect(r.success).toBe(false)
      expect(r.error).toBe(t('tool.writeProtectedPath'))
      expect(mockInvoke).not.toHaveBeenCalled()
    })
  }

  it('正常子目录文件不受影响（不误报）：编辑成功且写回正确路径', async () => {
    disk = '正文内容'
    const r = await editFileTool.execute({ file_path: '稿子/第一章.md', old_string: '正文', new_string: '新文' })
    expect(r.success).toBe(true)
    expect(disk).toBe('新文内容')
    expect(mockInvoke).toHaveBeenLastCalledWith('fs:write-file', `${projectPath}/稿子/第一章.md`, disk)
  })
})

describe('edit_file 与读去重状态（P0-2 语义对齐）', () => {
  it('编辑成功后失效读缓存：LLM「编辑 → 重读验证」拿到新内容而非 file_unchanged 桩', async () => {
    disk = '原文内容'
    const r1 = await readFileTool.execute({ file_path: 'chap1.md' })
    expect(r1.content).toContain('原文内容')
    const stub = await readFileTool.execute({ file_path: 'chap1.md' })
    expect(stub.content).toContain('file_unchanged')

    const e = await editFileTool.execute({ file_path: 'chap1.md', old_string: '原文内容', new_string: '新内容' })
    expect(e.success).toBe(true)
    expect(disk).toBe('新内容')

    // 编辑（clearReadState）后重读 → 真实读盘返回新内容，不命中桩
    const after = await readFileTool.execute({ file_path: 'chap1.md' })
    expect(after.content).not.toContain('file_unchanged')
    expect(after.content).toContain('新内容')
  })
})

describe('区域感知引号回填（评审 Finding 2 修复）', () => {
  it('弯引号主文件内直引号 JSON 区替换：保持直引号不被转弯（防 JSON 损坏）', async () => {
    // 全文件弯双引号 6 > JSON 区直引号 4 → 旧行为按全文件多数决会把 new 转弯
    disk = '“弯一”和“弯二”都在。\n```json\n{"a": "b"}\n```\n“弯三”收尾。\n'
    const r = await editFileTool.execute({ file_path: 'note.md', old_string: '{"a": "b"}', new_string: '{"a": "c"}' })
    expect(r.success).toBe(true)
    // 区域真实文本是直引号 → new_string 直引号逐字保持（不转弯）
    expect(disk).toBe('“弯一”和“弯二”都在。\n```json\n{"a": "c"}\n```\n“弯三”收尾。\n')
    expect(disk).toContain('{"a": "c"}')
    expect(r.content).toBe(fileEditedMsg('note.md', '3', '10', '10')) // 精确层、单命中 → 无附加提示
  })

  it('old==new（含引号、区域少数直引号风格）→ editNoChange 不写盘（no-op 承诺 + mtime 不抖）', async () => {
    disk = '“弯一”和“弯二”都在。\n```json\n{"a": "b"}\n```\n“弯三”收尾。\n'
    const before = disk
    const r = await editFileTool.execute({ file_path: 'note.md', old_string: '{"a": "b"}', new_string: '{"a": "b"}' })
    expect(r.success).toBe(true)
    expect(r.content).toBe(t('tool.editNoChange').replace('{path}', 'note.md'))
    expect(disk).toBe(before) // 文件未变
    expect(mockInvoke.mock.calls.map(c => c[0])).toEqual(['fs:read-file']) // 只有读，无写
  })
})
