import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { GlobalConfig } from '../../src/shared/ipc-channels'

export const VELA_HOME = path.join(os.homedir(), '.vela') // V1 保持原值；V2 改 ~/.novelforge

/** 项目内运行时数据目录名（V1 占位值 .vela；V2 改 .novelforge——与 VELA_HOME 同步一次改） */
export const PROJECT_VELA_DIR = '.vela'

/** 项目库目录（V1 单路径版；V2 升级双路径+惰性迁移）——所有直开点统一走此函数 */
export function getProjectVelaDir(projectPath: string): string {
  return path.join(projectPath, PROJECT_VELA_DIR)
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
