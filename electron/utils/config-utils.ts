import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { GlobalConfig } from '../../src/shared/ipc-channels'

export const VELA_HOME = path.join(os.homedir(), '.novelforge')

/** 项目内运行时数据目录名（与 VELA_HOME 同步改名：.vela → .novelforge） */
export const PROJECT_VELA_DIR = '.novelforge'

/** 目录内容是否仅含 .log 文件（含空目录）——日志是应用自身副产物
 *  （logger.ts createWriteStream 写 {prefix}{date}.log；Dev 模式在 logs/dev/），
 *  非用户数据，删除可接受。读取异常 → false（安全侧向） */
function isLogsOnlyDir(dir: string): boolean {
  try {
    return fs.readdirSync(dir).every((name: string) => name.endsWith('.log'))
  } catch {
    return false
  }
}

/** 应用在 VELA_HOME 下自动创建的运行时目录（空建副产物）：
 *  ensureVelaHome 产物 prompts/ + skills:list 空建 skills/ + templates:list 空建 templates/
 *  + agent-archive-list/write 空建 agent-archive/（logs 单独处理，见下） */
const AUTO_CREATED_DIRS = ['prompts', 'skills', 'templates', 'agent-archive']

/** 判定目录是否为「auto 形态」——ensureVelaHome 产物 + 应用运行时自动创建的空目录 + 日志副产物：
 *  目录不存在 / 空目录 → true；已知应用自有目录名（prompts/skills/templates/agent-archive）为空 → true；
 *  logs 不存在或仅含 .log 文件（或含仅 .log 文件的 dev/ 子目录——logger Dev 模式 {prefix}{date}.log）；
 *  其余任何条目（用户数据：非 .log 文件、非空已知目录、其他目录/文件/名字）→ false。
 *  **false 时绝不删除**（安全边界——skills/ 用户导入、agent-archive/ 归档数据、未知目录一律保留） */
function isAutoCreatedHome(dir: string): boolean {
  let entries: string[]
  try {
    if (!fs.existsSync(dir)) return true
    entries = fs.readdirSync(dir)
  } catch {
    return false
  }
  if (entries.length === 0) return true
  for (const name of entries) {
    if (AUTO_CREATED_DIRS.includes(name)) {
      try {
        if (fs.readdirSync(path.join(dir, name)).length > 0) return false
      } catch {
        return false // 已知目录名存在但不可读/非目录 → 视为含数据，不删除
      }
    } else if (name === 'logs') {
      const logsPath = path.join(dir, name)
      let logsEntries: string[]
      try {
        logsEntries = fs.readdirSync(logsPath)
      } catch {
        return false // logs 存在但不可读/非目录 → 视为含数据，不删除
      }
      for (const sub of logsEntries) {
        if (sub.endsWith('.log')) continue
        if (sub === 'dev' && isLogsOnlyDir(path.join(logsPath, sub))) continue
        return false
      }
    } else {
      return false
    }
  }
  return true
}

/** 全局目录迁移：~/.vela → ~/.novelforge（启动早期调用；失败静默，旧路径兜底）。
 *  判定哨兵为 newHome/config.json（而非目录存在）——防「首次 rename 失败后 ensureVelaHome
 *  空建 newHome」令条件永久为假、数据永久搁浅；失败下次启动自动重试。
 *  重试前清理 auto 形态新目录树（ensureVelaHome 产物 + skills/templates/agent-archive 空建 + 应用日志副产物）——
 *  Win32 目录 rename 到已存在目录会 EPERM；非 auto 形态（含用户数据）绝不删除 */
