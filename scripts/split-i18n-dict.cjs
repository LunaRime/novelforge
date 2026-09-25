/**
 * 把单文件字典 src/shared/locale-data.ts 按 key 前缀切分为 src/shared/locale-data/ 下的多份。
 *
 * 方案：见 docs/superpowers/specs/2026-09-25-i18n-restructure-design.md（路径 A：拆文件、不换形状）
 * 规范：见 .agents/skills/i18n-architecture/SKILL.md §4
 *
 * ⚠️ 三条不可违反的约定：
 *   ① 条目形状不变（仍是 `'key': { 'zh-CN', 'en-US', 'ru-RU' }`），index 用对象展开合并回同一扁平对象
 *      → 3502 个调用点、TextKey、t() 签名全部零改动
 *   ② 每个分片内**保持原文条目顺序**（只在分片之间重排）
 *   ③ 不改写任何条目文本——本脚本只做搬运，不做格式化
 *
 * 用法：
 *   node scripts/split-i18n-dict.cjs --dry-run   # 只打印切分结果，不写文件
 *   node scripts/split-i18n-dict.cjs             # 实际切分
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src/shared/locale-data.ts')
const OUT_DIR = path.join(ROOT, 'src/shared/locale-data')

/** 前缀 → 分片。未列出的前缀进 misc（见 assertCoverage）。 */
const GROUPS = [
  ['log',        ['log'],                                                                    '日志面板与日志文案'],
  ['tool',       ['tool', 'toolCall', 'cmd'],                                                'Agent 工具调用'],
  ['prompt',     ['prompt', 'template', 'skillContent', 'skill', 'inject'],                  '提示词模板、注入内容与技能'],
  ['error',      ['error', 'guard'],                                                         '错误与守卫提示'],
  ['agent',      ['agent', 'tip', 'agentConfirm', 'agentPanel', 'mention', 'ccr', 'roleplay', 'ai', 'aiAction'], 'AI 助手面板与对话'],
  ['character',  ['character', 'charList', 'characters', 'characterRole', 'role', 'editorRole', 'relationshipGraph', 'graph', 'genre'], '角色与关系'],
  ['workflow',   ['workflow', 'engine', 'verify', 'verification', 'blueprintVerify', 'audit', 'pp', 'postprocess', 'postProcess', 'nextStep', 'statusbar', 'review'], '工作流、校验与审稿'],
  ['settings',   ['settings', 'mcp', 'proxy', 'models', 'model', 'vector', 'localEmbedding', 'embedding', 'novelConfig', 'genConfig', 'dev', 'health', 'browser'], '设置、模型与向量检索'],
  ['editor',     ['editor', 'chapter', 'chapterCard', 'draftbox', 'draftStatus', 'draft', 'manuscript', 'volume', 'diff', 'inlineAccept', 'style', 'markdown', 'codeEditor', 'arch', 'archConfirm', 'blueprint', 'blueprintGen', 'translate'], '编辑器、章节与蓝图'],
  ['project',    ['project', 'activity', 'usage', 'workspace', 'welcome', 'import', 'export', 'merge', 'archive', 'version', 'update', 'about', 'splash', 'window', 'focus', 'shareCard', 'pub', 'report', 'mutual', 'artifact', 'progressBar', 'zoom'], '项目、导入导出与统计'],
  ['ui',         ['action', 'dialog', 'status', 'menu', 'nav', 'panel', 'form', 'sort', 'unit', 'time', 'columns', 'empty', 'field', 'input', 'toast', 'save', 'sidebar', 'theme', 'font', 'common', 'knowledge', 'kb', 'search', 'find', 'memory'], '通用 UI 词汇'],
]

const MISC = 'misc'

// ==================== 解析 ====================

const raw = fs.readFileSync(SRC, 'utf8')
const lines = raw.split(/\r?\n/)

/** 首个条目所在行（跳过注释头与 `export const ... = {`） */
const bodyStart = lines.findIndex((l) => /^ {2}'[^']+': \{/.test(l))
if (bodyStart < 0) throw new Error('未找到首个条目')

/** 末尾 `} as const` */
const bodyEnd = lines.findIndex((l, i) => i > bodyStart && /^\} as const$/.test(l))
if (bodyEnd < 0) throw new Error('未找到 `} as const` 收尾')

const header = lines.slice(0, bodyStart).filter((l) => l.trim() !== '')
const footer = lines.slice(bodyEnd + 1).filter((l) => l.trim() !== '')

/** 条目：前置注释 + 正文行 */
const items = []
let pending = []
for (let i = bodyStart; i < bodyEnd; i++) {
  const line = lines[i]
  if (/^ {2}'[^']+': \{.*\},$/.test(line)) {
    // 单行条目（`.*` 贪婪：值里可能含 `{error}` 这类花括号）
    items.push({ key: line.match(/^ {2}'([^']+)'/)[1], comments: pending, text: [line] })
    pending = []
  } else if (/^ {2}'[^']+': \{$/.test(line)) {
    // 多行条目：吃到 `  },` 为止（本仓有 2 条，如 tool.listOutlineDesc）
    const block = [line]
    let j = i + 1
    while (j < bodyEnd && !/^ {2}\},$/.test(lines[j])) {
      block.push(lines[j])
      j++
    }
    if (j >= bodyEnd) throw new Error(`条目 ${line} 未闭合`)
    block.push(lines[j])
    items.push({ key: line.match(/^ {2}'([^']+)'/)[1], comments: pending, text: block })
    pending = []
    i = j
  } else if (line.trimStart().startsWith('/*')) {
    // 块注释：吃到 `*/` 为止（本仓仅 1 处，跨 5 行）
    const block = [line]
    let j = i
    while (!block[block.length - 1].includes('*/')) {
      j++
      if (j >= bodyEnd) throw new Error(`第 ${i + 1} 行的块注释未闭合`)
      block.push(lines[j])
    }
    pending.push(...block)
    i = j
  } else if (line.trim() === '' || line.trimStart().startsWith('//')) {
    pending.push(line)
  } else {
    throw new Error(`第 ${i + 1} 行无法归类：${line}`)
  }
}

