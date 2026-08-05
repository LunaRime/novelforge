// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderLog } from '../../render-logger'
import { BaseWorkflowCommand } from './base-command'

// mock render-logger（验证 LLM 提取日志流调用）
vi.mock('../../render-logger', () => ({
  renderLog: vi.fn(),
}))

class TestCommand extends BaseWorkflowCommand<string> {
  async execute(): Promise<string> { return '' }
  /** 暴露 protected 方法供测试 */
  parseJSONPub<T>(text: string): T { return this.parseJSON<T>(text) }
  parseJSONWithSelfCheckPub<T>(text: string, retry: (fb: string) => Promise<string>, max: number): Promise<T> {
    return this.parseJSONWithSelfCheck<T>(text, retry, max)
  }
}

const mockRenderLog = vi.mocked(renderLog)

describe('base-command LLM 提取日志流（Parse source）', () => {
  let cmd: TestCommand

  beforeEach(() => {
    mockRenderLog.mockClear()
    cmd = new TestCommand()
  })

  it('对象解析成功 → debug 日志（含字符数与类型）', () => {
    const parsed = cmd.parseJSONPub<{ a: number }>('{"a": 1}')
    expect(parsed.a).toBe(1)
    expect(mockRenderLog).toHaveBeenCalledWith('debug', 'Parse', expect.stringContaining('JSON 解析开始'))
    expect(mockRenderLog).toHaveBeenCalledWith('debug', 'Parse', expect.stringContaining('解析成功'))
    expect(mockRenderLog).not.toHaveBeenCalledWith('warn', 'Parse', expect.anything())
  })

  it('对象失败 → 数组回退成功 → warn 日志', () => {
    // 文本同时含对象与数组：对象边界完整但内容损坏（值缺失）→ 对象尝试失败 → 回退数组成功
    const parsed = cmd.parseJSONPub<number[]>('[1, 2, 3] {"a": }')
    expect(parsed).toEqual([1, 2, 3])
    expect(mockRenderLog).toHaveBeenCalledWith('warn', 'Parse', '对象解析失败，回退数组尝试')
    expect(mockRenderLog).toHaveBeenCalledWith('debug', 'Parse', expect.stringContaining('数组 3 项'))
  })

  it('双失败 → error 日志含完整诊断 + 抛错', () => {
    expect(() => cmd.parseJSONPub('这不是 JSON{{{')).toThrow()
    const errorCall = mockRenderLog.mock.calls.find(c => c[0] === 'error')
    expect(errorCall).toBeTruthy()
    expect(String(errorCall?.[2])).toContain('JSON 解析失败')
    // 诊断信息落盘（花括号不匹配是 buildJSONParseDiagnostic 的检测项）
    expect(String(errorCall?.[2])).toContain('花括号不匹配')
  })

  it('自检重试轮 → info 日志；最终失败 → error 日志', async () => {
    const retryLLM = vi.fn()
      .mockResolvedValueOnce('{"ok": 1}')  // 第一次重试成功
    const result = await cmd.parseJSONWithSelfCheckPub('坏数据', retryLLM, 2)
    expect(result).toEqual({ ok: 1 })
    expect(mockRenderLog).toHaveBeenCalledWith('info', 'Parse', expect.stringContaining('自检重试 1/2'))
  })

  it('自检全部失败 → error 日志含 lastError', async () => {
    const retryLLM = vi.fn().mockResolvedValue('还是坏数据')
    await expect(cmd.parseJSONWithSelfCheckPub('坏数据', retryLLM, 1)).rejects.toThrow()
    const errorCall = mockRenderLog.mock.calls.find(c => c[0] === 'error' && String(c[2]).includes('自检'))
    expect(errorCall).toBeTruthy()
  })
})
