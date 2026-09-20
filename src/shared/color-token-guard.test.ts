/**
 * 颜色 token 守卫测试 — AGENTS.md 核心约束「颜色：CSS 变量，禁止硬编码」
 *
 * 与 `ipc-channel-parity.test.ts` 同族：**源码文本扫描**型策略守卫（不 import 任何业务模块）。
 * 零新增依赖（只用 node:fs / node:path + vitest），不引入 ESLint 规则。
 *
 * 扫描 `src/**` 的硬编码色：
 *   ① Tailwind 调色板工具类：`bg-amber-500`、`text-green-400`、`border-red-500/20`（`/opacity` 修饰形式
 *      命中同一处类名主干，不重复计数）；
 *   ② 字面十六进制色：`#22c55e`；
 *   ③ 字面 `rgb()/rgba()/hsl()` 调用 —— 但第一个实参是 token 的 `rgba(var(--color-x-rgb), α)` 视为合规；
 *   ④ **token 存在性**：`var(--color-*)` / `var(--*-rgb)` 必须能在 `src/index.css` 的主题块里找到定义。
 *
 * ⚠️ **已知盲区（刻意保留，不要当成已覆盖）**：
 *   - ③ 曾经的正则 `/(rgba?|hsla?)\(([^()]*)\)/` **无法匹配嵌套括号**：
 *     `rgba(var(--accent-rgb, 99, 102, 241), 0.03)` 这种「实参里含 `var()` 且 `var()` 自带逗号兜底」的写法
 *     整条都匹配不到，①②③ 全部漏检（`MarkdownContent.tsx:282` 的真实事故即此类）。
 *     现改为**显式字符扫描**：`colorFuncsOf()` 用游标逐个消费最外层调用、`splitTopLevel()` 按顶层逗号切分实参，
 *     内层括号与逗号不再干扰判定；**仍不解析 CSS 函数语义**（只做括号配对），
 *     若将来出现转义引号、注释内嵌函数等更刁钻的写法，需重新评估。
 *   - ④ 只校验**存在性**：不校验「每个 token 是否 4 套主题块都定义」（例如 `--color-accent-hover`、
 *     `--color-gold` 在部分主题块缺失，本守卫不报），也不校验 token 取值是否合理。
 *   - 字面色检测（①②③）与 token 存在性检测（④）是**两条独立通道**：③ 的「首个实参是 `var(` 即合规」
 *     只看形状，因此 `rgba(var(--accent-rgb, 99, 102, 241), 0.03)`（名字不存在、靠兜底字面量渲染）
 *     **不会在 ③ 报**，而是在 ④ 报 `--accent-rgb` 未定义 —— 这正是 round 1 修复的那处缺陷。
 *   - ④ 只覆盖 `--color-*` 与 `--*-rgb` 两个命名空间；`--z-*` / `--radius-*` 等非颜色 token 不在职责内。
 *
 * 明确的**非违规**（本测试有意不检测，理由见 `.superpowers/sdd/color-token-audit.md` §2/§3）：
 *   - 纯中性色：黑/白/等灰通道（`rgba(0,0,0,.25)` 阴影、`rgba(255,255,255,.15)` 内描边）与纯白/纯黑
 *     十六进制（`#fff`/`#000`）——「填充之上的前景 / 遮罩」常量，无主题语义；
 *   - `text-white` / `bg-black` / `bg-white` 等白黑关键字类（同上，设计系统原语自身就在用）。
 *
 * 维护约定：新增允许项 / 豁免项必须写明理由，并同步到审计报告；**不要**为了让测试变绿而放宽检测器。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

// ==================== 检测器 ====================

/** Tailwind 调色板工具类（前缀 × 22 个色系 × 明度刻度） */
const PALETTE_CLASS =
  /\b(?:bg|text|border|from|to|via|ring|fill|stroke|divide|outline|decoration|accent|caret|placeholder|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g

/** 字面十六进制色（3/4/6/8 位） */
const HEX = /#[0-9a-fA-F]{3,8}\b/g

/** 颜色函数名（参数用 `parenBody()` 平衡括号取出，正则不吃参数） */
const COLOR_FUNC = /\b(?:rgba?|hsla?)\(/g

/** CSS 变量引用（变量名同样用 `parenBody()` 取出，避免被内层逗号截断） */
const VAR_REF = /\bvar\(/g

/** 纯白 / 纯黑十六进制：与 `text-white` 同类的前景·遮罩常量 */
const NEUTRAL_HEX = /^#(?:f{3}|f{4}|f{6}|f{8}|0{3}|0{4}|0{6}|0{8})$/i

/** 合法静态 token 名（动态拼接名如 `--color-${tone}` 含 `${`，不匹配 → 自然排除） */
const TOKEN_NAME = /^--[a-zA-Z0-9_-]+$/

/**
 * 平衡括号扫描：给定全文与左括号下标，返回括号内文本（不含括号）；未闭合返回 null。
 * 这是「正则无法匹配嵌套括号」盲区的替代实现 ——
 * `rgba(var(--accent-rgb, 99, 102, 241), 0.03)` 里的逗号属于内层 `var()`，不能当外层分隔符。
 */
function parenBody(text: string, openIdx: number): string | null {
  let depth = 0
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return text.slice(openIdx + 1, i)
    }
  }
  return null
}

/**
 * 取出文本中所有颜色函数的实参 —— **显式字符扫描**，不是「正则 + 事后过滤」。
 *
 * 为什么不用正则 `matchAll`：`matchAll` 会把内层调用也当成一次匹配
 * （`rgba(var(--x-rgb), .1)` 里的 `rgba(` 与内层 `var(` 都会被扫到），
 * 而外层实参**含逗号**，一旦把内层匹配的实参当成外层来解析，外层的三个通道就会被切碎、漏判。
 * 这里的做法：从左到右扫字符，遇到函数名就整段跳过它的括号区间（`depth` 归零处），
 * 因此**每个字符最多被消费一次**，天然只返回最外层调用。
 */
function colorFuncsOf(text: string): { name: string; args: string }[] {
  const out: { name: string; args: string }[] = []
  let i = 0
  while (i < text.length) {
    COLOR_FUNC.lastIndex = i
    const m = COLOR_FUNC.exec(text)
    if (!m) break
    const openIdx = m.index + m[0].length - 1
    // 从这里开始配平括号，直到 depth 归零（找不到闭合就放弃本次匹配）
    let depth = 0
    let end = -1
    for (let j = openIdx; j < text.length; j++) {
      const ch = text[j]
      if (ch === '(') depth++
      else if (ch === ')') {
        depth--
        if (depth === 0) {
          end = j
          break
        }
      }
    }
    if (end < 0) break
    out.push({ name: m[0].slice(0, -1), args: text.slice(openIdx + 1, end) })
    i = end + 1 // 跳过整个调用，内层不再单独匹配
  }
  return out
}

/** 取出文本中所有 `var()` 的变量名（第一段，即逗号或右括号前） */
function varRefsOf(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(VAR_REF)) {
    const openIdx = m.index + m[0].length - 1
    const args = parenBody(text, openIdx)
    if (args === null) continue
    out.push(args.split(',')[0].trim())
  }
  return out
}

