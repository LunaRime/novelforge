/**
 * 应用更新 & 卸载控制器
 *
 * 功能：
 * 1. 自动更新 — GitHub Release 检查最新同类型版本，复用自建下载器
 *    （多路径测速选路 / 断点续传 / sha256 校验）下载完整安装包，运行 NSIS 升级。
 * 2. 卸载 — 触发 NSIS 卸载程序 + 清理用户数据
 *
 * 设计（2026-10-14 起替换 electron-updater）：
 * - 检查源用 GitHub API `/releases`（拿 Installer.exe 的 browser_download_url + digest），
 *   不再依赖 latest.yml / blockmap 的差分元数据。
 * - 下载复用 `electron/ollama-registry.ts` 的 `downloadBlob`（断点续传 + 停顿换路）
 *   与 `electron/net-path.ts` 的候选路径（直连 / 代理测速排序）——与模型下载同一套。
 * - 校验用 GitHub 为 asset 自动计算的 `sha256` digest（`sha256:hex` 格式，直接喂 downloadBlob）。
 * - 安装 = 运行下载好的 Installer.exe（NSIS 处理退出旧版 + 装新版）。
 * - 检查时机：启动后延迟 + 运行中定时（「发布推送到用户」）。
 */

import { app, BrowserWindow, dialog, shell } from 'electron'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { exec } from 'node:child_process'
import { logger } from '../utils/logger'
import { t } from '../../src/shared/locale'
import {
  VELA_HOME,
  DEFAULT_GLOBAL_CONFIG,
  GLOBAL_CONFIG_PATH,
  readJsonFile,
} from '../utils/config-utils'
import { guardedHandle } from '../security/ipc-guard'
import { createElectronTransport } from '../net/electron-net-transport'
import { downloadBlob, probePath } from '../ollama-registry'
import { buildPathCandidates, rankPaths } from '../net-path'
import { safeErrorMessage } from '../utils/error-utils'
import type { GlobalConfig, UpdateInfo, UpdateProgressInfo } from '../../src/shared/ipc-channels'

const GITHUB_API_RELEASES = 'https://api.github.com/repos/LunaRime/novelforge/releases'
const UPDATE_DIR = path.join(VELA_HOME, 'updates')

/** 启动后首次检查的延迟（避免拖慢启动） */
const STARTUP_CHECK_DELAY_MS = 10_000
/** 运行中定时检查的间隔 */
const PERIODIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

// ===== 状态管理 =====

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'no-update'

let currentStatus: UpdateStatus = 'idle'
let currentInfo: UpdateInfo | null = null
let currentError: string | null = null
let downloadInProgress = false

/** 仅测试用：重置下载守卫 */
export function resetDownloadStateForTest(): void {
  downloadInProgress = false
}

/**
 * 启动下载并立即返回是否启动成功。
 * 并发调用只允许一个下载任务；完成/失败/进度一律走事件推送。
 */
export function beginDownloadOnce(start: () => Promise<void>): boolean {
  if (downloadInProgress) return false
  downloadInProgress = true
  void start().finally(() => { downloadInProgress = false })
  return true
}

function sendStatusToRenderer(status: UpdateStatus, info?: UpdateInfo | null, error?: string) {
  currentStatus = status
  currentInfo = info ?? null
  currentError = error ?? null

  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    win.webContents.send('update:status-changed', { status, info: info ?? undefined, error })
  }
}

function sendProgressToRenderer(progress: UpdateProgressInfo) {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    win.webContents.send('update:download-progress', { progress })
  }
}

// ===== 版本比较（SemVer + prerelease） =====

export function parseSemver(v: string): { main: [number, number, number]; pre: Array<string | number> } | null {
  const m = v.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/)
  if (!m) return null
  const pre = m[4] ? m[4].split('.').map((s) => (/^\d+$/.test(s) ? Number(s) : s)) : []
  return { main: [+m[1], +m[2], +m[3]], pre }
}

