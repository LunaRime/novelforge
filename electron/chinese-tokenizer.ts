/**
 * 中文分词封装（L3 T1）——jieba-wasm **惰性加载 + 失败降级**（L3 final review / IMP-3）
 *
 * ⚠️ 为什么不能用静态 import：`jieba-wasm` 的 nodejs target 在**模块求值期**同步读盘——
 *   `pkg/nodejs/jieba_rs_wasm.js:332-333` 是 `require('fs').readFileSync(join(__dirname, 'jieba_rs_wasm_bg.wasm'))`。
 *   静态 `import { cut } from 'jieba-wasm'` 把这次读盘提前到**本模块加载期**：只要 .wasm 未随包
 *   （asar/files 白名单配错、__dirname 位移），Electron 主进程**启动即崩**；而本模块内所有 try/catch
 *   都在模块求值之后，捕不到加载期失败 —— 设计 §3.1「分词器不可用 → 退回 LIKE」的降级根本不成立。
 *
 * 现形态：首次调用时惰性 require + try/catch + 缓存。加载失败 → `tokenize` 返回 `[]`、
 *   `tokenizeToSpaceSeparated` 返回 `''`（**降级而非崩溃**），只 warn 一次；调用方据此退回逐字 LIKE。
 *
 * 导出签名不变：`tokenize(text): string[]` / `tokenizeToSpaceSeparated(text): string`。
 */
import { createRequire } from 'node:module'
import { logger } from './utils/logger'
import { safeErrorMessage } from './utils/error-utils'

/** jieba-wasm 对外只用到 cut（`cut(text, true)` = 精确模式，返回词数组） */
export interface JiebaModule {
  cut: (text: string, hmm?: boolean) => string[]
}

/**
 * 真实加载器：CJS（Electron 主进程打包产物）下 `require` 直接可用；
 * ESM（vitest / vite-node 等无 require 的环境）下用 `createRequire(import.meta.url)` 保持**同步**语义
 * （动态 import 是异步的，而 tokenize 的签名是同步的）。
 * 分支惰性求值：CJS 下不会触碰 import.meta.url。
 *
 * ⚠️ 定向构建实证（rolldown 1.0.0-rc.15，CJS 产物）：`import.meta` 会被降级为 `{}`，
 *   即 `createRequire({}.url)` → 该分支在 CJS 下**必然**不可用。因此本函数在 CJS 恒走 `require`
 *   分支；万一两条路都不可用，抛错由 loadJiebaModule 的 try/catch 接住 → 降级为空词表，
 *   **不会**让主进程崩溃（这正是 IMP-3 要保证的语义）。
 */
function defaultJiebaLoader(): JiebaModule {
  const req: NodeRequire = typeof require === 'function'
    ? require
    : createRequire(import.meta.url)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = req('jieba-wasm') as Partial<JiebaModule> | null | undefined
  if (!mod || typeof mod.cut !== 'function') {
    throw new Error('jieba-wasm: cut() 未导出（模块形态不符）')
  }
  return mod as JiebaModule
}

/** 当前加载器（测试可替换，见 setJiebaLoaderForTest） */
let jiebaLoader: () => JiebaModule = defaultJiebaLoader
let jiebaModule: JiebaModule | null = null
let jiebaLoadFailed = false
let loadFailureLogged = false
let cutFailureLogged = false

/**
 * 惰性加载 + 缓存 jieba 模块。失败（.wasm 读盘失败 / 模块形态不符）→ 返回 null，
 * 且**只告警一次**；失败结果同样缓存，避免每次分词都重试一次磁盘 IO。
 */
export function loadJiebaModule(): JiebaModule | null {
  if (jiebaModule) return jiebaModule
  if (jiebaLoadFailed) return null
  try {
    jiebaModule = jiebaLoader()
    return jiebaModule
  } catch (e) {
    jiebaLoadFailed = true
    if (!loadFailureLogged) {
      loadFailureLogged = true
      logger.warn('ChineseTokenizer', `jieba-wasm 加载失败，分词降级（检索/回填退回逐字 LIKE）: ${safeErrorMessage(e)}`)
    }
    return null
  }
}

/**
 * 测试注入：替换加载器并清空加载缓存（传 null 恢复真实加载器）。
 * 用途：模拟「.wasm 读盘失败」与「首次调用才加载」，生产路径不需要调用。
 * 注意：只清模块/失败缓存，不清「只告警一次」标志——那是进程级语义。
 */
export function setJiebaLoaderForTest(loader: (() => JiebaModule) | null): void {
  jiebaLoader = loader ?? defaultJiebaLoader
  jiebaModule = null
  jiebaLoadFailed = false
}

/** 中文分词（精确模式）：分词器不可用或分词抛错 → 返回空数组（降级，不抛） */
export function tokenize(text: string): string[] {
  if (!text || !text.trim()) return []
  const jieba = loadJiebaModule()
  if (!jieba) return []
  try {
    return jieba.cut(text, true).filter(w => w && w.trim() !== '')
  } catch (e) {
    if (!cutFailureLogged) {
      cutFailureLogged = true
      logger.warn('ChineseTokenizer', `jieba cut 失败，本次分词降级为空: ${safeErrorMessage(e)}`)
    }
    return []
  }
}

export function tokenizeToSpaceSeparated(text: string): string {
  return tokenize(text).join(' ')
}
