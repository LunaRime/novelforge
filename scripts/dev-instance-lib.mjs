/* eslint-env node */
/**
 * NovelForge 隔离实例 CLI — 纯函数与 CDP 辅助。
 *
 * 设计约束：
 * - 只启动 NovelForge 自己的 Electron 可执行文件，不接受任意 shell 命令。
 * - 实例运行目录在 ~/.novelforge/dev-instances/<id>/，不写入项目仓库。
 * - 所有 manifest/log 输出不包含凭据内容。
 */
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

/** 解析命令行：command + options + positional */
export function parseArgs(argv) {
  const args = [...argv]
  const command = args.shift() ?? 'help'
  const options = {}
  const positional = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const eq = arg.indexOf('=')
    if (eq > -1) {
      options[arg.slice(2, eq)] = coerce(arg.slice(2, eq), arg.slice(eq + 1))
      continue
    }
    const key = arg.slice(2)
    const next = args[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      options[key] = coerce(key, next)
      i++
    } else {
      options[key] = true
    }
  }
  return { command, options, positional }
}

function coerce(key, value) {
  if (key === 'port' || key === 'lines') {
    const n = Number(value)
    return Number.isFinite(n) ? n : value
  }
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}

function hashString(value) {
  let h = 0
  for (let i = 0; i < value.length; i++) h = ((h << 5) - h + value.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** 可读、可按端口区分的实例 ID */
export function buildInstanceId(projectPath, now = new Date(), port) {
  const p = (n) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  const suffix = Number.isInteger(port)
    ? String(port)
    : String(hashString(projectPath) % 10000).padStart(4, '0')
  return `dev-${stamp}-${suffix}`
}

/** 文件名/实例名清洗 */
export function sanitizeName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

/** pid 是否存活（EPERM 视为存活） */
export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

/** 读取一个目录下的全部 manifest（容错坏文件） */
export function readManifests(rootDir) {
  if (!fs.existsSync(rootDir)) return []
  const out = []
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const file = path.join(rootDir, entry.name, 'manifest.json')
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (parsed && typeof parsed === 'object') out.push(parsed)
    } catch {
      // 坏 manifest / 正在写入：跳过
    }
  }
  return out
}

/** 从 startPort 起找空闲端口（仅回环） */
export async function pickFreePort(startPort) {
  const start = Number.isInteger(startPort) && startPort > 0 ? startPort : 9223
  for (let port = start; port < start + 100; port++) {
    if (await isPortFree(port)) return port
  }
  throw new Error(`no free port in ${start}-${start + 99}`)
}

export async function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}

/** 构造隔离子进程环境（Windows 需要 USERPROFILE/APPDATA/LOCALAPPDATA，HOME/XDG 不生效） */
export function buildChildEnv(baseEnv, home, platform = process.platform) {
  const env = {
    ...baseEnv,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    ELECTRON_ENABLE_LOGGING: '1',
    NOVELFORGE_DEVTOOLS: '1',
  }
  if (platform === 'win32') {
    const parsed = path.win32.parse(home)
    env.USERPROFILE = home
    env.APPDATA = path.win32.join(home, 'AppData', 'Roaming')
    env.LOCALAPPDATA = path.win32.join(home, 'AppData', 'Local')
    if (parsed.root) {
      env.HOMEDRIVE = parsed.root.replace(/\\$/, '')
      env.HOMEPATH = home.slice(parsed.root.length)
    }
  }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

/** 进程归属校验：只认 CLI 注入的 --dev-instance=<id>，防 PID 复用误杀 */
export function isOwnedProcessCommand(commandLine, id) {
  if (!commandLine || !id) return false
  return commandLine.includes(`--dev-instance=${id}`)
}

/** 取 CDP 页面 target（实例启动后用） */
export async function getCdpPage(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  let lastError = ''
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`)
      if (res.ok) {
        const targets = await res.json()
        const page = targets.find((t) => t.type === 'page')
        if (page?.webSocketDebuggerUrl) return page
        lastError = 'no page target'
      } else {
        lastError = `HTTP ${res.status}`
      }
    } catch (error) {
      lastError = String(error)
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`CDP not ready on ${port}: ${lastError}`)
}

/** 极简 CDP 客户端（Runtime.evaluate / Page.captureScreenshot / console 收集） */
export async function openCdp(webSocketDebuggerUrl) {
  const ws = new WebSocket(webSocketDebuggerUrl)
  let seq = 0
  const pending = new Map()
  const events = []

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    } else if (msg.method) {
      events.push(msg)
    }
  })
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })

  return {
    send,
    events,
    async evaluate(expression) {
      await send('Runtime.enable')
      const r = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      })
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
      }
      return r.result?.value
    },
    async screenshot(filePath) {
      await send('Page.enable')
      const r = await send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(filePath, Buffer.from(r.data, 'base64'))
      return filePath
    },
    async collectConsole(ms) {
      await send('Runtime.enable')
      await send('Log.enable')
      await new Promise((r) => setTimeout(r, ms))
      return events.filter((e) => ['Runtime.consoleAPICalled', 'Runtime.exceptionThrown', 'Log.entryAdded'].includes(e.method))
    },
    close() {
      ws.close()
    },
  }
}