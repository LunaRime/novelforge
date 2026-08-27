// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'
import { t } from '../../../shared/locale'
import { clearReadState, READ_MAX_CHARS, readFileTool } from './read-file.tool'
import { writeFileTool } from './write-file.tool'

vi.mock('../../ipc-client', () => ({
  ipc: { invoke: vi.fn() },
}))

const mockInvoke = vi.mocked(ipc.invoke)

/** 项目根目录 fixture（read_file 相对路径校验基准） */
const projectPath = '/tmp/test-project'

beforeEach(() => {
  mockInvoke.mockClear()
  // 读去重状态是模块级 Map，测试间全清
  clearReadState()
  // 当前项目 fixture（read_file 顶层读取 useProjectStore.getState().currentProject）
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
})

describe('read_file 读去重', () => {
  it('同一路径重复读：第二次返回 file_unchanged 桩（不重发全文）', async () => {
    mockInvoke.mockResolvedValue({ success: true, content: '长文本内容'.repeat(100) })
    const r1 = await readFileTool.execute({ file_path: 'chap1.md' })
    expect(r1.success).toBe(true)
    expect(r1.content).toContain('长文本内容')
    const r2 = await readFileTool.execute({ file_path: 'chap1.md' })
    expect(r2.success).toBe(true)
    expect(r2.content).toContain('file_unchanged')  // 桩标记
    expect(r2.content).not.toContain('长文本内容')   // 不重发全文
    // 断言 ipc.invoke 仅被调用 1 次（fs:read-file）——第二次命中桩不重发 IPC
    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(mockInvoke).toHaveBeenCalledWith('fs:read-file', `${projectPath}/chap1.md`)
  })

  it('不同路径不受影响', async () => {
    mockInvoke.mockResolvedValue({ success: true, content: '全文内容' })
    const ra = await readFileTool.execute({ file_path: 'a.md' })
    const rb = await readFileTool.execute({ file_path: 'b.md' })
    expect(ra.content).toContain('全文内容')
    expect(rb.content).toContain('全文内容')
    // 两条路径各自独立全量读（不命中桩）
    expect(mockInvoke).toHaveBeenCalledTimes(2)
  })

  it('clearReadState 后重复读恢复全文', async () => {
    mockInvoke.mockResolvedValue({ success: true, content: '全文内容' })
    await readFileTool.execute({ file_path: 'chap1.md' })
    const stub = await readFileTool.execute({ file_path: 'chap1.md' })
    expect(stub.content).toContain('file_unchanged')
    clearReadState()
    const again = await readFileTool.execute({ file_path: 'chap1.md' })
    expect(again.content).toContain('全文内容')
  })

  it('外部文件（绝对路径）同样去重', async () => {
    mockInvoke.mockResolvedValue({ success: true, content: '外部全文' })
    const r1 = await readFileTool.execute({ file_path: 'C:/Users/test/notes.md' })
    expect(r1.success).toBe(true)
    const r2 = await readFileTool.execute({ file_path: 'C:/Users/test/notes.md' })
    expect(r2.content).toContain('file_unchanged')
    expect(r2.content).not.toContain('外部全文')
    expect(mockInvoke).toHaveBeenCalledWith('fs:read-external-file', 'C:/Users/test/notes.md')
  })

  it('带 offset 的分页读不短路（P0-1：桩不含文件内容，分页读必须真实读盘）', async () => {
    // ⚠️ H3 语义：offset 超出文件长度会走「已超出文件长度」提示分支——
    //    故 fixture 长度必须 > 10，分页读才能真实返回内容（断言依赖）
    mockInvoke.mockResolvedValue({ success: true, content: '全文内容'.repeat(10) })
    await readFileTool.execute({ file_path: 'chap1.md' })
    // offset 指定 → 绕过短路，走真实读文件（H3 将解析 offset/limit；此处直传 args）
    const page = await readFileTool.execute({ file_path: 'chap1.md', offset: 10 })
    expect(page.content).toContain('全文内容')
    expect(mockInvoke).toHaveBeenCalledTimes(2)
  })

  it('write_file 成功后失效缓存：写后重复读返回全文（P0-2）', async () => {
    mockInvoke.mockImplementation(async (ch: string, ...args: unknown[]) => {
      if (ch === 'fs:read-file') return { success: true, content: '原文内容' }
      if (ch === 'fs:write-file') {
        expect(args[0]).toBe(`${projectPath}/chap1.md`)
        return { success: true }
      }
      return { success: false, error: `unexpected channel: ${ch}` }
    })
    await readFileTool.execute({ file_path: 'chap1.md' })
    const stub = await readFileTool.execute({ file_path: 'chap1.md' })
    expect(stub.content).toContain('file_unchanged')
    const w = await writeFileTool.execute({ file_path: 'chap1.md', content: '新内容' })
    expect(w.success).toBe(true)
    // 写盘后重读 → 缓存已失效 → 恢复全文
    const after = await readFileTool.execute({ file_path: 'chap1.md' })
    expect(after.content).toContain('原文内容')
  })
})

