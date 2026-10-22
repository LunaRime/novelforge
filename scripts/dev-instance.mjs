#!/usr/bin/env node
/* eslint-env node */
/**
 * NovelForge 隔离实例 CLI
 *
 * 用法：
 *   node scripts/dev-instance.mjs start [--project <path>] [--port <n>] [--name <label>] [--json]
 *   node scripts/dev-instance.mjs list [--json]
 *   node scripts/dev-instance.mjs stop <id>
 *   node scripts/dev-instance.mjs clean <id> --yes
 *   node scripts/dev-instance.mjs logs <id> [lines]
 *   node scripts/dev-instance.mjs dir <id>
 *   node scripts/dev-instance.mjs eval <id> <js>
 *   node scripts/dev-instance.mjs shot <id> <png>
 *   node scripts/dev-instance.mjs console <id> [ms]
 *
 * 实例数据全部在 ~/.novelforge/dev-instances/<id>/，不写入项目仓库。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  parseArgs, buildInstanceId, sanitizeName, isPidAlive,
  readManifests, pickFreePort, isPortFree, buildChildEnv, isOwnedProcessCommand,
  getCdpPage, openCdp,
} from './dev-instance-lib.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const instancesRoot = process.env.NOVELFORGE_DEV_INSTANCES_ROOT
  || path.join(os.homedir(), '.novelforge', 'dev-instances')
const require = createRequire(import.meta.url)

function electronBinary() {
  if (process.env.NOVELFORGE_ELECTRON_BIN) return process.env.NOVELFORGE_ELECTRON_BIN
  if (process.env.ELECTRON_BIN) return process.env.ELECTRON_BIN
  try {
    const resolved = require('electron')
    if (typeof resolved === 'string' && fs.existsSync(resolved)) return resolved
  } catch { /* fall through */ }
  return path.join(repoRoot, 'node_modules', '.bin', 'electron')
}

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }) }
function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}
function writeJson(file, value) {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
}
function copyIfExists(src, dst) {
  if (!fs.existsSync(src)) return
  fs.cpSync(src, dst, { recursive: true, force: true })
}
function instanceDir(id) { return path.join(instancesRoot, id) }
function manifestPath(id) { return path.join(instanceDir(id), 'manifest.json') }
function readManifest(id) {
  const m = readJson(manifestPath(id))
  if (!m) throw new Error(`instance not found: ${id}`)
  return m
}
function listInstances() {
  return readManifests(instancesRoot)
    .map((m) => ({ ...m, alive: isPidAlive(m.pid) }))
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

function killTree(pid, signal = 'SIGTERM') {
  if (!Number.isInteger(pid) || pid <= 0) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  try { process.kill(-pid, signal) } catch {
    try { process.kill(pid, signal) } catch { /* already gone */ }
  }
}

async function start(options) {
  const projectArg = options.project ? path.resolve(String(options.project)) : null
  if (projectArg && !fs.existsSync(projectArg)) throw new Error(`project not found: ${projectArg}`)
  // --dev-console 且未指定项目：只开开发者控制台，不创建/打开项目
  const consoleOnly = Boolean(options['dev-console']) && !projectArg
  let port
  if (Number.isInteger(options.port)) {
    port = options.port
    if (!(await isPortFree(port))) throw new Error(`port ${port} is already in use`)
  } else {
    port = await pickFreePort(9223)
  }
  const label = options.name ? sanitizeName(String(options.name)) : 'nf'
  const id = buildInstanceId(projectArg ?? label, new Date(), port)
  const dir = instanceDir(id)
  const home = path.join(dir, 'home')
  const project = projectArg ?? (consoleOnly ? null : path.join(dir, 'project'))

  ensureDir(dir)
  ensureDir(path.join(home, '.novelforge'))
  ensureDir(path.join(home, '.config'))
  if (project) ensureDir(project)

  const sourceHome = path.join(os.homedir(), '.novelforge')
  for (const file of ['config.json', 'models.json', 'credentials.json']) {
    copyIfExists(path.join(sourceHome, file), path.join(home, '.novelforge', file))
  }
  copyIfExists(path.join(sourceHome, 'prompts'), path.join(home, '.novelforge', 'prompts'))

  // 隔离实例不继承真实最近项目列表，避免 UI 里出现未隔离的路径
  const configPath = path.join(home, '.novelforge', 'config.json')
  const config = readJson(configPath)
  if (config) {
    config.recentProjects = []
    writeJson(configPath, config)
  }

  const logPath = path.join(dir, 'instance.log')
  const logFd = fs.openSync(logPath, 'a')
  const bin = electronBinary()
  const userDataDir = options['user-data-dir']
    ? path.resolve(String(options['user-data-dir']))
    : path.join(home, 'user-data')
  ensureDir(userDataDir)

  const args = []
  // 开发态：electron 二进制需要应用路径 `.`；打包版：app 可执行文件自身就是入口
  if (process.env.NOVELFORGE_ELECTRON_PACKAGED !== '1') args.push('.')
  args.push(
    '--no-sandbox',
    `--remote-debugging-port=${port}`,
    // 身份标记：stop 前用它校验 PID 仍是本实例，防 PID 复用误杀
    `--dev-instance=${id}`,
    // 隔离 Chromium profile（localStorage/session 不污染真实实例）
    `--user-data-dir=${userDataDir}`,
  )
  if (project) args.push(`--project=${project}`)
  if (options['dev-console']) args.push('--dev-console')

  // 从 UI 启动时，CLI 自己由 ELECTRON_RUN_AS_NODE=1 执行；
  // 该变量绝不能传给新窗口，否则 Electron 会以纯 Node 模式跑 main.js。
  // Windows 上 HOME/XDG 不生效，buildChildEnv 会同时设置 USERPROFILE/APPDATA/LOCALAPPDATA。
  const childEnv = buildChildEnv(process.env, home, process.platform)
  childEnv.NOVELFORGE_DEV_INSTANCE = id
  childEnv.NOVELFORGE_DEV_INSTANCES_ROOT = instancesRoot
  if (process.platform === 'win32') {
    ensureDir(childEnv.APPDATA)
    ensureDir(childEnv.LOCALAPPDATA)
  }

  const child = spawn(bin, args, {
    cwd: repoRoot,
    env: childEnv,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  })
  child.unref()
  fs.closeSync(logFd)

  const manifest = {
    id,
    pid: child.pid,
    pgid: child.pid,
    port,
    project: project ?? '',
    home,
    log: logPath,
    startedAt: Date.now(),
    status: 'running',
  }
  writeJson(manifestPath(id), manifest)

  try {
    const page = await getCdpPage(port, Number(options.timeout) || 30000)
    const cdp = await openCdp(page.webSocketDebuggerUrl)
    try {
      await waitForDocument(cdp)
      // 端口可能被外部 CDP（Chrome/另一实例）占用：用页面内身份标记确认是自己的实例
      const actual = await cdp.evaluate('window.__velaDevInstanceId ?? null')
      if (actual !== id) {
        throw new Error(`instance identity mismatch: expected ${id}, got ${actual}`)
      }
    } finally {
      cdp.close()
    }
    return { ...manifest, alive: true }
  } catch (error) {
    killTree(child.pid, 'SIGKILL')
    writeJson(manifestPath(id), { ...manifest, status: 'failed', error: String(error) })
    throw error
  }
}

function readProcessCommandLine(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return ''
  try {
    if (process.platform === 'linux') {
      return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ')
    }
    if (process.platform === 'win32') {
      const ps = spawnSync('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], { encoding: 'utf8', timeout: 3000 })
      if (ps.stdout && ps.stdout.trim()) return ps.stdout
      const wmic = spawnSync('wmic', ['process', 'where', `processid=${pid}`, 'get', 'commandline', '/value'], { encoding: 'utf8', timeout: 3000 })
      return wmic.stdout || ''
    }
    const ps = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 3000 })
    return ps.stdout || ''
  } catch {
    return ''
  }
}