/** a > b 返回正、a < b 返回负、相等返回 0 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa || !pb) return a.localeCompare(b)
  for (let i = 0; i < 3; i++) {
    if (pa.main[i] !== pb.main[i]) return pa.main[i] - pb.main[i]
  }
  // prerelease：无 pre（正式版）> 有 pre
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0
  if (pa.pre.length === 0) return 1
  if (pb.pre.length === 0) return -1
  const len = Math.max(pa.pre.length, pb.pre.length)
  for (let i = 0; i < len; i++) {
    const x = pa.pre[i]
    const y = pb.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x - y
    } else if (typeof x === 'number') return -1
    else if (typeof y === 'number') return 1
    else {
      const c = x.localeCompare(y)
      if (c !== 0) return c
    }
  }
  return 0
}

// ===== GitHub 检查 =====

interface GitHubAsset {
  name: string
  browser_download_url: string
  digest: string | null
  size: number
}
interface GitHubRelease {
  tag_name: string
  prerelease: boolean
  draft: boolean
  published_at: string
  body: string | null
  assets: GitHubAsset[]
}

async function fetchReleases(): Promise<GitHubRelease[]> {
  const res = await fetch(`${GITHUB_API_RELEASES}?per_page=30`, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`)
  return (await res.json()) as GitHubRelease[]
}

/**
 * 在当前版本类型（beta/正式）的最新 release 里找更高版本。
 * 返回更新目标 + 其 Installer.exe 资产；无可更新 / 缺安装包 → null。
 */
function findUpdate(currentVersion: string, releases: GitHubRelease[]): { release: GitHubRelease; installer: GitHubAsset } | null {
  const isPrerelease = currentVersion.includes('-')
  const candidates = releases
    .filter((r) => !r.draft && r.prerelease === isPrerelease)
    .filter((r) => compareSemver(r.tag_name.replace(/^v/, ''), currentVersion) > 0)
    .sort((a, b) => compareSemver(b.tag_name.replace(/^v/, ''), a.tag_name.replace(/^v/, '')))
  if (candidates.length === 0) return null
  const release = candidates[0]
  const installer = release.assets.find((a) => a.name.endsWith('-Installer.exe'))
  if (!installer) return null
  return { release, installer }
}

function toUpdateInfo(release: GitHubRelease, installer: GitHubAsset): UpdateInfo {
  return {
    version: release.tag_name.replace(/^v/, ''),
    releaseDate: release.published_at,
    releaseNotes: release.body ?? undefined,
    files: [{ url: installer.browser_download_url, size: installer.size, digest: installer.digest ?? undefined }],
  }
}

// ===== 下载 =====

function readProxyConfig(): GlobalConfig['proxy'] {
  try {
    return readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG).proxy
  } catch {
    return undefined
  }
}

async function downloadInstaller(
  info: UpdateInfo,
  onProgress: (p: UpdateProgressInfo) => void,
  signal?: AbortSignal,
): Promise<string> {
  const file = info.files[0]
  if (!file) throw new Error('无下载文件')
  fs.mkdirSync(UPDATE_DIR, { recursive: true })
  const destPath = path.join(UPDATE_DIR, `NovelForge-${info.version}-Installer.exe`)

  const transport = createElectronTransport()
  const candidates = buildPathCandidates(readProxyConfig())

  // 测速选路（与模型下载同源）：串行探测，避免并发抢带宽
  const probes = []
  for (const p of candidates) {
    probes.push({ path: p, bytesPerSec: await probePath(transport, file.url, p) })
  }
  const paths = rankPaths(probes)

  const res = await downloadBlob(transport, {
    url: file.url,
    destPath,
    digest: file.digest,
    paths,
    expectedSize: file.size,
    signal,
    onProgress: (p) => {
      const total = p.total ?? file.size
      const percent = total > 0 ? Math.round((p.completed / total) * 100) : 0
      onProgress({ percent, bytesPerSecond: p.bytesPerSec ?? 0, total, transferred: p.completed })
    },
  })
  if (!res.success) throw new Error(res.error ?? '下载失败')
  return destPath
}

// ===== 安装 =====

/** 运行下载好的 Installer.exe（NSIS 负责退出旧版 + 安装新版） */
function runInstaller(installerPath: string): void {
  if (!fs.existsSync(installerPath)) {
    throw new Error(`安装包不存在: ${installerPath}`)
  }
  exec(`"${installerPath}"`, (err) => {
    if (err) logger.error('Update', t('log.update.installFailed').replace('{err}', err.message))
  })
}

// ===== 检查 / 下载 / 安装 流程 =====

async function runCheck(): Promise<{ hasUpdate: boolean; info?: UpdateInfo; error?: string }> {
  try {
    sendStatusToRenderer('checking')
    const currentVersion = app.getVersion()
    const releases = await fetchReleases()
    const found = findUpdate(currentVersion, releases)
    if (!found) {
      sendStatusToRenderer('no-update')
      return { hasUpdate: false }
    }
    const info = toUpdateInfo(found.release, found.installer)
    logger.info('Update', t('log.update.available').replace('{version}', info.version))
    sendStatusToRenderer('available', info)
    return { hasUpdate: true, info }
  } catch (err) {
    const msg = safeErrorMessage(err)
    sendStatusToRenderer('error', null, msg)
    return { hasUpdate: false, error: msg }
  }
}

