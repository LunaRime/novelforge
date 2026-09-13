/**
 * IPC 通道对账测试（L4 设计 §6 第 1 类；S1 阶段）
 *
 * ⚠️ 本测试**不 import electron、不 import ipc-channels 的运行时值** —— 全部靠源码文本扫描：
 *   - `src/shared/ipc-channels.ts` 是纯类型文件（零运行时导出），无法在运行时枚举通道集合；
 *   - 项目 CI 没有 electron 二进制（见 .agents/skills/ci-parity-standard），任何 import electron
 *     的测试都必须打桩，而在打桩环境里断言「真实注册集合」是没有意义的。
 * 因此这里用「源码 ↔ 源码」对账：正则扫主进程的 `ipcMain.handle('x:y')` 与类型文件的通道声明键。
 *
 * 断言（双向，合起来 = 「声明的 invoke 集合 === 注册的 invoke 集合」）：
 *   ① 已注册的每个通道都有类型声明；
 *   ② 声明的每个通道，要么被注册（invoke），要么在 EVENT_CHANNELS 显式列名（主→渲染事件）；
 *   ③ 事件通道不得被注册成 handler（防止方向搞反）；
 *   ④ 通道总数快照（防无声增删）；
 *   ⑤ 策略表（`IPC_CHANNEL_POLICY`）与已注册集合双向一致 —— 与 `Record<InvokeChannel, ChannelPolicy>`
 *      的编译期约束互为双重保障（编译期防漏登记，运行期防「类型被放宽成 Record<string,…>」）。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { IPC_CHANNEL_POLICY, IPC_EVENT_CHANNELS } from './ipc-policy'

/**
 * 主→渲染事件通道（由 `webContents.send` 发出，不走 `ipcMain.handle`，不进策略表）。
 * L4 S7：改为引用 `IPC_EVENT_CHANNELS` 这一**运行时单一真源**（preload 的 event 前缀也由它派生），
 * 不再在本测试里另存一份——否则本文件自己就成了一处会漂移的白名单。
 */
const EVENT_CHANNELS: readonly string[] = IPC_EVENT_CHANNELS

const ROOT = process.cwd()

function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-electron') continue
      collectTsFiles(full, out)
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full)
    }
  }
  return out
}

/** 去掉注释：文档示例里出现的 `ipcMain.handle('x:y')` 不是真实注册，不能计入 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // 负向前置避免吃掉 `http://` 这类 URL
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/**
 * 扫描主进程实际注册的 invoke 通道。
 * - 正则用 `\s*` 跨行匹配，覆盖 `ipcMain.handle(\n  'embedding:compare',` 这类多行写法
 *   （行级扫描会漏掉它们——本测试存在的直接原因之一）。
 * - **迁移期必须同时扫两种注册形式**：S4 之前多数通道是裸 `ipcMain.handle`，
 *   收口后逐个变成 `guardedHandle`。只扫一种会让「已迁移的通道」被误判成幽灵声明。
 */
function scanRegisteredChannels(): Map<string, string> {
  const registered = new Map<string, string>()
  const re = /(?:ipcMain\.handle|guardedHandle)\(\s*'([^']+)'/g
  for (const file of collectTsFiles(path.join(ROOT, 'electron'))) {
    const src = stripComments(fs.readFileSync(file, 'utf-8'))
    for (const m of src.matchAll(re)) {
      registered.set(m[1], path.relative(ROOT, file).replace(/\\/g, '/'))
    }
  }
  return registered
}

/** 扫描 `src/shared/ipc-channels.ts` 里声明的通道键（invoke + event 混装） */
function scanDeclaredChannels(): Set<string> {
  const src = fs.readFileSync(path.join(ROOT, 'src/shared/ipc-channels.ts'), 'utf-8')
  const declared = new Set<string>()
  for (const m of src.matchAll(/^\s*'([a-z][a-z0-9-]*:[a-z0-9-]+)'\s*:/gm)) {
    declared.add(m[1])
  }
  return declared
}

const registered = scanRegisteredChannels()
const declared = scanDeclaredChannels()

describe('IPC 通道对账（L4 §6 第 1 类）', () => {
  it('① 已注册的 invoke 通道都有类型声明', () => {
    const missing = [...registered.keys()].filter(c => !declared.has(c))
    expect(missing, '以下通道已注册但未在 src/shared/ipc-channels.ts 声明').toEqual([])
  })

  it('② 声明的通道要么被注册，要么是显式列名的事件通道', () => {
    const orphan = [...declared].filter(c => !registered.has(c) && !EVENT_CHANNELS.includes(c))
    expect(orphan, '以下通道有声明但既未注册也非事件通道（幽灵声明）').toEqual([])
  })

  it('③ 事件通道不得被注册成 handler', () => {
    const wrongDirection = EVENT_CHANNELS.filter(c => registered.has(c))
    expect(wrongDirection, '以下通道是主→渲染事件，却被注册成了 handler').toEqual([])
  })

  it('④ 通道数量快照（防无声增删；新增通道时同步更新）', () => {
    expect(registered.size).toBe(200)
    expect(declared.size).toBe(207) // 200 invoke + 7 event
  })

  it('⑤ 策略表与已注册集合双向一致', () => {
    const policyKeys = new Set(Object.keys(IPC_CHANNEL_POLICY))
    expect([...registered.keys()].filter(c => !policyKeys.has(c)), '已注册但策略表未登记').toEqual([])
    expect([...policyKeys].filter(c => !registered.has(c)), '策略表登记了未注册的通道').toEqual([])
    expect(policyKeys.size).toBe(200)
  })

  it('⑥ 事件通道清单 === 声明中「非注册」的那部分（运行时清单与类型侧双向一致）', () => {
    const declaredNotRegistered = [...declared].filter(c => !registered.has(c)).sort()
    expect(declaredNotRegistered, 'IPC_EVENT_CHANNELS 与 ipc-channels.ts 的声明不一致').toEqual(
      [...IPC_EVENT_CHANNELS].sort(),
    )
  })
})