describe('read_file token 约束与分页', () => {
  it('超大文件：注入前 READ_MAX_CHARS 截断 + 截断提示（含总长度与分页建议）', async () => {
    const longContent = '长'.repeat(50000)
    mockInvoke.mockResolvedValue({ success: true, content: longContent })
    const r = await readFileTool.execute({ file_path: 'chap1.md' })
    expect(r.success).toBe(true)
    // 截断提示作为前缀，含总长度 + 已有页的结束位置（offset+limit）+ 分页建议
    const notice = t('tool.readFileTruncated')
      .replace('{total}', String(longContent.length))
      .replace('{offset}', String(READ_MAX_CHARS)) + '\n\n'
    expect(r.content).toBe(notice + longContent.slice(0, READ_MAX_CHARS))
  })

  it('offset/limit 生效：offset=1000&limit=500 只返回该区间', async () => {
    // 3 段可区分内容：[0,1000)='0'、[1000,1500)='B'、[1500,3000)='E'
    const content = '0'.repeat(1000) + 'B'.repeat(500) + 'E'.repeat(1500)
    mockInvoke.mockResolvedValue({ success: true, content })
    const r = await readFileTool.execute({ file_path: 'chap1.md', offset: 1000, limit: 500 })
    expect(r.success).toBe(true)
    // 精确返回 [1000, 1500) 区间，区间外内容未混入
    expect(r.content).toContain('B'.repeat(500))
    expect(r.content).not.toContain('E')
    // 截断提示仍在前缀（告知剩余内容与分页建议）
    expect(r.content).toContain('截断')
  })

  it('offset 超出文件长度：返回空 + 提示', async () => {
    mockInvoke.mockResolvedValue({ success: true, content: '短内容'.repeat(10) })
    const r = await readFileTool.execute({ file_path: 'chap1.md', offset: 1000 })
    expect(r.success).toBe(true)
    expect(r.content).toBe(t('tool.readFileOffsetBeyond') + '\n\n')
  })

  it('正常小文件不受影响（无截断无提示）', async () => {
    const content = '正常内容'.repeat(100)
    mockInvoke.mockResolvedValue({ success: true, content })
    const r = await readFileTool.execute({ file_path: 'chap1.md' })
    expect(r.success).toBe(true)
    expect(r.content).toBe(content)
  })

  it('带 offset/limit 的读取不被读去重短路命中（P0-1 回归）', async () => {
    mockInvoke
      .mockResolvedValueOnce({ success: true, content: 'x'.repeat(3000) })
      .mockResolvedValueOnce({ success: true, content: 'y'.repeat(5000) })
    // 全量读（无 offset/limit）→ 写入 readState（3000 字符）
    const r1 = await readFileTool.execute({ file_path: 'chap1.md' })
    expect(r1.content).toContain('截断')
    // 分页读（offset/limit）→ 不命中 file_unchanged 桩，走真实读盘
    const r2 = await readFileTool.execute({ file_path: 'chap1.md', offset: 1000, limit: 500 })
    expect(r2.content).not.toContain('file_unchanged')
    expect(r2.content).toContain('y'.repeat(500))
    expect(mockInvoke).toHaveBeenCalledTimes(2)
    // 分页读不得覆盖 readState（Minor 1）：再次全量读仍命中 3000 字符的桩，
    // 而非被分页读（5000 字符）覆盖后的桩——否则 LLM 拿不到全文
    const r3 = await readFileTool.execute({ file_path: 'chap1.md' })
    expect(r3.content).toContain('file_unchanged')
    expect(r3.content).toContain('3000')
    expect(r3.content).not.toContain('5000')
  })
})
