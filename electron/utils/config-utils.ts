import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { GlobalConfig, LocalEmbeddingConfig, ProviderAccount } from '../../src/shared/ipc-channels'

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
 *  **false 时绝不删除**（安全边界——skills/ 用户导入、agent-archive/ 归档数据、未知目录一律保留）
 *  **mcp_config.json 特例**：~/.novelforge 根级 mcp_config.json 是用户数据（MCP 设置保存后写入，
 *  见 mcp-ipc-bridge），不在 AUTO_CREATED_DIRS/logs 中 → isAutoCreatedHome 恒为 false →
 *  migrateLegacyDirs **跳过清理** → rename 到已存在的 ~/.novelforge 目录 EPERM（Win32）→
 *  迁移失败静默 → readJsonFile 旧路径兜底继续读 ~/.vela（数据不丢，仅迁移搁浅）。
 *  搁浅窗口狭窄：旧 ~/.vela 仍在 + 用户已在 ~/.novelforge 保存过 MCP 配置（且 config.json 尚未
 *  落盘新目录才会触发迁移尝试）。**有意不扩展白名单**：mcp_config.json 是用户数据，任何自动删除
 *  路径都不可接受；搁浅场景由双路径兜底覆盖，符合「false 时绝不删除」的安全边界 */
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

// ===== 测试辅助：文件层注入（与 credentials/store 的 __setCredentialFileForTest 同款纪律）=====

/**
 * 注入**文件层**替身（内存 Map）：此后 readJsonFile / writeJsonFile 只碰它，**不碰真实磁盘**。
 *
 * ⚠️ 为什么注入点必须落在**函数体内**：「配置文件的写路径」都是「读全量 → 改 → 写全量」，
 *    用例若走真实 IO 就会覆盖用户 home 下的真实配置。而 `vi.mock('…/config-utils')` 只替换
 *    模块的**外部**引用 —— 真实 `readProvidersFile` 内部调用的是同模块的 `readJsonFile`，
 *    不经过替身，于是「已打桩文件层」的用例照样读写 `~/.novelforge/providers.json`
 *    （2026-10-01 T2 实测踩到）。要挡住这条，替身只能挂在函数体里。
 */
let fileInjected = false
let fileOverride: Map<string, unknown> | null = null

/** 注入文件层替身（用例在 beforeEach 里给一份新 Map；路径作 key，与真实路径字符串一致） */
export function __setConfigFilesForTest(files: Map<string, unknown>): void {
  fileInjected = true
  fileOverride = files
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
  if (fileInjected) {
    // 深拷贝：真实 IO 每次都是新对象，替身也必须如此（否则调用方改动会污染「盘上」数据）
    return fileOverride!.has(filePath) ? (structuredClone(fileOverride!.get(filePath)) as T) : fallback
  }
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
  if (fileInjected) {
    fileOverride!.set(filePath, structuredClone(data))
    return
  }
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

/**
 * 迁移留档后缀（T4）：`providers.json` → `providers.json.pre-credentials.bak`。
 *
 * 与 `writeJsonFile` 的 `.tmp.…` 临时文件**不同**——那些是原子写的中转产物（写完即 rename），
 * 这个是给用户留的**回退点**：迁移把密钥搬进 credentials.json 之前的原始字节。
 */
export const CREDENTIAL_MIGRATION_BACKUP_SUFFIX = '.pre-credentials.bak'

/** `backupFileOnce` 的结果：`copied` 已备份 / `skipped` 目标已存在 / `missing` 源不存在 / `failed` 失败 */
export type BackupOutcome = 'copied' | 'skipped' | 'missing' | 'failed'

/**
 * 把一个文件**按原始字节**复制成 `*.pre-credentials.bak`（仅当目标不存在；调用方是 T4 迁移）。
 *
 * 为什么是字节复制而不是「readJsonFile + writeJsonFile」：备份的语义是**回退点**，
 * 必须与源文件逐字节一致 —— 走 JSON 解析会把注释/格式丢掉，遇到解析不了的源文件更糟
 * （`readJsonFile` 会兜底返回 fallback 并照写，于是「备份」变成一份凭空捏造的数据）。
 *
 * 源不存在 → `missing`（没东西可备份，也谈不上失败：该文件本来就没有数据要迁）；
 * 目标已存在 → `skipped`（**不覆盖**：第一次的回退点比后来的更珍贵）。
 * 注入态下在替身 Map 内完成同样语义（不触真实磁盘）。
 *
 * **原子写**（终审小修②）：先复制到 `dest.tmp.…` 再 `rename`（同 `writeJsonFile` 的形态）——
 * 直写 `dest` 的话，中途崩溃/断电会留下一个**截断的 .bak**，而下次运行只看「目标存在」即
 * `skipped`：回退点从此是一份半截数据，且再也不会被修复。
 */
export function backupFileOnce(filePath: string): BackupOutcome {
  const dest = filePath + CREDENTIAL_MIGRATION_BACKUP_SUFFIX
  if (fileInjected) {
    const files = fileOverride!
    if (files.has(dest)) return 'skipped'
    if (!files.has(filePath)) return 'missing'
    files.set(dest, structuredClone(files.get(filePath)))
    return 'copied'
  }
  const tmpPath = dest + '.tmp.' + Date.now() + '.' + Math.random().toString(36).slice(2, 8)
  try {
    if (fs.existsSync(dest)) return 'skipped'
    if (!fs.existsSync(filePath)) return 'missing'
    fs.copyFileSync(filePath, tmpPath)
    fs.renameSync(tmpPath, dest)
    return 'copied'
  } catch (error) {
    // 清理中转文件（复制到一半失败时它可能已经存在）
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath) } catch { /* ignore */ }
    console.error(`[NovelForge] 备份 ${filePath} 失败:`, error)
    return 'failed'
  }
}

