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
  // 标准 npm 路径: node_modules/pkg/...（跳过 .pnpm 等内部目录）
  const match = rel.match(/node_modules\/(?!\.)(@[^/]+\/[^/]+|[^/]+)/)
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
    // 去掉 /**/* 后缀（asarUnpack/files 的通配后缀）
    const clean = p.replace(/\\/g, '/').replace(/\/?\*\*\/?\*?$/, '')
    // 将剩余 glob 转为正则（仅 * 通配符）
    const escaped = clean.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    const regex = '^' + escaped.replace(/\*/g, '.*') + '$'
    const re = new RegExp(regex)
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
  ...(fs.existsSync(pnpmDir) ? findNodeFiles(pnpmDir, 7) : []),
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

// 去重，仅保留顶层包路径，过滤 pnpm store 和 dev-only 工具
const DEV_NATIVE = ['@rolldown', '@tailwindcss', 'lightningcss', 'esbuild']
const topPackages = new Set()
for (const pkg of packages) {
  // 跳过 pnpm 虚拟存储
  if (pkg.includes('/.pnpm/')) continue
  // 取 node_modules/pkg 或 node_modules/@scope/pkg
  const parts = pkg.split('/')
  const nmIdx = parts.indexOf('node_modules')
  if (nmIdx === -1) continue
  const top = parts.slice(0, nmIdx + (parts[nmIdx + 1]?.startsWith('@') ? 3 : 2)).join('/')
  // 跳过构建工具的原生模块（不在运行时需要）
  if (DEV_NATIVE.some(d => top.includes(d))) continue
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
  console.log('⚠️  有原生模块未覆盖（可能为构建工具，非运行时需要）')
}
const phase1Failed = !allCovered

// ===== 阶段 2：external → files 覆盖率 =====
console.log('\n🔍 检查 external → files 覆盖率...\n')
let allExternalCovered = true

function readViteExternals() {
  const configPath = path.join(ROOT, 'vite.config.ts')
  const raw = fs.readFileSync(configPath, 'utf-8')
  const match = raw.match(/external:\s*\[([^\]]+)\]/)
  if (!match) return []
  // 提取 'package-name' 或 "package-name"
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1])
}

function readFilesPatterns() {
  const configPath = path.join(ROOT, 'electron-builder.json5')
  const raw = fs.readFileSync(configPath, 'utf-8')
  const match = raw.match(/"files"\s*:\s*\[([\s\S]*?)\]/)
  if (!match) return []
  return [...match[1].matchAll(/"([^"]+)"/g)].map(m => m[1])
}

const externals = readViteExternals()
const filesPat = readFilesPatterns()

if (externals.length === 0) {
  console.log('未找到 vite.config.ts 中的 external 列表')
} else {
  console.log(`externals: ${externals.join(', ')}\n`)

  for (const pkg of externals) {
    // 检查 files 中是否有对应规则
    const pkgPath = `node_modules/${pkg}`
    const covered = isCovered(pkgPath, filesPat) ||
      // 也检查子包通配（如 @lancedb/lancedb-win32-* 覆盖 @lancedb/lancedb）
      filesPat.some(p => {
        const patternDir = p.replace(/\/?\*\*\/?\*?$/, '').replace(/\\/g, '/')
        const pkgDir = pkgPath.replace(/\\/g, '/')
        return patternDir.startsWith(pkgDir) || pkgDir.startsWith(patternDir)
      })

    if (covered) {
      console.log(`  ✅ ${pkg} — 已在 files 回加中`)
    } else {
      console.log(`  ❌ ${pkg} — 未在 files 回加中！`)
      console.log(`     添加: "node_modules/${pkg}/**" 到 electron-builder.json5 的 files 回加区`)
      // 检查是否有子包被覆盖（如 @lancedb/lancedb-win32-* 但 @lancedb/lancedb 缺失）
      const subCovered = filesPat.filter(p =>
        p.includes(pkg) && !p.includes(`${pkg}/`)
      )
      if (subCovered.length > 0) {
        console.log(`     ⚠️  检测到子包已被覆盖但主包缺失: ${subCovered.join(', ')}`)
        console.log(`     这会导致双层包结构的入口文件缺失。`)
      }
      allExternalCovered = false
    }
  }

  console.log()
  if (allExternalCovered) {
    console.log('✅ 全部 external 依赖已在 files 回加中覆盖')
  } else {
    console.log('❌ 有 external 依赖未覆盖')
    process.exit(1)
  }
}

// 最终退出码：仅 phase 2 失败时退出 1
if (!allExternalCovered) process.exit(1)
console.log('\n✅ 检测完成')
