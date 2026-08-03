import { ipcMain, dialog } from 'electron'
import { t } from '../../src/shared/locale'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { readJsonFile, writeJsonFile, RECENT_PROJECTS_PATH } from '../utils/config-utils'
import { safeErrorMessage } from '../utils/error-utils'
import { logger } from '../utils/logger'
import { getProjectDb, getCurrentProjectPath } from '../database'
import { ProjectData } from '../../src/shared/ipc-channels'
import type { ProjectSummary } from '../../src/shared/ipc-channels'
import { DIR_VELA_INTERNAL, DIR_PROMPTS } from '../../src/shared/project-paths'
import { initProjectDatabase } from '../database'
import { ProjectCoreRepository } from '../repositories/project-core-repository'

interface RecentProject {
  name: string
  path: string
  updatedAt: number
}

function loadRecentProjects(): RecentProject[] {
  // 规范化历史遗留数据：旧版本 updatedAt 可能为字符串（如 "1781397664000.0"），
  // 渲染进程 new Date() 解析为 Invalid Date 会导致 UI 崩溃，统一转 number
  return readJsonFile<RecentProject[]>(RECENT_PROJECTS_PATH, []).map(p => ({
    ...p,
    updatedAt: typeof p.updatedAt === 'string' ? Number(p.updatedAt) : p.updatedAt,
  }))
}

function addRecentProject(project: RecentProject) {
  const list = loadRecentProjects()
  const filtered = list.filter((p) => p.path !== project.path)
  filtered.unshift(project)
  const trimmed = filtered.slice(0, 20)
  writeJsonFile(RECENT_PROJECTS_PATH, trimmed)
}

function removeRecentProject(projectPath: string) {
  const list = loadRecentProjects()
  const filtered = list.filter((p) => p.path !== projectPath)
  writeJsonFile(RECENT_PROJECTS_PATH, filtered)
}

