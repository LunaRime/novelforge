/**
 * StylesController — 输出风格 .md 读盘通道（styles:list / styles:get）
 *
 * 风格文件双层存储（项目覆盖用户，同名取项目）：
 * - 项目级：{projectPath}/.novelforge/styles/*.md（经 getProjectVelaDir——复用主进程项目 vela 目录
 *   解析（含 .vela→.novelforge 惰性迁移回退），与 memory-controller 同模式，避免重复实现路径迁移逻辑）
 * - 用户级：{VELA_HOME}/styles/*.md
 *
 * 解析与双层合并逻辑在 electron/utils/style-codec.ts（纯函数，与渲染层注册表共享）。
 * v1 只读零代码注册（用户手动丢 .md 即生效），无写通道；风格文件正文是用户作品数据，不做翻译。
 */
import { ipcMain } from 'electron'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { VELA_HOME, getProjectVelaDir } from '../utils/config-utils'
import { parseStylePromptFile, styleNameFromFile, mergeStyleLayers, toStyleInfo } from '../utils/style-codec'
import type { StyleInfo, StyleMeta } from '../../src/shared/ipc-channels'

/** styles 子目录名（用户级与项目级一致） */
const STYLES_SUBDIR = 'styles'

/** 项目级 styles 目录（复用 getProjectVelaDir：.novelforge 优先 + .vela 惰性迁移回退） */
function projectStylesDir(projectPath: string): string {
  return path.join(getProjectVelaDir(projectPath), STYLES_SUBDIR)
}

/** 用户级 styles 目录 */
function userStylesDir(): string {
  return path.join(VELA_HOME, STYLES_SUBDIR)
}

/** 扫描单层目录：读取全部 *.md 并解析（非法 frontmatter/损坏文件跳过，单层失败不阻断） */
async function scanStyleLayer(dir: string): Promise<StyleMeta[]> {
  let entries
  try {
    entries = await fsPromises.readdir(dir, { withFileTypes: true })
  } catch {
    return [] // 目录不存在/不可读 → 该层为空（无风格目录时行为与现状一致）
  }
  const metas: StyleMeta[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const raw = await fsPromises.readFile(path.join(dir, entry.name), 'utf-8').catch(() => null)
    if (raw === null) continue
    const meta = parseStylePromptFile(raw, styleNameFromFile(entry.name))
    if (meta) metas.push(meta)
  }
  return metas
}

/** 双层加载 + 项目覆盖用户合并（返回按 name 排序的完整 meta） */
async function loadMergedStyles(projectPath: string): Promise<StyleMeta[]> {
  const user = await scanStyleLayer(userStylesDir())
  if (!projectPath) return mergeStyleLayers([], user)
  const project = await scanStyleLayer(projectStylesDir(projectPath))
  return mergeStyleLayers(project, user)
}

export function registerStylesController(): void {
  // 合并列表（项目覆盖用户；按 name 排序；不含 promptBody——列表只给元信息）
  ipcMain.handle('styles:list', async (_e, projectPath: string): Promise<StyleInfo[]> => {
    try {
      const merged = await loadMergedStyles(projectPath)
      return merged.map(toStyleInfo)
    } catch {
      return []
    }
  })

  // 单风格（含 promptBody——写稿注入/未来 UI 详情用）
  ipcMain.handle('styles:get', async (_e, projectPath: string, name: string): Promise<StyleMeta | null> => {
    try {
      if (!name || typeof name !== 'string') return null
      const merged = await loadMergedStyles(projectPath)
      return merged.find(s => s.name === name) ?? null
    } catch {
      return null
    }
  })
}