async function stop(id, options = {}) {
  const manifest = readManifest(id)
  if (isPidAlive(manifest.pid)) {
    const owned = isOwnedProcessCommand(readProcessCommandLine(manifest.pid), id)
    if (!owned && !options.force) {
      throw new Error(`process ${manifest.pid} does not belong to ${id}; use --force only after verifying it`)
    }
    killTree(manifest.pid, 'SIGTERM')
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && isPidAlive(manifest.pid)) await sleep(100)
    if (isPidAlive(manifest.pid)) {
      killTree(manifest.pid, 'SIGKILL')
      const killDeadline = Date.now() + 2000
      while (Date.now() < killDeadline && isPidAlive(manifest.pid)) await sleep(100)
    }
  }

  const alive = isPidAlive(manifest.pid)
  const portFree = await isPortFree(manifest.port)
  const next = {
    ...manifest,
    status: alive ? 'failed' : 'stopped',
    stoppedAt: Date.now(),
    portFree,
  }
  writeJson(manifestPath(id), next)
  if (alive) throw new Error(`process ${manifest.pid} is still alive after SIGKILL`)
  return { ...next, alive: false }
}

async function clean(id, options) {
  if (!options.yes) {
    throw new Error('clean 会删除隔离 HOME 与项目目录；确认请加 --yes')
  }
  await stop(id, options)
  fs.rmSync(instanceDir(id), { recursive: true, force: true })
  return { id, removed: true }
}

function tail(file, lines) {
  if (!fs.existsSync(file)) return ''
  const text = fs.readFileSync(file, 'utf8')
  const all = text.split(/\r?\n/)
  return all.slice(-Math.max(1, lines)).join('\n')
}

function printJson(value) { console.log(JSON.stringify(value, null, 2)) }

function printList(instances) {
  if (instances.length === 0) {
    console.log('(no instances)')
    return
  }
  for (const m of instances) {
    console.log(`${m.alive ? '●' : '○'} ${m.id}  port=${m.port}  pid=${m.pid}  ${m.status}`)
    console.log(`  project: ${m.project}`)
    console.log(`  home:    ${m.home}`)
    console.log(`  log:     ${m.log}`)
  }
}

