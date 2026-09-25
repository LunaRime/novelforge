/**
 * i18n key 守卫测试 — 代码里 t(字面量) 引用的每个 key 必须存在于字典。
 *
 * 与 `color-token-guard.test.ts` / `ipc-channel-parity.test.ts` 同族：**源码文本扫描**型策略守卫
 * （不 import 任何业务模块，零新增依赖，只用 node:fs / node:path + vitest）。
 *
 * **为什么需要**：`t()` 在 key 不存在时**静默回落为 key 字面量本身**（`locale.test.ts` 有断言），
 * 所以「删掉一个仍在用的 key」不会报错——用户界面会直接显示 `blueprint.openProjectFirst`
 * 这样的内部标识；若该 key 走的是 `inject.*`（注入 LLM prompt 的通道），
 * 这串英文还会被原样喂给模型。
 *
 * 2026-09-25 UI 审计批次 4 收尾时新增：当时审计清单把 3 个**实际共有 46 处调用**的 key
 * （`error.noProject` 41 处、`guard.noProject` 5 处）误判为「零引用键」，差一步就按清单删掉。
 * 人工 grep 复核拦下了它，这个守卫就是那次复核的固化。
 *
 * ⚠️ **已知盲区（刻意保留，不要当成已覆盖）**：
 *   - **只查「用了但字典没有」一个方向**。不做反向的「字典有但零引用」检测：
 *     动态 key（`t(labelKey)`，labelKey 取自 const 数组）会让反向检测大量误报，
 *     `locale-data.ts` 里 3290 个 key 中约 580 个查不到字面量引用，绝大多数是动态 key。
 *     死 key 的清理仍需人工 `grep` 复核。
 *   - **不覆盖动态 key**：`t(variable)` 与模板串形式一律跳过（无法静态判定取值）。
 *   - **不解析语义**：注释里出现的同形文本会被 `stripComments()` 剥掉，
 *     但**字符串常量**中形如 t 加括号加引号的文本仍会被当成调用（当前全仓无此写法）。
 *   - 只覆盖 `t()` 这一个入口。`renderLog()` 收的是**已翻译字符串**（`renderLog(level, source, t(key))`），
 *     故其 key 已被本守卫覆盖；但若将来出现新的「收 key 再内部翻译」的封装，需一并纳入。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { UI_TEXTS_DATA } from './locale-data'

const ROOT = process.cwd()
const SCAN_DIRS = ['src', 'electron']

/** 扫描覆盖面下限：只为捕捉「扫描器失效后静默变绿」，不随代码增减调整 */
const MIN_FILES = 200
const MIN_KEYS = 1000

/**
 * 有意引用不存在 key 的用例。`locale.test.ts` 用 `nonexistent.key` 验证
 * t() 对未知 key 的回落行为（返回 key 本身），属预期，不算违规。
 */
const INTENTIONAL_MISSING = new Set(['nonexistent.key'])

/**
 * t(）调用，捕获字面量 key。前导字符类排除 `\w` 与 `.`——
 * 前者避免匹配 `format(` 之类的词尾，后者避免匹配 `obj.t(`。
 * 跳过变量实参与模板串（含引号以外的字符即不匹配）。
 */
const T_CALL = /(^|[^\w$.])t\(\s*(['"])([^'"\n\\]+)\2/g

/** 收集待扫描文件（相对 ROOT 的 POSIX 路径） */
function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      collectFiles(full, out)
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(path.relative(ROOT, full).replace(/\\/g, '/'))
    }
  }
  return out
}

/**
 * 去掉注释，**保留行号**（注释里举例说明的 key 名不是代码，别误报）。
 * 与 `color-token-guard.test.ts` 同款处理：块注释逐字符换成空格以保住换行，
 * 行注释用负向前置避免吃掉 `https://` 这类 URL。
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

interface ScanResult {
  files: string[]
  /** 命中条目：`key ← 路径:行号` */
  violations: string[]
  /** 引用到的字面量 key 总数（去重前） */
  references: number
}

function scan(): ScanResult {
  const files = SCAN_DIRS.flatMap((dir) => collectFiles(path.join(ROOT, dir)))
  const violations: string[] = []
  let references = 0

  for (const rel of files) {
    const src = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
    for (const m of src.matchAll(T_CALL)) {
      const key = m[3]
      references++
      if (key in UI_TEXTS_DATA || INTENTIONAL_MISSING.has(key)) continue
      const line = src.slice(0, m.index).split('\n').length
      violations.push(`${key}  ←  ${rel}:${line}`)
    }
  }

  return { files, violations, references }
}

describe('i18n key 守卫', () => {
  const { files, violations, references } = scan()

  it('扫描覆盖面正常（防止扫描器失效后静默变绿）', () => {
    expect(files.length).toBeGreaterThan(MIN_FILES)
    expect(references).toBeGreaterThan(MIN_KEYS)
  })

  it('代码中 t() 引用的每个 key 都存在于字典', () => {
    // 失败时会列出全部「key ← 调用点」，可直接照单修
    expect(violations).toEqual([])
  })
})