// ===== 卸载 =====

function triggerUninstall(): { success: boolean; error?: string } {
  try {
    const appDir = path.dirname(app.getPath('exe'))
    const uninstallerPath = path.join(appDir, 'Uninstall NovelForge.exe')
    if (!fs.existsSync(uninstallerPath)) {
      return { success: false, error: `未找到卸载程序: ${uninstallerPath}。请通过系统控制面板卸载。` }
    }
    exec(`"${uninstallerPath}"`, (err) => {
      if (err) logger.error('Uninstall', t('log.uninstall.launchFailed').replace('{err}', err.message))
    })
    setTimeout(() => { app.quit() }, 500)
    return { success: true }
  } catch (err) {
    return { success: false, error: `触发卸载失败: ${String(err)}` }
  }
}

function cleanUserData(): { success: boolean; error?: string } {
  try {
    const legacyHome = path.join(os.homedir(), '.vela')
    const targets = [VELA_HOME, legacyHome]
    const cleanedDirs: string[] = []
    for (const dir of targets) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true })
        cleanedDirs.push(dir)
      }
    }
    if (cleanedDirs.length > 0) {
      logger.info('Uninstall', t('log.uninstall.cleanedUserData').replace('{path}', cleanedDirs.join(', ')))
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: `清理用户数据失败: ${String(err)}` }
  }
}

function openReleasesPage(): void {
  shell.openExternal('https://github.com/LunaRime/novelforge/releases')
}

async function confirmDestructive(message: string, title: string): Promise<boolean> {
  const win = BrowserWindow.getFocusedWindow()
  const opts: Electron.MessageBoxOptions = {
    type: 'warning',
    buttons: [t('dialog.buttons.cancel'), t('dialog.buttons.ok')],
    defaultId: 0,
    cancelId: 0,
    title,
    message,
  }
  const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
  return response === 1
}

// ===== 注册 IPC =====

export function registerUpdateController(): void {
  guardedHandle('update:check', async () => runCheck())

  guardedHandle('update:download', async () => {
    const info = currentInfo
    if (!info) return { success: false, error: t('status.noUpdateInfo') }
    const started = beginDownloadOnce(async () => {
      sendStatusToRenderer('downloading', info)
      try {
        await downloadInstaller(info, sendProgressToRenderer)
        sendStatusToRenderer('downloaded', info)
      } catch (err) {
        const msg = safeErrorMessage(err)
        sendStatusToRenderer('error', null, msg)
      }
    })
    if (!started) return { success: false, error: 'already-downloading' }
    return { success: true }
  })

  guardedHandle('update:install', () => {
    try {
      // 优先用上次下载的安装包；缺包则报错让用户重新下载
      const version = currentInfo?.version ?? app.getVersion()
      const installerPath = path.join(UPDATE_DIR, `NovelForge-${version}-Installer.exe`)
      if (!fs.existsSync(installerPath)) {
        return { success: false, error: t('status.noInstaller') }
      }
      runInstaller(installerPath)
      return { success: true }
    } catch (err) {
      return { success: false, error: safeErrorMessage(err) }
    }
  })

  guardedHandle('update:get-version', () => ({
    currentVersion: app.getVersion(),
    appName: app.getName(),
  }))

  guardedHandle('update:get-status', () => ({
    status: currentStatus,
    info: currentInfo ?? undefined,
    error: currentError ?? undefined,
  }))

  // ---- 卸载 ----

  guardedHandle('uninstall:trigger', async () => {
    const ok = await confirmDestructive(t('settings.uninstallConfirmMsg'), t('settings.uninstall'))
    if (!ok) return { success: false, error: t('status.cancelled') }
    return triggerUninstall()
  })

  guardedHandle('uninstall:clean-user-data', async () => {
    const ok = await confirmDestructive(t('settings.cleanUserDataConfirmMsg'), t('settings.cleanUserData'))
    if (!ok) return { success: false, error: t('status.cancelled') }
    return cleanUserData()
  })

  // ---- 辅助 ----
  guardedHandle('update:open-releases', () => {
    openReleasesPage()
    return { success: true }
  })

  // ===== 自动检查：启动延迟 + 运行中定时（发布推送到用户） =====
  // 首次检查延迟，避免拖慢启动；失败静默（下次定时再试），不打扰用户
  setTimeout(() => { void runCheck() }, STARTUP_CHECK_DELAY_MS)
  setInterval(() => { void runCheck() }, PERIODIC_CHECK_INTERVAL_MS)

  logger.info('Update', t('log.ipc.updateRegistered'))
}