export async function migrateLegacyDirs(): Promise<void> {
  const oldHome = path.join(os.homedir(), '.vela')
  const newHome = VELA_HOME
  if (fs.existsSync(oldHome) && !fs.existsSync(GLOBAL_CONFIG_PATH)) {
    // Win32：目录 rename 到已存在目录会 EPERM——重试前识别并清理新目录树
    // （auto 形态：ensureVelaHome 空建产物 + skills/templates/agent-archive 空建 + 日志副产物）；
    // 含用户数据的目录绝不删除（清理失败同样走 rename 失败路径静默回退）
    try {
      if (isAutoCreatedHome(newHome)) {
        fs.rmSync(newHome, { recursive: true, force: true })
      }
    } catch (e) {
      console.error('[NovelForge] 清理 auto-created ~/.novelforge 失败，尝试直接迁移：', e)
    }
    try {
      fs.renameSync(oldHome, newHome)
    } catch (e) {
      console.error('[NovelForge] 迁移 ~/.vela 失败，保留旧目录读取：', e)
    }
  }
}

/** 项目库目录：优先 .novelforge；旧 .vela 存在且新目录不存在时惰性迁移（P0-6：覆盖未打开项目的
 *  跨项目聚合直开点——activity/usage 只读扫 B/C 项目时同样触发迁移，不再静默漏读）；
 *  迁移失败回退旧路径（双路径兜底，数据不丢） */
export function getProjectVelaDir(projectPath: string): string {
  const newDir = path.join(projectPath, PROJECT_VELA_DIR)
  if (fs.existsSync(newDir)) return newDir
  const oldDir = path.join(projectPath, '.vela')
  if (fs.existsSync(oldDir)) {
    try {
      fs.renameSync(oldDir, newDir)  // 惰性迁移：rename 成功后返回新路径
      return newDir
    } catch (e) {
      console.error(`[NovelForge] 迁移 ${projectPath}/.vela 失败，保留旧目录读取：`, e)
      return oldDir  // 迁移失败：回退旧路径（双路径兜底，数据不丢）
    }
  }
  return newDir  // 新项目：无任何目录 → 用 .novelforge 创建
}

export function ensureVelaHome() {
  const dirs = [
    VELA_HOME,
    path.join(VELA_HOME, 'prompts'),
    path.join(VELA_HOME, 'logs'),
  ]
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    }
    // 全局迁移失败兜底：VELA_HOME 下文件缺失 + ~/.vela 旧文件仍在（迁移失败残留）
    // → 回读旧文件（优雅降级，模型列表/主题/最近项目不消失）；新路径存在则读新（不回读旧）；
    // 全新安装（~/.vela 无文件）→ 无回读；文件存在的读取失败（JSON 损坏）→ 不回退（另一类问题）
    if (filePath.startsWith(VELA_HOME + path.sep)) {
      const legacyPath = path.join(os.homedir(), '.vela', path.basename(filePath))
      if (fs.existsSync(legacyPath)) {
        return JSON.parse(fs.readFileSync(legacyPath, 'utf-8'))
      }
    }
  } catch (error) {
    console.warn(`[NovelForge] 读取 ${filePath} 失败:`, error)
  }
  return fallback
}

export function writeJsonFile(filePath: string, data: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  // 原子写入：先写临时文件，再 rename（避免并发写入导致数据截断）
  const tmpPath = filePath + '.tmp.' + Date.now() + '.' + Math.random().toString(36).slice(2, 8)
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
    fs.renameSync(tmpPath, filePath)
  } catch (error) {
    // 清理临时文件
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath) } catch { /* ignore */ }
    console.error(`[NovelForge] 写入配置文件失败: ${filePath}`, error)
    throw error
  }
}

export const GLOBAL_CONFIG_PATH = path.join(VELA_HOME, 'config.json')
export const MODELS_CONFIG_PATH = path.join(VELA_HOME, 'models.json')
export const RECENT_PROJECTS_PATH = path.join(VELA_HOME, 'recent-projects.json')

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  theme: 'dark',
  defaultModelId: null,
  editorFontSize: 16,
  editorFontFamily: 'Noto Serif SC',
  autoSaveInterval: 30,
  recentConversationCount: 3,
  logRetention: {
    files: 5,
    days: 7,
  },
  proxy: {
    enabled: false,
    type: 'http',
    host: '',
    port: 7890,
  },
}