export function registerProjectController() {
  // 创建新项目
  ipcMain.handle('project:create', async (_event, config: {
    name: string; path: string; genre: string; targetAudience: string
  }) => {
    try {
      const projectId = randomUUID()
      const projectDir = path.join(config.path, config.name)

      // 仅创建必要的系统目录
      fs.mkdirSync(path.join(projectDir, DIR_VELA_INTERNAL), { recursive: true })
      fs.mkdirSync(path.join(projectDir, DIR_PROMPTS), { recursive: true })

      // 初始化 DB 底座
      initProjectDatabase(projectDir)

      // 初始化 project_core 记录
      ProjectCoreRepository.init(config.name)
      ProjectCoreRepository.update({
        genre: config.genre,
        targetAudience: config.targetAudience,
      })

      // 补充缺失在 DB 初始化时生成所需的数据
      const coreData = ProjectCoreRepository.get()
      const projectData: ProjectData = {
        id: projectId,
        name: config.name,
        path: projectDir,
        novelConfig: {
          genre: config.genre,
          subGenre: '',
          targetAudience: config.targetAudience,
          totalChapters: 100,
          wordsPerChapter: 3000,
          plotStructure: 'three_act',
          narrativePOV: 'third_limited',
          coreOutline: '',
          worldSetting: '',
          goldenFinger: '',
          protagonistProfile: '',
          globalGuidance: '',
        },
        characterStates: '',
        createdAt: coreData?.createdAt || Date.now(),
        updatedAt: coreData?.updatedAt || Date.now(),
      }

      // 添加到最近项目列表
      addRecentProject({ name: config.name, path: projectDir, updatedAt: projectData.updatedAt })

      return { success: true, projectId, projectPath: projectDir }
    } catch (error) {
      return { success: false, projectId: '', error: safeErrorMessage(error) }
    }
  })

  // 打开现有项目
  ipcMain.handle('project:open', async (_event, projectPath: string) => {
    try {
      if (!fs.existsSync(projectPath)) {
        return { success: false, project: null, error: t('error.dirNotFound') }
      }

      // TODO: 这里可以加入一个检测旧版项目的逻辑（如果有 旧的 01_novel_config.json 等），提示不支持旧格式。
      // 因为新架构不兼容旧项目，这里我们只要初始化 DB 即可
      initProjectDatabase(projectPath)

      // 从 DB 读取配置
      const coreData = ProjectCoreRepository.get()
      if (!coreData) {
        // 如果是从空目录新建并打开，尝试初始化
        const folderName = path.basename(projectPath)
        ProjectCoreRepository.init(folderName)
      }

      // 组装返回给前端的数据结构
      const updatedCoreData = ProjectCoreRepository.get()
      if (!updatedCoreData) {
        return { success: false, project: null, error: t('error.projectConfigReadFailed') }
      }
      const projectData: ProjectData = {
        id: 'main',
        name: updatedCoreData.projectName,
        path: projectPath,
        novelConfig: {
          genre: updatedCoreData.genre,
          subGenre: updatedCoreData.subGenre,
          targetAudience: updatedCoreData.targetAudience,
          totalChapters: updatedCoreData.totalChapters,
          wordsPerChapter: updatedCoreData.wordsPerChapter,
          plotStructure: updatedCoreData.plotStructure as 'three_act' | 'heros_journey' | 'save_the_cat' | 'kishotenketsu' | 'multi_thread' | 'freeform',
          narrativePOV: updatedCoreData.narrativePov as 'third_limited' | 'first_person' | 'third_omniscient' | 'multi_pov',
          coreOutline: updatedCoreData.synopsis,      // 旧字段映射
          worldSetting: updatedCoreData.worldbuilding, // 旧字段映射
          goldenFinger: updatedCoreData.goldenFinger,
          protagonistProfile: updatedCoreData.charactersArch, // 旧字段映射
          globalGuidance: updatedCoreData.globalGuidance,
          writingStyle: updatedCoreData.writingStyle,
          referenceWorks: updatedCoreData.referenceWorks,
        },
        characterStates: updatedCoreData.characterStates,
        createdAt: updatedCoreData.createdAt || Date.now(),
        updatedAt: updatedCoreData.updatedAt || Date.now(),
      }

      addRecentProject({ name: projectData.name, path: projectPath, updatedAt: projectData.updatedAt })

      return { success: true, project: projectData }
    } catch (error) {
      return { success: false, project: null, error: safeErrorMessage(error) }
    }
  })

  // 保存/更新项目配置
  // 注意：novelConfig 字段与 DB project_core 列的映射关系（前后端字段名不同）
  ipcMain.handle('project:save', async (_event, _projectId: string, data: Partial<ProjectData>) => {
    try {
      if (!data.path) return { success: false, error: t('error.missingProjectPath') }

      // 收集所有需要更新的字段，合并为单次 UPDATE
      const updateData: Partial<import('../repositories/project-core-repository').ProjectCoreData> = {}

      if (data.name) {
        updateData.projectName = data.name
      }

      if (data.novelConfig) {
        const nc = data.novelConfig
        if (nc.genre !== undefined) updateData.genre = nc.genre
        if (nc.subGenre !== undefined) updateData.subGenre = nc.subGenre
        if (nc.targetAudience !== undefined) updateData.targetAudience = nc.targetAudience
        if (nc.totalChapters !== undefined) updateData.totalChapters = nc.totalChapters
        if (nc.wordsPerChapter !== undefined) updateData.wordsPerChapter = nc.wordsPerChapter
        if (nc.plotStructure !== undefined) updateData.plotStructure = nc.plotStructure
        if (nc.narrativePOV !== undefined) updateData.narrativePov = nc.narrativePOV
        if (nc.goldenFinger !== undefined) updateData.goldenFinger = nc.goldenFinger
        if (nc.globalGuidance !== undefined) updateData.globalGuidance = nc.globalGuidance
        if (nc.writingStyle !== undefined) updateData.writingStyle = nc.writingStyle
        if (nc.referenceWorks !== undefined) updateData.referenceWorks = nc.referenceWorks
        // 关键修复：反向映射旧字段名 → DB 列名
        if (nc.coreOutline !== undefined) updateData.synopsis = nc.coreOutline
        if (nc.worldSetting !== undefined) updateData.worldbuilding = nc.worldSetting
        if (nc.protagonistProfile !== undefined) updateData.charactersArch = nc.protagonistProfile
      }

      if (data.characterStates !== undefined) {
        updateData.characterStates = data.characterStates
      }

      // 单次批量更新
      ProjectCoreRepository.update(updateData)
      logger.info('Project', `配置已持久化，字段数: ${Object.keys(updateData).length}`)

      addRecentProject({
        name: data.name ?? 'Unknown',
        path: data.path,
        updatedAt: Date.now(),
      })

      return { success: true }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  // project:update-config 同理
  ipcMain.handle('project:update-config', async (_event, _projectId: string, data: Partial<ProjectData>) => {
    try {
      if (data.novelConfig) {
        const nc = data.novelConfig
        const updateData: Partial<import('../repositories/project-core-repository').ProjectCoreData> = {}
        if (nc.genre !== undefined) updateData.genre = nc.genre
        if (nc.subGenre !== undefined) updateData.subGenre = nc.subGenre
        if (nc.targetAudience !== undefined) updateData.targetAudience = nc.targetAudience
        if (nc.totalChapters !== undefined) updateData.totalChapters = nc.totalChapters
        if (nc.wordsPerChapter !== undefined) updateData.wordsPerChapter = nc.wordsPerChapter
        if (nc.plotStructure !== undefined) updateData.plotStructure = nc.plotStructure
        if (nc.narrativePOV !== undefined) updateData.narrativePov = nc.narrativePOV
        if (nc.goldenFinger !== undefined) updateData.goldenFinger = nc.goldenFinger
        if (nc.globalGuidance !== undefined) updateData.globalGuidance = nc.globalGuidance
        if (nc.writingStyle !== undefined) updateData.writingStyle = nc.writingStyle
        if (nc.referenceWorks !== undefined) updateData.referenceWorks = nc.referenceWorks
        if (nc.coreOutline !== undefined) updateData.synopsis = nc.coreOutline
        if (nc.worldSetting !== undefined) updateData.worldbuilding = nc.worldSetting
        if (nc.protagonistProfile !== undefined) updateData.charactersArch = nc.protagonistProfile
        ProjectCoreRepository.update(updateData)
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: safeErrorMessage(error) }
    }
  })

  ipcMain.handle('project:recent-list', async () => {
    return loadRecentProjects()
  })

  ipcMain.handle('project:delete-folder', async (_event, projectPath: string) => {
    try {
      if (!fs.existsSync(projectPath)) {
        return { success: false, error: t('error.projectFolderNotFound') }
      }
      const stat = fs.statSync(projectPath)
      if (!stat.isDirectory()) {
        return { success: false, error: t('error.notAFolder') }
      }
      fs.rmSync(projectPath, { recursive: true, force: true })
      // 同时从最近列表中移除
      removeRecentProject(projectPath)
      logger.info('Project', `[delete-folder] 已删除项目文件夹: ${projectPath}`)
      return { success: true }
    } catch (err) {
      const msg = safeErrorMessage(err)
      logger.error('Project', `[delete-folder] 删除失败: ${msg}`)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('project:remove-recent', async (_event, projectPath: string) => {
    try {
      removeRecentProject(projectPath)
      logger.info('Project', `[remove-recent] 已移除历史记录: ${projectPath}`)
      return { success: true }
    } catch {
      return { success: false }
    }
  })

  ipcMain.handle('dialog:select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: '选择项目保存位置',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // ===== 项目摘要（当前项目走主连接；历史项目只读打开，不打开项目）=====
  ipcMain.handle('project:get-summary', async (_event, projectPath: string): Promise<ProjectSummary | null> => {
    const dbPath = path.join(projectPath, '.vela', 'vela.db')
    if (!fs.existsSync(dbPath)) return null

    // 当前已打开的项目：直接用主连接（WAL 多连接只读有 -shm 依赖，
    // 且避免每次进工作台新建/关闭连接）
    if (getCurrentProjectPath() === projectPath) {
      const current = getProjectDb()
      if (current) return buildProjectSummary(current, projectPath)
    }

    let db: Database.Database | null = null
    try {
      db = new Database(dbPath, { readonly: true })
      try { db.pragma('journal_mode = WAL') } catch { /* 只读连接无法设置 journal_mode（已持久化为 WAL 时无副作用） */ }
      return buildProjectSummary(db, projectPath)
    } catch (err) {
      logger.error('Project', `[get-summary] 读取历史项目失败: ${projectPath} — ${safeErrorMessage(err)}`)
      return null
    } finally {
      if (db) {
        try { db.close() } catch { /* ignore */ }
      }
    }
  })
}

/** 从给定数据库连接构建项目摘要（供当前项目主连接 / 历史项目只读连接复用） */
function buildProjectSummary(
  db: Database.Database,
  projectPath: string,
): ProjectSummary {
  // 项目名 = 目录名
  const name = path.basename(projectPath)
  const totalChapters = (db.prepare(
    "SELECT total_chapters FROM project_core WHERE id = 'main'"
  ).get() as { total_chapters: number } | undefined)?.total_chapters ?? 0

  // 已定稿章节（drafts.status = 'finalized'，优先取蓝图标题；draft_id 供工作台用 vela://manuscript/{id} 打开）
  const finalizedRows = db.prepare(`
    SELECT d.chapter_number, COALESCE(bp.title, '') as title, MAX(d.id) as draft_id
    FROM drafts d
    LEFT JOIN blueprints bp ON bp.chapter_number = d.chapter_number
    WHERE d.status = 'finalized'
    GROUP BY d.chapter_number
    ORDER BY d.chapter_number
  `).all() as Array<{ chapter_number: number; title: string; draft_id: number }>
  const chapters = finalizedRows.map(r => ({ chapterNumber: r.chapter_number, title: r.title, draftId: r.draft_id }))

  // 有草稿的章节（按章汇总所有状态的草稿）
  const draftRows = db.prepare(`
    SELECT d.chapter_number, COUNT(*) as cnt,
           MAX(CASE WHEN d.status = 'finalized' THEN 1 ELSE 0 END) as has_finalized,
           COALESCE(MAX(bp.title), '') as chapter_title
    FROM drafts d
    LEFT JOIN blueprints bp ON bp.chapter_number = d.chapter_number
    WHERE d.status != 'archived'
    GROUP BY d.chapter_number
    ORDER BY d.chapter_number
  `).all() as Array<{ chapter_number: number; cnt: number; has_finalized: number; chapter_title: string }>
  const draftChapters = draftRows.map(r => ({
    chapterNumber: r.chapter_number,
    draftCount: r.cnt,
    hasFinalized: r.has_finalized === 1,
    chapterTitle: r.chapter_title,
  }))

  // 蓝图数量
  const blueprintCount = (db.prepare(
    "SELECT COUNT(*) as cnt FROM blueprints"
  ).get() as { cnt: number }).cnt

  // 故事架构生成数（premise / worldbuilding / characters_arch / synopsis 共 4 项）
  const archGenerated = (db.prepare(
    "SELECT COUNT(*) as cnt FROM project_archives WHERE project_id = 'main' AND body != ''"
  ).get() as { cnt: number }).cnt

  return { name, path: projectPath, totalChapters, chapters, draftChapters, blueprintCount, archGenerated }
}