/** 取前三个通道值（越界返回空数组，交由调用方按「不透明色」处理） */
function channels(args: string): number[] {
  const nums = args.match(/\d+(?:\.\d+)?/g) ?? []
  if (nums.length < 3) return []
  return nums.slice(0, 3).map(Number)
}

/** 黑 / 白 / 等灰：无主题语义的中性色 */
function isNeutral(args: string): boolean {
  const ch = channels(args)
  return ch.length === 3 && ch.every((c) => c === ch[0])
}

/** 按**顶层**逗号切分实参（内层括号里的逗号不切）——`rgba(var(--x, 1, 2, 3), .1)` 必须切成 2 段 */
function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

/**
 * 颜色函数是否「通道来自 token」。
 *
 * 仓库的合规形态只有一种：`rgba(var(--color-x-rgb), α)` —— **第一个实参是 `var()` token 三元组**，
 * 之后的实参是 0–1 之间的 alpha。因此判定为「第一个顶层实参以 `var(` 开头」。
 *
 * 两个必须用平衡扫描才能做对的地方：
 *   - 实参切分用 `splitTopLevel`，否则 `rgba(var(--accent-rgb, 99, 102, 241), 0.03)`
 *     会被内层 `var()` 的兜底逗号切成 4 段，第 1 段变成 `102`，「第一个实参是 token」就丢了；
 *   - 判定只看**第一个**实参：`rgba(1, 2, 3)` / `rgba(239,68,68,0.15)` 首段是数字，照常判违规。
 */