async function waitForDocument(cdp, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (await cdp.evaluate('document.readyState') === 'complete') return true
    } catch { /* page not ready yet */ }
    await sleep(200)
  }
  return false
}

async function waitForDevConsoleHook(cdp, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (await cdp.evaluate("typeof window.__velaOpenDevConsole === 'function'")) return true
    } catch { /* App not mounted yet */ }
    await sleep(200)
  }
  return false
}

/** 连接实例 CDP 并校验页面身份，防止显式端口指向外部 Chrome/另一实例 */
async function openInstanceCdp(id) {
  const manifest = readManifest(id)
  const page = await getCdpPage(manifest.port, 5000)
  const cdp = await openCdp(page.webSocketDebuggerUrl)
  await waitForDocument(cdp)
  const actual = await cdp.evaluate('window.__velaDevInstanceId ?? null')
  if (actual !== id) {
    cdp.close()
    throw new Error(`instance identity mismatch: expected ${id}, got ${actual}`)
  }
  return { manifest, cdp }
}

async function main() {
  const { command, options, positional } = parseArgs(process.argv.slice(2))

  switch (command) {
    case 'start': {
      const result = await start(options)
      if (options.json) printJson(result)
      else {
        console.log(`✅ started ${result.id}`)
        console.log(`   port:    ${result.port}`)
        console.log(`   project: ${result.project}`)
        console.log(`   home:    ${result.home}`)
        console.log(`   log:     ${result.log}`)
      }
      return
    }
    case 'list': {
      const list = listInstances()
      if (options.json) printJson(list)
      else printList(list)
      return
    }
    case 'stop': {
      const id = positional[0]
      if (!id) throw new Error('usage: stop <id>')
      const result = await stop(id, options)
      if (options.json) printJson(result)
      else {
        console.log(`✅ stopped ${id}`)
        if (result.portFree === false) console.log(`⚠ port ${result.port} is still in use by another process`)
      }
      return
    }
    case 'clean': {
      const id = positional[0]
      if (!id) throw new Error('usage: clean <id> --yes')
      const result = await clean(id, options)
      if (options.json) printJson(result)
      else console.log(`✅ cleaned ${id}`)
      return
    }
    case 'logs': {
      const id = positional[0]
      if (!id) throw new Error('usage: logs <id> [lines]')
      const lines = Number(positional[1]) || Number(options.lines) || 100
      console.log(tail(readManifest(id).log, lines))
      return
    }
    case 'dir': {
      const id = positional[0]
      if (!id) throw new Error('usage: dir <id>')
      const m = readManifest(id)
      printJson({ dir: instanceDir(id), manifest: manifestPath(id), project: m.project, home: m.home, log: m.log })
      return
    }
    case 'eval': {
      const id = positional[0]
      const expression = positional.slice(1).join(' ')
      if (!id || !expression) throw new Error('usage: eval <id> <js>')
      const { cdp } = await openInstanceCdp(id)
      try {
        const value = await cdp.evaluate(expression)
        printJson(value)
      } finally {
        cdp.close()
      }
      return
    }
    case 'shot': {
      const id = positional[0]
      const out = positional[1]
      if (!id || !out) throw new Error('usage: shot <id> <png>')
      const { cdp } = await openInstanceCdp(id)
      try {
        await cdp.screenshot(path.resolve(out))
        console.log(`saved ${path.resolve(out)}`)
      } finally {
        cdp.close()
      }
      return
    }
    case 'console': {
      const id = positional[0]
      if (!id) throw new Error('usage: console <id> [ms]')
      const ms = Number(positional[1]) || Number(options.ms) || 2000
      const { cdp } = await openInstanceCdp(id)
      try {
        const events = await cdp.collectConsole(ms)
        const lines = events.map((e) => {
          if (e.method === 'Runtime.consoleAPICalled') {
            return `[console.${e.params.type}] ` + e.params.args.map((a) => a.value ?? a.description ?? a.unserializableValue ?? '').join(' ')
          }
          if (e.method === 'Runtime.exceptionThrown') {
            return '[exception] ' + (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text)
          }
          return `[log.${e.params.entry.level}] ${e.params.entry.text}`
        })
        console.log(lines.join('\n') || '(no console output)')
      } finally {
        cdp.close()
      }
      return
    }
    case 'console-ui': {
      const id = positional[0]
      if (!id) throw new Error('usage: console-ui <id>')
      const { cdp } = await openInstanceCdp(id)
      try {
        if (!(await waitForDevConsoleHook(cdp))) {
          console.log('no-hook')
          return
        }
        await cdp.evaluate('window.__velaOpenDevConsole()')
        console.log('opened')
      } finally {
        cdp.close()
      }
      return
    }
    case 'help':
    default:
      console.log(`NovelForge isolated instance CLI

  start [--project <path>] [--port <n>] [--name <label>] [--dev-console] [--json]
  list [--json]
  stop <id> [--force]
  clean <id> --yes [--force]
  logs <id> [lines]
  dir <id>
  eval <id> <js>
  shot <id> <png>
  console <id> [ms]
  console-ui <id>        open the in-app Developer Console

Instances live under ${instancesRoot}`)
  }
}

main().catch((error) => {
  console.error('error:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})