export const GLOBAL_CONFIG_PATH = path.join(VELA_HOME, 'config.json')
export const MODELS_CONFIG_PATH = path.join(VELA_HOME, 'models.json')
/** 供应商账户（一份凭据挂多个模型）—— 派生条目的凭据来源，见 src/shared/provider-accounts.ts */
export const PROVIDERS_CONFIG_PATH = path.join(VELA_HOME, 'providers.json')

/** providers.json 当前形状版本（v1 = 裸数组，无版本号） */
export const PROVIDERS_FILE_VERSION = 2

/** providers.json 的**逻辑状态**（读/写都走它，调用方不必关心盘上版本与包装字段） */
export interface ProvidersFileState {
  /** 乐观并发版本号：每次成功写入 +1。旧数组形读入时视作 0（见 readProvidersFile） */
  revision: number
  accounts: ProviderAccount[]
}

/**
 * 读 providers.json（**已归一化**，不抛）。
 *
 * 两种盘上形状都认：
 * - v1 裸数组 `[account, …]` → `{ revision: 0, accounts }`（老用户零感知，写时自动升级 v2）
 * - v2 `{ version: 2, revision, accounts }`
 *
 * 坏形状（accounts 非数组 / revision 非自然数）逐字段降级 —— 与 credentials store 同一纪律：
 * 配置损坏不该让应用起不来，但也不该被当成有效数据用。
 */
export function readProvidersFile(): ProvidersFileState {
  const raw = readJsonFile<unknown>(PROVIDERS_CONFIG_PATH, [])
  if (Array.isArray(raw)) return { revision: 0, accounts: raw as ProviderAccount[] }
  if (raw && typeof raw === 'object') {
    const { revision, accounts } = raw as { revision?: unknown; accounts?: unknown }
    return {
      revision: typeof revision === 'number' && Number.isInteger(revision) && revision >= 0 ? revision : 0,
      accounts: Array.isArray(accounts) ? (accounts as ProviderAccount[]) : [],
    }
  }
  return { revision: 0, accounts: [] }
}

/** 写 providers.json（**恒 v2 形**；原子写由 writeJsonFile 负责） */
export function writeProvidersFile(state: ProvidersFileState): void {
  writeJsonFile(PROVIDERS_CONFIG_PATH, {
    version: PROVIDERS_FILE_VERSION,
    revision: state.revision,
    accounts: state.accounts,
  })
}

/**
 * 凭据库（模型管理 v3 §4.2）：`{ version: 1, refs: { [ref]: '<ENC:…>' } }`。
 *
 * 为什么独立成文件：密钥此前混在 models.json/providers.json 里，任何「把配置文件交给别人看」
 * 或「整份读-改-写」的路径都会顺带搬运密文；搬出来之后配置文件的形状里**不再有密码字段**，
 * 且 set/unset 只碰本文件（T4 迁移会把存量 `ENC:` 值原样搬进来）。
 */
export const CREDENTIALS_CONFIG_PATH = path.join(VELA_HOME, 'credentials.json')
export const RECENT_PROJECTS_PATH = path.join(VELA_HOME, 'recent-projects.json')

/**
 * 本地 Ollama 向量档默认值（T4 **唯一字面量**）。
 *
 * `DEFAULT_GLOBAL_CONFIG.localEmbedding` 与 `readLocalEmbeddingConfig()` 都取自它 ——
 * T3 曾在 knowledge-base.ts 另存一份 `FALLBACK_LOCAL_EMBEDDING`，T5 改默认值时必然漂移，
 * 已收敛到这里（A4.3）。
 */
export const DEFAULT_LOCAL_EMBEDDING: LocalEmbeddingConfig = {
  enabled: false,
  baseUrl: 'http://localhost:11434',
  model: 'bge-m3',
  preferLocal: true,
}

/**
 * 读全局配置里的 `localEmbedding`（缺字段 / 读失败 / 类型不符 → 逐字段回退默认）。
 *
 * - 读失败走 `readJsonFile` 的兜底（返回 fallback，不抛）→ 本函数**永不抛**
 * - `enabled` 严格真值：配置损坏（如 `"true"` 字符串）时宁可不启用本地档
 *   （不向用户机器发起网络探测），也不误开
 * - `preferLocal` 缺省 true（仅显式 false 才改为 API 优先）
 * - 恒返回**新对象**（调用方改动不会污染 `DEFAULT_LOCAL_EMBEDDING`）
 */
export function readLocalEmbeddingConfig(): LocalEmbeddingConfig {
  const fallback = DEFAULT_LOCAL_EMBEDDING
  const raw = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)?.localEmbedding
  if (!raw || typeof raw !== 'object') return { ...fallback }
  return {
    enabled: raw.enabled === true,
    preferLocal: raw.preferLocal !== false,
    baseUrl: typeof raw.baseUrl === 'string' && raw.baseUrl.trim() !== '' ? raw.baseUrl : fallback.baseUrl,
    model: typeof raw.model === 'string' && raw.model.trim() !== '' ? raw.model : fallback.model,
  }
}

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
  // 拷贝一份（不共享引用）：DEFAULT_GLOBAL_CONFIG 被各控制器当 fallback 传来传去
  localEmbedding: { ...DEFAULT_LOCAL_EMBEDDING },
}
