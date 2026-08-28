/**
 * ActivityRepository 每日活动聚合测试
 *
 * better-sqlite3 编译目标为 Electron (NODE_MODULE_VERSION 145)，
 * vitest 运行环境为 Node.js，无法加载原生模块 —— 与 database.test.ts 同策略：
 * 此处验证无 DB 时的空分支与 SQL 构建逻辑，运行时聚合由 Electron 集成验证。
 *
 * config-utils 整体 mock：消除真实 ~/.novelforge/config.json（GLOBAL_CONFIG_PATH）
 * 环境依赖——readJsonFile 返回受控假数据、getProjectVelaDir 返回临时/恒不存在路径，
 * 断言基于受控数据而非本机真实配置与真实最近项目（clean CI 无 config.json 时若读真实
 * home 则回退旧 .vela 路径，属环境性红）。
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// mock database 模块，避免加载 better-sqlite3
vi.mock('../database', () => ({
  getProjectDb: () => null,
}))

// 受控 mock 句柄（vi.hoisted：在 vi.mock 工厂中引用、在测试体内覆写）
const configUtils = vi.hoisted(() => ({
  readJsonFile: vi.fn<() => { recentProjects: Array<{ name: string; path: string }> }>(
    () => ({ recentProjects: [] }),
  ),
  getProjectVelaDir: vi.fn<(projectPath: string) => string>(
    (projectPath: string) => path.join(projectPath, '.novelforge'),
  ),
}))

// mock config-utils：不读真实 home（readJsonFile 假数据 + GLOBAL_CONFIG_PATH 假常量 +
// getProjectVelaDir 走传入路径（项目路径由测试控制，与真实 home 无关））
vi.mock('../utils/config-utils', () => ({
  readJsonFile: configUtils.readJsonFile,
  GLOBAL_CONFIG_PATH: '/__mock-global-config__/config.json',
  getProjectVelaDir: configUtils.getProjectVelaDir,
}))

// 延迟导入（mock 生效后）
const { ActivityRepository } = await import('./activity-repository')
const { GLOBAL_CONFIG_PATH } = await import('../utils/config-utils')

beforeEach(() => {
  // 每次重置为受控默认值（空最近项目），隔离测试间的覆写
  configUtils.readJsonFile.mockReset().mockReturnValue({ recentProjects: [] })
  configUtils.getProjectVelaDir.mockReset().mockImplementation(
    (projectPath: string) => path.join(projectPath, '.novelforge'),
  )
})

describe('ActivityRepository.getDailyActivity', () => {
  it('无项目 DB 时返回空结构', () => {
    const result = ActivityRepository.getDailyActivity(90)
    // 受控 mock：最近项目为空 → 命中「无项目」早返回契约（endDay 为 ''，非今天日期；
    // 该日期格式仅在有项目数据时成立——旧断言依赖真实 home 数据，属环境性红）
    expect(result.days).toEqual([])
    expect(result.projects).toEqual([])
    expect(result.dayCount).toBe(0)
    expect(result.endDay).toBe('')
  })

  it('days 参数透传（默认 90）', () => {
    // 无 DB 分支不依赖参数，仅验证 API 签名不抛错
    expect(() => ActivityRepository.getDailyActivity(30)).not.toThrow()
    expect(() => ActivityRepository.getDailyActivity()).not.toThrow()
  })

  it('返回结构字段完整（空态契约）', () => {
    const result = ActivityRepository.getDailyActivity()
    expect(result).toHaveProperty('days')
    expect(result).toHaveProperty('projects')
    expect(result).toHaveProperty('startDay')
    expect(result).toHaveProperty('endDay')
    expect(result).toHaveProperty('dayCount')
    expect(Array.isArray(result.days)).toBe(true)
    expect(Array.isArray(result.projects)).toBe(true)
  })
})

describe('受控数据下的最近项目过滤（mock config-utils，不读真实 home）', () => {
  let tmpDir: string
  let missingDir: string

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-activity-test-'))
    missingDir = path.join(tmpDir, 'no-such-project')
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('readJsonFile 由 mock 返回受控数据（假 GLOBAL_CONFIG_PATH + 空回退）', () => {
    configUtils.readJsonFile.mockReturnValue({ recentProjects: [] })
    ActivityRepository.getRecentProjects()
    expect(configUtils.readJsonFile).toHaveBeenCalledWith(GLOBAL_CONFIG_PATH, { recentProjects: [] })
    expect(configUtils.readJsonFile).not.toHaveBeenCalledWith(
      expect.stringContaining('.novelforge' + path.sep + 'config.json'),
      expect.anything(),
    )
  })

  it('getRecentProjects 仅保留路径真实存在的受控项目（存在性过滤）', () => {
    configUtils.readJsonFile.mockReturnValue({
      recentProjects: [
        { name: '存在项目', path: tmpDir },
        { name: '不存在项目', path: missingDir },
      ],
    })
    const recent = ActivityRepository.getRecentProjects()
    expect(recent.map(p => p.name)).toEqual(['存在项目'])
    expect(recent[0]?.path).toBe(tmpDir)
  })

  it('受控最近项目均无 vela.db 时聚合仍返回空（项目 DB 过滤不依赖真实 home）', () => {
    configUtils.readJsonFile.mockReturnValue({
      recentProjects: [
        { name: '存在项目', path: tmpDir },
        { name: '不存在项目', path: missingDir },
      ],
    })
    const result = ActivityRepository.getDailyActivity(30)
    expect(result.days).toEqual([])
    expect(result.projects).toEqual([])
    expect(result.dayCount).toBe(0)
    // 非空项目列表（即便均无 vela.db）不早返回，endDay 为今天日期（本地时区 YYYY-MM-DD）
    expect(result.endDay).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('聚合 SQL 构建契约（与 database.ts 表结构对照）', () => {
  // 提取 SQL 片段检查（通过源码字符串，防止表名/字段拼写漂移）
  const src = ActivityRepository.getDailyActivity.toString()

  it('写作聚合：drafts source=write 按天分组', () => {
    expect(src).toContain("FROM drafts")
    expect(src).toContain("source = 'write'")
    expect(src).toContain("GROUP BY day")
    expect(src).toContain('SUM(word_count)')
  })

  it('修改聚合：drafts(rewrite) + revisions 合并', () => {
    expect(src).toContain("source = 'rewrite'")
    expect(src).toContain('UNION ALL')
    expect(src).toContain('FROM revisions')
  })

  it('模型调用聚合：llm_calls 仅成功调用', () => {
    expect(src).toContain('FROM llm_calls')
    expect(src).toContain('success = 1')
    expect(src).toContain('SUM(total_tokens)')
  })

  it('时间戳转换使用本地时区（unixepoch + localtime）', () => {
    // 毫秒时间戳 → 秒 → 本地时区日期
    expect(src).toContain("/1000, 'unixepoch', 'localtime'")
  })

  it('时间范围过滤：created_at >= startMs', () => {
    expect(src).toContain('created_at >= ?')
  })
})
