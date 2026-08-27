import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// 临时假 home：vi.hoisted 在 mock 注册前求值（真实临时目录，fs 操作真实发生）
const fakeHome = vi.hoisted(() => {
  const base = process.env.TEMP ?? process.env.TMP ?? process.cwd()
  return `${base}/vela-dir-rename-config-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
})

vi.mock('node:os', () => ({
  homedir: () => fakeHome,
  default: { homedir: () => fakeHome },
}))

// config-utils 模块级计算 VELA_HOME = path.join(os.homedir(), '.novelforge)——
// 静态 import 在 vi.mock 生效后求值，拿到的是 mock home
import { VELA_HOME, GLOBAL_CONFIG_PATH, migrateLegacyDirs, getProjectVelaDir } from './config-utils'

const legacyHome = path.join(fakeHome, '.vela')

beforeEach(() => {
  vi.restoreAllMocks()
  // 确保每个用例从空目录开始（afterEach 已清理，首用例目录尚不存在）
  fs.rmSync(fakeHome, { recursive: true, force: true })
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(fakeHome, { recursive: true, force: true })
})

describe('全局迁移 ~/.vela → ~/.novelforge', () => {
  it('旧目录存在且新目录不存在 → rename（VELA_HOME 已是新路径）', async () => {
    expect(VELA_HOME).toBe(path.join(fakeHome, '.novelforge'))
    fs.mkdirSync(legacyHome, { recursive: true })
    fs.writeFileSync(path.join(legacyHome, 'config.json'), '{"theme":"dark"}')

    await migrateLegacyDirs()

    expect(fs.existsSync(legacyHome)).toBe(false)
    expect(fs.existsSync(VELA_HOME)).toBe(true)
    // 内容随目录整体迁移
    expect(fs.readFileSync(path.join(VELA_HOME, 'config.json'), 'utf-8')).toBe('{"theme":"dark"}')
  })

  it('新 home 已有 config.json（用户手动新建过/已迁移）→ 不覆盖，保留双读（双路径兜底）', async () => {
    fs.mkdirSync(legacyHome, { recursive: true })
    fs.mkdirSync(VELA_HOME, { recursive: true })
    fs.writeFileSync(path.join(legacyHome, 'old-marker.txt'), 'old')
    fs.writeFileSync(path.join(VELA_HOME, 'config.json'), '{"theme":"dark"}')
    fs.writeFileSync(path.join(VELA_HOME, 'new-marker.txt'), 'new')

    await migrateLegacyDirs()

    // config.json 哨兵存在 → 不迁移：新 home 内容未被覆盖
    expect(fs.readFileSync(path.join(VELA_HOME, 'config.json'), 'utf-8')).toBe('{"theme":"dark"}')
    expect(fs.readFileSync(path.join(VELA_HOME, 'new-marker.txt'), 'utf-8')).toBe('new')
    // 旧目录保留（双读兜底，数据不丢）
    expect(fs.existsSync(legacyHome)).toBe(true)
    expect(fs.readFileSync(path.join(legacyHome, 'old-marker.txt'), 'utf-8')).toBe('old')
  })

  it('旧目录不存在（全新安装）→ 无操作', async () => {
    await migrateLegacyDirs()

    expect(fs.existsSync(legacyHome)).toBe(false)
    expect(fs.existsSync(VELA_HOME)).toBe(false)
  })

  it('rename 失败 → 静默回退，不阻塞启动（console.error 后继续用旧路径）', async () => {
    fs.mkdirSync(legacyHome, { recursive: true })
    fs.writeFileSync(path.join(legacyHome, 'config.json'), '{"theme":"dark"}')
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('EPERM') })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(migrateLegacyDirs()).resolves.toBeUndefined() // 不抛错

    expect(errorSpy).toHaveBeenCalled()
    expect(fs.existsSync(legacyHome)).toBe(true)   // 旧目录保留
    expect(fs.existsSync(VELA_HOME)).toBe(false)   // 新目录未创建
  })

  it('迁移重试：真实失败会话副产物（logs 含当日 .log + dev/ 空或仅 .log）→ 判定 auto → 清理后真实 rename 成功', async () => {
    fs.mkdirSync(legacyHome, { recursive: true })
    fs.writeFileSync(path.join(legacyHome, 'config.json'), '{"theme":"light"}')
    fs.writeFileSync(path.join(legacyHome, 'old-marker.txt'), 'old')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // 第一次调用（本启动）：rename 瞬时失败（EBUSY）
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('EBUSY') })
    await migrateLegacyDirs()
    expect(renameSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalled()
    expect(fs.existsSync(legacyHome)).toBe(true)

    // 模拟同次启动后续的运行时副产物（运行时可达状态）：
    // ensureVelaHome 空建 {path,prompts,logs} + main.ts logger 首写 logs/vela-<date>.log
    // + Dev 模式 logs/dev/vela-dev-<date>.log。仍无 config.json 哨兵
    fs.mkdirSync(VELA_HOME, { recursive: true })
    fs.mkdirSync(path.join(VELA_HOME, 'prompts'), { recursive: true })
    fs.mkdirSync(path.join(VELA_HOME, 'logs'), { recursive: true })
    fs.writeFileSync(path.join(VELA_HOME, 'logs', 'vela-2026-08-27.log'), '[info] fake session log')
    fs.mkdirSync(path.join(VELA_HOME, 'logs', 'dev'), { recursive: true })
    fs.writeFileSync(path.join(VELA_HOME, 'logs', 'dev', 'vela-dev-2026-08-27.log'), '[debug] fake dev log')
    expect(fs.existsSync(GLOBAL_CONFIG_PATH)).toBe(false)

    // 第二次调用（下次启动）：auto 形态（空 prompts + 仅 .log 的 logs/dev）被识别并通过
    // isAutoCreatedHome 判定（日志为应用自身副产物）→ 清理 → 真实 rename 成功
    await migrateLegacyDirs()

    expect(renameSpy).toHaveBeenCalledTimes(2)
    expect(fs.existsSync(legacyHome)).toBe(false)
    expect(fs.readFileSync(path.join(VELA_HOME, 'config.json'), 'utf-8')).toBe('{"theme":"light"}')
    expect(fs.readFileSync(path.join(VELA_HOME, 'old-marker.txt'), 'utf-8')).toBe('old')
    // 副产物日志随 auto 树清理（oldHome 无 logs——迁移正确性以旧数据为准）
    expect(fs.existsSync(path.join(VELA_HOME, 'logs'))).toBe(false)
  })

  it('安全边界：newHome 含用户数据（非 auto 形态）→ 绝不删除，rename 失败静默回退（双读兜底）', async () => {
    fs.mkdirSync(legacyHome, { recursive: true })
    fs.writeFileSync(path.join(legacyHome, 'config.json'), '{"theme":"light"}')
    fs.mkdirSync(VELA_HOME, { recursive: true })
    fs.writeFileSync(path.join(VELA_HOME, 'user-notes.txt'), 'mine') // 用户手工放入的数据
    fs.mkdirSync(path.join(VELA_HOME, 'prompts'), { recursive: true })
    fs.writeFileSync(path.join(VELA_HOME, 'prompts', 'premise.json'), '{}')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await migrateLegacyDirs()

    // 安全边界：含用户数据的新目录未被删除；rename 失败（Win32 目标已存在 EPERM 实测）→
    // 静默回退——旧目录保留（双路径兜底，数据不丢）
    expect(fs.readFileSync(path.join(VELA_HOME, 'user-notes.txt'), 'utf-8')).toBe('mine')
    expect(fs.readFileSync(path.join(VELA_HOME, 'prompts', 'premise.json'), 'utf-8')).toBe('{}')
    expect(fs.existsSync(legacyHome)).toBe(true)
    expect(fs.readFileSync(path.join(legacyHome, 'config.json'), 'utf-8')).toBe('{"theme":"light"}')
  })

  it('安全边界：logs 含用户文件（非 .log，如 memo.txt）→ 判定非 auto → 不删，双读兜底', async () => {
    fs.mkdirSync(legacyHome, { recursive: true })
    fs.writeFileSync(path.join(legacyHome, 'config.json'), '{"theme":"light"}')
    fs.mkdirSync(VELA_HOME, { recursive: true })
    fs.mkdirSync(path.join(VELA_HOME, 'logs'), { recursive: true })
    fs.writeFileSync(path.join(VELA_HOME, 'logs', 'memo.txt'), 'user memo') // 用户放入 logs 的非日志文件

    await migrateLegacyDirs()

    // logs 含非 .log 文件 → 非 auto（应用副产物判定失败）→ 绝不删除 → rename 失败静默回退
    expect(fs.readFileSync(path.join(VELA_HOME, 'logs', 'memo.txt'), 'utf-8')).toBe('user memo')
    expect(fs.existsSync(legacyHome)).toBe(true)
    expect(fs.readFileSync(path.join(legacyHome, 'config.json'), 'utf-8')).toBe('{"theme":"light"}')
  })
})

describe('项目目录迁移 + 双路径（getProjectVelaDir）', () => {
  it('.vela 存在且 .novelforge 不存在 → 惰性迁移后返回新路径', () => {
    const proj = path.join(fakeHome, 'proj-a')
    fs.mkdirSync(path.join(proj, '.vela'), { recursive: true })
    fs.writeFileSync(path.join(proj, '.vela', 'vela.db'), 'sqlite')

    const result = getProjectVelaDir(proj)

    expect(result).toBe(path.join(proj, '.novelforge'))
    expect(fs.existsSync(path.join(proj, '.vela'))).toBe(false)
    expect(fs.existsSync(path.join(proj, '.novelforge', 'vela.db'))).toBe(true)
  })

  it('.novelforge 已存在 → 直接返回新路径，旧 .vela 不动（双路径兜底）', () => {
    const proj = path.join(fakeHome, 'proj-b')
    fs.mkdirSync(path.join(proj, '.novelforge'), { recursive: true })
    fs.mkdirSync(path.join(proj, '.vela'), { recursive: true })
    fs.writeFileSync(path.join(proj, '.vela', 'legacy-db'), 'old')

    const result = getProjectVelaDir(proj)

    expect(result).toBe(path.join(proj, '.novelforge'))
    expect(fs.existsSync(path.join(proj, '.vela', 'legacy-db'))).toBe(true) // 旧目录未被清
  })

  it('rename 失败 → 回退旧路径（直开点 existsSync 检查不静默漏读）', () => {
    const proj = path.join(fakeHome, 'proj-c')
    fs.mkdirSync(path.join(proj, '.vela'), { recursive: true })
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('EPERM') })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = getProjectVelaDir(proj)

    // 回退旧路径而非新路径——激活上述直开点 existsSync 检查继续读到旧库
    expect(result).toBe(path.join(proj, '.vela'))
    expect(fs.existsSync(path.join(proj, '.vela'))).toBe(true)
    expect(fs.existsSync(path.join(proj, '.novelforge'))).toBe(false)
  })

  it('新项目（无任何目录）→ 用 .novelforge 创建（返回新路径）', () => {
    const proj = path.join(fakeHome, 'proj-d')
    fs.mkdirSync(proj, { recursive: true })

    const result = getProjectVelaDir(proj)

    expect(result).toBe(path.join(proj, '.novelforge'))
    // 函数本身只返回路径，实际创建由调用方（database.ts mkdirSync）负责
    expect(fs.existsSync(path.join(proj, '.novelforge'))).toBe(false)
  })
})
