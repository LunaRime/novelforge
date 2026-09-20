/**
 * 颜色 token 守卫测试 — AGENTS.md 核心约束「颜色：CSS 变量，禁止硬编码」
 *
 * 与 `ipc-channel-parity.test.ts` 同族：**源码文本扫描**型策略守卫（不 import 任何业务模块）。
 * 零新增依赖（只用 node:fs / node:path + vitest），不引入 ESLint 规则。
 *
 * 扫描 `src/**` 的三类硬编码色：
 *   ① Tailwind 调色板工具类：`bg-amber-500`、`text-green-400`、`border-red-500/20`（`/opacity` 修饰形式
 *      命中同一处类名主干，不重复计数）；
 *   ② 字面十六进制色：`#22c55e`；
 *   ③ 字面 `rgb()/rgba()/hsl()` 调用 —— 但 `rgba(var(--color-x-rgb), α)` 通道来自 token，视为合规。
 *
 * 明确的**非违规**（本测试有意不检测，理由见 `.superpowers/sdd/color-token-audit.md` §2/§3）：
 *   - 纯中性色：黑/白/等灰通道（`rgba(0,0,0,.25)` 阴影、`rgba(255,255,255,.15)` 内描边）与纯白/纯黑
 *     十六进制（`#fff`/`#000`）——「填充之上的前景 / 遮罩」常量，无主题语义；
 *   - `text-white` / `bg-black` / `bg-white` 等白黑关键字类（同上，设计系统原语自身就在用）。
 *
 * 维护约定：新增允许项必须写明理由，并同步到审计报告；**不要**为了让测试变绿而放宽检测器。
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

/** 字面 rgb()/rgba()/hsl()/hsla() */
const FUNC = /\b(rgba?|hsla?)\(([^()]*)\)/g

/** 纯白 / 纯黑十六进制：与 `text-white` 同类的前景·遮罩常量 */
const NEUTRAL_HEX = /^#(?:f{3}|f{4}|f{6}|f{8}|0{3}|0{4}|0{6}|0{8})$/i

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

export type ColorViolation = {
  file: string
  line: number
  kind: 'palette-class' | 'hex' | 'color-func'
  match: string
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
    for (const m of line.matchAll(FUNC)) {
      const args = m[2]
      // 通道来自 token 三元组 → 合规
      if (/^\s*var\(/.test(args.split(',').slice(0, 3).join(','))) continue
      if (isNeutral(args)) continue
      push('color-func', m[0])
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
    // 合规
    expect(hit("style={{ color: 'var(--color-error)' }}")).toHaveLength(0)
    expect(hit("backgroundColor: 'rgba(var(--color-error-rgb), 0.15)'")).toHaveLength(0)
    expect(hit("backgroundColor: 'rgba(var(--color-accent-rgb,99 102 241),0.1)'")).toHaveLength(0)
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
})
