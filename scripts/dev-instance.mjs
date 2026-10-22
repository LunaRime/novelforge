#!/usr/bin/env node
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
  readManifests, pickFreePort, getCdpPage, openCdp,
} from './dev-instance-lib.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const instancesRoot = path.join(os.homedir(), '.novelforge', 'dev-instances')
const require = createRequire(import.meta.url)

function electronBinary() {
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
  const port = Number.isInteger(options.port) ? options.port : await pickFreePort(9223)
  const label = options.name ? sanitizeName(String(options.name)) : 'nf'
  const id = buildInstanceId(projectArg ?? label, new Date(), port)
  const dir = instanceDir(id)
  const home = path.join(dir, 'home')
  const project = projectArg ?? path.join(dir, 'project')

  ensureDir(dir)
  ensureDir(path.join(home, '.novelforge'))
  ensureDir(path.join(home, '.config'))
  if (!projectArg) ensureDir(project)

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
  const args = [
    '.',
    '--no-sandbox',
    `--remote-debugging-port=${port}`,
    `--project=${project}`,
  ]
  if (options['user-data-dir']) args.push(`--user-data-dir=${path.resolve(String(options['user-data-dir']))}`)

  const child = spawn(bin, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
      ELECTRON_ENABLE_LOGGING: '1',
      NOVELFORGE_DEVTOOLS: '1',
      NOVELFORGE_DEV_INSTANCE: id,
    },
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
    project,
    home,
    log: logPath,
    startedAt: Date.now(),
    status: 'running',
  }
  writeJson(manifestPath(id), manifest)

  try {
    await getCdpPage(port, Number(options.timeout) || 30000)
    return { ...manifest, alive: true }
  } catch (error) {
    killTree(child.pid, 'SIGKILL')
    writeJson(manifestPath(id), { ...manifest, status: 'failed', error: String(error) })
    throw error
  }
}

async function stop(id) {
  const manifest = readManifest(id)
  if (isPidAlive(manifest.pid)) {
    killTree(manifest.pid, 'SIGTERM')
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && isPidAlive(manifest.pid)) await sleep(100)
    if (isPidAlive(manifest.pid)) {
      killTree(manifest.pid, 'SIGKILL')
      const killDeadline = Date.now() + 2000
      while (Date.now() < killDeadline && isPidAlive(manifest.pid)) await sleep(100)
    }
  }
  const next = { ...manifest, status: 'stopped', stoppedAt: Date.now() }
  writeJson(manifestPath(id), next)
  return { ...next, alive: isPidAlive(next.pid) }
}

async function clean(id, options) {
  if (!options.yes) {
    throw new Error('clean 会删除隔离 HOME 与项目目录；确认请加 --yes')
  }
  await stop(id)
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

async function hasCdp(id) {
  const m = readManifest(id)
  const page = await getCdpPage(m.port, 5000)
  return { manifest: m, page }
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
      const result = await stop(id)
      if (options.json) printJson(result)
      else console.log(`✅ stopped ${id}${result.alive ? ' (still alive!)' : ''}`)
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
      const { page } = await hasCdp(id)
      const cdp = await openCdp(page.webSocketDebuggerUrl)
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
      const { page } = await hasCdp(id)
      const cdp = await openCdp(page.webSocketDebuggerUrl)
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
      const { page } = await hasCdp(id)
      const cdp = await openCdp(page.webSocketDebuggerUrl)
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
    case 'help':
    default:
      console.log(`NovelForge isolated instance CLI

  start [--project <path>] [--port <n>] [--name <label>] [--json]
  list [--json]
  stop <id>
  clean <id> --yes
  logs <id> [lines]
  dir <id>
  eval <id> <js>
  shot <id> <png>
  console <id> [ms]

Instances live under ${instancesRoot}`)
  }
}

main().catch((error) => {
  console.error('error:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})