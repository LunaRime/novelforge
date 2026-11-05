#!/usr/bin/env node
/**
 * 边界棘轮：允许现状，禁止变差
 *
 * 为什么不做「一次性清零」：把 runtime 的 store 依赖一次改完，等于把 M3 提前，
 * 会卡住整条改造线。棘轮的做法是先记录今天的样子，之后只许降不许升。
 *
 * 规则：
 *   1) src/core/**        禁止 import electron / react / zustand / stores / components（硬失败）
 *   2) src/services/agent 统计引用 stores 的文件数与 useXStore.getState() 次数（与基线比对）
 *   3) 任一指标 > 基线 → 退出码 1；< 基线 → 打印"可下调基线"
 *
 * 用法：
 *   node scripts/check-boundaries.mjs
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import ts from 'typescript'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const BASELINE_FILE = join(ROOT, 'scripts', 'boundary-baseline.json')

/**
 * 抽取模块说明符：静态 import/export-from、动态 import()、require()
 * 只有出现在导入上下文里的字符串才算，注释与文案不会误命中。
 */
/** core 内判定为越界的说明符 */
const FORBIDDEN_RE = [
  /^electron(\/|$)/,
  /^react(-dom)?(\/|$)/,
  /^zustand(\/|$)/,
  /(^|\/)stores(\/|$)/,
  /(^|\/)components(\/|$)/,
]

const STORE_SPECIFIER = /(^|\/)stores(\/|$)/

function walk(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      out.push(...walk(full))
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|stories)\./.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function inspectSource(file) {
  const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const specifiers = []
  const workflowFactories = []
  let storeRefs = 0
  function visit(node) {
    let specifier
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      specifier = node.moduleSpecifier
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      specifier = node.moduleReference.expression
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isIdentifier(callee) && /^create\w*Workflow$/.test(callee.text)) workflowFactories.push(callee.text)
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require')) {
        specifier = node.arguments[0]
      }
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'getState'
        && ts.isIdentifier(callee.expression) && /^use\w+Store$/.test(callee.expression.text)) {
        storeRefs++
      }
    }
    if (specifier && ts.isStringLiteralLike(specifier)) specifiers.push(specifier.text)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return { specifiers, storeRefs, workflowFactories }
}

// ---- 1) core 硬门禁 ----
const coreViolations = []
for (const file of walk(join(ROOT, 'src', 'core'))) {
  for (const spec of inspectSource(file).specifiers) {
    const hit = FORBIDDEN_RE.find(re => re.test(spec))
    if (hit) coreViolations.push(`${relative(ROOT, file)} → ${spec}`)
  }
}

// ---- 2) agent 棘轮 ----
const agentFiles = []
let agentRefs = 0
for (const file of walk(join(ROOT, 'src', 'services', 'agent'))) {
  const source = inspectSource(file)
  agentRefs += source.storeRefs
  if (source.specifiers.some(s => STORE_SPECIFIER.test(s))) {
    agentFiles.push(file)
  }
}

const current = {
  coreForbidden: coreViolations.length,
  agentStoreFiles: agentFiles.length,
  agentStoreRefs: agentRefs,
}

// M2: UI sends typed application requests; adapters construct workflow definitions.
const uiWorkflowViolations = []
for (const file of walk(join(ROOT, 'src', 'components'))) {
  for (const factory of inspectSource(file).workflowFactories) {
    uiWorkflowViolations.push(`${relative(ROOT, file)} → ${factory}`)
  }
}

const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
console.log('边界检查（基线 → 当前）')
for (const key of ['coreForbidden', 'agentStoreFiles', 'agentStoreRefs']) {
  console.log(`  ${key.padEnd(15)} ${String(baseline[key]).padStart(3)} → ${current[key]}`)
}

let failed = uiWorkflowViolations.length > 0
for (const key of Object.keys(baseline)) {
  if (current[key] > baseline[key]) {
    failed = true
    console.error(`❌ ${key} 回升：${baseline[key]} → ${current[key]}（棘轮只许降）`)
  } else if (current[key] < baseline[key]) {
    console.log(`   ↳ ${key} 下降，可下调基线到 ${current[key]}`)
  }
}

if (coreViolations.length) {
  console.error('\ncore 越界：')
  for (const v of coreViolations.slice(0, 30)) console.error(`  - ${v}`)
}
if (uiWorkflowViolations.length) {
  console.error('\nUI workflow 越界：请调用应用层 startWorkflow')
  for (const violation of uiWorkflowViolations) console.error(`  - ${violation}`)
}

process.exit(failed ? 1 : 0)
