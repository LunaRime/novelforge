import { expect, test } from 'vitest'
import { createRequire } from 'node:module'
import { devConsoleBuildGuard } from './dev-console-build-plugin'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const require = createRequire(import.meta.url)
const { includesDevConsole } = require('./dev-console-policy.cjs')
const beforePack = require('./dev-console-pack.cjs')
const { auditPublicConsole } = require('./public-console-audit.cjs')
test.each(['0.1.7-beta.3', '0.1.7', '0.1.7-rc.1', '0.1.7-alpha.1-evil'])('public build %s cannot enable console even in development mode', version => {
  const prior = process.env.NOVELFORGE_DEVTOOLS
  process.env.NOVELFORGE_DEVTOOLS = '1'
  try { expect(includesDevConsole('build', version, 'development')).toBe(false) }
  finally { if (prior === undefined) delete process.env.NOVELFORGE_DEVTOOLS; else process.env.NOVELFORGE_DEVTOOLS = prior }
})
test('serve and valid alpha include console', () => {
  expect(includesDevConsole('serve', '0.1.7-beta.3')).toBe(true)
  expect(includesDevConsole('build', '0.1.7-alpha.2')).toBe(true)
})
test.each(['0.1.7-beta.3', '0.1.7', '0.1.7-alpha.2'])('direct builder hook enforces CLI packaging for %s', async version => {
  const config = { files: ['dist/**', 'scripts/dev-instance.mjs'], asarUnpack: ['scripts/dev-instance.mjs'] }
  await beforePack({ packager: { config, appInfo: { version } } })
  expect(config.files.includes('scripts/dev-instance.mjs')).toBe(version.includes('-alpha.'))
  expect(config.asarUnpack.includes('scripts/dev-instance.mjs')).toBe(version.includes('-alpha.'))
})
test.each([false, true])('bundle guard checks rendered modules (console enabled=%s)', enabled => {
  const plugin = devConsoleBuildGuard(enabled)
  const hook = plugin.generateBundle as (...args: unknown[]) => void
  const run = () => hook.call({ error: (message: string) => { throw new Error(message) } }, {}, {
    'main.js': { type: 'chunk', modules: { '/repo/electron/dev/db-inspector.ts': { renderedLength: 30 } } },
  })
  if (enabled) expect(run).not.toThrow()
  else expect(run).toThrow('implementation leak')
})
test('public audit rejects stale alpha chunks, while alpha explicitly skips', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-console-audit-'))
  try {
    fs.mkdirSync(path.join(directory, 'dist')); fs.mkdirSync(path.join(directory, 'dist-electron'))
    fs.writeFileSync(path.join(directory, 'dist-electron', 'console-controller-old.js'), 'stale alpha code')
    expect(() => auditPublicConsole(directory, '0.1.7-beta.3')).toThrow('Stale console chunk')
    expect(() => auditPublicConsole(directory, '0.1.7')).toThrow('Stale console chunk')
    expect(auditPublicConsole(directory, '0.1.7-alpha.2')).toEqual({ skipped: true })
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
