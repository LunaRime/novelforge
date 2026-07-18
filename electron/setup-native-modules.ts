/**
 * 原生模块搜索路径初始化 — 必须在所有其他导入之前加载
 *
 * 因为 electron-builder 用 !node_modules/** 排除了所有 node_modules，
 * 原生模块（better-sqlite3, @lancedb/lancedb 等）通过 extraResources
 * 复制到 resources/native_modules/。此模块将它们加入 Node.js 的全局搜索路径。
 */
import path from 'node:path'

// process.resourcesPath: Electron app 打包后的 resources/ 目录
// __dirname: 开发模式下 dist-electron/ 的绝对路径
const nativeModulesPath = path.join(
  process.resourcesPath || path.join(__dirname, '..'),
  'native_modules',
)

// 使用 require.resolve 的 paths 选项机制
// 将 native_modules 加入 require.main.paths 供全局搜索
const m = require('node:module') as NodeJS.Module & {
  globalPaths: string[]
}

if (!m.globalPaths.includes(nativeModulesPath)) {
  m.globalPaths.unshift(nativeModulesPath)
}
