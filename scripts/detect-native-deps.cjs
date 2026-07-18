#!/usr/bin/env node
/**
 * 原生模块自动检测 — 扫描 .node 二进制文件并验证 asarUnpack 覆盖
 *
 * 用法: node scripts/detect-native-deps.cjs [--verbose]
 *
 * 审计标记: [R11-2026-07-18] — R11-04
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')

// 递归扫描目录中的 .node 文件
function findNodeFiles(dir, maxDepth = 5) {
  const results = []
  if (maxDepth <= 0) return results
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...findNodeFiles(full, maxDepth - 1))
      } else if (entry.name.endsWith('.node')) {
        results.push(full)
      }
    }
  } catch { /* ignore permission errors */ }
  return results
}

// 从 .node 文件路径推断 node_modules 包路径（兼容 pnpm .pnpm 结构）
function inferPackagePath(nodeFile) {
  const rel = path.relative(ROOT, nodeFile).replace(/\\/g, '/')
  // 匹配 node_modules/.pnpm/@scope+pkg@version/ → 提取包名
  const pnpmMatch = rel.match(/node_modules\/\.pnpm\/(@?[^+]+\+[^@]+)@[\d.]+/)
  if (pnpmMatch) {
    const pkgWithVersion = pnpmMatch[1]
    // 转换: @lancedb+lancedb-win32-x64-msvc → @lancedb/lancedb-win32-x64-msvc
    const pkg = pkgWithVersion.replace(/\+/g, '/')
    // 截取到包名级别（处理 scoped package）
    const scopeless = pkg.replace(/^@([^/]+)\/(.+)$/, '@$1/$2')
    // 返回顶层包路径
    return `node_modules/${scopeless}`
  }
  // 标准 npm 路径: node_modules/pkg/...
  const match = rel.match(/node_modules\/(@[^/]+\/[^/]+|[^/]+)/)
  return match ? match[0] : null
}

// 读取 electron-builder.json5 中的 asarUnpack 列表
function readAsarUnpack() {
  const configPath = path.join(ROOT, 'electron-builder.json5')
  const raw = fs.readFileSync(configPath, 'utf-8')
  const match = raw.match(/"asarUnpack"\s*:\s*\[([\s\S]*?)\]/)
  if (!match) return []
  return [...match[1].matchAll(/"([^"]+)"/g)].map(m => m[1])
}

// 使用 glob 风格的路径匹配（支持 * 通配符）
function isCovered(pkgPath, patterns) {
  const cleanPkg = pkgPath.replace(/\\/g, '/')
  return patterns.some(p => {
    // 将 glob 模式转为正则
    const pattern = p
      .replace(/\\/g, '/')
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // 转义特殊字符
      .replace(/\*/g, '.*')                      // * → .*
    const re = new RegExp('^' + pattern + '$')
    return re.test(cleanPkg) || re.test(cleanPkg + '/')
  })
}

// ===== 主逻辑 =====
const verbose = process.argv.includes('--verbose')
console.log('🔍 扫描原生模块 (.node 文件)...\n')

// 扫描
const nodeModulesDir = path.join(ROOT, 'node_modules')
// pnpm 将实际文件存在 .pnpm 目录中
const pnpmDir = path.join(nodeModulesDir, '.pnpm')
const nodeFiles = [
  ...findNodeFiles(nodeModulesDir),
  ...(fs.existsSync(pnpmDir) ? findNodeFiles(pnpmDir, 5) : []),
]
const packages = new Set()
for (const f of nodeFiles) {
  const pkg = inferPackagePath(f)
  if (pkg) packages.add(pkg)
}

if (packages.size === 0) {
  console.log('未找到 .node 文件，可能 node_modules 未安装。')
  process.exit(0)
}

const asarUnpack = readAsarUnpack()
let allCovered = true

// 去重，仅保留顶层包路径
const topPackages = new Set()
for (const pkg of packages) {
  // 取 node_modules/pkg 或 node_modules/@scope/pkg
  const parts = pkg.split('/')
  const nmIdx = parts.indexOf('node_modules')
  if (nmIdx === -1) continue
  const top = parts.slice(0, nmIdx + (parts[nmIdx + 1]?.startsWith('@') ? 3 : 2)).join('/')
  topPackages.add(top)
}

const sorted = [...topPackages].sort()
for (const pkg of sorted) {
  const covered = isCovered(pkg, asarUnpack)
  if (covered) {
    console.log(`  ✅ ${pkg}`)
    if (verbose) console.log(`     已在 asarUnpack 中`)
  } else {
    console.log(`  ❌ ${pkg} — 未在 asarUnpack 中！`)
    console.log(`     添加: "${pkg}/**/*" 到 electron-builder.json5 的 asarUnpack`)
    allCovered = false
  }
}

console.log()
if (allCovered) {
  console.log('✅ 全部原生模块已在 asarUnpack 中覆盖')
} else {
  console.log('❌ 有原生模块未覆盖，请添加到 asarUnpack')
  process.exit(1)
}
