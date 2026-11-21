import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collectFeedbackErrors } from './feedback-logs'

const now = Date.parse('2026-11-21T12:00:00.000Z')
let directory: string

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'novelforge-feedback-test-'))
})

afterEach(async () => {
  for (const name of await fs.readdir(directory)) await fs.unlink(path.join(directory, name))
  await fs.rmdir(directory)
})

describe('collectFeedbackErrors', () => {
  it('只导出近一周的错误首行，并遮蔽密钥、用户目录和地址参数', async () => {
    await fs.writeFile(path.join(directory, 'vela-dev-2026-11-20.log'), [
      '[2026-11-13T10:00:00.000Z] [ERROR] [QA] too-old',
      '[2026-11-20T09:00:00.000Z] [INFO ] [QA] info-only',
      '[2026-11-20T10:00:00.000Z] [ERROR] [QA] Bearer abc12345 cookie="quoted secret"',
      'private multiline details',
      '[2026-11-20T11:00:00.000Z] [ERROR] [QA] https://example.com/path?user=sample test@example.com C:\\Users\\Example\\Docs',
    ].join('\n'))
    await fs.writeFile(path.join(directory, 'unrelated.log'), '[2026-11-21T01:00:00.000Z] [ERROR] [QA] unrelated')
    const results = await collectFeedbackErrors([path.join(directory, 'missing'), directory], now)
    expect(results).toEqual([
      '[2026-11-20T11:00:00.000Z] [ERROR] [QA] https://example.com/path?[redacted] [email] [local path]',
      '[2026-11-20T10:00:00.000Z] [ERROR] [QA] Bearer *** cookie="***"',
    ])
  })

  it('保留最近的 200 条错误', async () => {
    await fs.writeFile(path.join(directory, 'vela-2026-11-21.log'), Array.from({ length: 220 }, (_, index) => {
      const time = new Date(now - 60_000 + index).toISOString()
      return `[${time}] [ERROR] [QA] entry-${index}`
    }).join('\n'))
    const results = await collectFeedbackErrors([directory], now)
    expect(results).toHaveLength(200)
    expect(results[0]).toContain('entry-219')
    expect(results.at(-1)).toContain('entry-20')
  })
})
