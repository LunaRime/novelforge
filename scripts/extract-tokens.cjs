#!/usr/bin/env node
/**
 * CSS 变量 → TypeScript tokens 自动提取
 *
 * 从 src/index.css 解析 :root / .galaxy / .paper / .dark 下的 CSS 自定义属性，
 * 生成 src/tokens/index.ts，确保 CSS 变量与 TypeScript tokens 保持同步。
 *
 * 用法: node scripts/extract-tokens.cjs
 *
 * 审计标记: [R10-2026-07-18] — R10-09
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const CSS_FILE = path.join(ROOT, 'src', 'index.css')
const OUTPUT = path.join(ROOT, 'src', 'tokens', 'index.ts')

const css = fs.readFileSync(CSS_FILE, 'utf-8')

/** 提取指定选择器块内的 CSS 变量 */
function extractVars(selector, content) {
  // 匹配 .themeName { ... } 或 :root { ... } 块
  const escaped = selector.replace(/[.]/g, '\\.').replace(/[:]/g, '\\:')
  const re = new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, 's')
  const match = content.match(re)
  if (!match) return null

  const block = match[1]
  const vars = {}

  // 匹配 --prefix-name: value;
  const varRe = /--(\w+)-(\S+):\s*([^;]+);/g
  let m
  while ((m = varRe.exec(block)) !== null) {
    const category = m[1]       // e.g., color, height, radius
    const name = m[2]           // e.g., bg, sidebar, text
    const value = m[3].trim()

    if (!vars[category]) vars[category] = {}
    // 驼峰化: bg → bg, text-secondary → textSecondary
    const key = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    vars[category][key] = value
  }

  return Object.keys(vars).length > 0 ? vars : null
}

// 主题 → 选择器映射
const themes = {
  light: ':root',
  galaxy: '.galaxy',
  paper: '.paper',
  dark: '.dark',
}

const result = {}
for (const [theme, selector] of Object.entries(themes)) {
  const vars = extractVars(selector, css)
  if (vars) result[theme] = vars
}

// 排序键
function sortKeys(obj) {
  if (!obj || typeof obj !== 'object') return obj
  return Object.keys(obj).sort().reduce((acc, k) => {
    acc[k] = typeof obj[k] === 'object' ? sortKeys(obj[k]) : obj[k]
    return acc
  }, {})
}

// 生成 TypeScript 文件 — 手工格式化确保类型安全
function toTS(obj, indent = 0) {
  const pad = '  '.repeat(indent)
  if (typeof obj !== 'object' || obj === null) {
    if (typeof obj === 'string') {
      // 转义单引号，用单引号包裹
      return `'${obj.replace(/'/g, "\\'")}'`
    }
    return String(obj)
  }
  const isArray = Array.isArray(obj)
  const open = isArray ? '[' : '{'
  const close = isArray ? ']' : '}'
  const entries = Object.entries(obj)
  if (entries.length === 0) return open + close

  const lines = entries.map(([k, v]) => {
    // 键名：以字母开头且仅含字母数字 → 不加引号；否则加引号
    const key = /^[a-zA-Z]\w*$/.test(k) ? k : `'${k}'`
    return `${pad}  ${key}: ${toTS(v, indent + 1)}`
  })

  return `${open}\n${lines.join(',\n')}\n${pad}${close}`
}

const out = `/**
 * NovelForge Design Tokens
 * ⚠️ 由 scripts/extract-tokens.cjs 自动生成，请勿手动编辑
 *
 * 运行 pnpm gen:tokens 重新生成。
 */

export const tokens = ${toTS(sortKeys(result))} as const

export type ThemeName = keyof typeof tokens
export type TokenCategory = keyof (typeof tokens)['light']
`

// 确保输出目录存在
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true })

// 只在实际变化时才写入（避免不必要的 git diff）
const old = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf-8') : ''
if (old === out) {
  console.log('[extract-tokens] 无变化，跳过写入')
} else {
  fs.writeFileSync(OUTPUT, out, 'utf-8')
  console.log(`[extract-tokens] 已生成 ${path.relative(ROOT, OUTPUT)}`)
}
