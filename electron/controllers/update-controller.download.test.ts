import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getVersion: () => '0.1.7-beta.2', getName: () => 'NovelForge', getPath: () => '' },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showMessageBox: async () => ({ response: 0 }) },
  shell: { openExternal: () => {} },
}))
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), close: vi.fn() } }))
vi.mock('../security/ipc-guard', () => ({ guardedHandle: vi.fn() }))
vi.mock('../ollama-registry', () => ({ downloadBlob: vi.fn(), probePath: vi.fn() }))
vi.mock('../net-path', () => ({ buildPathCandidates: vi.fn(() => []), rankPaths: vi.fn(() => []) }))

import { beginDownloadOnce, resetDownloadStateForTest } from './update-controller'

describe('beginDownloadOnce', () => {
  it('并发调用只启动一次', () => {
    resetDownloadStateForTest()
    const start = vi.fn(() => new Promise<void>(() => {}))
    expect(beginDownloadOnce(start)).toBe(true)
    expect(beginDownloadOnce(start)).toBe(false)
    expect(start).toHaveBeenCalledTimes(1)
  })
})