#!/usr/bin/env node
/**
 * 截 Storybook story 的图 —— UI 排布改动**用图验收**，不靠文字描述。
 *
 * 为什么要有这个脚本：排布类改动（间距、折行、溢出、拥挤）用断言测不出来，
 * 「改完看着对不对」只能看图。2026-09-25 重构角色编辑器时，就是靠它一眼抓到
 * 「窄编辑区下 `★★★ 核心` 被折成两行」「分区标题贴字段比其他分区紧 12px」——
 * 两个都是读代码看不出来的。
 *
 * 用法（先在另一个终端 `pnpm run storybook`）：
 *   node scripts/shot-stories.mjs novelsforge-editors-charactereditor--full-profile
 *   node scripts/shot-stories.mjs <story-id> --width 320 --height 700 --name narrow
 *   node scripts/shot-stories.mjs <story-id> --theme light --click 更多
 *
 * 选项：
 *   --width/--height  视口尺寸（默认 1200×900）。**窄宽度必测**：编辑区下限 320px
 *   --name            输出文件名（默认 `<story>-<width>`）
 *   --theme           light|galaxy|paper|dark（默认 galaxy，应用默认主题）
 *   --click <title>   截图前先点一下 title 为该文本的元素（拍菜单/浮层展开态）
 *   --port            Storybook 端口（默认 6006）
 *   --out             输出目录（默认 .shots/，已 gitignore）
 *
 * 找浏览器：playwright 包期望的版本号与 `ms-playwright` 缓存里的版本**常年不一致**
 * （缓存被别的工具升级过就会这样），所以这里直接扫缓存取最新的 chromium。
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const storyId = args.find(a => !a.startsWith('--'))
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

if (!storyId) {
  console.error('用法: node scripts/shot-stories.mjs <story-id> [--width 380] [--height 900] [--name x] [--theme galaxy] [--click 文本] [--port 6006]')
  console.error('story-id 形如 novelforge-editors-charactereditor--full-profile；')
  console.error('光标停在 Storybook 的 iframe 上即可从地址栏 ?id= 看到。')
  process.exit(2)
}

const width = Number(opt('width', 1200))
const height = Number(opt('height', 900))
const theme = opt('theme', 'galaxy')
const port = opt('port', '6006')
const outDir = path.resolve(opt('out', '.shots'))
const name = opt('name', `${storyId.split('--').pop()}-${width}`)
const clickTitle = opt('click')

/** 扫 ms-playwright 缓存里最新的 chromium（绕开 playwright 包的版本校验） */
function findChromium() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright')
  if (!fs.existsSync(base)) return undefined
  const versions = fs.readdirSync(base)
    .filter(d => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]))
  for (const dir of versions.reverse()) {
    const exe = path.join(base, dir, 'chrome-win64', 'chrome.exe')
    if (fs.existsSync(exe)) return exe
  }
  return undefined
}

fs.mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ executablePath: findChromium() })
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 })
const url = `http://localhost:${port}/iframe.html?viewMode=story&globals=theme:${theme}&id=${storyId}`

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(800) // 等字体与首帧布局稳定

if (clickTitle) {
  await page.getByTitle(clickTitle).first().click()
  await page.waitForTimeout(400)
}

const file = path.join(outDir, `${name}.png`)
await page.screenshot({ path: file })
await browser.close()
console.log(`${file}  (${width}×${height}, theme=${theme})`)
