#!/usr/bin/env node
/**
 * Vela Font Subsetting Script
 *
 * Reduces Chinese font files from ~92MB to ~20MB by keeping only
 * the 5000 most common Chinese characters.
 *
 * Usage: node scripts/subset-fonts.mjs
 *
 * Requires: Python fonttools (pip install fonttools brotli)
 * Or: npm subset-font package as fallback
 */

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const FONTS_DIR = path.join(ROOT, 'public', 'fonts')
const OUTPUT_DIR = path.join(FONTS_DIR, 'subset')
const CHAR_SET_FILE = path.join(__dirname, 'font-char-set.txt')

// Read character set
const rawChars = fs.readFileSync(CHAR_SET_FILE, 'utf-8')
const chars = rawChars
  .replace(/#.*/g, '')         // Remove comments
  .replace(/\s+/g, '')         // Remove whitespace
  .split('')
  .filter((c, i, arr) => arr.indexOf(c) === i) // Deduplicate
  .join('')

console.log(`字符集大小: ${chars.length} 个唯一字符`)

// Font files to subset
const JOBS = [
  { input: 'LXGWWenKai-Regular.ttf', output: 'LXGWWenKai-Regular.ttf' },
  { input: 'LXGWWenKai-Medium.ttf', output: 'LXGWWenKai-Medium.ttf' },
  { input: 'NotoSansSC-VariableFont_wght.ttf', output: 'NotoSansSC-Variable.ttf' },
  { input: 'NotoSerifSC-VariableFont_wght.ttf', output: 'NotoSerifSC-Variable.ttf' },
]

// Ensure output directory
fs.mkdirSync(OUTPUT_DIR, { recursive: true })

let tool: 'pyftsubset' | 'npm' | 'none' = 'none'

// Check for pyftsubset (Python fonttools)
try {
  execSync('pyftsubset --version', { stdio: 'pipe' })
  tool = 'pyftsubset'
  console.log('使用 pyftsubset (Python fonttools)')
} catch {
  try {
    execSync('npx subset-font --help', { stdio: 'pipe' })
    tool = 'npm'
    console.log('使用 subset-font (npm)')
  } catch {
    console.warn('⚠️  pyftsubset 和 subset-font 都不可用')
    console.log('安装方法: pip install fonttools brotli')
    console.log('或: npm install -g subset-font')
    tool = 'none'
  }
}

if (tool === 'none') {
  console.log('跳过字体子集化。请手动运行 pyftsubset。')
  console.log('命令示例:')
  for (const job of JOBS) {
    const inputPath = path.join(FONTS_DIR, job.input)
    if (fs.existsSync(inputPath)) {
      const outputPath = path.join(OUTPUT_DIR, job.output)
      console.log(`  pyftsubset "${inputPath}" --text-file="${CHAR_SET_FILE}" --output-file="${outputPath}" --flavor=woff2`)
    }
  }
  process.exit(0)
}

// Process each font
for (const job of JOBS) {
  const inputPath = path.join(FONTS_DIR, job.input)
  const outputPath = path.join(OUTPUT_DIR, job.output)

  if (!fs.existsSync(inputPath)) {
    console.log(`⏭ 跳过 (文件不存在): ${job.input}`)
    continue
  }

  const inputSize = (fs.statSync(inputPath).size / (1024 * 1024)).toFixed(1)
  console.log(`🔄 子集化: ${job.input} (${inputSize}MB) → ${job.output}`)

  try {
    if (tool === 'pyftsubset') {
      execSync(
        `pyftsubset "${inputPath}" --text="${chars}" --output-file="${outputPath}" --flavor=woff2 --no-subset-tables+=*`,
        { stdio: 'pipe' },
      )
    } else {
      execSync(
        `npx subset-font "${inputPath}" "${outputPath}" --chars="${chars}" --format=woff2`,
        { stdio: 'pipe' },
      )
    }
    const outputSize = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(1)
    const savings = ((1 - fs.statSync(outputPath).size / fs.statSync(inputPath).size) * 100).toFixed(0)
    console.log(`  ✅ ${outputSize}MB (节省 ${savings}%)`)
  } catch (error) {
    console.error(`  ❌ 失败: ${error.message}`)
  }
}

console.log('\n字体子集化完成!')
console.log(`输出目录: ${OUTPUT_DIR}`)
console.log('\n提示: 更新 src/index.css 中的 @font-face url 指向 subset/ 目录')