// ==================== 分组 ====================

const prefixToGroup = new Map()
for (const [name, prefixes] of GROUPS) {
  for (const p of prefixes) {
    if (prefixToGroup.has(p)) throw new Error(`前缀 ${p} 被重复分配`)
    prefixToGroup.set(p, name)
  }
}

const buckets = new Map()
for (const [name] of GROUPS) buckets.set(name, [])
buckets.set(MISC, [])

for (const item of items) {
  const prefix = item.key.split('.')[0]
  const name = prefixToGroup.get(prefix) || MISC
  buckets.get(name).push(item)
}

// 覆盖性断言：所有 key 都被分配到且只分配一次
const total = [...buckets.values()].reduce((a, b) => a + b.length, 0)
if (total !== items.length) throw new Error(`分配数 ${total} ≠ 条目数 ${items.length}`)
const seen = new Set()
for (const item of items) {
  if (seen.has(item.key)) throw new Error(`重复 key: ${item.key}`)
  seen.add(item.key)
}

// ==================== 输出 ====================

const FILES = [...GROUPS.map(([name]) => name), MISC].filter((n) => buckets.get(n).length > 0)
let overflow = false
console.log('分片\t条目数\t前缀数\t说明')
for (const name of FILES) {
  const list = buckets.get(name)
  const prefixes = new Set(list.map((i) => i.key.split('.')[0]))
  const flag = list.length > 500 ? '  ⚠️ 超过 500' : ''
  if (list.length > 500) overflow = true
  const desc = GROUPS.find(([n]) => n === name)?.[2] ?? '未归类前缀（小前缀长尾）'
  console.log(`${name.padEnd(10)}${String(list.length).padStart(5)}${String(prefixes.size).padStart(7)}    ${desc}${flag}`)
}
console.log(`\n合计 ${total} 条 / 原文 ${items.length} 条`)
if (overflow) {
  console.error('⚠️ 有分片超过 500 条，请调整 GROUPS 后重跑')
  process.exit(1)
}
if (miscKeys().length) console.log(`misc 收录的前缀: ${miscKeys().join(', ')}`)

function miscKeys() {
  const s = new Set()
  for (const item of buckets.get(MISC)) s.add(item.key.split('.')[0])
  return [...s].sort()
}

if (process.argv.includes('--dry-run')) {
  console.log('\n[dry-run] 未写入任何文件')
  process.exit(0)
}

// ==================== 写文件 ====================

const HEADER = (name, desc) => `/**
 * 字典分片 · ${name} —— ${desc}
 *
 * ⚠️ 条目形状与其他分片一致（\`'key': { 'zh-CN', 'en-US', 'ru-RU' }\`），由
 * src/shared/locale-data/index.ts 用对象展开合并回同一个扁平对象。
 * 分片规则与验收见 .agents/skills/i18n-architecture/SKILL.md §4。
 */
export const ${name}Texts = {`

fs.mkdirSync(OUT_DIR, { recursive: true })
const importLines = []
const spreadLines = []

for (const name of FILES) {
  const list = buckets.get(name)
  const desc = GROUPS.find(([n]) => n === name)?.[2] ?? '未归类前缀（小前缀长尾）'
  const body = []
  for (const item of list) {
    // 前置注释（折叠连续空行为单个，保持可读）
    for (const c of item.comments) {
      if (c.trim() === '' && body.length && body[body.length - 1].trim() === '') continue
      body.push(c)
    }
    body.push(...item.text)
  }
  // 去掉末尾多余空行，文件以 `} as const` 收尾
  while (body.length && body[body.length - 1].trim() === '') body.pop()

  const content = [HEADER(name, desc), ...body, '} as const', ''].join('\n')
  fs.writeFileSync(path.join(OUT_DIR, `${name}.ts`), content)
  importLines.push(`import { ${name}Texts } from './${name}'`)
  spreadLines.push(`  ...${name}Texts,`)
  console.log(`  ✓ ${name}.ts  ${list.length} 条`)
}

const index = `/**
 * 字典入口 —— 把各分片合并回**同一个扁平对象**，形状与切分前完全一致。
 *
 * ⚠️ 这里必须保持扁平（\`UI_TEXTS['editor.save']\`），不能改成嵌套
 * （\`UI_TEXTS['zh-CN'].editor.save\`）—— 3502 个调用点与 TextKey 都依赖扁平形状。
 *
 * 分片文件由 scripts/split-i18n-dict.cjs 生成；改条目请直接改对应分片。
 */
${importLines.join('\n')}

export const UI_TEXTS_DATA = {
${spreadLines.join('\n')}
} as const
`
fs.writeFileSync(path.join(OUT_DIR, 'index.ts'), index)
console.log(`  ✓ index.ts（合并 ${FILES.length} 个分片）`)
fs.rmSync(SRC)
console.log(`  ✓ 已删除原单文件 ${path.relative(ROOT, SRC)}`)
