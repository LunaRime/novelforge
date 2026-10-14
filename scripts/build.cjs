#!/usr/bin/env node
/**
 * 构建编排（替代 package.json 里的 && 链）
 *
 * 为什么包一层：electron-builder 打包会把 package.json 里的 scripts / devDependencies
 * 删掉并写回（历史事故 11 次，见 novelforge-release 技能「构建后 package.json 覆盖检查」）。
 * 用 `&&` 链时若中间某步失败（如 verify-packed-app 的 asar 审计），后续恢复步骤不会执行；
 * 包一层 + try/finally 保证「无论构建成败，package.json 一定恢复」。
 *
 * 备份 = 构建前原样复制（含当前 version + scripts/devDependencies），恢复 = 覆盖回去，
 * 因此「构建前刚改的版本号」不会丢（比 git checkout 更稳，不依赖版本号已提交）。
 */
const fs = require('node:fs')
const path = require('node:path')
const { execSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const PKG = path.join(ROOT, 'package.json')
const BAK = path.join(ROOT, '.package.json.bak')

// 让 tsc / vite / electron-builder 等 node_modules/.bin 命令可被 execSync 找到
const BIN = path.join(ROOT, 'node_modules', '.bin')
process.env.PATH = `${BIN}${path.delimiter}${process.env.PATH}`

function run(cmd) {
  console.log(`\n> ${cmd}`)
  execSync(cmd, {
    stdio: 'inherit',
    cwd: ROOT,
    shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
  })
}

fs.copyFileSync(PKG, BAK)

try {
  run('node scripts/verify-build-contract.cjs')
  run('tsc')
  run('vite build')
  run('electron-builder')
  run('node scripts/verify-packed-app.cjs')
  run('node scripts/organize-release.cjs')
} finally {
  let restored = false
  try {
    const current = JSON.parse(fs.readFileSync(PKG, 'utf8'))
    if (!current.scripts || !current.devDependencies) {
      fs.copyFileSync(BAK, PKG)
      restored = true
    }
  } catch {
    // 读当前 package.json 失败（被写成畸形）→ 直接恢复
    fs.copyFileSync(BAK, PKG)
    restored = true
  }
  if (restored) {
    console.log('⚠️  package.json 被 electron-builder 覆盖，已从备份自动恢复')
  }
  if (fs.existsSync(BAK)) fs.unlinkSync(BAK)
}
