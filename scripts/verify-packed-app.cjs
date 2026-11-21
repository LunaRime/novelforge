/** 只读审计打包内容，确保应用入口有效，并阻止本地资料和调试代码进入分发包。 */
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { includesDevConsole } = require('./dev-console-policy.cjs')

// 用 electron-builder 自己使用的 ASAR 版本。CLI extract-file 会覆盖当前目录中的同名文件。
const builderRequire = createRequire(require.resolve('electron-builder'))
const asar = createRequire(builderRequire.resolve('app-builder-lib'))('@electron/asar')
const root = path.join(__dirname, '..')
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const releaseDir = path.join(root, 'release', version)
const candidates = [
  'win-unpacked/resources/app.asar',
  'linux-unpacked/resources/app.asar',
  'linux-arm64-unpacked/resources/app.asar',
  'mac/NovelForge.app/Contents/Resources/app.asar',
  'mac-arm64/NovelForge.app/Contents/Resources/app.asar',
  `NovelForge-${version}-Portable/resources/app.asar`,
]
const archive = candidates.map(file => path.join(releaseDir, file)).find(file => fs.existsSync(file))
if (!archive) throw new Error(`未找到待审计的 app.asar：${releaseDir}`)

const files = asar.listPackage(archive).map(file => file.replace(/\\/g, '/').replace(/^\/+/, ''))
const allowed = new Set(['build', 'dist', 'dist-electron', 'index.html', 'LICENSE', 'node_modules', 'package.json'])
const cli = new Set(['scripts', 'scripts/dev-instance.mjs', 'scripts/dev-instance-lib.mjs'])
const alpha = includesDevConsole('build', version)
const unexpected = new Set()
for (const file of files) {
  const top = file.split('/')[0]
  if (!allowed.has(top) && !(alpha && cli.has(file))) unexpected.add(top)
}
if (unexpected.size) throw new Error(`asar 含白名单之外的条目：${[...unexpected].join(', ')}`)
if (files.some(file => /^node_modules\/react(?:-dom)?(?:\/|$)/.test(file))) {
  throw new Error('asar 意外包含 React 依赖')
}

const readPacked = file => asar.extractFile(archive, file.split('/').join(path.sep)).toString('utf8')
const app = JSON.parse(readPacked('package.json'))
if (app.version !== version || app.main !== 'dist-electron/main.js' || app.type === 'module' || !files.includes(app.main)) {
  throw new Error('asar 的版本或 CommonJS 主进程入口不符合构建契约')
}

const preload = files.find(file => /^dist-electron\/preload\.\w+$/.test(file))
if (!preload) throw new Error('asar 缺少 dist-electron/preload.*')
if (preload.endsWith('.mjs') && /require\s*\(/.test(readPacked(preload))) throw new Error('asar 的 ESM preload 含 require()')

const size = fs.statSync(archive).size / (1024 * 1024)
console.log(`asar 审计通过：${path.relative(root, archive)}（${size.toFixed(1)} MiB）`)
