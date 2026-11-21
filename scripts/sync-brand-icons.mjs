#!/usr/bin/env node
/**
 * 把 docs/ui-redesign-v3/logos 的品牌定稿同步成 build/ 下的生产图标。
 *
 * 设计主稿只在 logos/ 维护；build/icon.png|ico|icns 是生成物。
 * 换设计时改 logos/ 后重跑：`node scripts/sync-brand-icons.mjs`
 *
 * 生产引用点（都指向 build/，无第二份副本）：
 *   electron/main.ts          BrowserWindow.icon / app.dock.setIcon
 *   electron-builder.json5    win.icon / nsis.installerIcon / installerHeaderIcon
 *   src/App.tsx               自绘标题栏图标（import）
 *   src/components/pages/WelcomePage.tsx  欢迎页图标（import）
 *   index.html                启动首帧（Vite 资源引用）
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const src = join(root, 'docs', 'ui-redesign-v3', 'logos')
const out = join(root, 'build')

function pngSize(buf) {
  if (buf[0] !== 0x89 || buf.toString('ascii', 1, 4) !== 'PNG') throw new Error('不是 PNG 文件')
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)]
}

function loadPng(size) {
  const file = `novelforge-icon-${size}.png`
  const buf = readFileSync(join(src, file))
  const [w, h] = pngSize(buf)
  if (w !== size || h !== size) throw new Error(`${file} 尺寸 ${w}x${h}，预期 ${size}x${size}`)
  return buf
}

// Windows / Linux：主稿 PNG + 官方多尺寸 ICO
const master = loadPng(1024)
copyFileSync(join(src, 'novelforge-icon-1024.png'), join(out, 'icon.png'))

const ico = readFileSync(join(src, 'novelforge-icon.ico'))
if (ico.readUInt16LE(2) !== 1) throw new Error('novelforge-icon.ico 类型不是 ICO')
const icoCount = ico.readUInt16LE(4)
copyFileSync(join(src, 'novelforge-icon.ico'), join(out, 'icon.ico'))

// macOS：ICNS 是简单容器，条目直接嵌入 PNG（现代 ic07–ic10 全部为 PNG 数据）。
const icnsTypes = [
  ['icp4', 16], ['icp5', 32], ['icp6', 64],
  ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024],
]
const chunks = icnsTypes.map(([type, size]) => {
  const png = loadPng(size)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(8 + png.length, 0)
  return Buffer.concat([Buffer.from(type, 'ascii'), length, png])
})
const body = Buffer.concat(chunks)
const header = Buffer.alloc(8)
header.write('icns', 0, 4, 'ascii')
header.writeUInt32BE(8 + body.length, 4)
const icns = Buffer.concat([header, body])
writeFileSync(join(out, 'icon.icns'), icns)

// 回读校验：ICNS 魔数、总长、条目类型
if (icns.toString('ascii', 0, 4) !== 'icns' || icns.readUInt32BE(4) !== icns.length) {
  throw new Error('生成的 icon.icns 头部校验失败')
}
let offset = 8
const found = []
while (offset < icns.length) {
  const type = icns.toString('ascii', offset, offset + 4)
  const length = icns.readUInt32BE(offset + 4)
  if (length < 8 || offset + length > icns.length) throw new Error(`ICNS 条目 ${type} 长度非法`)
  found.push(type)
  offset += length
}

console.log(`icon.png   1024x1024  ${master.length} bytes`)
console.log(`icon.ico   ${icoCount} sizes   ${ico.length} bytes`)
console.log(`icon.icns  ${found.join(', ')}  ${icns.length} bytes`)