function channelsAreTokens(args: string): boolean {
  const first = splitTopLevel(args)[0] ?? ''
  return CHANNELS_TOKEN_RE.test(first.trim())
}

/** 顶层 shared 变量，便于自检时打印 */
const CHANNELS_TOKEN_RE = /^var\(/

export type ColorViolation = {
  file: string
  line: number
  kind: 'palette-class' | 'hex' | 'color-func'
  match: string
}

export type TokenViolation = {
  file: string
  line: number
  /** 源码里写的变量名 */
  name: string
}

/**
 * 允许清单 —— 每条都必须有理由（对应审计报告 §2 例外 / §3 无 token 留待设计决策）。
 * 正则匹配**命中的色值文本**，不是整行，避免顺带放过同一行的其他违规。
 */
const ALLOW: { file: string; allow: RegExp; reason: string }[] = [
  {
    file: 'src/shared/draft-status.ts',
    allow: /#a78bfa/,
    reason: '紫色「已审稿」：无紫色 token，候选 --color-accent 会在 3 套主题下与 --color-info 重合、丢失区分度',
  },
  {
    file: 'src/components/editor/CodeMirrorEditor.tsx',
    allow: /purple-\d{3}/,
    reason: 'AI 动作 shrink 的紫色：同上，无紫色 token',
  },
  {
    file: 'src/components/editor/VersionHistory.tsx',
    allow: /purple-\d{3}/,
    reason: '版本类型 reviewed 的紫色：同上，无紫色 token',
  },
  {
    file: 'src/components/editor/three-way-merge.css',
    allow: /rgba\(100, ?116, ?139/,
    reason: 'pending 行的 4% 中性水洗底：换成不透明的 --color-hover 会变成肉眼可见色块（缺中性三元组 token）',
  },
  {
    file: 'src/components/editor/novel-editor.css',
    allow: /rgba\(99, ?102, ?241/,
    reason: 'CSS 变量 fallback 兜底值：4 套主题均已定义 --color-editor-selection，实际不生效',
  },
  {
    file: 'src/components/pages/WelcomePage.tsx',
    allow: /rgba\(201, ?167, ?108/,
    reason: '星辰金 40%/8% 透明度：--color-gold 存在但缺 --color-gold-rgb 三元组',
  },
  {
    file: 'src/components/layout/ProjectSquareList.tsx',
    allow: /hsl\(/,
    reason: '项目方块哈希取色（8 色相均匀分布）：颜色是数据，不是 UI chrome',
  },
]

/**
 * **token 存在性豁免清单** —— 源码引用了 `src/index.css` 未定义的 token。
 *
 * 逐条记账（不静默）：这些引用**没有 fallback**，声明在 computed-value time 失效 → 该 longhand 取初始值，
 * `background-color` 即 `transparent`。**今天就是「没有底色」**；随便挑一个有值的 token 顶上会把
 * 「隐形面」变成可见色块 —— 属视觉变更，需产品决策后另行处理。
 * 每一行末尾的 `FOLLOW-UP` 是待决策标记，决策落地时**必须**删除对应豁免项。
 */
const UNDEFINED_TOKEN_EXEMPT: { name: string; count: number; reason: string }[] = [
  {
    name: '--color-bg-elevated',
    count: 13,
    reason: 'FOLLOW-UP(待决策): 未定义且无 fallback → 底色实际 transparent。顶上真实 token 会把隐形面变可见色块，属视觉变更',
  },
  {
    name: '--color-bg-secondary',
    count: 2,
    reason: 'FOLLOW-UP(待决策): 同上（AgentConversation 内置提示条 / CompressedBatchCard 底），勿机械替换',
  },
  {
    name: '--color-bg-hover',
    count: 2,
    reason: 'FOLLOW-UP(待决策): 同上（CompressedBatchCard / ContextBudgetBar 底）；与既有 --color-hover 是否语义等同需产品确认',
  },
  {
    name: '--color-input',
    count: 1,
    reason: 'FOLLOW-UP(待决策): 同上（ImportNovelDialog 输入框底）。--color-panel/--color-bg 都不是「输入面」语义',
  },
]

/** 豁免名单只按**名字**豁免（不影响其他任何未定义引用） */
const EXEMPT_TOKEN_NAMES = new Set(UNDEFINED_TOKEN_EXEMPT.map((e) => e.name))

/**
 * 扫描范围排除：
 *   - 测试 / stories / mock：任务与审计均认定为例外；
 *   - `src/index.css`：**token 定义表**（4 套主题块的 `--color-*: #hex` 正是十六进制该在的地方）；
 *   - `src/tokens/index.ts`：由 `scripts/extract-tokens.cjs` 从 index.css 自动生成，属同一 token 定义面；
 *   - `src/services/share-card.ts` / `yearly-report.ts`：生成**独立 HTML 文档**（离屏渲染成图），
 *     不继承应用主题，色值是产物自身的视觉规格。
 */
const SKIP = [
  /(^|\/)[^/]*\.test\.tsx?$/,
  /(^|\/)[^/]*\.stories\.tsx?$/,
  /(^|\/)__mocks__\//,
  /^src\/stories\//,
  /^src\/index\.css$/,
  /^src\/tokens\/index\.ts$/,
  /^src\/services\/(?:share-card|yearly-report)\.ts$/,
]

/** 收集 src/ 下参与扫描的源文件（相对仓库根的 POSIX 路径） */
function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      collectFiles(full, out)
    } else if (/\.(?:tsx?|css)$/.test(entry.name)) {
      const rel = path.relative(ROOT, full).replace(/\\/g, '/')
      if (!SKIP.some((re) => re.test(rel))) out.push(rel)
    }
  }
  return out
}

/**
 * 去掉注释，**保留行号**（注释里的历史色值说明不是代码，别误报）。
 * 与 ipc-channel-parity.test.ts 同款处理，额外把块注释逐字符换成空格以保住换行。
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    // 负向前置避免吃掉 `http://` 这类 URL
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** 扫描单个文件文本（导出以便自检：合成样本必须被抓到 / 合规写法不得误报） */
export function scanSource(rel: string, raw: string): ColorViolation[] {
  const text = stripComments(raw)
  const allows = ALLOW.filter((a) => a.file === rel).map((a) => a.allow)
  const allowed = (match: string) => allows.some((re) => re.test(match))
  const found: ColorViolation[] = []

  text.split('\n').forEach((line, i) => {
    const push = (kind: ColorViolation['kind'], match: string) => {
      if (!allowed(match)) found.push({ file: rel, line: i + 1, kind, match })
    }
    for (const m of line.matchAll(PALETTE_CLASS)) push('palette-class', m[0])
    for (const m of line.matchAll(HEX)) {
      if (!NEUTRAL_HEX.test(m[0])) push('hex', m[0])
    }
    for (const { name, args } of colorFuncsOf(line)) {
      // 第一个实参是 token（`rgba(var(--color-x-rgb), α)`）→ 合规
      // 名字是否存在由「token 存在性」断言负责，这一层只看形状
      if (channelsAreTokens(args)) continue
      if (isNeutral(args)) continue
      push('color-func', `${name}(${args})`)
    }
  })

  return found
}

/** `src/index.css` 里定义的全部 token 名（canonical 集合，供存在性校验） */
export function definedTokens(css: string): Set<string> {
  const out = new Set<string>()
  for (const m of css.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)) out.add(m[1])
  return out
}

/** 非颜色 token（`--z-*` / `--radius-*` …）不属本守卫职责；本守卫只查颜色命名空间 */
function isColorRefName(name: string): boolean {
  return name.startsWith('--color-') || name.endsWith('-rgb')
}

/**
 * token 存在性扫描（导出以便自检）。排除项：
 *   - 动态拼接名（`var(--color-${tone})`，如 `KnowledgeOverview.tsx` 的 badgeTone）：第一段含 `${`，
 *     不满足 `TOKEN_NAME` → 自然排除（此处显式说明，避免被当成漏检）；
 *   - Radix 运行时注入的 `--radix-*`（`Select.tsx` / `SettingsModal.tsx` 的 `--radix-select-trigger-*`）；
 *   - `UNDEFINED_TOKEN_EXEMPT` 里逐条记账的既有豁免（`ignoreExempt` 打开时）。
 */
export function scanUndefinedTokens(
  rel: string,
  raw: string,
  defined: ReadonlySet<string>,
  ignoreExempt = true,
): TokenViolation[] {
  const found: TokenViolation[] = []
  stripComments(raw)
    .split('\n')
    .forEach((line, i) => {
      for (const name of varRefsOf(line)) {
        if (!TOKEN_NAME.test(name)) continue // 动态拼接 / 非法名：无静态解
        if (!isColorRefName(name)) continue // 非颜色 token
        if (name.startsWith('--radix-')) continue // Radix 运行时注入
        if (defined.has(name)) continue
        if (ignoreExempt && EXEMPT_TOKEN_NAMES.has(name)) continue
        found.push({ file: rel, line: i + 1, name })
      }
    })
  return found
}

function scanRepo(): ColorViolation[] {
  const out: ColorViolation[] = []
  for (const rel of collectFiles(path.join(ROOT, 'src'))) {
    out.push(...scanSource(rel, fs.readFileSync(path.join(ROOT, rel), 'utf-8')))
  }
  return out
}

/** 读取 `src/index.css` 的 token 定义集合 */
function repoDefinedTokens(): Set<string> {
  return definedTokens(fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf-8'))
}

/** 全量 token 存在性扫描；`ignoreExempt=false` 时不套豁免（用于校验豁免清单不腐化） */
function scanRepoUndefinedTokens(ignoreExempt = true): TokenViolation[] {
  const defined = repoDefinedTokens()
  const out: TokenViolation[] = []
  for (const rel of collectFiles(path.join(ROOT, 'src'))) {
    out.push(
      ...scanUndefinedTokens(rel, fs.readFileSync(path.join(ROOT, rel), 'utf-8'), defined, ignoreExempt),
    )
  }
  return out
}

/** 按 token 名聚合计数 */
function countByName(violations: TokenViolation[]): Map<string, number> {
  const byName = new Map<string, number>()
  for (const v of violations) byName.set(v.name, (byName.get(v.name) ?? 0) + 1)
  return byName
}

// ==================== 断言 ====================

describe('颜色 token 守卫（AGENTS.md：颜色只用 CSS 变量）', () => {
  it('检测器自身有效：合成违规必须被抓到，合规写法不得误报', () => {
    const hit = (s: string) => scanSource('synthetic.tsx', s)
    // 违规
    expect(hit('<div className="bg-red-500" />')).toHaveLength(1)
    expect(hit('<div className="hover:bg-amber-500/20" />')).toHaveLength(1)
    expect(hit("<div style={{ color: '#22c55e' }} />")).toHaveLength(1)
    expect(hit("backgroundColor: 'rgba(239,68,68,0.15)'")).toHaveLength(1)
    expect(hit("borderColor: 'hsl(20 90% 50%)'")).toHaveLength(1)
    // **嵌套括号**（旧正则 `([^()]*)` 整条匹配不到的那类写法）：
    // ③ 只看「第一个实参是不是 `var(`」，因此这两种写法 ③ **不报**（合规）；
    // 旧守卫是连扫都扫不到、静默放过，现在的区别是「扫到了、按规则放行」。
    // 其中 `--accent-rgb` 这种**名字不存在**的写法由 ④ 负责（见下一组断言），职责不重叠。
    expect(hit("backgroundColor: 'rgba(var(--accent-rgb, 99, 102, 241), 0.03)'")).toHaveLength(0)
    expect(hit("backgroundColor: 'rgb(var(--color-bg-rgb, 10, 22, 40))'")).toHaveLength(0)
    // 但括号内的**字面通道**仍然要抓：第一个实参不是 var(...)
    expect(hit("backgroundColor: 'rgba(239, 68, 68, 0.15)'")).toHaveLength(1)
    expect(hit("backgroundColor: 'rgba(239, 68, 68, 0.15)'")).toHaveLength(1)
    expect(hit("backgroundColor: 'rgb(10, 22, 40)'")).toHaveLength(1)
    // 合规
    expect(hit("style={{ color: 'var(--color-error)' }}")).toHaveLength(0)
    expect(hit("backgroundColor: 'rgba(var(--color-error-rgb), 0.15)'")).toHaveLength(0)
    expect(hit("backgroundColor: 'rgba(var(--color-accent-rgb), 0.10)'")).toHaveLength(0)
    expect(hit('boxShadow: "0 8px 24px rgba(0,0,0,0.25)"')).toHaveLength(0)
    expect(hit("color: 'rgba(255,255,255,0.15)'")).toHaveLength(0)
    expect(hit('style={{ color: "#fff" }}')).toHaveLength(0)
    expect(hit('<div className="text-white bg-black/20" />')).toHaveLength(0)
    // 注释里的历史说明不算违规（且不得影响行号）
    expect(hit('// 原为 bg-amber-500/15 + rgba(245,158,11,.06)，已改为 token')).toHaveLength(0)
    expect(hit('/* #22c55e */\nconst x = 1')).toHaveLength(0)
    expect(hit('// 注释\n<div className="text-green-400" />')[0]?.line).toBe(2)
  })

  it('src/ 全量扫描：无硬编码色（允许清单除外）', () => {
    const violations = scanRepo()
    const report = violations
      .map((v) => `  ${v.file}:${v.line}  [${v.kind}] ${v.match}`)
      .join('\n')
    expect(violations, `发现硬编码颜色：\n${report}`).toEqual([])
  })

  it('扫描范围健全：确实扫到了 src/ 的源文件（防止路径写错导致空跑）', () => {
    const files = collectFiles(path.join(ROOT, 'src'))
    expect(files.length).toBeGreaterThan(200)
    expect(files.some((f) => f.startsWith('src/components/editor/'))).toBe(true)
    // token 定义表与生成物必须在扫描范围之外（否则下面的全量断言永远红）
    expect(files).not.toContain('src/index.css')
    expect(files).not.toContain('src/tokens/index.ts')
  })

  it('token 存在性检测器自身有效：未定义 token 必须被抓到，动态/Radix/非颜色引用不得误报', () => {
    const defined = new Set(['--color-accent', '--color-accent-rgb', '--color-hover', '--z-modal'])
    // ignoreExempt=false：合成样本要看检测器本身，不受 UNDEFINED_TOKEN_EXEMPT 影响
    const hit = (s: string) => scanUndefinedTokens('synthetic.tsx', s, defined, false)
    // 未定义 → 违规（含「语法上合法但根本不存在」与「带兜底值的活兜底」两种写法）
    expect(hit("backgroundColor: 'var(--color-bg-elevated)'")).toHaveLength(1)
    expect(hit("backgroundColor: 'rgba(var(--accent-rgb, 99, 102, 241), 0.03)'")).toHaveLength(1)
    expect(hit("backgroundColor: 'rgba(var(--accent-rgb, 99, 102, 241), 0.03)'")[0]?.name).toBe(
      '--accent-rgb',
    )
    expect(hit("color: 'var(--color-nope-rgb)'")).toHaveLength(1)
    expect(hit("color: 'var(--color-nope-rgb)'")[0]?.line).toBe(1)
    // 已定义 → 合规
    expect(hit("backgroundColor: 'rgba(var(--color-accent-rgb), 0.1)'")).toHaveLength(0)
    expect(hit("color: 'var(--color-accent, #5B9ED6)'")).toHaveLength(0)
    // 动态拼接名（badgeTone 式）：第一段是 `--color-${tone}`，无从静态校验 → 不报
    expect(hit('color: `var(--color-${badgeTone})`')).toHaveLength(0)
    expect(hit('backgroundColor: `rgba(var(--color-${badgeTone}-rgb), 0.14)`')).toHaveLength(0)
    // Radix 运行时注入
    expect(hit('className="w-[var(--radix-select-trigger-width)]"')).toHaveLength(0)
    // 非颜色 token 不在本守卫职责内
    expect(hit("zIndex: 'var(--z-toast)'")).toHaveLength(0)
    // 注释里的引用不算
    expect(hit('// 原为 var(--color-bg-elevated)')).toHaveLength(0)
    // 行号准确
    expect(hit("// 注释\ncolor: 'var(--color-nope)'")[0]?.line).toBe(2)
  })

  it('src/ 全量扫描：var(--color-*) / var(--*-rgb) 引用都能在 index.css 找到定义（豁免清单除外）', () => {
    const violations = scanRepoUndefinedTokens()
    const report = violations.map((v) => `  ${v.file}:${v.line}  ${v.name}`).join('\n')
    expect(violations, `引用了未定义的 token：\n${report}`).toEqual([])
  })

  it('token 存在性豁免清单不腐化：每条豁免仍在源码中出现，数量与记账一致，且清单外无未定义引用', () => {
    // 不套豁免重扫：既校验「豁免项还在」，也校验「没有清单外的新增未定义引用」
    const byName = countByName(scanRepoUndefinedTokens(false))

    for (const [name, count] of byName) {
      const exempt = UNDEFINED_TOKEN_EXEMPT.find((e) => e.name === name)
      expect(
        exempt,
        `未定义 token ${name}（${count} 处）不在 UNDEFINED_TOKEN_EXEMPT 里 —— ` +
          `要么修好它，要么补一条带理由的豁免`,
      ).toBeDefined()
      expect(
        count,
        `豁免项 ${name} 的数量变了（源码 ${count}，记账 ${exempt?.count}）—— 请更新豁免清单与报告`,
      ).toBe(exempt?.count)
    }
    // 反向：记账的豁免项不能已经消失（否则是过期豁免，掩盖真实修复）
    for (const exempt of UNDEFINED_TOKEN_EXEMPT) {
      expect(
        byName.get(exempt.name) ?? 0,
        `豁免项 ${exempt.name} 在源码里已不存在（记账 ${exempt.count}）——` +
          `已修好就从 UNDEFINED_TOKEN_EXEMPT 删除并更新报告`,
      ).toBe(exempt.count)
    }
  })
})

export { UNDEFINED_TOKEN_EXEMPT }
