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
  const runtimeSpecifiers = []
  const workflowFactories = []
  const ipcChannels = []
  let storeRefs = 0
  function visit(node) {
    let specifier
    let typeOnly = false
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      specifier = node.moduleSpecifier
      typeOnly = ts.isExportDeclaration(node) ? !!node.isTypeOnly : !!node.importClause?.isTypeOnly
      if (ts.isImportDeclaration(node) && node.importClause && !node.importClause.name
        && node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
        && node.importClause.namedBindings.elements.length > 0
        && node.importClause.namedBindings.elements.every(item => item.isTypeOnly)) typeOnly = true
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      specifier = node.moduleReference.expression
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'invoke'
        && ts.isIdentifier(callee.expression) && callee.expression.text === 'ipc'
        && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) ipcChannels.push(node.arguments[0].text)
      if (ts.isIdentifier(callee) && /^create\w*Workflow$/.test(callee.text)) workflowFactories.push(callee.text)
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require')) {
        specifier = node.arguments[0]
      }
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'getState'
        && ts.isIdentifier(callee.expression) && /^use\w+Store$/.test(callee.expression.text)) {
        storeRefs++
      }
    }
    if (specifier && ts.isStringLiteralLike(specifier)) {
      specifiers.push(specifier.text)
      if (!typeOnly) runtimeSpecifiers.push(specifier.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return { specifiers, runtimeSpecifiers, storeRefs, workflowFactories, ipcChannels }
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

// M4: callers consume the public core entry; unit tests inside core remain local.
const coreEntryViolations = []
for (const area of ['src', 'electron', 'scripts']) {
  for (const file of walk(join(ROOT, area))) {
    if (relative(join(ROOT, 'src', 'core'), file).match(/^(?!\.\.)[^:]/)) continue
    for (const spec of inspectSource(file).specifiers) {
      if (/(^|\/)core\/(domain|application|ports|runtime|adapters|migration)\//.test(spec)) {
        coreEntryViolations.push(`${relative(ROOT, file)} → ${spec}`)
      }
    }
  }
}

// M2: UI sends typed application requests; adapters construct workflow definitions.
const uiWorkflowViolations = []
const editorApplicationViolations = []
const knowledgeApplicationViolations = []
for (const file of walk(join(ROOT, 'src', 'components'))) {
  const source = inspectSource(file)
  if (relative(ROOT, file).replace(/\\/g, '/') === 'src/components/panels/KnowledgePanel.tsx') {
    for (const spec of source.runtimeSpecifiers) {
      if (/\/(?:ipc-client|stores\/llm-store|knowledge-service)$/.test(spec)) {
        knowledgeApplicationViolations.push(`${relative(ROOT, file)} → ${spec}`)
      }
    }
  }
  if (relative(ROOT, file).replace(/\\/g, '/') === 'src/components/editor/DraftEditor.tsx') {
    for (const spec of source.specifiers) {
      if (/\/(?:ipc-client|stores\/(?:llm|draft)-store)$/.test(spec) || /\/services\/workflows\//.test(spec)) {
        editorApplicationViolations.push(`${relative(ROOT, file)} → ${spec}`)
      }
    }
  }
  for (const factory of source.workflowFactories) {
    uiWorkflowViolations.push(`${relative(ROOT, file)} → ${factory}`)
  }
}

const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
const draftStore = join(ROOT, 'src', 'stores', 'draft-store.ts')
const draftMutationViolations = existsSync(draftStore)
  ? inspectSource(draftStore).ipcChannels.filter(channel => ['db:draft-update-content', 'db:draft-update-status', 'db:revision-mark-merged'].includes(channel))
  : []
console.log('边界检查（基线 → 当前）')
for (const key of ['coreForbidden', 'agentStoreFiles', 'agentStoreRefs']) {
  console.log(`  ${key.padEnd(15)} ${String(baseline[key]).padStart(3)} → ${current[key]}`)
}

let failed = uiWorkflowViolations.length > 0 || coreEntryViolations.length > 0 || editorApplicationViolations.length > 0 || draftMutationViolations.length > 0 || knowledgeApplicationViolations.length > 0
if (knowledgeApplicationViolations.length) {
  console.error('\nknowledge application: panel IO must use knowledge application ports')
  for (const violation of knowledgeApplicationViolations) console.error(`  - ${violation}`)
}
if (draftMutationViolations.length) {
  console.error('\ndraft store projection: revision merging must use the atomic application command')
  for (const channel of draftMutationViolations) console.error(`  - ${channel}`)
}
if (editorApplicationViolations.length) {
  console.error('\neditor application: DraftEditor must use application ports for IO and workflow commands')
  for (const violation of editorApplicationViolations) console.error(`  - ${violation}`)
}
if (coreEntryViolations.length) {
  console.error('\ncore public entry: import from core/index instead of internal modules')
  for (const violation of coreEntryViolations) console.error(`  - ${violation}`)
}
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
